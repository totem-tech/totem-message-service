import { sendMessage } from '../utils/discordHelper'
import { setTexts } from '../utils/languageHelper'
import {
    generateHash,
    objClean,
    objSort,
    objWithoutKeys,
} from '../utils/utils'
import { TYPES } from '../utils/validator'
import {
    dbCdpAccessCodes,
    dbCdpDrafts,
    dbCdpLog,
    dbCdpStripeIntents,
    dbCompanies
} from './couchdb'
import { checkCompleted } from './handleDraft'
import { setAccessCode } from './handleSetAccessCode'
import { decrypt, getPublicKeys, sign, verify } from './nacl'
import { stripeCheckPaid } from './stripe'
import {
    accessCodeHashed,
    formatCDP,
    generateAccessCode,
    generateCDP,
    generateInvoiceNumber
} from './utils'
import { defs, messages } from './validation'

const CDP_DISCORD_USERNAME = process.env.CDP_DISCORD_USERNAME
const CDP_DISCORD_WEBHOOK_URL = process.env.CDP_DISCORD_WEBHOOK_URL || undefined
const CDP_DISCORD_AVATAR_URL = process.env.CDP_DISCORD_AVATAR_URL || undefined
const NUM_FREE_UPDATES = 5

const texts = {
    draft404: 'Unexpected error occured! Draft not found for companyId',
    draftIncomplete: 'incomplete or unfinished draft',
    paymentIncomplete: 'payment not completed',
}
setTexts(texts)

const SIGNATURE_KEYS = [
    '_id',
    'accounts',
    'cdp',
    'companyCategory',
    'companyStatus',
    'contactDetails',
    'countryCode',
    'countryOfOrigin',
    'dissolutionDate',
    'identity',
    'identityOld',
    'incorporationDate',
    'limitedPartnerships',
    'name',
    'payment',
    'regAddress',
    'registrationNumber',
    'relatedCompanies',
    'ubos',
    'vatNumber',
]

// ToDo: on renew, DO NOT generate new identity or accesscode
export default async function handleFinalizePayment(
    accessToken,
    intentId,
    companyId,
    callback
) {
    const [paid, intentLog] = await stripeCheckPaid(intentId, companyId)
    if (!paid) return callback(texts.paymentIncomplete)
    const {
        metadata: {
            companyId: companyIdMeta,
            tsValidTo
        } = {},
        generatedData = {},
    } = intentLog || {}
    // make sure intent has been saved and is associated for the specified company
    if (!intentLog || companyId !== companyIdMeta) return callback(messages.invalidIntent)

    const company = await dbCompanies.get(companyId)
    if (!company) return callback(messages.invalidCompany)

    let cdpEntry = await dbCdpAccessCodes.get(companyId)
    let {
        accessCode = null,
        cdp,
    } = cdpEntry || {}
    const isCreate = !accessCode
    const completed = cdp
        && accessCode
        && intentLog.status === 'completed'
    // User previously completed finalization.
    if (completed) return callback(null, {
        cdp,
        cdpEntry,
        // For uninvited users this will indicate the frontend to not serve the issuance page
        // and redirect to the verify page instead to prevent exposure of accesscode to unexpected attacker
        redirect: !accessCode,
    })

    const draft = await dbCdpDrafts.get(companyId)
    // this should never occur, but still need to check to avoid 
    if (!draft) throw new Error(`${texts.draft404}: ${companyId}`)

    // ToDo: validate & clean ALL step values in draft
    if (!checkCompleted(draft)) return callback(texts.draftIncomplete)

    // for uninvited users use empty string instead of salted access code
    const acHash = accessCode || accessCodeHashed('', companyId)
    const tokenValid = accessCodeHashed(acHash, intentId) === accessToken
    if (!tokenValid) return callback(messages.invalidToken)

    const { identity } = generatedData
    // generate new access code?
    const [err, status, newCdpEntry] = !!cdpEntry
        ? []
        : await setAccessCode(
            companyId,
            generateAccessCode(identity),
            false,
            'cdp', // indicates code generated by system when creating cdp
        )
    if (err) return callback(err)
    const codeGenerated = status === 1 // for uninvited users. include it with response
    cdpEntry = newCdpEntry || cdpEntry
    const now = new Date().toISOString()
    cdp = cdp || generateCDP(
        identity,
        company.countryCode,
        company.accounts.accountRefMonth
    )
    const relatedProps = defs
        .relatedCompanyArr
        .items
        .properties
        .map(x => x.name)
    const related2DArr = draft['related-companies']?.items || []
    const relatedCompanies = [...new Map(related2DArr).values()]
        .map(x => objSort(x, relatedProps))
    const uboProps = defs
        .uboArr
        .items
        .properties
        .map(x => x.name)
    const ubo2DArr = draft['ubo']?.items || []
    const ubos = [...new Map(ubo2DArr).values()]
        .map(x => objSort(x, uboProps))
    const contactDetails = objSort(
        draft['contact-details']?.values || {},
        defs
            .contactDetails
            .properties
            .map(x => x.name)
    )
    const regAddress = objSort({
        ...company.regAddress,
        ...draft.address?.values
    })
    const vatNumber = draft.hmrc?.values?.vatNumber || ''
    let companyUpdated = {
        // does not override if already exists.
        // will place these props at the bottom after sorting
        zz_original_company: company, // preserve original company entry including original identity
        ...company,
        cdp,
        identity, // user generated identity

        // user submitted data
        regAddress,
        vatNumber,
        tsCreated: company.tsCreated
            // first batch of companies entries were stored without timestamps
            // set a timestamp before the start of the 2nd batch
            || '2019-11-01T00:00'
    }
    let signatureData = objSort({
        ...companyUpdated,
        cdp,
        identity, // user generated identity
        // user submitted data
        regAddress,
        vatNumber,
        ubos,
        relatedCompanies,
        contactDetails,
        payment: draft.payment?.values || {},
    }, SIGNATURE_KEYS) // removes any unwanted properties
    const fingerprint = generateHash(
        JSON.stringify(signatureData),
        'blake2',
        256,
    )
    const signature = sign(fingerprint)

    const cdpIssueCount = (cdpEntry?.cdpIssueCount || 0) + 1

    // ToDo Verify signatire is good, and extract public key to return to the front end for display in the 

    // const publicKey = sign.keypairFromSecretKey(
    //     sign.keypair().secretKey
    // ).publicKey
    // const verified = verify(
    //     fingerprint,
    //     signature,
    //     pairSign.publicKey
    // )
    // if (!verified) throw new Error('CDP: signing keypair setup failed')    

    let cdpEntryUpdated = {
        ...cdpEntry,
        cdp,
        cdpIssueCount,
        cdpRemainingUpdateCount: NUM_FREE_UPDATES,
        encrypted: {
            ...cdpEntry.encrypted,
            userGeneratedData: objClean(
                generatedData,
                defs
                    .generatedData
                    .properties
                    .map(x => x.name)
            ),
        },
        // ToDo add public key to cdpEntry
        // publicKey,
        fingerprint, // seems to be broken for front-end
        identity,
        name: company.name,
        signature,
        status: 'active',
        tsCdpFirstIssued: cdpEntry.tsCdpFirstIssued || now, // first time CDP has been issued
        tsValidFrom: now,
        tsValidTo,

        // user submitted data
        regAddress,
        vatNumber,
        ubos,
        relatedCompanies,
        contactDetails,
        // ToDo: validate
        payment: objClean({
            ...draft.payment?.values || {},
            amount: intentLog.amount,
            currency: intentLog.currency,
            invoiceNumber: generateInvoiceNumber(
                company.countryCode,
                cdp,
                cdpIssueCount
            ),
            status: 'paid',
            vat: 0 // in pennies
        }, [
            'amount',
            'addressLine1',
            'addressLine2',
            'addressLine3',
            'countryCode',
            'county',
            'currency',
            'email',
            'invoiceNumber',
            'nameOnCard',
            'paymentIntentId',
            'postCode',
            'postTown',
            'standardCountry',
            'status',
            'town',
            'vat',
        ]),
    }

    try {
        // attempt to save both CDP/accessCode entry and company entry and update intent & draft
        await dbCdpAccessCodes.set(companyId, cdpEntryUpdated)

        await dbCdpStripeIntents.set(intentLog._id, {
            ...intentLog,
            tsCompleted: now,
            status: 'completed',
        })

        await dbCompanies.set(companyId, companyUpdated)

        await dbCdpDrafts.set(companyId, {
            ...draft,
            status: 'completed',
        })
        const encryptedCode = cdpEntry
            ?.encrypted
            ?.accessCode
        const result = {
            ...!!encryptedCode && {
                accessCode: decrypt(encryptedCode),
            },
            cdp,
            cdpEntry: objWithoutKeys(cdpEntryUpdated, ['encrypted']),
            redirect: false,
        }
        callback(null, result)

        await dbCdpLog
            .set(null, {
                create: isCreate, // create a new access code
                registrationNumber: company.registrationNumber,
                stepIndex: 99, // last step
                stepName: 'payment-finalization',
                type: 'cdp-form-step',
            })
            .catch(err =>
                console.log(new Date(), `[CDP] [Finalization] Failed to add log entry for succeccful CDP payment finalization of company number ${company.registrationNumber}.`, err)
            )
    } catch (err) {
        // if any of them fails to save, revert both of them
        codeGenerated
            ? await dbCdpAccessCodes.delete(companyId)
            : await dbCdpAccessCodes.set(companyId, cdpEntry)
        await dbCompanies.set(companyId, company)
        await dbCdpStripeIntents.set(intentLog._id, intentLog)

        throw new Error(err)
    }

    const [client] = this
    const {
        handshake: {
            headers: {
                hostname,
                host,
                origin = ''
            } = {},
        } = {},
    } = client || {}
    sendMessage(
        [{
            description: `**CDP Generated:** ${formatCDP(cdp)}`,
            timestamp: now,
            title: 'Payment Received! :partying_face:',
            url: `${origin}/verify/${cdp}`
        }],
        '[CDP] [Finalization]',
        false,
        undefined,
        CDP_DISCORD_USERNAME || hostname || host || origin,
        CDP_DISCORD_WEBHOOK_URL,
        CDP_DISCORD_AVATAR_URL,
    ).catch(() => console.log(new Date(), '[CDP] [Finalization] Failed to send Discord message.', { cdp }))
}
handleFinalizePayment.params = [
    {
        description: 'A token (hex string with 0x prefix) generated specifically for the payment intent. To generate the token: `hash( hash(accessCode+companyId) + intentId)`',
        name: 'accessToken',
        required: true,
        strict: true,
        type: TYPES.hex,
    },
    {
        name: 'intentId',
        required: true,
        type: TYPES.string,
    },
    defs.companyId,
    defs.callback,
]
handleFinalizePayment.result = {
    name: 'result',
    properties: [
        defs.cdp,
        defs.cdpEntry,
        defs.accessCode,
    ],
    type: TYPES.object,
}
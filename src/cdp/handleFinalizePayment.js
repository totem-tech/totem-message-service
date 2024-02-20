import {
    generateHash,
    objClean,
    objWithoutKeys,
} from '../utils/utils'
import { TYPES } from '../utils/validator'
import {
    dbCdpAccessCodes,
    dbCdpDrafts,
    dbCdpStripeIntents,
    dbCompanies
} from './couchdb'
import { checkCompleted } from './handleDraft'
import { setAccessCode } from './handleSetAccessCode'
import { sign } from './nacl'
import { checkPaid } from './stripe'
import { accessCodeHashed, generateAccessCode, generateCDP } from './utils'
import { defs, messages } from './validation'

// ToDo: on renew, DO NOT generate new identity
export default async function handleFinalizePayment(
    accessToken,
    intentId,
    companyId,
    callback
) {
    const [paid, intentLog] = await checkPaid(intentId, companyId)
    if (!paid) return callback('Payment not completed')
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
        cdp
    } = cdpEntry || {}
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
    if (!draft) throw new Error('Unexpected error occured! Draft not found for companyId: ' + companyId)
    if (!checkCompleted(draft)) return callback('Incomplete or unfinished draft')

    const acHash = accessCode || accessCodeHashed('', companyId)
    const tokenValid = accessCodeHashed(acHash, intentId) === accessToken
    if (!tokenValid) return callback(messages.invalidToken)

    const { identity } = generatedData
    // generate new access code?
    const [err, status, newCdpEntry] = !!cdpEntry
        ? []
        : await setAccessCode(companyId, generateAccessCode(identity))
    if (err) return callback(err)

    cdpEntry ??= newCdpEntry
    const codeGenerated = status === 1 // for uninvited users. include it with response
    const now = new Date().toISOString()
    let companyUpdated = {
        identityOld: company.identity, // previous identity
        ...company,
        cdp,
        identity, // user generated identity

        // user submitted data
        regAddress: {
            ...company.regAddress,
            ...draft.address?.values
        },
        vatNumber: draft.hmrc?.values?.vatNumber || '',
    }
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
        .map(x => objClean(x, relatedProps))
    const uboProps = defs
        .uboArr
        .items
        .properties
        .map(x => x.name)
    const ubo2DArr = draft['ubo']?.items || []
    const ubos = [...new Map(ubo2DArr).values()]
        .map(x => objClean(x, uboProps))
    const contactDetails = objClean(
        draft['contact-details']?.values || {},
        defs
            .contactDetails
            .properties
            .map(x => x.name)
    )
    let signatureData = {
        ...objWithoutKeys(companyUpdated, ['tsUpdated']),
        cdp,
        identity, // user generated identity
        // user submitted data
        regAddress: {
            ...company.regAddress,
            ...draft.address?.values
        },
        vatNumber: draft.hmrc?.values?.vatNumber || '',
        ubos,
        relatedCompanies,
        contactDetails,
        payment: draft.payment?.values || {},
    }
    signatureData = objClean(
        signatureData,
        Object
            .keys(signatureData)
            .sort(),
    )
    const fingerprint = generateHash(
        JSON.stringify(signatureData),
        'blake2',
        256,
    )
    const signature = sign(fingerprint)
    const cdpEntryUpdated = {
        ...cdpEntry,
        cdp,
        cdpIssueCount: (cdpEntry.cdpIssueCount || 0) + 1,
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
        fingerprint,
        identity,
        name: company.name,
        signature,
        tsCdpFirstIssued: now, // first time CDP has been issued
        tsValidFrom: now,
        tsValidTo,

        // user submitted data
        regAddress: {
            ...company.regAddress,
            ...draft.address?.values
        },
        vatNumber: draft.hmrc?.values?.vatNumber || '',
        ubos,
        relatedCompanies,
        contactDetails,
        payment: draft.payment?.values || {},
    }

    try {
        // attempt to save both CDP/accessCode entry and company entry
        await dbCdpAccessCodes.set(
            companyId,
            objClean(
                cdpEntryUpdated,
                Object
                    .keys(cdpEntryUpdated)
                    .sort()
            )
        )
        await dbCompanies.set(
            companyId,
            objClean(companyUpdated,
                Object
                    .keys(companyUpdated)
                    .sort(),
            )
        )
        await dbCdpStripeIntents.set(intentLog._id, {
            ...intentLog,
            status: 'completed',
        })
        await dbCdpDrafts.set(companyId, {
            ...draft,
            status: 'completed',
        })
    } catch (err) {
        // if any of them fails to save, revert both of them
        await dbCdpAccessCodes.set(companyId, cdpEntry)
        await dbCompanies.set(companyId, company)
        throw new Error(err)
    }
    const result = {
        cdp,
        cdpEntry: objWithoutKeys(cdpEntryUpdated, ['encrypted']),
        ...codeGenerated && { accessCode: accessToken },
    }
    callback(null, result)
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
        {
            ...defs.accessCode,
            description: 'Access code will ONLY be provided for uninvited companies where access codes are generated.'
        }
    ],
    type: TYPES.object,
}
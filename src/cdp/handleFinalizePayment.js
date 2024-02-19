import { generateHash, isHex, objClean, objWithoutKeys } from '../utils/utils'
import { TYPES } from '../utils/validator'
import { dbCdpAccessCodes, dbCdpDrafts, dbCdpStripeIntents, dbCompanies } from './couchdb'
import { checkCompleted } from './handleDraft'
import handleSetAccessCode, { setAccessCode } from './handleSetAccessCode'
import { sign } from './nacl'
import { checkPaid } from './stripe'
import { accessCodeHashed, generateAccessCode, generateCDP } from './utils'
import { defs, messages } from './validation'

// ToDo: on renew, DO NOT generate new identity
export default async function handleFinalizePayment(
    accessCode,
    intentId,
    companyId,
    callback
) {
    const [paid, intentLog] = await checkPaid(intentId, companyId)
    if (!paid) return callback('Payment not completed')
    if (!intentLog) return callback(messages.invalidIntent)

    const draft = await dbCdpDrafts.get(companyId)
    // this should never occur, but still need to check to avoid 
    if (!draft) throw new Error('Unexpected error occured! Draft not found for companyId: ' + companyId)
    if (!checkCompleted(draft)) return callback('Incomplete or unfinished draft')

    const company = await dbCompanies.get(companyId)
    if (!company) return callback(messages.invalidCompany)

    let cdpEntry = await dbCdpAccessCodes.get(companyId)
    let { accessCode: code, cdp } = cdpEntry
    const codeValid = !code || accessCodeHashed(accessCode, companyId) === code
    if (!codeValid) return callback(messages.invalidCode)

    const {
        metadata: {
            tsValidTo
        } = {},
        generatedData = {},
    } = intentLog
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
    const signatureData = {
        ...objWithoutKeys(companyUpdated, 'tsUpdated'),
        cdp,
        identity, // user generated identity
        // user submitted data
        regAddress: {
            ...company.regAddress,
            ...draft.address?.values
        },
        vatNumber: draft.hmrc?.values?.vatNumber || '',
        ubo: draft.ubo?.items || [],
        relatedCompanies: draft['related-companies']?.items || [],
        contactDetails: draft['contact-details']?.values || {},
        payment: draft.payment?.values || {},
    }
    const signature = sign(
        objClean(
            signatureData,
            Object
                .keys(signatureData)
                .sort(),
        )
    )
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
        ubo: draft.ubo?.items || [],
        relatedCompanies: draft['related-companies']?.items || [],
        contactDetails: draft['contact-details']?.values || {},
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
            Object
                .keys(companyUpdated)
                .sort(),
        )
        await dbCdpStripeIntents.set(intentLog._id, {
            ...intentLog,
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
        ...codeGenerated && { accessCode },
    }
    callback(null, result)
}
handleFinalizePayment.params = [
    defs.accessCode,
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
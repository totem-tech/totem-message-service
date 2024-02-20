import { ss58Decode } from '../utils/convert'
import { isObj, objClean } from '../utils/utils'
import { TYPES } from '../utils/validator'
import {
    dbCdpAccessCodes,
    dbCdpDrafts,
    dbCdpStripeIntents,
    dbCompanies
} from './couchdb'
import { decrypt } from './nacl'
import { accessCodeHashed } from './utils'
import { defs, messages } from './validation'

const formSteps = [
    'address',
    'hmrc',
    'ubo',
    'related-companies',
    'contact-details',
    'review',
    'payment',
    // 'issuance' // 
]
const PAYMENT_INDEX = 6
const draftDef = {
    defaultValue: null,
    name: 'draft',
    properties: [
        {
            description: 'CDP application/form step index',
            name: 'step',
            type: TYPES.integer,
        },
        {
            name: 'tsUpdated',
            required: false,
            type: TYPES.date,
        },
        ...formSteps.map(name => ({
            name,
            properties: [
                {
                    name: 'completed',
                    or: { type: TYPES.integer },
                    type: TYPES.boolean,
                },
                {
                    name: 'values',
                    or: {
                        description: 'Map converted into 2D array',
                        name: 'items',
                        type: TYPES.array,
                    },
                    type: TYPES.object,
                },
            ],
            type: TYPES.object,
        })),
    ],
    required: false,
    type: TYPES.object,
}

export const checkCompleted = draft => isObj(draft) && formSteps
    .slice(0, PAYMENT_INDEX)
    .every(stepName => !!draft?.[stepName]?.completed)

export async function handleDraft(
    companyId,
    accessCode,
    draft,
    callback
) {
    const company = await dbCdpAccessCodes.get(companyId)
        || await dbCompanies.get(companyId)
    if (!company) return callback(messages.invalidCompany)

    const { accessCode: code } = company
    if (code && code !== accessCodeHashed(accessCode, companyId)) return callback(messages.invalidCode)

    const intentId = draft
        ?.[formSteps[PAYMENT_INDEX]]
        ?.values
        ?.paymentIntentId
    const intentLog = intentId && await dbCdpStripeIntents.get(intentId)
    const validIntentCompany = !intentId
        || intentLog?.metadata?.companyId === companyId
    if (!validIntentCompany) return callback(`${messages.invalidIntent}: ${intentId}`)

    const allStepsCompleted = checkCompleted(draft)
    // handle saving drafts for uninvited users.
    // only allow saving after completing all steps and in the payment step
    const isUninvited = !code
    const gotDraft = isObj(draft)
    const allowUninvited = isUninvited
        && gotDraft
        && !!intentId
        && draft?.step === PAYMENT_INDEX
        && allStepsCompleted
    const save = companyId
        && gotDraft
        && Object.keys(draft).length > 0
        // for uninvited user ONLY save draft if:
        // - all steps are completed
        // - current step is payment
        // - payment intent is created
        && (!!code || allowUninvited)
    if (!save) {
        draft = await dbCdpDrafts.get(companyId)
        if (draft) {
            delete draft._id
            delete draft._rev
        }
        draft = draft?.status === 'completed'
            ? {} // prevent user from using draft??
            : draft
        return callback(null, draft)
    }

    draft = objClean(
        draft,
        draftDef
            .properties
            .map(x => x.name)
            .filter(Boolean)
            .sort()
    )
    await dbCdpDrafts.set(companyId, draft)
    callback(null, draft)
}
handleDraft.description = 'Get and save draft'
handleDraft.params = [
    defs.companyId,
    { ...defs.accessCode, required: false },
    draftDef,
    defs.callback,
]
handleDraft.result = {
    name: 'draft',
    type: TYPES.object,
}
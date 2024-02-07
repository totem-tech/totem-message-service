import { isObj, objClean } from '../utils/utils'
import { TYPES } from '../utils/validator'
import { dbCdpAccessCodes, dbCdpDrafts, dbCdpStripeIntents, dbCompanies, defs, messages } from './common'

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

export async function handleDraft(
    companyId,
    accessCode,
    draft,
    callback
) {
    const company = await dbCdpAccessCodes.get(companyId)
        || await dbCompanies.get(companyId)
    if (!company) return callback(messages.invalidCompany)

    let allowUninvited = false
    const { accessCode: code } = company
    if (code && code !== accessCode) callback(messages.invalidCode)
    if (!code && draft) {
        // handle saving drafts for uninvited users.
        // only allow saving after completing all steps and in the payment step
        const intentId = draft
            ?.[formSteps[PAYMENT_INDEX]]
            ?.values
            ?.paymentIntentId
        allowUninvited = !!intentId
            && draft?.step === PAYMENT_INDEX
            && formSteps
                .slice(0, PAYMENT_INDEX)
                .every(stepName => !!draft?.[stepName]?.completed)
            && (await dbCdpStripeIntents.get(intentId))?.companyId === companyId
    }
    const save = companyId
        && isObj(draft)
        && Object.keys(draft).length > 0
        // for uninvited user ONLY save draft if:
        // - all steps are completed
        // - current step is payment
        // - payment intent is created
        && !!code || allowUninvited
    if (save) {
        draft = objClean(
            draft,
            draftDef
                .properties
                .map(x => x.name)
                .filter(Boolean)
                .sort()
        )
        await dbCdpDrafts.set(companyId, draft)
    } else {
        draft = await dbCdpDrafts.get(companyId)
        draft && delete draft._id
        draft && delete draft._rev
    }

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
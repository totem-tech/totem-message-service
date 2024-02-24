import CouchDBStorage from '../utils/CouchDBStorage'

// dbCdpAccessCodes entries must have companyId as their IDs
const accessCodesMiddleware = (docs = [], save) => {
    if (save) return

    // When retreiving documents exclude sensitive properties (eg: "encrypted") that shouldn't be exposed to the app.
    docs.forEach(doc => delete doc.encrytped)
    return docs
}
export const dbCdpAccessCodes = new CouchDBStorage(
    null,
    'cdp_access_codes',
    [],
    accessCodesMiddleware,
)
export const dbCdpDrafts = new CouchDBStorage(null, 'cdp_drafts')
export const dbCdpLog = new CouchDBStorage(null, 'cdp_log')
export const dbCdpReports = new CouchDBStorage(null, 'cdp_reports')
export const dbCdpStripeIntents = new CouchDBStorage(null, 'cdp_stripe_intents')
export const dbCompanies = new CouchDBStorage(null, 'companies')

export const setup = async () => {
    // create indexes. Ignore if already exists
    await dbCdpAccessCodes.createIndexes([
        // { // expensive query, use registrationNumber index instead
        //     index: {
        //         fields: [
        //             'accessCode',
        //             'companyId',
        //             'registrationNumber',
        //         ]
        //     },
        //     name: 'accessCode-companyId-registrationNumber-index',
        // },
        {
            index: { fields: ['cdp'] },
            name: 'cdp-index',
        },
        // { // redundant. companyId is the document _id
        //     index: { fields: ['companyId'] },
        //     name: 'companyId-index',
        // },
        {
            index: { fields: ['registrationNumber'] },
            name: 'registrationNumber-index',
        },
    ])
    await dbCdpLog.createIndexes([
        {
            index: { fields: ['create'] },
            name: 'create-index',
        },
        {
            index: { fields: ['registrationNumber'] },
            name: 'registrationNumber-index',
        },
        {
            index: { fields: ['stepIndex'] },
            name: 'stepIndex-index',
        },
        {
            index: { fields: ['stepName'] },
            name: 'stepName-index',
        },
        {
            index: { fields: ['tsCreated'] },
            name: 'tsCreated-index',
        },
        {
            index: { fields: ['type'] },
            name: 'type-index',
        },
    ])
    await dbCdpStripeIntents.createIndexes([
        {
            index: { fields: ['metadata.companyId'] },
            name: 'companyId-index',
        },
        {
            index: { fields: ['metadata.registrationNumber'] },
            name: 'registrationNumber-index',
        },
    ])
}
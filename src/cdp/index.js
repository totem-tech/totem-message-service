import PromisE from '../utils/PromisE'
import { generateHash } from '../utils/utils'
import {
    dbCdpAccessCodes,
    dbCdpLog,
    dbCompanies
} from './common'
import handleCheckCreate from './handleCheckCreate'
import handleCompanySearch from './handleCompanySearch'
import handleLogProgress from './handleLogProgress'
import handleReport from './handleReport'
import handleStripeCreateIntent, { handleStripeCheckPaid, setupStripe } from './stripe'
import handleValidateAccessCode from './handleValidateAccessCode'
import handleVerify from './handleVerify'

export const setup = async (expressApp) => {
    const createIndexes = (db, indexes = []) => PromisE.all(
        indexes.map(index =>
            db.createIndex(index)
        )
    )
    const cdpIndexes = [
        {
            index: {
                fields: [
                    'accessCode',
                    'companyId',
                    'registrationNumber',
                ]
            },
            name: 'accessCode-companyId-registrationNumber-index',
        },
        {
            index: { fields: ['cdp'] },
            name: 'cdp-index',
        },
        {
            index: { fields: ['companyId'] },
            name: 'companyId-index',
        },
        {
            index: { fields: ['registrationNumber'] },
            name: 'registrationNumber-index',
        },
    ]
    const logIndexes = [
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
    ]
    const dbStripeIntentIndexes = [
        {
            index: { fields: ['companyId'] },
            name: 'companyId-index',
        },
    ]

    // create indexes. Ignore if already exists
    await createIndexes(
        await dbCdpAccessCodes.getDB(),
        cdpIndexes
    )
    await createIndexes(
        await dbCdpLog.getDB(),
        logIndexes,
    )
    await createIndexes(dbStripeIntentIndexes)

    // create demo CDP entries
    // if (process.env.DEBUG === 'TRUE') {
    //     const sampleEnties = await dbCompanies.search({
    //         registrationNumber: '04254364'
    //     }, 1, 0, false)
    //     await dbCdpAccessCodes.setAll(
    //         sampleEnties.map(({ _id, registrationNumber }) => ({
    //             _id,
    //             // ToDO: generate by encrypting to a throwaway key? Use faucet keypair?
    //             // without "-" 
    //             accessCode: generateHash(
    //                 _id + registrationNumber,
    //                 'blake2',
    //                 32
    //             )
    //                 .slice(2)
    //                 .toUpperCase(),
    //             companyId: _id,
    //             registrationNumber,

    //             // to be generated/updated on payment
    //             cdp: null,
    //             companyData: null,
    //             paymentReference: null,

    //             // to be updated by front end
    //             stepIndex: null,
    //             tsCdpIssued: null,
    //             tsFirstAccessed: null,
    //             tsStepCompleted: {},
    //             tsPaid: null,
    //         }))
    //     )
    // }

    await setupStripe(expressApp)
}

const handlers = {
    'cdp-check-create': handleCheckCreate,
    'cdp-company-search': handleCompanySearch,
    'cdp-log-progress': handleLogProgress,
    'cdp-report': handleReport,
    'cdp-stripe-create-intent': handleStripeCreateIntent,
    'cdp-stripe-check-paid': handleStripeCheckPaid,
    'cdp-validate-access-code': handleValidateAccessCode,
    'cdp-verify': handleVerify,
}

Object
    .values(handlers)
    .forEach(handler => {
        handler.includeLabel = false // only error message. exclude param label/name
        handler.includeValue = false // exclude value from error message
    })
export default handlers
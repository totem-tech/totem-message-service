import { } from '../companies'
import PromisE from '../utils/PromisE'
import { generateHash } from '../utils/utils'
import { dbCdpAccessCodes, dbCompanies } from './common'
import handleCheckCreate from './handleCheckCreate'
import handleCompanySearch from './handleCompanySearch'
import handleValidateAccessCode from './handleValidateAccessCode'
import handleVerify from './handleVerify'

// // //  ToDo: WIP & to be implemented on the frontend
// // async function handleUpdateStatus(
// //     accessCode,
// //     companyId,
// //     registrationNumber,
// //     status,
// //     callback
// // ) {
// //     if (!isFn(callback)) return

// //     const entry = await storage.find({
// //         accessCode: getCodeSanitised(accessCode),
// //         companyId,
// //         registrationNumber,
// //     })
// //     if (!entry) return callback(messages.invalidCodeOrReg)

// //     const { params = [] } = handleUpdateStatus
// //     params[2].map(x => {
// //         const key = x.name
// //         if (!key || !status.hasOwnProperty(key)) return
// //         entry[key] = status[key]
// //     })

// //     await storage.set(entry._id, entry)
// //     callback(null)
// // }
// // handleUpdateStatus.params = [
// //     defs.accessCode,
// //     defs.companyId,
// //     defs.regNum,
// //     {
// //         defaultValue: {},
// //         name: 'status',
// //         properties: [
// //             {
// //                 max: 99,
// //                 min: 0,
// //                 name: 'stepIndex',
// //                 required: false,
// //                 type: TYPES.integer,
// //             },
// //             {
// //                 name: 'tsFormCompleted', // last step (before payment) completed
// //                 required: false,
// //                 type: TYPES.date,
// //             },
// //         ],
// //         type: TYPES.object,
// //     },
// //     defs.callback,
// // ]

export const setup = async () => {
    const db = await dbCdpAccessCodes.getDB()
    const indexes = [
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

    // create indexes. Ignore if already exists
    await PromisE.all(indexes.map(index => db.createIndex(index)))

    // create demo CDP entries
    if (process.env.DEBUG === 'TRUE') {
        const sampleEnties = await dbCompanies.search({
            registrationNumber: '04254364'
        }, 1, 0, false)
        await dbCdpAccessCodes.setAll(
            sampleEnties.map(({ _id, registrationNumber }) => ({
                _id,
                // ToDO: generate by encrypting to a throwaway key? Use faucet keypair?
                // without "-" 
                accessCode: generateHash(
                    _id + registrationNumber,
                    'blake2',
                    32
                )
                    .slice(2)
                    .toUpperCase(),
                companyId: _id,
                registrationNumber,

                // to be generated/updated on payment
                cdp: null,
                companyData: null,
                paymentReference: null,

                // to be updated by front end
                stepIndex: null,
                tsCdpIssued: null,
                tsFirstAccessed: null,
                tsFormCompleted: null,
                tsPaid: null,
            }))
        )
    }
}

const handlers = {
    'cdp-check-create': handleCheckCreate,
    'cdp-company-search': handleCompanySearch,
    // 'cdp-update-status': handleUpdateStatus,
    'cdp-validate-code': handleValidateAccessCode,
    'cdp-verify': handleVerify,
}

Object
    .values(handlers)
    .forEach(handler => {
        handler.includeLabel = false // only error message. exclude param label/name
        handler.includeValue = false // exclude value from error message
    })
export default handlers
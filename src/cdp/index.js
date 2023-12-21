import { companies } from '../companies'
import { setTexts } from '../language'
import CouchDBStorage from '../utils/CouchDBStorage'
import PromisE from '../utils/PromisE'
import { generateHash, isFn } from '../utils/utils'
import { TYPES } from '../utils/validator'

const accessCodes = new CouchDBStorage(null, 'cdp_access-codes')
const messages = {
    error404: 'invalid access code or registration number!',
    codeInvalid: 'invalid access code',
    companyIdInvalid: 'invalid company ID',
    regNumInvalid: 'invalid registration number',
}
// setTexts(messages)
const defs = {
    accessCode: {
        customMessages: messages.codeInvalid,
        maxLength: 9,
        minLength: 8,
        name: 'accessCode',
        required: true,
        type: TYPES.string,
    },
    companyId: {
        customMessages: messages.companyIdInvalid,
        name: 'companyId',
        required: true,
        type: TYPES.hash,
    },
    regNum: {
        customMessages: messages.regNumInvalid,
        minLength: 6,
        name: 'registrationNumber',
        required: true,
        type: TYPES.string,
    },
}

async function handleUpdateStatus(
    accessCode,
    companyId,
    registrationNumber,
    status,
    callback
) {
    if (!isFn(callback)) return

    const entry = await accessCodes.find({
        accessCode,
        companyId,
        registrationNumber,
    })
    if (!entry) return callback(messages.error404)

    const { params = [] } = handleUpdateStatus
    params[2].map(x => {
        const key = x.name
        if (!key || !status.hasOwnProperty(key)) return
        entry[key] = status[key]
    })

    await accessCodes.set(entry._id, entry)
    callback(null)
}
handleUpdateStatus.includeLabel = false
handleUpdateStatus.includeValue = false // exclude value from error message
handleUpdateStatus.params = [
    defs.accessCode,
    defs.companyId,
    defs.regNum,
    {
        defaultValue: {},
        name: 'status',
        properties: [
            {
                max: 99,
                min: 0,
                name: 'stepIndex',
                required: false,
                type: TYPES.integer,
            },
            {
                name: 'tsFormCompleted', // last step (before payment) completed
                required: false,
                type: TYPES.date,
            },
        ],
        type: TYPES.object,
    },
    {
        name: 'callback',
        required: true,
        type: TYPES.function,
    },
]

async function handleValidateAccessCode(
    accessCode,
    companyId,
    registrationNumber,
    callback
) {
    if (!isFn(callback)) return

    const entry = await accessCodes.find({
        accessCode,
        companyId,
        registrationNumber,
    })

    const valid = entry?.registrationNumber === registrationNumber
        && entry?.accessCode === accessCode

    if (valid && !entry.tsFirstAccessed) {
        entry.stepIndex = 0
        entry.tsFirstAccessed = new Date().toISOString()
        await accessCodes.set(entry._id, entry)
    }
    callback(
        !!entry && valid
            ? null
            : messages.error404,
        valid,
    )
}
handleValidateAccessCode.includeLabel = false
handleValidateAccessCode.includeValue = false // exclude value from error message
handleValidateAccessCode.params = [
    defs.accessCode,
    defs.companyId,
    defs.regNum,
    {
        name: 'callback',
        required: true,
        type: TYPES.function,
    },
]
handleValidateAccessCode.result = {
    name: 'valid',
    type: TYPES.boolean,
}


export const setup = async () => {
    const db = await accessCodes.getDB()
    const indexes = [
        {
            index: { fields: ['accessCode', 'companyId', 'registrationNumber'] },
            name: 'accessCode-companyId-registrationNumber-index',
        },
    ]

    // create indexes. Ignore if already exists
    await PromisE.all(indexes.map(index => db.createIndex(index)))

    // create demo CDP entries
    if (process.env.DEBUG === 'TRUE') {
        // const sampleEnties = await companies.getAll(null, false, 100)
        const sampleEnties = await companies.search({
            registrationNumber: '04254364'
        }, 1, 0, false)
        await accessCodes.setAll(
            sampleEnties.map(({ _id, registrationNumber }) => ({
                _id,
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
                tsFirstAccessed: null,
                tsFormCompleted: null,
                tsPaid: null,
            }))
        )
    }
}

export default {
    'cdp-update-status': handleUpdateStatus,
    'cdp-validate-code': handleValidateAccessCode,
}
import { companies } from '../companies'
import { setTexts } from '../language'
import CouchDBStorage from '../utils/CouchDBStorage'
import PromisE from '../utils/PromisE'
import {
    generateHash,
    isFn,
    isObj,
    objClean
} from '../utils/utils'
import { TYPES } from '../utils/validator'

const storage = new CouchDBStorage(null, 'cdp_access-codes')
const messages = {
    invalidCdp: 'invalid CDP reference',
    invalidCode: 'invalid access code',
    invalidCodeOrReg: 'invalid access code or registration number',
    invalidCompany: 'invalid company ID',
    invalidRegNum: 'invalid registration number',
}
// setTexts(messages)
const defs = {
    accessCode: {
        customMessages: messages.invalidCode,
        maxLength: 9, // with "-"
        minLength: 8, // without "-"
        name: 'accessCode',
        required: true,
        type: TYPES.string,
    },
    callback: {
        name: 'callback',
        required: true,
        type: TYPES.function,
    },
    cdp: {
        customMessages: messages.invalidCdp,
        name: 'cdp',
        required: true,
        type: TYPES.string,
    },
    companyId: {
        customMessages: messages.invalidCompany,
        name: 'companyId',
        required: true,
        type: TYPES.hash,
    },
    regNum: {
        customMessages: messages.invalidRegNum,
        minLength: 6,
        name: 'registrationNumber',
        required: true,
        type: TYPES.string,
    },
}
defs.publicData = {
    description: 'Company public information',
    name: 'publicInfo',
    properties: [
        {
            name: 'countryCode',
            type: TYPES.string,
        },
        {
            description: 'Company name',
            name: 'name',
            type: TYPES.string,
        },
        defs.cdp,
        {
            name: 'regAddress',
            type: TYPES.object,
        },
        defs.regNum,
        {
            name: 'tsCdpIssued',
            type: TYPES.date,
        },
        {

            name: 'url',
            type: TYPES.string,
        },
        {

            name: 'vatNumber',
            type: TYPES.string,
        },
    ],
    type: TYPES.object,
}

/**
 * @name    getCodeSanitised
 * @description turns everything into alphanumeric uppercase string
 * @param {*} value 
 * 
 * @returns {String}
 */
export const getCodeSanitised = value => `${value || ''}`
    .match(/[a-z0-9]/ig)
    ?.join('')
    ?.toUpperCase() || ''

async function handleCheckCreate(companyId, callback) {
    const entry = await storage.find({ companyId })

    callback(null, !entry?.accessCode)
}
handleCheckCreate.params = [
    defs.companyId,
    defs.callback,
]

async function handleVerify(cdp, callback) {
    const entry = await storage.find({ cdp: getCodeSanitised(cdp) })
    const err = !isObj(entry?.companyData) && messages.invalidCdp
    callback(
        err,
        !err && objClean(
            entry.companyData,
            handleVerify
                .result
                .properties
                .map(x => x.name)
                .filter(Boolean)
        ) || undefined

    )
}
handleVerify.params = [
    defs.cdp,
    defs.callback,
]
handleVerify.result = defs.publicData

//  ToDo: WIP & to be implemented on the frontend
async function handleUpdateStatus(
    accessCode,
    companyId,
    registrationNumber,
    status,
    callback
) {
    if (!isFn(callback)) return

    const entry = await storage.find({
        accessCode: getCodeSanitised(accessCode),
        companyId,
        registrationNumber,
    })
    if (!entry) return callback(messages.invalidCodeOrReg)

    const { params = [] } = handleUpdateStatus
    params[2].map(x => {
        const key = x.name
        if (!key || !status.hasOwnProperty(key)) return
        entry[key] = status[key]
    })

    await storage.set(entry._id, entry)
    callback(null)
}
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
    defs.callback,
]

async function handleValidateAccessCode(
    accessCode,
    companyId,
    registrationNumber,
    callback
) {
    if (!isFn(callback)) return

    const entry = await storage.find({
        accessCode: getCodeSanitised(accessCode),
        companyId,
        registrationNumber,
    })

    const valid = entry?.registrationNumber === registrationNumber
        && entry?.accessCode === accessCode

    if (valid && !entry.tsFirstAccessed) {
        entry.stepIndex = 0
        entry.tsFirstAccessed = new Date().toISOString()
        await storage.set(entry._id, entry)
    }
    callback(
        !!entry && valid
            ? null
            : messages.invalidCodeOrReg,
        valid
            ? !entry?.cdp
                ? valid
                : entry
            : false
    )
}
handleValidateAccessCode.params = [
    defs.accessCode,
    defs.companyId,
    defs.regNum,
    defs.callback,
]
handleValidateAccessCode.result = {
    description: 'Indicates wheteher access code is valid.',
    name: 'valid',
    or: {
        description: 'If access code is valid and company already acquired a CDP, will return the CDP entry.',
        name: 'cdp',
        type: TYPES.string,
    },
    type: TYPES.boolean,
}

export const setup = async () => {
    const db = await storage.getDB()
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
        // const sampleEnties = await companies.getAll(null, false, 100)
        const sampleEnties = await companies.search({
            registrationNumber: '04254364'
        }, 1, 0, false)
        await storage.setAll(
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
    'cdp-update-status': handleUpdateStatus,
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
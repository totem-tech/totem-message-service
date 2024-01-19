import CouchDBStorage from '../utils/CouchDBStorage'
import { isObj, objClean } from '../utils/utils'
import { TYPES } from '../utils/validator'

// dbCdpAccessCodes entries must have companyId as their IDs
export const dbCdpAccessCodes = new CouchDBStorage(null, 'cdp_access-codes')
export const dbCdpLog = new CouchDBStorage(null, 'cdp_log')
export const dbCdpReports = new CouchDBStorage(null, 'cdp_reports')
export const dbCdpStripeIntents = new CouchDBStorage(null, 'cdp_stripe-intents')
export const dbCompanies = new CouchDBStorage(null, 'companies')
export const messages = {
    companyName: 'company name',
    invalidCdp: 'invalid CDP reference',
    invalidCode: 'invalid access code',
    invalidCodeOrReg: 'invalid access code or registration number',
    invalidCompany: 'invalid company ID',
    invalidRegNum: 'invalid registration number',
    pubInfo: 'company public information',
}
// setTexts(messages)
const accessCode = {
    customMessages: messages.invalidCode,
    maxLength: 9, // with "-"
    minLength: 8, // without "-"
    name: 'accessCode',
    required: true,
    type: TYPES.string,
}
const callback = {
    name: 'callback',
    required: true,
    params: [
        {
            description: 'Error message',
            name: 'error',
            type: TYPES.string,
        },
        {
            description: 'For expected result data type check `meta.result` for relevant endpoint.',
            name: 'result',
        },
    ],
    type: TYPES.function,
}
const cdp = {
    customMessages: messages.invalidCdp,
    name: 'cdp',
    required: true,
    type: TYPES.string,
}
const companyId = {
    customMessages: messages.invalidCompany,
    name: 'companyId',
    required: true,
    type: TYPES.hash,
}
const regAddress = {
    name: 'regAddress',
    properties: [
        {
            maxLegnth: 128,
            name: 'careOf',
            type: TYPES.string,
        },
        {
            maxLegnth: 32,
            name: 'POBox',
            type: TYPES.string,
        },
        {
            maxLegnth: 128,
            name: 'addressLine1',
            type: TYPES.string,
        },
        {
            maxLegnth: 128,
            name: 'addressLine2',
            type: TYPES.string,
        },
        {
            maxLegnth: 128,
            name: 'postTown',
            type: TYPES.string,
        },
        {
            maxLegnth: 64,
            name: 'county',
            type: TYPES.string,
        },
        {
            maxLegnth: 64,
            name: 'country',
            type: TYPES.string,
        },
        {
            maxLegnth: 16,
            name: 'postCode',
            type: TYPES.string,
        },
    ],
    type: TYPES.object,
}
const regNum = {
    customMessages: messages.invalidRegNum,
    minLength: 6,
    name: 'registrationNumber',
    required: true,
    type: TYPES.string,
}
const ubo = {
    name: 'ubo',
    properties: [
        cdp,
        {
            maxLegnth: 2,
            name: 'country',
            required: false,
            type: TYPES.string,
        },
        {
            name: 'legalEntity',
            type: TYPES.boolean,
        },
        {
            maxLegnth: 128,
            description: 'Name of the company or person.',
            name: 'name',
            required: true,
        },
        {
            description: 'Percentage of share (25 - 100) by a single UBO. Maximum 7 decimal places.',
            max: 100,
            maxLength: 10,
            min: 25,
            name: 'sharePercentage',
            required: true,
            type: 'number',
        },
        regNum,
    ],
    type: TYPES.object,
}
const ubos = {
    maxLength: 4, // maximum 4 array items.
    name: 'ubos',
    items: ubo.properties,
    type: TYPES.array,
}
const vatNum = {
    maxLegnth: 32,
    name: 'vatNumber',
    type: TYPES.string,
}
const publicData = {
    description: messages.pubInfo,
    name: 'publicInfo',
    properties: [
        {
            name: 'accounts',
            properties: [
                {
                    name: 'accountRefDay',
                    type: TYPES.string,
                },
                {
                    name: 'accountRefMonth',
                    type: TYPES.string,
                },
            ],
            type: TYPES.object,
        },
        cdp,
        companyId,
        {
            name: 'countryCode',
            type: TYPES.string,
        },
        {
            description: messages.companyName,
            name: 'name',
            type: TYPES.string,
        },
        regAddress,
        regNum,
        {
            maxLegnth: 24,  // eg: "2001-01-01T01:01:01.001Z"
            name: 'tsCdpIssued',
            type: TYPES.date,
        },
        {
            maxLegnth: 256,
            name: 'url',
            type: TYPES.string,
        },
        vatNum,
    ],
    type: TYPES.object,
}
const cdpData = {
    name: 'cdpData',
    properties: [
        regAddress,
        vatNum
    ],
    type: TYPES.object
}
export const defs = {
    accessCode,
    callback,
    cdp,
    companyId,
    publicData,
    regNum,
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

export const getPublicData = companyOrCdpEntry => isObj(companyOrCdpEntry)
    && objClean(
        {
            ...companyOrCdpEntry,
            ...companyOrCdpEntry.companyData,
            ...!companyOrCdpEntry.accessCode && { // entry from companies database
                [companyId.name]: companyOrCdpEntry._id
            },
        },
        defs
            .publicData
            .properties
            .map(x => x.name)
            .filter(Boolean)
    )
    || undefined
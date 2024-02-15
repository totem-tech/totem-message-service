import CouchDBStorage from '../utils/CouchDBStorage'
import { ss58Decode } from '../utils/convert'
import { randomBytes } from '../utils/naclHelper/utils'
import {
    generateHash,
    isObj,
    objClean,
    strFill
} from '../utils/utils'
import { TYPES } from '../utils/validator'

// dbCdpAccessCodes entries must have companyId as their IDs
export const dbCdpAccessCodes = new CouchDBStorage(null, 'cdp_access-codes')
export const dbCdpDrafts = new CouchDBStorage(null, 'cdp_drafts')
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
    maxLength: 14, // with "-"
    minLength: 12, // without "-"
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
            name: 'countryOfOrigin',
            type: TYPES.string,
        },
        {
            description: 'Blockchain identity/address',
            name: 'identity',
            type: TYPES.identity,
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

export const generateAccessCode = identity => {
    const identityBytes = ss58Decode(identity)
    const salt = randomBytes(8, false)
    const salt2 = randomBytes(8, false)
    const salt3 = randomBytes(8, false)
    const saltedBytes = new Uint8Array([
        ...salt,
        ...identityBytes.slice(0, 16),
        ...salt2,
        ...identityBytes.slice(16),
        ...salt3,
    ])
    const saltedHash = generateHash(
        saltedBytes,
        'blake2',
        256,
    )
        .slice(2) // remove '0x'
    return [
        ...saltedHash.slice(0, 4),
        ...saltedHash.slice(30, 34),
        ...saltedHash.slice(-4),
    ]
        .map(randomCase)
        .join('')
}

export const generateCDP = (identity, countryCode, accountRefMonth) => {
    const identityBytes = ss58Decode(identity)
    const salt = randomBytes(8, false)
    const saltedBytes = new Uint8Array([
        ...salt,
        ...identityBytes
    ])
    const saltedHash = generateHash(
        saltedBytes,
        'blake2',
        256,
    )
        .slice(2) // remove "0x"
        .toUpperCase()
    const cdp = [
        countryCode,
        `${accountRefMonth ?? ''}`
            .padStart(2, '0')
            .slice(-2),
        saltedHash.slice(0, 4),
        saltedHash.slice(-4)
    ].join('')
    return cdp
}
// setTimeout(() => {
//     console.log('\n<= CDP =>', generateCDP('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', 'GB', 6))
//     console.log('\n<= Code =>', generateAccessCode('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'))
// })

export const getPublicData = companyOrCdpEntry => isObj(companyOrCdpEntry)
    && objClean(
        {
            ...companyOrCdpEntry.companyData,
            ...companyOrCdpEntry,
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

/**
 * @name    randomCase
 * @summary randomly upper/lower-case string
 * 
 * @param   {String} str 
 * 
 * @returns {String}
 */
export const randomCase = (str = '') => {
    const upperCase = Math.ceil(Math.random(1e10) * 1e10) % 2 === 0
    return !upperCase
        ? str.toLowerCase()
        : str.toUpperCase()
}

/**
 * @name    getCodeSanitised
 * @description Sanitise access code. Turns everything into alphanumeric string.
 * @param {*} value 
 * 
 * @returns {String}
 */
export const sanitiseAccessCode = value => `${value || ''}`
    .match(/[a-z0-9]/ig)
    ?.join('')
    || ''

/**
 * @name    getCDPSanitised
 * @description Sanitise CDP reference. Turns everything into uppercase alphanumeric string.
 * @param {*} value 
 * 
 * @returns {String}
 */
export const sanitiseCDP = value => sanitiseAccessCode(value).toUpperCase()
import { ss58Decode } from '../utils/convert'
import { randomBytes } from '../utils/naclHelper/utils'
import {
    generateHash,
    isObj,
    objClean,
} from '../utils/utils'
import { getIdentity } from './nacl'
import { defs } from './validation'

export const accessCodeHashed = (accessCode, companyId) => generateHash(
    accessCode + companyId,
    'blake2',
    256,
)
const format = (value = '', sanitiseFn) => {
    value = sanitiseFn?.(value) ?? value

    return new Array(Math.ceil(value.length / 4))
        .fill(0)
        .map((_, i) => value.slice(i * 4, i * 4 + 4))
        .join('-')
}

export const formatAccessCode = code => format(code, sanitiseAccessCode)

export const formatCDP = cdp => format(cdp, sanitiseCDP)
    .slice(0, 14) // limit to maximum 12 characters and 2 dashes

export const generateAccessCode = (identity = getIdentity()) => {
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

export const generateInvoiceNumber = (countryCode, cdp, cdpIssueCount) => `IN${countryCode}${cdp}-${cdpIssueCount}`

export const getPublicData = (cdpEntry, companyEntry) => objClean(
    {
        ...isObj(companyEntry) && companyEntry,
        ...isObj(cdpEntry) && cdpEntry,
        // in-case cdpEntry does not exist
        [defs.companyId.name]: companyEntry?._id || cdpEntry?.companyId,
        contactDetails: {
            url: cdpEntry?.contactDetails?.url,
        },
    },
    defs
        .publicData
        .properties
        .map(x => x.name)
        .filter(Boolean)
)

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
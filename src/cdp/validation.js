/**
 * All validation type definitions.
 * These are also used as event parameter metadata.
 */
import { arrSort } from '../utils/utils'
import { TYPES } from '../utils/validator'

export const messages = {
    companyName: 'company name',
    invalidCdp: 'invalid CDP reference',
    invalidCode: 'invalid credentials',
    invalidCodeOrReg: 'invalid credentials',
    invalidCompany: 'invalid company',
    invalidIntent: 'invalid intent ID',
    invalidRegNum: 'company registration number not known or invalid. For recent companies, try again in a few days.',
    invalidSignature: 'invalid signature',
    invalidToken: 'invalid token',
    pubInfo: 'company public information',
}
// setTexts(messages)
const accessCode = {
    customMessages: messages.invalidCode,
    maxLength: 12,
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
const cdpIssueCount = {
    description: 'Number of times a CDP has been issued or renewed',
    name: 'cdpIssueCount',
    type: TYPES.integer,
}
const companyId = {
    customMessages: messages.invalidCompany,
    name: 'companyId',
    required: true,
    type: TYPES.hash,
}
const contactDetails = {
    name: 'contactDetails',
    properties: [
        {
            name: 'email',
            required: true,
            type: TYPES.string,
        },
        {
            name: 'name',
            required: true,
            type: TYPES.string,
        },
        {
            name: 'url',
            required: false,
            type: TYPES.string,
        },
    ],
    type: TYPES.object,
}
const fingerprint = {
    name: 'fingerprint',
    type: TYPES.hash,
}
const generatedData = {
    description: 'Generated Blockchain identity and encrypted data in an object.',
    name: 'generatedData',
    properties: [
        {
            description: 'Blockchain identity/address',
            name: 'identity',
            required: true,
            type: TYPES.identity,
        },
        // {
        // 	name: 'isBox',
        // 	required: true,
        // 	type: TYPES.boolean,
        // },
        {
            name: 'uriEncrypted',
            required: true,
            type: TYPES.hex,
        },
        {
            name: 'uriEncryptedSigned',
            required: true,
            type: TYPES.hex,
        },
    ],
    required: true,
    type: TYPES.object,
}
const publicKeys = {
    description: 'Encryption and signer public keys',
    name: 'publicKeys',
    properties: [
        {
            description: 'Encryption public key used to encrypt messages to.',
            name: 'encrypt',
            required: true,
            type: TYPES.hex,
        },
        {
            description: 'Signature public key used to verify digital signatures.',
            name: 'sign',
            required: true,
            type: TYPES.hex,
        },
    ],
    required: true,
    type: TYPES.object,
}
generatedData.properties.push({
    ...publicKeys,
    name: 'userPublicKeys'
})
const regAddress = {
    name: 'regAddress',
    properties: [
        {
            maxLength: 128,
            name: 'careOf',
            type: TYPES.string,
        },
        {
            maxLength: 32,
            name: 'POBox',
            type: TYPES.string,
        },
        {
            maxLength: 128,
            name: 'addressLine1',
            type: TYPES.string,
        },
        {
            maxLength: 128,
            name: 'addressLine2',
            type: TYPES.string,
        },
        {
            maxLength: 128,
            name: 'postTown',
            type: TYPES.string,
        },
        {
            maxLength: 64,
            name: 'county',
            type: TYPES.string,
        },
        {
            maxLength: 64,
            name: 'country',
            type: TYPES.string,
        },
        {
            maxLength: 16,
            name: 'postCode',
            type: TYPES.string,
        },
        {
            maxLength: 32,
            name: 'registeredCountry',
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
// ToDo: set properties
const relatedCompany = {
    name: 'relatedCompany',
    properties: [
        {
            name: 'cdp',
            type: TYPES.string,
        },
        {
            name: 'country',
            required: true,
            type: TYPES.string,
        },
        {
            name: 'name',
            required: true,
            type: TYPES.string,
        },
        {
            name: 'registrationNumber',
            required: true,
            type: TYPES.string,
        },
    ],
    type: TYPES.object,
}
const relatedCompanyArr = {
    maxLength: 10, // maximum 10 array items.
    name: 'relatedCompanies',
    items: relatedCompany,
    type: TYPES.array,
}
const signature = {
    name: 'signature',
    required: true,
    type: TYPES.hex,
}
const ubo = {
    name: 'ubo',
    properties: [
        cdp,
        {
            maxLength: 2,
            name: 'country',
            required: false,
            type: TYPES.string,
        },
        {
            name: 'legalEntity',
            type: TYPES.boolean,
        },
        {
            maxLength: 128,
            description: 'Name of the company or person.',
            name: 'name',
            required: true,
        },
        {
            // Max decimals = 7 decimal places 
            description: 'Percentage of shares (25% - 100%) owned by a single UBO.',
            max: 100,
            maxLength: 10,
            min: 25,
            name: 'sharePercentage',
            required: true,
            type: TYPES.number,
        },
        regNum,
    ],
    type: TYPES.object,
}
const uboArr = {
    maxLength: 4, // maximum 4 array items.
    name: 'ubos',
    items: ubo,
    type: TYPES.array,
}
const vatNum = {
    maxLength: 32,
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
        cdpIssueCount,
        companyId,
        contactDetails,
        {
            name: 'countryCode',
            type: TYPES.string,
        },
        {
            name: 'countryOfOrigin',
            type: TYPES.string,
        },
        fingerprint,
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
        signature,
        {
            name: 'tsCdpFirstIssued',
            type: TYPES.date,
        },
        {
            name: 'tsValidFrom',
            type: TYPES.date,
        },
        {
            name: 'tsValidTo',
            type: TYPES.date,
        },
        {
            maxLength: 256,
            name: 'url',
            type: TYPES.string,
        },
        vatNum,
    ],
    type: TYPES.object,
}
const cdpEntry = {
    name: 'cdpEntry',
    properties: arrSort([
        ...publicData.properties,
        {
            description: 'Number of times CDP has been updated since last issued/renewed or signed.',
            name: 'cdpRemainingUpdateCount',
            type: TYPES.integer,
        },
        {
            description: 'Most recent CDP issuance payment references and billing details.',
            name: 'payment',
            type: TYPES.object,
        },
        relatedCompanyArr,
        uboArr,
    ], 'name'),
    type: TYPES.object
}
export const defs = {
    accessCode,
    callback,
    cdp,
    cdpEntry,
    companyId,
    contactDetails,
    generatedData,
    publicData,
    publicKeys,
    regNum,
    relatedCompany,
    relatedCompanyArr,
    signature,
    ubo,
    uboArr,
}
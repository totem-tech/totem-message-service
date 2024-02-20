/**
 * All validation type definitions.
 * These are also used as event parameter metadata.
 */
import { TYPES } from '../utils/validator'

export const messages = {
    companyName: 'company name',
    invalidCdp: 'invalid CDP reference',
    invalidCode: 'invalid credentials',
    invalidCodeOrReg: 'invalid credentials',
    invalidCompany: 'invalid company',
    invalidIntent: 'invalid intent ID',
    invalidRegNum: 'invalid registration number',
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
const companyId = {
    customMessages: messages.invalidCompany,
    name: 'companyId',
    required: true,
    type: TYPES.hash,
}
// ToDo: set properties
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
            description: 'Encryption public key to encrypt data to.',
            name: 'encrypt',
            required: true,
            type: TYPES.hex,
        },
        {
            description: 'Signature public key to verify signatures.',
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
    maxLength: 100, // maximum 4 array items.
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
const uboArr = {
    maxLength: 4, // maximum 4 array items.
    name: 'ubos',
    items: ubo,
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
        contactDetails,
        {
            name: 'countryCode',
            type: TYPES.string,
        },
        {
            name: 'countryOfOrigin',
            type: TYPES.string,
        },
        {
            name: 'fingerprint',
            type: TYPES.hex,
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
        signature,
        {
            maxLegnth: 24,  // eg: "2001-01-01T01:01:01.001Z"
            name: 'tsCdpFirstIssued',
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
const cdpEntry = {
    name: 'cdpEntry',
    properties: [
        cdp,
        companyId,
        contactDetails,
        regAddress,
        relatedCompanyArr,
        regNum,
        signature,
        uboArr,
        vatNum
    ],
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
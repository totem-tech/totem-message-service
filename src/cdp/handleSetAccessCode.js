import { isHex, isStr } from '../utils/utils'
import { TYPES } from '../utils/validator'
import { dbCdpAccessCodes, dbCompanies } from './couchdb'
import { encrypt, getIdentity } from './nacl'
import {
    accessCodeHashed,
    generateAccessCode,
    sanitiseAccessCode
} from './utils'
import { defs, messages } from './validation'

export const setAccessCode = async (
    compIdOrReg,
    accessCode,
    save = true,
    codeGeneratedBy
) => {
    const company = isHex(compIdOrReg)
        ? await dbCompanies.get(compIdOrReg)
        : await dbCompanies.find({ registrationNumber: compIdOrReg })
    if (!company) return [messages.invalidCompany]

    const {
        _id,
        registrationNumber
    } = company
    const companyId = _id
    const cdpEntry = await dbCdpAccessCodes.get(companyId)
    // access code already generated
    if (!!cdpEntry) return [null, 0]

    const serverIdentity = getIdentity()
    const generateCode = !isStr(accessCode) || sanitiseAccessCode(accessCode).length < 12
    accessCode = !generateCode
        ? sanitiseAccessCode(accessCode)
        : generateAccessCode(serverIdentity)
    let newEntry = {
        _id: companyId,
        accessCode: accessCodeHashed(accessCode, companyId),
        companyId,
        encrypted: {
            accessCode: encrypt(accessCode),
            accessCodeGeneratedBy: codeGeneratedBy,
            serverIdentity, // store the identity to easily associate the encryption keypair with
        },
        registrationNumber,
        status: 'created',

        // to be generated/updated on payment
        cdp: null,
        cdpIssueCount: 0,
        identity: null,
        tsCdpFirstIssued: null, // first time CDP has been issued
        tsValidFrom: null,
        tsValidTo: null,
    }
    newEntry = Object
        .keys(newEntry)
        .sort()
        .reduce((obj, key) => ({
            ...obj,
            [key]: newEntry[key],
        }), {})

    if (save) await dbCdpAccessCodes.set(companyId, newEntry)

    return [
        null,
        generateCode ? 1 : 2,
        newEntry,
        accessCode
    ]
}

export default async function handleSetAccessCode(
    companyId,
    accessCode,
    saveEntry,
    callback
) {
    const [client, user] = this
    const [err, ...rest] = await setAccessCode(
        companyId,
        accessCode,
        saveEntry,
        user._id,
    )
    callback(err, {
        accessCode: rest[2],
        status: rest[0],
        newEntry: rest[1],
    })
}
handleSetAccessCode.description = 'Check and create access code for a company. Ignore if access code already exists.'
handleSetAccessCode.requireLogin = ['admin']
handleSetAccessCode.params = [
    {
        ...defs.regNum,
        or: defs.companyId,
    },
    {
        accept: [true],
        defaultValue: true,
        name: 'generateCode',
        or: defs.accessCode,
        type: TYPES.boolean,
    },
    {
        description: 'If false, will only check/generate access code entry',
        defaultValue: true,
        name: 'saveEntry',
        type: TYPES.boolean,
    },
    defs.callback
]
handleSetAccessCode.result = {
    descrption: '0: skipped (already exists), 1: generated, 2: save pre-specified access code',
    name: 'status',
    type: TYPES.boolean,
}
import { generateHash, isHex, isStr } from '../utils/utils'
import { TYPES } from '../utils/validator'
import { dbCdpAccessCodes, dbCompanies } from './couchdb'
import { encrypt, getIdentity } from './nacl'
import { generateAccessCode } from './utils'
import { defs, messages } from './validation'

export const setAccessCode = async (companyId, accessCode) => {
    const company = isHex(companyId)
        ? await dbCompanies.get(companyId)
        : await dbCompanies.find({ registrationNumber: companyId })
    if (!company) return [messages.invalidCompany]

    const cdpEntry = await dbCdpAccessCodes.get(companyId)
    // access code already generated
    if (!!cdpEntry) return [null, 0]

    const {
        _id,
        registrationNumber
    } = company
    companyId = _id
    const serverIdentity = getIdentity()
    const generateCode = !isStr(accessCode) || accessCode.length !== 12
    accessCode = !generateCode
        ? accessCode
        : generateAccessCode(serverIdentity)
    let newEntry = {
        accessCode: generateHash(
            accessCode + companyId,
            'blake2',
            256,
        ),
        companyId,
        encrypted: {
            accessCode: encrypt(accessCode),
            serverIdentity, // store the identity to easily associate the encryption keypair with
        },
        registrationNumber,
        status: 'created',

        // to be generated/updated on payment
        cdp: null,
        cdpIssueCount: 0,
        identity: null,
        tsCdpFirstIssued: null, // first time CDP has been issued
        tsValidFrom,
        tsValidTo,
    }
    newEntry = Object
        .keys(newEntry)
        .sort()
        .reduce((obj, key) => ({
            ...obj,
            [key]: newEntry[key],
        }), {})
    await dbCdpAccessCodes.set(companyId, newEntry)
    return [null, generateCode ? 1 : 2]
}

export default async function handleSetAccessCode(
    companyId,
    accessCode,
    callback
) {
    const [err, code] = await setAccessCode(companyId, accessCode)
    callback(err, code)
}
handleSetAccessCode.description = 'Check and create access code for a company. Ignore if access code already exists.'
handleSetAccessCode.requireLogin = ['admin']
handleSetAccessCode.params = [
    {
        ...defs.companyId,
        or: defs.regNum,
    },
    {
        accept: [true],
        defaultValue: true,
        name: 'generateCode',
        or: defs.accessCode,
        type: TYPES.boolean,
    },
    defs.callback
]
handleSetAccessCode.result = {
    descrption: '0: skipped (already exists), 1: generated, 2: save pre-specified access code',
    name: 'successCode',
    type: TYPES.boolean,
}
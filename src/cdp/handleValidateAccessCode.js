import { isFn } from '../utils/utils'
import { TYPES } from '../utils/validator'
import { dbCdpAccessCodes } from './couchdb'
import { accessCodeHashed, sanitiseAccessCode } from './utils'
import { defs, messages } from './validation'

export default async function handleValidateAccessCode(
    accessCode,
    companyId,
    registrationNumber,
    callback
) {
    if (!isFn(callback)) return

    accessCode = sanitiseAccessCode(accessCode)
    const entry = await dbCdpAccessCodes.get(companyId)
    if (!entry) return callback(messages.invalidCodeOrReg)

    const valid = entry.registrationNumber === registrationNumber
        && entry.accessCode === accessCodeHashed(accessCode, companyId)

    if (!valid) return callback(messages.invalidCodeOrReg)

    if (valid && !entry.tsFirstAccessed) {
        entry.stepIndex = 0
        entry.tsFirstAccessed = new Date().toISOString()
        await dbCdpAccessCodes.set(entry._id, entry)
    }
    const result = !entry?.cdp
        ? valid
        : entry
    callback(null, result)
}
handleValidateAccessCode.description = 'Authenticate user & allow access to read & update public and private company information.'
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
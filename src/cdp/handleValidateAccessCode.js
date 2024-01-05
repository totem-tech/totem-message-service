import { isFn } from '../utils/utils'
import { TYPES } from '../utils/validator'
import {
    defs,
    getCodeSanitised,
    messages,
    dbCdpAccessCodes
} from './common'

export default async function handleValidateAccessCode(
    accessCode,
    companyId,
    registrationNumber,
    callback
) {
    if (!isFn(callback)) return

    const entry = await dbCdpAccessCodes.find({
        accessCode: getCodeSanitised(accessCode),
        companyId,
        registrationNumber,
    })

    const valid = entry?.registrationNumber === registrationNumber
        && entry?.accessCode === accessCode

    if (valid && !entry.tsFirstAccessed) {
        entry.stepIndex = 0
        entry.tsFirstAccessed = new Date().toISOString()
        await dbCdpAccessCodes.set(entry._id, entry)
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
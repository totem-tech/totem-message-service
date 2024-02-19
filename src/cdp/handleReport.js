import { TYPES } from '../utils/validator'
import { dbCdpAccessCodes, dbCdpReports } from './couchdb'
import { accessCodeHashed, sanitiseAccessCode } from './utils'
import { defs, messages } from './validation'


export default async function handleReport(
    accessCode,
    registrationNumber,
    reasonCode = 0,
    remarks = '',
    callback
) {
    accessCode = sanitiseAccessCode(accessCode)
    const entry = await dbCdpAccessCodes.find({ registrationNumber })
    const invalid = !entry
        || entry.accessCode !== accessCodeHashed(accessCode, entry.companyId)
    if (invalid) return callback(messages.invalidCodeOrReg)

    await dbCdpReports.set(null, {
        companyId: entry.companyId,
        reasonCode,
        registrationNumber,
        remarks,
    })

    callback(null)
}
handleReport.params = [
    defs.accessCode,
    defs.regNum,
    {
        defaultValue: 0,
        label: 'reason',
        max: 50,
        min: 0,
        name: 'reasonCode',
        required: false,
        type: TYPES.number,
    },
    {
        defaultValue: '',
        maxLength: 500,
        name: 'remarks',
        required: false,
        type: TYPES.string,
    },
    defs.callback,
]
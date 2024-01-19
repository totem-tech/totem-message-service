import { TYPES } from '../utils/validator'
import {
    dbCdpAccessCodes,
    dbCdpReports,
    defs,
    getCodeSanitised,
    messages
} from './common'

export default async function handleReport(
    accessCode,
    registrationNumber,
    reasonCode = 0,
    remarks = '',
    callback
) {
    accessCode = getCodeSanitised(accessCode)
    const entry = await dbCdpAccessCodes.find({
        registrationNumber
    })
    if (!entry || entry.accessCode !== accessCode) return callback(messages.invalidCodeOrReg)

    await dbCdpReports.set('', {
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
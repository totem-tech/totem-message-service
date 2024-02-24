import { isObj, isStr, objClean } from '../utils/utils'
import { TYPES } from '../utils/validator'
import {
    dbCdpAccessCodes,
    dbCdpLog,
    dbCompanies,
} from './couchdb'
import { accessCodeHashed } from './utils'
import { defs, messages } from './validation'

const numSteps = 7 // maximum number of steps in the CDP form (excluding issue step)
const orSelectorDef = {
    description: 'When not in create mode',
    properties: [
        defs.accessCode,
        defs.companyId,
        defs.regNum,
    ],
    required: true,
    type: TYPES.object,
}
export default async function handleLogProgress(
    selector,
    stepIndex,
    stepName,
    callback
) {
    const {
        accessCode,
        companyId,
        registrationNumber
    } = !isObj(selector)
            ? { registrationNumber: selector }
            : selector || {}
    const findOrGet = (db, cid = companyId) => cid
        ? db.get(cid)
        : db.find({ registrationNumber })
    const company = await findOrGet(dbCompanies)
    if (!company) return callback(messages.invalidCompany, false)

    const entry = await findOrGet(dbCdpAccessCodes, company._id)
    const { accessCode: code } = entry || {}
    const codeValid = !code // uninivted user
        || accessCodeHashed(accessCode, companyId) === code
    codeValid && await dbCdpLog.set(null, {
        create: !entry.accessCode, // create a new access code
        registrationNumber: entry.registrationNumber,
        stepIndex,
        stepName,
        type: 'cdp-form-step',
    })
    callback(null, !!entry)
}
handleLogProgress.params = [
    {
        ...defs.regNum,
        or: orSelectorDef,
    },
    {
        accept: new Array(numSteps + 2) // +2 for create and access
            .fill(0)
            .map((_, i) => i - 2),
        description: 'Step index in the CDP form. For "create" and "access" pages use -2 & -1 respectively.',
        name: 'stepIndex',
        required: true,
        type: TYPES.number,
    },
    {
        description: 'Step path without "/" or step name (access/create)',
        name: 'stepName',
        required: true,
        type: TYPES.string
    },
    defs.callback,
]
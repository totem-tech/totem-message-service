import { strFill } from '../utils/utils'
import { TYPES } from '../utils/validator'
import { defs } from './validation'

export const calcValidityPeriod = async (accountRefMonth, companyId) => {
    let year = 2025 // ToDo: will have to rework this for renewals
    let month = accountRefMonth + 1
    const isDecember = month === 13
    if (isDecember) {
        // set first month of next year
        // this will set date to 2026-01-01T00:00
        // and after subtracting `1` below the date will be 2025-12-31T23:59:59
        month = 1
        year++
    }
    const dateStr = `${year}-${strFill(`${month}`, 2, '0')}`
    // set validity to the end of the month and 23:59:59 hours.
    const tsValidTo = new Date(new Date(dateStr) - 1).toISOString()
    return tsValidTo
}

export default async function handleCalcValidityPeriod(accountRefMonth, companyId, callback) {
    const tsValidTo = await calcValidityPeriod(accountRefMonth, companyId)

    callback(null, tsValidTo)
}
handleCalcValidityPeriod.params = [
    {
        max: 12,
        min: 1,
        name: 'accountRefMonth',
        required: true,
        type: TYPES.number,
    },
    defs.companyId,
    defs.callback,
]
handleCalcValidityPeriod.result = {
    name: 'tsValidTo',
    type: TYPES.date,
}
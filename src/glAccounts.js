import CouchDBStorage from './utils/CouchDBStorage'
import { isFn } from './utils/utils'
import { TYPES, validate, validateObj } from './utils/validator'

const fields = [
    'number',
    'name',
    'typeNr',
    'typeName',
    'categoryNr',
    'categoryName',
    'categoryGrpNr',
    'categoryGrpName',
    'groupNr',
    'groupName',
    'subGrpNr',
    'balanceType',
]
const glAccounts = new CouchDBStorage(null, 'gl-accounts', fields)

/**
 * @name    handleGlAccounts
 * @summary fetch Global Ledger accounts by account numbers
 * 
 * @param   {Array}     accountNumbers 
 * @param   {Function}  callback        callback arguments:
 *                                      - error         String: error message if any
 *                                      - glAccounts    Array
 */
export const handleGlAccounts = async (accountNumbers = [], callback) => {
    if (!isFn(callback)) return

    const err = validateObj(
        { accountNumbers },
        {
            accountNumbers: {
                min: 1,
                max: 9999,
                required: true,
                type: TYPES.number,
            }
        },
        true,
        true,
    )
    if (err) return callback(err)

    const selector = {
        number: { $in: accountNumbers }
    }
    return callback(null, await glAccounts.search(selector, 0, 0, false))
}
import CouchDBStorage from './utils/CouchDBStorage'
import { isFn } from './utils/utils'

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

export const handleGlAccounts = async (accountNumbers = [], callback) => {
    if (!isFn(callback)) return
    if (!accountNumbers.length) return callback(null, new Map())
    const selector = {
        number: { $in: accountNumbers }
    }
    return callback(null, await glAccounts.search(selector, 0, 0, false))
}
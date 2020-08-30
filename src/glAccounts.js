import CouchDBStorage from './CouchDBStorage'
import { isFn } from './utils/utils'

const glAccounts = new CouchDBStorage(null, 'gl-accounts')

export const handleGlAccounts = async (accountNumbers = [], callback) => {
    if (!isFn(callback)) return
    if (!accountNumbers.length) return callback(null, new Map())
    const selector = {
        number: { $in: accountNumbers }
    }
    const extraProps = {
        fields: [
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
    }

    return callback(null, await glAccounts.search(selector, false, false, false, 0, 0, false, extraProps))
}
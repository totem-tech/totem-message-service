import CouchDBStorage from '../utils/CouchDBStorage'
import { isArr, isFn } from '../utils/utils'
import { TYPES, validate } from '../utils/validator'

const kapexPayouts = new CouchDBStorage(null, 'kapex-payouts')

/**
 * @name    handleGetKapexPayout
 * @summary get KAPEX rewards for crowdloan & pledge rounds including referral rewards
 * 
 * @param   {Array|String}  addresses 
 * @param   {Function}      callback  args: 
 *                                    - error   String
 *                                    - payouts Map
 * 
 * @returns {Map}
 */
export async function handleGetKapexPayouts(addresses, callback) {
    if (!isArr(addresses)) addresses = [addresses]
    addresses = addresses.filter(Boolean)

    if (!isFn(callback)) return

    for (let address of addresses) {
        const err = validate(address, {
            required: true,
            type: TYPES.identity,
        })
        if (err) return callback(err)
    }

    const payouts = !addresses.length
        ? []
        : await kapexPayouts.getAll(
            addresses,
            true,
            100,
        )
    callback(null, payouts)

    return payouts
}
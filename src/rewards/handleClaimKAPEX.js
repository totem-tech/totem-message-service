import { setTexts } from '../language'
import { isAddress, isFn, isValidDate } from '../utils/utils'
import { TYPES, validateObj } from '../utils/validator'
import { dbRewards, getRewardId, rewardStatus, rewardTypes } from './rewards'

const endDate = process.env.KAPEX_CLAIM_END_DATE
const messages = setTexts({
    errInvalidIP: 'Invalid client IP address',
    errClaimInactive: 'Migration claim claim period has ended',
    errIneligible: 'You are not eligible to migrate your rewards!',
})

/**
 * @name    handleClaimKapex
 * @summary Handle claim requests to migrate Meccano testnet reward tokens to Kapex chain.
 * This is to simply mark that the user has completed the required tasks.
 * At the end of the claim period, all requests will be validated and checked for fradulent claims.
 * 
 * @param   {Boolea|Object} data            Use `null` to check if user is eligible to migrate rewards.
 * @param   {String}        data.identity   Substrate identity that completed the tasks and to distribute $KAPEX.
 * 
 * @param   {Function}  callback 
 */
export async function handleClaimKAPEX(data, callback) {
    if (!isFn(callback)) return

    const [client, user] = this
    const active = isValidDate(endDate) && new Date(endDate) > new Date()
    if (!active) return callback(messages.errClaimInactive)

    const isEligible = !!(await dbRewards.find({ userId: user._id }))
    if (data === false) return callback(null, isEligible)
    if (!isEligible) return callback(messages.errIneligible)

    const err = validateObj(data, handleClaimKAPEX.validationConf, true, true)
    if (!!err) return callback(err)
    const { identity } = data

    let {
        handshake: {
            address = '',
            headers: {
                host = '',
            } = {},
        } = {},
    } = client
    const clientIPAddress = address
        .match(/[0-9]|\./g)
        .join('')
    // Regex source: https://www.geeksforgeeks.org/how-to-validate-an-ip-address-using-regex/
    const regexIPAddress = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])$/
    const ipValid = regexIPAddress.test(clientIPAddress)
    if (!ipValid) return callback(messages.errInvalidIP)

    const rewardId = getRewardId(rewardTypes.meccanoToKapex, user._id)
    // user already submitted their claim
    if (await dbRewards.get(rewardId)) return callback(null)

    const rewardEntry = {
        clientIPAddress,
        clientHost: host,
        identity,
        status: rewardStatus.pending,
        type: rewardTypes.meccanoToKapex,
        userId: user._id,
    }
    // save entry
    await dbRewards.set(rewardId, rewardEntry)
    callback(null)
}
handleClaimKAPEX.requireLogin = true
handleClaimKAPEX.validationConf = {
    identity: {
        required: true,
        type: TYPES.address,
    },
}
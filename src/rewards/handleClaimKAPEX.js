import { setTexts } from "../language"
import { isAddress, isFn, isValidDate } from "../utils/utils"
import { dbRewards, getRewardId, rewardStatus, rewardTypes } from "./rewards"

const endDate = process.env.KAPEX_CLAIM_END_DATE
const messages = setTexts({
    errInvalidIP: 'Invalid client IP address',
    errClaimInactive: 'Migration claim claim period has ended',
    errInvalidIdentity: 'Reward identity is invalid',
})

/**
 * @name    handleClaimKapex
 * @summary Handle claim requests to migrate Meccano testnet reward tokens to Kapex chain.
 * This is to simply mark that the user has completed the required tasks.
 * At the end of the claim period, all requests will be validated and checked for fradulent claims.
 * 
 * @param   {String}    identity        Substrate identity that completed the tasks and to distribute $KAPEX.
 * @param   {Function}  callback 
 */
export async function handleClaimKAPEX(identity, callback) {
    const [client, user] = this
    const active = isValidDate(endDate) && new Date(endDate) > new Date()
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
    // const regexIPAddress = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])$/
    // const ipValid = regexIPAddress.test(clientIPAddress)
    // if (!ipValid) return callback(messages.errInvalidIP)
    if (!isFn(callback)) return
    if (!active) return callback(messages.errClaimInactive)
    if (!isAddress(identity)) return callback(messages.errInvalidIdentity)

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
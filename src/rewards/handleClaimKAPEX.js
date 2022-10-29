import { setTexts } from '../language'
import { isAddress, isFn, isObj, isValidDate } from '../utils/utils'
import { TYPES, validateObj } from '../utils/validator'
import { dbRewards, getRewardId, rewardStatus, rewardTypes } from './rewards'

const messages = setTexts({
    errAlreadySubmitted: 'You have already submitted your claim.',
    errEnded: 'Claim period has ended!',
    errInvalidIdentity: 'Please complete the claim process and submit again with your rewards identity.',
    errInvalidIP: 'Invalid IP address',
    errIneligible: 'You are not eligible to claim KAPEX.',
    errNotStarted: 'Claim period has not started yet!',
})
const endDateStr = process.env.KAPEX_CLAIM_END_DATE
const startDateStr = process.env.KAPEX_CLAIM_START_DATE
// only indenteded for use in testing environment
const validateIp = process.env.KAPEX_CLAIM_VALIDATE_IP !== '^-_NO_-^'
const endDate = isValidDate(endDateStr)
    ? new Date(endDateStr)
    : null
const startDate = isValidDate(startDateStr)
    ? new Date(startDateStr)
    : null
// Regex source: https://www.geeksforgeeks.org/how-to-validate-an-ip-address-using-regex/
const regexIPAddress = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])$/

/**
 * @name    handleClaimKapex
 * @summary Handle claim requests to migrate Meccano testnet reward tokens to Kapex chain.
 * This is to simply mark that the user has completed the required tasks.
 * At the end of the claim period, all requests will be validated and checked for fradulent claims.
 * 
 * @param   {Object|Boolean}    data            To check status user `true`
 * @param   {String}            data.identity   Substrate identity that completed the tasks and to distribute $KAPEX.
 * 
 * @param   {Function}  callback 
 */
export async function handleClaimKAPEX(data, callback) {
    if (!isFn(callback)) return

    const [client, user] = this
    const started = !!startDate
        && startDate < new Date()
    const ended = !!endDate
        && endDate > new Date()
    const active = started && ended
    // if request is not to check status then validate the data object

    let err = data !== true && validateObj(
        data,
        handleClaimKAPEX.validationConf,
        true,
        true,
    )
    if (!!err) return callback(err)

    const rewardId = getRewardId(rewardTypes.meccanoToKapex, user._id)
    const eligible = !!(await dbRewards.find({ userId: user._id }))
    const submitted = !!(await dbRewards.get(rewardId))
    err = submitted
        ? messages.errAlreadySubmitted
        : !active
            ? !started
                ? messages.errNotStarted
                : messages.ended
            : !eligible
                ? messages.errIneligible
                : null
    if (data === true) {
        // check status
        const status = {
            // whether claim is active
            active,
            // whether user is eligible to claim
            eligible,
            // claim end date
            endDate,
            // any relevant message
            error: err,
            // claim start date
            startDate,
            // indicates if user already submitted their claim
            submitted,
        }
        return callback(null, status)
    }

    if (!!err) return callback(err)

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
    const ipValid = regexIPAddress.test(clientIPAddress)
    if (validateIp && !ipValid) return callback(messages.errInvalidIP)

    const {
        rewardsIdentity,
        signature,
        tweetUrl,
        token,
    } = data
    const {
        address: _rewardsIdentity,
        _id: userId
    } = user
    // user manually submitted with a different identity
    if (rewardsIdentity !== _rewardsIdentity) return callback(messages.errInvalidIdentity)


    const rewardEntry = {
        clientIPAddress,
        clientHost: host,
        rewardsIdentity,
        signature,
        status: rewardStatus.pending,
        token,
        tweetId: tweetUrl.split('status/')[1].split('?')[0],
        tweetUrl,
        twitterHandle: tweetUrl.split('/')[3],
        type: rewardTypes.meccanoToKapex,
        userId,
    }
    // save entry
    await dbRewards.set(rewardId, rewardEntry)
    callback(null)
    console.log(new Date().toISOString(), '[handleClaimKAPEX]', user._id, data.token)
}
handleClaimKAPEX.requireLogin = true
handleClaimKAPEX.validationConf = {
    // the identity user completed the tasks with and to receive rewards
    rewardsIdentity: {
        required: true,
        type: TYPES.identity,
    },
    signature: {
        maxLength: 130,
        minLength: 130,
        required: true,
        type: TYPES.hex,
    },
    token: {
        required: false,
        type: TYPES.string,
    },
    tweetUrl: {
        maxLength: 100,
        minLength: 50,
        required: true,
        type: TYPES.url,
    },
}
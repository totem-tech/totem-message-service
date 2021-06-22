import { setTexts } from '../language'
import { generateHash, isFn } from '../utils/utils'
import { TYPES, validateObj } from '../utils/validator'
import { claimSignupTwitterReward } from './twitter'

const messages = setTexts({
    invalidRequest: 'Invalid request',
    rewardAlreadyClaimed: 'You have already claimed this reward'
})
const supportedPlatforms = [
    'twitter'
]
const validationConf = {
    handle: {
        minLength: 3,
        required: true,
        type: TYPES.string,
    },
    platform: {
        accept: supportedPlatforms,
        minLength: 3,
        required: true,
        type: TYPES.string,
    },
}

/**
 * @name    generateVerificationCode
 * @summary generates user's social media handle verification code
 * 
 * @param   {String} userId 
 * @param   {String} platform 
 * @param   {String} handle 
 * 
 * @returns {String} hex string
 */
export const generateVerificationCode = (userId, platform, handle) => generateHash(
    `${userId}:${platform}:${handle}`,
    'blake2',
    32,
)

/**
 * @name    handleGetVerificationCode
 * @summary returns an unique code for user to include in the Tweet to receive signup (Twitter post) rewards.
 * 
 * @param   {String}    handle user's Twitter handle
 * @param   {Function}  callback      
 */
export async function handleGetVerificationCode(platform, handle, callback) {
    if (!isFn(callback)) return

    const [_, user] = this
    const err = validateObj(
        { handle, platform },
        handleGetVerificationCode.validationConf,
        true,
        true,
    )
    if (!!err) return callback(err)

    const code = generateVerificationCode(user.id, platform, handle)
    callback(null, code)
}
handleGetVerificationCode.requireLogin = true
handleGetVerificationCode.validationConf = {
    ...validationConf,
}

export async function handleClaimReward(platform, handle, postId, callback) {
    if (!isFn(callback)) return

    const [_, user] = this
    const err = validateObj(
        { handle, platform, postId },
        validationConf,
        true,
        true,
    )
    if (!!err) return callback(err)

    switch (platform) {
        case 'twitter':
            const { socialHandles: sh } = user
            if (sh && !!(sh.twitter || {}).verified) return callback(messages.rewardAlreadyClaimed)

            await claimSignupTwitterReward(user.id, handle, postId)
            break
        default:
            callback(messages.invalidRequest)
    }

    // request has been added to queue. User will be notified once processed
    callback(null)
}
handleClaimReward.requireLogin = true
handleGetVerificationCode.validationConf = {
    ...validationConf,
    postId: {
        minLength: 3,
        required: true,
        type: TYPES.string,
    }
}
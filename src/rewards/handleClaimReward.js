import { setTexts } from '../language'
import { isFn } from '../utils/utils'
import { TYPES, validateObj } from '../utils/validator'
import { claimSignupTwitterReward } from './twitter'

const messages = setTexts({
    invalidRequest: 'Invalid request',
})
const debugTag = '[handleClaimReward]'
const supportedPlatforms = [
    'twitter'
]
const validationConf = {
    handle: {
        maxLength: 15,
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
    postId: {
        minLength: 3,
        required: true,
        type: TYPES.string,
    }
}

/**
 * @name    handleClaimReward
 * 
 * @param   {String}    platform 
 * @param   {String}    handle 
 * @param   {String}    postId 
 * @param   {Function}  callback 
 */
export async function handleClaimRewards(platform, handle, postId, callback) {
    if (!isFn(callback)) return

    const [_, user] = this
    let err = validateObj(
        { handle, platform, postId },
        validationConf,
        true,
        true,
    )
    if (!!err) return callback(err)

    switch (platform) {
        case 'twitter':
            err = await claimSignupTwitterReward(user.id, handle, postId)
            break
        default:
            err = messages.invalidRequest
    }
    // if err is falsy, request has been added to queue. User will be notified once processed
    callback(err || null)
}
handleClaimRewards.requireLogin = true
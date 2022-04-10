import { isFn } from '../utils/utils'
import { TYPES, validateObj } from '../utils/validator'
import { setTexts } from '../language'
import { claimSignupTwitterReward } from './twitter'
import { dbRewards, getRewardId, log, rewardStatus, rewardTypes } from './rewards'

const messages = setTexts({
    alreadyClaimed: 'You have already claimed this reward',
    inactive: 'Twitter rewards campaign has ended! Please stay tuned for rewards oppotunities in the future.',
    invalidRequest: 'Invalid request',
})
const active = process.env.SocialRewardsDisabled !== 'YES'
const debugTag = '[rewards][claim][twitter]'
const supportedPlatforms = [
    'twitter',
    'polkadot-decoded'
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
        maxLength: 19,
        minLength: 19,
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

    if (!active) return callback(messages.inactive)

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
            log(debugTag, user.id)
            err = await claimSignupTwitterReward(user.id, handle, postId)
            break
        case 'polkadot-decoded':
            const rewardId = getRewardId(rewardTypes.decoded2206, handle)
            // user already claimed reward
            err = await dbRewards.get(rewardId)
                || await dbRewards.find({
                    type: rewardTypes.decoded2206,
                    userId: user.id,
                })
                ? messages.alreadyClaimed
                : null
            if (err) break

            await dbRewards.set(rewardId, {
                amount: 108154,
                data: {
                    twitterHandle: handle,
                },
                status: rewardStatus.pending,
                type: rewardTypes.decoded2206,
                userId: user.id,
            })
            break
        default:
            err = messages.invalidRequest
    }
    // if err is falsy, request has been added to queue. User will be notified once processed
    callback(err || null)
}
handleClaimRewards.requireLogin = true
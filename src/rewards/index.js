import { rxUserRegistered } from "../users"
import { handleClaimRewards } from "./handleClaimReward"
import handleGetRewardsData from "./handleGetRewardsData"
import { getRewardId, hashAlgo, hashBitLength, log, payReferralReward, paySignupReward, rewardTypes } from "./rewards"
import { generateHash, isObj } from '../utils/utils'
import { sendNotification } from "../notification"

const debugTag = '[rewards]'
const signupActive = process.env.SignupRewardsDisabled !== 'YES'
const referralActive = process.env.ReferralRewardsDisabled !== 'YES'
// Listen for new user registrations and process referral and signup rewards
rxUserRegistered.subscribe(async ({ userId, referredBy }) => {
    try {
        referredBy = isObj(referredBy)
            ? referredBy.userId
            : referredBy

        if (!referralActive && !!referredBy) {
            // send referral notification
            const rewardId = getRewardId(rewardTypes.referral, userId)
            await sendNotification(
                userId,
                [referredBy],
                'rewards',
                'referralSuccess',
                null,
                {},
                generateHash(rewardId, hashAlgo, hashBitLength),
            ).catch(err => log(debugTag, 'Referral notification failed', err))
        }

        if (!signupActive && !referralActive) return

        log(debugTag, 'Initiating post-registration payouts', { userId, referredBy })
        // pay signup reward to the user
        let err = signupActive && await paySignupReward(userId)
        if (err) log(debugTag, 'Signup reward payment failed: ', err)

        // pay referral reward (if any)
        if (!referredBy) return

        err = referralActive && await payReferralReward(referredBy, userId)
        if (err) log(debugTag, 'Referral reward payment failed: ', err)

    } catch (err) {
        // ToDo: report incident
        log(debugTag, 'Error occured while executing reward payouts.', err)
    }
})

export default {
    'rewards-claim': handleClaimRewards,
    'rewards-get-data': handleGetRewardsData,
}
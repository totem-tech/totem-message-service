import { rxUserRegistered } from "../users"
import { handleClaimRewards } from "./handleClaimReward"
import handleGetRewardsData from "./handleGetRewardsData"
import { log, payReferralReward, paySignupReward } from "./rewards"
import { isObj } from '../utils/utils'

const debugTag = '[rewards]'
// Listen for new user registrations and process referral and signup rewards
rxUserRegistered.subscribe(async ({ address, userId, referredBy }) => {
    try {
        referredBy = isObj(referredBy)
            ? referredBy.userId
            : referredBy
        log(debugTag, 'Initiating post-registration payouts', { userId, referredBy })
        // pay signup reward to the user
        let err = await paySignupReward(userId, address)
        if (err) log(debugTag, 'Signup reward payment faild: ', err)

        // pay referral reward (if any)
        if (!referredBy) return

        err = await payReferralReward(referredBy, userId)
        if (err) log(debugTag, 'Referral reward payment faild: ', err)

    } catch (err) {
        // ToDo: report incident
        log(debugTag, 'Error occured while executing reward payouts.', err)
    }
})

export default {
    'rewards-claim': handleClaimRewards,
    'rewards-get-data': handleGetRewardsData,
}
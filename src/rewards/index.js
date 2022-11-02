
import handleGetRewardsData from "./handleGetRewardsData"
import { handleClaimKAPEX } from "./handleClaimKAPEX"
import './onRegistration'

export default {
    // 'rewards-claim': handleClaimRewards,
    'rewards-claim-kapex': handleClaimKAPEX,
    'rewards-get-data': handleGetRewardsData,
}
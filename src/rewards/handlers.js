import { handleClaimRewards } from "./handleClaimReward";
import handleGetRewardsData from "./handleGetRewardsData";

// makes sure rewards is buddled
require('./index') // DO NOT REMOVE

export default {
    'rewards-claim': handleClaimRewards,
    'rewards-get-data': handleGetRewardsData,
}
import { users } from "../users"
import { isFn } from "../utils/utils"
import { dbRewards } from "./rewards"

async function handleGetRewardsData(callback) {
    if (!isFn(callback)) return


    const [_, user] = this
    const limit = 999
    const selector = { userId: user.id }
    const extraProps = {
        // fields: [
        //     '_id',
        //     'amount',
        //     'status',
        //     'tsCreated',
        //     'txId',
        //     'txHash',
        //     'type',
        // ]
    }
    const rewards = await dbRewards.search(selector, limit, 0, false, extraProps)
    callback(null, rewards)
}
handleGetRewardsData.requireLogin = true
export default handleGetRewardsData
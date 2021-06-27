import { users } from "../users"
import { isFn } from "../utils/utils"

async function handleGetRewardsData(callback) {
    if (!isFn(callback)) return

    const [_, user] = this
    const { rewards } = await users.get(user._id, ['rewards'])
    callback(null, rewards)
}
handleGetRewardsData.requireLogin = true
export default handleGetRewardsData
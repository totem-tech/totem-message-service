// Calculate crowdloan referral rewards
import DataStorage from '../../src/utils/DataStorage'
import { isObj, isValidNumber } from '../../src/utils/utils'
import { addressToStr } from '../../src/utils/convert'
import usersResult, { execute as exportdb } from '../export-db'

const execute = async () => {
    const fileNameContributions = process.env.FILENAME_CONTRIBUTIONS
    if (!fileNameContributions) throw new Error('Missing env variable "FILENAME_CONTRIBUTIONS"')

    // import JSON file with crowdloan contributions including ParallelFi users
    const contributions = new DataStorage(fileNameContributions).getAll()

    // import crowdloan database collection data into a JSON file
    const crowdloanStorage = await exportdb('crowdloan', 'temp-crowdloan.json', 99999999, 0)
    const addressUsers = new Map(
        Array
            .from(crowdloanStorage.getAll())
            .map(([address, { userId }]) => [
                addressToStr(address, false, 0), // convert address format from Substrate to Polkadot
                userId,
            ])
    )
    const userAddresses = new Map(
        Array
            .from(addressUsers)
            .map(([address, userId]) => [userId, address])
    )

    const usersMap = new Map(
        Array
            .from((await usersResult).getAll())
            .map(([userId, { referredBy }]) => [
                userId,
                isObj(referredBy)
                    ? referredBy.userId
                    : referredBy,
            ])
    )

    const referrerBonuses = new Map()
    const referralEntries = Array
        .from(contributions)
        .map(([address, { amount = 0, parallel = 0 }]) => {
            const userId = addressUsers.get(address)
            const referredBy = usersMap.get(userId)
            const referredByAddress = userAddresses.get(referredBy)
            // bonus earned as a referee
            const bonusPercentage = parallel > 0 ? 0.1 : 0.05
            const baseRewardPerDOT = 0.1
            const refereeBonus = !referredByAddress && !parallel
                ? 0
                : amount * baseRewardPerDOT * bonusPercentage

            // if user is referred store their referrer's amount
            !!referredByAddress && !parallel && referrerBonuses.set(
                referredByAddress,
                (referrerBonuses.get(referredByAddress) || 0) + refereeBonus,
            )

            return [
                address,
                {
                    address,
                    amount_contributed: amount,
                    amount_contributed_using_parallelfi: parallel,
                    userId,
                    referred_by: referredBy,
                    referred_by_address: referredByAddress,
                    referee_bonus: refereeBonus || 0,
                    referrer_bonus: 0,
                    referral_bonus_total: 0,
                }
            ]
        })
        .filter(([_, x]) => x.userId || x.amount_contributed_using_parallelfi > 0)
    let sum = 0;
    // include sum of referrer bonuses
    referralEntries.forEach(([_, entry]) => {
        const { referee_bonus } = entry
        const referrer_bonus = referrerBonuses.get(entry.address) || 0
        const totalBonus = referrer_bonus + referee_bonus
        entry.referrer_bonus = referrer_bonus
        entry.referral_bonus_total = totalBonus
        sum += totalBonus
        if (!isValidNumber(sum)) console.log({
            address: entry.address,
            sum,
            referrer_bonus,
            referee_bonus,
            totalBonus,
        })
    })
    const storage = new DataStorage('temp-referral-rewards.json')
    storage.setAll(new Map(referralEntries))

    console.log('Total referral bonus: ', sum)
    return storage
}

export default execute()
import DataStorage from '../../src/utils/DataStorage'
import { arrUnique, isObj } from '../../src/utils/utils'
import exportDb from './exportdb'

const filename = process.env.FILENAME
const usersStats = async (storage) => {
    const addresses = new Map()
    const userIds = new Map()
    const referrers = new Map()
    storage = storage || new DataStorage(filename)
    storage
        .toArray()
        .forEach(([userId, value]) => {
            const { address, referredBy } = value
            userId && userIds.set(userId, true)
            address && addresses.set(address, [...addresses.get(address) || [], userId])

            const referrer = isObj(referredBy)
                ? referredBy.userId
                : referredBy
            if (!referrer) return
            referrers.set(referrer, [...referrers.get(referrer) || [], userId])
        })
    const arrAddressAbusers = arrUnique(
        Array.from(addresses)
            .filter(([_, userIds]) => userIds.length > 1)
            .map(([_, userIds]) => userIds)
    )
    const referredByAbusers = arrUnique(
        arrAddressAbusers
            .map(userId => referrers.get(userId))
    )
    console.log('usersStats', {
        filename: storage.name,
        total: storage.getAll().size,
        userIds: userIds.size,
        addresses: addresses.size,
        totalReferrers: referrers.size,
        totalReferred: Array
            .from(referrers)
            .map(([_, userIds]) => userIds)
            .flat()
            .length,
        addressAbusers: arrAddressAbusers.length,
        referredByAbusers: referredByAbusers.length,
    })

    return storage
}

export default exportDb.then(usersStats)
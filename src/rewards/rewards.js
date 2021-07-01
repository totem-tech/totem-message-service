import { emitToFaucetServer } from '../faucetRequests'
import { sendNotification } from '../notification'
import { RESERVED_IDS, users } from '../users'
import { arrSort, generateHash, isObj } from '../utils/utils'
import CouchDBStorage from '../utils/CouchDBStorage'
import { setTexts } from '../language'
import './discord'

const texts = setTexts({
    signupRewardMsg: `
        Some funds to get you started will arrive shortly.
        Keep in eye on the identities module.
        Have fun using Totem Live and don't forget to join us on our social media channels! :)
    `
})
// existing faucet requests to retreive user's address if users db doesn't already have it
const dbFaucetRequests = new CouchDBStorage(null, 'faucet-requests')
export const dbRewards = new CouchDBStorage(null, 'rewards')
const notificationSenderId = 'rewards'
const isDebug = `${process.env.Debug}`.toLowerCase() === 'true'
const timeout = 120000
const debugTag = '[rewards]'
const hashAlgo = 'blake2'
const hashBitLength = 256
const initialRewardAmount = 108154 // only used where amount has not been saved (initial drop)
export const log = (...args) => isDebug && console.log(...args)
export const rewardStatus = {
    error: 'error', // payment failed
    pending: 'pending', // payment is yet to be processed
    processing: 'processing', // payment is being processed
    success: 'success', // payment was successful
}
export const rewardTypes = {
    referral: 'referral-reward',
    referralTwitter: 'referral-twitter-reward',
    signup: 'signup-reward',
    signupTwitter: 'signup-twitter-reward',
}

// const ProcessMissedPayouts = process.env.ProcessMissedPayouts === 'YES'
// ProcessMissedPayouts && setTimeout(() => processMissedPayouts(), 2000)
// /**
//  * @name    processMissedPayouts
//  * @summary process payout for existing users who missed payout or signed up before reward payouts were activated
//  */
// const processMissedPayouts = async (skip = 0) => {
//     const _debugTag = `${debugTag} [processMissedPayouts]`
//     const limit = 100
//     const selector = {
//         // 'rewards.signupReward.status': {
//         //     $in: [
//         //         rewardStatus.error,
//         //         rewardStatus.pending,
//         //         rewardStatus.processing,
//         //     ]
//         // }
//     }
//     // make sure to retrieve 'rewards' fields along with default fields
//     const extraProps = {
//         fields: []
//     }
//     const result = await users.search(selector, limit, skip, false, extraProps)
//     const payoutUsers = result.filter(user =>
//         !Object.keys(user.rewards || {}).length
//         && !RESERVED_IDS.includes(user._id)
//     )

//     console.log({ payoutUsers })

//     for (let i = 0; i < payoutUsers.length; i++) {
//         let { _id: userId, referredBy } = payoutUsers[i] || {}

//         // log(_debugTag, 'Processing missing signup payout:', userId)
//         let error = await paySignupReward(userId)
//         if (error && !error.includes('No address'))
//             log(_debugTag, 'Signup reward payment failed', { userId, error })

//         referredBy = isObj(referredBy)
//             ? referredBy.userId
//             : referredBy
//         if (!referredBy) continue

//         // console.log(_debugTag, 'Processing missing referral payout:', userId)
//         error = await payReferralReward(referredBy, userId)
//         if (error && !error.includes('No address'))
//             log(_debugTag, 'Referral reward payment failed', { userId, referredBy, error })
//     }

//     if (result.length < limit) return
//     await processMissedPayouts(skip + limit)
// }

export const getLastestFaucetAddress = async (userId) => {
    // retrieve referrer's  address from deprecated faucet requests
    const { requests = [] } = await dbFaucetRequests.get(userId) || {}
    const { address } = requests.pop() || {}
    return address
}

export const getRewardId = (rewardType, uniqueData) => generateHash(
    `${rewardType}-${uniqueData}`,
    hashAlgo,
    hashBitLength,
)

/**
 * @name    referralPayout
 * @summary triggers signup payout
 * 
 * @param   {String} referrerUserId 
 * @param   {String} referredUserId
 */
export const payReferralReward = async (referrerUserId, referredUserId) => {
    const _debugTag = `${debugTag} [ReferralPayout]`
    const rewardType = rewardTypes.referral
    const rewardId = getRewardId(rewardType, referredUserId)
    // retrieve referrer's address
    let user = await users.get(referrerUserId, ['_id', 'address', 'rewards'])
    if (!user) return 'User not found'

    let { address } = user
    if (!address) {
        address = await getLastestFaucetAddress(referrerUserId)
        // update user document with latest faucet request address
        if (!!address) await users.set(referrerUserId, { ...user, address })
        if (!address) return 'Could not initiate payout. No address found for user'
    }

    const rewardEntry = (await dbRewards.get(rewardId)) || {
        amount: null,
        data: { referredUserId },
        notification: false,
        status: rewardStatus.pending,
        tsCreated: null,
        tsUpdated: null,
        txHash: null,
        txId: null,
        type: rewardTypes.referral,
        userId: referrerUserId,
    }
    // Save/update reward entry
    const saveEntry = async (save = true, notify = false) => {
        if (save) await dbRewards.set(rewardId, rewardEntry)
        if (!notify || rewardEntry.notification === true) return

        log(_debugTag, 'Sending notification to user', referrerUserId)
        const err = await sendNotification(
            referredUserId,
            [referrerUserId],
            'rewards',
            'referralSuccess',
            null,
            {
                rewardId,
                status: rewardEntry.status,
            },
            generateHash(rewardId, hashAlgo, hashBitLength),
        )
        rewardEntry.notification = err || true
        const msg = `notifcation to ${referrerUserId} ${!err ? 'successful' : 'failed'}`
        log(_debugTag, msg, err)
        await dbRewards.set(rewardId, rewardEntry)
    }

    // user has already been rewarded
    if (rewardEntry.status === rewardStatus.success) {
        await saveEntry(false, true)
        log(_debugTag, 'payout was already successful', { referrerId: referrerUserId, referreeId: referredUserId })
        return
    }

    log(_debugTag, `${referrerUserId} referred ${referredUserId}`)

    rewardEntry.status = rewardStatus.processing
    await saveEntry()

    try {
        log(_debugTag, `Sending payout request to faucet server for ${referrerUserId}`)
        const [err, data] = await emitToFaucetServer(
            'reward-payment',
            {
                address,
                rewardId,
                rewardType: 'referral-reward',
            },
            timeout
        )
        const { amount, txId, txHash } = data || {}

        rewardEntry.amount = amount
        rewardEntry.status = !!err
            ? rewardStatus.error
            : rewardStatus.success
        rewardEntry.error = err || undefined
        rewardEntry.txId = txId
        rewardEntry.txHash = txHash
    } catch (faucetServerError) {
        log(_debugTag, 'payout faucet request failed with error', faucetServerError)
        rewardEntry.status = rewardStatus.error
        rewardEntry.error = err
    }
    await saveEntry(true, true)
    return rewardEntry.error
}

/**
 * @name    signupPayout
 * @summary triggers signup payout
 * 
 * @param   {String} userId
 */
export const paySignupReward = async (userId) => {
    const _debugTag = `${debugTag} [SignupPayout]`
    const rewardType = rewardTypes.signup
    const rewardId = getRewardId(rewardType, userId)

    const user = await users.get(userId)
    if (!user) return 'User not found'

    user.address = user.address || await getLastestFaucetAddress(userId)
    if (!user.address) return 'Could not initiate payout. No address found for user'

    const { address } = user
    const rewardEntry = (await dbRewards.get(rewardId)) || {
        amount: null,
        notification: false,
        status: rewardStatus.pending,
        tsCreated: null,
        tsUpdated: null,
        txHash: null,
        txId: null,
        type: rewardTypes.signup,
        userId: userId,
    }

    const saveEntry = async (save = true, notify = false) => {
        if (save) await dbRewards.set(rewardId, rewardEntry)
        if (!notify || rewardEntry.notification === true) return

        // notify user
        log(_debugTag, `Sending notification to user ${userId}`)
        const err = await sendNotification(
            notificationSenderId,
            [userId],
            'rewards',
            'signupReward',
            texts.signupRewardMsg,
            {
                rewardId,
                status: rewardEntry.status,
            },
            generateHash(rewardId, hashAlgo, hashBitLength),
        )
        rewardEntry.notification = !err
            ? true
            : err
        log(_debugTag, `notifcation to ${userId} ${!err ? 'successful' : 'failed'}`, err || '')
        await dbRewards.set(rewardId, rewardEntry)
    }
    // user has already been rewarded
    if (rewardEntry.status === 'success') {
        await saveEntry(false, true)
        log(_debugTag, `payout was already successful for ${userId}`)
        return
    }

    log(_debugTag, userId)
    rewardEntry.status = rewardStatus.processing
    await saveEntry()

    try {
        log(_debugTag, `Sending payout request to faucet server for ${userId}`)
        const [err, data] = await emitToFaucetServer(
            'reward-payment',
            {
                address,
                rewardId,
                rewardType,
            },
            timeout,
        )
        const { amount, txId, txHash } = data || {}
        rewardEntry.status = !!err
            ? rewardStatus.error
            : 'success'
        rewardEntry.amount = amount
        rewardEntry.error = err || undefined
        rewardEntry.txId = txId
        rewardEntry.txHash = txHash

    } catch (faucetServerError) {
        log(debugTag, { event: 'signup-reward', faucetServerError })
        rewardEntry.status = rewardStatus.error
        rewardEntry.error = faucetServerError
    }
    await saveEntry(true, true)

    return rewardEntry.error
}

// migrate old reward entries from "users" collection to "rewards" collection
const migrateOldRewards = async () => {
    const selector = { rewards: { $gt: null } }
    const userEntries = await users.search(selector, 999, 0, false, { fields: [] })
    const rewardEntries = new Map()
    for (let user of userEntries) {
        const { _id: userId, rewards = {} } = user
        const { signupReward, referralRewards = {} } = rewards
        if (!!signupReward && !!signupReward.status) {
            const rewardId = getRewardId(rewardTypes.signup, userId)
            rewardEntries.set(rewardId, {
                ...signupReward,
                amount: signupReward.amount || initialRewardAmount,
                userId,
                type: rewardTypes.signup,
            })
        }

        const referredUserIds = Object.keys(referralRewards)
        for (let referredUserId of referredUserIds) {
            const entry = referralRewards[referredUserId]
            if (!Object.keys(entry).length) continue
            const rewardId = getRewardId(rewardTypes.referral, referredUserId)
            rewardEntries.set(rewardId, {
                ...entry,
                amount: entry.amount || initialRewardAmount,
                userId,
                data: { referredUserId },
                type: rewardTypes.referral,
            })
        }
        delete user.rewards
    }

    if (userEntries.length === 0) return

    console.log(`Migrating ${rewardEntries.size} reward entries from "users" to "rewards" collection`)
    await dbRewards.setAll(rewardEntries, true, 99999, false)
    await users.setAll(userEntries)
    console.log(`Migrated ${rewardEntries.size} reward entries from "users" to "rewards" collection`)
}

const processUnsuccessfulRewards = async () => {
    const selector = {
        status: { $ne: 'success' },
        type: {
            $in: [
                rewardTypes.signup,
                rewardTypes.referral,
            ]
        }
    }
    const rewardEntries = await dbRewards.search(selector, 9999, 0, false)
    if (rewardEntries.length === 0) return

    console.log(`Processing incomplete signup & referral rewards ${rewardEntries.length}`)

    let failCount = 0
    for (let entry of rewardEntries) {
        const { data = {}, type, userId } = entry
        const { referredUserId } = data
        try {

            switch (type) {
                case rewardTypes.referral:
                    await payReferralReward(userId, referredUserId)
                    break
                case rewardTypes.signup:
                    await paySignupReward(userId)
                    break
            }
        } catch (err) {
            failCount++
        }
    }

    console.log('Processed incomplete signup & referral rewards', {
        total: rewardEntries.length,
        error: failCount,
        success: rewardEntries.length - failCount
    })
}
setTimeout(async () => {
    // create an index for the field `userId`, ignores if already exists
    const indexDefs = [{
        index: { fields: ['userId'] },
        name: 'userId-index',
    }]
    indexDefs.forEach(async (def) =>
        await (
            await dbRewards.getDB()
        ).createIndex(def)
    )

})

setTimeout(() => {
    migrateOldRewards()
        .catch(err => console.log(debugTag, 'Failed to migrate old reward entries', err))
    processUnsuccessfulRewards()
        .catch(err => console.log(debugTag, 'Failed to process incomplete signup & referral rewards', err))
}, 3000)
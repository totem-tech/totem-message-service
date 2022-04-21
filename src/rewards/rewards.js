import { emitToFaucetServer, rewardsPaymentPaused, waitTillFSConnected } from '../faucetRequests'
import { sendNotification } from '../notification'
import { emitToUsers, getSupportUsers, ROLE_SUPPORT, users } from '../users'
import { generateHash } from '../utils/utils'
import CouchDBStorage from '../utils/CouchDBStorage'
import { setTexts } from '../language'
import { handleMessage } from '../messages'
import PromisE from '../utils/PromisE'

const texts = setTexts({
    signupRewardMsg: `
        Some funds to get you started will arrive shortly.
        Keep in eye on the identities module.
        Have fun using Totem Live and don't forget to join us on our social media channels! :)
    `
})
// existing faucet requests to retreive user's address if users db doesn't already have it
const dbFaucetRequests = new CouchDBStorage(null, 'faucet_requests')
export const dbRewards = new CouchDBStorage(null, 'rewards')
const notificationSenderId = 'rewards'
const reprocessFailedRewards = (process.env.ReprocessRewards || '').toLowerCase() === 'yes'
const reprocessBatchLimit = parseInt(process.env.ReprocessBatchLimit) || 100
const debugTag = '[rewards]'
const hashAlgo = 'blake2'
const hashBitLength = 256
const initialRewardAmount = 108154 // only used where amount has not been saved (initial drop)
export const log = (...args) => console.log(new Date().toISOString(), debugTag, ...args)
export const rewardStatus = {
    error: 'error', // payment failed
    ignore: 'ignore',
    pending: 'pending', // payment is yet to be processed
    processing: 'processing', // payment is being processed
    success: 'success', // payment was successful
    todo: 'todo',
}
export const rewardTypes = {
    decoded2206: 'decoded2206', // vote for Polkadot Decoded talk and follow founders
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
//     const _debugTag = `[processMissedPayouts]`
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

const saveWithError = async (rewardEntry = {}, error, status = rewardStatus.error) => {
    if (!!rewardEntry._id) {
        rewardEntry.status = status
        rewardEntry.error = error
        await dbRewards.set(rewardEntry._id, rewardEntry)
    }
    return error
}

/**
 * @name    referralPayout
 * @summary triggers signup payout
 * 
 * @param   {String} referrerUserId 
 * @param   {String} referredUserId
 */
export const payReferralReward = async (referrerUserId, referredUserId, deferPayment = rewardsPaymentPaused) => {
    const _debugTag = `[ReferralPayout]`
    const rewardType = rewardTypes.referral
    const rewardId = getRewardId(rewardType, referredUserId)
    // retrieve referrer's address
    let user = await users.get(referrerUserId, ['_id', 'address', 'rewards'])
    let rewardEntry = (await dbRewards.get(rewardId)) || {}
    if (!user) return await saveWithError(
        rewardEntry,
        'User not found',
        rewardStatus.ignore,
    )

    let { address } = user
    if (!address) {
        address = await getLastestFaucetAddress(referrerUserId)
        // update user document with latest faucet request address
        if (!!address) await users.set(referrerUserId, { ...user, address })
        if (!address) return await saveWithError(
            rewardEntry,
            'Could not initiate payout. No address found for user',
            rewardStatus.ignore,
        )
    }

    rewardEntry = {
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
        ...rewardEntry,
    }
    // Save/update reward entry
    const saveEntry = async (save = true, notify = false) => {
        if (save) {
            if (rewardEntry.status !== rewardStatus.error) rewardEntry.error = null
            await dbRewards.set(rewardId, rewardEntry)
        }
        if (!notify) return

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

    // const addressUsers = await users.search({ address }, 2, 0, false)
    // if (addressUsers.length > 1) return await saveWithError(
    //     rewardEntry,
    //     'Identity used by more than user',
    //     rewardStatus.ignore,
    // )

    rewardEntry.status = deferPayment
        ? rewardEntry.pending
        : rewardStatus.processing
    await saveEntry()
    if (deferPayment) return log(_debugTag, `Deferring payment for ${referrerUserId}`)

    try {
        await waitTillFSConnected(undefined, `${_debugTag}`)
        log(_debugTag, `Sending payout request to faucet server for ${referrerUserId}`)
        const [err, data] = await emitToFaucetServer(
            'reward-payment',
            {
                address,
                rewardId,
                rewardType: 'referral-reward',
            },
        )
        const { amount, status, txId, txHash } = data || {}
        rewardEntry.amount = amount
        rewardEntry.error = err || undefined
        rewardEntry.status = !!err
            ? rewardStatus.error
            : status === rewardStatus.todo
                ? rewardStatus.todo
                : rewardStatus.success
        rewardEntry.txId = txId
        rewardEntry.txHash = txHash
    } catch (faucetServerError) {
        log(_debugTag, 'payout faucet request failed with error', faucetServerError)
        rewardEntry.status = rewardStatus.error
        rewardEntry.error = `[FaucetError] ${faucetServerError}`
    }
    await saveEntry(true, true)
    return rewardEntry.error
}

/**
 * @name    signupPayout
 * @summary triggers signup payout
 * 
 * @param   {String} userId
 * @param   {String} _rewardId (only used when dealing with legacy rewardIds)
 */
export const paySignupReward = async (userId, _rewardId, deferPayment = true) => {
    const _debugTag = `[SignupPayout]`
    const rewardType = rewardTypes.signup
    const rewardId = _rewardId || getRewardId(rewardType, userId)
    let rewardEntry = (await dbRewards.get(rewardId)) || {}
    const user = await users.get(userId)
    if (!user) return await saveWithError(
        rewardEntry,
        'User not found',
        rewardStatus.ignore,
    )

    user.address = user.address || await getLastestFaucetAddress(userId)
    if (!user.address) return saveWithError(
        rewardEntry,
        'Could not initiate payout. No address found for user',
        rewardStatus.ignore,
    )

    const { address } = user
    rewardEntry = {
        amount: null,
        notification: false,
        status: rewardStatus.pending,
        tsCreated: null,
        tsUpdated: null,
        txHash: null,
        txId: null,
        type: rewardTypes.signup,
        userId,
        ...rewardEntry
    }

    const saveEntry = async (save = true, notify = false) => {
        // log({ rewardEntry, notify })
        if (save) {
            if (rewardEntry.status !== rewardStatus.error) rewardEntry.error = null
            await dbRewards.set(rewardId, rewardEntry)
        }
        if (rewardEntry.notification || !notify) return
        setTimeout(async () => {
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
        }, 100)

    }

    // user has already been rewarded
    if (rewardEntry.status === rewardStatus.success && !rewardEntry.notification) {
        log('already paid', { rewardEntry })
        await saveEntry(false, true)
        log(_debugTag, `payout was already successful for ${userId}`)
        return
    }

    // const addressUsers = await users.search({ address }, 2, 0, false)
    // if (addressUsers.length > 1) return await saveWithError(
    //     rewardEntry,
    //     'Identity used by more than user',
    //     rewardStatus.ignore,
    // )

    rewardEntry.status = deferPayment
        ? rewardEntry.pending
        : rewardStatus.processing
    await saveEntry()
    if (deferPayment) return log(_debugTag, `Deferring payment for ${userId}`)

    try {
        // make sure faucet server is connected
        await waitTillFSConnected(undefined, `${debugTag} [payReward]`)
        log(_debugTag, `Sending payout request to faucet server for ${userId}`)
        const [err, data] = await emitToFaucetServer(
            'reward-payment',
            {
                address,
                rewardId,
                rewardType,
            },
        )
        const { amount, status, txId, txHash } = data || {}
        rewardEntry.status = !!err
            ? rewardStatus.error
            : status === rewardStatus.todo
                ? rewardStatus.todo
                : rewardStatus.success
        rewardEntry.amount = amount
        rewardEntry.error = err || undefined
        rewardEntry.txId = txId
        rewardEntry.txHash = txHash
    } catch (faucetServerError) {
        rewardEntry.status = rewardStatus.error
        rewardEntry.error = `[FaucetError] ${faucetServerError}`
        log(_debugTag, '[FaucetError]', { event: 'signup-reward', faucetServerError })
    }
    await saveEntry(true, rewardEntry.status === rewardStatus.success)

    return rewardEntry.error
}

// migrate old reward entries from "users" collection to "rewards" collection
// const migrateOldRewards = async () => {
//     const selector = { rewards: { $gt: null } }
//     const userEntries = await users.search(selector, 999, 0, false, { fields: [] })
//     const rewardEntries = new Map()
//     for (let user of userEntries) {
//         const { _id: userId, rewards = {} } = user
//         const { signupReward, referralRewards = {} } = rewards
//         if (!!signupReward && !!signupReward.status) {
//             const rewardId = getRewardId(rewardTypes.signup, userId)
//             rewardEntries.set(rewardId, {
//                 ...signupReward,
//                 amount: signupReward.amount || initialRewardAmount,
//                 userId,
//                 type: rewardTypes.signup,
//             })
//         }

//         const referredUserIds = Object.keys(referralRewards)
//         for (let referredUserId of referredUserIds) {
//             const entry = referralRewards[referredUserId]
//             if (!Object.keys(entry).length) continue
//             const rewardId = getRewardId(rewardTypes.referral, referredUserId)
//             rewardEntries.set(rewardId, {
//                 ...entry,
//                 amount: entry.amount || initialRewardAmount,
//                 userId,
//                 data: { referredUserId },
//                 type: rewardTypes.referral,
//             })
//         }
//         delete user.rewards
//     }

//     if (userEntries.length === 0) return

//     log(`Migrating ${rewardEntries.size} reward entries from "users" to "rewards" collection`)
//     await dbRewards.setAll(rewardEntries, true, 99999, false)
//     await users.setAll(userEntries)
//     log(`Migrated ${rewardEntries.size} reward entries from "users" to "rewards" collection`)
// }

const processUnsuccessfulRewards = async () => {
    let failCount = 0
    let successCount = 0
    let total = 0
    let lastTsCreated

    const execute = async () => {
        const selector = {
            status: {
                $in: [
                    reprocessFailedRewards && rewardStatus.error,
                    reprocessFailedRewards && rewardStatus.processing,
                    // reprocessFailedRewards && rewardStatus.todo,
                    rewardStatus.pending,
                ].filter(Boolean)
            },
            tsCreated: { $gt: lastTsCreated },
            type: {
                $in: [
                    rewardTypes.signup,
                    rewardTypes.referral,
                ]
            },
        }
        if (!lastTsCreated) delete selector.tsCreated

        const rewardEntries = await dbRewards.search(
            selector,
            reprocessBatchLimit,
            0,
            false,
            {
                sort: ['tsCreated'],
            },
            60000,
        )
        log(debugTag, {
            reprocessFailedRewards: selector.status.$in,
            rewardEntries: rewardEntries.length,
        })
        if (rewardEntries.length === 0) return 0
        log(
            debugTag,
            `Pending${reprocessFailedRewards ? ' & error' : ''} signup & referral`,
            `reward entries: ${rewardEntries.length}`,
        )
        total += rewardEntries.length
        let tag
        await Promise.all(
            rewardEntries.map(async (entry) => {
                const { _id, data = {}, tsCreated, type, userId } = entry
                lastTsCreated = tsCreated
                const { referredUserId } = data
                const typeTag = type === rewardTypes.signup
                    ? 'SignupPayout'
                    : 'ReferralPayout'
                tag = `[${typeTag}]`
                log(debugTag, `${tag} Processing`, _id)
                try {
                    let error
                    switch (type) {
                        case rewardTypes.referral:
                            error = await payReferralReward(userId, referredUserId, false)
                                .catch(err => err.message)
                            break
                        case rewardTypes.signup:
                            error = await paySignupReward(userId, _id, false)
                                .catch(err => err.message)
                            break
                        default:
                            error = 'Unsupported type'
                            break
                    }
                    if (error) throw new Error(error)
                    successCount++
                    // process.exit(0)
                } catch (err) {
                    log(debugTag, `${tag}[UnsuccessfulRewards] payout request failed ${err}`)
                    failCount++
                }
            })
        )
        return rewardEntries.length
    }

    let lastCount
    do {
        lastCount = (
            await execute()
                .catch(() => reprocessBatchLimit) // continue executing next transactions ones
        ) || 0
    } while (lastCount >= reprocessBatchLimit)

    if (total === 0) return
    log('Finished reprocessing signup & referral rewards', {
        total,
        error: failCount,
        success: successCount,
    })

    const supportUsers = await getSupportUsers()

    // send ACK messge to support users
    handleMessage.call(
        [{}, { id: ROLE_SUPPORT }],
        supportUsers.map(x => x._id),
        `[AUTOMATED MESSAGE] Finished reprocessing failed signup+referral rewards. \n\n${JSON.stringify({
            total,
            successCount,
            failCount,
        }, null, 4)}`,
        false,
        () => { }
    )
}
setTimeout(async () => {
    // create an index for the field `userId`, ignores if already exists
    const indexDefs = [
        // {
        //     index: {
        //         fields: ['data.statusCode', 'type']
        //     },
        //     name: 'data.statusCode-type-index',
        // },
        {
            index: {
                fields: [
                    'data.twitterId',
                    'data.statusCode',
                    'userId',
                ]
            },
            name: 'data.twitterId-data.statusCode-userId-index',
        },
        {
            index: {
                fields: ['status']
            },
            name: 'status-index',
        },
        {
            index: {
                fields: ['status', 'type']
            },
            name: 'status-type-index',
        },
        {
            index: {
                fields: ['status', 'tsCreated', 'type']
            },
            name: 'status-tsCreated-type-index',
        },
        {
            index: {
                fields: [
                    { tsCreated: 'desc' }
                ]
            },
            name: 'tsCreated-index',
        },
        {
            index: {
                fields: ['type']
            },
            name: 'type-index',
        },
        {
            index: {
                fields: ['userId']
            },
            name: 'userId-index',
        },
        {
            index: {
                fields: ['type', 'userId'],
            },
            name: 'type-userId-index',
        }
    ]
    indexDefs.forEach(async (def) =>
        await (
            await dbRewards.getDB()
        ).createIndex(def)
    )
    // migrateOldRewards()
    //     .catch(err => log(debugTag, 'Failed to migrate old reward entries', err))

    !rewardsPaymentPaused
        && reprocessFailedRewards &&
        await waitTillFSConnected(undefined, `${debugTag}`)
            .then(() => {
                processUnsuccessfulRewards()
                    .catch(err => log(debugTag, 'Failed to process incomplete signup & referral rewards', err))
            })
            .catch(() => { })


    if (rewardsPaymentPaused) log(debugTag, 'All rewards payments are paused!')
})
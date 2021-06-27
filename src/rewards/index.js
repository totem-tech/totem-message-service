import { emitToFaucetServer } from '../faucetRequests'
import { sendNotification } from '../notification'
import { RESERVED_IDS, rxUserRegistered, users } from '../users'
import { arrSort, generateHash, isObj } from '../utils/utils'
import CouchDBStorage from '../utils/CouchDBStorage'
import { setTexts } from '../language'

// existing faucet requests to retreive user's address if users db doesn't already have it
const dbFaucetRequests = new CouchDBStorage(null, 'faucet-requests')
const notificationSenderId = 'rewards'
const isDebug = process.env.Debug === 'true'
const ProcessMissedPayouts = process.env.ProcessMissedPayouts === 'YES'
ProcessMissedPayouts && setTimeout(() => processMissedPayouts(), 2000)
const timeout = 120000
const debugTag = '[rewards]'
const hashAlgo = 'blake2'
const hashBitLength = 256
const texts = setTexts({
    signupRewardMsg: `
        Some funds to get you started will arrive shortly.
        Keep in eye on the identities module.
        Have fun using Totem Live and don't forget to join us on our social media channels! :)
    `
})
const log = (...args) => isDebug && console.log(...args)
const status = {
    error: 'error', // payment failed
    pending: 'pending', // payment is yet to be processed
    processing: 'processing', // payment is being processed
    success: 'success', // payment was successful
}

/**
 * @name    processMissedPayouts
 * @summary process payout for existing users who missed payout or signed up before reward payouts were activated
 */
const processMissedPayouts = async (skip = 0) => {
    const _debugTag = `${debugTag} [processMissedPayouts]`
    const limit = 100
    const selector = {
        'rewards.signupReward.status': {
            $in: [
                status.error,
                status.pending,
                status.processing,
            ]
        }
    }
    // make sure to retrieve 'rewards' fields along with default fields
    const extraProps = {
        fields: [
            ...users.fields,
            'rewards',
        ]
    }
    const result = await users.search(selector, limit, skip, false, extraProps)
    const payoutUsers = result.filter(user =>
        !Object.keys(user.rewards || {}).length
        && !RESERVED_IDS.includes(user._id)
    )

    for (let i = 0; i < payoutUsers.length; i++) {
        let { _id: userId, referredBy } = payoutUsers[i] || {}

        // log(_debugTag, 'Processing missing signup payout:', userId)
        let error = await signupPayout(userId)
        if (error && !error.includes('No address'))
            log(_debugTag, 'Signup reward payment failed', { userId, error })

        referredBy = isObj(referredBy)
            ? referredBy.userId
            : referredBy
        if (!referredBy) continue

        // console.log(_debugTag, 'Processing missing referral payout:', userId)
        error = await referralPayout(referredBy, userId)
        if (error && !error.includes('No address'))
            log(_debugTag, 'Referral reward payment failed', { userId, referredBy, error })
    }

    if (result.length < limit) return
    await processMissedPayouts(skip + limit)
}

const getLastestFaucetAddress = async (userId) => {
    // retrieve referrer's  address from deprecated faucet requests
    const { requests = [] } = await dbFaucetRequests.get(userId) || {}
    const { address } = requests.pop() || {}
    return address
}

/**
 * @name    signupPayout
 * @summary triggers signup payout
 * 
 * @param   {String} referrerId 
 * @param   {String} address 
 */
const referralPayout = async (referrerId, referreeId) => {
    const _debugTag = `${debugTag} [ReferralPayout]`
    // retrieve referrer's address
    let user = await users.get(referrerId, ['_id', 'address', 'rewards'])
    if (!user) return 'User not found'

    user.rewards = user.rewards || {}
    user.rewards.referralRewards = user.rewards.referralRewards || {}

    if (!user.address) {
        user.address = await getLastestFaucetAddress(referrerId)
        // update user document with latest faucet request address
        if (!!user.address) await users.set(referrerId, user)
        if (!user.address) return 'Could not initiate payout. No address found for user'
    }

    const { address, rewards: { referralRewards } } = user
    referralRewards[referreeId] = referralRewards[referreeId] || {}
    const entry = referralRewards[referreeId]
    // Save/update reward entry
    const saveEntry = async (save = true, notify = false) => {
        if (notify & entry.notification !== true) {
            log(_debugTag, 'Sending notification to user', referrerId)
            const err = await sendNotification(
                referreeId,
                [referrerId],
                'chat',
                'referralSuccess',
                null,
                null
            )
            entry.notification = !err
                ? true
                : err
            const msg = `notifcation to ${referrerId} ${!err ? 'successful' : 'failed'}`
            log(_debugTag, msg, err)
        }
        if (!save && !notify) return

        entry.tsCreated = entry.tsCreated || new Date()
        entry.tsUpdated = new Date()
        await users.set(referrerId, user)
    }

    // user has already been rewarded
    if (entry.status === 'success') {
        await saveEntry(false, true)
        log(_debugTag, 'payout was already successful', { referrerId, referreeId })
        return
    }

    log(_debugTag, `${referrerId} referred ${referreeId}`)

    entry.status = 'started'
    await saveEntry()

    try {
        log(_debugTag, `Sending payout request to faucet server for ${referrerId}`)
        const hashSeed = `${referrerId}-referralReward-${referreeId}`
        const rewardId = generateHash(hashSeed, hashAlgo, hashBitLength)
        const [err, data] = await emitToFaucetServer(
            'reward-payment',
            {
                address,
                rewardId,
                rewardType: 'referral-reward',
            },
            timeout
        )
        const { txId, txHash } = data || {}

        entry.status = !!err
            ? 'error'
            : 'success'
        entry.error = err || undefined
        entry.txId = txId
        entry.txHash = txHash
    } catch (faucetServerError) {
        log(_debugTag, 'payout faucet request failed with error', faucetServerError)
        entry.status = 'error'
        entry.error = err
    }
    await saveEntry(true, true)
    return entry.error
}

/**
 * @name    signupPayout
 * @summary triggers signup payout
 * 
 * @param   {String} userId
 */
const signupPayout = async (userId) => {
    const _debugTag = `${debugTag} [SignupPayout]`

    const user = await users.get(userId, ['_id', 'address', 'rewards'])
    if (!user) return 'User not found'

    user.rewards = user.rewards || {}
    user.rewards.signupReward = user.rewards.signupReward || {}
    user.address = user.address || await getLastestFaucetAddress(userId)
    if (!user.address) return 'Could not initiate payout. No address found for user'

    const { address, rewards: { signupReward } } = user

    const saveEntry = async (save = true, notify = false) => {
        if (notify && signupReward.notification !== true) {
            // notify user
            log(_debugTag, `Sending notification to user ${userId}`)
            const err = await sendNotification(
                notificationSenderId,
                [userId],
                'chat',
                'signupReward',
                texts.signupRewardMsg,
                null
            )
            signupReward.notification = !err
                ? true
                : err
            log(_debugTag, `notifcation to ${userId} ${!err ? 'successful' : 'failed'}`, err || '')
        }
        if (!save && !notify) return

        signupReward.tsCreated = signupReward.tsCreated || new Date()
        signupReward.tsUpdated = new Date()
        await users.set(userId, user)
    }
    // user has already been rewarded
    if (signupReward.status === 'success') {
        await saveEntry(false, true)
        log(_debugTag, `payout was already successful for ${userId}`)
        return
    }

    log(_debugTag, userId)
    signupReward.status = 'started'
    await saveEntry()

    try {
        log(_debugTag, `Sending payout request to faucet server for ${userId}`)
        const hashSeed = `${userId} -signupReward`
        const rewardId = generateHash(hashSeed, hashAlgo, hashBitLength)
        const [err, data] = await emitToFaucetServer(
            'reward-payment',
            {
                address,
                rewardId,
                rewardType: 'signup-reward',
            },
            timeout
        )
        const { txId, txHash } = data || {}
        signupReward.status = !!err
            ? 'error'
            : 'success'
        signupReward.error = err || undefined
        signupReward.txId = txId
        signupReward.txHash = txHash

    } catch (faucetServerError) {
        log(debugTag, { event: 'signup-reward', faucetServerError })
        signupReward.status = 'error'
        signupReward.error = faucetServerError
    }
    await saveEntry(true, true)

    return signupReward.error
}

// Listen for new user registrations and process referral and signup rewards
rxUserRegistered.subscribe(async ({ address, userId, referredBy }) => {
    try {
        referredBy = isObj(referredBy)
            ? referredBy.userId
            : referredBy
        log(debugTag, 'Initiating post-registration payouts', { userId, referredBy })
        // pay signup reward to the user
        let err = await signupPayout(userId, address)
        if (err) log(debugTag, 'Signup reward payment faild: ', err)

        // pay referral reward (if any)
        if (!referredBy) return

        err = await referralPayout(referredBy, userId)
        if (err) log(debugTag, 'Referral reward payment faild: ', err)

    } catch (err) {
        // ToDo: report incident
        log(debugTag, 'Error occured while executing reward payouts.', err)
    }
})
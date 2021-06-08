import { emitToFaucetServer } from '../faucetRequests'
import { sendNotification } from '../notification'
import { rxUserRegistered, users } from "../users"
import { arrSort, generateHash } from '../utils/utils'
import CouchDBStorage from '../utils/CouchDBStorage'
import { setTexts } from '../language'

const dbRewards = new CouchDBStorage(null, 'rewards')
// stores items in progress
const dbRewardsConf = new CouchDBStorage(null, 'rewards_conf')
const dbFaucetRequests = new CouchDBStorage(null, 'faucet-requests')
const isDebug = process.env.Debug === 'true'
const timeout = 60000
const debugTag = '[rewards]'
const hashAlgo = 'blake2'
const hashBitLength = 256
const texts = setTexts({
    signupRewardMsg: `
    Some funds to get you started will arrive shortly.
    Keep in eye on the identities module.
    Have fun using Totem Live and don't forget join us on our social media channels! :)
`
})
const log = (...args) => isDebug && console.log(...args)

/**
 * @name    processMissedPayouts
 * @summary execute payout for existing users who missed payout or signed up before reward payouts were activated
 */
const processMissedPayouts = async () => {
    // retrieve a list of users who missed signup rewards
}

// setTimeout(() => {
//     log(sendNotification)
//     sendNotification(
//         'totem',
//         ['toufiq'],
//         'chat',
//         'referralSuccess',
//         texts.signupRewardMsg,
//         null
//     ).then(
//         success => log('Notificaton success', success),
//         err => log('Notification failed', err))
// }, 3000)

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
    let user = await users.get(referrerId)
    if (!user) return
    log(_debugTag, `${referrerId} referred ${referreeId}`)

    if (!user.address) {
        // retrieve referrer's  address from deprecated faucet requests
        const { requests = [] } = await dbFaucetRequests.get(referrerId) || {}
        const requestsSorted = arrSort(requests, 'timestamp', true, false)
        const { address: frAddress } = requestsSorted[0] || {}
        user.address = frAddress
        if (!!frAddress) await users.set(referrerId, user)
        if (!user.address) return log(
            _debugTag,
            `Could not initiate payout. No address found for user: ${referrerId}`
        )
    }

    const data = await dbRewards.get(referrerId) || {
        appRewards: {},
        referralRewards: {},
        signupReward: {},
        socialRewards: {},
    }

    const { referralRewards } = data
    const { address } = user
    referralRewards[referreeId] = referralRewards[referreeId] || {}
    const entry = referralRewards[referreeId]
    const saveEntry = async (save = true, notify = false) => {
        if (notify & entry.notification !== true) {
            log(_debugTag, 'Sending notification to user', referrerId)
            const err = !await sendNotification(
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
            log(_debugTag, `notifcation to ${referrerId} ${!err ? 'successful' : 'failed'}`, err)
        }
        if (!save && !notify) return
        await dbRewards.set(referrerId, data)
    }

    // user has already been rewarded
    if (entry.status === 'success') {
        await saveEntry(false, true)
        log(_debugTag, 'payout was already successful')
        return
    }

    entry.status = 'started'
    await saveEntry()

    try {
        log(_debugTag, `Sending payout request to faucet server for ${referrerId}`)
        const hashSeed = `${referrerId}-referralReward-${referreeId}`
        const rewardId = generateHash(hashSeed, hashAlgo, hashBitLength)
        const [err, data] = await emitToFaucetServer(
            'referral-reward',
            { address, rewardId },
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
 * @param   {String} address 
 */
const signupPayout = async (userId, address) => {
    const _debugTag = `${debugTag} [SignupPayout]`
    log(_debugTag, userId)
    const data = await dbRewards.get(userId) || {
        appRewards: [],
        referralRewards: [],
        signupReward: {},
        socialRewards: [],
    }
    const { signupReward } = data
    const saveEntry = async (save = true, notify = false) => {
        if (notify && signupReward.notification !== true) {
            // notify user
            log(_debugTag, `Sending notification to user ${userId}`)
            const err = !await sendNotification(
                'totem',
                [userId],
                'chat',
                'signupReward',
                texts.signupRewardMsg,
                null
            )
            signupReward.notification = !err
                ? true
                : err
            log(_debugTag, `notifcation to ${userId} ${!err ? 'successful' : 'failed'}`, err)
        }
        if (!save && !notify) return
        await dbRewards.set(userId, data)
    }
    // user has already been rewarded
    if (signupReward.status === 'success') {
        await saveEntry(false, true)
        return log(_debugTag, `payout was already successful ${userId}`)
    }

    signupReward.status = 'started'
    await saveEntry()

    try {
        log(_debugTag, `Sending payout request to faucet server for ${userId}`)
        const hashSeed = `${userId}-signupReward`
        const rewardId = generateHash(hashSeed, hashAlgo, hashBitLength)
        const [err, data] = await emitToFaucetServer(
            'signup-reward',
            { address, rewardId },
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
        signupReward.error = err
    }
    await saveEntry(true, true)

    return signupReward.error
}


/*
// sample data
dbRewards.set(
    '_sample-user',
    {
        signupReward: {
            status: 'success',
            txHash: '',
            txId: '',
        },
        socialRewards: [
            {
                campaignId: 'signup',
                platform: 'twitter',
                handle: 'twitterUserId',
                tsCreated: new Date().toISOString(),
            }
        ],
        appRewards: []
        referralRewards: {
            userId: {
                status: 'success',
                txHash: '',
                txId: '',
            }
        }
    }
)
*/

// Listen for new user registrations and process referral and signup rewards
rxUserRegistered.subscribe(async ({ address, userId, referredBy }) => {
    try {
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
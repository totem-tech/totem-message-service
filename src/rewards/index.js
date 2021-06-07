import { emitEncryptedToFaucetServer } from '../faucetRequests'
import { sendNotification } from '../notification'
import { rxUserRegistered, users } from "../users"
import { arrSort, generateHash } from '../utils/utils'
import CouchDBStorage from '../utils/CouchDBStorage'

const dbRewards = new CouchDBStorage(null, 'rewards')
const dbFaucetRequests = new CouchDBStorage(null, 'faucet-requests')
const timeout = 60000
const debugTag = '[rewards]'


// Listen for new user registrations and process referral and signup rewards
rxUserRegistered.subscribe(async ({ address, userId, referredBy }) => {
    try {
        // pay signup reward to the user
        await signupPayout(userId, address)

        // pay referral reward (if any)
        if (!referredBy) return

        await referralPayout(referredBy, userId)

    } catch (err) {
        // ToDo: report incident
        console.log(debugTag, 'Error occured while executing reward payouts.', err)
    }
})

/**
 * @name    signupPayout
 * @summary triggers signup payout
 * 
 * @param   {String} userId 
 * @param   {String} address 
 */
const signupPayout = async (userId, address) => {
    const data = await dbRewards.get(userId) || {
        appRewards: [],
        referralRewards: [],
        signupReward: {},
        socialRewards: [],
    }
    const { signupReward } = data
    // user has already been rewarded
    if (signupReward.status === 'success') return

    signupReward.status = 'started'
    await dbRewards.set(userId, data)

    try {
        const rewardId = generateHash(`${userId}-signupReward`, 'blake2', 256)
        const [err, data] = await emitEncryptedToFaucetServer(
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
        console.log(debugTag, { event: 'signup-reward', faucetServerError })
        signupReward.status = 'error'
        signupReward.error = err
    }
    await dbRewards.set(userId, data)

    if (signupReward.error) throw new Error(signupReward.error)
}

/**
 * @name    signupPayout
 * @summary triggers signup payout
 * 
 * @param   {String} referrerId 
 * @param   {String} address 
 */
const referralPayout = async (referrerId, referreeId) => {
    // // retrieve referrer's address
    let user = await users.get(referrerId)
    if (!user) return
    if (!user.address) {
        // retrieve referrer's  address from deprecated faucet requests
        const { requests = [] } = await dbFaucetRequests.get(referrerId) || {}
        const requestsSorted = arrSort(requests, 'timestamp', true, false)
        const { address: frAddress } = requestsSorted[0] || {}
        user.address = frAddress
        if (!!frAddress) await users.set(referrerId, user)
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

    // user has already been rewarded
    if (entry.status === 'success') return

    entry.status = 'started'
    await dbRewards.set(referrerId, data)

    try {
        const rewardId = generateHash(`${referrerId}-referralReward-${referreeId}`, 'blake2', 256)
        const [err, data] = await emitEncryptedToFaucetServer(
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
        console.log(debugTag, { event: 'referral-reward', faucetServerError })
        entry.status = 'error'
        entry.error = err
    }
    await dbRewards.set(referrerId, data)


    // notify referrer
    await sendNotification(
        referreeId,
        [referrerId],
        'chat',
        'referralSuccess',
        null,
        null
    ).catch(err =>
        new Error('Failed to send notification to user referrer.', err)
    )

    if (entry.error) throw new Error(entry.error)
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
import CouchDBStorage from '../utils/CouchDBStorage'
import PromisE from '../utils/PromisE'
import twitterHelper from '../utils/twitterHelper'
import { emitToFaucetServer } from '../faucetRequests'
import { setTexts } from '../language'
import { sendNotification } from '../notification'
import { users } from '../users'
import generateCode from './socialVerificationCode'

const debugTag = '[rewards] [twitter]'
const messages = setTexts({
    handleAlreadyClaimed: 'Rewards has already been claimed using this Twitter handle',
    invalidTweet: 'Invalid tweet or tweet does not belong to designated Twitter handle',
    disqualifiedTweet: 'To qualify for Twitter reward you must not alter any of the texts in your Tweet. Please go to the Getting Started module and post again.',
    invalidTwitterHandle: 'Twitter handle invalid or not found',
    notFollower: 'You must follow Totem official Twitter account',
    rewardSuccessMsgUser: 'Hurray, you have just received your signup Twitter reward! Check your account balance in the identities module.',
    rewardSuccessMsgReferrer: 'Hurray, you have just received reward because one of your referred user posted about Totem. Check your balance in the identities module.'
})
const queueStatuses = {
    error: 'error',
    pending: 'pending',
    paymentError: 'payment-error', // transaction request sent to faucet server
    paymentPending: 'payment-pending', // transaction request sent to faucet server
    paymentSuccess: 'payment-success', // transaction request sent to faucet server
    verificationFailed: 'verification-failed', // twitter follow and post verified
    verified: 'verified', // twitter follow and post verified

}
const hashAlgo = 'blake2'
const hashBitLength = 256
// Totem's official Twitter handle
const totemTwitterHandle = 'Totem_Live_'
// System user ID that will be used when sending in-app notifications to Totem users
const notificationSenderId = 'rewards'
// the following texts must be included in the tweet to qualify for the signup Twitter reward
const twitterTags = [
    totemTwitterHandle,
    '#Airdrop',
    '#Kusama',
    '#Polkadot',
    '#TotemLive',
    '$TOTEM',
]
// To avoid hitting Twitter API query limit queue any Twitter API requests and process them on specific time interval. 
const dbQueue = new CouchDBStorage(null, 'rewards_queue')
let inProgressKey = null
const rewardType = 'signup-twitter-reward'

export async function claimSignupTwitterReward(userId, twitterHandle, tweetId) {
    const type = rewardType
    const key = `${type}:${userId}:${twitterHandle}`
    console.log(debugTag, 'adding to queue')

    // a request for exact same is already in the queue
    if (!!await dbQueue.get(key)) return 
    const result = await dbQueue.set(key, {
        status: queueStatuses.pending,
        type,
        tweetId,
        twitterHandle,
        userId,
    })
    console.log({ result })
    await processNext(key)
}

const processNext = async (key) => {
    // an item is already being executed or end of the queue
    if (!!inProgressKey) return

    // reserve this for execution to avoid any possible race condition may be caused due to database query delay
    inProgressKey = key || Symbol('reserved')

    console.log(debugTag, 'processing Twitter signup reward claim', { key })
    // retrieve next queue item from database
    const queueItem = !!key
        ? (await dbQueue.get(key))
        : await dbQueue.find({
            status: {
                $in: [
                    queueStatuses.pending,
                ],
            },
            type: rewardType,
        })

    console.log(debugTag, 'processing Twitter signup reward claim', queueItem)
    if (!queueItem) {
        // no more items left in the queue
        inProgressKey = null
        return
    }

    const user = await users.get(userId)
    if (!user) return // user not found. abort execution

    user.rewards = user.rewards || {}
    user.socialHandles = user.socialHandles || {}
    const { address, rewards, socialHandles } = user
    rewards.signupReward = rewards.signupReward || {}

    const { userId, status, type, tweetId, twitterHandle } = queueItem
    key = `${type}:${userId}:${twitterHandle}`
    inProgressKey = key
    const notifyUser = async (message, status, userId) => {
        await sendNotification(
            notificationSenderId,
            [userId],
            'rewards',
            null,
            message,

        )
        if (status === queueStatuses.paymentSuccess) {
            // await dbQueue.delete(key)
        } else {
            // update existing entry status to failed
            await dbQueue.set(
                key,
                { status: status || queueStatuses.error },
                false,
                true,
            )
        }

        inProgressKey = null
        setTimeout(() => processNext())
    }

    const verifyTweet = async () => {
        // check if user is following Totem 
        const {
            following,
            id: twitterId,
            screen_name: followerHandle
        } = await twitterHelper.getFollower(totemTwitterHandle, twitterHandle)

        // User ID not found!
        if (!twitterId || followerHandle !== twitterHandle) return messages.invalidTwitterHandle

        // User is not following Totem
        if (!following) return messages.notFollower

        // check if this twitter handle has already been claimed by other users
        const alreadyClaimed = await users.find({
            'socialHandles.twitter.twitterId': twitterId,
            'socialHandles.twitter.verified': true,
        })
        if (!!alreadyClaimed) return messages.handleAlreadyClaimed

        // retrieve Tweet
        const {
            entities: { urls },
            full_text,
            user: { screen_name }
        } = await twitterHelper.getTweetById(tweetId)

        if (!full_text || screen_name !== twitterHandle) return messages.invalidTweet

        // generate a verification code (hash of user ID) for user to include in their Tweet
        const verificaitonCode = await generateCode(userId, 'twitter', twitterHandle)
        let valid = [...twitterTags, verificaitonCode]
            .every(tag => full_text.includes(tag))
        if (!valid) return messages.disqualifiedTweet

        // check if user included the referral link
        const referralLink = `https://totem.live?ref=${twitterHandle}@twitter`
        valid = twitterTags.every(str => full_text.includes(str))
            && (urls || []).find(x => x.expanded_url === referralLink)
        if (!valid) return messages.disqualifiedTweet

        // set user's social handle as verified and save twitterId
        const tsCreated = new Date()
        rewards.signupReward.twitterReward = {
            status: queueStatuses.verified,
            tsCreated,
        }
        socialHandles.twitter = {
            handle: twitterHandle,
            twitterId,
            verified: true,
        }
        // update user with pending status
        await users.set(userId, user, false, true)
        console.log(debugTag, 'Tweet and follow verified', user)
    }

    const payReward = async (referrer) => {

        console.log(debugTag, 'Processing payment', { isReferrer: !!referrer })
        // send reward request to faucet server
        const rewardType = referrer
            ? 'referral-twitter-reward'
            : 'signup-twitter-reward'
        const seed = referrer
            ? `${referrer._id}-${rewardTypeReferrer}-${userId}`
            : `${userId}-${rewardType}`
        const [err, data] = await emitToFaucetServer(
            'reward-payment',
            {
                address,
                rewardId: generateHash(
                    seed,
                    hashAlgo,
                    hashBitLength,
                ),
                type: rewardType
            },
            120000
        )
        if (err) {
            // only notify if not referrer
            !referrer && await notifyUser(err, queueStatuses.paymentError)
            console.log(debugTag, `payTwitterReward`, { referrer: !!referrer, userId }, err)
            return
        }

        const { amount, txId, txHash } = data || {}
        if (!referrer) {
            socialHandles.twitter = {
                handle: twitterHandle,
                twitterId,
                verified: true,
            }
        }
        const rewardEntry = {
            amount,
            status: 'success',
            tsCreated,
            tsUpdated: new Date(),
            txHash,
            txId,
        }
        if (referrer) {
            referrer.rewards = referrer.rewards || {}
            referrer.rewards.referralRewards = referrer.rewards.referralRewards || {}
            referrer.rewards.referralRewards[userId].twitterReward = rewardEntry
        } else {
            rewards.signupReward.twitterReward = rewardEntry
        }
        await notifyUser(
            referrer
                ? messages.rewardSuccessMsgReferrer
                : messages.rewardSuccessMsgUser,
            queueStatuses.paymentSuccess)

        // update user entry with 'success' status and txId
        await users.set(
            referrer
                ? referrer._id
                : userId,
            referrer || user,
            true,
            true,
        )
    }

    try {
        const verificaitonDone = status === queueStatuses.verified
            || status.includes('payment-')
        const vErr = verificaitonDone
            ? null // no need to verify again
            : await verifyTweet()
        if (vErr) return await notifyUser(vErr, queueStatuses.verificationFailed)

        // if user was referred pay the referrer as well
        const referrer = await users.find({
            [`rewards.referralRewards.${userId}`]: {
                $gt: null
            }
        }, { fields: ['_id', 'address', 'rewards'] })
        // pay user
        await payReward()
        // pay referrer
        await payReward(referrer)

        await dbQueue.delete(key)
        // wait one minute
        await PromisE.delay(60 * 1000)
    } catch (err) {
        // execution failed
        console.log(debugTag, 'processNext():catch', err)
    }
}


setTimeout(() => processNext())
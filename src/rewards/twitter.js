import twitterHelper from '../utils/twitterHelper'
import CouchDBStorage from '../utils/CouchDBStorage'
import PromisE from '../utils/PromisE'
import { generateHash, isFn } from '../utils/utils'
import { setTexts } from '../language'
import { sendNotification } from '../notification'
import { users } from '../users'
import { emitToFaucetServer } from '../faucetRequests'

const messages = setTexts({
    handleAlreadyClaimed: 'Rewards has already been claimed using this Twitter handle',
    invalidTweet: 'Invalid tweet or tweet does not belong to designated Twitter handle',
    disqualifiedTweet: 'To qualify for Twitter reward you must not alter any of the texts in your Tweet. Please go to the Getting Started module and post again.',
    invalidTwitterHandle: 'Twitter handle invalid or not found',
    notFollower: 'You must follow Totem official Twitter account',
    rewardSuccessMsg: 'Hurray, you have just received your signup Twitter reward! Check your account balance in the identities module.',
})
const totemTwitterHandle = 'Totem_Live_'
const notificationSenderId = 'totem'
// To avoid hitting Twitter API query limit queue any Twitter API requests and process them on specific time interval. 
const dbQueue = new CouchDBStorage(null, 'rewards_queue')
let inProgressKey = null
const STATUS_FAILED = 'failed'

export async function claimSignupTwitterReward(userId, twitterHandle, tweetId) {
    const type = 'signup-twitter'
    const key = `${type}:${userId}:${twitterHandle}`

    // a request for exact same is already in the queue
    if (!!dbQueue.get(key)) return
    await dbQueue.set({
        type,
        tweetId,
        twitterHandle,
        userId,
    })
    await processNext(key)
}

const processNext = async (key) => {
    // an item is alredy being executed o rend of the queue
    if (!!inProgressKey) return

    // reserve this for execution to avoid any possible race condition may be caused due to database query delay
    inProgressKey = key || Symbol('reserved')

    // retrieve next queue item from database
    const queueItem = key
        && (await dbQueue.get(key))
        || await dbQueue.find({
            _id: { $gt: null },
            status: { $ne: STATUS_FAILED }
        })
    if (!queueItem) {
        // no more items left in the queue
        inProgressKey = null
        return
    }

    const { userId, status, type, tweetId, twitterHandle } = queueItem
    key = `${type}:${userId}:${twitterHandle}`
    inProgressKey = key
    const notifyUser = async (message, success = false) => {
        await sendNotification(
            notificationSenderId,
            [userId],
            'rewards',
            null,
            message,

        )
        if (success) {
            await dbQueue.delete(key)
        } else {
            // update existing entry status to failed
            await dbQueue.set(key, { status: STATUS_FAILED }, false, true)
        }

        inProgressKey = null
        await processNext()
    }

    try {
        // check if user is following Totem 
        const {
            following,
            id: twitterId,
            screen_name: followerHandle
        } = await twitterHelper.getFollower(totemTwitterHandle, twitterHandle)

        // User ID not found!
        if (!twitterId || followerHandle !== twitterHandle) return await notifyUser(messages.invalidTwitterHandle)

        // User is not following Totem
        if (!following) return await notifyUser(messages.notFollower)

        // check if this twitter handle has already been claimed by other users
        const alreadyClaimed = await users.find({
            'socialHandles.twitter.twitterId': twitterId,
            'socialHandles.twitter.verified': true,
        })
        if (!!alreadyClaimed) return await notifyUser(messages.handleAlreadyClaimed)

        // retrieve Tweet
        const {
            entities: { urls },
            full_text,
            user: { screen_name }
        } = await twitterHelper.getTweetById(tweetId)

        if (!full_text || screen_name !== twitterHandle) return await notifyUser(messages.invalidTweet)

        // generate a verification code (hash of user ID) for user to include in their Tweet
        const verificationCode = generateHash(userId + twitterHandle, 'blake2', 32)
        const requiredTexts = [
            verificationCode,
            totemTwitterHandle,
            '@Polkadot',
            '#blockchain',
            '#TotemLive',
            '#polkadot',
            '#kusama',
            '#airdrop',
            '$TOTEM'
        ]
        // to qualify for rewards user Tweet must contain all of the above as well as the referral link
        const referralLink = `https://totem.live?ref=${twitterHandle}@twitter`
        const valid = requiredTexts.every(str => full_text.includes(str))
            && (urls || []).find(x => x.expanded_url === referralLink)
        if (!valid) return await notifyUser(messages.disqualifiedTweet)

        // set user's social handle as verified and save twitterId
        const user = await users.get(userId)
        const { rewards, socialHandles = {} } = user
        const tsCreated = new Date()
        rewards.signupTwitterReward = {
            status: 'pending',
            tsCreated,
        }
        // update user with pending status
        await users.set(userId, user, false, true)

        // send reward request to faucet server
        const [err, data] = await emitToFaucetServer(
            'signup-twitter-reward',
            { address, rewardId },
            120000
        )
        if (err) return await notifyUser(err)

        const { txId, txHash } = data || {}

        socialHandles.twitter = {
            handle: twitterHandle,
            twitterId,
            verified: true,
        }
        user.socialHandles = socialHandles
        user.rewards.signupTwitterReward = {
            status: 'success',
            tsCreated,
            tsUpdated: new Date(),
            txHash,
            txId,
        }
        // update user with 'success' status and txId
        await users.set(userId, user, false, true)

        // wait one minute
        await PromisE.delay(60 * 1000)
        await notifyUser(messages.rewardSuccessMsg, true)
    } catch (err) {
        // execution failed
        await notifyUser(`${err}`)
    }
}

// twitterHelper.getTweetById('1407303152022458370')
//     .then(res => console.log({ res, URLS: res.entities.urls }), console.log)
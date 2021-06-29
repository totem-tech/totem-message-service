import CouchDBStorage from '../utils/CouchDBStorage'
import PromisE from '../utils/PromisE'
import twitterHelper from '../utils/twitterHelper'
import { generateHash } from '../utils/utils'
import { emitToFaucetServer } from '../faucetRequests'
import { setTexts } from '../language'
import { sendNotification } from '../notification'
import { users } from '../users'
import generateCode from './socialVerificationCode'

const debugTag = '[rewards] [twitter]'
const messages = setTexts({
    invalidTweet: 'Invalid tweet or tweet does not belong to designated Twitter handle',
    disqualifiedTweet: 'To qualify for Twitter reward you must not alter any of the texts in your Tweet. Please go to the Getting Started module and post again.',
    invalidTwitterHandle: 'Twitter handle invalid or not found',
    notFollower: 'You must follow Totem official Twitter account',
    handleAlreadyClaimed: 'Rewards using this Twitter account has already been claimed by another user',
    rewardAlreadyClaimed: 'You have already claimed this reward',
    rewardSuccessMsgUser: 'Hurray, you have just received your signup Twitter reward! Check your account balance in the identities module.',
    rewardSuccessMsgReferrer: 'Hurray, you have just received reward because one of your referred user posted about Totem. Check your balance in the identities module.'
})
const statusCodes = {
    pending: 0,
    verificationFailed: 1, // twitter follow and post verified
    verified: 2, // twitter follow and post verified
    paymentError: 3, // transaction request sent to faucet server
    paymentSuccess: 4, // transaction request sent to faucet server
    error: 99,
}
const hashAlgo = 'blake2'
const hashBitLength = 256
// Totem's official Twitter handle
const totemTwitterHandle = 'Totem_Live_'
// System user ID that will be used when sending in-app notifications to Totem users
const notificationSenderId = 'rewards'
// the following texts must be included in the tweet to qualify for the signup Twitter reward
const twitterTags = [
    `@${totemTwitterHandle}`,
    '#Airdrop',
    '#Kusama',
    '#Polkadot',
    '#TotemLive',
    '$TOTEM',
].map(x => x.toLowerCase())
// To avoid hitting Twitter API query limit queue any Twitter API requests and process them on specific time interval. 
const dbQueue = new CouchDBStorage(null, 'rewards_queue')
const rewardType = 'signup-twitter-reward'
let inProgressKey = null

export async function claimSignupTwitterReward(userId, twitterHandle, tweetId) {
    // check if twitter handle has been claimed already
    const claimer = await users.find({
        'socialHandles.twitter.handle': twitterHandle,
        'socialHandles.twitter.verified': true,
    })

    if (!!claimer) return claimer._id === userId
        ? messages.rewardAlreadyClaimed
        : messages.handleAlreadyClaimed
    const type = rewardType
    const key = generateHash(`${type}:${userId}:${twitterHandle}`, 'blake2', 64)
    // check if user has already claimed this reward
    const existingItem = await dbQueue.get(key) || {}
    const { _id, status } = existingItem
    if (status === statusCodes.paymentSuccess) return messages.rewardAlreadyClaimed

    // a request for exact same type of reward for this user is already in the queue
    // only allow repeat if matches one of the following statuses
    const allowRepeat = [
        statusCodes.error,
        statusCodes.paymentError,
        statusCodes.verificationFailed,
    ].includes(status)
    // nothing to do
    if (!!_id && !allowRepeat) return

    const queueItem = {
        status: statusCodes.pending,
        ...existingItem,
        _id: key,
        type,
        tweetId,
        twitterHandle: `${twitterHandle || ''}`.trim(),
        userId,
    }
    await dbQueue.set(key, queueItem)
    console.log(debugTag, 'added to queue', key)
    return await processNext(queueItem, true)
}

const notifyUser = async (message, userId, status) => {
    await sendNotification(
        notificationSenderId,
        [userId],
        'rewards',
        null,
        message,
        { status }
    )
}

const updateStatus = async (id, status, error = null) => {
    // update existing entry status to failed
    await dbQueue.set(
        id,
        {
            error,
            status: status || statusCodes.error,
        },
    )
}
const processNext = async (queueItem, isDetached = true) => {
    let error
    // an item is already being executed
    if (!!inProgressKey) return

    // reserve this for execution to avoid any possible race condition may be caused due to database query delay
    inProgressKey = Symbol('reserved')

    // retrieve next queue item from database
    queueItem = !!queueItem
        ? queueItem
        : await dbQueue.find({
            status: {
                $in: [statusCodes.pending]
            },
            type: rewardType,
        })

    // end of the pending queue
    if (!queueItem) {
        inProgressKey = null
        return
    }

    console.log(debugTag, 'processing Twitter signup reward claim', queueItem._id)
    let { userId, status, type, tweetId, twitterHandle } = queueItem
    const user = await users.get(userId)
    if (!user) return console.log(debugTag, 'User not found:', userId)

    user.rewards = user.rewards || {}
    user.socialHandles = user.socialHandles || {}
    user.socialHandles.twitter = {}
    user.rewards.signupReward = user.rewards.signupReward || {}
    const { address, rewards, socialHandles } = user
    const { signupReward } = rewards
    const key = generateHash(`${type}:${userId}:${twitterHandle}`, 'blake2', 64)
    inProgressKey = key

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

        // retrieve Tweet
        let {
            entities: { urls },
            full_text,
            user: { screen_name }
        } = await twitterHelper.getTweetById(tweetId)

        if (!full_text || screen_name !== twitterHandle) return messages.invalidTweet


        // generate a verification code (hash of user ID) for user to include in their Tweet
        const verificaitonCode = await generateCode(userId, 'twitter', twitterHandle)
        full_text = JSON.stringify(full_text, null, 4)
            .toLowerCase()
        let valid = [
            ...twitterTags,
            verificaitonCode
        ].every(tag =>
            full_text.includes(tag)
        )
        if (!valid) return messages.disqualifiedTweet

        // check if user included the referral link
        const referralLink = `https://totem.live?ref=${twitterHandle}@twitter`
        valid = twitterTags.every(str => full_text.includes(str))
            && (urls || []).find(x => x.expanded_url === referralLink)
        if (!valid) return messages.disqualifiedTweet

        // set user's social handle as verified and save twitterId
        signupReward.twitterReward = {
            notified: false,
            status: 'pending',
            tsCreated: new Date(),
        }
        socialHandles.twitter = {
            handle: twitterHandle,
            twitterId,
            verified: true,
        }
        // update user with pending status
        await users.set(userId, user)
        console.log(debugTag, 'Tweet and follow verified', twitterHandle)
    }

    const payReward = async (referrer) => {
        // send reward request to faucet server
        const rewardType = referrer
            ? 'referral-twitter-reward'
            : 'signup-twitter-reward'
        const seed = referrer
            ? `${rewardType}-${userId}-${referrer._id}`
            : `${rewardType}-${userId}`
        const [err, data] = await emitToFaucetServer(
            'reward-payment',
            {
                address,
                rewardId: generateHash(
                    seed,
                    hashAlgo,
                    hashBitLength,
                ),
                rewardType
            },
            120000
        )
        if (err) return err

        const { amount, txId, txHash } = data || {}
        const tsCreated = new Date()
        const rewardEntry = {
            amount,
            status: 'success',
            tsCreated,
            tsUpdated: tsCreated,
            txHash,
            txId,
        }
        if (referrer) {
            referrer.rewards = referrer.rewards || {}
            referrer.rewards.referralRewards = referrer.rewards.referralRewards || {}
            referrer.rewards.referralRewards[userId].twitterReward = rewardEntry
        } else {
            signupReward.twitterReward = rewardEntry
        }

        // update user entry with 'success' status and txId
        await users.set(
            referrer
                ? referrer._id
                : userId,
            referrer || user,
        )
    }

    try {
        if (status <= statusCodes.verificationFailed && !user.socialHandles.twitter.verified) {
            const verifyErr = await verifyTweet()
            status = !!verifyErr
                ? statusCodes.verificationFailed
                : statusCodes.verified
            await updateStatus(key, status, verifyErr)
            if (verifyErr) return isDetached
                ? await notifyUser(verifyErr, userId, 'error')
                : verifyErr
        }

        if (status <= statusCodes.paymentError) {
            console.log(debugTag, 'processing reward payment to user')
            // pay user
            const payErr = await payReward()

            if (payErr) {
                status = statusCodes.paymentError
                await updateStatus(key, statusCodes.paymentError, payErr)
                return isDetached
                    ? await notifyUser(payErr, userId, 'error')
                    : payErr
            }
            if (!signupReward.twitterReward.notified) {
                // payment was successfull send a notification to user
                await notifyUser(messages.rewardSuccessMsgUser, userId, 'success')
                signupReward.twitterReward.notified = true
                await users.set(userId, user)
            }
        }

        // pay referrer
        const referrer = await users.find({
            [`rewards.referralRewards.${userId}`]: {
                $gt: null
            }
        }, { fields: ['_id', 'address', 'rewards'] })
        if (referrer) {
            console.log(debugTag, 'processing reward payment to referrer')
            const payRefErr = await payReward(referrer)
            if (payRefErr) {
                await updateStatus(key, statusCodes.paymentReferrerError, payRefErr)
                return
            }
            // referral payment successful. Notify referrer.
            await notifyUser(messages.rewardSuccessMsgReferrer, referrer._id, 'success')
        }
        status = statusCodes.paymentSuccess
        await updateStatus(key, statusCodes.paymentSuccess, null)
        console.log(debugTag, 'reward payments complete', key)
    } catch (err) {
        await updateStatus(key, statusCodes.error, err)
        // execution failed
        console.log(debugTag, 'processNext():catch', err)
        error = err
    } finally {
        setTimeout(async () => {
            // wait one minute
            await PromisE.delay(60 * 1000)
            inProgressKey = null
            processNext()
        })
    }

    return error
}

// process any pending items on startup
setTimeout(() => processNext())
import PromisE from '../utils/PromisE'
import twitterHelper from '../utils/twitterHelper'
import { objClean } from '../utils/utils'
import { emitToFaucetServer } from '../faucetRequests'
import { setTexts } from '../language'
import { sendNotification } from '../notification'
import { users } from '../users'
import { dbRewards, getRewardId, rewardStatus, rewardTypes } from './rewards'
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
let inProgressKey = null

export async function claimSignupTwitterReward(userId, twitterHandle, tweetId) {
    twitterHandle = `${twitterHandle || ''}`.trim()
    const type = rewardTypes.signupTwitter
    const rewardId = getRewardId(type, twitterHandle)
    // check if twitter handle has been claimed already
    const claimer = await users.find({
        'socialHandles.twitter.handle': twitterHandle,
        'socialHandles.twitter.verified': true,
    })
    const existingItem = await dbRewards.get(rewardId)
    // check if user has already claimed this reward
    const { _id, data: { statusCode } = {}, status } = existingItem || {}
    const alreadyClaimed = claimer && status === rewardStatus.success
    if (alreadyClaimed) return _id !== userId
        ? messages.handleAlreadyClaimed
        : messages.rewardAlreadyClaimed

    // a request for exact same type of reward for this user is already in the queue
    // only allow repeat if matches one of the following statuses
    const allowRepeat = [
        statusCodes.error,
        statusCodes.paymentError,
        statusCodes.verificationFailed,
    ].includes(statusCode)
    // nothing to do
    if (!!_id && !allowRepeat) return

    const rewardEntry = {
        _id: rewardId,
        data: {
            statusCode: statusCodes.pending,
            twitterHandle,
            tweetId,
        },
        notification: false,
        status: rewardStatus.processing,
        type,
        userId,
    }
    await dbRewards.set(rewardId, rewardEntry)
    console.log(debugTag, 'added to queue', rewardId)
    return await processNext(rewardEntry, false)
}

const notifyUser = async (message, userId, status, rewardId) => {
    await sendNotification(
        notificationSenderId,
        [userId],
        'rewards',
        null,
        message,
        { status },
        rewardId
    )
}
const processNext = async (rewardEntry, isDetached = true) => {
    let error
    // an item is already being executed
    if (!!inProgressKey) return

    // reserve this for execution to avoid any possible race condition may be caused due to database query delay
    inProgressKey = Symbol('reserved')

    // retrieve next queue item from database
    rewardEntry = !!rewardEntry
        ? rewardEntry
        : await dbRewards.find({
            status: { $ne: rewardStatus.success },
            'data.statusCode': statusCodes.pending,
            type: rewardTypes.signupTwitter,
        })

    // end of the pending queue
    if (!rewardEntry) {
        isDetached && console.log(debugTag, 'No pending or errored reward entry found')
        inProgressKey = null
        return
    }

    console.log(debugTag, 'processing Twitter signup reward', rewardEntry._id)
    let { data, status, type, userId } = rewardEntry
    const { tweetId, twitterHandle } = data
    let statusCode
    const user = await users.get(userId)
    if (!user) {
        inProgressKey = null
        return console.log(debugTag, 'User not found:', userId)
    }

    const { address, referredBy, socialHandles = {} } = user
    user.socialHandles = socialHandles
    const rewardId = getRewardId(rewardTypes.signupTwitter, twitterHandle)
    inProgressKey = rewardId

    const referrer = referredBy && await users.find({ referredBy })
    const rewardIdReferrer = referrer && getRewardId(rewardTypes.referralTwitter, twitterHandle)

    try {
        const doVerify = data.statusCode <= statusCodes.verificationFailed
        if (doVerify) {
            const [verifyErr, twitterId] = await verifyTweet(userId, twitterHandle, tweetId)
            if (verifyErr) {
                statusCode = statusCodes.verificationFailed
                throw new Error(verifyErr)
            }
            // verification succes
            socialHandles.twitter = {
                handle: twitterHandle,
                twitterId,
                verified: true,
            }
            await users.set(userId, user)

            // update reward entry
            rewardEntry.data.twitterId = twitterId
            rewardEntry.data.statusCode = statusCodes.verified
            await dbRewards.set(rewardId, rewardEntry)
            console.log(debugTag, 'Tweet and follow verified', twitterHandle)
            if (verifyErr) {
                inProgressKey = null
                return !isDetached
                    ? verifyErr
                    : await notifyUser(
                        verifyErr,
                        userId,
                        'error',
                        rewardId,
                    )
            }
        }

        // pay user
        if (data.statusCode <= statusCodes.paymentError) {
            const [payErr, iData = {}] = await payReward(address, rewardId, false)
            rewardEntry.amount = iData.amount
            rewardEntry.txHash = iData.txHash
            rewardEntry.txId = iData.txId
            if (payErr) {
                statusCode = statusCodes.paymentError
                throw new Error(payErr)
            }
        }

        // pay referrer
        if (!!referrer) {
            const [payRefErr] = await payReward(
                referrer.address,
                rewardIdReferrer,
                referrer,
                userId,
            )

            if (payRefErr) {
                statusCode = statusCodes.paymentError
                throw new Error(payRefErr)
            }
        }
        rewardEntry.data.statusCode = statusCodes.paymentSuccess
        rewardEntry.status = rewardStatus.success
        await dbRewards.set(rewardId, rewardEntry)
        console.log(debugTag, 'reward payments complete', rewardId)
    } catch (err) {
        rewardEntry.data.statusCode = statusCode || statusCodes.error
        rewardEntry.status = rewardStatus.error
        await dbRewards.set(rewardId, rewardEntry)
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

    if (error && isDetached) {
        return await notifyUser(
            error,
            userId,
            'error',
            rewardId,
        )
    }

    // payment was successfull send a notification to user
    if (!rewardEntry.notification && !error) {
        await notifyUser(
            messages.rewardSuccessMsgUser,
            userId,
            'success',
            rewardId,
        )
        rewardEntry.notification = true
        // update notification status
        await dbRewards.set(rewardId, rewardEntry)
    }

    return error && `${error}`
}

const payReward = async (address, rewardId, referrer, referredUserId) => {
    console.log(debugTag, `payReward to ${!!referrer ? 'referrer' : 'user'}`)
    const rewardEntry = (await dbRewards.get(rewardId)) || {}
    if (rewardEntry && rewardEntry.status === rewardStatus.success) {
        return [
            null,
            objClean(rewardEntry, ['amount', 'txHash', 'txId'])
        ]
    }
    const [err, data = {}] = await emitToFaucetServer(
        'reward-payment',
        {
            address,
            rewardId,
            rewardType: referrer
                ? rewardTypes.referralTwitter
                : rewardTypes.signupTwitter,
        },
        120000,
    )
    if (!referrer) return [err, data]

    const { amount, txId, txHash } = data || {}
    const entry = {
        amount,
        data: {
            referredUserId,
            twitterId,
            twitterHandle,
            statusCode: payReferrer
                ? statusCodes.paymentSuccess
                : statusCodes.verified
        },
        status: rewardStatus.success,
        txHash,
        txId,
        userId: referrer._id,
    }

    // update user entry with 'success' status and txId
    await dbRewards.set(rewardId, entry)

    // referral payment successful. Notify referrer.
    await notifyUser(
        messages.rewardSuccessMsgReferrer,
        referrer._id,
        'success',
        rewardId,
    )
    return [null, data]
}

const verifyTweet = async (userId, twitterHandle, tweetId) => {
    console.log(debugTag, 'Verifying tweet', { twitterHandle, tweetId })
    // check if user is following Totem 
    const {
        following,
        id: twitterId,
        screen_name: followerHandle
    } = await twitterHelper.getFollower(totemTwitterHandle, twitterHandle)

    // User ID not found!
    if (!twitterId || followerHandle !== twitterHandle) return [messages.invalidTwitterHandle]

    // User is not following Totem
    if (!following) return [messages.notFollower]

    // check if twitterId was previous claimed
    const claimer = await dbRewards.find({
        'data.twitterid': twitterId,
        'data.statusCode': { $gt: statusCodes.verified },
        userId: { $ne: userId }
    })

    if (!!claimer) return [message.handleAlreadyClaimed]

    // retrieve Tweet
    let {
        entities: { urls },
        full_text,
        user: { screen_name }
    } = await twitterHelper.getTweetById(tweetId)

    if (!full_text || screen_name !== twitterHandle) return [messages.invalidTweet]

    // generate a verification code (hash of user ID) for user to include in their Tweet
    const verificaitonCode = await generateCode(userId, 'twitter', twitterHandle)
    full_text = JSON.stringify(full_text, null, 4)
        .toLowerCase()
    const tagsValid = [...twitterTags, verificaitonCode]
        .every(tag => full_text.includes(tag))
    if (!tagsValid) return [messages.disqualifiedTweet]

    // check if user included the referral link
    const url = 'https://totem.live'
    const path = `?ref=${twitterHandle}@twitter`
    const referralLinks = [
        `${url}${path}`,
        `${url}/${path}`,
    ]
    const linkValid = (urls || [])
        .find(x => referralLinks.includes(x.expanded_url))
    return [
        !linkValid && messages.disqualifiedTweet,
        twitterId
    ]

}


// process any pending items on startup
setTimeout(() => processNext())
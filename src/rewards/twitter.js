import PromisE from '../utils/PromisE'
import twitterHelper from '../utils/twitterHelper'
import { objClean } from '../utils/utils'
import { emitToFaucetServer, waitTillFSConnected } from '../faucetRequests'
import { setTexts } from '../language'
import { sendNotification } from '../notification'
import { users } from '../users'
import { dbRewards, getRewardId, rewardStatus, rewardTypes } from './rewards'
import generateCode from './socialVerificationCode'

const reprocessRewards = process.env.reprocessTwitterRewards === 'yes'
const debugTag = '[rewards] [twitter]'
const messages = setTexts({
    invalidTweet: 'Invalid tweet or tweet does not belong to designated Twitter handle',
    disqualifiedTweet: 'To qualify for Twitter reward you must not alter any of the texts in your Tweet. Please go to the rewards module and post again.',
    invalidTwitterHandle: 'Twitter handle invalid or not found',
    notFollower: 'You must follow Totem official Twitter account',
    handleAlreadyClaimed: 'Rewards using this Twitter account has already been claimed by another user',
    rewardAlreadyClaimed: 'You have already claimed this reward',
    rewardSuccessMsgUser: 'Hurray, you have just received your signup Twitter reward! Check your rewards in the rewards module.',
    rewardSuccessMsgReferrer: 'Hurray, you have just received reward because one of your referred user posted about Totem. Check your rewards in the rewards module.'
})
const statusCodes = {
    pending: 0,
    verificationFailed: 1, // twitter follow and post verified
    verified: 2, // twitter follow and post verified
    paymentError: 3, // error occured while processing user reward payment
    paymentSuccess: 4, // user reward payment successful
    paymentErrorReferrrer: 5, // error occured while processing referrer reward payment
    paymentSuccessReferrer: 6, // referrer reward payment successful
    error: 99,
    complete: 100, // unused
    ignore: 999, // reward claim failed however status has been set manually to ignore
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
    twitterHandle = `${twitterHandle || ''}`
        .trim()
        .toLowerCase()
    const type = rewardTypes.signupTwitter
    const rewardId = getRewardId(type, twitterHandle)
    // check if twitter handle has been claimed already
    const [claimer] = await users.view('lowercase', 'twitterHandle', { key: twitterHandle })
    const existingReward = await dbRewards.get(rewardId)
    // check if user has already claimed this reward
    const {
        _id,
        data: {
            statusCode
        } = {},
        status,
    } = existingReward || {}
    const alreadyClaimed = claimer
        && claimer.socialHandles.twitter
        && claimer.socialHandles.twitter.verified
        && status === rewardStatus.success
    if (alreadyClaimed) return _id !== userId
        ? messages.handleAlreadyClaimed
        : messages.rewardAlreadyClaimed

    // a request for exact same type of reward for this user is already in the queue
    // only allow repeat if matches one of the following statuses
    const allowRepeat = [
        statusCodes.error,
        statusCodes.paymentError,
        statusCodes.pending,
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

/**
 * @name    processNext
 * @summary process next queue item
 * 
 * @param   {Object}    rewardEntry (optional) if supplied will attempt to execute this reward entry first.
 * @param   {Boolean}   isDetached  (optional) whether to return error message or notify user
 * @returns 
 */
const processNext = async (rewardEntry, isDetached = true) => {
    let error, errorCode, doWait
    // an item is already being executed
    if (!!inProgressKey) return

    // reserve this for execution to avoid any possible race condition may be caused due to database query delay
    inProgressKey = Symbol('reserved')

    // retrieve next queue item from database
    rewardEntry = !!rewardEntry
        ? rewardEntry
        : await dbRewards.find({
            status: rewardStatus.pending,
            // status: {
            //     $ne: rewardStatus.success,
            // },
            // 'data.statusCode': statusCodes.pending,
            type: rewardTypes.signupTwitter,
        })

    // end of the pending queue
    if (!rewardEntry) {
        isDetached && console.log(debugTag, 'No pending twitter reward entry found')
        inProgressKey = null
        return
    }

    const saveWithError = async (error, ignore = false, next = true) => {
        rewardEntry.status = ignore
            ? rewardEntry.ignore // indicates entry should be ignored from any re-processing attempts
            : rewardStatus.error
        rewardEntry.data.error = `${error}`
        console.log(debugTag, { rewardEntry, error })
        await dbRewards.set(rewardId, rewardEntry)
        if (!next) return

        inProgressKey = null
        processNext()
    }

    // make sure faucet server is connected
    await waitTillFSConnected(0, `${debugTag} [processNext]`)
    console.log(debugTag, 'processing Twitter signup reward', rewardEntry._id)
    let { data, userId } = rewardEntry
    // force lowercase existing twitter handles
    data.twitterHandle = `${data.twitterHandle}`.toLowerCase()
    delete data.error
    let { statusCode, tweetId, twitterHandle } = data
    const user = await users.get(userId)
    if (!user) return await saveWithError(`User not found: ${userId}`, true)

    const addressUsers = await users.search({ address: user.address }, 2)
    if (addressUsers.length > 1) return await saveWithError('Identity used by another user', true)

    const { address, referredBy, socialHandles = {} } = user
    user.socialHandles = socialHandles
    const rewardId = rewardEntry
        ? rewardEntry._id
        : getRewardId(rewardTypes.signupTwitter, twitterHandle)
    inProgressKey = rewardId

    const referrer = referredBy
        && await users.find({ _id: referredBy })
    const rewardIdReferrer = referrer
        && getRewardId(rewardTypes.referralTwitter, twitterHandle)

    try {
        if (statusCode <= statusCodes.verificationFailed) {
            doWait = true
            const [verifyErr, twitterId] = await verifyTweet(userId, twitterHandle, tweetId)
            if (verifyErr) {
                console.log(debugTag, { verifyErr })
                errorCode = statusCodes.verificationFailed
                throw verifyErr
            }
            // verification succes
            socialHandles.twitter = {
                handle: twitterHandle,
                twitterId,
                verified: true,
            }
            await users.set(userId, user)
            // console.log(debugTag, 'User after verification complete', await users.get(userId))

            // update reward entry
            data.twitterId = twitterId
            data.statusCode = statusCodes.verified
            await dbRewards.set(rewardId, rewardEntry)
            console.log(debugTag, 'Tweet and follow verified', twitterHandle)
            // if (verifyErr) {
            //     inProgressKey = null
            //     return !isDetached
            //         ? verifyErr
            //         : await notifyUser(
            //             verifyErr,
            //             userId,
            //             'error',
            //             rewardId,
            //         )
            // }
        }

        // pay user
        if (data.statusCode <= statusCodes.paymentError) {
            const [payErr, iData = {}] = await payReward(address, rewardId, null)
            rewardEntry.amount = iData.amount
            rewardEntry.txHash = iData.txHash
            rewardEntry.txId = iData.txId

            if (payErr) {
                errorCode = statusCodes.paymentError
                throw new Error(payErr)
            }
        }

        // pay referrer
        if (!!referrer && data.statusCode <= statusCodes.paymentErrorReferrrer) {
            const [payRefErr] = await payReward(
                referrer.address,
                rewardIdReferrer,
                referrer,
                userId,
                twitterHandle,
            )

            if (payRefErr) {
                errorCode = statusCodes.paymentError
                throw new Error(payRefErr)
            }
        }
        data.statusCode = referrer
            ? statusCodes.paymentSuccessReferrer
            : statusCodes.paymentSuccess
        rewardEntry.status = rewardStatus.success
        await dbRewards.set(rewardId, rewardEntry)
        console.log(debugTag, 'reward payments complete', rewardId)
    } catch (err) {
        // execution failed
        data.statusCode = errorCode || statusCodes.error
        await saveWithError(err, false, false)
        error = `${err}`.replace('Error: ', '')
    } finally {
        setTimeout(async () => {
            // wait one minute, if Twitter API was used
            doWait && await PromisE.delay(60 * 1000)
            inProgressKey = null
            processNext()
        })
    }

    if (error && isDetached) return await notifyUser(
        error,
        userId,
        'error',
        rewardId,
    )

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

/**
 * @name     payReward
 * @summary pay twitter reward to either referrer or user
 * 
 * @param   {String} address 
 * @param   {String} rewardId 
 * @param   {Object} referrer 
 * @param   {String} referredUserId
 * @param   {String} twitterHandle
 * @returns 
 */
const payReward = async (address, rewardId, referrer, referredUserId, twitterHandle) => {
    console.log(debugTag, `Pay Twitter reward to ${!!referrer ? 'referrer' : 'user'} ${rewardId}`)
    const rewardEntry = (await dbRewards.get(rewardId)) || {}
    const { _id, status } = rewardEntry
    if (!!_id && status === rewardStatus.success) {
        const data = objClean(rewardEntry, ['amount', 'txHash', 'txId'])
        return [null, data]
    }

    console.log(debugTag, 'Sending payment request faucet server', rewardId)
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
    console.log(debugTag, 'Payment success', rewardId)
    if (!referrer) return [err, data]

    const { amount, txId, txHash } = data || {}
    const entry = {
        amount,
        data: {
            referredUserId,
            twitterHandle,
            statusCode: statusCodes.paymentSuccessReferrer,
        },
        status: rewardStatus.success,
        txHash,
        txId,
        type: rewardTypes.referralTwitter,
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

/**
 * @name    verifyTweet
 * @summary check if user follows Totem official channel and then validate Tweet for reward claim
 * 
 * @param   {String} userId 
 * @param   {String} twitterHandle 
 * @param   {String} tweetId 
 * 
 * @returns {Array} [errorMessage, twitterId]
 */
const verifyTweet = async (userId, twitterHandle, tweetId) => {
    console.log(debugTag, 'Verifying tweet', { twitterHandle, tweetId })
    try {
        // check if user is following Totem 
        let {
            following,
            id: twitterId,
            screen_name: followerHandle
        } = await twitterHelper.getFollower(totemTwitterHandle, twitterHandle)

        // force lowercase twitter handle
        followerHandle = `${followerHandle}`.toLowerCase()

        // User ID not found!
        if (!twitterId || followerHandle !== twitterHandle) return [messages.invalidTwitterHandle]

        // User is not following Totem
        if (!following) return [messages.notFollower]

        // check if twitterId was previous claimed
        const claimer = await dbRewards.find({
            'data.twitterId': twitterId,
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

        // force lowercase twitter handle
        screen_name = `${screen_name}`.toLowerCase()
        if (!full_text || screen_name !== twitterHandle) return [messages.invalidTweet]

        // for legacy compatibility
        const referralUrl = (urls || [])
            .find(x =>
                x.expanded_url.includes('?ref=')
                && x.expanded_url.includes('@twitter')
            )
        const handleToVerify = !referralUrl
            ? twitterHandle
            : referralUrl
                .expanded_url
                .split('?ref=')[1]
                .split('@twitter')[0] || twitterHandle
        // generate a verification code (hash of user ID) for user to include in their Tweet
        const verificaitonCode = await generateCode(userId, 'twitter', handleToVerify)
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
            // for backward compatibility where URL included a "/" like this: 'https://totem.live/?ref=.....'
            `${url}/${path}`,
        ]
        const linkValid = (urls || [])
            .find(x => referralLinks.includes(x.expanded_url))
        return [
            !linkValid && messages.disqualifiedTweet,
            twitterId
        ]
    } catch (err) {
        const msg = `${err}`
        const notFound = [
            'No data',
            'No status'
        ].find(x => msg.includes(x))
        if (notFound) return [`${msg}`.replace('Error:', 'Tweet verification error:')]
        throw err
    }
}

// process any pending or half-finished items on startup
setTimeout(async () => {
    if (reprocessRewards) {
        const rewardEntries = await dbRewards.search({
            'data.statusCode': {
                $in: [
                    statusCodes.paymentSuccess, // payment successful but referrer payment has not been processed yet
                    statusCodes.paymentErrorReferrrer,
                ]
            },
            type: rewardTypes.signupTwitter,
        }, 0, 0, false)
        for (let i = 0; i < rewardEntries.length; i++) {
            await PromisE.delay(3000)
            const rewardEntry = rewardEntries[i]
            console.log('Reprocessing reward entry', rewardEntry._id)
            const error = await processNext(rewardEntry)
            error && console.log({ error })
        }
    }
    await processNext()
})
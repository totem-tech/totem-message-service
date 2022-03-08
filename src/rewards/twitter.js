import PromisE from '../utils/PromisE'
import twitterHelper from '../utils/twitterHelper'
import { isObj, objClean } from '../utils/utils'
import { emitToFaucetServer, rewardsPaymentPaused, waitTillFSConnected } from '../faucetRequests'
import { setTexts } from '../language'
import { sendNotification } from '../notification'
import { getSupportUsers, ROLE_SUPPORT, users } from '../users'
import { dbRewards, getRewardId, rewardStatus, rewardTypes } from './rewards'
import generateCode from './socialVerificationCode'
import { isError } from '@polkadot/util'
import { handleMessage } from '../messages'
import CouchDBStorage from '../utils/CouchDBStorage'

let reprocessRewards = (process.env.ReprocessTwitterRewards || '').toLowerCase() === 'yes'
const twitterAPIDelay = parseInt(process.env.TwitterAPIDelayMS) || 60000
const dbFollowers = new CouchDBStorage(null, 'followers_twitter')
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
let twitterApiLastUse = new Date('2000-01-01')
const log = (...args) => console.log(new Date().toISOString(), debugTag, ...args)

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
    log('added to queue', rewardId)
    return !reprocessRewards && await processNext(rewardEntry, false)
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
const processNext = async (rewardEntry, isDetached = true, deferPayment = rewardsPaymentPaused) => {
    // an item is already being executed
    if (deferPayment || !!inProgressKey) return

    let error, status
    // reserve this for execution to avoid any possible race condition may be caused due to database query delay
    inProgressKey = Symbol('reserved')

    // retrieve next queue item from database
    rewardEntry = isObj(rewardEntry)
        ? rewardEntry
        : await dbRewards.find(
            {
                status: rewardStatus.pending,
                // status: {
                //     $ne: rewardStatus.success,
                // },
                // 'data.statusCode': statusCodes.pending,
                type: rewardTypes.signupTwitter,
            },
            {
                sort: ['tsCreated'],
            },
        )

    // end of the pending queue
    if (!rewardEntry) {
        isDetached && log('No pending twitter reward entry found')
        inProgressKey = null
        return
    }

    const _processNext = () => setTimeout(async () => {
        inProgressKey = null
        !reprocessRewards && processNext(null, true, deferPayment)
    })
    const saveWithError = async (error, ignore = false, next = true) => {
        rewardEntry.status = ignore
            ? rewardEntry.ignore // indicates entry should be ignored from any re-processing attempts
            : rewardStatus.error
        rewardEntry.data.error = `${error}`
        log({ rewardEntry, error })
        await dbRewards.set(rewardId, rewardEntry)
        next && _processNext()
    }

    log('processing Twitter signup reward', rewardEntry._id)
    let { data, userId } = rewardEntry
    // force lowercase existing twitter handles
    data.twitterHandle = `${data.twitterHandle}`.toLowerCase()
    delete data.error
    let { statusCode, tweetId, twitterHandle } = data
    const user = await users.get(userId)
    if (!user) return await saveWithError(`User not found: ${userId}`, true)

    // const addressUsers = await users.search({ address: user.address }, 2)
    // if (addressUsers.length > 1) return await saveWithError('Identity used by more than user', true)

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
            const [verifyErr, twitterId] = await verifyTweet(userId, twitterHandle, tweetId)
            if (verifyErr) {
                rewardEntry.data.statusCode = statusCodes.verificationFailed
                return await saveWithError(verifyErr, true, true)
            }
            // verification succes
            socialHandles.twitter = {
                handle: twitterHandle,
                twitterId,
                verified: true,
            }
            await users.set(userId, user)

            // update reward entry
            data.twitterId = twitterId
            data.statusCode = statusCodes.verified
            await dbRewards.set(rewardId, rewardEntry)
            log('Tweet and follow verified', twitterHandle)
        }

        // pay user
        if (data.statusCode <= statusCodes.paymentError) {
            const [payErr, iData = {}] = await payReward(address, rewardId, null)
            if (payErr) {
                rewardEntry.data.statusCode = statusCodes.paymentError
                return await saveWithError(payErr, true, true)
            }
            rewardEntry.amount = iData.amount
            rewardEntry.txHash = iData.txHash
            rewardEntry.txId = iData.txId
            status = iData.status === rewardStatus.todo
                ? rewardStatus.todo
                : status
        }

        // pay referrer
        if (!!referrer && data.statusCode <= statusCodes.paymentErrorReferrrer) {
            const [payRefErr, jData = {}] = await payReward(
                referrer.address,
                rewardIdReferrer,
                referrer,
                userId,
                twitterHandle,
            )
            if (payRefErr) {
                rewardEntry.data.statusCode = statusCodes.paymentError
                return await saveWithError(payErr, true, true)
            }
        }
        data.statusCode = referrer
            ? statusCodes.paymentSuccessReferrer
            : statusCodes.paymentSuccess
        rewardEntry.status = status || rewardStatus.success
        await dbRewards.set(rewardId, rewardEntry)
        log('reward payments complete', rewardId)
    } catch (err) {
        // execution failed
        data.statusCode = statusCodes.error
        await saveWithError(err, false, false)
        error = `${err}`.replace('Error: ', '')
    }
    _processNext()

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
    log(`Pay Twitter reward to ${!!referrer ? 'referrer' : 'user'} ${rewardId}`)
    const rewardEntry = (await dbRewards.get(rewardId)) || {}
    const { _id, status } = rewardEntry
    if (!!_id && status === rewardStatus.success) {
        const data = objClean(rewardEntry, ['amount', 'txHash', 'txId'])
        return [null, data]
    }

    // make sure faucet server is connected
    await waitTillFSConnected(0, `${debugTag} [payReward]`)
    log('Sending payment request faucet server', rewardId)
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
    log('Payment success', rewardId)
    if (!referrer) return [err, data]

    const { amount, txId, txHash } = data || {}
    const entry = {
        amount,
        data: {
            referredUserId,
            twitterHandle,
            statusCode: statusCodes.paymentSuccessReferrer,
        },
        status: data.status === rewardStatus.todo
            ? rewardStatus.todo
            : rewardStatus.success,
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

const getFollower = async (twitterHandle) => {
    const dbResult = await dbFollowers.find({ ['screen-name']: twitterHandle })
        .catch(() => null)
    if (dbResult) return {
        following: true,
        id: parseInt(dbResult['twitter-unique-id']),
        screen_name: dbResult['screen-name'],
    }

    twitterApiLastUse = new Date()
    return await twitterHelper.getFollower(totemTwitterHandle, twitterHandle)
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
    log('Verifying tweet', { twitterHandle, tweetId })
    try {
        const diffMs = new Date() - twitterApiLastUse
        log('Verifying tweet', { diffMs })
        // delay making Twitter API query if last request was made within the last minute
        if (diffMs < twitterAPIDelay) await PromisE.delay(diffMs + 100)

        // check if user is following Totem 
        let {
            following,
            id: twitterId,
            screen_name: followerHandle
        } = await getFollower(twitterHandle)

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

        if (!!claimer) return [messages.handleAlreadyClaimed]

        // retrieve Tweet
        twitterApiLastUse = new Date()
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
    // create indexes
    const indexDefs = [
        {
            index: {
                fields: ['screen-name']
            },
            name: 'screen-name-index',
        },
        {
            index: {
                fields: ['twitter-unique-id']
            },
            name: 'twitter-unique-id-index',
        },
    ]
    indexDefs.forEach(async (def) =>
        await (
            await dbFollowers.getDB()
        ).createIndex(def)
    )

    if (!rewardsPaymentPaused && reprocessRewards) {
        // const rewardEntries = await dbRewards.search({
        //     'data.statusCode': {
        //         $in: [
        //             statusCodes.paymentSuccess, // payment successful but referrer payment has not been processed yet
        //             statusCodes.paymentErrorReferrrer,
        //         ]
        //     },
        //     type: rewardTypes.signupTwitter,
        // }, 0, 0, false)
        const selector = {
            'status': {
                $in: [
                    rewardStatus.error,
                    rewardStatus.processing,
                    // rewardStatus.todo,
                ]
            },
            type: rewardTypes.signupTwitter,
        }
        const rewardEntries = await dbRewards.search(
            selector,
            999999,
            0,
            false,
            { sort: ['tsCreated'] }
        )
        let failCount = 0
        let successCount = 0
        for (let i = 0; i < rewardEntries.length; i++) {
            await PromisE.delay(200)
            const rewardEntry = rewardEntries[i]
            if (rewardEntry.data.statusCode === statusCodes.verificationFailed) {
                // twitter verification failed ==> ignore
                rewardEntry.status = rewardStatus.ignore
                await dbRewards.set(rewardEntry._id, rewardEntry, true, true)
                continue
            }
            log(
                `${i + 1}/${rewardEntries.length} Reprocessing twitter reward entry`,
                rewardEntry._id,
                rewardEntry.status,
            )
            let error = await processNext(rewardEntry, false, false)
                .catch(err => err)
            if (isError(error)) error = error.message
            if (error) {
                log(rewardEntry._id, { error })
                failCount++
            } else {
                successCount++
            }
        }
        reprocessRewards = false
        if (rewardEntries.length > 0) {
            log('Finished reprocessing failed twitter reward entries', {
                total: rewardEntries.length,
                successCount,
                failCount,
            })
            const supportUsers = await getSupportUsers()

            // send ACK messge to support users
            handleMessage.call(
                [{}, { id: ROLE_SUPPORT }],
                supportUsers.map(x => x._id),
                `[AUTOMATED MESSAGE] \n\nFinished reprocessing failed Twitter rewards. \n\n${JSON.stringify({
                    total: rewardEntries.length,
                    successCount,
                    failCount,
                }, null, 4)}`,
                false,
                () => { }
            )
        }
    }
    await processNext(null, true, rewardsPaymentPaused)
})
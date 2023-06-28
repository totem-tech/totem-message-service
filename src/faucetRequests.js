import { BehaviorSubject } from 'rxjs'
import ioClient from 'socket.io-client'
import CouchDBStorage from './utils/CouchDBStorage'
import {
    encrypt,
    encryptionKeypair,
    signingKeyPair,
    newSignature,
    keyInfoFromKeyData,
} from './utils/naclHelper'
import PromisE from './utils/PromisE'
import {
    deferred,
    isBool,
    isFn,
    isObj,
    isStr,
    randomInt
} from './utils/utils'
import { setTexts } from './language'
import {
    ROLE_ADMIN,
    broadcast,
    clients,
    emitToClients,
    rxUserLoggedIn,
    rxUserRegistered,
    systemUserSymbol,
    users
} from './users'
import { handleMessage } from './messages'
import { handleNotification, sendNotification } from './notification'

// Error messages
const texts = setTexts({
    faucetDeprecated: 'Faucet requests have been deprecated and are no longer available. Here are more ways you can earn coins in addition to your signup rewards: refer a friend (copy link from Getting Started module) and post about Totem on social media (coming soon).',
    faucetDisabled: 'faucet reqeusts are not being accepted!',
    faucetLimitReached: 'You have reached maximum number of requests allowed within 24 hours. Please try again later.',
    faucetServerDown: 'Faucet client is not connected',
    faucetTransferInProgress: `
    You already have a faucet request in-progress. 
    Please wait until it is finished or wait at least 15 minutes from previous previous request time.
    `,
    invalidSignature: 'Signature pre-verification failed',
    loginOrRegister: 'Login/registration required',
    tryAgain: 'please try again later',
})

const faucetRequests = new CouchDBStorage(null, 'faucet_requests')
const config = {
    faucetEnabled: process.env.FUACET_ENABLED === 'TRUE'
}
// faucet server connected
export const rxFSConnected = new BehaviorSubject(false)
// Maximum number of requests within certain duration
const REQUEST_LIMIT = 5
// The duration within which user can make maximum number of requests specified in @REQUEST_LIMIT
const TIME_LIMIT = 24 * 60 * 60 * 1000
// After timeout, assume something went wrong and allow user to create a new request
const TIMEOUT_DURATION = 15 * 60 * 1000 // 15 minutes in milliseconds. if changed make sure toupdate `errMsgs.faucetTransferInProgress`
// Environment variables
export let rewardsPaymentPaused = (process.env.RewardsPaymentPaused || '').toLowerCase() === 'yes'
const FAUCET_SERVER_URL = process.env.FAUCET_SERVER_URL || 'https://127.0.0.1:3002'
const timeoutMS = parseInt(process.env.FAUCET_TIMEOUT_MS) || 5 * 60 * 1000
let KEY_DATA, SECRET_KEY, SIGN_PUBLIC_KEY, SIGN_SECRET_KEY, EXTERNAL_PUBLIC_KEY, EXTERNAL_SERVER_NAME
let shouldLogError = false // whether to send connection error to discord
// connect to faucet server
console.log('Connecting to faucet server')
const faucetClient = ioClient(FAUCET_SERVER_URL, {
    rejectUnauthorized: false,
    secure: true,
    timeout: 5000,
    transports: ['websocket'],
})
faucetClient.on('connect', async () => {
    shouldLogError = true

    const data = {
        random: randomInt(1e6, 1e9),
        title: 'test-decrypt',
    }
    const [err, resultData] = await emitToFaucetServer('test-decrypt', data)
    console.log('Connected to faucet server')
    const isEqual = JSON.stringify(resultData) === JSON.stringify(data)
    if (err || !isEqual) console.log('----------------------Update faucet server public keys.---------------\nReason: ', err)
    rxFSConnected.next(!err)
})
faucetClient.on('connect_error', (err) => {
    // send message to discord error logger channel
    // if(shouldLogError) 
    shouldLogError = false
    console.log('Faucet client connection failed: ', err)
    rxFSConnected.next(false)
})
faucetClient.on('disconnect', (err) => {
    // send message to discord error logger channel
    // if(shouldLogError) 
    shouldLogError = false
    console.log('Faucet client disconnected: ', err)
    rxFSConnected.next(false)
})
/**
 * @name    waitTillFSConnected
 * @summary wait until faucet server is connected or timed out
 * 
 * @param   {Number} timeout timeout duration in milliseconds. If falsy will wait indefinitely until connected.
 * 
 * @returns {Promise}
 */
export const waitTillFSConnected = (timeout = timeoutMS, tag) => new Promise((resolve, reject) => {
    const sub = rxFSConnected
        .subscribe(async (connected) => {
            if (!connected) return console.log(tag, 'Waiting for faucet server to be connected')
            setTimeout(() => sub.unsubscribe())
            resolve(true)
        })

    timeout && setTimeout(() => {
        sub.unsubscribe()
        reject('Faucet server did not connect after timeout', timeout)
    }, timeout)
})

// Reads environment variables and generate keys if needed
const setVariables = () => {
    // environment variables
    EXTERNAL_PUBLIC_KEY = process.env.external_publicKey
    EXTERNAL_SERVER_NAME = process.env.external_serverName
    const serverName = process.env.serverName
    const printData = process.env.printSensitiveData === 'YES'
    if (!serverName) return 'Missing environment variable: "serverName"'
    if (!EXTERNAL_PUBLIC_KEY) return 'Missing environment variable: "external_serverName"'
    if (!EXTERNAL_SERVER_NAME) return 'Missing environment variable: "external_serverName"'
    if (!process.env.keyData) return 'Missing environment variable: "keyData"'
    // Prevent re-generating keys when not needed
    if (KEY_DATA === process.env.keyData) return

    // Key pairs of this server
    KEY_DATA = process.env.keyData
    const encryptPair = encryptionKeypair(KEY_DATA)
    // const keyPair = encryptionKeypair(keyData)
    // publicKey = encryptionKeyPair.publicKey
    SECRET_KEY = encryptPair.secretKey

    const signKeyPair = signingKeyPair(KEY_DATA)
    // const signKeyPair = signingKeyPair(keyData)
    SIGN_PUBLIC_KEY = signKeyPair.publicKey
    SIGN_SECRET_KEY = signKeyPair.secretKey

    // only print sensitive data if "printSensitiveData" environment variable is set to "YES" (case-sensitive)
    if (!printData) return

    console.log('serverName: ', serverName, '\n')
    console.log('keyData: ', KEY_DATA, '\n')
    // only to check if keydata/encoded text is correct
    console.log('walletAddress: ', keyInfoFromKeyData(KEY_DATA).address, '\n')
    console.log('Encryption KeyPair: ', encryptPair, '\n')
    console.log('Signature KeyPair: ', signKeyPair, '\n')
    console.log('external_serverName: ', EXTERNAL_SERVER_NAME)
    console.log('external_publicKey: ', EXTERNAL_PUBLIC_KEY, '\n')
}

const envErr = setVariables()
if (envErr) throw new Error(envErr)

const broadCastStatus = (enabled = config.faucetEnabled) => broadcast([], 'faucet-status', [enabled])

/**
 * @name    handleFaucetStatus
 * @summary event handler to enable/disable of faucet and check status
 * 
 * @param   {Boolean}   enabled     (optional)
 * 
 * @param   {Function}  callback    Args: [error, faucetEnabled]
 */
export async function handleFaucetStatus(enabled, callback) {
    if (!isFn(callback)) return

    const [_, user = {}] = this
    const { roles = [] } = user
    // user must be an admin to be able to change/check status
    if (!roles.includes(ROLE_ADMIN)) return

    config.faucetEnabled = isBool(enabled)
        ? enabled
        : config.faucetEnabled
    broadCastStatus()
    callback(null, config.faucetEnabled)
}
handleFaucetStatus.requireLogin = true

export async function handleFaucetRequest(address, callback) {
    if (!isFn(callback)) return

    if (!config.faucetEnabled) return callback(texts.faucetDisabled)

    if (!faucetClient.connected) throw new Error(texts.faucetServerDown)
    const err = setVariables()
    if (err) throw err

    const [_, user] = this
    if (!user) return callback(texts.loginOrRegister)
    console.log('faucet request:', { userId: user.id, faucerServerConnected: faucetClient.connected })

    const { _id, tsCreated } = user
    // 24 hour before now
    // const deadline = new Date('2021-06-10T23:59:59')
    // Only allow users who signed up before specific date to make one last faucet request
    // const isExistingUser = !tsCreated || new Date(tsCreated) < deadline
    // if (!isExistingUser) return callback(texts.faucetDeprecated)
    let { requests } = (await faucetRequests.get(_id)) || {}
    requests = requests || []
    const last = requests[requests.length - 1]
    if (last && last.inProgress) {
        const lastTs = isStr(last.timestamp)
            ? Date.parse(last.timestamp)
            : last.timestamp
        // Disallow user from creating a new faucet request if there is already one in progress (neither success nor error) and hasn't timed out
        if (Math.abs(new Date() - lastTs) < TIMEOUT_DURATION) return callback(texts.faucetTransferInProgress)
    }

    const dateFrom = new Date(new Date() - TIME_LIMIT)
    // requests within given timeframe
    const [successCount, total] = requests.reduce(([success, total], request) => {
        if (new Date(request.timestamp) >= dateFrom) {
            total++
            if (request.funded) success++
        }
        return [success, total]
    }, [0, 0])
    if (successCount > REQUEST_LIMIT || total > REQUEST_LIMIT * 2) {
        // reached maximum allowed limit
        return callback(texts.faucetLimitReached)
    }
    const request = {
        address,
        funded: false,
        inProgress: true,
        timestamp: new Date().toISOString(),
    }
    requests.push(request)

    const limitNumItems = REQUEST_LIMIT * 3
    if (requests.length >= limitNumItems) {
        // remove older requests ???
        requests = requests.slice(-REQUEST_LIMIT)
    }

    // save inprogress status to database
    await faucetRequests.set(_id, { requests }, true)
    const index = requests.length - 1
    let [faucetServerErr, result] = await emitToFaucetServer('faucet', request)
    const {
        amount,
        txId,
        status
    } = result || {}
    requests[index].funded = !faucetServerErr
    requests[index].blockHash = txId
    requests[index].inProgress = false

    if (!!faucetServerErr) {
        const msg = faucetServerErr
        faucetServerErr = `Faucet request failed. Message from faucet server: ${isObj(msg) ? msg.message : msg}`
    }
    // get back to the user
    callback(faucetServerErr, txId, amount, status)

    // update completed status to database
    await faucetRequests.set(_id, { requests }, true)
}
handleFaucetRequest.requireLogin = true

/**
 * @name    emitToFaucetServer
 * @summary send encrypted and signed message to faucet server
 * 
 * @param   {String} eventName  websocket event name
 * @param   {*}      data       unencrypted data to send to faucet server. All data will be sent as encrypted
 * @param   {Number} timeout    (optional) timeout duration in milliseconds.
 *                              Default: 60000
 * 
 * @returns {Array}  [err, result]
 */
export const emitToFaucetServer = async (eventName, data, timeout = timeoutMS) => {
    const lenNumChars = 9
    const dataStr = isStr(data) && data || JSON.stringify(data)
    const lenStr = JSON.stringify(dataStr.length).padStart(lenNumChars)
    // Generate new signature
    const signature = newSignature(dataStr, SIGN_SECRET_KEY)//SIGN_PUBLIC_KEY, 
    const message = lenStr + EXTERNAL_SERVER_NAME + dataStr + signature
    const { sealed: encryptedMsg, nonce } = encrypt(
        message,
        SECRET_KEY,
        EXTERNAL_PUBLIC_KEY,
    )

    if (!faucetClient.connected) throw texts.faucetServerDown

    const tsStart = new Date()
    const promise = PromisE.timeout((resolve, reject) => {
        try {
            faucetClient.emit(
                eventName,
                encryptedMsg,
                nonce,
                (faucetError, result) => resolve([faucetError, result]),
            )
        } catch (err) {
            reject(err)
        }
    }, timeout)

    try {
        return await promise
    } catch (err) {
        if (promise.timeout.rejected) {
            const diff = (new Date() - tsStart) / 1000
            err = new Error(`Faucet server request timed out (${diff}/${timeout / 1000}). 
            Event name: ${eventName}`)
        }
        throw err
    }
}

// Emit faucet status to user after login
rxUserLoggedIn
    .subscribe(async ({ clientId }) => {
        emitToClients(
            [clientId],
            'faucet-status',
            [config.faucetEnabled]
        )
    })
rxUserRegistered.subscribe(async ({ address, clientId, userId }) => {
    if (!config.faucetEnabled) return

    const client = clients.get(clientId)
    const user = await users.get(userId)
    const notifyUser = (err, txId, amount, status) => {
        !err
            && status === 'sucess'
            && amount
            && sendNotification(
                'rewards',
                [userId],
                'rewards',
                'signupReward',
                '',
                { txId, amount, status }
            ).catch(() => { })//ignore error
    }
    await handleFaucetRequest.call([client, user], address, notifyUser)
        .catch(err => console.log('Post-signup faucet request failed. ', err))
})
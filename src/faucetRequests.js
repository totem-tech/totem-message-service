import ioClient from 'socket.io-client'
import CouchDBStorage from './utils/CouchDBStorage'
import {
    encrypt,
    encryptionKeypair,
    signingKeyPair,
    newSignature,
    keyInfoFromKeyData,
} from './utils/naclHelper'
import { isFn, isStr } from './utils/utils'
import { setTexts } from './language'
import PromisE from './utils/PromisE'

const faucetRequests = new CouchDBStorage(null, 'faucet-requests')
// Maximum number of requests within @TIME_LIMIT
const REQUEST_LIMIT = 500
const TIME_LIMIT = 24 * 60 * 60 * 1000 // 1 day in milliseconds
// Duration to disallow user from creating a new faucet request if there is already one in progress (neither success nor error).
// After timeout, assume something went wrong and allow user to create a new request
const TIMEOUT_DURATION = 0 //15 * 60 * 1000 // 15 minutes in milliseconds. if changed make sure toupdate `errMsgs.faucetTransferInProgress`
// Environment variables
const FAUCET_SERVER_URL = process.env.FAUCET_SERVER_URL || 'https://127.0.0.1:3002'
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
faucetClient.on('connect', () => {
    shouldLogError = true
    console.log('Connected to faucet server')
})
faucetClient.on('connect_error', (err) => {
    // send message to discord error logger channel
    // if(shouldLogError) 
    shouldLogError = false
    console.log('Faucet client connection failed: ', err)
})
// Error messages
const texts = setTexts({
    fauceRequestLimitReached: 'Reached maximum requests allowed within 24 hour period',
    loginOrRegister: 'Login/registration required',
    faucetServerDown: 'Faucet client is not connected',
    faucetTransferInProgress: `
        You already have a faucet request in-progress. 
        Please wait until it is finished or wait at least 15 minutes from previous previous request time.
    `,
    invalidSignature: 'Signature pre-verification failed',
})

// Reads environment variables and generate keys if needed
const setVariables = () => {
    // environment variables
    EXTERNAL_PUBLIC_KEY = process.env.external_publicKey
    EXTERNAL_SERVER_NAME = process.env.external_serverName
    const serverName = process.env.serverName    
    const printData = process.env.printSensitiveData === "YES"
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

export async function handleFaucetRequest(address, callback) {
    if (!isFn(callback)) return
    console.log('faucetClient.connected', faucetClient.connected)
    if (!faucetClient.connected) throw texts.faucetServerDown
    const err = setVariables()
    if (err) throw err
    
    const [_, user] = this
    if (!user) return callback(texts.loginOrRegister)
    let { requests } = (await faucetRequests.get(user.id)) || {}
    requests = requests || []
    const last = requests[requests.length - 1]
    if (last && last.inProgress) {
        const lastTs = isStr(last.timestamp) ? Date.parse(last.timestamp) : last.timestamp
        // Disallow user from creating a new faucet request if there is already one in progress (neither success nor error) and hasn't timed out
        if (Math.abs(new Date() - lastTs) < TIMEOUT_DURATION) return callback(texts.faucetTransferInProgress)
    }
    const numReqs = requests.length
    let fifthTS = (requests[numReqs - 5] || {}).timestamp
    fifthTS = isStr(fifthTS) ? Date.parse(fifthTS) : fifthTS
    if (numReqs >= REQUEST_LIMIT && Math.abs(new Date() - fifthTS) < TIME_LIMIT) {
        // prevents adding more than maximum number of requests within the given duration
        return callback(`${texts.fauceRequestLimitReached}: ${REQUEST_LIMIT}`)
    }
    const request = {
        address,
        timestamp: (new Date()).toISOString(),
        funded: false
    }
    requests.push(request)

    if (numReqs >= REQUEST_LIMIT) {
        // remove older requests ???
        requests = requests.slice(numReqs - REQUEST_LIMIT)
    }

    const index = requests.length - 1
    requests[index].inProgress = true
    // save inprogress status to database
    await faucetRequests.set(user.id, { requests }, true)
    const [faucetServerErr, result] = await emitEncryptedToFaucetServer('faucet', request)
    const [blockHash] = result || []
    requests[index].funded = !faucetServerErr
    requests[index].blockHash = blockHash
    requests[index].inProgress = false

    !!faucetServerErr && console.log(`Faucet request failed. `, faucetServerErr)
    // get back to the user
    callback(faucetServerErr, blockHash)

    // update completed status to database
    await faucetRequests.set(user.id, { requests }, true)
}
handleFaucetRequest.requireLogin = true

/**
 * @name    emitEncryptedToFaucetServer
 * @summary send encrypted and signed message to faucet server
 * 
 * @param   {String} eventName  websocket event name
 * @param   {*}      data       data to encrypt and send
 * @param   {Number} timeout    (optional) timeout duration in milliseconds.
 *                              Default: 60000
 * 
 * @returns {Array}  [err, result]
 */
export const emitEncryptedToFaucetServer = async (eventName, data, timeout = 60000) => {
    const lenNumChars = 9
    const dataStr = isStr(data) && data || JSON.stringify(data)
    const lenStr = JSON.stringify(dataStr.length).padStart(lenNumChars)
    // Generate new signature
    const signature = newSignature(dataStr, SIGN_PUBLIC_KEY, SIGN_SECRET_KEY)
    const message = lenStr + EXTERNAL_SERVER_NAME + dataStr + signature
    const { sealed: encryptedMsg, nonce } = encrypt(
        message,
        SECRET_KEY,
        EXTERNAL_PUBLIC_KEY,
    )

    if (!faucetClient.connected) throw texts.faucetServerDown
    const promise = PromisE.timeout((resolve, reject) => {
        try {
            faucetClient.emit(
                eventName,
                encryptedMsg,
                nonce,
                (err, result) => resolve([err, result]) ,
            )
        } catch (err) { 
            reject(err)
        }
    }, timeout)

    try {
        return await promise
    } catch (err) {
        if (promise.timeout.rejected) {
            err = new Error(`Faucet server request timed out. Event name: ${eventName}`)
        }
        throw err
    }
}

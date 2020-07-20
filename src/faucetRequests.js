
import CouchDBStorage from './CouchDBStorage'
import ioClient from 'socket.io-client'
import { encrypt, encryptionKeypair, signingKeyPair, newNonce, newSignature, verifySignature, keyInfoFromKeyData } from './utils/naclHelper'
import { isFn, isStr } from './utils/utils'
import { getUserByClientId } from './users'
import { setTexts } from './language'

const faucetRequests = new CouchDBStorage(null, 'faucet-requests')
// Maximum number of requests within @TIME_LIMIT
const REQUEST_LIMIT = 5
const TIME_LIMIT = 24 * 60 * 60 * 1000 // 1 day in milliseconds
// Duration to disallow user from creating a new faucet request if there is already one in progress (neither success nor error).
// After timeout, assume something went wrong and allow user to create a new request
const TIMEOUT_DURATION = 15 * 60 * 1000 // 15 minutes in milliseconds. if changed make sure toupdate `errMsgs.faucetTransferInProgress`
// Environment variables
const FAUCET_SERVER_URL = process.env.FAUCET_SERVER_URL || 'https://127.0.0.1:3002'

let keyData, walletAddress, secretKey, signPublicKey, signSecretKey, encryption_keypair, signature_keypair, serverName, external_publicKey, external_serverName, printSensitiveData

// Error messages
const texts = setTexts({
    fauceRequestLimitReached: 'Reached maximum requests allowed within 24 hour period',
    loginOrRegister: 'Login/registration required',
    faucetTransferInProgress: `
    You already have a faucet request in-progress. 
    Please wait until it is finished or wait at least 15 minutes from previous previous request time.
    `,
    invalidSignature: 'Signature pre-verification failed',
})

// Reads environment variables and generate keys if needed
const setVariables = () => {
    serverName = process.env.serverName
    if (!serverName) return 'Missing environment variable: "serverName"'

    external_publicKey = process.env.external_publicKey
    external_serverName = process.env.external_serverName
    if (!external_publicKey || !external_serverName) {
        return 'Missing environment variable(s): "external_publicKey" and/or "external_serverName"'
    }

    if (!process.env.keyData) return 'Missing environment variable: "keyData"'

    // Prevent generating keys when not needed
    if (keyData === process.env.keyData) return

    // Key pairs of this server
    keyData = process.env.keyData
    const keyDataBytes = keyInfoFromKeyData(keyData)

    walletAddress = keyDataBytes.walletAddress
    // walletAddress = keyPair.walletAddress

    const encryptionKeyPair = encryptionKeypair(keyData)
    // const keyPair = encryptionKeypair(keyData)
    // publicKey = encryptionKeyPair.publicKey
    secretKey = encryptionKeyPair.secretKey

    const signatureKeyPair = signingKeyPair(keyData)
    // const signKeyPair = signingKeyPair(keyData)
    signPublicKey = signatureKeyPair.publicKey
    signSecretKey = signatureKeyPair.secretKey

    encryption_keypair = encryptionKeyPair
    signature_keypair = signatureKeyPair

    // only print sensitive data if "printSensitiveData" environment variable is set to "YES" (case-sensitive)
    printSensitiveData = process.env.printSensitiveData === "YES"
    if (!printSensitiveData) return

    console.log('serverName: ', serverName, '\n')
    console.log('keyData: ', keyData, '\n')
    console.log('walletAddress: ', walletAddress, '\n')
    console.log('Encryption KeyPair base64 encoded: \n' + JSON.stringify(encryption_keypair, null, 4), '\n')
    console.log('Signature KeyPair base64 encoded: \n' + JSON.stringify(signature_keypair, null, 4), '\n')
    console.log('external_serverName: ', external_serverName)
    console.log('external_publicKey base64 encoded: ', external_publicKey, '\n')

}

const err = setVariables()
if (err) throw new Error(err)
// connect to faucet server
const faucetClient = ioClient(FAUCET_SERVER_URL, { secure: true, rejectUnauthorized: false })

export async function handleFaucetRequest(address, callback) {
    if (!isFn(callback)) return
    const client = this
    console.log('faucetClient.connected', faucetClient.connected)
    const err = setVariables()
    if (err) throw err

    const user = await getUserByClientId(client.id)
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
    const data = JSON.stringify(request)
    const minLength = 9
    // Length of stringified data
    let lenStr = JSON.stringify(data.length)
    // Make sure to have fixed length
    lenStr = lenStr.padStart(minLength)

    // Generate new signature
    const signature = newSignature(data, signSecretKey)
    printSensitiveData && console.log('signSecretKey:\n', signSecretKey, '\nSignature:\n', signature)
    const valid = verifySignature(data, signature, signPublicKey)
    if (!valid) return callback(texts.invalidSignature)

    const nonce = newNonce()
    const message = lenStr + external_serverName + data + signature
    const encryptedMsg = encrypt(
        message,
        nonce,
        external_publicKey,
        secretKey
    )
    requests[index].inProgress = true
    // save inprogress status to database
    await faucetRequests.set(user.id, { requests })

    // Promisify websocket request
    const emitToFaucetClient = () => new Promise(resolve => faucetClient.emit(
        'faucet',
        encryptedMsg,
        nonce,
        (err, hash) => resolve([err, hash]) ,
    ))
    const [emitErr, hash] = await emitToFaucetClient()
    requests[index].funded = !emitErr
    requests[index].hash = hash
    requests[index].inProgress = false

    !!emitErr && console.log(`Faucet request failed. Error: ${emitErr}`)
    // get back to the user
    callback(emitErr, hash)

    // update completed status to database
    await faucetRequests.set(user.id, { requests })
}

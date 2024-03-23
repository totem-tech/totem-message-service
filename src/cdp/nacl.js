import {
    encryptionKeypair,
    keyInfoFromKeyData,
    object,
    sign as signHelper
} from '../utils/naclHelper'
import { isStr, randomInt } from '../utils/utils'

let keyData, identity
let pairEncrypt = {
    publicKey: null,
    secretKey: null,
}
let pairSign = {
    publicKey: null,
    secretKey: null,
}

export const decrypt = (encrypted, senderPublicKey, asString = true) => {
    setup()
    const { target: message } = object.decrypt(
        { target: encrypted },
        senderPublicKey,
        pairEncrypt.secretKey,
        ['target'],
        asString
    )
    return message
}

export const encrypt = (message, recipientPublicKey, asHex = true) => {
    setup()
    if (!isStr(message)) message = JSON.stringify(message)
    const [{ target: encrypted }] = object.encrypt(
        { target: message },
        pairEncrypt.secretKey,
        recipientPublicKey,
        null,
        asHex
    )
    return encrypted
}

export const getIdentity = () => identity

export const getPublicKeys = () => ({
    encrypt: pairEncrypt.publicKey,
    sign: pairSign.publicKey,
})

export const setup = () => {
    // keypairs have already been set up
    if (keyData) return

    keyData = process.env.CDP_KEY_DATA
    if (!keyData) throw new Error('Missing environment variable: CDP_KEY_DATA')

    pairEncrypt = encryptionKeypair(keyData, true)
    pairSign = signHelper.keypairFromEncoded(keyData, true)
    identity = keyInfoFromKeyData(keyData).address

    // check that encryption and signature key pairs work as expected
    const msg = JSON.stringify({ data: randomInt() })
    const encrypted = encrypt(msg)
    const decrypted = encrypted && decrypt(encrypted)
    if (!decrypted || msg !== decrypted) throw new Error('CDP: encryption keypair setup failed')

    const signed = sign(msg)
    const verified = verify(
        msg,
        signed,
        pairSign.publicKey
    )
    if (!verified) throw new Error('CDP: signing keypair setup failed')
}

/**
 * @name    sign
 * @summary generate a new signature for a message
 * 
 * @param   {String|Uint8Array} message 
 * 
 * @returns {String|Uint8Array} signed message
 */
export const sign = message => {
    setup()
    if (!isStr(message)) message = JSON.stringify(message)
    return signHelper.signDetached(message, pairSign.secretKey)
}

/**
 * @name    verify
 * @summary verify signature
 * 
 * @param   {String|Uint8Array} message 
 * @param   {String|Uint8Array} signature 
 * @param   {String|Uint8Array} signerPublicKey (optional)
 *                                              Default: current signing keypair public key
 * 
 * @returns {Boolean} verified
 */
export const verify = (
    message,
    signature,
    signerPublicKey = pairSign.publicKey
) => {
    setup()
    return signHelper.verifyDetached(
        message,
        signature,
        signerPublicKey,
    )
}
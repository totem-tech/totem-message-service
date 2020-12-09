import CouchDBStorage from '../utils/CouchDBStorage'
import { decrypt, encrypt, encryptionKeypair } from '../utils/naclHelper'
import { TYPES, validate, validateObj } from '../utils/validator'
import {isArr, isFn, isObj, isUint8Arr, objClean } from '../utils/utils'
import { setTexts } from '../language'
import { commonConfs } from '../notification'
import { bytesToHex } from 'web3-utils'
import { hexToBytes } from '../utils/convert'

const dbKYC = new CouchDBStorage(null, 'crowdsale_kyc')
const messages = setTexts({
    alreadyAllocated: `
        You have alredy been allocated deposit address for this blockchain.
        Please contact us using the support chat channel if you think this is an error.
    `,
    ethAddressInUse: `
        This Ethereum address has already been whitelisted by another user. 
        Please refrain from making any deposits using this address.  
        IF YOU DO SO, YOU WILL NOT RECEIVE ANY TOKENS! 
        Please use another Ethereum address or contact us using the support chat channel if you think this is an error.
    `, 
    identityAlreadyInUse: `
        This identity has already been used by another user. 
        Please use a different identity.
    `,
    kycNotDone: 'You have not submitted your KYC yet!',
    outOfBTCAddress: `
        Uh oh! We are out of BTC deposit addresses!
        Totem team has been notified of this.
        Please try again later or use a different Blockchain.
    `,
    crowdsaleInactiveNotice: 'Crowdsale has not started yet!',
})
// environment valirables
const extEncrptKey = process.env.Crowdsale_ExtEncrptKey
// use keydata to generate both encryption and sign keypair
const keyData = process.env.Crowdsale_KeyData
export const isCrowdsaleActive = process.env.Crowdsale_Active === 'YES'
// validate environment variables
const envErr = validateObj(
    {
        Crowdsale_ExtEncrptKey: extEncrptKey,
        Crowdsale_KeyData: keyData,
    },
    {
        // validation config
        Crowdsale_ExtEncrptKey: {
            maxLength: 66,
            minLength: 66,
            required: true,
            type: TYPES.hex,
        },
        Crowdsale_KeyData: `${keyData}`.length > 192
            ? {
                // for PolkadotJS encoded string
                maxLength: 236,
                minLength: 236,
                required: true,
                type: TYPES.hex,
            }
            : {
                // for legacy 007 keyData
                maxLength: 192,
                minLength: 192,
                required: true,
                type: TYPES.string,
            },
    },
    false,
    false,
)
if (envErr) throw new Error(`Crowdsale environment variable validation failed: \n${JSON.stringify(envErr, null, 4)}`)
const encryptKeyPair = encryptionKeypair(keyData)

/**
 * 
 * @param {*} id 
 */
export const get = id => dbKYC.get(id)

/**
 * @name    handleCrowdsaleIsActive
 * @summary event handler to check if crowdsale is active
 * 
 * @param   {Function} callback 
 */
export const handleCrowdsaleIsActive = callback => isFn(callback) && callback(null, isCrowdsaleActive)
/**
 * @name    handleKyc
 * @summary handles KYC requests
 * 
 * @param   {Object|Boolean}    kycData if not Object will only check if user has already done KYC.
 *                              See `handleCrowdsaleKyc.validationConf` for required fields.
 *                              Use `true` to check if user has completed KYC.
 *  
 * @param   {Function}  callback    arguments:
 *                                  @error      String|null
 *                                  @success    Boolean 
 */
export async function handleCrowdsaleKyc(kycData, callback) {
    const [_, user] = this
    if (!isFn(callback) || !user) return

    if (!isCrowdsaleActive) return callback(messages.crowdsaleInactiveNotice)
    // check if user has already done KYC
    const kycEntry = await dbKYC.get(user.id)
    if (kycData === true || kycEntry) return callback(null, !!kycEntry)

    // validate KYC data
    const err = validateObj(kycData, handleCrowdsaleKyc.validationConf, true)
    if (err) return callback(err, false)

    // make sure no other user has already used this identity
    const existingEntry = await dbKYC.find({ identity: { $eq: kycData.identity } })
    if (existingEntry) return callback(messages.identityAlreadyInUse)
    
    kycData = objClean(kycData, handleCrowdsaleKyc.validKeys)
    const { sealed, nonce } = encryptObject(kycData, handleCrowdsaleKyc.keysToEncrypt)
    kycData = {
        ...sealed,
        nonce: bytesToHex(nonce),
    }
    await dbKYC.set(user.id, kycData)
    callback(null, kycData)
}
handleCrowdsaleKyc.requireLogin = true
handleCrowdsaleKyc.validationConf = Object.freeze({
    email: { maxLength: 128, required: true, type: TYPES.email },
    familyName: commonConfs.str3To64Required,
    givenName: commonConfs.str3To64Required,
    identity: { required: true, type: TYPES.identity }, // to be saved unencrypted
    location: {
        // store location name for KYC?
        // config: objWithoutKeys(commonConfs.location, 'name'), 
        ...commonConfs.location,
        required: true,
        type: TYPES.object,
    },
})
handleCrowdsaleKyc.keysToEncrypt = [
    'email',
    'familyName',
    'givenName',
    'location',
]
handleCrowdsaleKyc.validKeys = Object.keys(handleCrowdsaleKyc.validationConf)

const encryptObject = (obj, keys, nonce) => {
    const sealed = { ...obj }
    Object.keys(sealed)
        .filter(x => !isArr(keys) ? true : keys.includes(x))
        .forEach(key => {
            if (nonce && !isUint8Arr(nonce)) {
                // convert to bytes
                nonce = hexToBytes(nonce)
            }
            const value = sealed[key]
            const { sealed: valueEncrypted, nonce: nonce2 } = isObj(value)
                ? encryptObject(value, null, nonce)
                : encrypt(
                    value,
                    encryptKeyPair.secretKey,
                    extEncrptKey,
                    nonce,
                    true,
                )
            sealed[key] = valueEncrypted
            nonce = nonce || nonce2
        })
    return { sealed, nonce }
}
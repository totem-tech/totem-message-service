// import { bytesToHex } from 'web3-utils'
// import { hexToBytes } from '../utils/convert'
// import CouchDBStorage from '../utils/CouchDBStorage'
// import { decrypt, encrypt, encryptionKeypair, encryptObj } from '../utils/naclHelper'
// import {isArr, isFn, isObj, isUint8Arr, objClean } from '../utils/utils'
// import { TYPES, validateObj } from '../utils/validator'
// import { setTexts } from '../language'
// import { commonConfs } from '../notification'

// const dbKYC = new CouchDBStorage(null, 'crowdsale_kyc')
// const messages = setTexts({
//     alreadyAllocated: `
//         You have alredy been allocated deposit address for this blockchain.
//         Please contact us using the support chat channel if you think this is an error.
//     `,
//     ethAddressInUse: `
//         This Ethereum address has already been whitelisted by another user. 
//         Please refrain from making any deposits using this address.  
//         IF YOU DO SO, YOU WILL NOT RECEIVE ANY TOKENS! 
//         Please use another Ethereum address or contact us using the support chat channel if you think this is an error.
//     `, 
//     identityAlreadyInUse: `
//         This identity has already been used by another user. 
//         Please use a different identity.
//     `,
//     kycNotDone: 'You have not submitted your KYC yet!',
//     outOfBTCAddress: `
//         Uh oh! We are out of BTC deposit addresses!
//         Totem team has been notified of this.
//         Please try again later or use a different Blockchain.
//     `,
//     crowdsaleInactiveNotice: 'Crowdsale has not started yet!',
// })
// // ENVIRONMENT VARIABLES
// // TotemLiveAssociation's PublicKey
// const publicKeyTLA = process.env.Crowdsale_TLA_PublicKey
// // use keydata to generate both encryption and sign keypair
// const keyData = process.env.Crowdsale_KeyData
// // ToDo: use block number to determine whether crowdsale is active or over
// // use null for pending, and false when crowdsale is over
// export const isCrowdsaleActive = async () => process.env.Crowdsale_Active === 'YES'
// // validation configuration for encrypted data
// const encryptedHex = {
//     minLength: 50,
//     maxLength: 256,
//     required: true,
//     type: TYPES.hex,
// }
// const encryptedLocation = {
//     config: Object.keys(commonConfs.location.config)
//         .reduce((conf, key) => {
//             const { required } = commonConfs.location.config[key]
//             conf[key] = { ...encryptedHex, required }
//             return conf
//         }, {}),
//     required: true,
//     type: TYPES.object,
// }
// const publicKeyHex ={
//     maxLength: 66,
//     minLength: 66,
//     required: true,
//     type: TYPES.hex,
// }
// const isOO7KeyData = `${keyData}`.length <= 192
// // validate environment variables
// const envErr = validateObj(
//     {
//         publicKeyTLA, //Crowdsale_TLA_PublicKey: 
//         keyData, //Crowdsale_KeyData: 
//     },
//     {
//         // validation config
//         publicKeyTLA: {
//             ...publicKeyHex,
//             label: 'Crowdsale_TLA_PublicKey',
//         },
//         keyData: {
//             label: 'Crowdsale_KeyData',
//             maxLength: isOO7KeyData ? 192 : 236,
//             minLength: isOO7KeyData ? 192 : 236,
//             required: true,
//             type: isOO7KeyData ? TYPES.string : TYPES.hex,
//         },
//     },
//     true,
//     true,
// )
// if (envErr) throw new Error(`Missing or invalid environment variable. \n${envErr}`)
// const keypair = encryptionKeypair(keyData)

// export const decryptData = (sealed, nonce, publicKey = keypair.publicKey) => decrypt(
//     sealed,
//     nonce,
//     publicKey,
//     keypair.secretKey,
//     true,
// )
// /**
//  * @name    get
//  * @summary get KYC entry by ID
//  * 
//  * @param   {String} id 
//  * 
//  * @returns {Object}
//  */
// export const get = id => dbKYC.get(id)

// /**
//  * @name    handleCrowdsaleIsActive
//  * @summary event handler to check if crowdsale is active
//  * 
//  * @param   {Function} callback 
//  */
// export const handleCrowdsaleIsActive = async (callback) => isFn(callback) && callback(null, await isCrowdsaleActive())

// /**
//  * @name    handleKyc
//  * @summary handles KYC requests
//  * 
//  * @param   {Object|Boolean}        kycData if not Object will only check if user has already done KYC.
//  *                                  See `handleCrowdsaleKyc.validationConf` for required fields.
//  *                                  Use `true` to check if user has completed KYC.
//  *  
//  * @param   {Function}  callback    arguments:
//  *                                  @error      String|null
//  *                                  @success    Boolean 
//  */
// export async function handleCrowdsaleKyc(kycData, callback) {
//     const [_, user] = this
//     if (!isFn(callback) || !user) return

//     // check if crowdsale is in progress and accepting registration 
//     if (!await isCrowdsaleActive()) return callback(messages.crowdsaleInactiveNotice)

//     // check if user has already done KYC
//     const kycEntry = await dbKYC.get(user.id)
//     if (kycData === true || kycEntry) return callback(null, !!kycEntry)

//     // validate KYC data
//     const { validationConf, validKeys } = handleCrowdsaleKyc
//     const err = validateObj(kycData, validationConf, true)
//     if (err) return callback(err, false)
    
//     const { identity } = kycData
//     const existingEntry = await dbKYC.find({ identity: { $eq: identity } })
//     // make sure no other user has already used this identity
//     if (existingEntry) return callback(messages.identityAlreadyInUse)
    
//     // get rid of any unwated properties
//     kycData = objClean(kycData, validKeys)
//     // encrypt user's identity and store both encrypted and paintext versions for future validation.
//     // Encryption key pair from `Crowdsale_KeyData` is both the sender and the recipient.
//     // This is to ensure the identity in the database hasn't been altered by anyone.
//     // In addition to the encrypted identity, the plaintext will also be stored for checking balances without decrypting every time.
//     // However, the encrypted identity will be decrypted before distributing allocation to make sure data is correct.
//     const [encrypted] = encryptObj(kycData, keypair.secretKey, keypair.publicKey, ['identity'])
//     kycData.identityEncrypted = encrypted.identity

//     // save to database
//     await dbKYC.set(user.id, kycData)
//     callback(null, true)
// }
// handleCrowdsaleKyc.requireLogin = true
// handleCrowdsaleKyc.validationConf = Object.freeze({
//     // allow longer email address
//     email: { ...encryptedHex, maxLength: 512 },
//     familyName: encryptedHex,
//     givenName: encryptedHex,
//     // save identity as plain-text
//     identity: { required: true, type: TYPES.identity },
//     location: encryptedLocation,
//     // save user's public key as plain-text
//     publicKey: publicKeyHex,
// })
// handleCrowdsaleKyc.validKeys = Object.keys(handleCrowdsaleKyc.validationConf)

// /**
//  * @name    handleCrowdsaleKycPublicKey
//  * @summary get Totem Live Association's encryption public key
//  * 
//  * @param   {Function} callback arguments:
//  *                              @err        string
//  *                              @publicKey  string
//  */
// export const handleCrowdsaleKycPublicKey = callback => isFn(callback) && callback(null, publicKeyTLA)
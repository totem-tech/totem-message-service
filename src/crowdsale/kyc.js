import CouchDBStorage from '../CouchDBStorage'
import { decrypt, encrypt } from '../utils/naclHelper'
import {isFn, objClean } from '../utils/utils'
import { TYPES, validate, validateObj } from '../utils/validator'
import { setTexts } from '../language'
import { commonConfs } from '../notification'

const dbKYC = new CouchDBStorage(null, 'crowdsale_kyc')
// // list of pre-generated BTC addresses
// // _id: serialNo, value: { address: string } 
// const dbBTCGenerated = new CouchDBStorage(null, 'crowdsale_address-btc-generated') 
// // database for each supported blockchain with assigned deposit addresses
// const dbBTCAddresses = new CouchDBStorage(null, 'crowdsale_address-btc') //create sort key for `index` property
// const dbDOTAddresses = new CouchDBStorage(null, 'crowdsale_address-dot')
// // whitelisted Ethereum addresses
// const dbETHAddresses = new CouchDBStorage(null, 'crowdsale_address-eth')
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
    
})
// environment valirables
const KYC_PublicKey = process.env.Crowdsale_KYC_PublicKey
// validate environment variables
const envErr = validate(KYC_PublicKey, { required: false, type: TYPES.hash })
if (envErr) throw `Missing or invalid environment variable: Crowdsale_KYC_PublicKey. ${envErr}`

export const get = id => dbKYC.get(id)

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

    // check if user has already done KYC
    const kycEntry = await dbKYC.get(user.id)
    if (kycData === true || kycEntry) return callback(null, !!kycEntry)

    // validate KYC data
    const err = validateObj(kycData, handleCrowdsaleKyc.validationConf, true)
    if (err) return callback(err, false)

    // make sure no other user has already used this identity
    const existingEntry = await dbKYC.find({ identity: { $eq: kycData.identity } })
    if (existingEntry) return callback(messages.identityAlreadyInUse)
    // TODO: encrypt each property of kycData (excluding identity and user ID)
    // generate a throwaway sender keypair
    // const tempKeypair = { privateKey:'0x0' }
    // Object.keys(kycData).forEach(key => {
    //     kycData[key] = encrypt(
    //         kycData[key],
    //         tempKeypair.privateKey,
    //         KYC_PublicKey,
    //         undefined,
    //         true,
    //     )
    // })
    kycData = objClean(kycData, handleCrowdsaleKyc.validKeys)
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
handleCrowdsaleKyc.validKeys = Object.keys(handleCrowdsaleKyc.validationConf)
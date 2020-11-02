import { execSync } from 'child_process'
import CouchDBStorage from './CouchDBStorage'
import { decrypt, encrypt } from './utils/naclHelper'
import { isFn, isObj, objCopy } from './utils/utils'
import { TYPES, validate, validateObj } from './utils/validator'
import { setTexts } from './language'
import { commonConfs } from './notification'

const kyc = new CouchDBStorage(null, 'kyc')
const btcAddresses = new CouchDBStorage(null, 'address-btc')
const dotAddresses = new CouchDBStorage(null, 'address-dot')
const ethAddresses = new CouchDBStorage(null, 'address-eth')
const messages = setTexts({
    addressAlreadyInUse: 'address already in use', 
})
const KYC_PublicKey = process.env.KYC_PublicKey
const ETH_Smart_Contract = process.env.ETH_Smart_Contract
const DOT_Seed_Address = process.env.DOT_Seed_Address
// encryption public key, only accessible by Totem Live Association 
const envErr = validateObj(
    { KYC_PublicKey, ETH_Smart_Contract },
    {
        KYC_PublicKey: {
            required: false, // TODO change
            type: TYPES.hash,
        },
        ETH_Smart_Contract: {
            ...commonConfs.ethAddress,
            required: false, // TODO change
        },
        DOT_Seed_Address: {
            required: false,
            type: TYPES.identity,
        }
    },
    true,
    true,
)
if (envErr) throw `Missing or invalid environment variable. ${envErr}`

/**
 * @name    generateAddress
 * @summary generates a Polkadot address using `DOT_Seed_Address` as seed and @identity as derivation path
 * 
 * @param   {String} derivationPath URI derivation path excluding initial '/'
 * @param   {String} seed           Default: @DOT_Seed_Address
 * @param   {String} network        Default: 'polkadot'
 * 
 * @returns {String} identity or empty string if generation failed
 */
const generateAddress = async (derivationPath, seed = DOT_Seed_Address, netword = 'polkadot') => { 
    const cmdStr = `docker run --rm parity/subkey:latest inspect "${seed}/${derivationPath}" --network ${netword}`
        + ' | grep -i ss58' // print only the line with generated address
    const depositAddress = (await execSync(cmdStr) || '')
        .toString()
        // exract Polkadot address by getting rid of unwanted texts and spaces
       .replace(/Address|SS58|\:|\ |\n/gi, '')
    const err = validate(depositAddress, { required: true, type: TYPES.identity })
    return err ? '' : depositAddress
}
 
// test with Alice
generateAddress('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY')
    .then(console.log, console.log)

/**
 * @name    handleKyc
 * @summary handles KYC requests
 * 
 * @param   {Object}    kycData if not Object will only check if user has already done KYC.
 *                              See `handleCrowdsaleKyc.validationConf` for required fields
 * @param   {Function}  callback    arguments:
 *                                  @error      String|null
 *                                  @success    Boolean 
 */
export async function handleCrowdsaleKyc(kycData, callback) {
    const [_, user] = this
    if (!isFn(callback) || !user) return

    // check if user has already done KYC
    if (kyc.get(user.id)) return callback(null, true)
    if (!isObj(kycData)) return callback(null, false)

    const err = validateObj(kycData, handleCrowdsaleKyc.validationConf, true)
    if (err) return callback(err, false)

    // TODO: encrypt each property of kycData
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
    await kyc.set(user.id, kycData)
    callback(null, true)
}
handleCrowdsaleKyc.requireLogin = true
handleCrowdsaleKyc.validationConf = Object.freeze({
    email: { maxLength: 128, required: true, type: TYPES.email },
    familyName: commonConfs.str3To64Required,
    givenName: commonConfs.str3To64Required,
    identity: { requird: true, type: TYPES.identity },
    location: commonConfs.location,
    required: true,
    type: TYPES.object,
})

/**
 * @name        handleCrowdsaleDAA
 * @summary     handles requests for deposit address allocation and Ethereum address whitelisting
 * @description user must be already logged in
 * 
 * @param   {String}    blockchain  accepted values:  'BTC', 'ETH', 'DOT' 
 * @param   {String}    ethAddress  required only if @blockchain === 'ETH'
 * @param   {Function}  callback    arguments:
 *                                  @error      String|null
 *                                  @address    String      : deposit address for the selected @blockchain
 */
export async function handleCrowdsaleDAA(blockchain, ethAddress, callback) {
    const [_, user] = this
    if (!isFn(callback) || !user) return
    
    let conf = handleCrowdsaleDAA.validationConf
    const v = { blockchain, ethAddress }
    const newEntry = {
        userId: user.id,
        tsCreated: new Date(),
    }
    let existingEntry, addressDb, err, isSelf, isETH
    switch (blockchain) {
        case 'DOT':
            addressDb = btcAddresses
            newEntry.address = await generateAddress(user.id)
        case 'BTC':
            addressDb = addressDb || dotAddresses
            conf = objCopy(handleCrowdsaleDAA.validationConf, {})
            existingEntry = addressDb.find({ userId: { $eq: user.id } })
            newEntry.address = newEntry.address || await getBTCAddress(user.id)
            delete conf.ethAddress
            break
        case 'ETH':
            addressDb = ethAddresses
            existingEntry = addressDb.get(ethAddress)
            isETH = true
            break
    }

    isSelf = existingEntry && existingEntry.userId !== user.id
    if (existingEntry) return callback(
        !isSelf
            ? messages.addressAlreadyInUse // for ETH address ONLY
            : null,
        !isSelf
            ? undefined
            : isETH
                ? ETH_Smart_Contract
                : existingEntry.address
    )

    err = validateObj(v, conf)
    if (err) return callback(err)

    await addressDb.set(newEntry.address, newEntry)
    callback(null, isETH ? ETH_Smart_Contract : newEntry.address)
}
handleCrowdsaleDAA.requireLogin = true
handleCrowdsaleDAA.validationConf = Object.freeze({
    blockchain: {
        accept: [ 'BTC', 'ETH', 'DOT' ],
        required: true,
        type: TYPES.string,
    },
    ethAddress: commonConfs.ethAddress,
    required: true,
    type: TYPES.object,
})
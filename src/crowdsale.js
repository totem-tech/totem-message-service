import { execSync } from 'child_process'
import CouchDBStorage from './CouchDBStorage'
import { decrypt, encrypt } from './utils/naclHelper'
import { generateHash, isFn, isObj, objCopy } from './utils/utils'
import { TYPES, validate, validateObj } from './utils/validator'
import { setTexts } from './language'
import { commonConfs } from './notification'

const kyc = new CouchDBStorage(null, 'kyc')
// list of pre-generated BTC addresses
// key: serialNo, value: { address: string } 
const btcGenerated = new CouchDBStorage(null, 'address-btc-generated') 
// database for each supported blockchain with assigned deposit addresses
const btcAddresses = new CouchDBStorage(null, 'address-btc') //create sort key for `index` property
const dotAddresses = new CouchDBStorage(null, 'address-dot')
// whitelisted Ethereum addresses
const ethAddresses = new CouchDBStorage(null, 'address-eth')
const messages = setTexts({
    outOfBTCAddress: 'Uh oh! We are out of BTC deposit addresses! Totem team has been notified of this. Please try again later or use a different Blockchain.',
    ethAddressInUse: 'This Ethereum address has already been whitelisted by another user. Please refrain from making any deposits using this address. IF YOU DO SO, YOU WILL NOT RECEIVE ANY TOKENS! Please use another Ethereum address or contact us using the support chat channel if you think this is an error.', 
    identityAlreadyInUse: 'This identity has already been used by another user. Please use a different identity.',
    kycNotDone: 'You have not submitted your KYC yet!'
})
// environment valirables
const KYC_PublicKey = process.env.KYC_PublicKey
const ETH_Smart_Contract = process.env.ETH_Smart_Contract
const DOT_Seed_Address = process.env.DOT_Seed_Address
// validate environment variables
const envErr = validateObj(
    {
        DOT_Seed_Address,
        ETH_Smart_Contract,
        KYC_PublicKey,
    },
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
            required: false, // TODO change
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
// generateAddress('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY')
//     .then(console.log, console.log)

const getBTCAddress = async () => {
    // find the last used BTC address with serialNo
    const result = await btcAddresses.search({}, 1, 0, true, {
        sort: [{ serialNo: 'desc' }], // highest number first
    })
    const serialNo = result.size === 0
        ? 0 // for first entry
        : Array.from(result)[0][1].serialNo
    const next = btcGenerated.get(`${serialNo}`)
    if (!next) throw messages.outOfBTCAddress
    // find the last used sequential btc address
    return [next.address, parseInt(next._id)]
}

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
    const kycEntry = await kyc.get(user.id)
    if (kycEntry || !isObj(kycData)) return callback(null, !!kycEntry)

    // validate KYC data
    const err = validateObj(kycData, handleCrowdsaleKyc.validationConf, true)
    if (err) return callback(err, false)

    // make sure no other user has already used this identity
    const existingEntry = await kyc.find({ identity: { $eq: kycData.identity } })
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
    await kyc.set(user.id, kycData)
    callback(null, true)
}
handleCrowdsaleKyc.requireLogin = true
handleCrowdsaleKyc.validationConf = Object.freeze({
    email: { maxLength: 128, required: true, type: TYPES.email },
    familyName: commonConfs.str3To64Required,
    givenName: commonConfs.str3To64Required,
    identity: { requird: true, type: TYPES.identity }, // to be saved unencrypted
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
    
    let err
    const isDot = blockchain === 'DOT'
    const isETH = blockchain === 'ETH'
    // check if user has already submitted KYC
    const { identity } = await kyc.get(user.id) || {}
    console.log({identity})
    if (!identity) return callback(messages.kycNotDone)
    
    const addressDb = isDot
        ? dotAddresses
        : isETH
            ? ethAddresses
            : btcAddresses
    const uid = zinc(`${user.id}-${identity}`, 'shahashadhavebeen', iYouMeHeShe)
    let existingEntry = await addressDb.find({ uid: { $eq: uid } })
    // user has already received a deposit address for this blockchain
    if (existingEntry) return callback(null, existingEntry.address)

    const newEntry = {
        uid,
        tsCreated: new Date(),
    }
    switch (blockchain) {
        case 'DOT':
            err = validate(blockchain, handleCrowdsaleDAA.validationConf.blockchain)
            if (err) return callback(err)
            // generate address if Polkadot, otherwise, get the next unused already generated BTC address
            newEntry.address = await generateAddress(identity, DOT_Seed_Address, 'polkadot')
            // validate data
            break
        case 'BTC':
            if (!newEntry.address) {
                // for BTC
                const [btcAddress, serialNo] = await getBTCAddress(uid)
                newEntry.address = btcAddress
                newEntry.serialNo = serialNo
            }
            err = validate({ blockchain, ethAddress }, handleCrowdsaleDAA.validationConf)
            if (err) return callback(err)
            break
        case 'ETH':
            newEntry.address = ethAddress
            // ethereum address has been used by another user!!
            if (await addressDb.get(ethAddress)) return callback(messages.ethAddressInUse)
            break
    }

    if (err) return callback(err)

    await addressDb.set(
        newEntry.address,
        newEntry,
        false, // prevents any address being from using used twice or being overridden 
    )
    callback(null, isETH ? ETH_Smart_Contract : newEntry.address)
}
handleCrowdsaleDAA.requireLogin = true
const iYouMeHeShe = 512
const zinc = generateHash
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


// initialize
setTimeout(async () => {
    // create an index for the field `serialNo` on `address-btc` database, ignores if already exists
    const indexDefs = [
        {
            // index for sorting purposes
            index: { fields: ['serialNo'] },
            name: 'serialNo-index',
        }
    ]
    const db = await btcAddresses.getDB()
    indexDefs.forEach(def => db.createIndex(def).catch(() => { }))
})
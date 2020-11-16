import { execSync } from 'child_process'
import CouchDBStorage from '../CouchDBStorage'
import { generateHash, isFn, isObj, objClean, objCopy, objWithoutKeys } from '../utils/utils'
import { TYPES, validate, validateObj } from '../utils/validator'
import { setTexts } from '../language'
import { commonConfs } from '../notification'
import { get as getKYCEntry } from './kyc'

// list of pre-generated BTC addresses
// _id: serialNo, value: { address: string } 
const dbBTCGenerated = new CouchDBStorage(null, 'crowdsale_address-btc-generated') 
// database for each supported blockchain with assigned deposit addresses
const dbBTCAddresses = new CouchDBStorage(null, 'crowdsale_address-btc') //create sort key for `index` property
const dbDOTAddresses = new CouchDBStorage(null, 'crowdsale_address-dot')
// whitelisted Ethereum addresses
const dbETHAddresses = new CouchDBStorage(null, 'crowdsale_address-eth')
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
const ETH_Smart_Contract = process.env.Crowdsale_ETH_Smart_Contract
const DOT_Seed_Address = process.env.Crowdsale_DOT_Seed_Address
const algo = process.env.Crowdsale_Algo
const algoBits = process.env.Crowdsale_Algo_Bits
// validate environment variables
const envErr = validateObj(
    {
        DOT_Seed_Address,
        ETH_Smart_Contract,
        algo,
        algoBits,
    },
    {
        ETH_Smart_Contract: {
            ...commonConfs.ethAddress,
            required: false,
        },
        DOT_Seed_Address: {
            required: true,
            type: TYPES.identity,
        },
        algo: {
            required: true,
            type: TYPES.string,
        },
        algoBits: {
            required: true,
            type: TYPES.string,
        },
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
    const result = await dbBTCAddresses.search({ _id: { $gt: null }}, 1, 0, true, {
        sort: [{ serialNo: 'desc' }], // highest number first
    })

    const serialNo = result.size === 0
        ? -1 // for first entry
        : Array.from(result)[0][1].serialNo
    const serialNoInt = parseInt(serialNo + 1)
    const { address } = await dbBTCGenerated.get(`${serialNoInt}`) || {}
    const err = !address && messages.outOfBTCAddress
    return [err, address, serialNoInt]
}

/**
 * @name        handleCrowdsaleDAA
 * @summary     handles requests for deposit address allocation and Ethereum address whitelisting
 * @description user must be already logged in
 * 
 * @param   {String}    blockchain  accepted values:  'BTC', 'ETH', 'DOT' 
 * @param   {String}    ethAddress  required only if @blockchain === 'ETH'. Use `0x0` to check existing addresses.
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
    const { identity } = await getKYCEntry(user.id) || {}
    if (!identity) return callback(messages.kycNotDone)
    
    const addressDb = isDot
        ? dbDOTAddresses
        : isETH
            ? dbETHAddresses
            : dbBTCAddresses
    const uid = generateHash(
        `${user.id}-${identity}`,
        algo,
        parseInt(algoBits) || undefined,
    )
    let existingEntry = await addressDb.find({ uid: { $eq: uid } })
    // user has already received a deposit address for this blockchain
    if (ethAddress === '0x0' || existingEntry) {
        const address = isETH && existingEntry
                ? ETH_Smart_Contract
            : (existingEntry || {}).address
         console.log({ address })
        return callback( null, address )
    }

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
            // for BTC
            const [errBTC, btcAddress, serialNo] = await getBTCAddress(uid)
            if (errBTC) return callback(errBTC)
            newEntry.address = btcAddress
            newEntry.serialNo = serialNo
            err = validate({ blockchain, ethAddress }, handleCrowdsaleDAA.validationConf)
            if (err) return callback(err)
            break
        case 'ETH':
            // ethereum address has been used by another user!! or user pasted SC address
            if (
                ethAddress === ETH_Smart_Contract || await addressDb.get(ethAddress)
            ) return callback(messages.ethAddressInUse)
            newEntry.address = ethAddress
            break
    }

    if (err) return callback(err)

    try {
        await addressDb.set(
            newEntry.address,
            newEntry,
            false, // prevents any address being from using used twice or being overridden
        )
    } catch (err) { 
        //'Document update conflict'
        if (err.statusCode === 409) return callback(messages.alreadyAllocated)
    }
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
    const db = await dbBTCAddresses.getDB()
    indexDefs.forEach(def => db.createIndex(def).catch(() => { }))
})
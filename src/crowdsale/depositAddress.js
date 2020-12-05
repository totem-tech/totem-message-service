import { exit } from 'process'
import BlockchairClient from '../utils/BlockchairClient'
import { generateHash, isFn, isObj, objClean, objCopy, objWithoutKeys } from '../utils/utils'
import { TYPES, validate, validateObj } from '../utils/validator'
import CouchDBStorage from '../CouchDBStorage'
import { convertTo } from '../currencies'
import { setTexts } from '../language'
import { commonConfs } from '../notification'
import { get as getKYCEntry, isCrowdsaleActive } from './kyc'
import { getBalance, generateAddress as generateDOTAddress } from './polkadot'
import PromisE from '../utils/PromisE'

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
    crowdsaleInactiveNotice: 'Crowdsale has not started yet!',
    
})
// environment valirables
const ETH_Smart_Contract = process.env.Crowdsale_ETH_Smart_Contract
const DOT_Seed_Address = process.env.Crowdsale_DOT_Seed_Address
const algo = process.env.Crowdsale_Algo
const algoBits = parseInt(process.env.Crowdsale_Algo_Bits) || undefined
const apiKey = process.env.Blockchair_API_Key
const bcClient = new BlockchairClient(apiKey)
// validate environment variables
let envErr = validateObj(
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
            required: false,
            type: TYPES.number,
        },
    },
    true,
    true,
)
if (envErr) {
    console.error(`Missing or invalid environment variable. ${envErr}`)
    exit(1)
}

// bcClient.getERC20HolderInfo(
//     [ // random address for testing
//         '0xC2cA8977e5C582F938C30F7A5328Ac1D101BD564',
//     ],
//     //'0xc12d1c73ee7dc3615ba4e37e4abfdbddfa38907e' // kick contract
//     '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984' // UNI contract
// )
//     .then(x => console.log(JSON.stringify(x, null, 4)))
//     .catch(err => console.log({err}))

// bcClient.getBalance([ // random addresses for testing only
//     '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo',
//     '35hK24tcLEWcgNA4JxpvbkNkoAcDGqQPsP',
//     '1DoesntExist',
//     '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
//     '3APX1so1oLzpXicRpbDxZGoF2DBfXkJjtd',
// ], 'bitcoin')
//     .then(console.log)
//     .catch(console.log)

// bcClient.getBalance([
//     '0xf4268e7BB26B26B7D9E54c63b484cE501BFdc1FA',
// ], 'ethereum') // should throw error
// .catch(console.log)

// check if blockchair api key is valid by retrieving stats
if (apiKey) {
    bcClient.getAPIKeyStats()
        .then(result => console.log('Blockchair API:', result.data))
        .catch(envErr => {
            console.error(`Failed to retrieve Blockchair API key stats. ${envErr}`)
            exit(1)
        })
} else {
    console.warn(
        '-----------------------------------------'
        + '\n| Using Blockchair API without API key! |\n'
        + '-----------------------------------------'
    )
}

/**
 * @name    getBTCAddress
 * @summary retrieve the next unassigned BTC address
 * 
 * @returns {Array} [
 *                      0: @err         String: error message, if no more unassigned BTC address availabe
 *                      1: @address     String: unassigned BTC address
 *                      2: @serialNoInt Number: serial number of the BTC address
 *                  ]
 */
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

export const generateUID = (userId, identity) => generateHash(
    `${userId}-${identity}`,
    algo,
    algoBits,
)

/**
 * @name    handleCrowdsaleCheckDeposits
 * @summary handle request to check deposits and allocate XTX if new deposits found
 * 
 * @param {Function} callback   arguments =>
 *                              @err    String: error message if request fails
 *                              @result Object
 *                                  @result.deposits    Object: deposit amounts for each assigned deposit address
 *                                  @result.lastChecked String: timestamp of last time deposits' checked
 */
export async function handleCrowdsaleCheckDeposits(cached = true, callback) {
    const [_, user] = this
    if (!isFn(callback) || !user) return

    if (!isCrowdsaleActive) return callback(messages.crowdsaleInactiveNotice)

    // retrieve most recent balance check history
    // if it's within `BALANCE_CHECK_DELAY` return it as cache otherwise check balance using blockchair api

    // check if user has already submitted KYC
    const { identity } = await getKYCEntry(user.id) || {}
    if (!identity) return callback(messages.kycNotDone)

    // use identity to retrieve all deposit addresses for the user
    const uid = generateUID(user.id, identity)
    const dbs = [
        dbBTCAddresses,
        dbDOTAddresses,
        dbETHAddresses,
    ]
    const entries = await PromisE.all(
        dbs.map(db => db.find({ uid: { $eq: uid } }))
    )
    const chains = [
        'BTC',
        'DOT',
        'ETH',
    ]
    const deposits = {}
    const total = entries.reduce((sum, entry = {}) => sum + (entry.balance || 0), 0)
    let lastChecked, balanceChanged
    for (let i = 0; i < chains.length; i++) {
        const entry = entries[i]
        let { address, balance = 0, tsLastChecked } = entry || {}
        if (!address) continue
        const diffSeconds = new Date().getSeconds() - new Date(tsLastChecked).getSeconds()
        const useCache = cached || (!!tsLastChecked && diffSeconds < 60 * 30) // 30 minutes
        const chain = chains[i]
        
        if (useCache) {
            deposits[chain] = balance || 0
        } else {
            console.log('\nchekcing deposit', chain, address)
            tsLastChecked = new Date()
            let result
            switch (chain) {
                case 'BTC':
                    result = await bcClient.getBalance(address)
                    const btcBalance = (result.data[address] || 0) / Math.pow(10, 8)
                    // round the number to appropriate decimal places
                    const [_1, _2, roundedBTC] = await convertTo('BTC', 'BTC', btcBalance)
                    console.log(chain, _2, roundedBTC)
                    console.log(JSON.stringify(result, null, 4))
                    // parse rounded amount back to number
                    deposits[chain] = eval(roundedBTC) || 0
                    break
                case 'DOT': 
                    const dotBalance = await getBalance(address, true)
                    // round the number to appropriate decimal places
                    const [errDot, _4, roundedDot] = await convertTo('DOT', 'DOT', dotBalance/Math.pow(10, 10))
                    if (errDot) throw errDot
                    // parse rounded amount back to number
                    console.log({roundedDot, dotBalance})
                    deposits[chain] = eval(roundedDot) || 0
                    break
                case 'ETH':
                    result = await bcClient.getERC20HolderInfo(address, ETH_Smart_Contract)
                    // balance rounded to appropriate decimal places
                    deposits[chain] = (result[address] || {}).balance_approximate || 0
                    // ToDo: check for number of confirmations?
                    break
            }
            balanceChanged = balanceChanged || (deposits[chain] && deposits[chain] > balance)
            // use the latest timestamp as lastChecked
            lastChecked = !lastChecked
                ? tsLastChecked // first time check
                : tsLastChecked && new Date(tsLastChecked) > new Date(lastChecked)
                    ? tsLastChecked
                    : lastChecked
        }
    }
    const newTotal = Object.values(deposits).reduce((sum, balance) => sum + balance || 0, 0)
    if (total !== newTotal) {
        // ToDo: trigger lock creation
        console.log('------------------------- New Deposits Found--------------\n',
            JSON.stringify({
                user: user.id,
                deposits,
                lastChecked,
            }, null, 4)
        )
    }
    if (!cached && lastChecked) {
        console.log('update timstamp', lastChecked)
        entries.forEach((entry, i) => entry && dbs[i].set(entry._id,{
            ...entry,
            tsLastChecked: lastChecked,
            balance: deposits[chains[i]]
        }))
    }
    callback(null, { deposits, lastChecked })
}
handleCrowdsaleCheckDeposits.requireLogin = true

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
    
    if (!isCrowdsaleActive) return callback(messages.crowdsaleInactiveNotice)
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
    const uid = generateUID(user.id, identity)
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
            newEntry.address = await generateDOTAddress(identity, DOT_Seed_Address, 'polkadot')
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
import { execSync } from 'child_process'
import { exit } from 'process'
import ioClient from 'socket.io-client'
import PromisE from '../utils/PromisE'
import { isArr } from '../utils/utils'
import { TYPES, validate } from '../utils/validator'
import { isCrowdsaleActive } from './kyc'

let connectPromise, polkadotMSClient
const PolkadotMS_URL = process.env.PolkadotMS_URL || ''

/**
 * @name    connect
 * @summary Connect to Polkadot Access Micro Service. If a connection already exists, will use it instead.
 * 
 * @returns {SocketIOClient.Socket} websocket client
 */
const connect = async () => {
    if (connectPromise && (connectPromise.resolved || connectPromise.pending)) {
        return await connectPromise
    }

    console.log({PolkadotMS_URL})
    connectPromise = new PromisE(function (resolve, reject) {
        polkadotMSClient = ioClient(PolkadotMS_URL, { secure: true, rejectUnauthorized: false })
        polkadotMSClient.on('connect', () => resolve(polkadotMSClient))
        polkadotMSClient.on('connect_error', err => reject(err))
    })

    const client = await connectPromise
    console.log('Connected to PolkadotMS')
    return client
}

/**
 * @name    generateAddress
 * @summary generates a Polkadot address using @seed (or address of the seed) and a specific as derivation path
 *          that only the owner of the @seed can access.
 * 
 * @param   {String} derivationPath URI derivation path excluding initial '/'
 * @param   {String} seed           
 * @param   {String} network        Default: 'polkadot'
 * 
 * @returns {String} identity or empty string if generation failed
 * 
 * @example
 * ```javascript
 * // Generate a DOT address using Alice's address as the seed and Bob's address as derivation path:
 * const alice = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
 * const bob = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'
 * // Alice is the only one who has the access to the private key of this generated address
 * const bobsNewAddress = await generateAddress(bob, alice, 'polkadot')
 * ```
 */
export const generateAddress = async (derivationPath, seed, network = 'polkadot') => { 
    const cmdStr = `docker run --rm parity/subkey:latest inspect "${seed}/${derivationPath}" --network ${network}`
        + ' | grep -i ss58' // print only the line with generated address
    const depositAddress = (await execSync(cmdStr) || '')
        .toString()
        // exract Polkadot address by getting rid of unwanted texts and spaces
       .replace(/Address|SS58|\:|\ |\n/gi, '')
    const err = validate(depositAddress, { required: true, type: TYPES.identity })
    return err ? '' : depositAddress
}

/**
 * @name    getBalance
 * @summary get free balance of an identity
 * 
 * @param   {String|Array}  address
 * @param   {Boolean}       freeBalance whether to return only free balance (Number) or entire result from PolkadotJS
 * 
 * @returns {Number}
 */
export const getBalance = async (address, freeBalance = true) => {
    if (!address) return
    const isMulti = isArr(address)
    const result = await query('api.query.system.account', [address], isMulti)
    return freeBalance
        ? !isMulti
            ? result.data.free
            : result.map(x => x.data.free)
        : result
}

/**
 * @name    query
 * @summary Query Polkadot Blockchain netowrk. Will auto connect to Polkadot Access MS on first call.
 * 
 * @param   {String}    func    Path to the API function. Eg: 'api.query.system.account'
 * @param   {Array}     args    (optional) arguments (if any) to be supplied when invoking the API function
 * @param   {Boolean}   multi   (optional) whether the query is a multi-query
 * 
 * @returns {*}         query result parsed as a JSON Object
 * 
 * @example
 * ```javascript
 * // Single query: check Alice's balance
 *  query(
 *      'api.query.system.account',
 *      ['5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'],
 *      false,
 * )
 * // Expected result: Number
 * 
 * // Multi query: check Alice and Bob's balances
 * query(
 *      'api.query.system.account',
 *      [
 *          '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
 *          '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
 *      ],
 *      false,
 * )
 * // Expected result: Array of Numbers
 * ```
 */
const query = async (func, args = [], multi = false, timeout = 10000) => {
    const client = await connect()
    const promise = new Promise((resolve, reject) => {
        try {
            client.emit(
                'query',
                func,
                args,
                multi,
                (err, result) => !!err ? reject(err) : resolve(result)
            )
        } catch (err) { 
            reject(err)
        }
    })
    return new PromisE.timeout(promise, timeout)
}
// // test by checking Alice and Bob's balances
// const ping = () => {
//     console.log('Pinging PolkadotMS...')
//     getBalance([
//         '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
//         // '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'
//     ])
//         .then(result => {
//             console.log('PolkadotMS ping success', result)
//             // setTimeout(() => ping(), 1000 * 60 * 60)
//         })
//         .catch(err => console.log('PolkadotMS ping failed: \n', err) | exit(1))
// }
// ping()

if (isCrowdsaleActive) PromisE.timeout(connect(), 5000).catch(err => {
    console.error('Failed to connect to Polkadot Access MS. Error:\n', err)
    exit(1)
})
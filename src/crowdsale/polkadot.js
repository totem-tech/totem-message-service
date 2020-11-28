/*
 * Connection to Polkadot network
 */
import ioClient from 'socket.io-client'
import PromisE from '../utils/PromisE'
import { isArr } from '../utils/utils'
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
const query = async (func, args = [], multi = false) => {
    const client = await connect()
    return new PromisE((resolve, reject) => {
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
}

// // test by checking Alice and Bob's balances
// getBalance(
// [
//     '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
//     '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'
// ]
// ).then(console.log).catch(() => { })
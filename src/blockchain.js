import { BehaviorSubject } from 'rxjs'
import { connect, query } from './utils/polkadotHelper'
import types from './utils/totem-polkadot-js-types'
import { generateHash } from './utils/utils'
import { setTexts } from './language'

const messages = setTexts({
    authFailed: 'BONSAI authentication failed',
})
const connection = {
    api: null,
    provider: null,
}
let connectionPromsie
let nodes = [
    process.env.URL_TOTEM_NODE || 'wss://node.totem.live',
]
export const rxBlockNumber = new BehaviorSubject()
export const recordTypes = {
    /// 1000
    /// 2000
    project: 3000,
    timekeeping: 4000,
    task: 5000,
    /// 5000
    /// 6000
    /// 7000
    /// 8000
    /// 9000
}

/**
 * @name                authorizeData
 * @summary             Authorize off-chain data using BONSAI token from blockchain
 * @param {String}      recordId ID of the record
 * @param {String|*}    record  data used to generate BONSAI token for validation. 
 *                          Non-string values will be converted to string.
 * 
 * @returns         false/string: if valid, will return false othewise , error message.
 */
export const authorizeData = async (recordId, record) => {
    const token = generateHash(record)
    const { api } = await getConnection()
    const tokenX = await query(
        api,
        api.query.bonsai.isValidRecord,
        recordId,
    )
    return token !== tokenX && messages.authFailed
}

/**
 * @name            getConnection
 * @summary         connection to Blockchain
 * @param {String}  nodeUrl 
 * 
 * @returns {Object} an object with the following properties: api, provider
 */
export const getConnection = async (nodeUrl = nodes[0]) => {
    if (connection.api && connection.api._isConnected.value) return connection
    if (connectionPromsie) {
        await connectionPromsie
        return connection
    }

    console.log('PolkadotJS: connecting to', nodeUrl)
    connectionPromsie = connect(nodeUrl, types, true)
    const { api, keyring, provider } = await connectionPromsie
    console.log('PolkadotJS: connected')
    connection.api = api
    connection.keyring = keyring
    connection.provider = provider
    connectionPromsie = null

    // subscribe to current block number
    if (getConnection.blockUnsub) getConnection.blockUnsub()
    getConnection.blockUnsub = query(
        api,
        'api.rpc.chain.subscribeNewHeads',
        ({ number } = {}) => rxBlockNumber.next(number),
    )

    return connection
}

setTimeout(() => getConnection().catch(err => console.log('Failed to connect to blockchain', err)))
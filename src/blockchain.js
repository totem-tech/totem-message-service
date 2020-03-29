import { hashToStr } from './utils/convert'
import { connect } from './utils/polkadotHelper'
import types from './utils/totem-polkadot-js-types'
import { generateHash } from './utils/utils'

const connection = {
    api: null,
    provider: null,
}
let connectionPromsie
let nodes = [
    'wss://node1.totem.live',
]

// connect to blockchain
//
// Retuns object
export const getConnection = async () => {
    if (connection.api && connection.api._isConnected.value) return connection
    if (connectionPromsie) {
        await connectionPromsie
        return connection
    }
    const nodeUrl = nodes[0]
    console.log('Polkadot: connecting to', nodeUrl)
    connectionPromsie = connect(nodeUrl, types, true)
    const { api, provider } = await connectionPromsie
    console.log('Polkadot: connected')
    connection.api = api
    connection.provider = provider
    connectionPromsie = null
    return connection
}

// Authorize off-chain data using BONSAI token from blockchain
//
// Params:
// @hash    string: ID/hash of the record
// @data    object/any: the actual record with with only correct property names.
//              A hash will be generated using `@data` which must match with the hash returned from blockchain.
//              If it doesn't match, either record has not been authorized by Identity owner or has incorrect data or unwanted properties.
//
// Returns boolean
export const authorizeData = async (hash, data) => {
    const token = generateHash(data)
    const { api } = await getConnection()
    // token returned from blockchain
    const tokenX = hashToStr(await api.query.bonsai.isValidRecord(hash))
    return tokenX === token
}
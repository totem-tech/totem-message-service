import { connect, query } from './utils/polkadotHelper'
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
export const getConnection = async (nodeUrl = nodes[0]) => {
    if (connection.api && connection.api._isConnected.value) return connection
    if (connectionPromsie) {
        await connectionPromsie
        return connection
    }

    console.log('Polkadot: connecting to', nodeUrl)
    connectionPromsie = connect(nodeUrl, types, true)
    const { api, keyring, provider } = await connectionPromsie
    console.log('Polkadot: connected')
    connection.api = api
    connection.keyring = keyring
    connection.provider = provider
    connectionPromsie = null
    return connection
}

// Authorize off-chain data using BONSAI token from blockchain
//
// Params:
// @recordId    string: ID/hash of the record
// @data        object/any: the actual record with with only correct property names.
//                  A hash will be generated using `@data` which must match with the hash returned from blockchain.
//                  If it doesn't match, either record has not been authorized by Identity owner 
//                  or has incorrect data or unwanted properties.
//
// Returns      boolean
export const authorizeData = async (recordId, data) => {
    const token = generateHash(data)
    const { api } = await getConnection()
    return token === await query(
        api,
        api.query.bonsai.isValidRecord,
        recordId,
    )
}
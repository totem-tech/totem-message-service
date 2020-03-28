import { hashToStr } from './utils/convert'
import { connect } from './utils/polkadotHelper'
import types from './utils/totem-polkadot-js-types'
import { generateHash } from './utils/utils'

const connection = {}
let connectionPromsie
let nodes = [
    'wss://node1.totem.live',
]

// connect to blockchain
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
export const authorizeData = async (hash, data) => {
    const token = generateHash(data)
    console.log({ hash, data })
    const { api } = await getConnection()
    // token returned from blockchain
    const tokenX = hashToStr(await api.query.bonsai.isValidRecord(hash))
    console.log({ token, tokenX })
    return tokenX === token
}
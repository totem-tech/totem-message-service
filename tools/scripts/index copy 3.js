import CouchDBStorage from '../../src/utils/CouchDBStorage'
import DataStorage from '../../src/utils/DataStorage'
import { query, connect } from '../../src/utils/polkadotHelper'
import types from '../../src/utils/totem-polkadot-js-types'
import exportDb from '../export-db'

let _filename = 'z_prod_rewards-1-49929-2022-03-05T13-12-39.746Z.json'

const statusStats = async (storage) => {
    const addresses = new Map()
    const statuses = {}
    const types = {}
    const recipients = new Map()
    const userIds = new Map()
    storage = storage || new DataStorage(_filename)
    // Array.from(result)
    storage
        .toArray()
        .forEach(([key, value]) => {
            const { address, recipient, status, type, userId } = value
            statuses[status] = (statuses[status] || 0) + 1
            types[type] = (types[type] || 0) + 1
            userId && userIds.set(userId, true)
            recipient && recipients.set(recipient, true)
            address && addresses.set(address, true)
        })
    console.log({
        filename: storage.name,
        total: storage.getAll().size,
        userIds: userIds.size,
        addresses: addresses.size,
        recipients: recipients.size,
        statuses,
        types,
    })

    return storage
}
const rewardsStats = async (storage) => {
    storage = storage || new DataStorage(_filename)
    const stats = {
        filename: _filename,
        success: 0,
        failed: 0,
        started: 0,
    }
    await statusStats(storage)
    const successEntries = Array.from(
        storage.search({ status: 'success' })
    )
    // new DataStorage(null, true, result)
    // .search({ status: 'success' })
    console.log('Connecting to blockchain')
    const { api } = await connect('wss://node.totem.live', types, true, 15000)

    console.log('Connected to blockchain')
    for (let i = 0; i < successEntries.length; i++) {
        const [rewardId, entry] = successEntries[i]
        const { _id, txId } = entry
        if (!txId) {
            stats.noTxId++
            continue
        }
        const [status] = await checkTxStatus(api, txId)
        switch (status) {
            case 'success':
                stats.success++
                break
            case 'failed':
                stats.failed++
                break
            case 'started':
                stats.started++
                break
        }
    }
    console.log(stats)

    // todo: change reward entry status of the faild ones to pending for re-processing
    exit(0)
}

const checkTxStatus = async (api, txId) => {
    const [blockStarted = 0, blockSuccess = 0] = await query(
        api,
        api.queryMulti,
        [[
            [api.query.bonsai.isStarted, txId],
            [api.query.bonsai.isSuccessful, txId],
        ]],
    )

    const status = !blockSuccess
        ? blockStarted
            ? 'started'
            : 'failed'
        : 'success'
    return [status, blockStarted, blockSuccess]
}
console.log(exportDb)
exportDb.then(usersStats)
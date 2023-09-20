import { clientListenables } from '../system'
import { ROLE_ADMIN, broadcast, emitToClients } from '../users'
import PromisE from '../utils/PromisE'
import SubscanHelper from '../utils/substrate/SubscanHelper'
import { deferred, isInteger } from '../utils/utils'
import { TYPES } from '../utils/validator'

const apiKey = process.env.SUBSCAN_API_KEY
const delayMs = parseInt(process.env.Referenda_Update_DelayMS) || 30_000
const referendaRoom = 'referenda'
const referendaIds = (process.env.Referenda_IDs || '')
    .split(',')
    .map(n => parseInt(n))
    .filter(isInteger)
const referendaRewards = (process.env.Referenda_Rewards || '')
    .split(',')
    .map(n => Number(n))
const subscan = new SubscanHelper('polkadot', apiKey)

export const handleGetReferendas = async callback => callback?.(
    null,
    await subscan.referendaGetList({}, true)
)
handleGetReferendas.eventName = 'referenda-get-all'
handleGetReferendas.params = [{
    name: 'callback',
    required: true,
    type: TYPES.function,
}]
handleGetReferendas.requireLogin = [ROLE_ADMIN] // only admin users can use this
handleGetReferendas.result = {
    name: 'referendums',
    type: 'map'
}

/**
 * @name    handleGetVotes
 * @summary fetch/update referenda votes for pre-specified referenda IDs
 * 
 * @param   {Function}  callback
 */
export const handleGetVotes = async (ids = referendaIds, callback) => callback?.(
    null,
    await subscan.referendaGetVotesBatch(ids, true)
)
handleGetVotes.description = `Get referenda votes.`
handleGetVotes.eventName = 'referenda-get-votes'
handleGetVotes.params = [
    {
        defaultValue: referendaIds,
        name: 'referendaIds',
        required: true,
        type: 'array'
    },
    {
        name: 'callback',
        required: true,
        type: TYPES.function,
    },
]
handleGetVotes.requireLogin = [ROLE_ADMIN]
handleGetVotes.result = {
    description: 'Go here for sample map item (see `data.list` in the `Example Response` section): https://support.subscan.io/#referendumv2-votes.',
    type: 'map',
}
// add listenable event
clientListenables[handleGetVotes.eventName] = {
    description: 'Listen for broadcasts of DOT referenda votes.',
    eventName: handleGetVotes.eventName,
    params: [handleGetVotes.result],
    rooms: [referendaRoom],
}
clientListenables['referenda-rewards'] = {
    description: 'Listen for broadcasts of DOT referenda votes.',
    eventName: handleGetVotes.eventName,
    params: [
        {
            name: 'referendaIds',
            type: TYPES.array,
        },
        {
            name: 'rewards',
            type: TYPES.array,
        }
    ],
    rooms: [referendaRoom],
}

setTimeout(() => {
    // automatically broadcast votes to users who joined the "referenda" room.
    const { socket } = broadcast
    const maxMultiplier = 256
    let autoUpdate = false
    let delayMultiplier = 1
    let resultPromise
    let timeoutId
    // First 3 updates, every 30 seconds, then gradually slow down towards max multiplier.
    // Reset after new user joins.
    const slowDown = deferred((multiplier = 2) => {
        if (multiplier >= 512 || !autoUpdate) return autoUpdate = false

        delayMultiplier = multiplier

        const nextMultiplier = multiplier * 2
        const ms = delayMs * nextMultiplier + 1
        clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
            const skip = !autoUpdate
                || delayMultiplier !== multiplier // multiplier changed (new user joined) =>> a new timer has started
                || multiplier >= maxMultiplier
            if (skip) return

            clearTimeout(timeoutId)

            slowDown(nextMultiplier)
        }, ms)
    }, delayMs * 3 + 1)
    const startAutoBroadcast = async () => {
        autoUpdate = true
        do {
            resultPromise = PromisE(subscan.referendaGetVotesBatch(referendaIds))
                .catch(_err => { })
            const result = await resultPromise
            !!result && broadcast(
                handleGetVotes.eventName,
                [result],
                {
                    rooms: [referendaRoom],
                    volatile: true, // use UDP instead of TCP for better performance
                }
            )

            for (let i = 0;i < delayMultiplier;i++) {
                if (!autoUpdate) return // exit
                await PromisE.delay(delayMs)
            }
        } while (autoUpdate)
    }
    // https://socket.io/docs/v4/rooms/
    // Room events: 'create-room', 'delete-room', 'join-room', 'leave-room'
    socket.of('/').adapter.on('delete-room', (room) => {
        if (room !== referendaRoom) return
        autoUpdate = false
    })
    socket.of('/').adapter.on('join-room', (room, clientId) => {
        if (room !== referendaRoom) return

        delayMultiplier = 1
        clearTimeout(timeoutId)
        slowDown(2)
        emitToClients(
            clientId,
            'referenda-rewards',
            [referendaIds, referendaRewards, 'KAPEX']
        )
        if (!autoUpdate) return startAutoBroadcast()

        // Immediately send cached result to user.
        // User may receive the first result twice due to race conditions with room broadcast.
        resultPromise?.resolved && resultPromise?.then(result => {
            result && emitToClients(
                clientId,
                handleGetVotes.eventName,
                [result]
            )
        })
    })
}, 10)
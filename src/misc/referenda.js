import { BehaviorSubject } from 'rxjs'
import { clientListenables } from '../system'
import {
    ROLE_ADMIN,
    broadcast,
    emitToClients
} from '../users'
import PromisE from '../utils/PromisE'
import SubscanHelper from '../utils/substrate/SubscanHelper'
import {
    deferred,
    isArr,
    isDefined,
    isFn,
    isInteger,
    isMap
} from '../utils/utils'
import { TYPES } from '../utils/validator'
import DataStorage from '../utils/DataStorage'
import { subjectAsPromise } from '../utils/rx'

const apiKey = process.env.SUBSCAN_API_KEY
const broadcastEvent = 'referenda-list-with-votes'
const delayMs = parseInt(process.env.Referenda_Update_DelayMS) || 60_000
const delaySlowDown = process.env.Referenda_Update_SlowDown !== 'FALSE'
const votingActiveStatuses = [
    'Submitted',
    'Decision',
]
let referendaList, listTsLastUpdated
const referendaRoom = 'referenda'
const referendaIds = (process.env.Referenda_IDs || '')
    .split(',')
    .map(n => parseInt(n))
    .filter(isInteger)
const referendaRewards = (process.env.Referenda_Rewards || '')
    .split(',')
    .map(n => Number(n))
const referendaCache = new DataStorage('referenda-cache')
const subscan = new SubscanHelper('polkadot', apiKey)

/**
 * @name    getReferendaList
 * @summary get list of Polkadot OpenGov/V2 referendums
 * 
 * @param {Function} callback
 */
export const getReferendaList = async callback => {
    const now = new Date()
    const shouldUpdate = !referendaList?.pending && (
        callback
        || !referendaList
        || (now - new Date(listTsLastUpdated)) >= 1000 * 60 * 60 // update max once every hour
    )
    if (shouldUpdate) {
        if (!referendaList?.pending) referendaList = PromisE(subscan.referendaGetList({}, true))
        listTsLastUpdated = now
    }
    isFn(callback) && callback(null, await referendaList)
    return referendaList
}
getReferendaList.eventName = 'referenda-get-list'
getReferendaList.params = [{
    name: 'callback',
    required: true,
    type: TYPES.function,
}]
// getReferendaList.requireLogin = [ROLE_ADMIN] // only admin users can use this
getReferendaList.result = {
    name: 'referendums',
    type: TYPES.map
}

/**
 * @name    getVotes
 * @summary fetch/update referenda votes for pre-specified referenda IDs
 * 
 * @param   {String[]}  ids
 * @param   {Function}  callback
 */
export const getVotes = async (ids = referendaIds, callback) => callback?.(
    null,
    await subscan.referendaGetVotesBatch(ids, true)
)
getVotes.description = `Get referenda votes by referenda IDs and/or identity.`
getVotes.eventName = 'referenda-get-votes'
getVotes.params = [
    {
        defaultValue: referendaIds,
        description: 'Referenda IDs and/or identity (SS58 encoded).',
        name: 'ids',
        required: true,
        type: 'array'
    },
    {
        name: 'callback',
        required: true,
        type: TYPES.function,
    },
]
// getVotes.requireLogin = [ROLE_ADMIN]
getVotes.result = {
    description: 'Go here for sample map item (see `data.list` in the `Example Response` section): https://support.subscan.io/#referendumv2-votes.',
    type: TYPES.map,
}
// add listenable events
clientListenables[broadcastEvent] = {
    description: 'Listen for broadcasts of pre-specified Polkadot referenda votes, list of referenda IDs and their associated reward pools. Only available to users (anonymous or logged in) who joins the specified room.',
    eventName: broadcastEvent,
    params: [
        {
            properties: [
                {
                    description: getVotes.result.description,
                    name: 'info',
                    type: TYPES.object,
                },
                {
                    name: 'rewardPool',
                    type: TYPES.number,
                },
                {
                    name: 'tsUpdated',
                    type: TYPES.date,
                },
                {
                    description: 'List of votes for the referendum. Transmitted as 2D Array.',
                    name: 'votes',
                    type: TYPES.map,
                },
            ],
            name: 'referendaListWithVotes',
            type: TYPES.map,
        },
    ],
    rooms: [referendaRoom],
}

setTimeout(() => {
    const log = (...args) => console.log(
        new Date().toISOString().replace(/[A-Z]/g, ' ') + '[REFERENDA]',
        ...args
    )
    // automatically broadcast votes to users who joined the "referenda" room.
    const { adapter } = broadcast.socket.of('/')
    const maxMultiplier = 256
    let delayMultiplier = 1
    let resultPromise
    const rxResult = new BehaviorSubject()
    let timeoutId
    // First 3 updates, every 30 seconds (or whatever is set in `delayMs`), then gradually slow down towards max multiplier.
    // Reset after new user joins.
    const slowDown = deferred((multiplier = 2) => {
        if (!delaySlowDown) return
        if (multiplier >= 512) return

        delayMultiplier = multiplier

        const nextMultiplier = multiplier * 2
        const ms = delayMs * nextMultiplier + 1
        clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
            const skip = delayMultiplier !== multiplier // multiplier changed (user joined) =>> a new timer has started
                || multiplier >= maxMultiplier
            if (skip) return

            clearTimeout(timeoutId)

            slowDown(nextMultiplier)
        }, ms)
    }, delayMs * 3 + 1)
    const getReferendaListNVotes = async () => {
        let allReferenda
        const result = new Map()
        for (let i = 0;i < referendaIds.length;i++) {
            const id = referendaIds[i]
            let entry = referendaCache.get(id)
            if (entry?.votingActive) {
                log(id, 'updating')
                allReferenda ??= await getReferendaList()
                const referendum = allReferenda.get(id)
                const votingActive = votingActiveStatuses.includes(referendum.status)
                log(`${id}: updated. Status: ${referendum.status}. Voting Active: ${votingActive}`)
                if (!referendum) continue

                const votes = await subscan.referendaGetVotes(id, {}, true)
                entry = {
                    info: referendum,
                    rewardPool: referendaRewards?.[i] || 0,
                    tsUpdated: new Date().toISOString(),
                    votes: [...votes],
                    votingActive,
                }
                referendaCache.set(id, entry)
            }
            entry && result.set(id, entry)
        }
        return result
    }
    const broadcastVotes = async () => {
        let votingActive = false
        resultPromise = resultPromise?.pending
            ? resultPromise
            : PromisE(getReferendaListNVotes())
        const result = await resultPromise
        rxResult.next(result)
        broadcast(
            broadcastEvent,
            [result],
            {
                rooms: [referendaRoom],
                volatile: true, // use UDP instead of TCP for better performance
            }
        )
        votingActive = result.size > 0
            && [...result].every(x => x[1]?.votingActive)
        if (!votingActive) return log('Voting not active. Exited auto broadcast.')

        for (let i = 0;i < delayMultiplier;i++) {
            await PromisE.delay(delayMs)
        }
        broadcastVotes()
    }
    // https://socket.io/docs/v4/rooms/
    // Room events: 'create-room', 'delete-room', 'join-room', 'leave-room'
    const resetTimer = () => {
        delayMultiplier = 1
        clearTimeout(timeoutId)
        slowDown(2)
    }
    const handleJoinRoom = async (room, clientId) => {
        if (room !== referendaRoom) return

        delayMultiplier = 1
        clearTimeout(timeoutId)
        slowDown(2)

        // Immediately send cached result to user.
        // User may receive the first result twice due to race conditions with room broadcast.
        const result = isMap(rxResult.value)
            ? rxResult.value
            : await subjectAsPromise(rxResult, isMap)[0]
                .catch(_ => { })
        result && emitToClients(
            clientId,
            broadcastEvent,
            [result],
        )

    }
    // const handleDeleteRoom = () => autoUpdate = false
    const ifRoom = cb => (...args) => args[0] === referendaRoom && cb(...args)
    adapter.on('create-room', ifRoom(resetTimer))
    // adapter.on('delete-room', ifRoom(handleDeleteRoom))
    adapter.on('join-room', ifRoom(handleJoinRoom))
    // adapter.on('leave-room', ifRoom(() => memberCount--))

    broadcastVotes()
}, 10)
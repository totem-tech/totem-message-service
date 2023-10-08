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
    isFn,
    isInteger
} from '../utils/utils'
import { TYPES } from '../utils/validator'

const apiKey = process.env.SUBSCAN_API_KEY
const delayMs = parseInt(process.env.Referenda_Update_DelayMS) || 60_000
let referendaList, listTsLastUpdated
const referendaRoom = 'referenda'
const referendaIds = (process.env.Referenda_IDs || '')
    .split(',')
    .map(n => parseInt(n))
    .filter(isInteger)
const referendaRewards = (process.env.Referenda_Rewards || '')
    .split(',')
    .map(n => Number(n))
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
getReferendaList.requireLogin = [ROLE_ADMIN] // only admin users can use this
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
getVotes.requireLogin = [ROLE_ADMIN]
getVotes.result = {
    description: 'Go here for sample map item (see `data.list` in the `Example Response` section): https://support.subscan.io/#referendumv2-votes.',
    type: TYPES.map,
}
// add listenable events
clientListenables[getVotes.eventName] = {
    description: 'Listen for broadcasts of pre-specified Polkadot referenda votes, list of referenda IDs and their associated reward pools. Only available to users (anonymous or logged in) who joins the specified room.',
    eventName: getVotes.eventName,
    params: [
        getVotes.result,
        {
            name: 'tsUpdated',
            type: TYPES.date,
        },
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
            ],
            name: 'referendaList',
            type: TYPES.map,
        },
    ],
    rooms: [referendaRoom],
}

setTimeout(() => {
    // automatically broadcast votes to users who joined the "referenda" room.
    const { adapter } = broadcast.socket.of('/')
    const maxMultiplier = 256
    let autoUpdate = true
    let delayMultiplier = 1
    let resultPromise
    const rxResult = new BehaviorSubject()
    let timeoutId
    // First 3 updates, every 30 seconds (or whatever is set in `delayMs`), then gradually slow down towards max multiplier.
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
    const getRewardsNInfo = async () => {
        const referendaList = await getReferendaList()
        const map = new Map()
        referendaIds.forEach((id, i) =>
            map.set(id, {
                info: referendaList.get(id),
                rewardPool: referendaRewards?.[i] || 0
            })
        )
        return map
    }
    const broadcastVotes = async () => {
        if (autoUpdate) {
            console.log(new Date().toISOString().slice(11, 19), 'Referenda: updating')
            resultPromise = resultPromise?.pending
                ? resultPromise
                : PromisE(subscan.referendaGetVotesBatch(referendaIds))
            const votes = await resultPromise
                .then(r => {
                    console.log(new Date().toISOString().slice(11, 19), 'Referenda: updated')
                    r.ts = new Date().toISOString()
                    return r
                })
                .catch(_err => { })
            votes && rxResult.next(votes)
            !!votes && broadcast(
                getVotes.eventName,
                [
                    votes,
                    votes.ts,
                    await getRewardsNInfo(),
                ],
                {
                    rooms: [referendaRoom],
                    volatile: true, // use UDP instead of TCP for better performance
                }
            )
        }
        for (let i = 0;i < delayMultiplier;i++) {
            await PromisE.delay(delayMs)
        }
        broadcastVotes()
    }
    // const startAutoBroadcast = async () => {
    //     if (autoUpdate) return
    //     console.log(new Date().toISOString().split(11, 19), 'Referenda: starting autoupdater')
    //     autoUpdate = true
    //     do {
    //         resultPromise = resultPromise?.pending || !autoUpdate
    //             ? resultPromise
    //             : PromisE(subscan.referendaGetVotesBatch(referendaIds))
    //                 .then(r => {
    //                     r.ts = new Date().toISOString()
    //                     return r
    //                 })
    //                 .catch(_err => { })
    //         const votes = await resultPromise
    //         !!votes && broadcast(
    //             getVotes.eventName,
    //             [
    //                 votes,
    //                 votes.ts,
    //                 await getRewardsNInfo(),
    //             ],
    //             {
    //                 rooms: [referendaRoom],
    //                 volatile: true, // use UDP instead of TCP for better performance
    //             }
    //         )

    //         for (let i = 0;i < delayMultiplier;i++) {
    //             if (!autoUpdate) return console.log(new Date().toISOString().split(11, 19), 'Referenda: stopped autoupdater')
    //             await PromisE.delay(delayMs)
    //         }
    //     } while (autoUpdate)
    // }
    // https://socket.io/docs/v4/rooms/
    // Room events: 'create-room', 'delete-room', 'join-room', 'leave-room'
    let memberCount = 0
    const resetTimer = () => {
        autoUpdate = true
        delayMultiplier = 1
        clearTimeout(timeoutId)
        slowDown(2)
    }
    const handleJoinRoom = (room, clientId) => {
        if (room !== referendaRoom) return

        memberCount++
        delayMultiplier = 1
        clearTimeout(timeoutId)
        slowDown(2)
        // if (!autoUpdate) return startAutoBroadcast()

        // Immediately send cached result to user.
        // User may receive the first result twice due to race conditions with room broadcast.
        resultPromise?.resolved && resultPromise
            .then(async votes => {
                votes && emitToClients(
                    clientId,
                    getVotes.eventName,
                    [
                        votes,
                        votes.ts,
                        await getRewardsNInfo(),
                    ],
                )
            })
            .catch(() => { })
    }
    const handleDeleteRoom = () => autoUpdate = false
    const ifRoom = cb => (...args) => args[0] === referendaRoom && cb(...args)
    adapter.on('create-room', ifRoom(resetTimer))
    adapter.on('delete-room', ifRoom(handleDeleteRoom))
    adapter.on('join-room', ifRoom(handleJoinRoom))
    adapter.on('leave-room', ifRoom(() => memberCount--))

    broadcastVotes()
}, 10)
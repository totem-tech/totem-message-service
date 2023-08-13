import { Subject } from 'rxjs'
import { setTexts } from '../language'
import CouchDBStorage from '../utils/CouchDBStorage'
import {
    arrUnique,
    isArr,
    isFn,
    isObj,
    isStr
} from '../utils/utils'
import { TYPES, validateObj } from '../utils/validator'

// Error messages
const messages = {
    idInvalid: 'Only alpha-numeric characters allowed and must start with an alphabet',
}
setTexts(messages)
const defaultFields = [
    '_id',
    'address',
    'id', // same as _id. ToDo: deprecate. Frontend update required.
    'tsCreated',
    'tsUpdated',
    'socialHandles',
    'referredBy',
    'roles',
    // rewards and secret is intentionally left out.
]
export const clients = new Map()
export const dbUsers = new CouchDBStorage(null, 'users', defaultFields)
export const rxUserRegistered = new Subject() // value: {address, clientId, referredBy, userId}
export const rxUserLoggedIn = new Subject() // value: {address, clientId, clientIds, userId}
export const rxWSClientConnected = new Subject() // value: client {id,....}
export const onlineUsers = new Map()
export const userClientIds = new Map()
export const systemUserSymbol = Symbol('I am the system meawser!')
export const onlineSupportUsers = new Map()
// `RegExp` instances are not transferrable through Websocket events.
// Using array make it possible to be sent to frontent/clients through Websocket.
// The utils/validator is configured to automatically create RegExp instance if array is provided.
export const userIdConf = {
    customMessages: {
        regex: messages.idInvalid,
    },
    maxLength: 16,
    minLegth: 3,
    name: 'userId',
    regex: ['^[a-z][a-z0-9]+$'],// /^[a-z][a-z0-9]+$/
    required: true,
    type: TYPES.string,
}
export const secretConf = {
    name: 'secret',
    minLegth: 10,
    maxLength: 64,
    type: TYPES.string,
}
// log with timestamp and tag: "[users]"
export const log = (...args) => console.log(new Date().toISOString(), '[users]', ...args)
export const ROLE_ADMIN = 'admin'
export const ROLE_SUPPORT = 'support'
export const USER_CAPTCHA = 'captcha'
// User IDs for use by the application ONLY.
export const SYSTEM_IDS = Object.freeze([
    // captcha verifier
    'captcha',
    // catch-all type support user ID
    'support',
    // Troll bolx user IDs
    'everyone',
    'trollbox',
    // User ID for the Totem price aggregator micro service
    // This will be used to trigger currency list hash update
    'price_aggregator',
    // rewards confirmation notifications sender
    'rewards',
    // reserved
    'here',
    'me',
    'bot',
    'robot',
    'system',
    'totem',
])
// User IDs reserved for Totem
export const RESERVED_IDS = Object.freeze([
    ...SYSTEM_IDS,
    'accounting',
    'admin',
    'administrator',
    'announcement',
    'announcements',
    'bitcoin',
    'blockchain',
    'ethereum',
    'contact',
    'help',
    'live',
    'polkadot',
    'totem',
    'totemaccounting',
    'totemlive',
    'twitter',
    'facebook',
    'linkedin',
    'medium',
    'tiktok',
    'instragram',
    'pinterest',

    'human',
    'alien',
    'ceo',
    'cfo',
    'websocket',
    'www',
    'open',
    'close',
    'kapex',
    'polkadot',
    'dot',
    'kusama',
    'ksm',
    'bitcoin',
    'btc',
    'ethereum',
    'eth',
])

/**
 * @name    emitToClients
 * @summary Emit websocket message to all connected clients
 * @description Client/receiver will consume the event as follows: 
 * ```JavaScript
 * socket.on(eventName, (...params) => { 
 *     console.log(params)
 * })
 * ```
 * 
 * @param   {String}    eventName   name of the websocket event
 * @param   {Array}     params      (optional) parameters to be supplied to the client
 * @param   {String[]}  ignoreClientIds  (optional) socket client IDs
 */
export const broadcast = (
    eventName,
    params,
    ignoreClientIds = [],
) => {
    if (!isStr(eventName)) return
    ignoreClientIds = isArr(ignoreClientIds)
        ? ignoreClientIds
        : [ignoreClientIds]
    const clientIds = Array.from(clients)
        .map(([clientId]) => clientId)
        .filter(id => !ignoreClientIds.includes(id))
    emitToClients(clientIds, eventName, params)
}

/**
 * @name    emitToClients
 * @summary Emit websocket message to specific clients
 * @description Client/receiver will consume the event as follows: 
 * ```JavaScript
 * socket.on(eventName, (...params) => { 
 *     console.log(params)
 * })
 * ```
 * 
 * @param   {String[]}  clientIds   socket client IDs
 * @param   {String}    eventName   name of the websocket event
 * @param   {Array}     params      (optional) parameters to be supplied to the client
 */
export const emitToClients = (
    clientIds,
    eventName = '',
    params
) => {
    clientIds = isStr(clientIds)
        ? [clientIds]
        : clientIds
    if (!isStr(eventName) || !isArr(clientIds)) return

    if (!isArr(params)) params = [params]

    arrUnique(clientIds)
        .forEach(clientId => {
            const client = isObj(clientId)
                ? clientId
                : clients.get(clientId)
            if (!isArr(params)) console.log({ params })
            client?.emit?.(eventName, ...params)
        })
}

/**
 * @name    emitToUsers
 * @summary Emit websocket message to users and all the clients they are logged into
 * 
 * @param   {String[]}          userIds 
 * @param   {Sting}             eventName
 * @param   {Array}             params          (optional) event parameters. Default: `[]`
 * @param   {String|String[]}   excludeClientId (optional)
 */
export const emitToUsers = (
    userIds,
    eventName,
    params = [],
    excludeClientId,
) => {
    excludeClientId = isArr(excludeClientId)
        ? excludeClientId
        : [excludeClientId]
    arrUnique(userIds || [])
        .forEach(userId => {
            const clientIds = userClientIds.get(userId) || []
            emitToClients(
                clientIds.filter(cid =>
                    !excludeClientId.includes(cid)
                ),
                eventName,
                params,
            )
        })
}

// returns an array of users with role 'support'
export const getSupportUsers = async () => {
    const selector = {
        // select all messages to/from current user
        'roles': { '$all': [ROLE_SUPPORT] }
    }
    return await dbUsers.search(selector, 99, 0, false)
}

/**
 * @name    getUserByClientId
 * @summary get user data by connected socket client ID
 * 
 * @param {String} clientId
 * 
 * @returns {Object} user
 */
export const getUserByClientId = async (clientId) => {
    const { ___userId: userId } = clients.get(clientId) || {}
    return !userId
        ? undefined
        : onlineUsers.get(userId)
}

/**
 * @name    idExists
 * @summary check if each of the supplied user IDs exists
 * 
 * @param   {String|Array} userIds
 * 
 * @returns {Boolean}
 */
export const idExists = async (userIds = []) => {
    if (!userIds || userIds.length === 0) return false

    userIds = isArr(userIds)
        ? userIds
        : [userIds]
    userIds = arrUnique(
        userIds.filter(id =>
            !RESERVED_IDS.includes(id)
        )
    )
    const usersFound = await dbUsers.getAll(userIds, false)
    return userIds.length === usersFound.length
}

// isUserOnline checks if user is online
//
// Params:
// @userId  string
export const isUserOnline = userId => {
    if (userId === ROLE_SUPPORT) return onlineSupportUsers.size > 0
    return !!onlineUsers.get(userId)
}

// cleanup on user client disconnect (and user logout)
export async function handleDisconnect() {
    const [client, user] = this
    clients.delete(client.id)
    if (!user) return // nothing to do

    const clientIds = userClientIds.get(user.id) || []
    const clientIdIndex = clientIds.indexOf(client.id)
    // remove clientId
    clientIds.splice(clientIdIndex, 1)
    const uniqClientIds = arrUnique(clientIds)
    const online = uniqClientIds.length > 0
    if (online) {
        userClientIds.set(user.id, uniqClientIds)
    } else {
        userClientIds.delete(user.id)
        onlineUsers.delete(user.id)
    }

    log('Client disconnected | User ID:', user.id, ' | Client ID: ', client.id)

    if (!onlineSupportUsers.get(user.id) || online) return
    // support user went offline
    onlineSupportUsers.delete(user.id)
}

export const setup = async () => {
    const db = await dbUsers.getDB()
    // create indexes for the users collection, ignores if index already exists
    const indexDefs = [
        {
            index: { fields: ['address'] },
            name: 'address-index',
        },
        {
            index: { fields: ['roles'] },
            name: 'roles-index',
        },
    ]
    await Promise.all(
        indexDefs.map(def =>
            db.createIndex(def)
        )
    )

    // create design document to enable case-insensitive search of twitter handles
    await dbUsers.viewCreateMap(
        'lowercase',
        'twitterHandle',
        `function (doc) {
            if(!(doc.socialHandles || {}).twitter) return
            emit(doc.socialHandles.twitter.handle.toLowerCase(), null)
        }`
    )
}
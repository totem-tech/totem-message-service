import { Subject } from 'rxjs'
import { setTexts } from '../language'
import CouchDBStorage from '../utils/CouchDBStorage'
import {
    arrUnique,
    isArr,
    isFn,
    isMap,
    isObj,
    isStr
} from '../utils/utils'
import { TYPES } from '../utils/validator'

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
export const onlineSupportUsers = new Map()
export const onlineUsers = new Map()
// Stores number of clients by origin
export const originClients = new Map()
// Subjet triggered whenever a new connections is esablished or disconnected
// value: { client, connected: boolean, host }
export const rxClientConnection = new Subject()
export const rxUserRegistered = new Subject() // value: {address, clientId, referredBy, userId}
export const rxUserLoggedIn = new Subject() // value: {address, clientId, clientIds, userId}
export const systemUserSymbol = Symbol('I am the system meawser!')
export const userClientIds = new Map()
export const userRoomPrefix = 'user::'
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
    'cdp',
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
    'script',
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
 * @param   {String}    eventName    name of the websocket event
 * @param   {Array}     params       (optional) parameters to be supplied to the client
 * @param   {Object|String[]} config (optional) if Array, socket client IDs. If Object, below properties are accepted.
 * @param   {String[]}  config.ignore (optional) ignore rooms/client IDs. A client ID is by default is also a room.
 * @param   {String}    config.namespace (optional) broadcast to a specific namespace only
 * @param   {String[]}  config.rooms    (optional) broadcast to specific rooms only. If namespace is specified, only rooms within the namespace will be included.
 */
export const broadcast = (
    eventName,
    params,
    config,
) => {
    if (!isStr(eventName) || !eventName) return

    if (!isArr(params)) params = [params]

    const {
        ignore = isArr(config) && config || [],
        rooms = [],
        namespace,
        volatile = false,
    } = isObj(config) && config || {}

    let { socket: io } = broadcast
    if (volatile) io = io.volatile
    if (namespace) io = io.of(namespace)
    if (rooms.length) io = io.to(...rooms)
    if (ignore?.length) io = io.except?.(...toClientIds(ignore)) || io
    return io.emit(eventName, ...toParams(params))
}
broadcast.socket = null

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
 * @param {String[]|Object[]}   clientIds   socket clients or IDs
 * @param {String}              eventName   name of the websocket event
 * @param {Array}               params      (optional) parameters to be supplied to the client
 */
export const emitToClients = (
    clientIds,
    eventName = '',
    params
) => {
    clientIds = toClientIds(clientIds)
    if (!isStr(eventName) || !isArr(clientIds) || !clientIds.length) return
    if (!isArr(params)) params = [params]

    if (broadcast.socket) return broadcast
        .socket
        .to(...clientIds)
        .emit(eventName, ...toParams(params))
}

/**
 * @name    emitToUsers
 * @summary Emit websocket message to users and all the clients they are logged into
 * 
 * @param   {String[]}          userIds 
 * @param   {Sting}             eventName
 * @param   {Array}             params          (optional) event parameters. Default: `[]`
 * @param   {String|String[]}   excludeClientIds (optional)
 */
export const emitToUsers = (
    userIds,
    eventName,
    params = [],
    excludeClientIds,
) => {
    excludeClientIds = toClientIds(excludeClientIds)
    userIds = arrUnique(userIds || [])
    if (!userIds.length) return

    const userRooms = userIds.map(id => `${userRoomPrefix}${id}`)
    let socket = broadcast
        ?.socket
        ?.in(...userRooms)
    if (excludeClientIds.length) socket = socket?.except?.(...excludeClientIds) || socket
    return socket?.emit?.(eventName, ...toParams(params))
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

const toClientIds = clientIds => (
    isArr(clientIds)
        ? clientIds
        : [clientIds]
)
    .filter(Boolean)
    .map(id =>
        isObj(id)
            ? id.id // client socket
            : id
    )

const toParams = (params = []) => params.map(param =>
    isMap(param)
        ? [...param] // convert Map to 2D Array
        : param
)
import CouchDBStorage from './CouchDBStorage'
import { arrUnique, isArr, isFn, isStr } from './utils/utils'
import { setTexts } from './language'

const users = new CouchDBStorage(null, 'users')
export const clients = new Map()
export const userClientIds = new Map()
const isValidId = id => /^[a-z][a-z0-9]+$/.test(id)
const idMaxLength = 16
const idMinLength = 3
// Error messages
const messages = setTexts({
    idInvalid: `Only alpha-numeric characters allowed and must start with an alphabet`,
    idLengthMax: 'Maximum number of characters allowed',
    idLengthMin: 'Minimum number of characters required',
    idExists: 'User ID already taken',
    invalidSecret: 'Secret must be a valid string',
    invalidUserID: 'Invalid User ID',
    loginFailed: 'Credentials do not match',
    loginOrRegister: 'Login/registration required',
    msgLengthExceeds: 'Maximum characters allowed',
    reservedIdLogin: 'Cannot login with a reserved User ID',
})
// User IDs for use by the application ONLY.
export const SYSTEM_IDS = Object.freeze([
    'everyone',
    'here',
    'me'
])
export const ROLE_SUPPORT = 'support'
// User IDs reserved for Totem
export const RESERVED_IDS = Object.freeze([
    ...SYSTEM_IDS,
    'accounting',
    'admin',
    'administrator',
    'live',
    'support',
    'totem',
    'trollbox',
])
const onUserLoginCallbacks = []
const _execOnUserLogin = userId => setTimeout(() => onUserLoginCallbacks.forEach(fn => fn(userId)))
// initialize
setTimeout(async () => {
    // create an index for the field `timestamp`, ignores if already exists
    const indexDefs = [{
        index: { fields: ['roles'] },
        name: 'roles-index',
    }]
    indexDefs.forEach(async (def) => await (await users.getDB()).createIndex(def))
})

// Broadcast message to all users except ignoreClientIds
//
// Params:
// @ignoreClientIds  array: client IDs to skip.
// @eventName        string: websocket event name
// @params           array:  parameters to be supplied to the client
export const broadcast = (ignoreClientIds, eventName, params) => {
    if (!isStr(eventName)) return;
    ignoreClientIds = isArr(ignoreClientIds) ? ignoreClientIds : [ignoreClientIds]
    const clientIds = Array.from(clients).map(([clientId]) => clientId)
        .filter(id => ignoreClientIds.indexOf(id) === -1)
    emitToClients(clientIds, eventName, params)
}

/*
 *
 * Websocket event emitter function
 * 
 */
// Emit to specific clients by ids
//
// Params: 
// @clientIds   array
// @eventName   string: name of the websocket event
// @params      array: parameters to be supplied to the client
// 
// Example: 
// Client/receiver will consume the event as follows: 
//      socket.on(eventName, param[0], param[1], param[2],...)
export const emitToClients = (clientIds = [], eventName = '', params = []) => eventName && arrUnique(clientIds).forEach(clientId => {
    const client = clients.get(clientId)
    client && client.emit.apply(client, [eventName].concat(params))
})

// Emit to users (everywhere the user is logged in)
//
// Params:
// @userIds     array
// @eventName   string: websocket event name
// @params      array: parameters to be supplied to the client
export const emitToUsers = (userIds = [], eventName = '', params = [], excludeClientId) => arrUnique(userIds).forEach(userId => {
    const clientIds = userClientIds.get(userId) || []
    emitToClients(clientIds.filter(cid => cid !== excludeClientId), eventName, params)
})

// returns an array of users with role 'support'
export const getSupportUsers = async () => {
    const selector = {
        // select all messages to/from current user
        'roles': { '$all': [ROLE_SUPPORT] }
    }
    return await users.search(selector, true, true, false, 99, 0, false)
}

// findUserByClientId seeks out user ID by connected client ID
//
// Params:
// @clientId    string
//
// returns object
export const getUserByClientId = async (clientId) => {
    const userId = Array.from(userClientIds)
        .filter(([_, clientIds]) => clientIds.indexOf(clientId) >= 0)
        .map(([userId]) => userId)[0]

    if (!userId) return
    return await users.get(userId)
}

// idExists
export const idExists = async (userId) => {
    if (RESERVED_IDS.includes(userId)) return true
    return !!(await users.get(userId))
}

// isUserOnline checks if user is online
//
// Params:
// @userId  string
export const isUserOnline = userId => (userClientIds.get(userId) || []).length > 0

// onUserLogin registers callbacks to be executed on any user login occurs
//
// Params:
// @callback    function: params => (@loggedInUserId string)
export const onUserLogin = callback => isFn(callback) && onUserLoginCallbacks.push(callback)

/*
 *
 * event handlers
 * 
 */
// user checks they have 'support' role
export async function handleAmISupport(callback) {
    if (!isFn(callback)) return
    const client = this
    const user = await getUserByClientId(client.id)
    if (!user) return callback(messages.loginOrRegister)
    callback(null, (user.roles || []).includes(ROLE_SUPPORT))
}

// cleanup on user client disconnect
export async function handleDisconnect() {
    const client = this
    clients.delete(client.id)
    const user = await getUserByClientId(client.id)
    if (!user) return;

    const clientIds = userClientIds.get(user.id) || []
    const clientIdIndex = clientIds.indexOf(client.id)
    // remove clientId
    clientIds.splice(clientIdIndex, 1)
    userClientIds.set(user.id, arrUnique(clientIds))
    console.info('Client disconnected: ', client.id, ' userId: ', user.id)
}

// check if user id exists
//
// Params:
// @userId      string
// @callback    function: (required) args:
//                  @err    string: error message, if any
//                  @exists boolean
export const handleIdExists = async (userId, callback) => isFn(callback) && callback(null, await idExists(userId))

// check if user is/are online
//
// Params:
// @userId      string/array
// @callback    function: Arguments =>
//                  @err        string: error message, if applicable
//                  @online     bool/object: boolean for signle id and object if array of user Ids supplied in @userId
export const handleIsUserOnline = async (userId, callback) => {
    if (!isFn(callback)) return
    if (!isArr(userId)) return callback(null, isUserOnline(userId))

    const userIds = arrUnique(userId).filter(id => isStr(id))
    const result = {}
    for (let i = 0; i < userIds.length; i++) {
        result[userIds[i]] = isUserOnline(userIds[i])
    }
    callback(null, result)
}


// user login 
//
// Params:
// @userId      string
// @secret      string
// @callback    function: args => 
//                  @err    string: error message if login fails
export async function handleLogin(userId, secret, callback) {
    const client = this
    if (!isFn(callback)) return
    // prevent login with a reserved id
    if (RESERVED_IDS.includes(userId)) return callback(texts.reservedId)
    const user = await users.get(userId)
    const valid = user && user.secret === secret
    if (valid) {
        const clientIds = userClientIds.get(user.id) || []
        clientIds.push(client.id)
        userClientIds.set(user.id, arrUnique(clientIds))
        clients.set(client.id, client)
    }

    console.info('Login ' + (!valid ? 'failed' : 'success') + ' | ID:', userId, '| Client ID: ', client.id)
    callback(valid ? null : messages.loginFailed)
    _execOnUserLogin(userId)
}

// user registration
//
// Params:
// @userId      string
// @secret      string
// @callback    function: args:
//                  @err        string: error message, if any
export async function handleRegister(userId, secret, callback) {
    if (!isFn(callback)) return
    const client = this
    userId = (userId || '').toLowerCase()
    secret = (secret || '').trim()
    // prevent registration with a reserved id
    if (RESERVED_IDS.includes(userId)) return callback(texts.reservedId)
    if (await users.get(userId)) return callback(messages.idExists)
    if (!isValidId(userId)) return callback(messages.idInvalid)
    if (userId.length > idMaxLength) return callback(`${messages.idLengthMax}: ${idMaxLength}`)
    if (userId.length < idMinLength) return callback(`${messages.idLengthMin}: ${idMinLength}`)
    if (!isStr(secret) || !secret) return callback(messages.invalidSecret)
    const newUser = {
        id: userId,
        secret: secret,
    }
    await users.set(userId, newUser)
    clients.set(client.id, client)
    userClientIds.set(userId, [client.id])
    console.info('New User registered:', userId)
    callback()
    _execOnUserLogin(userId)
}
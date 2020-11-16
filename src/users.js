import CouchDBStorage from './CouchDBStorage'
import { arrUnique, isArr, isFn, isStr } from './utils/utils'
import { setTexts } from './language'
import { TYPES, validateObj } from './utils/validator'
import { handleNotification } from './notification'

const users = new CouchDBStorage(null, 'users')
export const clients = new Map()
export const userClientIds = new Map()
const onlineSupportUsers = new Map()
const userIdRegex = /^[a-z][a-z0-9]+$/
// Error messages
const messages = setTexts({
    alreadyRegistered: 'You have already registered! Please contact support for instructions if you wish to get a new user ID.',
    idInvalid: 'Only alpha-numeric characters allowed and must start with an alphabet',
    idExists: 'User ID already taken',
    invalidReferralCode: 'invalid referral code',
    invalidUserID: 'Invalid User ID',
    loginFailed: 'Credentials do not match',
    loginOrRegister: 'Login/registration required',
    msgLengthExceeds: 'Maximum characters allowed',
    referralSuccess: 'signed up using your referral code',
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
// initialize
setTimeout(async () => {
    // create an index for the field `roles`, ignores if already exists
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
    return await users.search(selector, 99, 0, false)
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
    userIds = isArr(userIds) ? userIds : [userIds]
    userIds = userIds.filter(id => !RESERVED_IDS.includes(id))

    const usersFound = await users.getAll(userIds, false)
    return userIds.length === usersFound.length
}

// isUserOnline checks if user is online
//
// Params:
// @userId  string
export const isUserOnline = userId => {
    if (userId === ROLE_SUPPORT) return onlineSupportUsers.size > 0
    return (userClientIds.get(userId) || []).length > 0
}

// cleanup on user client disconnect
export async function handleDisconnect() {
    const client = this
    clients.delete(client.id)
    const user = await getUserByClientId(client.id)
    if (!user) return // nothing to do

    const clientIds = userClientIds.get(user.id) || []
    const clientIdIndex = clientIds.indexOf(client.id)
    // remove clientId
    clientIds.splice(clientIdIndex, 1)
    userClientIds.set(user.id, arrUnique(clientIds))
    console.info('Client disconnected: userId', user.id, ' | Client ID: ', client.id)

    if (!onlineSupportUsers.get(user.id) || clientIds.length > 0) return
    // user is not online
    onlineSupportUsers.delete(user.id)
}

/**
 * @name    handleIdExists
 * @summary check if user ID(s) exists
 * 
 * @param   {String|Array}  userIds 
 * @param   {Function}      callback 
 * 
 * @returns {Boolean}       true if all supplied IDs exists, otherwise, false.
 */
export const handleIdExists = async (userIds, callback) => isFn(callback) && callback(null, await idExists(userIds))

/**
 * @name    handleIsUserOnline
 * @summary check if user is/are online
 * 
 * @param {String|Array}    userId
 * @param {Function}        callback    : Arguments =>
 *                  @err        string: error message, if applicable
 *                  @online     bool/object: boolean for signle id and object if array of user Ids supplied in @userId
 */
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
handleIsUserOnline.requireLogin = true


/**
 * @name    handleLogin
 * @summary user login event handler
 * 
 * @param   {String}      userId 
 * @param   {String}      secret 
 * @param   {Function}    callback args => @err string: error message if login fails
 */
export async function handleLogin(userId, secret, callback) {
    if (!isFn(callback)) return
    // prevent login with a reserved id
    if (RESERVED_IDS.includes(userId)) return callback(messages.reservedId)
    const client = this
    const user = await users.get(userId)
    const valid = user && user.secret === secret
    console.info('Login ' + (!valid ? 'failed' : 'success') + ' | ID:', userId, '| Client ID: ', client.id)
    if (!valid) return callback(messages.loginFailed)
    const { roles = [] } = user
    const clientIds = userClientIds.get(user.id) || []
    clientIds.push(client.id)
    userClientIds.set(user.id, arrUnique(clientIds))
    clients.set(client.id, client)
    if (roles.includes(ROLE_SUPPORT)) onlineSupportUsers.set(user.id, true)

    callback(null, { roles })
}

/**
 * @name    handleRegister
 * @summary user registration event handler
 * 
 * @param   {String}    userId 
 * @param   {String}    secret 
 * @param   {String}    referredBy (optional) referrer user ID
 * @param   {Function}  callback  args => @err string: error message if registration fails
 */
export async function handleRegister(userId, secret, referredBy, callback) {
    if (!isFn(callback)) return
    const client = this
    // prevent registered user's attempt to register again!
    const user = await getUserByClientId(client.id)
    if (user) return callback(messages.alreadyRegistered)
    
    const newUser = {
        id: userId,
        referredBy,
        tsCreated: new Date(),
        secret,
    }
    const err = validateObj(newUser, handleRegister.validationConfig, true, true)
    if (err) return callback(err)

    // get rid of any leading and trailing spaces
    userId = userId.trim()
    // check if user ID already exists
    if (await idExists([userId])) return callback(messages.idExists)

    const isReferrerValid = referredBy && await idExists([referredBy])
    // check if referrer ID is valid
    if (referredBy && !isReferrerValid) return callback(messages.invalidReferralCode)
        
    // save user data to database
    await users.set(userId, newUser)
    // add to websocket client list
    clients.set(client.id, client)
    // add client ID to user's clientId list
    userClientIds.set(userId, [client.id])
    console.info('New User registered:', userId)
    callback()

    // notify referrer, if any
    isReferrerValid && handleNotification.call(
        [client, newUser],
        [referredBy],
        'user',
        'referralSuccess',
        messages.referralSuccess,
        null,
        () => { }, // placeholder for required callback argument
    )
}
handleRegister.validationConfig = {
    id: {
        customMessages: {
            regex: messages.idInvalid,
            reject: messages.idExists,
        },
        maxLength: 16,
        minLegth: 3,
        regex: userIdRegex,
        reject: RESERVED_IDS,
        required: true,
        type: TYPES.string,
    },
    referredBy: {
        maxLength: 16,
        minLegth: 3,
        regex: userIdRegex,
        reject: RESERVED_IDS,
        required: false,
        type: TYPES.string,
    },
    secret: {
        minLegth: 10,
        maxLength: 64,
        type: TYPES.string,
    },
}
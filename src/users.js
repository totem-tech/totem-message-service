import { Subject } from 'rxjs'
import CouchDBStorage from './utils/CouchDBStorage'
import { arrUnique, isArr, isFn, isObj, isStr } from './utils/utils'
import { TYPES, validateObj } from './utils/validator'
import { setTexts } from './language'

let signupCount = 0
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
export const users = new CouchDBStorage(null, 'users', defaultFields)
export const rxUserRegistered = new Subject() // value: [userId, clientId, referredBy]
export const rxUserLoggedIn = new Subject() // value: [userId, clientIds]
export const clients = new Map()
export const userClientIds = new Map()
export const systemUserSymbol = Symbol('I am the system meawser!')
const onlineSupportUsers = new Map()
const userIdRegex = /^[a-z][a-z0-9]+$/
const getTime = () => new Date().toISOString()
const log = (...args) => console.log(getTime(), '[users]', ...args)
// Error messages
const messages = setTexts({
    alreadyRegistered: `
        You have already registered!
        Please contact support for instructions if you wish to get a new user ID.`,
    idInvalid: 'Only alpha-numeric characters allowed and must start with an alphabet',
    idExists: 'User ID already taken',
    invalidUserID: 'Invalid User ID',
    loginFailed: 'Credentials do not match',
    loginOrRegister: 'Login/registration required',
    msgLengthExceeds: 'Maximum characters allowed',
    strOrObjRequired: 'Valid string or object required',
    reservedIdLogin: 'Cannot login with a reserved User ID',
})
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

// Broadcast message to all users except ignoreClientIds
//
// Params:
// @ignoreClientIds  array: client IDs to skip.
// @eventName        string: websocket event name
// @params           array:  parameters to be supplied to the client
export const broadcast = (ignoreClientIds, eventName, params) => {
    if (!isStr(eventName)) return
    ignoreClientIds = isArr(ignoreClientIds)
        ? ignoreClientIds
        : [ignoreClientIds]
    const clientIds = Array.from(clients)
        .map(([clientId]) => clientId)
        .filter(id => !ignoreClientIds.includes(id))
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
export const emitToUsers = (userIds = [], eventName, params = [], excludeClientId) => arrUnique(userIds)
    .forEach(userId => {
        const clientIds = userClientIds.get(userId) || []
        emitToClients(
            clientIds.filter(cid => cid !== excludeClientId),
            eventName,
            params,
        )
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
    userIds = isArr(userIds)
        ? userIds
        : [userIds]
    userIds = userIds.filter(id =>
        !RESERVED_IDS.includes(id)
    )

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

    const clientIds = userClientIds.get(user._id) || []
    const clientIdIndex = clientIds.indexOf(client.id)
    // remove clientId
    clientIds.splice(clientIdIndex, 1)
    const uniqClientIds = arrUnique(clientIds)

    uniqClientIds.length > 0
        ? userClientIds.set(user._id, uniqClientIds)
        : userClientIds.delete(user._id)
    log('Client disconnected | User ID:', user._id, ' | Client ID: ', client.id)

    if (!onlineSupportUsers.get(user._id) || clientIds.length > 0) return
    // user is not online
    onlineSupportUsers.delete(user._id)
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
    const user = await users.find({ _id: userId, secret })
    log(`Login ${!user ? 'failed' : 'success'} | User ID: ${userId} | Client ID: ${client.id}`)
    if (!user) return callback(messages.loginFailed)

    const { roles = [] } = user
    const clientIds = userClientIds.get(user._id) || []
    clientIds.push(client.id)
    userClientIds.set(user._id, arrUnique(clientIds))
    clients.set(client.id, client)
    if (roles.includes(ROLE_SUPPORT)) onlineSupportUsers.set(user._id, true)

    console.log('Users online:', userClientIds.size)
    callback(null, { roles })
}

/**
 * @name    handleRegister
 * @summary user registration event handler
 * 
 * @param   {String}            userId 
 * @param   {String}            secret 
 * @param   {String|Object}     referredBy          (optional) referrer user ID or social handle reference as following:
 *                                                      `${handle}@${platform}`
 *                                                  Example: 'twitter_user@twitter'
 * @param   {String}            referredBy.handle   Social media user identifier
 * @param   {String}            referredBy.platform Social media platform identitifier. Eg: 'twitter'
 * @param   {Function}  callback  args => @err string: error message if registration fails
 */
export async function handleRegister(userId, secret, address, referredBy, callback) {
    if (!isFn(callback)) return
    const client = this
    // prevent registered user's attempt to register again!
    const user = await getUserByClientId(client.id)
    if (user) return callback(messages.alreadyRegistered)

    if (isStr(referredBy) && referredBy.includes('@')) {
        const [handle, platform] = referredBy.split('@')
        referredBy = { handle, platform }
    }

    const tsCreated = new Date()
    const newUser = {
        address,
        id: userId,
        secret,
        socialHandles: {},
        tsCreated,
    }
    const conf = { ...handleRegister.validationConfig }
    // make sure users don't use themselves as referrer
    conf.referredBy = {
        ...conf.referredBy,
        reject: userId,
    }
    const err = validateObj(newUser, conf, true, true)
    if (err) return callback(err)

    // get rid of any leading and trailing spaces
    userId = userId.trim()
    // check if user ID already exists
    if (await idExists([userId])) return callback(messages.idExists)

    if (isStr(referredBy)) {
        // direct referral by user ID
        const { _id } = await users.get(referredBy) || {}
        // removes referrer ID if referrer user not found
        referredBy = _id
    } else if (isObj(referredBy) && !!referredBy.handle) {
        // Check if referrer user is valid and referrer's social handle has been verified
        let referrer
        let { handle, platform } = referredBy
        handle = `${handle}`.toLowerCase()

        if (platform === 'twitter') {
            // lowercase twitter handle search using custom view
            referrer = (await users.view('lowercase', 'twitterHandle', { key: handle }))[0]
        } else {
            // referral through other platforms
            referrer = await users.find({
                [`socialHandles.${platform}.handle`]: handle,
                [`socialHandles.${platform}.verified`]: true
            })

        }

        // ignore if referrer and referred user's address is the same
        referredBy = !referrer || referrer.address === address
            ? undefined
            : {
                handle,
                platform,
                userId: referrer._id,
            }
    } else {
        referredBy = undefined
    }

    await users.set(userId, { ...newUser, referredBy })
    // add to websocket client list
    clients.set(client.id, client)
    // add client ID to user's clientId list
    log('New User registered:', JSON.stringify({ userId, referredBy }))
    console.log('signupCount:', ++signupCount)
    userClientIds.set(userId, [client.id])

    rxUserRegistered.next({
        clientId: client.id,
        userId,
        referredBy,
    })
    callback(null)
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
        customMessages: {
            object: messages.strOrObjRequired,
        },
        // alternatively accept an object with following properties: handle and platform 
        or: {
            required: true,
            type: TYPES.object,
            config: {
                handle: {
                    minLegth: 3,
                    required: true,
                    type: TYPES.string,
                },
                platform: {
                    minLegth: 3,
                    required: true,
                    type: TYPES.string,
                },
            }
        }
    },
    secret: {
        minLegth: 10,
        maxLength: 64,
        type: TYPES.string,
    },
}
setTimeout(async () => {
    // create an index for the field `roles`, ignores if already exists
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
    indexDefs.forEach(async (def) =>
        await (await users.getDB()).createIndex(def)
    )

    // create design document to enable case-insensitive search of twitter handles
    const designDoc = await users.getDoc('_design/lowercase')
    const views = {
        twitterHandle: {
            map: `function (doc) {
                if(!(doc.socialHandles || {}).twitter) return
                emit(doc.socialHandles.twitter.handle.toLowerCase(), null)
            }`
        }
    }
    const updateRequired = !designDoc || Object.keys(views)
        .find(key => !(designDoc.views || {})[key])
    if (!updateRequired) return

    log('Creating design document: users/_design/lowercase')
    await users.set('_design/lowercase', { views, language: 'javascript' })
})
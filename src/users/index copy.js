import { Subject } from 'rxjs'
import CouchDBStorage from '../utils/CouchDBStorage'
import { arrUnique, isArr, isFn, isObj, isStr } from '../utils/utils'
import { TYPES, validateObj } from '../utils/validator'
import { setTexts } from '../language'

// Error messages
const messages = {
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
}
setTexts(messages)
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
export const rxUserRegistered = new Subject() // value: {address, clientId, referredBy, userId}
export const rxUserLoggedIn = new Subject() // value: {address, clientId, clientIds, userId}
export const rxWSClientConnected = new Subject() // value: client {id,....}
export const clients = new Map()
export const onlineUsers = new Map()
export const userClientIds = new Map()
export const systemUserSymbol = Symbol('I am the system meawser!')
const onlineSupportUsers = new Map()
// `RegExp` instances are not transferrable through Websocket events.
// Using array make it possible to be sent to frontent/clients through Websocket.
// The utils/validator is configured to automatically create RegExp instance if array is provided.
const userIdRegex = ['^[a-z][a-z0-9]+$'] // /^[a-z][a-z0-9]+$/
const userIdConf = {
    customMessages: {
        regex: messages.idInvalid,
    },
    maxLength: 16,
    minLegth: 3,
    name: 'userId',
    regex: userIdRegex,
    required: true,
    type: TYPES.string,
}
const secretConf = {
    name: 'secret',
    minLegth: 10,
    maxLength: 64,
    type: TYPES.string,
}
const log = (...args) => console.log(new Date().toISOString(), '[users]', ...args)
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

/**
 * @name    broadcastCRUD
 * @summary broadcast to all clients about changes in data
 * 
 * @param   {String} id 
 * @param   {String} type 
 * @param   {String} action // create,read,update,delete
 * @param   {Object} data (optional) typically entry. Can vary based on specific type
 */
export const broadcastCRUD = (type, id, action, data) => {
    const err = validateObj(
        {
            action,
            data,
            id,
            type,
        },
        broadcastCRUD.conf
    )
    if (err) return err
    broadcast([], 'CRUD', {
        data,
        id,
        type,
        type,
    })
}
broadcastCRUD.actions = {
    create: 'create',
    delete: 'delete',
    read: 'read',
    update: 'update',
}
broadcastCRUD.conf = Object.freeze({
    action: {
        // only these values are valid
        accept: Object.values(broadcastCRUD.actions),
        required: true,
        type: TYPES.string,
    },
    data: { type: TYPES.object },
    id: {
        required: true,
        type: TYPES.string,
    },
    type: {
        required: true,
        type: TYPES.string,
    },
})

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
    const client = isObj(clientId)
        ? clientId
        : clients.get(clientId)
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
    // const userId = Array.from(userClientIds)
    //     .filter(([_, clientIds]) => clientIds.indexOf(clientId) >= 0)
    //     .map(([userId]) => userId)[0]

    // if (!userId) return
    // return await users.get(userId)
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
    const usersFound = await users.getAll(userIds, false)
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

// cleanup on user client disconnect
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

/**
 * @name    handleIdExists
 * @summary check if user ID(s) exists
 * 
 * @param   {String|Array}  userId 
 * @param   {Function}      callback 
 * 
 * @returns {Boolean}       true if all supplied IDs exists, otherwise, false.
 */
export const handleIdExists = async (userId, callback) => {
    isFn(callback) && callback(null, await idExists(userId))
}
handleIdExists.description = 'Check if user ID(s) exists.'
handleIdExists.params = [
    {
        description: 'Single user ID',
        name: 'userId',
        required: true,
        type: TYPES.string,
        or: {
            description: 'Alternatively, provide an array of user IDs to check if all of them exists.',
            required: true,
            type: TYPES.array,
        },
    },
    {
        name: 'callback',
        params: [
            { name: 'error', type: TYPES.string },
            { name: 'exists', type: TYPES.boolean },
        ],
        required: true,
        type: TYPES.function,
    },
]

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
    for (let i = 0;i < userIds.length;i++) {
        result[userIds[i]] = isUserOnline(userIds[i])
    }
    callback(null, result)
}
handleIsUserOnline.description = 'Check if one or more users are online.'
handleIsUserOnline.requireLogin = true
handleIsUserOnline.params = [
    {
        description: 'Single user ID',
        name: 'userId',
        required: true,
        type: TYPES.string,
        or: {
            description: 'Alternatively, provide an array of user IDs to check if all of them exists.',
            required: true,
            type: TYPES.array,
        },
    },
    {
        name: 'callback',
        params: [
            { name: 'error', type: TYPES.string },
            {
                name: 'online',
                type: TYPES.boolean,
                or: {
                    description: 'Alternative result when array of user IDs provided. Key: userId, value: boolean',
                    type: TYPES.object,
                }
            },
        ],
        required: true,
        type: TYPES.function,
    },
]


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

    const [client] = this
    const user = await users.find({ _id: userId, secret })
    const {
        handshake: {
            headers: { origin = '' } = {},
        } = {},
    } = client
    log(`Login ${!user ? 'failed' : 'success'} | User ID: ${userId} | Client ID: ${client.id} | Origin: `, origin)
    if (!user) return callback(messages.loginFailed)

    const { address, roles = [] } = user
    const clientIds = userClientIds.get(user.id) || []
    clientIds.push(client.id)
    userClientIds.set(user.id, arrUnique(clientIds))
    // attach userId to client object
    client.___userId = userId
    onlineUsers.set(userId, user)
    clients.set(client.id, client)
    rxUserLoggedIn.next({
        clientId: client.id,
        clientIds,
        userId,
    })
    if (roles.includes(ROLE_SUPPORT)) onlineSupportUsers.set(user.id, true)

    console.log('Users online:', userClientIds.size)
    callback(null, { address, roles })
}
handleLogin.description = 'User login'
// allow request even during maintenance mode
handleLogin.maintenanceMode = true
handleLogin.params = [
    userIdConf,
    secretConf,
    {
        name: 'callback',
        params: [
            { name: 'error', type: TYPES.string },
            {
                properties: [
                    { name: 'address', type: TYPES.string },
                    { name: 'roles', type: TYPES.array },
                ],
                name: 'data',
                type: TYPES.object,
            }
        ],
        required: true,
        type: TYPES.function,
    },
]

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

    const [client, user] = this
    // prevent already registered user's attempt to register again!
    if (!!user) return callback(messages.alreadyRegistered)

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

    // check if user ID already exists
    if (await idExists([userId])) return callback(messages.idExists)

    if (isStr(referredBy)) {
        // direct referral by user ID
        const { _id } = await users.get(referredBy) || {}
        // removes referrer ID if referrer user not found
        referredBy = RESERVED_IDS.includes(_id)
            ? undefined
            : _id
    } else if (isObj(referredBy)) {
        /*
         * referrer validation not required as referral program is closed now
         */

        // Check if referrer user is valid and referrer's social handle has been verified
        // let referrer
        // let { handle, platform } = referredBy
        // handle = `${handle}`.toLowerCase()

        // if (platform === 'twitter') {
        //     // lowercase twitter handle search using custom view
        //     referrer = (await users.view('lowercase', 'twitterHandle', { key: handle }))[0]
        // } else {
        //     // referral through other platforms
        //     referrer = await users.find({
        //         [`socialHandles.${platform}.handle`]: handle,
        //         [`socialHandles.${platform}.verified`]: true
        //     })
        // }

        // ignore if referrer and referred user's address is the same
        // referredBy = !referrer || referrer.address === address
        //     ? undefined
        //     : {
        //         handle,
        //         platform,
        //         userId: referrer._id,
        //     }
    } else {
        referredBy = undefined
    }
    newUser.referredBy = referredBy
    await users.set(userId, newUser)
    // attach userId to client object
    client.___userId = userId
    onlineUsers.set(userId, newUser)
    // add to websocket client list
    clients.set(client.id, client)
    const {
        handshake: {
            headers: { origin = '' } = {},
        } = {},
    } = client
    // add client ID to user's clientId list
    log('New User registered:', JSON.stringify({ userId, referredBy }))
    console.log('signupCount:', ++signupCount)
    userClientIds.set(userId, [client.id])

    rxUserRegistered.next({
        address,
        clientId: client.id,
        userId,
        referredBy,
    })
    rxUserLoggedIn.next({
        address,
        clientId: client.id,
        clientIds: [client.id],
        userId,
    })
    callback(null)
}
handleRegister.description = 'New user registration.'
handleRegister.params = [
    userIdConf,
    secretConf,
    {
        name: 'address',
        type: TYPES.string,
    },
    {
        description: 'accepts either a string (user ID) or alternatively an object (see `or` property for details).',
        ...userIdConf,
        name: 'referredBy',
        required: false,
        or: {
            properties: {
                handle: {
                    maxLength: 64,
                    minLegth: 3,
                    required: true,
                    type: TYPES.string,
                },
                platform: {
                    accept: [
                        'discord',
                        'facebook',
                        'instagram',
                        'telegram',
                        'twitter',
                        'x', // Twitter's new name
                        'whatsapp',
                    ],
                    maxLength: 32,
                    minLegth: 3,
                    required: true,
                    type: TYPES.string,
                },
                userId: {
                    ...userIdConf,
                    required: false,
                },
            },
            required: false,
            type: TYPES.object,
        },
    },
    {
        name: 'callback',
        params: [
            { name: 'error', type: TYPES.string },
        ],
        required: true,
        type: TYPES.function,
    },
]


handleRegister.validationConfig = {
    id: userIdConf,
    referredBy: {
        description: 'accepts either a string (user ID) or alternatively an object (see `or` property for details).',
        ...userIdConf,
        required: false,
        or: {
            config: {
                handle: {
                    maxLength: 64,
                    minLegth: 3,
                    required: true,
                    type: TYPES.string,
                },
                platform: {
                    accept: [
                        'discord',
                        'facebook',
                        'instagram',
                        'telegram',
                        'twitter',
                        'x', // Twitter's new name
                        'whatsapp',
                    ],
                    maxLength: 32,
                    minLegth: 3,
                    required: true,
                    type: TYPES.string,
                },
                userId: {
                    ...userIdConf,
                    required: false,
                },
            },
            required: true,
            type: TYPES.object,
        },
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
    await users.viewCreateMap(
        'lowercase',
        'twitterHandle',
        `function (doc) {
            if(!(doc.socialHandles || {}).twitter) return
            emit(doc.socialHandles.twitter.handle.toLowerCase(), null)
        }`
    )
})
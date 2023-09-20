import { setTexts } from '../language'
import { clientListenables } from '../system'
import { arrUnique, isFn } from '../utils/utils'
import { TYPES } from '../utils/validator'
import {
    clients,
    log,
    onlineSupportUsers,
    onlineUsers,
    RESERVED_IDS,
    ROLE_SUPPORT,
    rxUserLoggedIn,
    secretConf,
    userClientIds,
    userIdConf,
    dbUsers,
    broadcast,
    userRoomPrefix,
} from './users'

// Error messages
const messages = {
    loginFailed: 'Credentials do not match',
    reservedIdLogin: 'Cannot login with a reserved User ID',
}
setTexts(messages)

/**
 * @name    handleLogin
 * @summary user login event handler
 * 
 * @param   {String}      userId 
 * @param   {String}      secret 
 * @param   {Function}    callback args => @err string: error message if login fails
 */
export default async function handleLogin(userId, secret, callback) {
    if (!isFn(callback)) return

    // prevent login with a reserved id
    if (RESERVED_IDS.includes(userId)) return callback(messages.reservedIdLogin)

    const [client] = this
    const user = await dbUsers.find({ _id: userId, secret })
    const {
        handshake: {
            headers: { origin = '' } = {},
        } = {},
    } = client
    log(`Login ${!user ? 'failed' : 'success'} | User ID: ${userId} | Client ID: ${client.id} | Origin: `, origin)
    if (!user) return callback(messages.loginFailed)

    const {
        address,
        roles = [],
        settings = {},
    } = user
    const { onlineStatus = '' } = settings
    const clientIds = userClientIds.get(user.id) || []
    clientIds.push(client.id)
    userClientIds.set(user.id, arrUnique(clientIds))
    // attach userId to client object
    client.___userId = userId
    client.___userRoles = roles
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

    // broadcast user online status
    onlineStatus !== 'invisible' && broadcast(handleLogin.eventName, [userId, true])

    client.join(userRoomPrefix + userId)
}
handleLogin.description = 'User login'
handleLogin.eventName = 'login'
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
clientListenables[handleLogin.eventName] = {
    eventName: handleLogin.eventName,
    params: [
        {
            name: 'userId',
            type: TYPES.string,
        },
        {
            name: 'online',
            type: TYPES.boolean,
        },
    ],
}
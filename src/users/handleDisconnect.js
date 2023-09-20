import {
    arrUnique,
} from '../utils/utils'
import handleLogin from './handleLogin'
import {
    broadcast,
    log,
    clients,
    onlineUsers,
    userClientIds,
    onlineSupportUsers,
    rxClientConnection,
    originClients,
} from './users'

// cleanup on user client disconnect (and user logout)
export default async function handleDisconnect() {
    const [client, user] = this
    const {
        handshake: {
            headers: {
                origin
            } = {}
        } = {}
    } = client
    // trigger client disconnect event
    rxClientConnection.next({
        client,
        connected: false,
        origin,
    })

    // remove client from clients list
    clients.delete(client.id)

    const n = originClients.get(origin) - 1
    originClients.set(origin, n)
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

    !online && broadcast(handleLogin.eventName, [user.id, online])

    // support user went offline
    onlineSupportUsers.get(user.id)
        && !online
        && onlineSupportUsers.delete(user.id)

}
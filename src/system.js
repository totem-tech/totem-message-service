import { BehaviorSubject } from 'rxjs'
import DataStorage from './utils/DataStorage'
import { isFn, isBool, isAddress } from './utils/utils'
import { TYPES, validateObj } from './utils/validator'
import { ROLE_ADMIN, broadcast } from './users'
import { setTexts } from './language'

const texts = {
    invalidRoom: 'invalid room name',
}
setTexts(texts)

export const settings = new DataStorage('settings.json', false)
const maintenanceKey = 'maintenance-mode'
let clientEmittables // to be set later by invoking getClientEventsMeta() from index.js
export const clientListenables = {}
export const rxMaintenanceMode = new BehaviorSubject(settings.get(maintenanceKey) || false)
if (rxMaintenanceMode.value) console.log('[MaintenanceMode] activated on startup')
rxMaintenanceMode.subscribe(active => settings.set(maintenanceKey, active))
// Information about the data types used in event params
const dataTypes = {
    ...Object
        .keys(TYPES)
        .reduce((obj, type) => ({
            ...obj,
            [type]: {
                date: {
                    description: 'Timestamp in ISO format. Eg: ' + new Date().toISOString(),
                    type: 'string',
                },
                email: {
                    description: `Email address. If not "strict", will accept a single "+" in the username section`,
                    type: 'string'
                },
                hash: {
                    description: "Hexadecimal string with '0x' prefix. String length must be exactly 66 characters.",
                    type: 'string',
                },
                hex: {
                    description: "Hexadecimal string with '0x' prefix. String length must be at least 3 characters.",
                    type: 'string',
                },
                identity: {
                    description: [
                        'Blockchain wallet address. Accepts:',
                        '\n1. If "chainId" is "polkadot" (default): SS58 encoded Substrate address.',
                        '\n2. If "chainId" is "ethereum": a hexadecimal string with "0x" prefix. Length 42 characters.',
                    ].join(' '),
                    type: 'string',
                },
                integer: {
                    description: 'Number without any decimals',
                    type: 'number',
                },
                url: {
                    description: 'URL string with the following format: protocol://domain.name/path',
                    type: 'string',
                },
            }[type] || { type }
        }), {}),
    map: {
        description: '2-dimentional array converted from Map using `Array.from(map)`. `ChatClient` will reconstruct the `Map` automatically.',
        type: 'array',
    },
}

/**
 * @name    broadcastCRUD
 * @summary broadcast to all clients about changes in data
 * 
 * @param   {Object}    p
 * @param   {String}    p.id 
 * @param   {String}    p.type 
 * @param   {String}    p.action    // create, read, update, delete
 * @param   {Object}    p.data  (optional) typically entry. Can vary based on specific type
 */
export const broadcastCRUD = ({
    action,
    data,
    id,
    type,
} = {}) => {
    const err = validateObj(
        [{
            action,
            data,
            id,
            type,
        }],
        broadcastCRUD.params
    )
    if (err) {
        console.log('broadcastCRUD error: ', err, {
            action,
            data,
            id,
            type,
        })
        return err
    }
    broadcast(broadcastCRUD.eventName, {
        action,
        data,
        id,
        type,
    })
}
broadcastCRUD.actions = {
    create: 'create',
    delete: 'delete',
    read: 'read',
    update: 'update',
}
broadcastCRUD.description = 'Listen for changes of user-relevent entries in the off-chain database.'
broadcastCRUD.eventName = 'CRUD'
broadcastCRUD.params = [{
    properties: {
        action: {
            // only these values are valid
            accept: Object.values(broadcastCRUD.actions),
            required: true,
            type: TYPES.string,
        },
        data: {
            required: false,
            type: TYPES.object,
        },
        id: {
            required: true,
            type: TYPES.string,
        },
        type: {
            required: true,
            type: TYPES.string,
        },
    },
    required: true,
    type: TYPES.object,
}]
clientListenables[broadcastCRUD.eventName] = {
    ...broadcastCRUD,
}

/**
 * @name    getClientEventsMeta
 * @summary Get a meta data for all events that messaging service client can emit and listen to.
 * 
 * @param   {Object} eventHandlers
 * 
 * @returns {{
 *     emittables: Object,
 *     listenables: Object,
 * }} events meta data
 */
export const getClientEventsMeta = (eventHandlers, force = false) => {
    if (force || eventHandlers && !clientEmittables) {
        clientEmittables = {}
        Object
            .keys(eventHandlers || {})
            .forEach(eventName => {
                const handler = eventHandlers[eventName]
                if (!isFn(handler) || handler.enabled === false) return
                clientEmittables[eventName] = {
                    requireLogin: false,
                    ...handler,
                }
            })
    }
    return {
        dataTypes,
        emittables: clientEmittables,
        listenables: clientListenables,
    }
}

export function handleEventsMeta(callback) {
    const meta = getClientEventsMeta()
    callback(null, meta)
}
handleEventsMeta.description = 'Get list of all events metadata'
handleEventsMeta.eventName = 'events-meta'
// allow request even during maintenance mode
handleEventsMeta.maintenanceMode = true
handleEventsMeta.params = [{
    required: true,
    name: 'callback',
    type: TYPES.function,
}]
handleEventsMeta.result = {
    name: 'eventsMeta',
    type: TYPES.object,
}
clientListenables[handleEventsMeta.eventName] = {
    description: 'Listen for updates on events metadata',
    params: [{
        properties: [
            {
                name: 'emittables',
                type: TYPES.object,
            },
            {
                name: 'listenables',
                type: TYPES.object,
            },
        ],
        type: TYPES.object,
    }]
}

/**
 * @name    handleMaintenanceMode
 * @summary de-/activate maintenance mode.
 * 
 * @description When active, all other websocket events will be responded with an error message.
 * Only user's with role `admin` are allowed to access this endpoint.
 * 
 * @param   {Boolean}   active 
 * @param   {Function}  callback 
 */
export async function handleMaintenanceMode(active = false, callback) {
    if (!isFn(callback)) return

    const [_, user] = this
    const { _id, roles = [] } = user || {}
    const ignore = !_id
        || !isBool(active)
        || !roles.includes(ROLE_ADMIN)
        || rxMaintenanceMode.value === active
    if (!ignore) {
        const tag = '[MaintenanceMode]'
        const status = active
            ? 'activated'
            : 'deactivated'
        console.log(`${tag}${status} by @${_id}`)
        rxMaintenanceMode.next(active)
        // broadcast to all clients
        setTimeout(() => broadcast(handleMaintenanceMode.eventName, [active]))
    }
    return callback(null, rxMaintenanceMode.value)
}
handleMaintenanceMode.description = 'Check/update maintenance mode status. Only admins can change status.'
handleMaintenanceMode.eventName = 'maintenance-mode'
// allow request even during maintenance mode
handleMaintenanceMode.maintenanceMode = true
handleMaintenanceMode.params = [
    {
        description: 'To get status use defaultValue.',
        defaultValue: null,
        name: 'active',
        required: false,
        type: TYPES.boolean,
    },
    {
        name: 'callback',
        required: true,
        type: TYPES.function,
    },
]
handleMaintenanceMode.result = {
    name: 'active',
    type: TYPES.boolean,
}

export function handleRoom(room, join = true, callback) {
    const [client] = this
    client[join ? 'join' : 'leave'](room)
    callback(null)
}
handleRoom.description = 'Join or leave room.'
handleRoom.eventName = 'room'
handleRoom.maintenanceMode = true
handleRoom.params = [
    {
        customMessages: {
            regex: texts.invalidRoom,
        },
        name: 'room',
        regex: '^[a-z][a-z0-9-_]+$',
        required: true,
        type: TYPES.string,
    },
    {
        defaultValue: true,
        name: 'join',
        required: false,
        type: TYPES.boolean,
    },
    {
        name: 'callback',
        required: true,
        type: TYPES.function,
    },
]
handleRoom.requireLogin = false

export default {
    [handleEventsMeta.eventName]: handleEventsMeta,
    [handleRoom.eventName]: handleRoom,
    [handleMaintenanceMode.eventName]: handleMaintenanceMode,
}
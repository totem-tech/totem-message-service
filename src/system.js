import { BehaviorSubject } from 'rxjs'
import { isFn, isBool } from './utils/utils'
import {
    ROLE_ADMIN,
    broadcast,
} from './users'
import { TYPES, validateObj } from './utils/validator'
import DataStorage from './utils/DataStorage'

const settings = new DataStorage('settings', false)
const maintenanceKey = 'maintenance-mode'
let clientEmittables // to be set later by invoking getClientEmittables() from index.js
export const clientListenables = {
    // 'events-meta': {
    //     params: [{
    //         properties: [
    //             {
    //                 name: 'emittables',
    //                 type: TYPES.object,
    //             },
    //             {
    //                 name: 'listenables',
    //                 type: TYPES.object,
    //             },
    //         ],
    //         type: TYPES.object,
    //     }]
    // },
    // onMessage
    // message: {
    //     params: [
    //         {
    //             description: 'The message',
    //             name: 'message',
    //             type: TYPES.string,
    //         },
    //         {
    //             description: 'Sender user IDs',
    //             name: 'senderId',
    //             type: TYPES.string,
    //         },
    //         {
    //             description: 'Recipient user IDs',
    //             name: 'receiverIds',
    //             type: TYPES.array,
    //         },
    //         {
    //             name: 'encrypted',
    //             type: TYPES.boolean,
    //         },
    //         {
    //             name: 'timestamp',
    //             type: TYPES.date,
    //         },
    //         {
    //             name: 'id',
    //             requied: false,
    //             type: TYPES.string,
    //         },
    //         {
    //             name: 'action',
    //             properties: {
    //                 data: {
    //                     type: TYPES.object,
    //                 },
    //                 type: {
    //                     required: true,
    //                     type: TYPES.string,
    //                 }
    //             },
    //             requied: false,
    //             type: TYPES.object,
    //         },
    //     ],
    // },
}
export const rxMaintenanceMode = new BehaviorSubject(settings.get(maintenanceKey) || false)
if (rxMaintenanceMode.value) console.log('[MaintenanceMode] activated on startup')
rxMaintenanceMode.subscribe(active => settings.set(maintenanceKey, active))

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
    broadcast(
        [],
        broadcastCRUD.eventName,
        {
            action,
            data,
            id,
            type,
        }
    )
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
 * @name    getClientEmittables
 * @summary Get a meta data for all events that messaging service client can emit.
 * 
 * @param   {Object} eventHandlers
 * 
 * @returns {{
 *     emittables: Object,
 *     listenables: Object,
 * }} events meta data
 */
export const getClientEventsMeta = eventHandlers => {
    if (eventHandlers && !clientEmittables) {
        clientEmittables = {}
        Object
            .keys(eventHandlers || {})
            .forEach(eventName =>
                clientEmittables[eventName] = {
                    requireLogin: false,
                    ...eventHandlers[eventName],
                }
            )
    }
    return {
        emittables: clientEmittables,
        listenables: clientListenables
    }
}

export const handleEventsMeta = callback => callback(null, getClientEventsMeta())
handleEventsMeta.description = 'Get list of all events metadata'
handleEventsMeta.eventName = 'events-meta'
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
        setTimeout(() => broadcast([], handleMaintenanceMode.eventName, [active]))
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
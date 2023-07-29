import { BehaviorSubject } from 'rxjs'
import { isFn, isBool } from './utils/utils'
import {
    ROLE_ADMIN,
    broadcast,
} from './users'
import { TYPES } from './utils/validator'

export const eventMaintenanceMode = 'maintenance-mode'
export const rxMaintenanceMode = new BehaviorSubject(process.env.MAINTENANCE_MODE === 'YES')
if (rxMaintenanceMode.value) console.log('[MaintenanceMode] activated on startup (env: MAINTENANCE_MODE')

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
    if (ignore) {
        const tag = '[MaintenanceMode]'
        const status = active
            ? 'activated'
            : 'deactivated'
        console.log(`${tag}${status} by @${_id}`)
        rxMaintenanceMode.next(active)
        // broadcast to all clients
        setTimeout(() => broadcast([], eventMaintenanceMode, [active]))
    }
    return callback(null, rxMaintenanceMode.value)
}
// allow request even during maintenance mode
handleMaintenanceMode.maintenanceMode = true
handleMaintenanceMode.params = [
    {
        _description: 'Whether to de/-activate maintenance mode. Only admins can change status. To get status use null or undefined.',
        defaultValue: null,
        label: 'active',
        required: false,
        type: TYPES.boolean,
    },
    {
        label: 'callback',
        required: true,
        type: TYPES.function,
    },
]

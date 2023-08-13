import { TYPES } from '../utils/validator'
import { idExists } from './users'

/**
 * @name    handleIdExists
 * @summary check if user ID(s) exists
 * 
 * @param   {String|Array}  userId 
 * @param   {Function}      callback 
 * 
 * @returns {Boolean}       true if all supplied IDs exists, otherwise, false.
 */
export default async function handleIdExists(userId, callback) {
    return callback?.(
        null,
        await idExists(userId)
    )
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
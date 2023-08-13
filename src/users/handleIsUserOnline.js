import { arrUnique, isArr, isStr } from '../utils/utils'
import { TYPES } from '../utils/validator'
import { isUserOnline } from './users'

/**
 * @name    handleIsUserOnline
 * @summary check if user is/are online
 * 
 * @param {String|Array}    userId
 * @param {Function}        callback    : Arguments =>
 *                  @err        string: error message, if applicable
 *                  @online     bool/object: boolean for signle id and object if array of user Ids supplied in @userId
 */
export default async function handleIsUserOnline(userId, callback) {
    if (!isArr(userId)) return callback(null, isUserOnline(userId))

    const userIds = arrUnique(userId)
        .filter(id => isStr(id))
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

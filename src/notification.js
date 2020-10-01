import CouchDBStorage from './CouchDBStorage'
import uuid from 'uuid'
import { arrUnique, isArr, isFn, isObj, objHasKeys, isStr } from './utils/utils'
import { setTexts } from './language'
import { emitToUsers, idExists, RESERVED_IDS } from './users'
import { TYPES, validateObj } from './utils/validator'

// Pending notification recipient user IDs
// Notification object properties:
// {
//      "_id": "",       - notification ID
//      "_rev": "",      - revision ID: nn-xxxx...
//      "from": "",      - sender User ID
//      "to": [],        - recipient User IDs
//      "type": "",      - primary notification type
//      "childType": "", - notification secondary/child type
//      "message": "",   - notificaiton message
//      "data": {},      - notification data. dependant on notification types
//      "deleted": [],   - recipient User IDs who deleted the notification. 
//                          - Client will always receive it as boolean.
//      "read": [],      - recipient User IDs who marked the notification as read
//                          - Client will always receive it as boolean.
//      "tsCreated": "", - creation timestamp
// }
// 
const notifications = new CouchDBStorage(null, 'notifications')
// initialize
setTimeout(async () => {
    // create an index for the field `timestamp`, ignores if already exists
    const indexDefs = [
        {   // index is used to retrieve latest undeleted notifications
            index: { fields: ['deleted', 'to', 'tsCreated'] },
            name: 'notification-index',
        },
        {
            // index for sorting purposes
            index: { fields: ['tsCreated'] },
            name: 'tsCreated-index',
        }
    ]
    indexDefs.forEach(async (def) => await (await notifications.getDB()).createIndex(def))
})
// maximum number of recent unreceived notifications user can receive
const UNRECEIVED_LIMIT = 200
const messages = setTexts({
    accessDenied: 'Access denied',
    introducingUserIdConflict: 'Introducing user cannot not be a recipient',
    invalidId: 'invalid notification ID',
    invalidParams: 'Invalid/missing required parameter(s)',
    invalidUserId: 'Invalid User ID supplied',
})
const commonConfs = {
    identity: { required: true, type: TYPES.identity },
    idHex: { maxLength: 66, minLength: 66, required: true, type: TYPES.hex },
    message: { maxLength: 160, minLength: 3, required: false, type: TYPES.string },
    userId: { maxLength: 16, minLength: 3, required: true, type: TYPES.string },
}

// @validate function: callback function to be executed before adding a notification.
//                      Must return error string if any error occurs or notification should be void.
//                      thisArg: client object
//                      Params:
//                      @id         string : notification ID
//                      @from       string : sender user ID
//                      @toUserIds  array  : receiver user IDs
//                      @data       object : extra information, can be specific to the module
//                      @message    string : message to be displayed, unless invitation type has custom view
export const VALID_TYPES = Object.freeze({
    identity: {
        // user1 recommends user2 to share their identity with user3
        introduce: {
            dataFields: { userId: commonConfs.userId },
            // check if user id is valid
            validate: async (i, f, toUserIds, { userId }) => {
                const exists = await idExists(userId)
                // makes sure supplied userId is valid
                if (!exists) return messages.invalidUserId
                // prevents user to be introduced to themself!
                if (toUserIds.includes(userId)) return messages.introducingUserIdConflict
            },
            messageField: commonConfs.message,
        },
        // user1 requests identity from user2
        request: {
            dataFields: {
                // one-liner explanation by the requester of why they want receivers identity
                reason: { maxLength: 256, minLength: 3, required: true, type: TYPES.string },
            },
            messageField: commonConfs.message,
        },
        // user1 shares identity with user2
        share: {
            dataFields: {
                // address/identity being shared
                address: commonConfs.identity,
                // optionally include introducer ID
                introducedBy: { required: false, type: TYPES.string },
                // name of the user or the identity
                name: { maxLength: 64, minLength: 3, required: true, type: TYPES.string },
            },
            // validate introducer id, if supplied
            validate: async (_, _1, _2, { introducerId: id }) => {
                if (!id) return
                const exists = await idExists(id)
                return !exists ? messages.invalidUserId : null
            },
            messageField: commonConfs.message,
        }
    },
    task: {
        // notify user when a task has been assigned to them
        assignment: {
            dataFields: {
                assigneeAddress: commonConfs.identity,
                taskId: commonConfs.idHex,
            },
            messageField: commonConfs.message,
        },
        // notify task owner when an assignee accepted/rejected a task
        assignment_response: {
            dataFields: {
                ownerAddress: commonConfs.identity,
                taskId: commonConfs.idHex,
            },
            messageField: commonConfs.message,
        },
        // // notify task owner when a task has been completed and invoice created
        // invoice: {},
        // // notify task assignee when task has been paid out or disputed
        // invoice_response: {},
    },
    timekeeping: {
        dispute: {
            responseRequired: true,
            messageField: commonConfs.message,
        },
        invitation: {
            dataFields: {
                projectHash: commonConfs.idHex,
                projectName: { minLength: 3, required: true, type: TYPES.string },
                workerAddress: { required: true, type: TYPES.identity },
            },
            messageField: commonConfs.message,
        },
        invitation_response: {
            dataFields: {
                accepted: { required: true, type: TYPES.boolean },
                projectHash: commonConfs.idHex,
                projectName: { minLength: 3, required: true, type: TYPES.string },
                workerAddress: { required: true, type: TYPES.identity },
            },
            messageField: { ...commonConfs.message, required: true },
        },
    },
})
const validatorConfig = {
    recipients: {
        customMessages: {}, //ToDo: add custom error messages
        minLength: 1,
        required: true,
        reject: RESERVED_IDS,
        type: TYPES.array,
        unique: true,
    },
    type: {
        accept: Object.keys(VALID_TYPES),
        required: true,
        type: TYPES.string,
    },
    data: {
        required: false,
        type: TYPES.object,
    }
}
// Get user notifications that not deleted
//
// Params:
// @tsLastReceived  Date: (optional) unix timestamp of last received message. 
//                          If falsy, will return up to `UNRECEIVED_LIMIT` recent undeleted notifications.
// @callback        function: callback args => 
//                          @err        string: error message, if unsuccessful
//                          @result     Map: list of notifications
export async function handleNotificationGetRecent(tsLastReceived, callback) {
    const [_, user = {}] = this
    const extraProps = {
        sort: [{ tsCreated: 'desc' }], // latest first
        fields: [
            '_id', // required for Map
            'from',
            'type',
            'childType',
            'message',
            'data',
            'tsCreated',
            'read',
            'deleted',
        ]
    }
    let selector = {
        $and: [
            // select all notifications where current user is a recipient
            { to: { $all: [user.id] } },
            // exclude all where user marked notification as deleted
            { $not: { deleted: [user.id] } },
        ]
    }

    // only retrieve notifications after specified timestamp
    if (tsLastReceived) selector.$and.push({ tsCreated: { $gt: tsLastReceived } })

    // retrieve latest notifications
    let result = (await notifications.search(
        selector,
        true,
        true,
        false,
        UNRECEIVED_LIMIT,
        0,
        true,
        extraProps
    ))
    Array.from(result).forEach(([_, value]) => {
        // remove other recipient information and convert to boolean
        value.deleted = (value.deleted || []).includes(user.id)
        value.read = (value.read || []).includes(user.id)
    })
    callback(null, result)
}

export async function handleNotificationSetStatus(id, read, deleted, callback) {
    const [_, user = {}] = this
    const notificaiton = await notifications.get(id)
    if (!notificaiton) return callback(messages.invalidId)
    if (!notificaiton.to.includes(user.id)) return callback(message.accessDenied)

    const markAs = (key, positive = false) => {
        if (positive === null || !['deleted', 'read'].includes(key)) return // change not intended or invalid key

        const userIds = notificaiton[key] || []
        const isPositive = userIds.includes(user.id)
        if (!!positive === isPositive) return // unchanged

        notificaiton[key] = !!positive ? userIds.concat(user.id) : userIds.filter(userId => userId !== user.id)
        return true // changed
    }

    if (markAs('deleted', deleted) || markAs('read', read)) {
        await notifications.set(id, notificaiton)
        let { from, type, childType, message, data, tsCreated, read, deleted } = notificaiton
        read = read.includes(user.id)
        deleted = deleted.includes(user.id)

        emitToUsers([user.id], 'notification', [id, from, type, childType, message, data, tsCreated, read, deleted])
    }
    callback()
}

// handleNotify deals with notification requests
//
// Params:
// @toUserIds   array    : receiver User ID(s)
// @type        string   : parent notification type
// @childType   string   : child notification type
// @message     string   : message to be displayed (unless custom message required). can be encrypted later on
// @data        object   : information specific to the type of notification
// @callback    function : params: (@err string) 
export async function handleNotification(recipients, type, childType, message, data, callback) {
    const [client, user] = this
    const senderId = user.id

    let err = validateObj({ data, recipients, type }, validatorConfig, true, true)
    if (err) return callback(err)

    const typeObj = VALID_TYPES[type]
    const childTypeObj = typeObj[childType]
    if (childType && !isObj(childTypeObj)) return callback(messages.invalidParams + ': childType')

    // validate data fields
    const config = childType ? childTypeObj : typeObj
    err = isObj(config.dataFields) && validateObj(data, config.dataFields, true, true)
    if (err) return callback(err)

    // validate message
    err = isObj(config.messageField) && validateObj(
        { message },
        { message: config.messageField },
        true,
        true,
    )
    if (err) return callback(err)

    // throw error if any of the user ids are invalid
    const userIdsExists = !recipients.includes(user.id) && await idExists(recipients)
    if (!userIdsExists) return callback(messages.invalidUserId)

    // if notification type has a handler function execute it
    const id = uuid.v1()
    err = isFn(config.validate) && await config.validate.call(client, id, senderId, recipients, data, message)
    if (err) return callback(err)

    const tsCreated = (new Date()).toISOString()
    await notifications.set(id, {
        from: senderId,
        to: recipients,
        type,
        childType,
        message,
        data,
        deleted: [],
        read: [],
        tsCreated,
    })

    emitToUsers(recipients, 'notification', [id, senderId, type, childType, message, data, tsCreated, false, false])
    callback()
}

// export async function handleNotification(
//     toUserIds = [],
//     type = '',
//     childType = '',
//     message = '',
//     data = {},
//     callback,
// ) {
//     const [client, user] = this
//     const senderId = user.id
//     toUserIds = arrUnique(toUserIds).filter(id => id !== user.id)
//     if (!isArr(toUserIds) || toUserIds.length === 0) return callback(messages.invalidParams + ': to')


//     if (toUserIds.find(userId => RESERVED_IDS.includes(userId))) return callback(messages.invalidUserId)

//     // throw error if any of the user ids are invalid
//     for (let i = 0; i < toUserIds.length; i++) {
//         const exists = await idExists(toUserIds[i])
//         if (!exists) return callback(messages.invalidUserId)
//     }

//     const typeObj = VALID_TYPES[type]
//     if (!isObj(typeObj)) return callback(messages.invalidParams + ': type')

//     const childTypeObj = typeObj[childType]
//     if (childType && !isObj(childTypeObj)) return callback(messages.invalidParams + ': childType')

//     const config = childType ? childTypeObj : typeObj
//     const dataInvalid = config.dataRequired && !objHasKeys(data, config.dataFields, true)
//     if (dataInvalid) return callback(`${messages.invalidParams}: data { ${config.dataFields.join()} }`)

//     const msgInvalid = config.messageField && (!isStr(message) || !message.trim())
//     if (msgInvalid) return callback(messages.invalidParams + ': message')

//     // if notification type has a handler function execute it
//     const id = uuid.v1()
//     const err = isFn(config.validate) && await config.validate.call(client, id, senderId, toUserIds, data, message)
//     if (err) return callback(err)

//     const tsCreated = (new Date()).toISOString()
//     await notifications.set(id, {
//         from: senderId,
//         to: toUserIds,
//         type,
//         childType,
//         message,
//         data,
//         deleted: [],
//         read: [],
//         tsCreated,
//     })

//     emitToUsers(toUserIds, 'notification', [id, senderId, type, childType, message, data, tsCreated, false, false])
//     callback()
// }
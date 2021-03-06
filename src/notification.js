import uuid from 'uuid'
import CouchDBStorage from './utils/CouchDBStorage'
import { generateHash, isFn, isObj, objClean, objReadOnly } from './utils/utils'
import { setTexts } from './language'
import { emitToUsers, idExists, RESERVED_IDS, systemUserSymbol } from './users'
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
    const db = await notifications.getDB()
    indexDefs.forEach(def => db.createIndex(def).catch(() => { }))
})
// maximum number of recent unreceived notifications user can receive
const UNRECEIVED_LIMIT = 200
const errMessages = setTexts({
    accessDenied: 'Access denied',
    ethAddressError: 'valid Ethereum address required',
    introducingUserIdConflict: 'Introducing user cannot not be a recipient',
    invalidId: 'Invalid notification ID',
    invalidParams: 'Invalid or missing required parameters',
    invalidUserId: 'Invalid User ID supplied',
})
export const commonConfs = {
    ethAddress: {
        chainType: 'ethereum',
        customMessages: { identity: errMessages.ethAddressError },
        // number of characters required including '0x'
        minLength: 42,
        maxLength: 42,
        required: true,
        type: TYPES.identity,
    },
    identity: { required: true, type: TYPES.identity },
    idHash: { required: true, type: TYPES.hash },
    str3To160: { maxLength: 160, minLength: 3, required: false, type: TYPES.string },
    str3To160Required: { maxLength: 160, minLength: 3, required: true, type: TYPES.string },
    str3To64Required: { maxLength: 64, minLength: 3, required: true, type: TYPES.string },
    userId: { maxLength: 16, minLength: 3, required: true, type: TYPES.string },
}
// validation config for a location
commonConfs.location = {
    config: {
        addressLine1: commonConfs.str3To64Required,
        addressLine2: { ...commonConfs.str3To64Required, required: false },
        city: commonConfs.str3To64Required,
        name: commonConfs.str3To64Required,
        postcode: { ...commonConfs.str3To64Required, maxLength: 16 },
        state: { ...commonConfs.str3To64Required, minLength: 2 },
        countryCode: { ...commonConfs.str3To64Required, minLength: 2, maxLength: 2 },
    },
    required: false,
    type: TYPES.object,
}
Object.keys(commonConfs).forEach(key =>
    commonConfs[key] = objReadOnly(commonConfs[key], true, true)
)

/**
 * @name    validateUserIsSystem
 * @summary Function to validate notification types and force fails
 *          if notificaton was not triggered by the application itself.
 * 
 * @returns {Boolean}
 */
// 
function validateUserIsSystem() {
    const [sysUserSymbol] = this
    const isSystem = sysUserSymbol === systemUserSymbol
    return !isSystem
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
    // chat: {
    //     // Only the application itself should be able to send this notification
    //     referralSuccess: { validate: validateUserIsSystem },
    //     signupReward: { validate: validateUserIsSystem },
    // },
    identity: {
        // user1 recommends user2 to share their identity with user3
        introduce: {
            dataFields: { userId: commonConfs.userId },
            // check if user id is valid
            validate: async (i, f, toUserIds, { userId }) => !await idExists(userId)
                ? errMessages.invalidUserId
                : toUserIds.includes(userId)
                    // prevent user to be introduced to themself!
                    ? errMessages.introducingUserIdConflict
                    : null,
            messageField: commonConfs.str3To160,
        },
        // user1 requests identity from user2
        request: {
            dataFields: {
                // one-liner explanation by the requester of why they want receivers identity
                reason: commonConfs.str3To160Required,
            },
            messageField: commonConfs.str3To160,
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
                location: commonConfs.location,
            },
            // validate introducer id, if supplied
            validate: async (_, _1, _2, { introducerId: id }) => !id || await idExists(id)
                ? null
                : errMessages.invalidUserId
        }
    },
    rewards: {
        // Only the application itself should be able to send this notification
        referralSuccess: {
            dataField: {
                status: { type: TYPES.string },
                rewardId: { type: TYPES.string },
            },
            validate: validateUserIsSystem
        },
        signupReward: {
            validate: validateUserIsSystem
        },
        messageField: {
            ...commonConfs.str3To160Required,
            maxLength: 500,
        },
        dataFields: {
            status: { required: false, type: TYPES.string },
        },
        // Only the application itself should be able to send this notification
        validate: validateUserIsSystem,
    },
    task: {
        // notify user when a task has been assigned to them
        assignment: {
            dataFields: {
                fulfillerAddress: commonConfs.identity,
                taskId: commonConfs.idHash,
            },
        },
        // notify task owner when an assignee accepted/rejected a task
        assignment_response: {
            dataFields: {
                accepted: { required: true, type: TYPES.boolean },
                taskId: commonConfs.idHash,
                taskTitle: commonConfs.str3To160Required,
                ownerAddress: commonConfs.identity,
            },
        },
        // notify task owner when assignee marks task as done
        invoiced: {
            dataFields: {
                ownerAddress: commonConfs.identity,
                taskId: commonConfs.idHash,
                taskTitle: commonConfs.str3To160Required,
            },
        },
        invoiced_response: {
            dataFields: {
                disputed: { required: true, type: TYPES.boolean },
                fulfillerAddress: commonConfs.identity,
                taskId: commonConfs.idHash,
                taskTitle: commonConfs.str3To160Required,
            },
        },
        // // notify task owner when a task has been completed and invoice created
        // invoice: {},
        // // notify task assignee when task has been paid out or disputed
        // invoice_response: {},
    },
    timekeeping: {
        dispute: {
            responseRequired: true,
            messageField: commonConfs.str3To160,
        },
        invitation: {
            dataFields: {
                projectHash: commonConfs.idHash,
                projectName: { minLength: 3, required: true, type: TYPES.string },
                workerAddress: { required: true, type: TYPES.identity },
            },
            messageField: commonConfs.str3To160,
        },
        invitation_response: {
            dataFields: {
                accepted: { required: true, type: TYPES.boolean },
                projectHash: commonConfs.idHash,
                projectName: { minLength: 3, required: true, type: TYPES.string },
                workerAddress: { required: true, type: TYPES.identity },
            },
            messageField: commonConfs.str3To160Required,
        },
    },
    transfer: {
        dataFields: {
            addressFrom: commonConfs.identity,
            addressTo: commonConfs.identity,
            amount: {
                maxLength: 18,
                minLength: 1,
                required: true,
                type: TYPES.integer,
            },
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
    if (!isFn(callback)) return
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
handleNotificationGetRecent.requireLogin = true

export async function handleNotificationSetStatus(id, read, deleted, callback) {
    if (!isFn(callback)) return
    const [_, user = {}] = this
    const notificaiton = await notifications.get(id)
    if (!notificaiton) return callback(errMessages.invalidId)
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
handleNotificationSetStatus.requireLogin = true

export async function sendNotification(senderId, recipients, type, childType, message, data, id) {
    // if `this` is not defined the notification is being sent by the application itself.
    const that = this || [systemUserSymbol]

    id = id || generateHash(uuid.v1(), 'blake2', 256)

    let err = validateObj({ data, recipients, type }, validatorConfig, true, true)
    if (err) return err

    const typeConfig = VALID_TYPES[type]
    const childTypeConfig = typeConfig[childType]
    if (childType && !isObj(childTypeConfig)) return errMessages.invalidParams + ': childType'

    // validate data fields
    const config = childType
        ? childTypeConfig
        : typeConfig
    const dataExpected = isObj(config.dataFields)
    if (dataExpected) {
        err = validateObj(data, config.dataFields, true, true)
        if (err) return err
        // get rid of unwanted properties from `data` object
        const dataKeys = Object.keys(config.dataFields)
        data = objClean(data, dataKeys)
        // in case data object property is also an object, sanitise it as well
        dataKeys.forEach(key => {
            const keyConfig = config.dataFields[key]
            if (!isObj(keyConfig) || keyConfig.type !== TYPES.object) return
            data[key] = objClean(data[key], Object.keys(keyConfig.config))
        })
    }

    // validate message
    err = isObj(config.messageField) && validateObj(
        { message },
        { message: config.messageField },
        true,
        true,
    )
    if (err) return err

    // throw error if any of the user ids are invalid
    const userIdsExists = !recipients.includes(senderId) && await idExists(recipients)
    if (!userIdsExists) return errMessages.invalidUserId

    // if notification type has a handler function execute it
    err = isFn(config.validate) && await config.validate.call(that, id, senderId, recipients, data, message)
    if (err) return err

    const tsCreated = new Date().toISOString()
    const notificaiton = {
        from: senderId,
        to: recipients,
        type,
        childType,
        message,
        data,
        deleted: [],
        read: [],
        tsCreated,
    }
    await notifications.set(id, notificaiton)

    const eventArgs = [
        id,
        senderId,
        type,
        childType,
        message,
        data,
        tsCreated,
        false,
        false,
    ]
    await emitToUsers(
        recipients,
        'notification',
        eventArgs,
    )
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
    if (!isFn(callback)) return
    const [_, user] = this
    const senderId = user.id
    const args = [senderId, recipients, type, childType, message, data]
    const err = await sendNotification.apply(this, args)
    callback(err)
}
handleNotification.requireLogin = true
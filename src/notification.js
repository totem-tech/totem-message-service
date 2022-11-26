import uuid from 'uuid'
import CouchDBStorage from './utils/CouchDBStorage'
import { arrSort, generateHash, isArr, isFn, isObj, objClean, objReadOnly } from './utils/utils'
import { setTexts } from './language'
import { emitToUsers, idExists, RESERVED_IDS, systemUserSymbol, users } from './users'
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
// maximum number of recent unreceived notifications user can receive
const UNRECEIVED_LIMIT = 200
const errMessages = setTexts({
    accessDenied: 'access denied',
    ethAddress: 'valid Ethereum address required',
    introducingUserIdConflict: 'introducing user cannot not be a recipient',
    invalidId: 'invalid notification ID',
    invalidParams: 'invalid or missing required parameters',
    invalidUserId: 'invalid User ID supplied',
    phoneRegex: 'invalid phone number!',
})
export const commonConfs = {
    ethAddress: {
        chainType: 'ethereum',
        customMessages: { identity: errMessages.ethAddress },
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
commonConfs.contactDetails = {
    config: {
        email: {
            ...commonConfs.str3To160,
            required: true,
            type: TYPES.email,
        },
        name: {
            ...commonConfs.str3To64Required,
            maxLength: 32,
        },
        phoneCode: {
            maxLength: 10,
            minLength: 2,
            type: TYPES.string,
        },
        phoneNumber: {
            customMessages: { regex: errMessages.phoneRegex },
            maxLength: 12,
            minLength: 6,
            regex: /^[1-9][0-9]{5,11}$/,
            type: TYPES.string,
        },
    },
    required: false,
    type: TYPES.object,
}
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
                reason: commonConfs.str3To64Required,
            },
            messageField: commonConfs.str3To160,
        },
        // user1 shares identity with user2
        share: {
            dataFields: {
                // address/identity being shared
                address: commonConfs.identity,
                // (optional) contact details
                contactDetails: commonConfs.contactDetails,
                // optionally include introducer ID
                introducedBy: {
                    ...commonConfs.userId,
                    required: false,
                },
                // name of the user or the identity
                name: commonConfs.str3To64Required,
                // (optional) location
                location: commonConfs.location,
                // (optional) company registered number
                registeredNumber: { ...commonConfs.str3To64Required, required: false },
                // (optional) company vat registration number
                vatNumber: { ...commonConfs.str3To64Required, required: false },
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
// notificaiton validation config
const validatorConfig = {
    recipients: {
        maxLength: 10,
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
export async function handleNotificationGetRecent(tsLastReceived = '2002-01-01', callback) {
    const [_, user] = this
    if (!isFn(callback) || !user) return

    tsLastReceived = new Date(tsLastReceived || '2002-01-01')
        .getTime()
    // increment time to prevent most recent from being retrieved again
    tsLastReceived = new Date(tsLastReceived + 1)
        .toISOString()
    const fields = [
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

    // retrieve latest notifications
    const params = {
        startkey: [user.id, tsLastReceived],
        endkey: [user.id, new Date().toISOString()]
    }
    let result = await notifications.view(
        'get-recent',
        'not-deleted',
        params,
    )
    result.forEach(value => {
        // remove other recipient information and convert to boolean
        value.deleted = (value.deleted || []).includes(user.id)
        value.read = (value.read || []).includes(user.id)
    })

    // convert to Map/2D array
    result = result.map(x => [
        x._id,
        objClean(x, fields),
    ])
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

    // prevent user from sending notification to themselves
    recipients = !isArr(recipients)
        ? []
        : recipients.filter(x => x !== senderId)

    let err = validateObj(
        {
            data,
            recipients,
            type,
        },
        validatorConfig,
        true,
        true,
    )
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
    const usersFound = await users.getAll(recipients, true)
    const users404 = recipients.filter(id => !usersFound.get(id))
    if (users404.length > 0) return `${errMessages.invalidUserId}: ${users404.map(id => `@${id}`)}`

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

// initialize
setTimeout(async () => {
    // create an index for the field `timestamp`, ignores if already exists
    const indexDefs = [
        {   // index is used to retrieve latest undeleted notifications after specific time
            index: { fields: ['deleted', 'to', 'tsCreated'] },
            name: 'notification-index',
        },
        {   // index is used to retrieve latest undeleted notifications
            index: { fields: ['deleted', 'to'] },
            name: 'to-deleted-index',
        },
        {
            // index for sorting purposes
            index: { fields: ['tsCreated'] },
            name: 'tsCreated-index',
        }
    ]
    const db = await notifications.getDB()
    indexDefs.forEach(def =>
        db.createIndex(def).catch(() => { })
    )

    // create views
    await notifications.viewCreateMap(
        'get-recent',
        'not-deleted',
        `function (doc) {
                if (!Array.isArray(doc.to)) return
                for (let i = 0; i < doc.to.length; i ++) {
                    const recipient = doc.to[i]
                    if (doc.deleted.includes(recipient)) continue;
                    emit([recipient, doc.tsCreated], null)
                }
            }`,
    )
})
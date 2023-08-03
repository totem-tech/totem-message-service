import request from 'request'
import CouchDBStorage from './utils/CouchDBStorage'
import uuid from 'uuid'
import { arrSort, arrUnique, isFn, isStr, objClean } from './utils/utils'
import { setTexts } from './language'
import { broadcast, emitToUsers, getSupportUsers, RESERVED_IDS, ROLE_SUPPORT } from './users'
import { TYPES, validateObj } from './utils/validator'
import { clientListenables } from './system'

const chatMessages = new CouchDBStorage(null, 'messages')
const TROLLBOX = 'trollbox' // for trollbox
const TROLLBOX_ALT = 'everyone'
const RECENT_MESSAGE_LIMIT = 1000
const DISCORD_WEBHOOK_URL_SUPPORT = process.env.DISCORD_WEBHOOK_URL_SUPPORT
const DISCORD_WEBHOOK_AVATAR_URL = process.env.DISCORD_WEBHOOK_AVATAR_URL
const DISCORD_WEBHOOK_USERNAME = process.env.DISCORD_WEBHOOK_USERNAME
// Error messages
const texts = {
    errorNotAGroup: 'Cannot set name for one to one conversation',
    invalidRequest: 'Invalid request',
    invalidRecipientIds: 'One or more recipient ID is invalid',
    groupName: 'Group Name',
    recipients: 'recipients',
}
setTexts(texts)

/**
 * @name    handleMessage
 * @summary handle event for private, group and trollbox chat messages
 * 
 * @param   {Array}     receiverIds recipient User IDs without '@' sign
 * @param   {String}    message     encrypted or plain text message 
 * @param   {Boolean}   encrypted   whether the @message is encrypted
 * @param   {Function}  callback    Arguments =>
 *                                  @error  string: will include a message if invalid/failed request
 */
export async function handleMessage(receiverIds = [], message = '', encrypted = false, callback) {
    const [_, user] = this
    if (!isFn(callback) || !user) return

    const event = handleMessage.eventName
    const timestamp = new Date().toISOString()
    const senderId = user.id
    // convert single to array
    receiverIds = isStr(receiverIds)
        ? [receiverIds]
        : receiverIds

    // include sender to make sure senders other devices receive the message as well
    const excludeIds = RESERVED_IDS.filter(id =>
        ![
            ROLE_SUPPORT,
            TROLLBOX,
            TROLLBOX_ALT,
        ].includes(id)
    )
    receiverIds = arrUnique([...receiverIds, senderId])
        .sort()
        .filter(id => !excludeIds.includes(id))
    if (!receiverIds.length) return callback(texts.invalidRecipientIds)

    const args = [message, senderId, receiverIds, encrypted, timestamp, 'id-placeholder']
    const isTrollbox = receiverIds.includes(TROLLBOX) || receiverIds.includes(TROLLBOX_ALT)
    const isSupportMsg = receiverIds.includes(ROLE_SUPPORT)
    const userIsSupport = [...(user.roles || []), user.id].includes(ROLE_SUPPORT)

    if (isTrollbox) {
        // handle trollbox messages
        args[2] = [TROLLBOX]
        args[5] = 'trollbox-' + uuid.v1()
        broadcast([], event, args)
        // broadcast message without saving to the database
        return callback(null, timestamp)
    } else if (isSupportMsg) {
        // makes sure support message isn't sent to trollbox even if user includes it
        receiverIds = receiverIds.filter(id => ![TROLLBOX, TROLLBOX_ALT].includes(id))
        // handle support messages
        if (userIsSupport) {
            // exclude support member's ID as special system user ID "support" will take care of it
            receiverIds = receiverIds.filter(id => id !== user.id)
            if (receiverIds.length > 2) return callback(texts.invalidRequest)
        } else {
            // - support message can only be user2support or support2user. 
            // - there can only be two user ids: 'support' and the end-user requesting support
            receiverIds = [ROLE_SUPPORT, user.id]
        }
        args[2] = receiverIds
    }

    const { id } = await chatMessages.set(null, {
        encrypted,
        message,
        receiverIds,
        senderId,
        timestamp,
        tsCreated: timestamp,
    })
    args[5] = id

    let userIds = [...receiverIds]
    if (isSupportMsg) {
        // include all support members
        const supportUsers = await getSupportUsers()
        userIds = arrUnique([...userIds, ...supportUsers.map(u => u.id)])
    }
    emitToUsers(userIds, event, args)
    callback(null, timestamp, id)
    if (!DISCORD_WEBHOOK_URL_SUPPORT || !isSupportMsg || userIsSupport) return

    // send support message message to Discord support channel
    request({
        url: DISCORD_WEBHOOK_URL_SUPPORT,
        method: 'POST',
        json: true,
        body: {
            avatar_url: DISCORD_WEBHOOK_AVATAR_URL,
            content: `>>> ${message}`,//`>>> **UserID: **${user.id}\n**Message:** ${message}`,
            username: `${user.id}@${DISCORD_WEBHOOK_USERNAME || 'Messaging Service Logger'}`
        }
    }, err => err && console.log('Discord Webhook: failed to send support message. ', err))
}
handleMessage.eventName = 'message'
handleMessage.params = [
    {
        description: 'Recipient user ID(s)',
        label: texts.recipients,
        minLength: 1,
        maxLength: 100,
        name: 'receiverIds',
        requied: true,
        type: TYPES.array,
        unique: true,
        or: {
            name: 'receiverId',
            required: true,
            type: TYPES.string,
        },
    },
    {
        description: 'Text message',
        minLength: 1,
        maxLength: 160,
        name: 'message',
        required: true,
        type: TYPES.string,
    },
    {
        defaultValue: false,
        name: 'encrypted',
        requied: false,
        type: TYPES.boolean,
    },
    {
        name: 'callback',
        required: true,
        type: TYPES.function,
    },
]
handleMessage.requireLogin = true

// add client listenable event for 'message'
clientListenables[handleMessage.eventName] = {
    description: 'Listen to new messages sent to the logged in user.',
    params: [
        {
            description: 'The message',
            name: 'message',
            type: TYPES.string,
        },
        {
            description: 'Sender user IDs',
            name: 'senderId',
            type: TYPES.string,
        },
        {
            description: 'Recipient user IDs',
            name: 'receiverIds',
            type: TYPES.array,
        },
        {
            name: 'encrypted',
            type: TYPES.boolean,
        },
        {
            name: 'timestamp',
            type: TYPES.date,
        },
        {
            name: 'id',
            requied: false,
            type: TYPES.string,
        },
        {
            description: 'Special messages (eg: group message name change).',
            name: 'action',
            properties: {
                data: {
                    type: TYPES.object,
                },
                type: {
                    required: true,
                    type: TYPES.string,
                }
            },
            requied: false,
            type: TYPES.object,
        },
    ],
}

/**
 * @name    handleMessageGetRecent
 * @summary get user's most recent messsages. Maximum of 1000 
 * 
 * @param   {String}    lastMessageTS UTC timestamp
 * @param   {*}         callback      Arguments =>
 *                          @err        string: error message, if any
 *                          @messages   array: array of messages
 */
export async function handleMessageGetRecent(lastMessageTS, callback) {
    const [_, user] = this
    if (!isFn(callback) || !user) return

    lastMessageTS = new Date(lastMessageTS || '2002-01-01').getTime()
    // increment time to prevent most recent from being retrieved again
    lastMessageTS = new Date(lastMessageTS + 1).toISOString()

    const userIsSupport = (user.roles || []).includes(ROLE_SUPPORT)
    const getRecentMessages = userId => {
        const params = {
            startkey: [userId, lastMessageTS],
            endkey: [userId, new Date().toISOString()]
        }
        return chatMessages.view(
            'get-recent',
            'not-deleted',
            params,
        )
    }
    let result = [
        ...await getRecentMessages(user.id) || [],
        ...userIsSupport && await getRecentMessages(ROLE_SUPPORT) || [],
    ]
        .filter(Boolean)
        .flat()

    const fields = [
        'encrypted',
        'id', // redundant
        'message',
        'receiverIds',
        'senderId',
        'status',
        'timestamp', // redundant
        'tsCreated',
    ]
    // eliminate any duplicate message
    result = new Map(result.map(x => [x._id, x]))
    result = Array
        .from(result)
        .map(([_, x]) => objClean(x, fields))

    callback(null, arrSort(result, 'tsCreated'))
}
handleMessageGetRecent.requireLogin = true
/**
 * @name    handleMessageGroupName
 * @summary handle event to set a name for group conversation. Anyone within the group can set name.
 * 
 * @param   {Array}     receiverIds 
 * @param   {String}    name 
 * @param   {Function}  callback 
 */
export async function handleMessageGroupName(receiverIds, name, callback) {
    const [_, user] = this
    if (!isFn(callback) || !user) return

    const senderId = user.id
    const isReserved = !!receiverIds.find(id => RESERVED_IDS.includes(id))
    if (isReserved) return callback(texts.invalidRecipientIds)

    const err = validateObj(
        { receiverIds, name },
        handleMessageGroupName.validationConf,
        true,
        true,
    )
    if (err) return callback(err)

    const action = {
        data: [name],
        type: 'message-group-name',
    }
    const timestamp = new Date()
    const message = ''
    const encrypted = false
    const { id } = await chatMessages.set(null, {
        action,
        encrypted,
        message,
        receiverIds,
        senderId,
        timestamp, // to be deprecated
        tsCreated: timestamp,
    })
    const event = 'message'
    const args = [
        message,
        senderId,
        receiverIds,
        encrypted,
        timestamp,
        id,
        action
    ]

    emitToUsers(receiverIds, event, args)
    callback()
}
handleMessageGroupName.requireLogin = true
handleMessageGroupName.validationConf = {
    name: {
        label: texts.groupName,
        maxLength: 32,
        minLength: 3,
        required: true,
        type: TYPES.string,
    },
    receiverIds: {
        customMessages: {
            minLength: texts.errorNotAGroup,
            // reject: texts.invalidRecipientIds,
        },
        label: texts.recipients,
        minLength: 2,
        // reject: RESERVED_IDS, // prevent sending list of reserved ids to frontend
        required: true,
        type: TYPES.array,
        unique: true,
    },
}

// initialize
setTimeout(async () => {
    // create an index for the field `timestamp`, ignores if already exists
    const indexDefs = [
        {
            // index for sorting purposes
            index: { fields: ['timestamp'] },
            name: 'timestamp-index',
        },
        {
            index: { fields: ['receiverIds', 'timestamp'] },
            name: 'receiverIds_timestamp-index',
        }
    ]
    indexDefs.forEach(async (def) => await (await chatMessages.getDB()).createIndex(def))


    // create views
    await chatMessages.viewCreateMap(
        'get-recent',
        'not-deleted',
        `function (doc) {
                if (!Array.isArray(doc.receiverIds)) return
                for (let i = 0; i < doc.receiverIds.length; i ++) {
                    const recipient = doc.receiverIds[i]
                    const ignore = Array.isArray(doc.deleted) && doc.deleted.includes(recipient)
                    if (ignore) continue;
                    emit([recipient, doc.tsCreated || doc.timestamp], null)
                }
            }`,
    )
})
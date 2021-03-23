import request from 'request'
import CouchDBStorage from './utils/CouchDBStorage'
import uuid from 'uuid'
import { arrUnique, isFn, isStr } from './utils/utils'
import { setTexts } from './language'
import { broadcast, emitToUsers, getSupportUsers, getUserByClientId, RESERVED_IDS, ROLE_SUPPORT } from './users'
import { TYPES, validateObj } from './utils/validator'

const chatMessages = new CouchDBStorage(null, 'messages')
const TROLLBOX = 'trollbox' // for trollbox
const TROLLBOX_ALT = 'everyone'
const RECENT_MESSAGE_LIMIT = 1000
const DISCORD_WEBHOOK_URL_SUPPORT = process.env.DISCORD_WEBHOOK_URL_SUPPORT
const DISCORD_WEBHOOK_AVATAR_URL = process.env.DISCORD_WEBHOOK_AVATAR_URL
const DISCORD_WEBHOOK_USERNAME = process.env.DISCORD_WEBHOOK_USERNAME
// Error messages
const texts = setTexts({
    invalidRequest: 'Invalid request',
    invalidRecipientIds: 'One or more recipient ID is invalid',
    groupName: 'Group Name',
    groupNameNotAllowed: 'Cannot set name for one to one conversation',
    recipients: 'recipients',
})

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
})

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

    const event = 'message'
    const timestamp = new Date().toISOString()
    const senderId = user.id
    // convert single to array
    receiverIds = isStr(receiverIds) ? [receiverIds] : receiverIds
    const err = validateObj({ message, receiverIds }, handleMessage.validationConf, true, true)
    if (err) return callback(err)

    // include sender to make sure senders other devices receive the message as well
    receiverIds = arrUnique([...receiverIds, senderId]).sort()
    const args = [message, senderId, receiverIds, encrypted, timestamp]
    const isTrollbox = receiverIds.includes(TROLLBOX) || receiverIds.includes(TROLLBOX_ALT)
    const isSupportMsg = receiverIds.includes(ROLE_SUPPORT)
    const userIsSupport = (user.roles || []).includes(ROLE_SUPPORT)
    
    if (isTrollbox) {
        // handle trollbox messages
        args[2] = [TROLLBOX]
        args[5] = 'trollbox-' + uuid.v1()
        broadcast([], event, args)
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
    })
    args[5] = id

    let userIds = [...receiverIds]
    if (isSupportMsg) {
        // include all support members
        const supportUsers = await getSupportUsers()
        userIds = arrUnique([ ...userIds, ...supportUsers.map(u => u.id) ])
    }
    emitToUsers(userIds, event, args)
    callback(null, timestamp, id)
    if (!DISCORD_WEBHOOK_URL_SUPPORT || !isSupportMsg || userIsSupport) return

    // send support message message to Discord support channel
    request({
        url: DISCORD_WEBHOOK_URL_SUPPORT,
        method: "POST",
        json: true,
        body: {
            avatar_url: DISCORD_WEBHOOK_AVATAR_URL,
            content: `>>> **UserID: **${user.id}\n**Message:** ${message}`,
            username: DISCORD_WEBHOOK_USERNAME || 'Messaging Service Logger'
        }
    }, err => err && console.log('Discord Webhook: failed to send support message. ', err))
}
handleMessage.requireLogin = true
handleMessageGetRecent.validationConf = {
    message: {
        maxLength: 160,
        required: true,
        type: TYPES.string,
    },
    receiverIds: {
        customMessages: {
            reject: texts.invalidRecipientIds,
        },
        label: texts.recipients,
        minLength: 1,
        reject: RESERVED_IDS.filter(id => ![ROLE_SUPPORT, TROLLBOX, TROLLBOX_ALT].includes(id)),
        required: true,
        type: TYPES.array,
        unique: true,
    },
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
    const userIsSupport = (user.roles || []).includes(ROLE_SUPPORT)
    let selector = {
        // select all messages to/from current user
        'receiverIds': { '$all': [user.id] }
    }
    if (userIsSupport) {
        // include support messages as well
        selector.receiverIds = { '$in': [user.id, ROLE_SUPPORT] }
    }

    if (lastMessageTS) selector = {
        ...selector,
        timestamp: { '$gt': lastMessageTS }
    }

    const extraProps = { 'sort': [{ 'timestamp': 'asc' }] }
    const result = await chatMessages.search(selector, RECENT_MESSAGE_LIMIT, 0, false, extraProps)
    callback(null, result)
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
    const err = validateObj({ receiverIds, name }, handleMessageGroupName.validationConf, true, true)
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
        timestamp,
    })
    const event = 'message'
    const args = [message, senderId, receiverIds, encrypted, timestamp, id, action]

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
            minLength: texts.groupNameNotAllowed,
            reject: texts.invalidRecipientIds,
        },
        label: texts.recipients,
        minLength: 2,
        reject: RESERVED_IDS,
        required: true,
        type: TYPES.array,
        unique: true,
    },
}
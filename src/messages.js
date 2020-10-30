import request from 'request'
import CouchDBStorage from './CouchDBStorage'
import uuid from 'uuid'
import { arrUnique, isFn, isStr } from './utils/utils'
import { setTexts } from './language'
import { broadcast, emitToUsers, getSupportUsers, getUserByClientId, RESERVED_IDS, ROLE_SUPPORT } from './users'

const storage = new CouchDBStorage(null, 'messages')
const TROLLBOX = 'trollbox' // for trollbox
const TROLLBOX_ALT = 'everyone'
const msgMaxLength = 160
const RECENT_MESSAGE_LIMIT = 1000
const DISCORD_WEBHOOK_URL_SUPPORT = process.env.DISCORD_WEBHOOK_URL_SUPPORT
const DISCORD_WEBHOOK_AVATAR_URL = process.env.DISCORD_WEBHOOK_AVATAR_URL
const DISCORD_WEBHOOK_USERNAME = process.env.DISCORD_WEBHOOK_USERNAME
// Error messages
const texts = setTexts({
    invalidRequest: 'Invalid request',
    invalidUserID: 'Invalid User ID',
    loginOrRegister: 'Login/registration required',
    msgLengthExceeds: 'Maximum characters allowed',
    groupNameRequired: 'Group name required',
    nonGroupName: 'Cannot set name for one to one conversation'
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
    indexDefs.forEach(async (def) => await (await storage.getDB()).createIndex(def))
})

// handle private, group and trollbox messages
//
// Params:
// @receiverIds array: receiving User IDs without '@' sign
// @message     string: encrypted or plain text message
// @encrypted   bool: determines whether @message requires decryption
// @callback    function: Arguments =>
//                  @error  string: will include a message if invalid/failed request
export async function handleMessage(receiverIds = [], message = '', encrypted = false, callback) {
    if (!isFn(callback)) return
    if (!isStr(message) || message.trim().length === 0) return
    if (message.length > msgMaxLength) return callback(texts.msgLengthExceeds)
    const [_, user] = this
    const event = 'message'
    const timestamp = new Date().toISOString()
    if (!user) return callback(texts.loginOrRegister)

    const senderId = user.id
    receiverIds = isStr(receiverIds) ? [receiverIds] : receiverIds
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
    const prohibitedIds = RESERVED_IDS.filter(id => id !== ROLE_SUPPORT)
    // handle private p2p or group message
    const reservedIds = receiverIds.filter(id => prohibitedIds.includes(id))
    if (reservedIds.length > 0) return callback(`${texts.invalidUserID}: ${reservedIds.join(', ')}`)
    const { id } = await storage.set(null, {
        encrypted,
        message,
        receiverIds,
        senderId,
        timestamp,
    })
    args[5] = id

    let emitIds = [...receiverIds]
    if (isSupportMsg) {
        // include all support members
        const supportUsers = await getSupportUsers()
        emitIds = arrUnique([
            ...emitIds.filter(id => id !== ROLE_SUPPORT),
            ...supportUsers.map(u => u.id),
        ])
    }
    emitToUsers(emitIds, event, args)
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

// get user's most recent messsages. Maximum of 1000
//
// Params:
// @lastMessageTS   string: (optional) timestamp of the most recent message sent or received
// @callback        function: args =>
//                      @err        string: error message, if any
//                      @messages   array: array of messages
export async function handleMessageGetRecent(lastMessageTS, callback) {
    if (!isFn(callback)) return
    const [_, user] = this
    if (!user) return callback(texts.loginOrRegister)
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
    const result = await storage.search(selector, true, true, false, RECENT_MESSAGE_LIMIT, 0, false, extraProps)
    callback(null, result)
}
handleMessageGetRecent.requireLogin = true

// set group name. anyone within the group can set group name.
//
// Params:
// @receiverIds     array:
export async function handleMessageGroupName(receiverIds, name, callback) {
    if (!isFn(callback)) return
    const [_, user] = this
    const reservedIds = receiverIds.filter(id => RESERVED_IDS.includes(id))
    if (reservedIds.length > 0) return callback(`${texts.invalidUserID}: ${reservedIds.join(', ')}`)
    if (!user) return callback(texts.loginOrRegister)
    if (!isStr(name) || !name) return callback(texts.groupNameRequired)

    const senderId = user.id
    receiverIds = isStr(receiverIds) ? [receiverIds] : receiverIds
    receiverIds = arrUnique([...receiverIds, senderId]).sort()
    if (receiverIds.length <= 2) return callback(texts.nonGroupName)

    const action = {
        data: [name],
        type: 'message-group-name',
    }
    const timestamp = new Date()
    const message = ''
    const encrypted = false
    const { id } = await storage.set(null, {
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
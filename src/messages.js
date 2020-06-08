import CouchDBStorage from './CouchDBStorage'
import { arrUnique, isFn, isStr } from './utils/utils'
import { setTexts } from './language'
import { broadcast, emitToUsers, getUserByClientId, RESERVED_IDS } from './users'

const storage = new CouchDBStorage(null, 'messages')

// initialize
setTimeout(async () => {
    // create an index for the field `timestamp`, ignores if already exists
    const indexDefs = [
        {
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

const msgMaxLength = 160
const inboxHistoryLimit = 1000
// Error messages
const texts = setTexts({
    invalidUserID: 'Invalid User ID',
    loginOrRegister: 'Login/registration required',
    msgLengthExceeds: 'Maximum characters allowed',
    groupNameRequired: 'Group name required',
    nonGroupName: 'Cannot set name for one to one conversation'
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
    const client = this
    const everyone = 'everyone' // for trollbox
    const event = 'message'
    const timestamp = new Date().toISOString()
    const user = await getUserByClientId(client.id)
    if (!user) return callback(texts.loginOrRegister)

    const senderId = user.id
    receiverIds = isStr(receiverIds) ? [receiverIds] : receiverIds
    receiverIds = arrUnique([...receiverIds, senderId]).sort()
    const args = [message, senderId, receiverIds, encrypted, timestamp]
    if (receiverIds.includes(everyone)) {
        args[2] = [everyone]
        broadcast([], event, args)
        return callback(null, timestamp)
    }

    const reservedIds = receiverIds.filter(id => RESERVED_IDS.includes(id))
    if (reservedIds.length > 0) return callback(`${texts.invalidUserID}: ${reservedIds.join(', ')}`)
    const { id } = await storage.set(null, {
        encrypted,
        message,
        receiverIds,
        senderId,
        timestamp,
    })
    args[5] = id

    emitToUsers(receiverIds, event, args)
    callback(null, timestamp, id)
}

// get user's most recent messsages. Maximum of 1000
//
// Params:
// @lastMessageTS   string: (optional) timestamp of the most recent message sent or received
// @callback        function: args =>
//                      @err        string: error message, if any
//                      @messages   array: array of messages
export async function handleMessageGetRecent(lastMessageTS, callback) {
    if (!isFn(callback)) return
    const client = this
    const user = await getUserByClientId(client.id)
    if (!user) return callback(texts.loginOrRegister)
    let selector = {
        // select all messages to/from current user
        'receiverIds': { '$all': [user.id] }
    }

    if (lastMessageTS) selector = {
        '$and': [
            selector,
            { 'timestamp': { '$gt': lastMessageTS } }
        ]
    }

    const extraProps = { 'sort': [{ 'timestamp': 'asc' }] }

    const result = await storage.search(selector, true, true, false, inboxHistoryLimit, 0, false, extraProps)
    callback(null, result)
}

// set group name. anyone within the group can set group name.
//
// Params:
// @receiverIds     array:
export async function handleMessageGroupName(receiverIds, name, callback) {
    if (!isFn(callback)) return
    const client = this
    const user = await getUserByClientId(client.id)
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
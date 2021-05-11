/*
 * Chat & data server running on https
 */
import express from 'express'
import fs from 'fs'
import https from 'https'
import socketIO from 'socket.io'
import request from 'request'
import uuid from 'uuid'
import { isFn, isArr } from './utils/utils'
import CouchDBStorage, { getConnection } from './utils/CouchDBStorage'
import DataStorage from './utils/DataStorage'
import { handleCompany, handleCompanySearch } from './companies'
import { handleCountries } from './countries'
import { handleCurrencyConvert, handleCurrencyList, handleCurrencyPricesByDate } from './currencies'
// import { handlers as crowdsaleHanders } from './crowdsale/index'
import { handleFaucetRequest } from './faucetRequests'
import { handleLanguageErrorMessages, handleLanguageTranslations, setTexts, setup as setupLang } from './language'
import { handleNotification, handleNotificationGetRecent, handleNotificationSetStatus } from './notification'
import { handleMessage, handleMessageGetRecent, handleMessageGroupName } from './messages'
import { handleProject, handleProjectsByHashes } from './projects'
import {
    handleDisconnect,
    handleIdExists,
    handleLogin,
    handleRegister,
    handleIsUserOnline,
    getUserByClientId,
} from './users'
import { handleTask, handleTaskGetById } from './task'
import { handleGlAccounts } from './glAccounts'
import { handleNewsletterSignup } from './newsletterSignup'

const expressApp = express()
const cert = fs.readFileSync(process.env.CertPath)
const key = fs.readFileSync(process.env.KeyPath)
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL
const DISCORD_WEBHOOK_AVATAR_URL = process.env.DISCORD_WEBHOOK_AVATAR_URL
const DISCORD_WEBHOOK_USERNAME = process.env.DISCORD_WEBHOOK_USERNAME
const PORT = process.env.PORT || 3001
const couchDBUrl = process.env.CouchDB_URL
const importFiles = process.env.ImportFiles || process.env.MigrateFiles
const server = https.createServer({ cert, key }, expressApp)
const socket = socketIO(server)
// Error messages
const texts = setTexts({
    loginRequired: 'Please login or create an account if you have not already done so',
    runtimeError: `
        Runtime error occured. Please try again later or drop us a message in the Totem Support chat.
        You can also email us at support@totemaccounting.com. 
        Someone from the Totem team will get back to you as soon as possible.
        Don't forget to mention the following Request ID
    `,
})
const events = {
    // User & connection
    'disconnect': handleDisconnect,
    'id-exists': handleIdExists,
    'register': handleRegister,
    'login': handleLogin,
    'is-user-online': handleIsUserOnline,

    // Company
    'company': handleCompany,
    'company-search': handleCompanySearch,

    // Countries
    'countries': handleCountries,

    // Currency
    'currency-convert': handleCurrencyConvert,
    'currency-list': handleCurrencyList,
    'currency-prices-by-date': handleCurrencyPricesByDate,

    // Crowdsale
    // ...crowdsaleHanders,

    // Faucet request
    'faucet-request': handleFaucetRequest,

    // GL Accounts
    'gl-accounts': handleGlAccounts,

    // Language
    'language-translations': handleLanguageTranslations,
    'language-error-messages': handleLanguageErrorMessages,

    // Chat/Messages
    'message': handleMessage,
    'message-get-recent': handleMessageGetRecent,
    'message-group-name': handleMessageGroupName,

    // Newsletter signup
    'newsletter-signup': handleNewsletterSignup,

    // Notification
    'notification': handleNotification,
    'notification-get-recent': handleNotificationGetRecent,
    'notification-set-status': handleNotificationSetStatus,

    // Project
    'project': handleProject,
    'projects-by-hashes': handleProjectsByHashes,

    // Task 
    'task': handleTask,
    'task-get-by-id': handleTaskGetById,
}
const interceptHandler = (name, handler) => async function (...args) {
    if (!isFn(handler)) return
    const client = this
    const { requireLogin } = handler
    if (name === 'message') {
        // pass on extra information along with the client
        client._data = {
            DISCORD_WEBHOOK_URL,
            DISCORD_WEBHOOK_AVATAR_URL,
            DISCORD_WEBHOOK_USERNAME,
        }
    }
    // last argument is expected to be the function
    const callback = args.slice(-1)[0]
    const hasCallback = isFn(callback)
    let user

    try {
        if (requireLogin) {
            // user must be logged
            user = await getUserByClientId(client.id)
            if (!user) return hasCallback && callback(texts.loginRequired)
        }
        // include the user object if login is required for this event
        const thisArg = !requireLogin ? client : [client, user]
        await handler.apply(thisArg, args)
    } catch (err) {
        user = user || await getUserByClientId(client.id)
        const requestId = uuid.v1()
        hasCallback && callback(`${texts.runtimeError}: ${requestId}`)

        // Print error meta data
        console.log([
            '', // adds an empty line before
            `RequestID: ${requestId}.`,
            `interceptHandler: uncaught error on event "${name}" handler.`,
        ].join('\n'))
        // print the error stack trace
        console.log(`${err}`, err.stack)

        if (!DISCORD_WEBHOOK_URL) return

        // send message to discord
        const handleReqErr = err => err && console.log('Discord Webhook: failed to send error message. ', err)
        const content = '>>> ' + [
            `**RequestID:** ${requestId}`,
            `**Event:** *${name}*`,
            '**Error:** ' + `${err}`.replace('Error:', ''),
            user ? `**UserID:** ${user.id}` : '',
        ].join('\n')
        request({
            json: true,
            method: 'POST',
            timeout: 30000,
            url: DISCORD_WEBHOOK_URL,
            body: {
                avatar_url: DISCORD_WEBHOOK_AVATAR_URL,
                content,
                username: DISCORD_WEBHOOK_USERNAME || 'Messaging Service Logger'
            }
        }, handleReqErr)
    }
}
// replace handlers with intercepted handler
Object.keys(events).forEach(name => events[name] = interceptHandler(name, events[name]))
// Setup websocket event handlers
socket.on('connection', client => Object.keys(events).forEach(name => client.on(name, events[name])))
// Start listening
server.listen(PORT, () => console.log(`Totem Messaging Service started. Websocket listening on port ${PORT} (https)`))

// attempt to establish a connection to database and exit application if fails
try {
    console.log('Connecting to CouchDB')
    getConnection(couchDBUrl)
    console.log('Connected to CouchDB')
} catch (e) {
    console.log('CouchDB: connection failed. Error:\n', e)
    process.exit(1)
}
if (!!importFiles) setTimeout(() => importToDB(importFiles), 1000)

// Import data from JSON file storage to CouchDB.
// Existing entries will be ignored and will remain in the JSON file.
// Successfully stored entries will be removed from JSON file.
async function importToDB(fileNames) {
    const filesAr = fileNames.split(',')
        // only include json file names
        .filter(x => x.endsWith('.json'))
        .map(x => x.trim())
    // list of files:databases where value is an array rather than an object
    const arrKeys = {
        'faucet-requests': 'requests', // store the value array under the property called 'requests'
        'translations': 'texts', // store the value array under the property called 'texts'
    }
    // databases where update of document update is allowed
    const allowUpdates = [
        'translations', // for easier access to updating translated texts
    ]

    // nothing to migrate 
    if (filesAr.length === 0) return

    console.log('Migrating JSON files:', filesAr)
    for (let i = 0; i < filesAr.length; i++) {
        const file = filesAr[i]
        const dbName = (file.split('.json')[0])
        if (!dbName) continue
        const jsonStorage = new DataStorage(file, true)
        const data = jsonStorage.getAll()
        const total = data.size
        if (total === 0) {
            console.log('\nIgnoring empty file:', file)
            continue
        }

        console.log(`\nMigrating ${file}: ${data.size} entries`)
        const db = new CouchDBStorage(
            getConnection(), // get the global connection created above
            dbName.replace(' ', '_'),
        )

        // wrap array value in an object as required by couchdb
        if (!!arrKeys[dbName]) Array.from(data)
            .forEach(([id, arr]) => {
                if (!isArr(arr)) return
                const value = {}
                value[arrKeys[dbName] || 'array'] = arr
                data.set(id, value)
            })

        // database specific modifications before submission
        switch (dbName) {
            case 'currencies':
                // convert ratioOfExchange and decimals to integer
                Array.from(data)
                    .forEach(([_, value]) => {
                        value.ratioOfExchange = parseInt(value.ratioOfExchange)
                        value.decimals = parseInt(value.decimals)
                        value.sequence = parseInt(value.sequence)
                    })
                break
        }

        // insert data into database
        const result = await db.setAll(data, !allowUpdates.includes(dbName))
        // IDs of successful inserts
        const okIds = result
            .map(({ ok, id }) => ok && id)
            .filter(Boolean)

        // database specifc post-save actions 
        switch (dbName) {
            case 'translations':
                // re-generate hashes of translated texts for each language
                okIds.length && setupLang()
                break
        }

        // remove saved entries from the JSON file
        okIds.forEach(id => data.delete(id))
        // update JSON file to remove imported entries
        jsonStorage.setAll(data)
        console.log(`${file} => saved: ${okIds.length}. Ignored existing: ${total - okIds.length}`)
    }
}
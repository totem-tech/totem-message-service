/*
 * Chat & data server running on https
 */
import express from 'express'
import fs from 'fs'
import https from 'https'
import socketIO from 'socket.io'
import request from 'request'
import { isFn, isArr, isObj } from './utils/utils'
import CouchDBStorage, { getConnection } from './CouchDBStorage'
import DataStorage from './utils/DataStorage'
import { handleCompany, handleCompanySearch } from './companies'
import { handleCountries } from './countries'
import { handleCurrencyConvert, handleCurrencyList } from './currencies'
import { handleFaucetRequest } from './faucetRequests'
import { handleLanguageErrorMessages, handleLanguageTranslations, setTexts } from './language'
import { handleNotification, handleNotificationGetRecent, handleNotificationSetStatus } from './notification'
import { handleMessage, handleMessageGetRecent, handleMessageGroupName } from './messages'
import { handleProject, handleProjectsByHashes } from './projects'
import {
    handleDisconnect,
    handleIdExists,
    handleLogin,
    handleRegister,
    handleIsUserOnline,
} from './users'

const expressApp = express()
const cert = fs.readFileSync(process.env.CertPath)
const key = fs.readFileSync(process.env.KeyPath)
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL
const DISCORD_WEBHOOK_URL_SUPPORT = process.env.DISCORD_WEBHOOK_URL_SUPPORT
const DISCORD_WEBHOOK_AVATAR_URL = process.env.DISCORD_WEBHOOK_AVATAR_URL
const DISCORD_WEBHOOK_USERNAME = process.env.DISCORD_WEBHOOK_USERNAME
const PORT = process.env.PORT || 3001
const couchDBUrl = process.env.CouchDB_URL
const migrateFiles = process.env.MigrateFiles
const server = https.createServer({ cert, key }, expressApp)
const socket = socketIO.listen(server)
const texts = setTexts({
    runtimeError: 'Runtime error occured. Please try again later or email support@totemaccounting.com',
})
const handlers = [
    // User & connection
    { name: 'disconnect', handler: handleDisconnect },
    { name: 'id-exists', handler: handleIdExists },
    { name: 'register', handler: handleRegister },
    { name: 'login', handler: handleLogin },
    { name: 'is-user-online', handler: handleIsUserOnline },

    // Company
    { name: 'company', handler: handleCompany },
    { name: 'company-search', handler: handleCompanySearch },

    // Countries
    { name: 'countries', handler: handleCountries },

    // Currency
    { name: 'currency-convert', handler: handleCurrencyConvert },
    { name: 'currency-list', handler: handleCurrencyList },

    // Faucet request
    { name: 'faucet-request', handler: handleFaucetRequest },

    // Language
    { name: 'language-translations', handler: handleLanguageTranslations },
    { name: 'language-error-messages', handler: handleLanguageErrorMessages },

    // Chat/Messages
    { name: 'message', handler: handleMessage },
    { name: 'message-get-recent', handler: handleMessageGetRecent },
    { name: 'message-group-name', handler: handleMessageGroupName },

    // Notification
    { name: 'notification', handler: handleNotification },
    { name: 'notification-get-recent', handler: handleNotificationGetRecent },
    { name: 'notification-set-status', handler: handleNotificationSetStatus },

    // Project
    { name: 'project', handler: handleProject },
    { name: 'projects-by-hashes', handler: handleProjectsByHashes },
]
    .filter(x => isFn(x.handler)) // ignore if handler is not a function
    .map(item => ({
        ...item,
        handler: async function interceptHandler() {
            const args = arguments
            const client = this
            if (name === 'message') {
                // pass on extra information along with the client
                client._data = {
                    DISCORD_WEBHOOK_URL_SUPPORT,
                    DISCORD_WEBHOOK_AVATAR_URL,
                    DISCORD_WEBHOOK_USERNAME,
                }
            }
            const { name, handler } = item
            try {
                await handler.apply(client, args)
            } catch (err) {
                const callback = args[args.length - 1]
                isFn(callback) && callback(texts.runtimeError)
                console.log(`interceptHandlerCb: uncaught error on event "${name}" handler. Error: ${err}`)
                isObj(err) && console.log(err.stack)
                if (!DISCORD_WEBHOOK_URL) return

                const handleReqErr = err => err && console.log('Discord Webhook: failed to send error message. ', err)
                request({
                    url: DISCORD_WEBHOOK_URL,
                    method: "POST",
                    json: true,
                    body: {
                        avatar_url: DISCORD_WEBHOOK_AVATAR_URL,
                        content: `>>> **Event: **\`${name}\`\n**Error:** \`${err}\``,
                        username: DISCORD_WEBHOOK_USERNAME || 'Messaging Service Logger'
                    }
                }, handleReqErr)
            }
        }
    }))

// Setup websocket event handlers
socket.on('connection', client => handlers.forEach(x => client.on(x.name, x.handler)))
// Start listening
server.listen(PORT, () => console.log(`Totem Messaging Service started. Websocket listening on port ${PORT} (https)`))

// attempt to establish a connection to database and exit application if fails
try {
    getConnection(couchDBUrl)
    console.log('Connected to CouchDB')
} catch (e) {
    console.log('CouchDB: connection failed. Error:\n', e)
    process.exit(1)
}
if (!!migrateFiles) setTimeout(() => migrate(migrateFiles), 1000)


// Migrate JSON file storage to CouchDB.
// Existing entries will be ignored and will remain in the JSON file.
// Successfully stored entries will be removed from JSON file.
async function migrate(fileNames) {
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
        if (!!arrKeys[dbName]) Array.from(data).forEach(([id, arr]) => {
            if (!isArr(arr)) return
            const value = {}
            value[arrKeys[dbName] || 'array'] = arr
            data.set(id, value)
        })

        const result = await db.setAll(data, !allowUpdates.includes(dbName))
        const okIds = result.map(({ ok, id }) => ok && id).filter(Boolean)
        // remove saved entries
        okIds.forEach(id => data.delete(id))
        // update JSON file to remove migrated entries
        jsonStorage.setAll(data)
        console.log(`${file} => saved: ${okIds.length}. Ignored existing: ${total - okIds.length}`)
    }
}

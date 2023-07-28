/*
 * Chat & data server running on https
 */
import express from 'express'
import fs from 'fs'
import https from 'https'
import http from 'http'
import socketIO from 'socket.io'
import uuid from 'uuid'
import { isFn, isArr, isBool } from './utils/utils'
import CouchDBStorage, { getConnection } from './utils/CouchDBStorage'
import DataStorage from './utils/DataStorage'
import PromisE from './utils/PromisE'
import { handleCompany, handleCompanySearch } from './companies'
import { handleCountries } from './countries'
import { handlers as crowdloanHandlers } from './crowdloan'
import {
    handleCurrencyConvert,
    handleCurrencyList,
    handleCurrencyPricesByDate,
    updateCache
} from './currencies'
// import { handlers as crowdsaleHanders } from './crowdsale/index'
import { handleFaucetRequest, handleFaucetStatus } from './faucetRequests'
import { handleGlAccounts } from './glAccounts'
import {
    handleLanguageErrorMessages,
    handleLanguageTranslations,
    setTexts,
    setup as setupLang,
} from './language'
import {
    handleMessage,
    handleMessageGetRecent,
    handleMessageGroupName,
} from './messages'
import { handleNewsletterSignup } from './newsletterSignup'
import {
    handleNotification,
    handleNotificationGetRecent,
    handleNotificationSetStatus,
} from './notification'
import { handleProject, handleProjectsByHashes } from './projects'
import rewardsHandlers from './rewards'
import {
    handleTask,
    handleTaskGetById,
    handleTaskGetByParentId,
    handleTaskMarketApply,
    handleTaskMarketApplyResponse,
    handleTaskMarketSearch,
} from './task'
import {
    handleDisconnect,
    handleIdExists,
    handleLogin,
    handleRegister,
    handleIsUserOnline,
    getUserByClientId,
    ROLE_ADMIN,
    broadcast,
    onlineUsers,
    emitToClients,
} from './users'
import { TYPES, validateObj } from './utils/validator'
import {
    eventMaintenanceMode,
    handleMaintenanceMode,
    rxMaintenanceMode
} from './system'

let requestCount = 0
const cert = fs.readFileSync(process.env.CertPath)
const key = fs.readFileSync(process.env.KeyPath)
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL
const DISCORD_WEBHOOK_AVATAR_URL = process.env.DISCORD_WEBHOOK_AVATAR_URL
const DISCORD_WEBHOOK_USERNAME = process.env.DISCORD_WEBHOOK_USERNAME
const PORT = process.env.PORT || 3001
const couchDBUrl = process.env.CouchDB_URL
const importFiles = process.env.ImportFiles || process.env.MigrateFiles
const isDebug = process.env.DEBUG === 'TRUE'
const HTTPS_ONLY = process.env.HTTPS_ONLY === 'TRUE'
const socketClients = (process.env.SOCKET_CLIENTS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => {
        if (x.startsWith('https://') || x.startsWith('http://')) return x
        return `https://${x}`
    })
let unapprovedOrigins = []
console.log('SOCKET_CLIENTS', socketClients)
const allowRequest = socketClients.length === 0
    ? undefined
    : (request, callback) => {
        const { headers: { origin } = {} } = request
        const allow = socketClients.includes(origin)
        if (!allow && !unapprovedOrigins.includes(origin)) {
            unapprovedOrigins.push(origin)
            // keep maximum of 100 
            unapprovedOrigins = unapprovedOrigins.slice(-100)
            console.log('Websocket request rejected from unapproved origin:', origin)
        }
        isDebug && console.log({ origin, allow })
        callback(null, allow)
    }
const server = https.createServer({ cert, key }, express())
const socket = socketIO(server, { allowRequest })
// Error messages
const texts = setTexts({
    maintenanceMode: 'Messaging service is in maintenance mode. Please try again later.',
    loginRequired: 'You must be logged in to make this request. Please login or create an account.',
    runtimeError: `
        Runtime error occured. Please try again later or drop us a message in the Totem Support chat.
        You can also email us at support@totemaccounting.com. 
        Someone from the Totem team will get back to you as soon as possible.
        Don't forget to mention the following Request ID
    `,
})

const handleEventsMeta = callback => {
    const meta = {}
    Object
        .keys(eventsHandlers || {})
        .forEach(eventName =>
            meta[eventName] = {
                requireLogin: false,
                ...eventsHandlers[eventName],
            }
        )
    delete meta.disconnect
    callback(null, meta)
}
handleEventsMeta.params = [{
    required: true,
    name: 'callback',
    type: TYPES.callback,
}]
// allow request even during maintenance mode
handleEventsMeta.maintenanceMode = true
const eventsHandlers = {
    // system & status endpoints
    [eventMaintenanceMode]: handleMaintenanceMode,
    'events-meta': handleEventsMeta,

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

    // Crowdloan
    ...crowdloanHandlers,

    // Faucet request
    'faucet-request': handleFaucetRequest,
    'faucet-status': handleFaucetStatus,

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

    // rewards related handlers
    ...rewardsHandlers,

    // Task 
    'task': handleTask,
    'task-get-by-id': handleTaskGetById,
    'task-get-by-parent-id': handleTaskGetByParentId,
    'task-market-apply': handleTaskMarketApply,
    'task-market-apply-response': handleTaskMarketApplyResponse,
    'task-market-search': handleTaskMarketSearch,
}
console.log('Events allowed during maintenance mode:',
    Object
        .keys(eventsHandlers)
        .filter(key => eventsHandlers[key].maintenanceMode)
)
const interceptHandler = (name, handler) => async function (...args) {
    if (!isFn(handler)) return

    const requestId = uuid.v1()
    const client = this
    const userId = client.___userId
    const {
        maintenanceMode,
        params = [],
        requireLogin
    } = handler
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
    const gotCb = isFn(callback)
    const requireCalblack = !!params.find(x =>
        x.type === TYPES.function
        && x.required
    )
    // a callback is required but not provided
    if (requireCalblack && !gotCb) return

    const maintenanceModeActive = rxMaintenanceMode.value
    const deny = maintenanceModeActive && !maintenanceMode
    if (deny) return gotCb && callback(texts.maintenanceMode)

    try {
        requestCount++
        maintenanceModeActive && console.info('Request Count', requestCount)
        // user must be logged
        if (requireLogin && !userId) return gotCb && callback(texts.loginRequired)

        // validate event handler params
        const err = isArr(params)
            && params.length > 0
            && validateObj(
                [...args],
                params,
                true,
                true
            )
        if (err) {
            console.log('-------', name, { args, params, err })
            return gotCb && callback(err)
        }

        // include the user object if login is required for this event
        const thisArg = [
            client,
            await onlineUsers.get(userId) //getUserByClientId(client.id),
        ]
        await handler.apply(thisArg, args)
    } catch (err) {
        gotCb && callback(`${texts.runtimeError}: ${requestId}`)

        // Print error meta data
        console.log([
            '', // adds an empty line before
            `${new Date().toISOString()} RequestID: ${requestId}.`,
            `InterceptHandler Error: uncaught error on event "${name}" handler.`,
        ].join('\n'))
        // print the error stack trace
        console.log(`${err}`, err.stack)

        if (DISCORD_WEBHOOK_URL) {
            // send message to discord
            const content = '>>> ' + [
                `**RequestID:** ${requestId}`,
                `**Event:** *${name}*`,
                '**Error:** ' + `${err}`.replace('Error:', ''),
                userId ? `**UserID:** ${userId}` : '',
            ].join('\n')

            // const handleReqErr = err => err && console.log(`Discord Webhook: failed to send error message for request ID ${requestId}. `, err)
            // request({
            //     json: true,
            //     method: 'POST',
            //     timeout: 30000,
            //     url: DISCORD_WEBHOOK_URL,
            //     body: {
            //         avatar_url: DISCORD_WEBHOOK_AVATAR_URL,
            //         content,
            //         username: DISCORD_WEBHOOK_USERNAME || 'Messaging Service Logger'
            //     }
            // }, handleReqErr)

            PromisE
                .fetch(
                    DISCORD_WEBHOOK_URL,
                    {
                        json: true,
                        method: 'POST',
                        timeout: 60000,
                        body: {
                            avatar_url: DISCORD_WEBHOOK_AVATAR_URL,
                            content,
                            username: DISCORD_WEBHOOK_USERNAME || 'Messaging Service Logger'
                        }
                    },
                )
                .catch(err =>
                    console.error(`Discord Webhook: failed to log error message for request ID ${requestId}. `, err)
                )
        }
    } finally {
        requestCount--
        maintenanceModeActive && console.info('Request Count', requestCount)
    }
}
// Setup websocket event handlers
socket.on('connection', client => {
    // add interceptable event handlers
    Object.keys(eventsHandlers)
        .forEach(name =>
            client.on(
                name,
                interceptHandler(
                    name,
                    eventsHandlers[name]
                )
            )
        )

    // send event handlers' meta data to client
    handleEventsMeta((_, meta) => emitToClients([client], 'events-meta', [meta]))
})
// Start listening
server.listen(
    PORT,
    () => console.log(`Totem Messaging Service started. Websocket listening on port ${PORT} (https)`)
)

if (!HTTPS_ONLY && socketClients.find(x => x.startsWith('http://'))) {
    const serverHttp = https.createServer(express())
    const socketHttp = socketIO(serverHttp, { allowRequest })
    // Setup websocket event handlers
    socketHttp.on('connection', client =>
        Object.keys(eventsHandlers)
            .forEach(name =>
                client.on(name, eventsHandlers[name])
            )
    )
    const PORT_HTTP = process.env.PORT_HTTP || 4001
    // Start listening
    serverHttp.listen(
        PORT_HTTP,
        () => console.log(`Totem Messaging Service started. Websocket listening on port ${PORT_HTTP} (http)`)
    )
}

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
    for (let i = 0;i < filesAr.length;i++) {
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
            await getConnection(), // get the global connection created above
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
                        // keys to force parse into integer
                        [
                            'ratioOfExchange',
                            'decimals',
                            'sequence',
                        ].forEach(key =>
                            value[key] = parseInt(value[key])
                        )
                        // value.ratioOfExchange = parseInt(value.ratioOfExchange)
                        // value.decimals = parseInt(value.decimals)
                        // value.sequence = parseInt(value.sequence)
                    })
                break
        }

        // IDs of successful inserts
        const okIds = []
        // insert data into database
        const limit = 999
        const numBatches = data.size / limit
        for (let i = 0;i < numBatches;i++) {
            const start = i * limit
            const end = start + limit
            if (numBatches > 1) console.log(`\n${file}: Processing ${start + 1} to ${end} out of ${data.size} entries`)
            const result = await db.setAll(
                new Map(
                    Array.from(data)
                        .slice(start, end)

                ),
                !allowUpdates.includes(dbName),
            )
            okIds.push(
                ...result
                    .map(({ error, reason, ok, id }) => {
                        if (error) console.log(id, { error, reason, doc: data.get(id) })
                        return ok && id
                    })
                    .filter(Boolean)
            )
        }

        // database specifc post-save actions 
        switch (dbName) {
            case 'currencies':
                // regenerate currencies cache
                updateCache()
                break
            case 'translations':
                // re-generate hashes of translated texts for each language
                okIds.length && setupLang()
                break
        }

        // remove saved entries from the JSON file
        okIds.forEach(id => data.delete(id))
        // update JSON file to remove imported entries
        jsonStorage.setAll(data)
        console.log(`${file} => saved: ${okIds.length}. Failed or ignored existing: ${total - okIds.length}`)
    }
}
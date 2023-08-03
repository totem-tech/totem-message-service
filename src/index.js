/*
 * Chat & data server running on https
 */
import express from 'express'
import fs from 'fs'
import https from 'https'
import http from 'http'
import socketIO from 'socket.io'
import uuid from 'uuid'
import { isFn, isArr, isStr, isError } from './utils/utils'
import CouchDBStorage, { getConnection } from './utils/CouchDBStorage'
import DataStorage from './utils/DataStorage'
import PromisE from './utils/PromisE'
import { getConnection as connectToBlockchain } from './blockchain'
import { handleCompany, handleCompanySearch } from './companies'
import { setup as setupCountries, handleCountries } from './countries'
import { handlers as crowdloanHandlers } from './crowdloan'
import currencyHandlers, { setup as setupCurrencies, updateCache } from './currencies'
// import { handlers as crowdsaleHanders } from './crowdsale/index'
import { handleFaucetRequest, handleFaucetStatus } from './faucetRequests'
import { handleGlAccounts } from './glAccounts'
import languageHandlers, { setTexts, setup as setupLang } from './language'
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
import { eventHandlers as projectEventHanders } from './projects'
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
    onlineUsers,
    emitToClients,
} from './users'
import { TYPES, validateObj } from './utils/validator'
import {
    getClientEventsMeta,
    handleEventsMeta,
    handleMaintenanceMode,
    rxMaintenanceMode
} from './system'
import { isMap } from 'util/types'

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
const expressApp = express()
const server = https.createServer({ cert, key }, expressApp)
const socket = socketIO(server, { allowRequest })
// Error messages
const texts = {
    maintenanceMode: 'Messaging service is in maintenance mode. Please try again later.',
    loginRequired: 'You must be logged in to make this request. Please login or create an account.',
    runtimeError: `
        Runtime error occured. Please try again later or drop us a message in the Totem Support chat.
        You can also email us at support@totemaccounting.com. 
        Someone from the Totem team will get back to you as soon as possible.
        Don't forget to mention the following Request ID
    `,
}
setTexts(texts)

const eventsHandlers = {
    // system & status endpoints
    [handleMaintenanceMode.eventName]: handleMaintenanceMode,
    [handleEventsMeta.eventName]: handleEventsMeta,

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
    ...currencyHandlers,

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
    ...languageHandlers,

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
    // 'project': handleProject,
    // 'projects-by-hashes': handleProjectsByHashes,
    ...projectEventHanders,

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

const logDiscord = (content, tag, timeout = 60000) => PromisE.post(
    DISCORD_WEBHOOK_URL + '?wait=true',
    {
        avatar_url: DISCORD_WEBHOOK_AVATAR_URL,
        content,
        username: DISCORD_WEBHOOK_USERNAME || 'Messaging Service Logger'
    },
    {},
    timeout,
    false,
).catch(err =>
    console.error(
        tag,
        'Discord Webhook: failed to log error message',
        err
    )
    // ToDo: save as JSON and re-attempt later??
)

const interceptHandler = (eventName, handler) => async function (...args) {
    if (!isFn(handler)) return

    const requestId = uuid.v1()
    const client = this
    const userId = client.___userId
    const {
        maintenanceMode,
        params = [],
        requireLogin
    } = handler
    if (eventName === 'message') {
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
            console.log('Event pre-validation failed:', { eventName, args, err })
            return gotCb && callback(err)
        }

        // include the user object if login is required for this event
        const thisArg = [
            client,
            await onlineUsers.get(userId) //getUserByClientId(client.id),
        ]
        // add callback interceptor and prepare data for transport
        if (gotCb) args[args.length - 1] = (err, result, ...rest) => {
            // convert Map to 2D array
            if (isMap(result)) result = Array.from(result)
            callback(err, result, ...rest)
        }
        await handler.apply(thisArg, args)
    } catch (err) {
        gotCb && callback(`${texts.runtimeError}: ${requestId}`)

        // Print error meta data
        console.log([
            '', // adds an empty line before
            `${new Date().toISOString()} [RequestID]: ${requestId}.`,
            `InterceptHandler Error: uncaught error on event "${eventName}" handler.`,
        ].join('\n'))
        // print the error stack trace
        console.log(`${err}`, err.stack)

        if (DISCORD_WEBHOOK_URL) {
            // send message to discord
            const content = '>>> ' + [
                `**RequestID:** ${requestId}`,
                `**Event:** *${eventName}*`,
                '**Error:** ' + `${err.stack || err}`.replace('Error:', ''),
                userId ? `**UserID:** ${userId}` : '',
            ].join('\n')

            logDiscord(content, `[RequestID] ${requestId}`)
        }
    } finally {
        requestCount--
        maintenanceModeActive && console.info('Request Count', requestCount)
    }
}

const startListening = () => {
    // Setup websocket event handlers
    socket.on('connection', client => {
        // send event handlers' meta data to client
        emitToClients(
            [client],
            'events-meta',
            getClientEventsMeta(eventsHandlers),
        )

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
    })

    // Respond with event hander definitions
    expressApp.use('/', (_req, res) => {
        res.send(
            JSON.stringify(
                getClientEventsMeta(eventsHandlers),
                null,
                4
            )
        )
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
}
const init = async () => {
    const catchNReport = (prefix, fail = false) => async err => {
        if (!isError(err)) err = new Error(err)
        const tag = '[StartupError]'
        err.message = `${prefix} ${err.message}`
        !fail && console.log(new Date().toISOString(), tag, err.message)

        await logDiscord(err.message.replace('Error: ', ''), tag)
        return fail && Promise.reject(err)
    }
    // attempt to establish a connection to database and exit application if fails
    console.log('Setting up connection to CouchDB', couchDBUrl)
    await getConnection(couchDBUrl).catch(
        catchNReport('Failed to instantiate connection to CouchDB.', true)
    )
    // Setup languages and also attempt to make the first query to the database.
    // Failing here is probable indication that it failed to connect to the database
    await setupLang()
        .catch(catchNReport('Failed to setup language.', true))

    // wait until the following setups are complete but keep the service running even if any of them fails
    await setupCountries()
        .catch(catchNReport('Failed to setup countries.'))
    await setupCurrencies()
        .catch(catchNReport('Failed to setup currencies.'))
    // Attempt to connect to blockchain.
    // Failure to connect will not stop the application but will limit certain things like BONSAI auth check.
    await connectToBlockchain()
        .catch(catchNReport('Failed to connect to blockchain.'))

    startListening()
}
init()

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
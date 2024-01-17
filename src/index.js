/*
 * Chat & data server running on https
 */
import express from 'express'
import fs from 'fs'
import https from 'https'
import http from 'http'
import path from 'path'
import { Server } from 'socket.io'
import uuid from 'uuid'
import { getConnection, setDefaultUrl } from './utils/CouchDBStorage'
import { sendMessage as logDiscord } from './utils/discordHelper'
import PromisE from './utils/PromisE'
import {
    isArr,
    isError,
    isFn,
    isMap,
    isStr,
} from './utils/utils'
import { TYPES, validateObj } from './utils/validator'
// keep this above any local imports that may require the default database connection
setDefaultUrl(process.env.CouchDB_URL)
import { getConnection as connectToBlockchain } from './blockchain'
import cdpEventHandlers, { setup as setupCDP } from './cdp'
import { handleCompany, handleCompanySearch } from './companies'
import { setup as setupCountries, handleCountries } from './countries'
import { handlers as crowdloanHandlers } from './crowdloan'
import currencyHandlers, { setup as setupCurrencies } from './currencies'
// import { handlers as crowdsaleHanders } from './crowdsale/index'
import { handleFaucetRequest, handleFaucetStatus } from './faucetRequests'
import { handleGlAccounts } from './glAccounts'
import { importToDB } from './importToDB'
import languageHandlers, { setTexts, setup as setupLang } from './language'
import {
    handleMessage,
    handleMessageGetRecent,
    handleMessageGroupName,
} from './messages'
import { eventHandlers as miscEventHandlers } from './misc'
import { handleNewsletterSignup } from './newsletterSignup'
import {
    handleNotification,
    handleNotificationGetRecent,
    handleNotificationSetStatus,
} from './notification'
import { eventHandlers as projectEventHanders } from './projects'
import rewardsHandlers from './rewards'
import systemEventHandlers, { getClientEventsMeta, rxMaintenanceMode } from './system'
import {
    handleTask,
    handleTaskGetById,
    handleTaskGetByParentId,
    handleTaskMarketApply,
    handleTaskMarketApplyResponse,
    handleTaskMarketSearch,
} from './task'
import {
    eventHandlers as userEventHandlers,
    onlineUsers,
    setup as setupUsers,
    clients,
    originClients,
    rxClientConnection,
    broadcast,
} from './users'

// Error messages
const texts = {
    accessDenied: 'access denied',
    invalidEvent: 'Invalid or deprecated event!',
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
const basePathRegex = new RegExp(
    path
        .resolve('./')
        .replace(/\.\/\@\-\_/g, ''),
    'ig',
)

// set discord logger to remove base path from message
logDiscord.redactRegex = basePathRegex
const cert = fs.readFileSync(process.env.CertPath)
const ALL = 'ALL'
const clientUrls = (process.env.SOCKET_CLIENTS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => {
        if (x === ALL || x.startsWith('https://') || x.startsWith('http://')) return x
        return `https://${x}`
    })

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL
const DISCORD_WEBHOOK_AVATAR_URL = process.env.DISCORD_WEBHOOK_AVATAR_URL
process.env.DISCORD_WEBHOOK_USERNAME ??= 'Messaging Service Logger'
const DISCORD_WEBHOOK_USERNAME = process.env.DISCORD_WEBHOOK_USERNAME
const expressApp = express()
const eventLogDurationMs = parseInt(process.env.EVENT_LOG_DURATION_MS) || 5_000 // 5 seconds
const HTTPS_ONLY = process.env.HTTPS_ONLY === 'TRUE'
const importFiles = process.env.ImportFiles || process.env.MigrateFiles
const isDebug = process.env.DEBUG === 'TRUE'
const key = fs.readFileSync(process.env.KeyPath)
const PORT = process.env.PORT || 3001
let requestCount = 0
const httpsServer = https.createServer({
    cert,
    key,
}, expressApp)
const socket = new Server(httpsServer, {
    allowRequest: clientUrls.length === 0
        ? undefined
        : clientUrls.length === 1 && clientUrls[0] === ALL
            ? (_, callback) => callback(null, true) // allow requests from all clients regardless of origin
            : allowRequest
})
let unapprovedOrigins = []

const allEventHandlers = {
    // CDP
    ...cdpEventHandlers,

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

    // referenda etc events
    ...miscEventHandlers,

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

    // system & status endpoints
    ...systemEventHandlers,
    // [handleMaintenanceMode.eventName]: handleMaintenanceMode,
    // [handleEventsMeta.eventName]: handleEventsMeta,

    // Task 
    'task': handleTask,
    'task-get-by-id': handleTaskGetById,
    'task-get-by-parent-id': handleTaskGetByParentId,
    'task-market-apply': handleTaskMarketApply,
    'task-market-apply-response': handleTaskMarketApplyResponse,
    'task-market-search': handleTaskMarketSearch,

    // User & connection
    ...userEventHandlers,
}
// console.log(
//     Object
//         .keys(allEventHandlers)
//         .filter(key => !allEventHandlers[key])
//         .reduce((obj, key) => ({
//             ...obj,
//             [key]: allEventHandlers[key],
//         }), {})
// )
console.log('SOCKET_CLIENTS', clientUrls.length > 0 ? clientUrls : 'all')
console.log('Events allowed during maintenance mode:',
    Object
        .keys(allEventHandlers)
        .filter(key => allEventHandlers[key].maintenanceMode)
)

function allowRequest(request, callback) {
    const { headers: { origin } = {} } = request
    const allow = clientUrls.includes(origin)
    if (!allow && !unapprovedOrigins.includes(origin)) {
        unapprovedOrigins.push(origin)
        // keep maximum of 100 
        unapprovedOrigins = unapprovedOrigins.slice(-100)
        console.log('Websocket request rejected from unapproved origin:', origin)
    }
    isDebug && console.log({ origin, allow })
    callback(null, allow)
}

const interceptHandler = (eventName, handler) => async function (...args) {
    if (!isFn(handler)) return

    const startedAt = new Date()
    const client = this
    const requestId = uuid.v1()
    const userId = client.___userId
    const userRoles = client.___userRoles || []
    let {
        customMessages,
        failFast = true,
        includeLabel = true,
        includeValue = true,
        maintenanceMode,
        params = [],
        requireLogin, // boolean (any user) or array of user roles allowed
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

        const roleInvalid = requireLogin?.length
            && !requireLogin.find(role =>
                userRoles.includes(role)
            )
        if (roleInvalid) return gotCb && callback(texts.accessDenied)

        // validate event handler params
        const err = isArr(params)
            && params.length > 0
            && validateObj(
                [...args],
                params,
                failFast,
                includeLabel,
                customMessages,
                includeValue,
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
        console.log(err.stack)

        if (DISCORD_WEBHOOK_URL) {
            // send message to discord
            const content = '>>> ' + [
                `**RequestID:** ${requestId}`,
                `**Event:** *${eventName}*`,
                '**Error:** ' + `${err.stack || err}`.replace(/^Error\:\ /, ''),
                userId ? `**UserID:** ${userId}` : '',
            ].join('\n')

            logDiscord(content, `[RequestID] ${requestId}`)
        }
    }
    const finishedAt = new Date()
    maintenanceModeActive && console.info('Request Count', requestCount)
    requestCount--
    const diffMs = finishedAt - startedAt
    const logUserId = userId || ['login', 'register'].includes(eventName) && args[0]
    const logtxt = [
        '[RequestID]', requestId,
        '[EventName]', eventName,
        logUserId && `[UserId] ${logUserId}`,
        '|',
        `completed in ${diffMs}ms`,
    ]
        .filter(Boolean)
        .join(' ')
    !isDebug && console.log(logtxt)
    // if request takes longer than predefined duration report the incident
    if (diffMs > eventLogDurationMs) logDiscord(logtxt)
}

const startListening = () => {
    const handleConnection = client => {
        const {
            handshake: {
                headers: {
                    origin
                } = {}
            } = {}
        } = client
        // set number of clients by origin
        origin && originClients.set(origin, (originClients.get(origin) || 0) + 1)

        // add it to list of clients so that broadcasted events can include this client.
        clients.set(client.id, client)

        // send events' meta data to the client
        client.emit(
            'events-meta',
            getClientEventsMeta(allEventHandlers)
        )

        // add interceptable event handlers
        Object.keys(allEventHandlers)
            .forEach(eventName => {
                client.on(
                    eventName,
                    interceptHandler(
                        eventName,
                        allEventHandlers[eventName]
                    )
                )
            })

        // middleware to do stuff before the event handler is invoked.
        // Eg: if maintenance mode is enabled. This will cancel the event right here and prevent going to the event handler.
        // This can be used in the future to dynamically enable or disable events.
        client.use(([eventName, ...args], next) => {
            const callback = args.find(isFn)
            const handler = allEventHandlers[eventName]
            if (!handler) return callback?.(texts.invalidEvent)

            const maintenanceModeActive = rxMaintenanceMode.value
            const deny = maintenanceModeActive && !handler.maintenanceMode
            if (deny) return callback?.(texts.maintenanceMode)

            return next()
        })

        rxClientConnection.next({
            client,
            connected: true,
            origin,
        })
    }

    // setInterval(() => broadcast('test', [1, 2, 3]), 3000)
    // Setup websocket event handlers
    socket.on('connection', handleConnection)

    // Handle HTTP request on the api URL.
    // Reponds with a JSON object containing the following:
    //
    // - dataTypes: list of data type names used in the definitions and their respective native JS type and other info.
    // - emittables: definitions of websocket events the client can emit.
    // - listenables: definitions of websocket events the client can listen/subscribe to.
    expressApp.use('/', (request, result) => {
        const { headers: { host = '' } = {} } = request
        const isCdp = host.includes('company-') && host.endsWith('.agency')
        if (isCdp) {
            const appUrl = host.split('api.')[1] || ''
            return request.redirect(`https://${appUrl}`)
        }
        result.send(
            JSON.stringify(
                getClientEventsMeta(allEventHandlers, host),
                null,
                4
            )
        )
    })

    // Start listening
    httpsServer.listen(
        PORT,
        () => console.log(`Totem Messaging Service started. Websocket listening on port ${PORT} (https)`)
    )

    if (!HTTPS_ONLY && clientUrls.find(x => x.startsWith('http://'))) {
        const serverHttp = https.createServer(express())
        const socketHttp = new Server(serverHttp, { allowRequest })
        // Setup websocket event handlers
        socketHttp.on('connection', handleConnection)
        const PORT_HTTP = process.env.PORT_HTTP || 4001
        // Start listening
        serverHttp.listen(
            PORT_HTTP,
            () => console.log(`Totem Messaging Service started. Websocket listening on port ${PORT_HTTP} (http)`)
        )
    }
}
const init = async () => {
    broadcast.socket = socket

    const catchNReport = (prefix, fail = false, logStack = false) => async err => {
        if (!isError(err)) err = new Error(err)
        const tag = '[StartupError]'
        err.message = `${prefix} ${err.message}`
        !fail && console.log(new Date().toISOString(), tag, err.message)

        await logDiscord(`${logStack && err.stack || err}`.replace(/^Error\:\ /, ''), tag)
        return fail && Promise.reject(err)
    }

    // sequencial startup actions
    const actions = [
        [() => console.log('Setting up connection to CouchDB')],
        // attempt to establish a connection to database and exit application if fails
        [getConnection, [], 'Failed to instantiate connection to CouchDB.', true],
        // Setup languages and also attempt to make the first query to the database.
        // Failing here is probable indication that it failed to connect to the database
        [setupLang, [], 'Failed to setup language.', true],
        // wait until the following setups are complete but keep the service running even if some of them fails
        [setupCountries, [], 'Failed to setup countries.'],
        [setupCurrencies, [], 'Failed to setup currencies.'],
        [setupUsers, [], 'Failed to setup users.'],
        [setupCDP, [expressApp], 'Failed to setup CDP', true],
        [startListening, [], 'Websocket setup failed.', true],
        [connectToBlockchain, [], 'Failed to connect to blockchain.', false],
        [importToDB, [importFiles], 'Failed to import to DB', false],
    ]

    for (let i = 0;i < actions.length;i++) {
        const [
            func,
            args = [],
            errorMessage,
            required, // whether to stop application if action fails
        ] = actions[i]

        await PromisE(func(...args))
            .catch(
                catchNReport(
                    errorMessage,
                    required
                )
            )
    }
}
init()
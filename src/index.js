/*
 * Chat & data server running on https
 */
import express from 'express'
import fs from 'fs'
import https from 'https'
import socketIO from 'socket.io'
import { handleCompany, handleCompanySearch } from './companies'
import { handleCountries } from './countries'
import { handleFaucetRequest } from './faucetRequests'
import { handleErrorMessages, handleTranslations, setTexts } from './language'
import {
    handleProject,
    handleProjectsByHashes,
} from './projects'
import {
    handleDisconnect,
    handleIdExists,
    handleLogin,
    handleMessage,
    handleRegister,
} from './users'
import { handleNotify } from './notify'
import { isFn } from './utils/utils'
import CouchDBStorage from './CouchDBStorage'

const expressApp = express()
const cert = fs.readFileSync(process.env.CertPath)
const key = fs.readFileSync(process.env.KeyPath)
const PORT = process.env.PORT || 3001
const server = https.createServer({ cert, key }, expressApp)
const socket = socketIO.listen(server)
const texts = setTexts({
    runtimeError: 'Runtime error occured. Please try again later or email support@totemaccounting.com',
})
const handlers = [
    // User & connection
    { name: 'disconnect', handler: handleDisconnect },
    { name: 'message', handler: handleMessage },
    { name: 'id-exists', handler: handleIdExists },
    { name: 'register', handler: handleRegister },
    { name: 'login', handler: handleLogin },

    // Company
    { name: 'company', handler: handleCompany },
    { name: 'company-search', handler: handleCompanySearch },

    // Countries
    { name: 'countries', handler: handleCountries },

    // Faucet request
    { name: 'faucet-request', handler: handleFaucetRequest },

    // Language
    { name: 'translations', handler: handleTranslations },
    { name: 'error-messages', handler: handleErrorMessages },

    // Notification
    { name: 'notify', handler: handleNotify },

    // Project
    { name: 'project', handler: handleProject },
    { name: 'projects-by-hashes', handler: handleProjectsByHashes },
].filter(x => isFn(x.handler)) // ignore if handler is not a function

// intercepts all event callbacks and attaches a try-catch to catch any uncaught errors
const interceptHandlerCb = (client, { handler, name }) => function () {
    const args = arguments
    try {
        handler.apply(client, args)
    } catch (err) {
        const callback = args[args.length - 1]
        isFn(callback) && callback(texts.runtimeError)
        console.log(`interceptHandlerCb: uncaught error on event "${name}" handler. Error: ${err}`)
        // ToDo: use an error reporting service or bot for automatic error alerts
    }
}
// Setup websocket event handlers
socket.on('connection', client =>
    handlers.forEach(x =>
        client.on(x.name, interceptHandlerCb(client, x))
    )
)
// Start listening
server.listen(PORT, () => console.log(`Totem Messaging Service started. Websocket listening on port ${PORT} (https)`))

// const storage = new CouchDBStorage('http://admin:123456@127.0.0.1:5984', 'test1')
// const items = new Array(10).fill(0).map((_, i) => ({ _id: `${i}`, value: `${i}` }))
// storage.setAll(items).then(result => console.log({ result }), console.log)
// storage.getAll(['1', '2']).then(result => console.log({ result, total: result.total_rows }))

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
import { isFn, isArr } from './utils/utils'
import CouchDBStorage, { getConnection } from './CouchDBStorage'
import DataStorage from './utils/DataStorage'


const expressApp = express()
const cert = fs.readFileSync(process.env.CertPath)
const key = fs.readFileSync(process.env.KeyPath)
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
const interceptHandlerCb = (client, { handler, name }) => async function () {
    const args = arguments
    try {
        await handler.apply(client, args)
    } catch (err) {
        const callback = args[args.length - 1]
        isFn(callback) && callback(texts.runtimeError)
        console.log(`interceptHandlerCb: uncaught error on event "${name}" handler. Error: ${err}`)
        // ToDo: use an error reporting service or bot for automatic error alerts
    }
}

// attempt to establish a connection to database and exit application if fails
try {
    getConnection(couchDBUrl)
    console.log('Connected to CouchDB')
} catch (e) {
    console.log('CouchDB: connection failed. Error:\n', e)
    process.exit(1)
}
if (!!migrateFiles) {
    setTimeout(() => migrate(migrateFiles), 1000)
}
// Setup websocket event handlers
socket.on('connection', client =>
    handlers.forEach(x => client.on(x.name, interceptHandlerCb(client, x)))
)
// Start listening
server.listen(PORT, () => console.log(`Totem Messaging Service started. Websocket listening on port ${PORT} (https)`))


// Migrate JSON file storage to CouchDB.
// Existing entries will be ignored and will remain in the JSON file.
// Successfully stored entries will be removed from JSON file.
async function migrate(fileNames) {
    const filesAr = fileNames.split(',')
        // only include json file names
        .filter(x => x.endsWith('.json'))
        .map(x => x.trim())
    if (filesAr.length === 0) return console.log('')
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
        const db = new CouchDBStorage(getConnection(), dbName.replace(' ', '_'))
        const arrKeys = {
            'faucet-requests': 'requests',
            'translations': 'texts',
        }
        if (!!arrKeys[dbName]) {
            // wrap array value in an object as required by couchdb
            Array.from(data).forEach(([id, arr]) => {
                if (!isArr(arr)) return
                const value = {}
                value[arrKeys[dbName] || 'array'] = arr
                data.set(id, value)
            })
        }

        const result = await db.setAll(data, true)
        let count = 0
        result.forEach(({ ok, id }) => {
            if (!ok) retrun
            data.delete(id)
            count++
        })
        // update JSON file to remove migrated entries
        jsonStorage.setAll(data)
        console.log(`${file}: added ${count} entries. Ignored ${total - count} existing etries`)
    }
}

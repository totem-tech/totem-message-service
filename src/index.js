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

const expressApp = express()
const cert = fs.readFileSync(process.env.CertPath)
const key = fs.readFileSync(process.env.KeyPath)
const PORT = process.env.PORT || 3001
const server = https.createServer({ cert, key }, expressApp)
const socket = socketIO.listen(server)
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

    // Notification
    { name: 'notify', handler: handleNotify },

    // Project
    { name: 'project', handler: handleProject },
    { name: 'projects-by-hashes', handler: handleProjectsByHashes },
]

// Setup websocket event handlers
socket.on('connection', client => handlers.forEach(({ name, handler }) => client.on(name, handler.bind(client))))

// Start listening
server.listen(PORT, () => console.log(`Totem Messaging Service started. Websocket listening on port ${PORT} (https)`))

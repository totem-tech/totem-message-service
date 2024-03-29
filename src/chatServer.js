// /*
//  * Chat & data server running on https
//  */
// import https from 'https'
// import socketIO from 'socket.io'
// import { handleCompany, handleCompanySearch } from './companies'
// import { handleCountries } from './countries'
// import { handleFaucetRequest } from './faucetRequests'
// import {
//     handleProject,
//     handleProjectsByHashes,
// } from './projects'
// import {
//     handleDisconnect,
//     handleIdExists,
//     handleLogin,
//     handleMessage,
//     handleRegister,
// } from './users'
// import { handleNotify } from './notify'

// // export const PORT = 3001 

// let server, socket
// export const initChatServer = (httpsOptions, expressApp, PORT) => {
//     server = https.createServer(httpsOptions, expressApp)

//     // https://github.com/socketio/socket.io/issues/2276 stops setting an http cookie
//     socket = socketIO.listen(server, { cookie: false })

//     socket.on('connection', client => {
//         // User related handlers
//         client.on('disconnect', handleDisconnect.bind(client))
//         client.on('message', handleMessage.bind(client))
//         client.on('id-exists', handleIdExists.bind(client))
//         client.on('register', handleRegister.bind(client))
//         client.on('login', handleLogin.bind(client))

//         // Company related handlers
//         client.on('company', handleCompany.bind(client))
//         client.on('company-search', handleCompanySearch.bind(client))

//         // Countries related handlers
//         client.on('countries', handleCountries.bind(client))

//         // Faucet request
//         client.on('faucet-request', handleFaucetRequest.bind(client))

//         // Notification handler
//         client.on('notify', handleNotify.bind(client))

//         // Project related handlers
//         client.on('project', handleProject.bind(client))
//         client.on('projects-by-hashes', handleProjectsByHashes.bind(client))
//     })

//     // Start listening
//     server.listen(PORT, () => console.log('\nChat app https Websocket listening on port ', PORT))
// }
import handleDisconnect from './handleDisconnect'
import handleIdExists from './handleIdExists'
import handleIsUserOnline from './handleIsUserOnline'
import handleLogin from './handleLogin'
import handleRegister from './handleRegister'
export * from './users'

export const eventHandlers = {
    'disconnect': handleDisconnect,
    'id-exists': handleIdExists,
    'is-user-online': handleIsUserOnline,
    [handleLogin.eventName]: handleLogin,
    [handleRegister.eventName]: handleRegister,
}
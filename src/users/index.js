export * from './users'
import {
    handleIdExists,
    handleLogin,
    handleRegister,
    handleIsUserOnline,
} from './users'

export const eventHandlers = {
    'id-exists': handleIdExists,
    'register': handleLogin,
    'login': handleRegister,
    'is-user-online': handleIsUserOnline,
}
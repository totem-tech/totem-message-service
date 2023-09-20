import {
    handleGetReferendas,
    handleGetVotes,
} from './referenda'

export const eventHandlers = {
    [handleGetReferendas.eventName]: handleGetReferendas,
    [handleGetVotes.eventName]: handleGetVotes
}
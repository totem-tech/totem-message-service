import { getReferendaList, getVotes } from './referenda'

export const eventHandlers = {
    [getReferendaList.eventName]: getReferendaList,
    [getVotes.eventName]: getVotes
}
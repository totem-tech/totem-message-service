import handleCheckPaid, { checkPaid } from './handleCheckPaid'
import { setupStripe as _setupStripe, handleClientAPIKey } from './getStripe'
import handleCreateIntent from './handleCreateIntent'

export const handleStripeCheckPaid = handleCheckPaid

export const handleStripeClientAPIKey = handleClientAPIKey

export const handleStripeCreateIntent = handleCreateIntent

// setup stripe instance
export const setupStripe = _setupStripe

export const stripeCheckPaid = checkPaid
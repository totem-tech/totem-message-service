import Stripe from 'stripe'
import { fallbackIfFails } from '../../utils/utils'
import { defs } from '../validation'
import { TYPES } from '../../utils/validator'

const API_KEY = process.env.CDP_STRIPE_API_KEY
const CLIENT_API_KEY = process.env.CDP_STRIPE_CLIENT_API_KEY
let stripe

export default function getStripe(silent = true) {
    if (!stripe) silent
        ? fallbackIfFails(setupStripe)
        : setupStripe()

    return stripe
}

export function handleClientAPIKey(callback) {
    callback?.(null, CLIENT_API_KEY)
}
handleClientAPIKey.description = 'Fetch Stipe client API key'
handleClientAPIKey.params = [defs.callback]
handleClientAPIKey.result = {
    name: 'clientAPIKey',
    type: TYPES.string,
}

// setup stripe instance
export function setupStripe() {
    if (!API_KEY) throw new Error('Missing environment variable: CDP_STRIPE_API_KEY')
    // if (!CLIENT_API_KEY) throw new Error('Missing environment variable: CDP_STRIPE_CLIENT_API_KEY')

    stripe ??= new Stripe(API_KEY)
    return stripe
}
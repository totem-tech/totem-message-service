import getStripe from 'stripe'
import {
	dbCdpAccessCodes,
	dbCdpStripeIntents,
	dbCompanies,
	defs,
	messages,
} from './common'
import { isFn, isPositiveNumber } from '../utils/utils'
import { TYPES } from '../utils/validator'

const AMOUNT_GBP_PENNIES = 9900 // 99 Pounds Sterling in Pennies
const API_KEY = process.env.CDP_STRIPE_API_KEY
const CURRENCY = 'gbp'
let stripe = new getStripe(API_KEY)

const checkPaid = async (intentId, companyId) => {
	const intent = await stripe
		.paymentIntents
		.retrieve(intentId)
	const intentPaid = intent?.id == intentId
		&& intent?.status === 'succeeded'
		&& intent?.amount_received === AMOUNT_GBP_PENNIES
	const intentLog = !!intentPaid && await dbCdpStripeIntents.get(intentId)
	return intentLog?.companyId === companyId
}


export const handleStripeCheckPaid = async (intentId, companyId, callback) => callback?.(
	null,
	await checkPaid(intentId, companyId)
)
handleStripeCheckPaid.params = [
	{
		description: 'Stripe payment intent ID',
		name: 'intentId',
		required: true,
		type: TYPES.string,
	},
	// {
	// 	defaultValue: AMOUNT_GBP_PENNIES,
	// 	description: 'If provided check if intent amount matches the amount supplied.',
	// 	name: 'amount',
	// 	required: false,
	// 	type: TYPES.number
	// },
	defs.companyId,
	defs.callback,
]
handleStripeCheckPaid.result = {
	name: 'succeeded',
	type: TYPES.boolean
}

export default async function handleStripeCreateIntent(
	code,
	companyId,
	regNum,
	callback
) {
	if (!isFn(callback)) return

	const companyOrCdpEntry = companyId && (
		await dbCdpAccessCodes.get(companyId) || await dbCompanies.get(companyId)
	)
	if (!companyOrCdpEntry) return callback(messages.invalidCompany)
	const {
		accessCode,
		registrationNumber
	} = companyOrCdpEntry || {}

	const allowIntent = registrationNumber === regNum
		// if an access code is available, it must be provided
		&& (!accessCode || accessCode === code)
	if (!allowIntent) return callback(messages.invalidCodeOrReg)

	if (!stripe) await setupStripe()

	const amount = AMOUNT_GBP_PENNIES
	const currency = CURRENCY
	// Create a PaymentIntent with the order amount and currency
	const paymentIntent = await stripe.paymentIntents.create({
		amount,
		// In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
		automatic_payment_methods: {
			enabled: true,
		},
		currency: CURRENCY, // pounds sterling
	})

	const intentLogEntry = {
		amount,
		companyId,
		createAccessCode: !accessCode,
		currency,
		intentId: paymentIntent.id,
		paid: false, // to be updated after payment is completed
		registrationNumber: regNum,
	}
	await dbCdpStripeIntents.set(paymentIntent.id, intentLogEntry)

	callback(null, paymentIntent.client_secret)
}
handleStripeCreateIntent.description = 'Create Stripe payment intent for Company Digital Passports'
handleStripeCreateIntent.params = [
	{
		...defs.accessCode,
		description: 'Field is required if company already has an access code.',
		required: false,
	},
	defs.companyId,
	defs.regNum,
	defs.callback,
]
handleStripeCreateIntent.result = {
	name: 'stripeClientSecret',
	type: TYPES.string,
}

// setup stripe instance
export function setupStripe(expressApp) {
	if (!API_KEY) throw new Error('Missing environment variable: CDP_STRIPE_API_KEY')

	stripe ??= new getStripe(API_KEY)
}
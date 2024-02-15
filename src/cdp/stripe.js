import getStripe from 'stripe'
import {
	dbCdpAccessCodes,
	dbCdpStripeIntents,
	dbCompanies,
	defs,
	messages,
} from './common'
import {
	isError,
	isFn,
	objClean,
} from '../utils/utils'
import { TYPES } from '../utils/validator'

export const AMOUNT_GBP_PENNIES = 9900 // 99 Pounds Sterling in Pennies
const API_KEY = process.env.CDP_STRIPE_API_KEY
const CLIENT_API_KEY = process.env.CDP_STRIPE_CLIENT_API_KEY
const CURRENCY = 'gbp'
let stripe = new getStripe(API_KEY)
const addressDef = {
	name: 'address',
	properties: [
		{
			description: 'City, district, suburb, town, or village.',
			name: 'city',
			required: true,
			type: TYPES.string,
		},
		{
			description: 'Two-letter country code (ISO 3166-1 alpha-2). Mode details: https://stripe.com/docs/api/payment_methods/object#payment_method_object-billing_details-address-country',
			maxLength: 2,
			minLength: 2,
			name: 'country',
			required: true,
			type: TYPES.string,
		},
		{
			description: 'Address line 1 (e.g., street, PO Box, or company name).',
			name: 'line1',
			required: true,
			type: TYPES.string,
		},
		{
			description: 'Address line 2 (e.g., apartment, suite, unit, or building).',
			name: 'line2',
			required: false,
			type: TYPES.string,
		},
		{
			description: 'ZIP or postal code.',
			name: 'postal_code',
			required: true,
			type: TYPES.string,
		},
		{
			description: 'State, county, province, or region.',
			name: 'state',
			required: true,
			type: TYPES.string,
		},
	],
	type: TYPES.object,
}
const billingDetailsDef = {
	name: 'billingDetails',
	properties: [
		addressDef,
		{
			name: 'email',
			required: true,
			type: TYPES.email,
		},
		{
			description: 'Full name.',
			name: 'name',
			required: true,
			type: TYPES.string,
		},
		{
			description: 'Billing phone number (including extension).',
			name: 'phone',
			required: false,
			type: TYPES.string,
		},
		{ // ToDo: generate
			description: 'Date CDP is valid from',
			name: 'tsValidFrom',
			required: false,
			type: TYPES.date,
		},
		{
			description: 'CDP expiry date',
			name: 'tsValidTo',
			required: false,
			type: TYPES.date,
		},
	],
	type: TYPES.object,
}

export const checkPaid = async (intentId, companyId) => {
	if (!intentId) return false
	if (!stripe) await setupStripe()

	const intent = await stripe
		.paymentIntents
		.retrieve(intentId)
	const {
		amount_received,
		id,
		metadata: md1 = {},
		status,
	} = intent || {}
	const paymentSuccess = id == intentId && status === 'succeeded'
	if (!paymentSuccess) return false

	const intentLog = await dbCdpStripeIntents.get(intentId)
	const {
		amount,
		metadata: md2 = {},
	} = intentLog || {}
	if (!intentLog || md?.companyId !== companyId) return false

	const paymentValid = amount_received === amount
		&& Object // check all metatadata matches
			.keys(md2)
			.every(key => md1[key] === md2[key])
	return paymentValid
}

export const handleStripeCheckPaid = async (
	intentId,
	companyId,
	callback
) => callback?.(null, await checkPaid(intentId, companyId))
handleStripeCheckPaid.params = [
	{
		description: 'Stripe payment intent ID',
		name: 'intentId',
		required: true,
		type: TYPES.string,
	},
	defs.companyId,
	defs.callback,
]
handleStripeCheckPaid.result = {
	name: 'paymentValid',
	type: TYPES.boolean
}

export default async function handleStripeCreateIntent(
	code,
	companyId,
	regNum,
	billingDetails = {},
	callback
) {
	if (!isFn(callback)) return
	if (!companyId) return callback(messages.invalidCompany)

	const companyOrCdpEntry = await dbCdpAccessCodes.get(companyId)
		|| await dbCompanies.get(companyId)
	if (!companyOrCdpEntry) return callback(messages.invalidCompany)
	const {
		accessCode,
		cdpIssueIndex = 0,
		registrationNumber
	} = companyOrCdpEntry || {}

	const allowIntent = registrationNumber === regNum
		// if an access code is available, it must be provided
		&& (!accessCode || accessCode === code)
	if (!allowIntent) return callback(messages.invalidCodeOrReg)

	if (!stripe) await setupStripe()

	const amount = AMOUNT_GBP_PENNIES
	const currency = CURRENCY
	// remove any unintentional/unwanted properties
	const address = objClean(
		billingDetails.address || {},
		addressDef.properties.map(x => x.name)
	)
	const {
		email = '',
		name = '',
		phone = ''
	} = billingDetails
	// Create a PaymentIntent with the order amount and currency
	const metadata = {
		cdpIssueIndex,
		companyId,
		registrationNumber,
	}
	const paymentIntent = await stripe
		.paymentIntents
		.create({
			amount,
			// In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
			automatic_payment_methods: {
				enabled: true,
				allow_redirects: 'always' //default
			},
			currency: CURRENCY, // pounds sterling
			description: !companyOrCdpEntry.cdp
				? 'CDP: Application'
				: `CDP: Renewal (${cdpIssueIndex})`,
			metadata,
			shipping: {
				address,
				name,
			},
			receipt_email: email
		})
		.catch(err => new Error(err))
	// stripe threw an error
	if (isError(paymentIntent)) return callback(paymentIntent.message)

	const intentLogEntry = {
		amount,
		billingDetails: {
			address,
			email,
			name,
			phone,
		},
		createAccessCode: !accessCode,
		currency,
		intentId: paymentIntent.id,
		metadata,
		paid: false, // to be updated after payment is completed
	}
	await dbCdpStripeIntents.set(paymentIntent.id, intentLogEntry)

	callback(null, objClean(paymentIntent, ['client_secret', 'id']))
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
	billingDetailsDef,
	defs.callback,
]
handleStripeCreateIntent.result = {
	properties: [
		{
			description: 'Stripe payment client secret',
			name: 'clientSecret',
			type: TYPES.string,
		},
		{
			description: 'Stripe payment intent ID',
			name: 'id',
			type: TYPES.string,
		},
	],
	type: TYPES.object,
}

export function handleStripeClientAPIKey(callback) {
	callback?.(null, CLIENT_API_KEY)
}
handleStripeClientAPIKey.description = 'Fetch Stipe client API key'
handleStripeClientAPIKey.params = [defs.callback]
handleStripeClientAPIKey.result = {
	name: 'clientAPIKey',
	type: TYPES.string,
}

// setup stripe instance
export function setupStripe(expressApp) {
	if (!API_KEY) throw new Error('Missing environment variable: CDP_STRIPE_API_KEY')
	// if (!CLIENT_API_KEY) throw new Error('Missing environment variable: CDP_STRIPE_CLIENT_API_KEY')

	stripe ??= new getStripe(API_KEY)
}
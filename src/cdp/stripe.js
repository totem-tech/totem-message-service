import Stripe from 'stripe'
import {
	generateHash,
	isError,
	isFn,
	isPositiveInteger,
	objClean,
} from '../utils/utils'
import { TYPES } from '../utils/validator'
import {
	dbCdpAccessCodes,
	dbCdpStripeIntents,
	dbCompanies,
} from './couchdb'
import handleCalcValidityPeriod from './handleCalcValidityPeriod'
import { getIdentity } from './nacl'
import { defs, messages } from './validation'
import verifyGeneratedData from './verifyGeneratedData'
import { accessCodeHashed } from './utils'

export const AMOUNT_GBP_PENNIES = 9900 // 99 Pounds Sterling in Pennies
const API_KEY = process.env.CDP_STRIPE_API_KEY
const CLIENT_API_KEY = process.env.CDP_STRIPE_CLIENT_API_KEY
const CURRENCY = 'gbp'
let stripe = new Stripe(API_KEY)
const stripeAddressDef = {
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
const stripeBillingDetailsDef = {
	name: 'billingDetails',
	properties: [
		stripeAddressDef,
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
	],
	type: TYPES.object,
}

export const checkPaid = async (intentId, companyId) => {
	if (!intentId) return [false]
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
	if (!paymentSuccess) return [false]

	const intentLog = await dbCdpStripeIntents.get(intentId)
	const {
		amount,
		metadata: md2 = {},
	} = intentLog || {}

	if (!intentLog || md2?.companyId !== companyId) return [false]

	const paymentValid = amount_received === amount
		&& Object // check all metatadata matches
			.keys(md2)
			.every(key => md1[key] === md2[key])

	return [paymentValid, intentLog]
}

export const handleStripeCheckPaid = async (
	intentId,
	companyId,
	callback
) => {
	const [paid] = await checkPaid(intentId, companyId)
	callback?.(null, paid)
}
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
	accessCode,
	companyId,
	regNum,
	billingDetails = {},
	generatedData = {},
	callback
) {
	// remove any unintentional/unwanted properties
	generatedData = objClean(
		generatedData,
		defs
			.generatedData
			.properties
			.map(x => x.name),
	)
	if (!stripe) await setupStripe()

	if (!isFn(callback)) return
	if (!companyId) return callback(messages.invalidCompany)

	const company = await dbCompanies.get(companyId)
	const cdpEntry = await dbCdpAccessCodes.get(companyId)
	if (!company || !cdpEntry) return callback(messages.invalidCompany)

	let {
		accessCode: code,
		accounts: {
			accountRefMonth
		} = {},
		cdpIssueCount = 0,
		registrationNumber
	} = { ...company, ...cdpEntry }
	accountRefMonth = Number(accountRefMonth)
	const invalidMonth = !accountRefMonth
		|| accountRefMonth > 12
		|| accountRefMonth < 1
	if (invalidMonth) return callback(messages.invalidCompany)

	const allowIntent = registrationNumber === regNum
		// if an access code is available, it must be provided
		&& (!code || code === accessCodeHashed(accessCode, companyId))
		&& !isPositiveInteger(cdpIssueCount)
	if (!allowIntent) return callback(messages.invalidCodeOrReg)

	// verify signature
	const ok = verifyGeneratedData(companyId, generatedData)
	if (!ok) return callback(messages.invalidSignature)

	generatedData.serverIdentity = getIdentity()
	const amount = AMOUNT_GBP_PENNIES
	const currency = CURRENCY
	// remove any unintentional/unwanted properties
	const address = objClean(
		billingDetails.address || {},
		stripeAddressDef.properties.map(x => x.name)
	)
	const {
		email = '',
		name = '',
		phone = ''
	} = billingDetails
	let tsValidTo, tsErr
	await handleCalcValidityPeriod(
		accountRefMonth,
		companyId,
		(err, ts) => {
			tsValidTo = ts
			tsErr = err
		}
	)
	if (tsErr) return callback(tsErr)
	const year = new Date(tsValidTo).getFullYear()
	const month = new Date(tsValidTo).getMonth() + 1
	const monthYear = `${month}/${year}`
	// this allows stripe to re-use payment intent and also not clog up the database
	const idempotencyKey = generateHash([
		companyId,
		monthYear,
		cdpIssueCount,
		JSON.stringify(address),
		name,
		email,
		phone,
	].join('__'))
	const metadata = {
		cdpIssueCount: `${cdpIssueCount}`,
		companyId,
		registrationNumber,
		tsValidTo,
	}
	const intentParams = {
		amount,
		// In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
		automatic_payment_methods: {
			enabled: true,
			allow_redirects: 'always' //default
		},
		currency: CURRENCY, // pounds sterling
		description: !cdpEntry.cdp
			? 'CDP: Application'
			: `CDP: Renewal - ${monthYear}`,
		metadata,
		shipping: {
			address,
			name,
		},
		receipt_email: email
	}
	const intent = await stripe
		.paymentIntents
		.create(intentParams, { idempotencyKey })
		.catch(err => new Error(err))
	// stripe threw an error
	if (isError(intent)) return callback(intent.message)
	const existingLogEntry = await dbCdpStripeIntents.get(intent.id)
	const intentLogEntry = {
		amount,
		billingDetails: {
			address,
			email,
			name,
			phone,
		},
		createAccessCode: !code,
		currency,
		generatedData,
		intentId: intent.id,
		metadata,
		status: 'created', // to be updated after payment is completed
	}
	await dbCdpStripeIntents.set(intent.id, intentLogEntry, true)

	callback(null, {
		...objClean(intent, ['client_secret', 'id']),
		idempotencyKey,
		isNewIntent: !existingLogEntry,
		// for reused intent check if payment was previously successful
		previouslyPaid: !!existingLogEntry
			&& await checkPaid(intent.id, companyId)
				.then(([paid]) => paid)
				.catch(() => false)
	})
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
	stripeBillingDetailsDef,
	defs.generatedData,
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
		{
			description: 'Indicates whether the intent was previous created and is being re-used',
			name: 'isNewIntent',
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

	stripe ??= new Stripe(API_KEY)
}

// stripe.paymentIntents.retrieve('pi_3OkM95A0mJCmFu491IGKosjN').then(console.log)
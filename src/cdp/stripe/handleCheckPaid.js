import { TYPES } from '../../utils/validator'
import { dbCdpStripeIntents } from '../couchdb'
import { defs } from '../validation'
import getStripe from './getStripe'

export const checkPaid = async (intentId, companyId) => {
	if (!intentId) return [false]

	const stripe = getStripe()
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

export default async function handleCheckPaid(
	intentId,
	companyId,
	callback
) {
	const [paid] = await checkPaid(intentId, companyId)
	callback?.(null, paid)
}
handleCheckPaid.params = [
	{
		description: 'Stripe payment intent ID',
		name: 'intentId',
		required: true,
		type: TYPES.string,
	},
	defs.companyId,
	defs.callback,
]
handleCheckPaid.result = {
	name: 'paymentValid',
	type: TYPES.boolean
}
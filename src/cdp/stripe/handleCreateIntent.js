import {
    generateHash,
    isError,
    isFn,
    isPositiveInteger,
    objClean,
} from '../../utils/utils'
import { TYPES } from '../../utils/validator'
import {
    dbCdpAccessCodes,
    dbCdpDrafts,
    dbCdpStripeIntents,
    dbCompanies,
} from '../couchdb'
import { calcValidityPeriod } from '../handleCalcValidityPeriod'
import { getIdentity } from '../nacl'
import { defs, messages } from '../validation'
import verifyGeneratedData from '../verifyGeneratedData'
import { accessCodeHashed, draftToStripeAddress } from '../utils'
import getStripe from './getStripe'
import { calcCDPPaymentAmount } from '../handleCalcCDPPaymentAmount'
import { checkPaid } from './handleCheckPaid'

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
            // maxLength: 2,
            // minLength: 2,
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

export default async function handleCreateIntent(
    accessCode,
    companyId,
    regNum,
    billingDetails = {},
    generatedData = {},
    callback
) {
    const stripe = getStripe()
    if (!isFn(callback)) return
    if (!companyId) return callback(messages.invalidCompany)

    const company = await dbCompanies.get(companyId)
    const cdpEntry = await dbCdpAccessCodes.get(companyId)
    if (!company || (!!accessCode && !cdpEntry)) return callback(messages.invalidCompany)

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

    // remove any unintentional/unwanted properties
    generatedData = objClean(
        generatedData,
        defs
            .generatedData
            .properties
            .map(x => x.name),
    )
    generatedData.serverIdentity = getIdentity()
    const amountDetails = await calcCDPPaymentAmount(company)
    const {
        amountTotal,
        currency,
    } = amountDetails
    // remove any unintentional/unwanted properties
    const billingAddress = objClean(
        billingDetails.address || {},
        stripeAddressDef.properties.map(x => x.name)
    )
    const shippingAddress = await draftToStripeAddress(company._id)
    const {
        email = '',
        name = '',
        phone = ''
    } = billingDetails
    const tsValidTo = await calcValidityPeriod(accountRefMonth, companyId)
    const year = new Date(tsValidTo).getFullYear()
    const month = new Date(tsValidTo).getMonth() + 1
    const monthYear = `${month}/${year}`
    // this allows stripe to re-use payment intent and also not clog up the database
    const idempotencyKey = generateHash([
        companyId,
        monthYear,
        cdpIssueCount,
        JSON.stringify(billingAddress),
        JSON.stringify(shippingAddress),
        name,
        email,
        phone,
        JSON.stringify(amountDetails),
    ].join('__'))

    const metadata = {
        cdpIssueCount: `${cdpIssueCount}`,
        companyId,
        registrationNumber,
        tsValidTo,
    }
    // values to be supplied to stripe.js
    const intentParams = {
        amount: amountTotal,
        // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
        // automatic_payment_methods: {
        //     enabled: true,
        //     allow_redirects: 'always' //default
        // },
        currency,
        description: !cdpEntry?.cdp
            ? 'CDP: Application'
            : `CDP: Renewal - ${monthYear}`,
        metadata,
        receipt_email: email,
        shipping: {
            address: shippingAddress,
            name,
        },

        // testing payment method atls
        automatic_payment_methods: {
            enabled: false,
        },
        // payment_method: null,
        payment_method_options: {
            card: {
                // installments: {
                //     enabled: false,
                // },
                // // 'mandate_options': null,
                // // 'network': null,
                'request_three_d_secure': 'automatic'
            },
        },
        payment_method_types: [
            'card',
        ],
        //test end
    }
    const intent = await stripe
        .paymentIntents
        .create(intentParams, { idempotencyKey })
        .catch(err => new Error(err))
    // stripe threw an error
    if (isError(intent)) return callback(intent.message)
    const existingLogEntry = await dbCdpStripeIntents
        .get(intent.id)
    const intentLogEntry = {
        amountDetails,
        billingDetails: {
            address: billingAddress,
            email,
            name,
            phone,
        },
        shippingAddress,
        createAccessCode: !code,
        generatedData,
        intentId: intent.id,
        metadata,
        provider: 'stripe',
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
handleCreateIntent.description = 'Create Stripe payment intent for Company Digital Passports'
handleCreateIntent.params = [
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
handleCreateIntent.result = {
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
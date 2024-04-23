import { TYPES } from '../utils/validator'
import { dbCompanies } from './couchdb'
import { defs, messages } from './validation'

// prices for UK based companies by company accountCategory
const categoryPrices = {
    // tier 0: free tier?

    // tier 1: amount + vat => 2250 + 450 = 27.00 GBP
    unknown: 2250,
    'ACCOUNTS TYPE NOT AVAILABLE': 2250,
    'DORMANT': 2250,
    'NO ACCOUNTS FILED': 2250,
    'PARTIAL EXEMPTION': 2250,
    'UNAUDITED ABRIDGED': 2250,

    'AUDITED ABRIDGED': 2250,
    'FULL': 2250,
    'INITIAL': 2250,
    'MEDIUM': 2250,
    'MICRO ENTITY': 2250,
    'SMALL': 2250,
    'TOTAL EXEMPTION FULL': 2250,
    'TOTAL EXEMPTION SMALL': 2250,

    // tier 2: amount + vat => 8250 + 1650 = 99.00 GBP
    'FILING EXEMPTION SUBSIDIARY': 8250,
    'AUDIT EXEMPTION SUBSIDIARY': 8250,
    'GROUP': 8250,
}
Object
    .keys(categoryPrices)
    .forEach(category =>
        categoryPrices[category.toLowerCase()] = categoryPrices[category]
    )
export async function calcCDPPaymentAmount(company = {}) {
    const {
        accounts: { accountCategory = '' } = {},
        countryCode = '',
        // regAddress: {
        //     county,
        //     country,
        // } = {}
    } = company

    let amount,
        amountVAT,
        currency,
        amountTotal,
        vatPercentage,
        vatRegion
    switch (`${countryCode || ''}`.toLowerCase()) {
        case 'gb':
            amount = categoryPrices[accountCategory?.toLowerCase?.()] || categoryPrices.unknown
            currency = 'gbp'
            vatPercentage = 20 // 20%
            vatRegion = [countryCode] // for state/county based vat use [countryCode, state]
            break
        default:
            throw new Error('Failed to set payment amount. Invalid or unsupported country!')
    }

    amountVAT = parseInt(amount * vatPercentage / 100)
    amountTotal = parseInt(amount + amountVAT)

    return {
        amount,
        amountVAT,
        currency,
        amountTotal,
        vatPercentage, // 0 to 100
        vatRegion,
    }
}

export default async function handleCalcCDPPaymentAmount(companyId, callback) {
    const company = await dbCompanies.get(companyId)
    if (!company) return callback(messages.invalidCompany)

    const result = await calcCDPPaymentAmount(company)
    callback(null, result)
}
handleCalcCDPPaymentAmount.params = [
    defs.companyId,
    defs.callback,
]
handleCalcCDPPaymentAmount.result = {
    properties: [
        {
            description: 'Amount before VAT in pennies/cents',
            name: 'amount',
            type: TYPES.integer,
        },
        {
            description: 'Amount of VAT in pennies/cents',
            name: 'amountVAT',
            type: TYPES.integer,
        },
        {
            description: 'Payment currency',
            name: 'currency',
            type: TYPES.string,
        },
        {
            description: 'Amount after VAT in pennies/cents. The final/payment amount.',
            name: 'amountTotal',
            type: TYPES.integer,
        },
        {
            description: 'VAT percentage.',
            max: 100,
            min: 0,
            name: 'vatPercentage',
            type: TYPES.integer,
        },
        {
            description: 'The country/region VAT percentage is based on. If VAT is applied on the country-level, state/county will not be included. Eg: ["GB"], ["US", "New York"]',
            maxLength: 2,
            minLength: 1,
            name: 'vatRegion',
            type: TYPES.array,
        },

    ],
    type: TYPES.object,
}
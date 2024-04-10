import { TYPES } from '../utils/validator'
import { dbCompanies } from './couchdb'
import { defs, messages } from './validation'

export async function calcCDPPaymentAmount(company = {}) {
    const {
        countryCode = '',
        regAddress: {
            county,
            country,
        } = {}
    } = company

    let amount,
        amountVAT,
        currency,
        amountTotal,
        vatPercentage,
        vatRegion
    switch (`${countryCode || ''}`.toLowerCase()) {
        case 'gb':
            amount = 833 // 0
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
import CouchDBStorage from './CouchDBStorage'
import { generateHash, isFn, isStr, isValidNumber } from './utils/utils'
import { setTexts } from './language'

const currencies = new CouchDBStorage(null, 'currencies')
let tickerArrHash = ''
const messages = setTexts({
    invalidRequest: 'Missing one or more of the required fields',
    notFound: 'Unsupported currency'
})

// initialize
setTimeout(async () => {
    // create an index for the field `currency`, ignores if already exists
    const indexDef = {
        index: { fields: [ 'currency' ] },
        name: 'currency-index',
    }
    await (await currencies.getDB()).createIndex(indexDef)
    const tickers = Array.from(await currencies.getAll()).map(([_, x]) => x.currency).sort()
    tickerArrHash = generateHash(tickers)
})

// convert currency using exchange rates stored in the database
//
// Params:
// @from        string: source currency ticker. Eg: USD
// @to          string: target currency ticker. Eg: EUR
// @amount      number: the amount to convert to @to currency
// @callback    function: args => 
//                  @err                string: error message if request failed. Otherwise, null.
//                  @convertedAmount    number: converted amount
export const handleCurrencyConvert = async (from, to, amount, callback) => {
    if (!isFn(callback)) return
    if (!isStr(from) || !from || !isStr(to) || !to || !amount || !isValidNumber(amount))
        return callback(messages.invalidRequest)
        
    const fromCurrency = await currencies.find({
        currency: from.toUpperCase(),
    }, true, true, false)
    if (!fromCurrency) return callback(`${messages.notFound}: ${from}`)
    
    const toCurrency = await currencies.find({
        currency: to.toUpperCase(),
    }, true, true, false)
    if (!toCurrency) return callback(`${messages.notFound}: ${to}`)
    
    const convertedAmount = (fromCurrency.ratioOfExchange / toCurrency.ratioOfExchange) / amount
    callback(null, convertedAmount)
}

// retrives list of supported currency names
export const handleCurrencyList = async (hash, callback) => isFn(callback) && callback(
    null, hash === tickerArrHash ? new Map() : await currencies.getAll()
)
import CouchDBStorage from './utils/CouchDBStorage'
import { arrSort, generateHash, isFn } from './utils/utils'
import { setTexts } from './language'
import { TYPES, validate, validateObj } from './utils/validator'
import PromisE from './utils/PromisE'

const currencies = new CouchDBStorage(null, 'currencies')
const dailyHistoryDB = new CouchDBStorage(null, 'currency_price_history_daily')
let currenciesHash // hash of sorted array of supported currencies
let currenciesPromise
const autoRefreshDelay = 60 * 60 * 1000
const messages = setTexts({
    invalidRequest: 'Missing one or more of the required fields',
    notFound: 'Unsupported currency'
})

/**
 * @name    autoUpdateHash
 * @summary auto update hash of currencies list
 */
const autoUpdateHash = async () => {
    console.log(new Date(), 'Updating currencies cache')
    try {
        currenciesPromise = await getAll(null, false)
        currenciesHash = generateHash(arrSort(await currenciesPromise, 'ticker'))
        setTimeout(autoUpdateHash, autoRefreshDelay)
    } catch (err) {
        console.error(new Date(), 'Failed to update currencies cache', err)
    }
}

/**
 * @name    handleCurrencyConvert
 * @summary handle currency conversion requests
 * 
 * @param   {String}    from        source currency ID or ticker
 * @param   {String}    to          target currency ID or ticker
 * @param   {Number}    amount      the amount to convert to @to currency
 * 
 * @returns {Array}     [
 *                          @err                String: error message if any,
 *                          @convertedAmount    Number: converted amount without rounding
 *                          @rounded            String: converted amount rounded to appropriate decimal places
 *                      ]
 */
export const convertTo = async (from, to, amount) => {
    const err = validateObj({ amount, from, to }, convertTo.validationConf)
    if (err) return [err]

    const fromCurrency = await currencies.get(from) || await currencies.find({ ticker: from })
    if (!fromCurrency) return [`${messages.notFound}: ${from}`]

    const toCurrency = from === to
        ? fromCurrency
        : await currencies.get(to) || await currencies.find({ ticker: to })
    if (!toCurrency) return [`${messages.notFound}: ${to}`]

    const { decimals = 0 } = toCurrency
    const convertedAmount = from === to
        ? amount // conversion not required
        : (fromCurrency.ratioOfExchange / toCurrency.ratioOfExchange) * amount
    const rounded = convertedAmount.toFixed(parseFloat(decimals + 2))

    return [
        null, // no errors
        convertedAmount,
        rounded.substr(0, rounded.length - (!decimals ? 3 : 2)),
    ]
}
convertTo.validationConf = {
    amount: {
        required: true,
        type: TYPES.number,
    },
    from: {
        required: true,
        type: TYPES.string,
    },
    to: {
        required: true,
        type: TYPES.string,
    },
}

/**
 * @name    getAll
 * @summary get list of all or specific currencies
 * 
 * @param   {Array|Null}    ids   (optional) Default: null
 * @param   {Boolean}       asMap (optional) Default: true
 * @param   {Number}        limit (optional) Default: 9999
 * 
 * @returns {Array|Map}
 */
const getAll = async (ids = null, asMap = true, limit = 9999) => await currencies.getAll(ids, asMap, limit)

/**
 * @name    getClosingPriceByDate
 * @summary retrieve currency closing price for a specific date
 * 
 * @param   {Date}      date 
 * @param   {Array}     currencyIDs (optional) list of specific currency IDs. 
 *                                  If empty, will return all available prices for the date.
 * @param   {Function}  callback    args =>
 *                                      - err    string: error message if request failed
 *                                      - result array: list of prices
 * @example ```javascript
 * 
 * // Example @result:
 * [ {
 *      currencyID: 'A.stock', 
 *      ratioOfExchange: 100000000 
 * } ]
 * ```
 */
export const handleCurrencyPricesByDate = async (date, currencyIDs, callback) => {
    if (!isFn(callback)) return

    const { validatorConf } = handleCurrencyPricesByDate
    const err = validateObj({ date, currencyIDs }, validatorConf, true, true)
    if (err) return callback(err)

    const selector = { date }
    const limit = currencyIDs.length || (await currenciesPromise).length
    if (currencyIDs.length) {
        selector.currencyID = { $in: currencyIDs }
    }
    const result = await dailyHistoryDB.search(selector, limit, 0, false, {
        fields: [
            'currencyID',
            'ratioOfExchange',
        ]
    })
    callback(null, result)
}
handleCurrencyPricesByDate.validatorConf = {
    currencyIDs: {
        required: false,
        type: TYPES.array,
    },
    date: {
        maxLength: 10,
        minLength: 10,
        required: true,
        type: TYPES.date,
    },
}

/**
 * @name    handleCurrencyConvert
 * @summary handle currency conversion requests
 * 
 * @param   {String}    from        source currency ID
 * @param   {String}    to          target currency ID
 * @param   {Number}    amount      the amount to convert to @to currency
 * @param   {Function}  callback    arguments => 
 *                                  @err                string: error message if request failed
 *                                  @convertedAmount    number: converted amount
 */
export const handleCurrencyConvert = async (from, to, amount, callback) => {
    if (!isFn(callback)) return

    const [err, convertedAmount, rounded] = await convertTo(from, to, amount)
    callback(err, convertedAmount, rounded)
}

/**
 * @name    handleCurrencyList
 * @summary retrive an array of supported currencies
 *
 * @param   {String}    hash     client's version of the hash of sorted currencies list
 * @param   {Function}  callback args => 
 *                      @err            string: error message if request failed. Otherwise, null.
 *                      @currencies     array: list of currencies, unsorted
 */
export const handleCurrencyList = async (hash, callback) => {
    if (!isFn(callback)) return
    // whether or not client needs to update the list of tickers
    if (hash === currenciesHash) return callback(null, [])
    callback(null, await currenciesPromise)
}

// initialize
setTimeout(async () => {
    const db = await currencies.getDB()
    const dbH = await dailyHistoryDB.getDB()
    const indexes = [
        {
            index: { fields: ['currency'] },
            name: 'currency-index',
        },
        {
            index: { fields: ['name'] },
            name: 'name-index',
        },
        {
            index: { fields: ['ticker'] },
            name: 'ticker-index',
        },
        {
            index: { fields: ['type'] },
            name: 'type-index',
        },
    ]
    const indexes2 = [
        {
            index: { fields: [{ 'date': 'desc' }] },
            name: 'date-index',
        },
        {
            index: { fields: [{ 'ticker': 'desc' }] },
            name: 'ticker-index',
        },
    ]
    // create indexes. Ignore if already exists
    await PromisE.all(indexes.map(index => db.createIndex(index)))
    await PromisE.all(indexes2.map(index => dbH.createIndex(index)))
    autoUpdateHash()
})
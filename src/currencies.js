import CouchDBStorage from './utils/CouchDBStorage'
import { arrSort, generateHash, isFn } from './utils/utils'
import { setTexts } from './language'
import { TYPES, validate, validateObj } from './utils/validator'
import PromisE from './utils/PromisE'

const messages = {
    invalidRequest: 'Missing one or more of the required fields',
    notFound: 'Unsupported currency'
}
setTexts(messages)
let autoUpdate = true
const autoUpdateDelay = 60 * 60 * 1000
const currencies = new CouchDBStorage(null, 'currencies')
let currenciesHash // hash of sorted array of supported currencies
let currenciesPromise
const dailyHistoryDB = new CouchDBStorage(null, 'currencies_price_history_daily')

/**
 * @name    handleCurrencyConvert
 * @summary handle currency conversion requests
 * 
 * @param   {String}    from        source currency ID or ticker
 * @param   {String}    to          target currency ID or ticker
 * @param   {Number}    amount      the amount to convert to @to currency
 * @param   {String}    date        (optional)
 * 
 * @returns {Array}     [
 *                          @err                String: error message if any,
 *                          @convertedAmount    Number: converted amount without rounding
 *                          @rounded            String: converted amount rounded to appropriate decimal places
 *                      ]
 */
export const convertTo = async (from, to, amount, date) => {
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
handleCurrencyConvert.description = 'Currency conversion'
handleCurrencyConvert.eventName = 'currency-convert'

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
    if (currenciesPromise.rejected) await updateCache()
    callback(null, await currenciesPromise)
}
handleCurrencyList.description = 'Fetch/update list of currencies'
handleCurrencyList.eventName = 'currency-list'
handleCurrencyList.maintenanceMode = true // allow during maintenance mode
handleCurrencyList.params = [
    {
        description: 'Hash of the array of currencies sorted by `ticker`. Hash algorithm: "blake2", bit length: 256.',
        name: 'hash',
        required: false,
        type: TYPES.hash,
    },
    {
        name: 'callback',
        required: true,
        type: TYPES.function,
    },
]
handleCurrencyList.requireLogin = false
handleCurrencyList.result = {
    name: 'currencies',
    type: TYPES.array,
}


/**
 * @name    handleCurrencyPricesByDate
 * @summary retrieve currency closing price for a specific date
 * 
 * @param   {Date}      date 
 * @param   {Array}     currencyIds (optional) list of specific currency IDs. 
 *                                  If empty, will return all available prices for the date.
 * @param   {Function}  callback    args =>
 *                                      - err    string: error message if request failed
 *                                      - result array: list of prices
 * @example ```javascript
 * 
 * // Example @result:
 * [ {
 *      currencyID: 'A.stock', 
 *      date: '2020-01-01',
 *      ratioOfExchange: 100000000 
 * } ]
 * ```
 */
export const handleCurrencyPricesByDate = async (date, currencyIds, callback) => {
    if (!isFn(callback)) return

    const { validatorConf } = handleCurrencyPricesByDate
    const err = validateObj({ date, currencyIds }, validatorConf, true, true)
    if (err) return callback(err)

    const selector = { date }
    const limit = currencyIds.length || 99999
    if (currencyIds.length) {
        selector.currencyId = { $in: currencyIds }
    }
    const result = await PromisE.timeout(
        dailyHistoryDB.search(selector, limit, 0, false),
        10000, // times out after 10 seconds
    )

    callback(null, result)
}
handleCurrencyPricesByDate.description = 'Fetch list of prices for available currencies for a specific date.'
handleCurrencyPricesByDate.eventName = 'currency-prices-by-date'
handleCurrencyPricesByDate.params = [
    {
        maxLength: 10,
        minLength: 10,
        name: 'date',
        required: true,
        type: TYPES.date,
    },
    {
        name: 'currencyIds',
        required: false,
        type: TYPES.array,
        unique: true,
    },
    {
        name: 'callback',
        required: true,
        type: TYPES.function,
    },

]
handleCurrencyPricesByDate.result = {
    item: {
        description: 'Array item definition',
        _id: { type: TYPES.string },
        currencyId: { type: TYPES.string },
        date: { type: TYPES.date },
        marketCapUSD: { type: TYPES.number },
        ratioOfExchange: { type: TYPES.number },
        source: {
            description: 'Where or how the data has been retrieved.',
            type: TYPES.string,
        },
    },
    name: 'prices',
    type: TYPES.array,
}
handleCurrencyPricesByDate.validatorConf = {
    currencyIds: {
        required: false,
        type: TYPES.array,
        unique: true,
    },
    date: {
        maxLength: 10,
        minLength: 10,
        required: true,
        type: TYPES.date,
    },
}

export const setup = async () => {
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
            index: { fields: [{ date: 'desc' }] },
            name: 'date-index',
        },
        {
            index: { fields: [{ date: 'desc' }, { currencyId: 'desc' }] },
            name: 'date-currencyId-index',
        },
    ]

    // create indexes. Ignore if already exists
    await PromisE.all(indexes.map(index => db.createIndex(index)))
    await PromisE.all(indexes2.map(index => dbH.createIndex(index)))
    await updateCache()

    const startAutoUpdate = async () => {
        do {
            await PromisE.delay(autoUpdateDelay)
            await updateCache()
        } while (autoUpdate)
    }
    autoUpdate && startAutoUpdate()
}

/**
 * @name    autoUpdateHash
 * @summary auto update hash of currencies list
 */
export const updateCache = async () => {
    try {
        console.log(new Date(), 'Updating currencies cache')
        currenciesPromise = PromisE(getAll(null, false))
        currenciesHash = generateHash(
            arrSort(await currenciesPromise, 'ticker'),
            'blake2',
            256,
        )
    } catch (err) {
        console.error(new Date(), 'Failed to update currencies cache', err)
    }
}

export default {
    'currency-convert': handleCurrencyConvert,
    'currency-list': handleCurrencyList,
    [handleCurrencyPricesByDate.eventName]: handleCurrencyPricesByDate,
}
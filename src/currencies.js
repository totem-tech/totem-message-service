import CouchDBStorage from './utils/CouchDBStorage'
import { arrSort, generateHash, isFn } from './utils/utils'
import { setTexts } from './language'
import { TYPES, validateObj } from './utils/validator'
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
        currenciesHash = generateHash(arrSort(await currenciesPromise, 'ISO'))
        setTimeout(autoUpdateHash, autoRefreshDelay)
    } catch (err) {
        console.error(new Date(), 'Failed to update currencies cache', err)
    }
}

/**
 * @name    handleCurrencyConvert
 * @summary handle currency conversion requests
 * 
 * @param   {String}    from        source currency ticker (ISO string). Eg: USD
 * @param   {String}    to          target currency ticker (ISO string). Eg: EUR.
 * @param   {Number}    amount      the amount to convert to @to currency
 * 
 * @returns {Array}     [
 *                          @err                String: error message if any,
 *                          @convertedAmount    Number:
 *                          @rounded            String: converted amount rounded to appropriate decimal places
 *                      ]
 */
export const convertTo = async (from, to, amount) => {
    const err = validateObj({ amount, from, to }, convertTo.validationConf)
    if (err) return [err]

    const fromCurrency = await currencies.find({
        ISO: from.toUpperCase(),
    }, true, true, false)
    if (!fromCurrency) return [`${messages.notFound}: ${from}`]

    const toCurrency = from === to
        ? fromCurrency
        : await currencies.find({
            ISO: to.toUpperCase(),
        }, true, true, false)
    if (!toCurrency) return [`${messages.notFound}: ${to}`]

    const convertedAmount = from === to
        ? amount // conversion not required
        : (fromCurrency.ratioOfExchange / toCurrency.ratioOfExchange) * amount
    const rounded = convertedAmount.toFixed(parseFloat(toCurrency.decimals))

    return [null, convertedAmount, rounded]
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
 * @param   {String}    from        source currency ticker (ISO string). Eg: USD
 * @param   {String}    to          target currency ticker (ISO string). Eg: EUR.
 * @param   {Number}    amount      the amount to convert to @to currency
 * @param   {Function}  callback    arguments => 
 *                                  @err                string: error message if request failed
 *                                  @convertedAmount    number: converted amount
 */
export const handleCurrencyConvert = async (from, to, amount, callback) => {
    if (!isFn(callback)) return

    const [err, convertedAmount, rounded] = convertTo(from, to, amount)
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
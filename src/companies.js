import DataStorage from './utils/DataStorage'
import { isFn, isObj, hasValue, objClean, isStr } from './utils/utils'
import { addressToStr } from './utils/convert'
import { isCountryCode } from './countries'
import { setTexts } from './language'
import { getUserByClientId } from './users'

const companies = new DataStorage('companies.json', true) // disable caching
// Must-have properties
const requiredKeys = [
    'country',              // 2 letter country code
    'name',                 // name of the company
    'registrationNumber',   // company registration number for the above country
]
// Searchable properties
const validKeys = [
    ...requiredKeys,
    'addedBy',              // user who added the company
    'parentIdentity',       // parent company identity
]
// maximum number of items to return as search result
const RESULT_LIMIT = 100
const messages = setTexts({
    exists: 'Company already exists',
    identityAlreadyAssociated: 'Identity is already associated with a company',
    invalidKeys: 'Missing one or more of the following properties',
    invalidCountry: 'Invalid country code supplied',
    invalidIdentity: 'Invalid identity supplied',
    invalidQuery: 'Invalid query',
    loginRequired: 'You must be logged to to perform this action',
    notFound: 'Company not found',
    requiredSearchKeys: 'Please supply one or more of the following keys',
})

// Create company or get company by @identity
//
// Params:
// @identity    string: company identity/wallet address
// @company     object: if non-object supplied will return existing company, if available
// @callback    function: callback function
export function handleCompany(identity, company, callback) {
    if (!isFn(callback)) return
    const client = this
    const user = getUserByClientId(client.id)
    if (!user) return callback(messages.loginRequired)

    if (!addressToStr(identity)) return callback(messages.invalidIdentity) || console.log({ identity: addressToStr(identity) })
    if (!isObj(company)) {
        company = companies.get(identity)
        // ToDo: return company object on second parameter
        return callback(!company ? messages.notFound : null, company)
    }

    // Check if company with identity already exists
    if (!!companies.get(identity)) {
        return callback(messages.identityAlreadyAssociated)
    }

    const { country, name, registrationNumber } = company
    // make sure all the required keys are supplied
    if (requiredKeys.reduce((invalid, key) => invalid || !hasValue(company[key]), false)) {
        return callback(`${messages.invalidKeys}: ${requiredKeys.join()}`)
    }

    // validate country code
    if (!isCountryCode(country)) return callback(messages.invalidCountry)

    // check if company with combination of name, registration number and country already exists
    // PS: same company name can have different registration number in different countries
    if (companies.search({ name, registrationNumber, country }, true, true, true).size > 0) {
        return callback(messages.exists)
    }
    company.addedBy = user.id
    console.log('Company created: ', JSON.stringify(company))
    companies.set(identity, objClean(company, validKeys))
    callback()
}

// Find companies by key-value pair(s)
//
// Params:
// @query       string/object: query string or object with specific keys and respective values
//                  1. if string and is a valid SS58 encoded address a company is associted with it, will return a Map of single item.
//                  2. if string and not an address, will search by all searchable company properties
//                  3. if object, will only search for specific keys supplied. Key(s) must exist in the `validKeys` array.
// @matchExact  boolean: whether to fulltext search or partial search. Only applies to (2) & (3) above.
// @ignoreCase  boolean: only applies to (2) & (3) above 
// @callback    function: callback function.
export const handleCompanySearch = (query, matchExact, matchAll, ignoreCase, callback) => {
    if (!isFn(callback)) return
    let keyValues = {}
    if (isStr(query)) {
        // string supplied
        const company = companies.get(query)
        // query string is a valid address, return company if exists otherwise return error message
        if (company) return callback(null, new Map([[query, company]]))
        // convert string to object for search by all keys
        keyValues = validKeys.reduce((kv, key) => {
            kv[key] = query
            return kv
        }, {})
    } else {
        if (!isObj(query)) return callback(messages.invalidQuery)
        keyValues = objClean(query, validKeys)
        const hasValidkeys = Object.keys(keyValues).length > 0
        if (hasValidkeys) return callback(`${messages.requiredSearchKeys}: ${validKeys.join()}`)
    }
    callback(null, companies.search(keyValues, matchExact, matchAll, ignoreCase, RESULT_LIMIT))
}
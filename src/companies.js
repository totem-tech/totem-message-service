import CouchDBStorage from './CouchDBStorage'
import { mapJoin, isFn, isHash, isObj, hasValue, objClean } from './utils/utils'
import { addressToStr } from './utils/convert'
import { isCountryCode } from './countries'
import { setTexts } from './language'
import { getUserByClientId } from './users'

const companies = new CouchDBStorage(null, 'companies') // disable caching
// Must-have properties
const requiredKeys = [
    'countryCode',          // 2 letter country code
    'identity',
    'name',                 // name of the company
    'registrationNumber',   // company registration number for the above country
]
// Searchable properties
const validKeys = [
    ...requiredKeys,
    'addedBy',              // user who added the company
    'parentCompany',       // parent company identity
]
// maximum number of items to return as search result
const RESULT_LIMIT = 100
const messages = setTexts({
    exists: 'Company already exists',
    hashExists: 'Company hash already exists',
    identityAlreadyAssociated: 'Identity is already associated with a company',
    invalidKeys: 'Missing one or more of the following properties',
    invalidCountry: 'Invalid country code supplied',
    invalidHash: 'Invalid hash supplied',
    invalidIdentity: 'Invalid identity supplied',
    invalidQuery: 'Invalid query',
    loginRequired: 'You must be logged to to perform this action',
    notFound: 'Company not found',
    requiredSearchKeys: 'Please supply one or more of the following fields',
})

// Create company or get company by @hash
//
// Params:
// @hash        string: unique ID for company
// @company     object: if non-object supplied will return existing company, if available
// @callback    function: callback function
export async function handleCompany(hash, company, callback) {
    if (!isFn(callback)) return
    const client = this
    const user = await getUserByClientId(client.id)
    if (!user) return callback(messages.loginRequired)
    const isValidHash = isHash(hash)
    console.log({hash, isValidHash})
    if (!isValidHash) return callback(messages.invalidHash)

    if (!isObj(company)) {
        company = isValidHash && await companies.get(hash)
        const err = !company ? messages.notFound : null
        return callback(err, company)
    }
    if (await companies.get(hash)) return callback(messages.hashExists)

    const { countryCode, identity, name, registrationNumber } = company
    if (!addressToStr(identity)) return callback(messages.invalidIdentity)

    // Check if company with identity already exists
    if (!!(await companies.find({identity}, true, true, true))) 
        return callback(messages.identityAlreadyAssociated)

    // make sure all the required keys are supplied
    const invalid = requiredKeys.reduce((invalid, key) => invalid || !hasValue(company[key]), false)
    if (invalid) return callback(`${messages.invalidKeys}: ${requiredKeys.join(', ')}`)

    // validate country code
    if (!isCountryCode(countryCode)) return callback(messages.invalidCountry)

    // check if company with combination of name, registrationNumber and country code already exists
    const existing = await companies.find({ name, countryCode, registrationNumber }, true, true, true)
    if (existing) return callback(messages.exists)

    company.addedBy = user.id
    await companies.set(hash, objClean(company, validKeys))
    console.log('Company created: ', JSON.stringify(company))
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
export const handleCompanySearch = async (query, findIdentity = false, callback) => {
    if (!isFn(callback)) return
    if (isHash(query)) {
        // valid hash supplied
        const company =  await companies.get(query)
        const err = !company ? messages.notFound : null
        return callback(err, !err && new Map([[query, company]]))
    }

    // sequentialy search until one or more results found
    const searchSeq = async (selectors = [], combine) => {
        let result = new Map()
        for (let i = 0; i < selectors.length; i++) {
            if (result.size > 0 && !combine) return result
            const selector = selectors[i]
            result = mapJoin(result, await companies.search(selector, true, true, false, RESULT_LIMIT))
        }
        return result
    }

    // search by identity or parentIdentity
    if (addressToStr(query)) return callback(null, await searchSeq([
        { identity: query },
        // if no result found matching identity, search for parentIdentity
        !findIdentity && { parentIdentity: query },
    ].filter(Boolean), true))

    return callback(null, await searchSeq([
        { registrationNumber: query }, //{ $eq: query }
        { salesTaxCode:  query },
        { name: { $gte: query } },
    ]))
}
import CouchDBStorage from './utils/CouchDBStorage'
import {
    isAddress,
    isFn,
    isHash,
    isObj,
    hasValue,
    mapJoin,
    objClean,
} from './utils/utils'
import { addressToStr } from './utils/convert'
import { isCountryCode } from './countries'
import { setTexts } from './language'
import { TYPES } from './utils/validator'

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

    const [_, user] = this
    if (!user) return callback(messages.loginRequired)

    const isValidHash = isHash(hash)
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
    if (!!(await companies.find({ identity }, true, true, true)))
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
handleCompany.requireLogin = true

/**
 * @name    handleCompanySearch
 * @summary search companies. Maximum results 100 (see `RESULT_LIMIT`)
 * 
 * @param   {*} query 
 * @param   {*} searchParentIdentity 
 * @param   {*} callback 
 */
export async function handleCompanySearch(query, searchParentIdentity = false, callback) {
    if (!isFn(callback)) return
    if (isHash(query)) {
        // valid hash supplied
        const company = await companies.get(query)
        const err = !company
            ? messages.notFound
            : null
        return callback(
            err,
            !err && new Map([[query, company]]) || undefined
        )
    }

    const searchSeq = async (selectors = [], any) => {
        let result = new Map()
        for (let i = 0;i < selectors.length;i++) {
            if (result.size > 0 && !any) return result

            const selector = selectors[i]
            result = mapJoin(
                result,
                await companies.search(
                    selector,
                    RESULT_LIMIT
                )
            )
        }
        return result
    }

    // search by identity or parentIdentity
    if (isAddress(query)) return callback(
        null,
        await searchSeq(
            [
                { identity: query },
                // if no result found matching identity, search for parentIdentity
                searchParentIdentity && { parentIdentity: query },
            ].filter(Boolean),
            true
        )
    )

    return callback(
        null,
        await searchSeq([
            { registrationNumber: query }, //{ $eq: query }
            // { salesTaxCode: query },
            { name: { $gte: query } },
        ])
    )
}
handleCompanySearch.description = 'Search for companies by id, name, registration number, identity or parent identity'
handleCompanySearch.eventName = 'company-search'
handleCompanySearch.params = [
    {
        description: 'Fetch by specific company ID.',
        name: 'query',
        type: TYPES.hash,
        or: {
            description: 'Alternatively, search by (SS58 encoded Substrate) identity',
            type: TYPES.identity,
            or: {
                description: `Alternatively, search by company name or registration number. Result limit: ${RESULT_LIMIT}.`,
                required: true,
                type: TYPES.string,
            },
        },
    },
    {
        description: 'Indicates whether to search for parent identity as well as company identity. Only applicable when querying by identity.',
        defaultValue: false,
        name: 'searchParentIdentity',
        required: false,
        type: TYPES.boolean,
    },
    {
        name: 'callback',
        required: true,
        type: TYPES.function,
    }
]
handleCompanySearch.requireLogin = false
handleCompanySearch.result = {
    name: 'companies',
    type: 'map'
}

// setTimeout(async () => {
//     await companies.viewCreateMap(
//         'search',
//         'search',
//         `function (doc) {
//             doc.name && emit(doc.name.toLowerCase(), null)
//             doc.countryOfOrigin && emit(doc.countryOfOrigin.toLowerCase(), null)
//             doc.registrationNumber && emit(doc.registrationNumber, null)
//         }`
//     )
// })
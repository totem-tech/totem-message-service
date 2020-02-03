import DataStorage from './utils/DataStorage'
import { isFn, isObj, hasValue, objClean } from './utils/utils'
import { isCountryCode } from './countries'

const companies = new DataStorage('companies.json', true) // disable caching
// Must-have properties
const requiredKeys = ['country', 'name', 'registrationNumber', 'walletAddress']
// Searchable properties
const searchKeys = ['name', 'walletAddress', 'registrationNumber', 'country']
const messages = {
    exists: 'Company already exists',
    invalidKeys: 'Company must be a valid object and contain the following: ' + requiredKeys.join(),
    invalidCountry: 'Invalid country code supplied',
    notFound: 'Company not found',
    walletAlreadyAssociated: 'Wallet address is already associated with a company',
    requiredSearchKeys: 'Please supply one or more of the following keys: ' + searchKeys.join()
}

// Create company or get company by @walletAddress
//
// Params:
// @walletAddress string: company wallet address
// @company       object: if non-object supplied will return existing company, if available
// @callback      function: callback function
export const handleCompany = (walletAddress, company, callback) => {
    if (!isFn(callback)) return
    if (!isObj(company)) {
        company = companies.get(walletAddress)
        // ToDo: return company object on second parameter
        return callback(!company ? messages.notFound : null, company)
    }
    const { country, name, registrationNumber } = company

    // make sure all the required keys are supplied
    if (requiredKeys.reduce((invalid, key) => invalid || !hasValue(company[key]), !walletAddress)) {
        console.log({ walletAddress })
        console.log({ company })
        return callback(messages.invalidKeys)
    }

    if (!isCountryCode(country)) return callback(messages.invalidCountry)
    // Check if company with wallet address already exists
    if (!!companies.get(walletAddress)) {
        return callback(messages.walletAlreadyAssociated)
    }
    // check if company with combination of name, registration number and country already exists
    // PS: same company name can have different registration number in different countries
    if (companies.search({ name, registrationNumber, country }, true, true, true).size > 0) {
        return callback(messages.exists)
    }

    console.log('Company created: ', JSON.stringify(company))
    delete company.walletAddress;
    companies.set(walletAddress, company)
    callback()
}

// Find companies by key-value pair(s)
//
// Params:
// @keyValues object: key(s) and respective value(s) to search for
// @callback  function: callback function
export const handleCompanySearch = (keyValues, matchExact, matchAll, ignoreCase, callback) => {
    if (!isFn(callback)) return
    keyValues = objClean(keyValues, searchKeys)
    if (Object.keys(keyValues).length === 0) {
        return callback(messages.requiredSearchKeys)
    }
    callback(null, companies.search(keyValues, matchExact, matchAll, ignoreCase))
}
import CouchDBStorage from './utils/CouchDBStorage'
import fetch from 'node-fetch'
import { isFn, generateHash } from './utils/utils'

const countries = new CouchDBStorage(null, 'countries')
const source = 'https://restcountries.eu/rest/v2/all'
let countriesHash
// populate countries list from external source
setTimeout(async () => {
    const existing = await countries.getAll(null, true, 999)
    if (existing.size > 0) {
        countriesHash = generateHash(Array.from(existing))
        return
    }

    const countriesRes = await (await fetch(source)).json()
    if (countriesRes.length === 0) return

    // convert array into Map and strip all unnecessary data
    const countriesMap = countriesRes.reduce((map, c) => map.set(
        c.alpha2Code, // use 2 letter code as key
        {
            name: c.name,
            code: c.alpha2Code,     // 2 letter code
            code3: c.alpha3Code,    // 3 letter code
        }
    ), new Map())

    countriesHash = generateHash(Array.from(countriesMap))
    await countries.setAll(countriesMap)
})

// Get list of all countries
//
// Params:
// @hash        string: hash generated by the Map of existing countries to compare with the ones stored on the server
// @callback    function
export const handleCountries = async (hash, callback) => {
    if (!isFn(callback)) return
    if (countriesHash === hash) return callback()
    callback(null, await countries.getAll(null, true, 999))
}

export const isCountryCode = async (code) => !!(await countries.get(code))

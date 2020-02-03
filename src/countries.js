import fetch from 'node-fetch'
import DataStorage from './utils/DataStorage'
import { isFn } from './utils/utils'

const countries = new DataStorage('countries.json', true)
const source = 'https://restcountries.eu/rest/v2/all'
// populate countries list from external source
if (countries.getAll().size === 0) {
    fetch(source).then(r => r.json().then(json => json.length > 0 && countries.setAll(
        // convert array into Map and strip all unnecessary data
        json.reduce((map, { name, alpha2Code }) => map.set(alpha2Code, { name, code: alpha2Code }), new Map())
    )))
}

export const handleCountries = callback => isFn(callback) && callback(null, countries.getAll())

export const isCountryCode = code => !!countries.get(code)

import CouchDBStorage from './CouchDBStorage'
import fetch from 'node-fetch'
import { isFn } from './utils/utils'

const countries = new CouchDBStorage(null, 'countries')
const source = 'https://restcountries.eu/rest/v2/all'
// populate countries list from external source
setTimeout(async () => {
    const existing = await countries.getAll()
    if (existing.size > 0) return
    // console.log({ existing }, 'existing')
    const countriesRes = await (await fetch(source)).json()
    // console.log({ countriesRes }, 'countriesRes')
    if (countriesRes.length === 0) return
    // convert array into Map and strip all unnecessary data
    const countriesMap = countriesRes.reduce((map, c) => map.set(
        c.alpha2Code,
        {
            name: c.name,
            code: c.alpha2Code,
        }
    ), new Map())
    await countries.setAll(countriesMap)
})


export const handleCountries = async (callback) => isFn(callback) && callback(null, await countries.getAll())

export const isCountryCode = async (code) => !!(await countries.get(code))

import csv from 'csvtojson'
import uuid from 'uuid'
import { objClean, deferred, generateHash, textCapitalize, arrSort } from '../src/utils/utils'
import readline from 'readline'
import fs from 'fs'
import CouchDBStorage, { getConnection as getDBConnection } from '../src/CouchDBStorage'
import { keyring as kr } from '../src/utils/polkadotHelper'
import { getConnection } from '../src/blockchain'
import { handleCountries } from '../src/countries'
import DataStorage from '../../totem-ui/src/utils/DataStorage'

const url = process.env.CouchDB_URL
const dbConnection = getDBConnection(url)
const couchdb = new CouchDBStorage(dbConnection, process.env.DBName)
// const indexDB = new CouchDBStorage(dbConnection, 'company-indexes')
const filepath = process.env.filepath
const startingNumber = eval(process.env.startingNumber) || 0
let seed = process.env.seed || '//Alice'
seed = seed + (seed.endsWith('/') ? '' : '/')
const bulkSize = eval(process.env.CouchDB_BulkSize) || 5 // group items and send them in bulk
let pendingItems = new Map()
// let pendingIndexes = new Map()
const validKeys = [
    'name',
    'registrationNumber',
    'regAddress',
    'companyCategory',
    'companyStatus',
    'countryOfOrigin',
    'dissolutionDate',
    'incorporationDate',
    'accounts',
    'limitedPartnerships',
    'salesTaxCode',
    'countryCode',
    'identity',
    'parentIdentity',
].sort()
// override column names // ignore fields by setting to empty string
const columnNames = [
    'name', // companyName
    'registrationNumber',// companyNumber
    "regAddress.careOf",
    "regAddress.POBox",
    "regAddress.addressLine1",
    "regAddress.addressLine2",
    "regAddress.postTown",
    "regAddress.county",
    "regAddress.country",
    "regAddress.postCode",
    'companyCategory',
    'companyStatus',
    'countryOfOrigin',
    'dissolutionDate',
    'incorporationDate',
    'accounts.accountRefDay',
    'accounts.accountRefMonth',
    '', //'accounts.NextDueDate',
    '', //'accounts.LastMadeUpDate',
    '', //'accounts.AccountCategory',
    '', //'returns.NextDueDate',
    '', //'returns.LastMadeUpDate',
    '', //'mortgages.NumMortCharges',
    '', //'mortgages.NumMortOutstanding',
    '', //'mortgages.NumMortPartSatisfied',
    '', //'mortgages.NumMortSatisfied',
    '', //'SICCode.SicText_1',
    '', //'SICCode.SicText_2',
    '', //'SICCode.SicText_3',
    '', //'SICCode.SicText_4',
    'limitedPartnerships.numGenPartners',
    'limitedPartnerships.numLimPartners',
    // 'URI',
    // 'previousName_1.CONDATE',
    // 'previousName_1.CompanyName',
    // 'previousName_2.CONDATE',
    // 'previousName_2.CompanyName',
    // 'previousName_3.CONDATE',
    // 'previousName_3.CompanyName',
    // 'previousName_4.CONDATE',
    // 'previousName_4.CompanyName',
    // 'previousName_5.CONDATE',
    // 'previousName_5.CompanyName',
    // 'previousName_6.CONDATE',
    // 'previousName_6.CompanyName',
    // 'previousName_7.CONDATE',
    // 'previousName_7.CompanyName',
    // 'previousName_8.CONDATE',
    // 'previousName_8.CompanyName',
    // 'previousName_9.CONDATE',
    // 'previousName_9.CompanyName',
    // 'previousName_10.CONDATE',
    // 'previousName_10.CompanyName',
    // 'confStmtNextDueDate',
    // 'confStmtLastMadeUpDate'
]
const countryCodeExceptions = {
    'United Kingdom': 'GB',
    'Great Britain': 'GB',
    'UK': 'GB',
    'England And Wales': 'GB',
    'England & Wales': 'GB',
    'England': 'GB',
    'Channel Islands': 'GB',
    'Northern Ireland': 'GB',
    'Wales': 'GB',

    'West Germany': 'DE',
    'United States': 'US',
    'Virgin Islands': 'VI', // US Virgin Islands
    'Virgin Is-us': 'VI',
    'British Virgin Islands': 'VG',
    'Virgin Islands, British': 'VG',
    'Russia': 'RU',
    'Ussr': 'RU', // Union of Soviet Socialist Republics
    'South Korea': 'KR', // Korea (Republic of)
    'Iran': 'IR',
    'Tanzania': 'TZ',
    'Ivory Coast': 'CI',    // => Côte d'Ivoire????? 

    'Irish Rep': 'IE', // Ireland
    'Ireland Rep': 'IE',
    'Republic Of Ireland': 'IE',
    'Roi': 'IE', // ???? IRELAND???

    'Yugoslavia': 'YU',       //Macedonia (the former Yugoslav Republic of)
    'Holland': 'NL', // Netherland

    'Czechoslovakia': 'SK', // => Slovakia ??
    'Slovak Republic': 'SK',

    'Turks & Caicos Islands': 'TC',
    'St Kitts-nevis': 'KN',
    'St Lucia': 'LCA',
    'Venezuela': 'VE',
    'Belarus': 'BY',
    'Faroe Is': 'FO', // Faroe Islands
    'Vietnam': 'VN', // Viet Nam !!!
    'Moldova': 'MD',
    'Georgia': 'GE',
    'Angola': 'AO',
    'Bosnia Herzegovina': 'BA',
    'Turkey': 'TR',
    'Tadjikistan': 'TJ', //Tajikistan 
    'Kosovo': 'XK',
    'Serbia And Montenegro': 'RS',
    'Panama': 'PA',
    'Brunei': 'BN',
    'Republic Of Nigeria': 'NG',
    'South-west Africa': 'ZA', // South Africa
    'St Vincent': 'VC',
    'Yemen Arab Republic': 'YE',

    // No longer a country since 2010
    // separated into Curaçao (CW), Sint Maarten (SX) and combined Bonaire, Sint Eustatius & Saba (BQ)
    'Netherlands Antilles': 'NL', // Which one should be used???
}
const getCountryCode = (countryStorage, name) => {
    if (!name) return ''
    if (countryCodeExceptions[name]) return countryCodeExceptions[name]
    let country = countryStorage.find({ name }, true, false, true) //code: name, code3: name, 
    return country && country.code || ''
}
// save and clear pending items
const saveNClear = async (logtxt) => {
    console.log(logtxt)
    const tmp = pendingItems
    // const tmp2 = pendingIndexes
    pendingItems = new Map()
    // pendingIndexes = new Map()
    await couchdb.setAll(tmp, true)
    // await indexDB.setAll(tmp2, true)
}

// save remaining items not save by addToBulkQueue
const deferredSave = deferred(() => pendingItems.size > 0 && saveNClear(
    `${new Date().toISOString()} saving last ${pendingItems.size} items`
), 3000)

const addToBulkQueue = async (id, value, index) => {
    if (pendingItems.size >= bulkSize) {
        await saveNClear(`Saving items ${index - bulkSize} to ${index - 1}`)
    }
    pendingItems.set(id, value)
    // pendingIndexes.set(id, index)

    // last items or if total number of items is less than bulksize
    deferredSave()
}

(async function () {
    if (!filepath) throw new Error('filepath required')
    await couchdb.getDB() // create db if not exists
    // await indexDB.getDB() // create db if not exists
    console.log({ filepath, startingNumber })
    console.time('companies')
    // Connection is needed because of Polkadot's peculear behaviour.
    // Keyring "sometimes" works without creating a connection other time throws error!
    let countryStorage
    const { api, keyring } = await getConnection()
    api.disconnect()
    // const keyring = kr.keyring
    let count = startingNumber
    let firstLineIgnored = false
    let firstLine = columnNames.join()
    let stop = false
    const logTimeEnd = deferred(() => console.timeEnd('companies'), 5000)
    await handleCountries(null, (err, countries) => {
        if (err) throw err
        countryStorage = new DataStorage()
        countryStorage.setAll(countries)
        console.log(`${countries.size} countries retrieved`)
    })

    const readInterface = readline.createInterface({
        input: fs.createReadStream(filepath),
        // output: process.stdout,
        console: false
    })
    readInterface.on('line', async function (line) {
        if (!firstLineIgnored || stop) {
            firstLineIgnored = true
            return
        }
        const index = count++
        const iSeed = `${seed}totem/1/${index}`
        const str = `${firstLine}\n${line}`
        let company = objClean((await csv().fromString(str))[0], validKeys)
        const postCode = company.regAddress.postCode
        const countryOfOrigin = company.countryOfOrigin
        const registrationNumber = company.registrationNumber
        company = textCapitalize(company, true, true, true)
        company.countryCode = getCountryCode(countryStorage, company.countryOfOrigin.trim())
        company.countryOfOrigin = countryOfOrigin
        company.regAddress.postCode = postCode.toUpperCase()
        company.registrationNumber = registrationNumber
        const { address } = keyring.addFromUri(iSeed)
        company.identity = address

        const hash = generateHash({ ...company, index, uuid: uuid.v1() })
        console.log(JSON.stringify([index, { address, hash }]))
        try {
            await addToBulkQueue(hash, company, index) // save documents in bulk
        } catch (e) {
            stop = true
            throw e
        }
        logTimeEnd()
    })
})()
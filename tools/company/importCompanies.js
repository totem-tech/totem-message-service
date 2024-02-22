import csv from 'csvtojson'
import {
    objClean,
    generateHash,
    textCapitalize,
    isObj,
    isStr
} from '../../src/utils/utils'
import readline from 'readline'
import fs from 'fs'
import CouchDBStorage, { getConnection as getDBConnection } from '../../src/utils/CouchDBStorage'
import { handleCountries } from '../../src/countries'
import DataStorage from '../../src/utils/DataStorage'

const { cryptoWaitReady } = require('@polkadot/util-crypto')
const Keyring = require('@polkadot/keyring').default

let keyring
const url = process.env.CouchDB_URL
const dbConnection = getDBConnection(url)
const couchdb = new CouchDBStorage(dbConnection, process.env.DBName)
// const indexDB = new CouchDBStorage(dbConnection, 'company-indexes')
const filepath = process.env.filepath
const startingNumber = eval(process.env.startingNumber) || 0
const skip = eval(process.env.skip) || 0
let seed = process.env.seed
if (!seed) throw new Error('Missing environment variable: seed')
const bulkSize = eval(process.env.CouchDB_BulkSize) || 1000 // group items and send them in bulk
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
    "accounts.accountRefDay",
    "accounts.accountRefMonth",
    "companyCategory",
    "companyStatus",
    "countryOfOrigin",
    "dissolutionDate",
    "incorporationDate",
    "limitedPartnerships.numGenPartners",
    "limitedPartnerships.numLimPartners",
    "name",
    "regAddress.careOf",
    "regAddress.POBox",
    "regAddress.addressLine1",
    "regAddress.addressLine2",
    "regAddress.postTown",
    "regAddress.county",
    "regAddress.country",
    "regAddress.postCode",
    "registrationNumber"
]
// const columnNames = [
//     'name', // companyName
//     'registrationNumber',// companyNumber
//     "regAddress.careOf",
//     "regAddress.POBox",
//     "regAddress.addressLine1",
//     "regAddress.addressLine2",
//     "regAddress.postTown",
//     "regAddress.county",
//     "regAddress.country",
//     "regAddress.postCode",
//     'companyCategory',
//     'companyStatus',
//     'countryOfOrigin',
//     'dissolutionDate',
//     'incorporationDate',
//     'accounts.accountRefDay',
//     'accounts.accountRefMonth',
//     '', //'accounts.NextDueDate',
//     '', //'accounts.LastMadeUpDate',
//     '', //'accounts.AccountCategory',
//     '', //'returns.NextDueDate',
//     '', //'returns.LastMadeUpDate',
//     '', //'mortgages.NumMortCharges',
//     '', //'mortgages.NumMortOutstanding',
//     '', //'mortgages.NumMortPartSatisfied',
//     '', //'mortgages.NumMortSatisfied',
//     '', //'SICCode.SicText_1',
//     '', //'SICCode.SicText_2',
//     '', //'SICCode.SicText_3',
//     '', //'SICCode.SicText_4',
//     'limitedPartnerships.numGenPartners',
//     'limitedPartnerships.numLimPartners',
//     // 'URI',
//     // 'previousName_1.CONDATE',
//     // 'previousName_1.CompanyName',
//     // 'previousName_2.CONDATE',
//     // 'previousName_2.CompanyName',
//     // 'previousName_3.CONDATE',
//     // 'previousName_3.CompanyName',
//     // 'previousName_4.CONDATE',
//     // 'previousName_4.CompanyName',
//     // 'previousName_5.CONDATE',
//     // 'previousName_5.CompanyName',
//     // 'previousName_6.CONDATE',
//     // 'previousName_6.CompanyName',
//     // 'previousName_7.CONDATE',
//     // 'previousName_7.CompanyName',
//     // 'previousName_8.CONDATE',
//     // 'previousName_8.CompanyName',
//     // 'previousName_9.CONDATE',
//     // 'previousName_9.CompanyName',
//     // 'previousName_10.CONDATE',
//     // 'previousName_10.CompanyName',
//     // 'confStmtNextDueDate',
//     // 'confStmtLastMadeUpDate'
// ]
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

const getIdentity = async (serialNo) => {
    await cryptoWaitReady() // must wait before generating mnemonic
    const uri = `${seed}${seed.endsWith('/') ? '' : '/'}totem/1/${serialNo}`
    // Instantiate a new keyring to extract identity address and keyData/encoded hex for encryption
    const type = 'sr25519'
    keyring ??= new Keyring({ ss58Format: 42, type })
    const pair = await keyring.addFromUri(
        uri,
        undefined,
        type
    )
    return pair.address
}

const trim = input => {
    if (isStr(input)) return input.trim()
    if (!isObj(input, true)) return input

    return Object.keys(input)
        .sort()
        .reduce((obj, key) => ({
            ...obj,
            [key]: trim(input[key])
        }), {})
}
(async () => {
    await cryptoWaitReady() // must wait before generating mnemonic
    if (!filepath) throw new Error('filepath required')
    await couchdb.getDB() // create db if not exists
    // await indexDB.getDB() // create db if not exists
    console.log({ filepath, startingNumber })
    console.time('completed in')
    let countryStorage
    let count = startingNumber
    let firstLineIgnored = false
    let firstLine = columnNames.join()
    let stop = false
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
    const batchLimit = bulkSize
    let batch = new Map()
    let batchName
    const promises = []
    const save = async () => {
        const docs = [...batch.values()]
        if (!docs.length) return
        batch = new Map()
        console.log('Saving docs: ', docs.length)
        await promises.push(
            couchdb
                .getDB()
                .then(db => db.bulk({ docs }))
        )
    }
    readInterface.on('line', async function (line) {
        if (!firstLineIgnored || stop) {
            firstLineIgnored = true
            return
        }
        const index = count++
        if (skip > index) return

        const str = `${firstLine}\n${line}`
        let company = objClean(
            (await csv().fromString(str))[0],
            validKeys,
        )
        const postCode = company.regAddress.postCode
        const countryOfOrigin = company.countryOfOrigin
        const registrationNumber = company.registrationNumber
        company = textCapitalize(company, true, true)
        company.countryCode = getCountryCode(countryStorage, company.countryOfOrigin.trim())
        company.countryOfOrigin = countryOfOrigin
        company.regAddress.postCode = postCode.toUpperCase()
        company.registrationNumber = registrationNumber
        company.identity = await getIdentity(index)
        company = trim(company)
        company._id = generateHash(company.registrationNumber + company.countryCode) // entry ID
        console.log(JSON.stringify([index, {
            address: company.identity,
            hash: company._id,
        }]))
        const _index = index - startingNumber
        const batchTotal = _index % batchLimit + 1
        batch.set(company._id, company)
        if (batchTotal >= batchLimit) await save(batchName)
    })
    readInterface.on('close', () => {
        // untested.
        // this aims to solve the issue where last incomplete batch won't save
        save(batchName)
    })

    await save(batchName)

    await Promise.all(promises)
    console.timeEnd('completed in')
})()
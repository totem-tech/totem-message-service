import csv from 'csvtojson'
import { objClean, deferred } from '../src/utils/utils'
import readline from 'readline'
import fs from 'fs'
import CouchDBStorage from '../src/CouchDBStorage'
import { keyring } from '../src/utils/polkadotHelper'
import { getConnection } from '../src/blockchain'

const couchdb = new CouchDBStorage(process.env.CouchDB_URL, process.env.DBName)
const filepath = process.env.filepath
const startingNumber = eval(process.env.startingNumber) || 1
const seed = process.env.seed || '//Alice'
const bulkSize = eval(process.env.CouchDB_BulkSize) || 100 // group items and send them in bulk
let pendingItems = new Map()
const emptyKeys = [
    'salesTaxCode',
    'countryCode',
    'partnerAddress',
]
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
    'limitedPartnershipsNumGenPartners',
    'limitedPartnershipsNumLimPartners',
    'URI',
    ...emptyKeys
]
// override columnname
// '___' implies unused column and also replaced '.' to reduce processing time to generate an object
const columnNames = [
    'name', // companyName
    'registrationNumber',// companyNumber
    'regAddress.CareOf',
    'regAddress.POBox',
    'regAddress.AddressLine1',
    'regAddress.AddressLine2',
    'regAddress.PostTown',
    'regAddress.County',
    'regAddress.Country',
    'regAddress.PostCode',
    'companyCategory',
    'companyStatus',
    'countryOfOrigin',
    'dissolutionDate',
    'incorporationDate',
    'accounts.AccountRefDay',
    'accounts.AccountRefMonth',
    'accounts___NextDueDate',
    'accounts____LastMadeUpDate',
    'accounts____AccountCategory',
    'returns.NextDueDate',
    'returns.LastMadeUpDate',
    'mortgages___NumMortCharges',
    'mortgages___NumMortOutstanding',
    'mortgages___NumMortPartSatisfied',
    'mortgages__NumMortSatisfied',
    'SICCode___SicText_1',
    'SICCode___SicText_2',
    'SICCode___SicText_3',
    'SICCode___SicText_4',
    'limitedPartnerships.NumGenPartners',
    'limitedPartnerships.NumLimPartners',
    'URI',
    'previousName_1___CONDATE',
    'previousName_1___CompanyName',
    'previousName_2___CONDATE',
    'previousName_2___CompanyName',
    'previousName_3___CONDATE',
    'previousName_3___CompanyName',
    'previousName_4___CONDATE',
    'previousName_4___CompanyName',
    'previousName_5___CONDATE',
    'previousName_5___CompanyName',
    'previousName_6___CONDATE',
    'previousName_6___CompanyName',
    'previousName_7___CONDATE',
    'previousName_7___CompanyName',
    'previousName_8___CONDATE',
    'previousName_8___CompanyName',
    'previousName_9___CONDATE',
    'previousName_9___CompanyName',
    'previousName_10___CONDATE',
    'previousName_10___CompanyName',
    'confStmtNextDueDate',
    'confStmtLastMadeUpDate'
  ]
// save and clear pending items
const saveNClear = (logtxt) => {
	console.log(logtxt)
	couchdb.setAll(pendingItems, true)
	pendingItems = new Map()
}

// save remaining items not save by addToBulkQueue
const deferredSave = deferred(() => pendingItems.size > 0 && saveNClear('saving last items'), 1000)

const addToBulkQueue = (id, value, lineNum) => {
	if (pendingItems.size >= bulkSize) {
		saveNClear(`Saving items ${lineNum - bulkSize} to ${lineNum - 1}`)
	}
	pendingItems.set(id, value)

	// last items or if total number of items is less than bulksize
	deferredSave()
}


;(async function() {
	if (!filepath) throw new Error('filepath required')
	console.log({ filepath, seed })
	console.time('companies')
    let count = 0
    let firstLineIgnored = false
    let firstLine = columnNames.join()
    const logTimeEnd = deferred(()=> console.timeEnd('companies'), 3000)
    // Connection is needed because of Polkadot's peculear behaviour.
    // Keyring "sometimes" works without creating a connection other time throws error!
    const { keyring } = await getConnection()

    const readInterface = readline.createInterface({
        input: fs.createReadStream(filepath),
        // output: process.stdout,
        console: false
    })

    readInterface.on('line', async function(line) {
        if (!firstLineIgnored) {
            // firstLine = line.split(',').map(x => {
            //     x = x.trim().split('')
            //     x[0] = x[0].toLocaleLowerCase()
            //     return x.join('')
            // })
            // console.log({columnNames: firstLine})
            firstLineIgnored  = true
            return
        }
        const str = `${firstLine}\n${line}`
        const company = objClean((await csv().fromString(str))[0], validKeys)
        const seedX = `${seed}${seed.endsWith('/') ? '' : '/'}1/${startingNumber + count}`
        const {address} = keyring.addFromUri(seedX)
        count++
        addToBulkQueue(address, company, count) // save documents in bulk
        // couchdb.set(address, company) // save each document independantly
		console.log(count, address, JSON.stringify(company))
		logTimeEnd()
    })
})()

const cleanUpObj = (obj, keys) => Object.keys(obj).forEach(key => !keys.includes(key) && delete obj[key])
import csv from 'csvtojson'
import { setup } from '../../src/cdp/nacl'
import { setAccessCode } from '../../src/cdp/handleSetAccessCode'
import { arrUnique } from '../../src/utils/utils'
import { dbCdpAccessCodes, dbCompanies } from '../../src/cdp/couchdb'
import CouchDBStorage from '../../src/utils/CouchDBStorage'

export default async function importCDPAccessCodes(
    csvFilePath = process.env.CSV_FILE_PATH,
    ignoreIfExists = (process.env.IGNORE_IF_EXISTS || '').toLowerCase() === 'true',
    couchDBUrl = process.env.CouchDB_URL,
    cdpKeyData = process.env.CDP_KEY_DATA,
    createdByUsername = process.env.CDP_CREATED_BY_USERNAME || 'script',
    printPostCodes = (process.env.CDP_PRINT_POSTCODES || '') === 'true'
) {

    const csvEntries = await csv().fromFile(csvFilePath)
    if (printPostCodes) return console.log(JSON.stringify(csvEntries.map(x => x.regaddress_postcode), null, 4))

    if (!csvFilePath || !couchDBUrl || !cdpKeyData) throw new Error('Missing environment variable(s)')

    await setup()

    const regNums = arrUnique(
        csvEntries
            .map(x => x.companynumber.trim())
            .filter(Boolean)
    )
    if (regNums.length !== csvEntries.length) throw new Error('Number of unique company numbers do not match the number of entries in the CSV file. Possible duplicate entries or multiple companies are using save company/registration number.')

    const result = await Promise.all(
        regNums.map(regNum =>
            dbCompanies
                .find({ registrationNumber: regNum })
                .then(company => [regNum, company])
        )
    )
    const companies = new Map(
        result.filter(([_, company]) => !!company)
    )
    console.log('Companies retrived:', companies.size, '| CSV entries:', csvEntries.length)
    if (companies.size !== csvEntries.length) throw new Error('Number of companies do not match number of entries')

    const results = await Promise.all(
        csvEntries.map(entry => setAccessCode(
            entry.companynumber,
            entry.access_code,
            false, //save as batch
            createdByUsername,
            { batchNumber: entry.batchnumber }
        ))
    )
    const newEntries = results
        .map(([error, status, entry], i) => {
            if (error) throw new Error(error)
            if (status === 0 && !ignoreIfExists || !entry) throw new Error(
                `Access code already exists for company number ${csvEntries[i].companynumber}. To ignore existing entries use the following environment variable: "IGNORE_IF_EXISTS=true".`
            )
            if (!!csvEntries[i].access_code && status !== 2) throw new Error(
                `Invalid access code ${csvEntries[i].access_code} provided for company number ${csvEntries[i].companynumber} (CSV file line number: ${i + 2})`
            )
            return entry
        })

    console.log(`Saving ${newEntries.length} access code entries to database`)
    await dbCdpAccessCodes.setAll(newEntries)

    new CouchDBStorage(null, 'cdp_access_codes')
}

/*

companynumber,
companyname,
regaddress_careof,
regaddress_pobox,
regaddress_addressline1,
regaddress_addressline2,
regaddress_posttown,
regaddress_county,
regaddress_postcode,
batchnumber,
access_code

*/
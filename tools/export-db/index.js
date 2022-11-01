import CouchDBStorage from '../../src/utils/CouchDBStorage'
import DataStorage from '../../src/utils/DataStorage'
import { isObj, isStr } from '../../src/utils/utils'

/**
 * @name    execute 
 * 
 * @param   {String}        dbName      name of the database/collection
 * @param   {String}        filename    name of the JSON file to save the result as
 * @param   {Number}        limit       number of items to retrieve
 * @param   {Number}        skip        number of items to skip
 * @param   {String}        url         CouchDB connection URL
 * @param   {String|Object} selector    CouchDB mango query selector
 * 
 * @returns {DataStorage}
 */
export async function execute(dbName, filename, limit, skip, url, selector) {
    url = url || process.env.CouchDB_URL
    dbName = dbName || process.env.DBName
    filename = filename || process.env.FILENAME
    limit = limit || parseInt(process.env.LIMIT || 99999999)
    skip = skip || parseInt(process.env.SKIP || 0)
    if (!dbName) throw new Error('DBName required')
    if (!url) throw new Error('CouchDB_URL required')

    selector = selector || process.env.DB_SELECTOR
    if (isStr(selector) && !!selector) selector = JSON.parse(selector)
    if (!!selector && !isObj(selector)) throw new Error('Selector must be a valid object')

    const db = new CouchDBStorage(url, dbName)
    const result = !selector
        ? await db.getAll([], true, limit, skip)
        : await db.search(selector, limit, skip, true)
    const ts = new Date().toISOString()
    filename = filename || `${dbName}-${skip || 1}-${skip + result.size}-${ts}.json`
    filename = filename.replace(/\:/g, '-')

    const storage = new DataStorage(filename)
    storage.setAll(result)
    console.log(`${result.size} entries saved to ${filename}`)

    storage.couchDB = db
    return storage
}

export default execute()
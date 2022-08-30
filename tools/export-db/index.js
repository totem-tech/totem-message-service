import CouchDBStorage from '../../src/utils/CouchDBStorage'
import DataStorage from '../../src/utils/DataStorage'

/**
 * @name    execute 
 * 
 * @param   {*} dbName 
 * @param   {*} filename 
 * @param   {*} limit 
 * @param   {*} skip 
 * @param   {*} url 
 * 
 * @returns {DataStorage}
 */
export async function execute(dbName, filename, limit, skip, url) {
    url = url || process.env.CouchDB_URL
    dbName = dbName || process.env.DBName
    filename = filename || process.env.FILENAME
    limit = limit || parseInt(process.env.LIMIT || 99999999)
    skip = skip || parseInt(process.env.SKIP || 0)
    if (!dbName) throw new Error('DBName required')
    if (!url) throw new Error('CouchDB_URL required')

    const db = new CouchDBStorage(url, dbName)
    const result = await db.getAll([], true, limit, skip)
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
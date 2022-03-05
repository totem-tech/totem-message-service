import CouchDBStorage from '../../src/utils/CouchDBStorage'
import DataStorage from '../../src/utils/DataStorage'

async function exportDb() {
    const url = process.env.CouchDB_URL
    const dbName = process.env.DBName
    let filename = process.env.FILENAME
    const limit = parseInt(process.env.LIMIT || 99999999)
    const skip = parseInt(process.env.SKIP || 0)
    if (!dbName) throw new Error('COLLECTION_NAME required')
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

export default exportDb()
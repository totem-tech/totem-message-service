import CouchDBStorage from '../../src/utils/CouchDBStorage'
import DataStorage from '../../src/utils/DataStorage'

async function init() {
    const url = process.env.CouchDB_URL
    const dbName = process.env.DBName
    const fileName = process.env.FILENAME
    const limit = parseInt(process.env.LIMIT || 99999999)
    const skip = parseInt(process.env.SKIP || 0)
    if (!dbName) throw new Error('COLLECTION_NAME required')
    if (!url) throw new Error('CouchDB_URL required')

    const db = new CouchDBStorage(url, dbName)
    const result = await db.getAll([], true, limit, skip)
    fileName = fileName || `${dbName}-${skip || 1}-${skip + result.size}-${new Date().toISOString()}.json`
    const json = new DataStorage(fileName)
    await json.setAll(result)
    console.log(`${result.size} entries saved to ${fileName}`)
}

init()
import { updateCache } from './currencies'
import { setup as setupLang } from './language'
import CouchDBStorage, { getConnection } from './utils/CouchDBStorage'
import DataStorage from './utils/DataStorage'
import { isArr, toArray } from './utils/utils'

// Import data from JSON file storage to CouchDB.
// Existing entries will be ignored and will remain in the JSON file.
// Successfully stored entries will be removed from JSON file.
export async function importToDB(fileNames) {
    const filesAr = toArray(fileNames)
        // only include json file names
        .filter(x => x.endsWith('.json'))
        .map(x => x.trim())
        .filter(Boolean)
    // list of files:databases where value is an array rather than an object
    const arrKeys = {
        'faucet-requests': 'requests', // store the value array under the property called 'requests'
        'translations': 'texts', // store the value array under the property called 'texts'
    }
    // databases where update of document update is allowed
    const allowUpdates = [
        'translations', // for easier access to updating translated texts
    ]

    // nothing to migrate 
    if (filesAr.length === 0) return

    console.log('Importing JSON files:', filesAr)
    for (let i = 0;i < filesAr.length;i++) {
        const file = filesAr[i]
        const dbName = (file.split('.json')[0])
        if (!dbName) continue
        const jsonStorage = new DataStorage(file, true)
        const data = jsonStorage.getAll()
        const total = data.size
        if (total === 0) {
            console.log('\nIgnoring empty file:', file)
            continue
        }

        console.log(`\nMigrating ${file}: ${data.size} entries`)
        const db = new CouchDBStorage(
            await getConnection(),
            dbName.replace(' ', '_'),
        )

        // wrap array value in an object as required by couchdb
        if (!!arrKeys[dbName]) Array.from(data)
            .forEach(([id, arr]) => {
                if (!isArr(arr)) return
                const value = {}
                value[arrKeys[dbName] || 'array'] = arr
                data.set(id, value)
            })

        // database specific modifications before submission
        switch (dbName) {
            case 'currencies':
                // convert ratioOfExchange and decimals to integer
                Array.from(data)
                    .forEach(([_, value]) => {
                        // keys to force parse into integer
                        [
                            'ratioOfExchange',
                            'decimals',
                            'sequence',
                        ].forEach(key =>
                            value[key] = parseInt(value[key])
                        )
                        // value.ratioOfExchange = parseInt(value.ratioOfExchange)
                        // value.decimals = parseInt(value.decimals)
                        // value.sequence = parseInt(value.sequence)
                    })
                break
        }

        // IDs of successful inserts
        const okIds = []
        // insert data into database
        const limit = 999
        const numBatches = data.size / limit
        for (let i = 0;i < numBatches;i++) {
            const start = i * limit
            const end = start + limit
            if (numBatches > 1) console.log(`\n${file}: Processing ${start + 1} to ${end} out of ${data.size} entries`)
            const result = await db.setAll(
                new Map(
                    Array.from(data)
                        .slice(start, end)

                ),
                !allowUpdates.includes(dbName),
            )
            okIds.push(
                ...result
                    .map(({ error, reason, ok, id }) => {
                        if (error) console.log(id, { error, reason, doc: data.get(id) })
                        return ok && id
                    })
                    .filter(Boolean)
            )
        }

        // database specifc post-save actions 
        switch (dbName) {
            case 'currencies':
                // regenerate currencies cache
                updateCache()
                break
            case 'translations':
                // re-generate hashes of translated texts for each language
                okIds.length && setupLang()
                break
        }

        // remove saved entries from the JSON file
        okIds.forEach(id => data.delete(id))
        // update JSON file to remove imported entries
        jsonStorage.setAll(data)
        console.log(`${file} => saved: ${okIds.length}. Failed or ignored existing: ${total - okIds.length}`)
    }
}
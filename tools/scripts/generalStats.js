import DataStorage from '../../src/utils/DataStorage'
import { isValidNumber } from '../../src/utils/utils'

const filename = process.env.FILENAME
// const keysCount = (process.env.KEYS_COUNT || '')
//     .split(',')
//     .filter(Boolean)
const keysCountUnique = (process.env.KEYS_COUNT || 'address,recipient,userId')
    .split(',')
    .filter(Boolean)
const keysCountOccurance = (process.env.KEYS_COUNT_OCCURANCE || 'status,type')
    .split(',')
    .filter(Boolean)
const keysSum = (process.env.KYES_SUM || '')
    .split(',')
    .filter(Boolean)
const CouchDB_URL = process.env.CouchDB_URL
const DBName = process.env.DBName

const statusStats = async (storage) => {
    if (!storage) {
        storage = CouchDB_URL && DBName
            ? await require('./exportdb').default
            : new DataStorage(filename)
    }
    if (!storage.name) throw new Error('FILENAME required')

    const stats = {
        total: storage.getAll().size,
    }
    storage
        .toArray()
        .forEach(([key, value]) => {
            keysCountOccurance.forEach(key => {
                const iValue = value[key]
                stats[key] = stats[key] || {}
                stats[key][iValue] = (stats[key][iValue] || 0) + 1

                const keySwap = {
                    status: 'type',
                    type: 'status',
                }
                iValue && Object.keys(keySwap)
                    .filter(k => k === key)
                    .forEach(xKey => {
                        const xValue = value[keySwap[xKey]]
                        const subKey = iValue + '__' + keySwap[xKey]
                        stats[key][subKey] = stats[key][subKey] || {}
                        const obj = stats[key][subKey]
                        obj[xValue] = (obj[xValue] || 0) + 1
                    })
            })
            // keysCount.forEach(key => {
            //     const iValue = value[key]
            //     if (iValue === undefined) return

            //     stats[key] = (stats[key] || 0) + 1
            // })

            keysCountUnique.forEach(key => {
                const iValue = value[key]
                if (iValue === undefined) return

                stats[key] = stats[key] || new Map()
                const map = stats[key]
                try {
                    map.set(value[key], true)
                } catch (err) {
                    console.log({ map, stats })
                    throw err
                }
            })

            keysSum.forEach(key => {
                const iValue = value[key]
                if (!isValidNumber(iValue)) return console.log({ iValue })

                const iKey = `${key}__sum`
                stats[iKey] = (stats[iKey] || 0) + iValue
            })
        })
    keysCountUnique.forEach(key =>
        stats[key] = new Map(stats[key]).size
    )
    console.log('generalStats', stats)

    return storage
}
export default statusStats
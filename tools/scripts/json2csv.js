import fs from 'fs'
import { Parser, transforms } from 'json2csv'
import DataStorage from '../../src/utils/DataStorage'
import { isArr2D, isFn } from '../../src/utils/utils'

async function execute(storage) {
    const pathSource = process.env.FILENAME
    const pathOptions = process.env.FILEPATH_CSV_OPTIONS
    const pathOutput = process.env.FILEPATH_CSV_OUTPUT
    const excludeID = (process.env.EXCLUDE_ID || '').toUpperCase() === 'TRUE'
    if (!storage && !pathSource) throw new Error('Missing env: FILENAME')
    if (!pathOutput) throw new Error('Missing env: FILEPATH_OUTPUT')

    let data = storage
        ? storage.toArray()
        : pathSource.includes('/')
            ? JSON.parse(fs.readFileSync(pathSource))
            : new DataStorage(pathSource)
                .toArray()
    if (isArr2D(data)) {
        // convert DataStorage entries to regular array of objects
        data = data.map(([_id, doc]) =>
            excludeID
                ? doc :
                { ...doc, _id }
        )
    }
    const options = !!pathOptions
        ? JSON.parse(fs.readFileSync(pathOptions))
        : {
            transforms: {
                flatten: {
                    arrays: true,
                    objects: true,
                    separator: '.',
                },
            }
        }

    console.log('options:', options)
    options.transforms = Object.keys(options.transforms)
        .filter(key => isFn(transforms[key]))
        .map(key => transforms[key]({ ...options.transforms[key] }))

    const parser = new Parser(options || {})

    fs.writeFileSync(pathOutput, parser.parse(data))
}

export default execute
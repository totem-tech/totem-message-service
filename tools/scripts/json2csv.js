import fs from 'fs'
import { Parser } from 'json2csv'
import DataStorage from '../../src/utils/DataStorage'
import { isArr2D } from '../../src/utils/utils'

async function execute(storage) {
    const pathSource = process.env.FILENAME
    const pathOptions = process.env.FILEPATH_CSV_OPTIONS
    const pathOutput = process.env.FILEPATH_CSV_OUTPUT
    if (!storage && !pathSource) throw new Error('Missing env: FILEPATH_SOURCE')
    if (!pathOutput) throw new Error('Missing env: FILEPATH_OUTPUT')

    let data = storage
        ? storage.toArray()
        : pathSource.includes('/')
            ? JSON.parse(fs.readFileSync(pathOptions))
            : new DataStorage(pathSource)
                .toArray()
    if (isArr2D(data)) {
        // convert DataStorage entries to regular array of objects
        data = data.map(([_id, doc]) => ({ ...doc, _id }))
    }
    const options = !!pathOptions
        ? JSON.parse(fs.readFileSync(pathOptions))
        : null

    options && console.log({ options })

    const parser = new Parser(options || {})

    fs.writeFileSync(pathOutput, parser.parse(data))
}

export default execute
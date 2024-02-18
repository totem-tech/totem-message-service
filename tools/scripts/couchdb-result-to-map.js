import DataStorage from '../../src/utils/DataStorage'

export async function couchdbResultToMap(
    inputPath = process.env.INPUT_PATH,
    outputFilename = process.env.FILENAME,
    options = {
        flags: process.env.OPTIONS_FLAGS || 'r',
        encoding: process.env.OPTIONS_ENCODING || 'utf-8',
        maxBytesToRead: parseInt(process.env.OPTIONS_MAX_BYTES) || 5368709120 // 5gb
    },
    forEach,
) {
    console.time('parse:' + inputPath)
    const map = await parseJsonFile(inputPath, options, forEach)
    console.timeEnd('parse:' + inputPath)
    return new DataStorage(outputFilename).setAll(map, true)
}

const parseJsonFile = (inputPath, options, forEach) => new Promise((resolve, reject) => {
    const fs = require('fs')
    const JSONStream = require('JSONStream')
    const stream = fs.createReadStream(inputPath, options)
    const map = new Map()
    const parser = JSONStream.parse('rows.*.doc')
    stream.pipe(parser)
    parser
        .on('error', err => reject(new Error(err)))
        .on(
            'data',
            entry => {
                if (!entry._id || entry._id.startsWith('_design/')) return

                map.set(entry._id, entry)
                forEach?.(entry, map)
            }
        )
        .on('end', () => resolve(map))
})

export default couchdbResultToMap
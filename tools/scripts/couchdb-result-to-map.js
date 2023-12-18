import DataStorage from '../../src/utils/DataStorage'

export async function execute(
    inputPath = process.env.INPUT_PATH,
    outputFilename = process.env.FILENAME,
    options = {
        flags: 'r',
        encoding: 'utf-8',
        maxBytesToRead: 5368709120 // 5gb
    }
) {
    console.time('parse:' + inputPath)
    const map = await parseJsonFile(inputPath, options)
    console.timeEnd('parse:' + inputPath)
    return new DataStorage(outputFilename).setAll(map, true)
}

const parseJsonFile = (inputPath, options) => new Promise((resolve, reject) => {
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
            entry => entry._id
                && !entry._id.startsWith('_design/')
                && map.set(entry._id, entry)
        )
        .on('end', () => resolve(map))
})

export default execute
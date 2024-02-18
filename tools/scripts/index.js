import DataStorage from '../../src/utils/DataStorage'
import { isFn } from '../../src/utils/utils'

const paths = (process.env.SCRIPT || '')
    .split(',')
    .map(x => x.replace('.js', ''))
console.log('Script paths:', paths)

const execute = async () => {
    let lastResult
    for (let i = 0;i < paths.length;i++) {
        const pathPrefix = paths[i].slice(0, 3).includes('./')
            ? ''
            : './' // assume current directory
        const path = `${pathPrefix}${paths[i]}`
        console.log('Running script: ', path)
        const timerKey = path + ' execution completed in'
        console.time(timerKey)
        const imported = await require(path).default
        lastResult = isFn(imported)
            ? await imported(lastResult)
            : imported
        console.timeEnd(timerKey)
    }

    process.exit(0)
}

execute()
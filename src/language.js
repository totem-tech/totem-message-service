import CouchDBStorage from './utils/CouchDBStorage'
import {
    clearClutter,
    generateHash,
    isStr,
    isFn
} from './utils/utils'
import { TYPES } from './utils/validator'

const translations = new CouchDBStorage(null, 'translations')
let hashes
const buildMode = process.env.BuildMode === 'TRUE'
const build = { enList: [] }
const messages = {
    invalidLang: 'Invalid/unsupported language code'
}
setTexts(messages)

export const handleErrorMessages = callback => callback(null, build.enList)
// only availabe during build mode
handleErrorMessages.buildMode = true
handleErrorMessages.description = 'Get a list of error messages (in English) used throughout the backend.'
handleErrorMessages.eventName = 'language-error-messages'
handleErrorMessages.params = [{
    name: 'callback',
    required: true,
    type: TYPES.function,
}]
handleErrorMessages.result = {
    name: 'texts',
    type: TYPES.array,
}

/**
 * @name    handleTranslations
 * @summary check and update client's translated texts
 * 
 * @param   {String}    langCode    2 letter language code
 * @param   {String}    clientHash  (optional) hash of client's existing translated texts' array to compare whether update is required.
 * @param   {Function}  callback    arguments =>
 *              @error  string/null: error message, if any. Null indicates no error.
 *              @list   array/null: list of translated texts. Null indicates no update required.
 */
export async function handleTranslations(langCode, clientHash, callback) {
    if (!isFn(callback)) return

    if (!isStr(langCode)) return callback(messages.invalidLang)

    // make sure language hashes are setup
    await setup()
    // client already has the latest version of translations. return empty null to indicate no update required
    const serverHash = hashes.get(langCode)
    if (clientHash && serverHash === clientHash) return callback(null, null)

    const { texts } = (await translations.get(langCode.toUpperCase())) || {}
    if (!texts) return callback(messages.invalidLang)

    callback(null, texts)
}
handleTranslations.description = 'Fetch/update list of translated texts by language code.'
handleTranslations.eventName = 'language-translations'
handleTranslations.maintenanceMode = true
handleTranslations.params = [
    {
        // accept: [...], // to be set in the setup() function
        name: 'langCode',
        required: true,
        type: TYPES.string,
    },
    {
        description: 'Hash of the list of existing texts for the requrested language. Hash algorithm: "blake2", bit length: 256',
        name: 'clientHash',
        required: false,
        type: TYPES.hash
    },
]
handleTranslations.result = {
    description: 'List of texts in the requested language. If langCode is provided and no update is required result will be `null`.',
    name: 'texts',
    type: TYPES.array,
}

export function setTexts(texts = {}) {
    // attempt to build a single list of english texts for translation

    build.enList = build.enList || []
    Object.keys(texts)
        .forEach(key => {
            const text = clearClutter(texts[key])
            texts[key] = text

            if (!buildMode) return
            build.enList.indexOf(text) === -1 && build.enList.push(text)
        })
    build.enList = build.enList.sort()
    return texts
}

// store a hash of all texts for each language
// the hash will be used to determine whether client already has the latest version of translation
export const setup = async () => {
    if (hashes) return
    const codes = []
    hashes = new Map(
        Array
            .from(await translations.getAll())
            .map(([code, { texts }]) => {
                codes.push(code)
                return [
                    code,
                    generateHash(
                        texts,
                        'blake2',
                        256
                    )
                ]
            })
    )
    // set available list of currencies
    handleTranslations.params[0].accept = codes
}

// event handlers
export default {
    [handleErrorMessages.eventName]: handleErrorMessages,
    [handleTranslations.eventName]: handleTranslations,
}
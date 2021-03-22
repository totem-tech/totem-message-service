import CouchDBStorage from './utils/CouchDBStorage'
import { clearClutter, generateHash, isStr, isFn } from './utils/utils'

const translations = new CouchDBStorage(null, 'translations')
let hashes = new Map()
const buildMode = process.env.BuildMode === 'TRUE'
const build = { enList: [] }
const messages = setTexts({
    invalidLang: 'Invalid/unsupported language code'
})
// store a hash of all texts for each language
// the hash will be used to determine whether client already has the latest version of translation
export const setup = async () => {
    hashes = new Map(
        Array.from(await translations.getAll())
            .map(([code, { texts }]) => [
                code,
                generateHash(texts)
            ])
    )
}

export const handleLanguageErrorMessages = callback => isFn(callback) && callback(null, build.enList)

// handleTranslations handles translated text requests
//
// Params: 
// @langCode    string: 2 digit language code
// @hash        string: (optional) hash of client's existing translated texts' array to compare whether update is required.
// @callback    function: arguments =>
//              @error  string/null: error message, if any. Null indicates no error.
//              @list   array/null: list of translated texts. Null indicates no update required.
export async function handleLanguageTranslations(langCode, textsHash, callback) {
    if (!isFn(callback)) return

    if (!isStr(langCode)) return callback(messages.invalidLang)

    const { texts } = (await translations.get(langCode.toUpperCase())) || {}
    if (!texts) return callback(messages.invalidLang)

    // client hash the latest version of translations. return empty null to indicate no update required
    const serverHash = hashes.get(langCode)
    if (textsHash && serverHash === textsHash) return callback(null, null)

    callback(null, texts)
}

export function setTexts(texts = {}) {
    // attempt to build a single list of english texts for translation
    if (!buildMode) return texts

    build.enList = build.enList || []
    Object.values(texts).forEach(text => {
        text = clearClutter(text)
        build.enList.indexOf(text) === -1 && build.enList.push(text)
    })
    build.enList = build.enList.sort()
    return texts
}

setTimeout(setup)
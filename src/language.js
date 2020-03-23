import CouchDBStorage from './CouchDBStorage'
import { clearClutter, generateHash, isStr, isFn } from './utils/utils'

const translations = new CouchDBStorage(null, 'translations')
const hashes = new Map()
const buildMode = process.env.BuildMode === 'TRUE'
const build = { enList: [] }
const texts = setTexts({
    invalidLang: 'Invalid/unsupported language code'
})
// store a hash of all texts for each language
// the hash will be used to determine whether client already has the latest version of translation
setTimeout(async () => Array.from(await translations.getAll()).forEach(([langCode, texts = []]) => {
    hashes.set(langCode, generateHash(texts))
}))

export const handleErrorMessages = callback => isFn(callback) && callback(null, build.enList)

// handleTranslations handles translated text requests
//
// Params: 
// @langCode    string: 2 digit language code
// @hash        string: (optional) hash of client's existing translated texts' array to compare whether update is required.
// @callback    function: arguments =>
//              @error  string/null: error message, if any. Null indicates no error.
//              @list   array/null: list of translated texts. Null indicates no update required.
export async function handleTranslations(langCode, hash, callback) {
    if (!isFn(callback)) return

    if (!isStr(langCode)) return callback(texts.invalidLang)
    const { texts: translatedTexts } = (await translations.get(langCode.toUpperCase())) || {}
    if (!translatedTexts) return callback(texts.invalidLang)
    // client hash the latest version of translations. return empty null to indicate no update required
    if (hash && hashes.get(langCode) === hash) return callback(null, null)
    callback(null, translatedTexts)
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
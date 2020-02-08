import DataStorage from './utils/DataStorage'
import { generateHash, isStr, isFn } from './utils/utils'

const translations = new DataStorage('translations.json', true)
const hashes = new Map()
const texts = {
    invalidLang: 'Invalid/unsupported language code'
}
// store a hash of all texts for each language
// the hash will be used to determine whether client already has the latest version of translation
Array.from(translations.getAll()).forEach(([langCode, texts]) => {
    hashes.set(langCode, generateHash(texts))
})

// handleTranslations handles translated text requests
//
// Params: 
// @langCode    string: 2 digit language code
// @hash        string: (optional) hash of client's existing translated texts' array to compare whether update is required.
// @callback    function: arguments =>
//              @error  string/null: error message, if any. Null indicates no error.
//              @list   array/null: list of translated texts. Null indicates no update required.
export const handleTranslations = (langCode, hash, callback) => {
    if (!isFn(callback)) return
    if (!isStr(langCode)) return callback(texts.invalidLang)
    const translated = translations.get(langCode.toUpperCase())
    if (!translated) return callback(texts.invalidLang)
    // client hash the latest version of translations. return empty null to indicate no update required
    if (hash && hashes.get(langCode) === hash) return callback(null, null)

    // return the latest version of translated texts in an array
    callback(null, translated)
}
/*
 * Encrypt data in JSON file (importable to CouchDB using CouchDBStorage).
 * The JSON file must be a 2D Array representation of a Map object (as used in utils/DataStorage.js).
 * 
 * Example content of a JSON file data format (spacing and new lines aren't required):
 * 
 * ```JSON
 * [
 *     ['key1', 'value1'] 
 * ]
 * ```
 * Or,
 * ```JSON
 * [
 *     ['key1', { a: 1, b: 2 }] 
 * ]
 * ```
 * // value can be any primitive types or an object with primitive types as property value.
 * // NB: All values (or propery values) will be converted to string before encryption.
 *        Therefore, decrypted output will also be a string.
 *        Eg: encrypting `true` will result in out of a string `"true"` on decryption.
 */
import DataStorage from '../../src/utils/DataStorage'
import { isObj } from '../../src/utils/utils'
import { encrypt, encryptionKeypair, newNonce, secretBoxEncrypt } from '../../src/utils/naclHelper'
import { TYPES, validateObj } from '../../src/utils/validator'

/*
 * ENVIRONMENT VARIABLES
 */
// @STORAGE_PATH string: path to JSON file's parent directory
// Used by DataStorage for reading input and writing ouput JSON files. 
// Default: `./server/data`
const _SP = process.env.STORAGE_PATH

// @FILE_NAME string: name of the JSON file in the `STORAGE_PATH` directory
const FILE_NAME = process.env.FILE_NAME

// @FILE_NAME_OUTPUT string: (optional)
// If falsy, output file name will be `${FILE_NAME}_encrypted`
// If the same name used, will override input file.
const FILE_NAME_OUTPUT = process.env.FILE_NAME_OUTPUT || `${FILE_NAME.replace('.json', '')}_encrypted.json`

// @NONCE string (hex): (optional) used for TweetNacl Box Encryption. 
// Required if value is not an object. In that case, nonce will not be stored in the output file. (Keep it safe)
// If falsy, will generate new nonce for each value and will be stored along with the output as `@NONCE_KEY` property.
const NONCE = process.env.NONCE

// @NONCE_KEY string: (optional) name of the property to store the nonce.
const NONCE_KEY = process.env.NONCE_KEY || 'nonce'

const FILE_OVERRIDE = process.env.FILE_OVERRIDE === 'YES'

// @PROPERTY_NAMES string: (optional) comma separated string.
// Defines which properties to encrypt (if value is an object).
// If falsy, will encrypt all properties.
const PROPERTY_NAMES = (process.env.PROPERTY_NAMES || '')
    .split(',')
    .filter(Boolean)

// @RECIPIENT_PUBLIC_KEY string (hex): (optional) required if Box encryption
// This also indicates whether to use Box (truthy) or Secretbox (falsy) encryption.
const RECIPIENT_PUBLIC_KEY = process.env.RECIPIENT_PUBLIC_KEY

// @SECRET string (hex): used to encrypt data
// This can be one of the following (all in hex):
// 1. secret key
// 2. keyData (from oo7 library's secretStore), 
// 3. encoded (from PolkadotJS keyring)
const SECRET = process.env.SECRET
const isBox = !!RECIPIENT_PUBLIC_KEY
const SECRET_VALID_LENGTHS = [
    66,  // secretKey with `0x`
    192, // keyData without `0x`
    194, // keyData with `0x`
    236, // encoded with `0x`
]
// Validate environment variables
const err = validateObj(
    {
        FILE_NAME,
        NONCE,
        SECRET,
        RECIPIENT_PUBLIC_KEY,
    },
    {
        FILE_NAME: {
            required: true,
            type: TYPES.string,
        },
        NONCE: {
            required: false,
            type: TYPES.hex,
        },
        RECIPIENT_PUBLIC_KEY: {
            required: isBox,
            type: TYPES.hex,
        },
        SECRET: {
            minLength: !isBox
                ? 66        // for secretKey with `0x`
                : 192,      // for keyData hex with or without `0x`
            maxLength: 236, // for encoded hex with `0x`,
            required: true,
            type: TYPES.hex,
        },
    },
    false, 
    false,
)
if (err) {
    console.error('Environment variable validation failed!\n', err)
    process.exit(1)
}
// make sure secret has one of the acceptable lengths
if (!SECRET_VALID_LENGTHS.includes(SECRET.length)) throw new Error('Invalid SECRET!')
// data to encrypt
const data = new DataStorage(FILE_NAME, true).getAll()
const keypair = SECRET.length === 66
    ? { secretKey: SECRET } // public key not required
    : encryptionKeypair(SECRET, true) // create encryption keypair
/**
 * @name    encryptVlaue
 * @summary encrypt data using Box encrption if `RECIPIENT_PUBLIC_KEY` supplied. Otherwise, use SecretBox encryption.
 * 
 * @param {*} value 
 * @param {*} nonce 
 * 
 * @returns {Object}    `{ encrypted, nonce }`
 */
const encryptValue = (value, nonce) => {
    if (!isBox) return secretBoxEncrypt(value, keypair.secretKey, nonce, true)
    const result = encrypt(value, keypair.secretKey, RECIPIENT_PUBLIC_KEY, nonce, true)
    return {
        encrypted: result.sealed,
        nonce: result.nonce,
    }
}

console.log({
    FILE_NAME,
    FILE_NAME_OUTPUT,
    encryptionType: isBox ? 'Box' : 'SecretKey/SecretBox',
    // keypair,
})

// encrypt data
const dataEncrypted = Array.from(data)
    .map(([key, value]) => {
        if (isObj(value)) {
            const keys = PROPERTY_NAMES.length > 0
                ? PROPERTY_NAMES
                : Object.keys(value)
            // if nonce supplied use it. otherwise, genereate new nonce for this value only
            value[NONCE_KEY] = NONCE || newNonce(true)
            keys.filter(x => x !== NONCE_KEY) // prevent nonce being encrypted
                .forEach(key => {
                    const { encrypted } = encryptValue(value[key], value[NONCE_KEY])
                    if (!encrypted) throw new Error('Encryption failed!')
                    value[key] = encrypted
                })
        } else if (!!NONCE) {
            const { encrypted } = encryptValue(value, NONCE)
            if (!encrypted) throw new Error('Encryption failed!')
            value = encrypted
        } else {
            throw new Error('NONCE required')
        }
        return [key, value]
    })

// save encrypted data to output file
new DataStorage(FILE_NAME_OUTPUT)
    .setAll(new Map(dataEncrypted, FILE_OVERRIDE))

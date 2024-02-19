import { decrypt, verify } from './nacl'

export default function verifyGeneratedData(companyId, generatedData = {}) {
    const {
        identity,
        uriEncrypted,
        uriEncryptedSigned,
        userPublicKeys: {
            encrypt: pubEncrypt,
            sign: pubSign,
        } = {},
    } = generatedData

    // check if it can be decrypted??
    const uri = decrypt(uriEncrypted, pubEncrypt, true)
    if (!uri) return false

    const msg = [
        companyId,
        identity,
        uriEncrypted,
    ].join('__')
    const verified = verify(msg, uriEncryptedSigned, pubSign)
    return verified
}
import CouchDBStorage from './CouchDBStorage'
import { decrypt, encrypt } from './utils/naclHelper'
import { isFn, objCopy } from './utils/utils'
import { TYPES, validate, validateObj } from './utils/validator'
import { setTexts } from './language'
import { commonConfs } from './notification'

const kyc = new CouchDBStorage(null, 'kyc')
const btcAddresses = new CouchDBStorage(null, 'address-btc')
const dotAddresses = new CouchDBStorage(null, 'address-dot')
const ethAddresses = new CouchDBStorage(null, 'address-eth')
const messages = setTexts({
    addressAlreadyInUse: 'address already in use'
})
const KYC_PublicKey = process.env.KYC_PublicKey
const ETH_Smart_Contract = process.env.ETH_Smart_Contract
// encryption public key, only accessible by Totem Live Association 
const envErr = validateObj(
    { KYC_PublicKey, ETH_Smart_Contract },
    {
        KYC_PublicKey: {
            required: true,
            type: TYPES.hash,
        },
        ETH_Smart_Contract: commonConfs.ethAddress,
    }, 
    true,
    true,
)
if (KYC_PublicKey && envErr) throw `Missing or invalid environment variable. ${envErr}`

// placeholder
const generateDOTAddress = async (userId) => { return 'a dot address for ' + userId }

//
export async function handleKyc(kycData, callback) {
    const [_, user] = this
    if (!isFn(callback) || !user) return

    const kycEntry = kyc.get(user.id)
    // user has already done KYC
    if (kycEntry) return callback(null)

    const err = validateObj(kycData, handleKyc.validationConf, true)
    if (err) return callback(err)

    // TODO: encrypt each property of kycData
    // generate a throwaway sender keypair
    // const tempKeypair = { privateKey:'0x0' }
    // Object.keys(kycData).forEach(key => {
    //     kycData[key] = encrypt(
    //         kycData[key],
    //         tempKeypair.privateKey,
    //         KYC_PublicKey,
    //         undefined,
    //         true,
    //     )
    // })
    await kyc.set(user.id, kycData)
    callback(null)
}
handleKyc.requireLogin = true
handleKyc.validationConf = Object.freeze({
    email: { maxLength: 128, required: true, type: TYPES.email },
    familyName: commonConfs.str3To64Required,
    givenName: commonConfs.str3To64Required,
    identity: { requird: true, type: TYPES.identity },
    location: commonConfs.location,
    required: true,
    type: TYPES.object,
})

export async function handleDAA(blockchain, ethAddress, callback) {
    const [_, user] = this
    if (!isFn(callback) || !user) return
    
    let conf = handleDAA.validationConf
    const v = { blockchain, ethAddress }
    const newEntry = {
        userId: user.id,
        tsCreated: new Date(),
    }
    let existingEntry, addressDb, err, isSelf, isETH
    switch (blockchain) {
        case 'DOT':
            addressDb = btcAddresses
            newEntry.address = await generateDOTAddress(user.id)
        case 'BTC':
            addressDb = addressDb || dotAddresses
            conf = objCopy(handleDAA.validationConf, {})
            existingEntry = addressDb.find({ userId: { $eq: user.id } })
            newEntry.address = newEntry.address || await getBTCAddress(user.id)
            delete conf.ethAddress
            break
        case 'ETH':
            addressDb = ethAddresses
            existingEntry = addressDb.get(ethAddress)
            isETH = true
            break
    }

    isSelf = existingEntry && existingEntry.userId !== user.id
    if (existingEntry) return callback(
        !isSelf
            ? messages.addressAlreadyInUse // for ETH address ONLY
            : null,
        isSelf
            ? isETH
                ? ETH_Smart_Contract
                : existingEntry.address
            : undefined
    )

    err = validateObj(v, conf)
    if (err) return callback(err)

    await addressDb.set(newEntry.address, newEntry)
    callback(null, isETH ? ETH_Smart_Contract : newEntry.address)
}
handleDAA.requireLogin = true
handleDAA.validationConf = Object.freeze({
    blockchain: {
        accept: [ 'BTC', 'ETH', 'DOT' ],
        required: true,
        type: TYPES.string,
    },
    ethAddress: commonConfs.ethAddress,
    required: true,
    type: TYPES.object,

})
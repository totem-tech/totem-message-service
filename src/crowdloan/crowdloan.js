import Keyring from '@polkadot/keyring'
import { bytesToHex } from 'web3-utils'
import { setTexts } from '../language'
import { hexToBytes, strToU8a } from '../utils/convert'
import CouchDBStorage from "../utils/CouchDBStorage"
import { isAddress, isFn, isObj, isStr } from '../utils/utils'
import { TYPES, validateObj } from '../utils/validator'

const messages = setTexts({
    invalidSignature: 'signature verification failed',
})
const storage = new CouchDBStorage(null, 'crowdloan')
const PLEDGE_PERCENTAGE = 0.3125

/**
 * @name    handleCrowdloan
 * @summary fetch or update user contribution
 * 
 * @param   {String|Object} contribution identity or contribution data
 * @param   {Nubmer}        contribution.amountContributed
 * @param   {Nubmer}        contribution.amountPledged
 * @param   {Nubmer}        contribution.amountToContribute
 * @param   {String}        contribution.identity
 * @param   {String}        contribution.signature
 * @param   {String}        contribution.totalContribution
 * @param   {Function}      callback 
 */
export async function handleCrowdloan(contribution, callback) {
    const [_, user] = this
    if (!user || !isFn(callback)) return

    if (isAddress(contribution)) return callback(null, await storage.get(contribution))

    const { id: userId } = user
    const {
        amountContributed = 0,
        amountPledged = 0,
        amountToContribute = 0,
        identity,
        signature,
        totalContribution = 0,
    } = contribution
    let conf = { ...handleCrowdloan.validationConf }
    conf.amountPledged = {
        ...conf.amountPledged,
        // max 10% of total contributed
        max: Number(
            (totalContribution * PLEDGE_PERCENTAGE)
                .toFixed(2)
        ),
    }
    let err = validateObj(
        contribution,
        conf,
        true,
        true,
    )
    if (err) return callback(err)

    const entry = {
        amountContributed,
        amountPledged,
        amountToContribute,
        identity,
        signature,
        signatureVerified: false,
        totalContribution,
        userId,
    }
    // signature can be verified later using a script or alternative method
    // const pair = keyring.addFromAddress(identity)
    // const valid = pair.verify(
    //     entry,
    //     hexToBytes(signature),
    // )
    // //console.log({ pair, entry, valid })
    // if (!valid) return callback(messages.invalidSignature)

    // entry.signatureVerified = true

    await storage.set(identity, entry)
    callback(null, entry)
}
handleCrowdloan.requireLogin = true
handleCrowdloan.validationConf = {
    amountContributed: {
        required: true,
        min: 0,
        type: TYPES.number,
    },
    amountToContribute: {
        required: true,
        min: 5,
        type: TYPES.number,
    },
    amountPledged: {
        min: 0,
        type: TYPES.number,
    },
    identity: {
        required: true,
        type: TYPES.identity,
    },
    signature: {
        required: true,
        type: TYPES.hex,
    },
    totalContribution: {
        required: true,
        min: 5,
        type: TYPES.number,
    },
}
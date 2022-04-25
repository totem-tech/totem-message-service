import Keyring from '@polkadot/keyring'
import { BehaviorSubject } from 'rxjs'
import { bytesToHex } from 'web3-utils'
import { setTexts } from '../language'
import { broadcast, emitToClients, rxUserLoggedIn } from '../users'
import { hexToBytes, strToU8a } from '../utils/convert'
import CouchDBStorage from '../utils/CouchDBStorage'
import { subjectAsPromise } from '../utils/reactHelper'
import { deferred, isAddress, isDefined, isFn, isObj, isStr } from '../utils/utils'
import { TYPES, validateObj } from '../utils/validator'

const messages = setTexts({
    invalidSignature: 'signature verification failed',
})
const dbCrowdloan = new CouchDBStorage(null, 'crowdloan')
const PLEDGE_PERCENTAGE = 1 // 100%
let rxPldegedTotal = new BehaviorSubject()
const eventPldegedTotal = 'crowdloan-pledged-total'
const broadcastPledgeTotal = deferred(async () => {
    const [{ value }] = await dbCrowdloan.view('pledge', 'sum', {}, false)
    rxPldegedTotal.next(value)

    // broadcast to all clients
    broadcast([], eventPldegedTotal, [value])
}, 300)

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

    if (isAddress(contribution)) return callback(null, await dbCrowdloan.get(contribution))

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

    await dbCrowdloan.set(identity, entry)
    broadcastPledgeTotal()
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

/**
 * @name    handleCrowdloanPledgedTotal
 * @summary event handler to manually retrieve pledged total
 * 
 * @param   {Function} cb 
 */
export const handleCrowdloanPledgedTotal = async (cb) => {
    if (!isFn(cb)) return

    // wait until first time pledged total is retrieved from database
    await subjectAsPromise(
        rxPldegedTotal.value,
        value => isDefined(value)
            ? value
            : null,
    )
    cb(rxPldegedTotal.value)
}

setTimeout(async () => {
    // create design document to enable case-insensitive search of twitter handles
    await dbCrowdloan.viewCreateMap(
        'pledge',
        'sum',
        `function (doc) { emit(doc._id, doc.amountPledged || 0) }`,
        '_sum',
    )
    broadcastPledgeTotal()
    rxUserLoggedIn.subscribe(data => {
        if (!data) return
        const { clientId } = data

        setTimeout(
            () => emitToClients(clientId, eventPldegedTotal, [rxPldegedTotal.value]),
            500,
        )
    })
})

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
    invalidSignature: 'Signature verification failed',
    pledgeCapReached: 'Your contribution was successful. However, pledge cap was already reached or will exceed. Therefore, your new pledged amount cannot be accepted. If you previously pledged, it will still remain effective.'
})
const dbCrowdloan = new CouchDBStorage(null, 'crowdloan')
const PLEDGE_PERCENTAGE = 1 // 100%
const PLEDGE_CAP = parseFloat(process.env.PLEDGE_CAP) || 1775000
let rxPldegedTotal = new BehaviorSubject()
const eventPldegedTotal = 'crowdloan-pledged-total'
const broadcastPledgeTotal = deferred(async () => {
    let [{ value } = {}] = await dbCrowdloan.view('pledge', 'sum', {}, false)
    value = value || 0
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
        amountPledgeFulfilled = 0,
        blockHash,
        blockIndex,
        identity,
        signature,
    } = contribution
    let conf = { ...handleCrowdloan.validationConf }
    const existingEntry = (await dbCrowdloan.get(identity)) || {}
    conf.amountPledged = {
        ...conf.amountPledged,
        // must be greatuer or equal to previous amount fulfilled
        min: existingEntry && existingEntry.amountPledgeFulfilled || 0,
        // max 100% of amounted contributed
        max: Number(
            (amountContributed * PLEDGE_PERCENTAGE)
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

    const { amountPledged: lastPledge = 0, history = [] } = existingEntry
    const isUpdate = existingEntry._id
    const newPledge = amountPledged - lastPledge
    const pledgeCapReached = (rxPldegedTotal.value + newPledge) > PLEDGE_CAP
    if (pledgeCapReached) return callback(messages.pledgeCapReached)
    const entry = {
        ...existingEntry,
        amountContributed,
        amountPledged,
        amountPledgeFulfilled,
        blockHash,
        blockIndex,
        history: [
            ...history,
            isUpdate && {
                amountContributed: existingEntry.amountContributed,
                amountPledged: existingEntry.amountPledged,
                amountPledgeFulfilled: existingEntry.amountPledgeFulfilled,
                blockHash: existingEntry.blockHash,
                blockIndex: existingEntry.blockIndex,
                signature: existingEntry.signature,
                tsSubmitted: existingEntry.tsUpdated || existingEntry.tsCreated,
                userId: existingEntry.userId,
            },
        ].filter(Boolean),
        identity,
        signature,
        signatureVerified: false,
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
    amountPledged: {
        min: 0,
        type: TYPES.number,
    },
    amountPledgeFulfilled: {
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

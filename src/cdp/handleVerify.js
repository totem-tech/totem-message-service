import { dbCdpAccessCodes, dbCompanies } from './couchdb'
import { getPublicData, sanitiseAccessCode } from './utils'
import { defs, messages } from './validation'

export default async function handleVerify(cdp, callback) {
    const selector = { cdp: sanitiseAccessCode(cdp) }
    const cdpEntry = await dbCdpAccessCodes.find(selector)
    if (!cdpEntry) return callback(messages.invalidCdp)

    const company = await dbCompanies.get(cdpEntry._id)
    const publicData = getPublicData(cdpEntry, company || {})
    callback(null, publicData)
}
handleVerify.description = 'Verify CDP and fetch company public information'
handleVerify.params = [
    defs.cdp,
    defs.callback,
]
handleVerify.result = defs.publicData



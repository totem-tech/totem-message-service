import { isObj, objClean } from '../utils/utils'
import {
    defs,
    getCodeSanitised,
    messages,
    dbCdpAccessCodes,
    getPublicData
} from './common'

export default async function handleVerify(cdp, callback) {
    const selector = { cdp: getCodeSanitised(cdp) }
    const cdpEntry = await dbCdpAccessCodes.find(selector)
    const err = !isObj(cdpEntry?.companyData) && messages.invalidCdp
    callback(
        err,
        !err && getPublicData(cdpEntry) || undefined
    )
}
handleVerify.description = 'Verify CDP and fetch company public information'
handleVerify.params = [
    defs.cdp,
    defs.callback,
]
handleVerify.result = defs.publicData



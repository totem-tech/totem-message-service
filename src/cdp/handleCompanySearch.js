import { isFn } from '../utils/utils'
import { dbCdpAccessCodes, dbCompanies } from './couchdb'
import { getPublicData } from './utils'
import { defs, messages } from './validation'

export default async function handleCDPCompanySearch(regNum, callback) {
    if (!isFn(callback)) return

    const selector = { registrationNumber: regNum }
    const company = await dbCompanies.find(selector)
    if (!company || !!company.addedBy) return callback(messages.invalidRegNum)

    const cdpEntry = await dbCdpAccessCodes.find(selector)
    const publicData = getPublicData(cdpEntry || {}, company)
    callback(null, publicData)
}
handleCDPCompanySearch.description = 'Find company by registration number'
handleCDPCompanySearch.params = [defs.regNum, defs.callback]
handleCDPCompanySearch.result = defs.publicData
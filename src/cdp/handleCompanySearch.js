import { isFn } from '../utils/utils'
import {
    dbCdpAccessCodes,
    dbCompanies,
    defs,
    getPublicData,
} from './common'

export default async function handleCDPCompanySearch(regNum, callback) {
    if (!isFn(callback)) return

    const selector = { registrationNumber: regNum }
    const cdpEntry = await dbCdpAccessCodes.find(selector)
    const companyData = cdpEntry?.companyData ?? await dbCompanies.find(selector)
    const publicData = getPublicData(
        !cdpEntry
            ? companyData
            : { ...cdpEntry, companyData }
    )
    callback(null, publicData)
}
handleCDPCompanySearch.description = 'Find company by registration number'
handleCDPCompanySearch.params = [defs.regNum, defs.callback]
handleCDPCompanySearch.result = defs.publicData
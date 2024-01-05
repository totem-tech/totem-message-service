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
    const companyOrCDPEntry = await dbCdpAccessCodes.find(selector)
        || await dbCompanies.find(selector)
    callback(null, getPublicData(companyOrCDPEntry))
}
handleCDPCompanySearch.description = 'Find company by registration number'
handleCDPCompanySearch.params = [defs.regNum, defs.callback]
handleCDPCompanySearch.result = defs.publicData
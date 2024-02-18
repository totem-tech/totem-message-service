import { dbCdpAccessCodes } from './couchdb'
import { defs } from './validation'

/**
 * @name    handleCheckCreate
 * 
 * @param {String}  companyId
 * 
 * @param {Function}   callback 
 */
export default async function handleCheckCreate(companyId, callback) {
    const entry = await dbCdpAccessCodes.find({ companyId })

    callback(null, !entry?.accessCode)
}
handleCheckCreate.params = [
    defs.companyId,
    defs.callback,
]
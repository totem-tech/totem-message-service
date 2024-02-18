import { setup as setupCouchDB } from './couchdb'
import handleCalcValidityPeriod from './handleCalcValidityPeriod'
import handleCheckCreate from './handleCheckCreate'
import handleCompanySearch from './handleCompanySearch'
import handleCreateAccessCode from './handleCreateAccessCode'
import { handleDraft } from './handleDraft'
import handleGetPublicKeys from './handleGetPublicKeys'
import handleLogProgress from './handleLogProgress'
import handleReport from './handleReport'
import handleValidateAccessCode from './handleValidateAccessCode'
import handleVerify from './handleVerify'
import { setup as setupNacl } from './nacl'
import handleStripeCreateIntent, {
    handleStripeCheckPaid,
    handleStripeClientAPIKey,
    setupStripe
} from './stripe'
import { generateAccessCode } from './utils'

export const setup = async (expressApp) => {
    await setupCouchDB()

    await setupNacl()

    // create demo CDP entries
    // if (process.env.DEBUG === 'TRUE') {
    //     const demoCompanies = await dbCompanies.search({
    //         registrationNumber: '06226808'
    //     }, 1, 0, false)
    //     //const demoCompanies = await dbCompanies.getAll(null, false, 3)
    //     const demoEntries = demoCompanies.map(({
    //         _id,
    //         identity,
    //         registrationNumber
    //     }) => ({
    //         _id,
    //         // ToDO: generate by encrypting to a throwaway key? Use faucet keypair?
    //         // without "-" 
    //         accessCode: generateAccessCode(identity),
    //         companyId: _id,
    //         registrationNumber,

    //         // to be generated/updated on payment
    //         cdp: null,
    //         tsCdpFirstIssued: null,
    //     }))
    //     await dbCdpAccessCodes.setAll(demoEntries)
    // }

    await setupStripe(expressApp)
}

const handlers = {
    'cdp-calc-validity-period': handleCalcValidityPeriod,
    'cdp-check-create': handleCheckCreate,
    'cdp-company-search': handleCompanySearch,
    'cdp-company-search': handleCompanySearch,
    'cdp-set-access-code': handleCreateAccessCode,
    'cdp-draft': handleDraft,
    'cdp-get-public-keys': handleGetPublicKeys,
    'cdp-log-progress': handleLogProgress,
    'cdp-report': handleReport,
    'cdp-stripe-client-api-key': handleStripeClientAPIKey,
    'cdp-stripe-check-paid': handleStripeCheckPaid,
    'cdp-stripe-create-intent': handleStripeCreateIntent,
    'cdp-validate-access-code': handleValidateAccessCode,
    'cdp-verify': handleVerify,
}

Object
    .values(handlers)
    .forEach(handler => {
        handler.includeLabel = false // only error message. exclude param label/name
        handler.includeValue = false // exclude value from error message
    })
export default handlers
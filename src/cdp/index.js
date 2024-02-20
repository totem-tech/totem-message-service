import { setup as setupCouchDB } from './couchdb'
import handleCalcValidityPeriod from './handleCalcValidityPeriod'
import handleCheckCreate from './handleCheckCreate'
import handleCompanySearch from './handleCompanySearch'
import handleSetAccessCode from './handleSetAccessCode'
import { handleDraft } from './handleDraft'
import handleFinalizePayment from './handleFinalizePayment'
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

export const setup = async (expressApp) => {
    await setupCouchDB()

    await setupNacl()

    await setupStripe(expressApp)
}

const handlers = {
    'cdp-calc-validity-period': handleCalcValidityPeriod,
    'cdp-check-create': handleCheckCreate,
    'cdp-company-search': handleCompanySearch,
    'cdp-company-search': handleCompanySearch,
    'cdp-draft': handleDraft,
    'cdp-finalize-payment': handleFinalizePayment,
    'cdp-get-public-keys': handleGetPublicKeys,
    'cdp-log-progress': handleLogProgress,
    'cdp-report': handleReport,
    'cdp-set-access-code': handleSetAccessCode,
    'cdp-stripe-client-api-key': handleStripeClientAPIKey,
    'cdp-stripe-check-paid': handleStripeCheckPaid,
    'cdp-stripe-create-intent': handleStripeCreateIntent,
    'cdp-validate-access-code': handleValidateAccessCode,
    'cdp-verify': handleVerify,
}

const processHandlers = handlers => Object
    .values(handlers)
    .forEach(handler => {
        handler.includeLabel = false // only error message. exclude param label/name
        handler.includeValue = false // exclude value from error message
        handler.or && processHandlers([handler.or])
        processHandlers(handler.properties || [])
        processHandlers(handler.params || [])
    })
processHandlers(handlers)
export default handlers
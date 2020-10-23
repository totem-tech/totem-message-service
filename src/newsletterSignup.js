import { TYPES, validateObj } from './utils/validator'
import CouchDBStorage from './CouchDBStorage'
import { setTexts } from './language'
import { isFn, objClean } from './utils/utils'

const messages = setTexts({
    signupExists: 'You have already signed up with the email address!'
})
const signups = new CouchDBStorage(null, 'newsletter-signup')
const validatorConfig = {
    email: {
        required: true,
        type: TYPES.email,
    },
    firstName: {
        minLength: 3,
        required: true,
        type: TYPES.string,
    },
    lastName: {
        minLength: 3,
        required: true,
        type: TYPES.string,
    }
}
const VALID_KEYS = Object.freeze(Object.keys(validatorConfig))
export const handleNewsletterSignup = async (values, callback) => {
    if (!isFn(callback)) return
    const errMsg = validateObj(values, validatorConfig, true, true)
    if (errMsg) return callback(errMsg)

    const { email } = values
    const { firstName, lastName } = (await signups.get(email)) || {}
    // allow update if names don't exist
    if (firstName && lastName) return callback(messages.signupExists)

    await signups.set(email, { ...objClean(values, VALID_KEYS), tsCreated: new Date() })
    callback(null)
}
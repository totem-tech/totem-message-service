import { TYPES, validateObj } from './utils/validator'
import CouchDBStorage from './CouchDBStorage'
import { setTexts } from './language'

const messages = setTexts({
    signupExists: 'You have already signed up with the email address!'
})
const signups = new CouchDBStorage(null, 'newsletter-signup')
const validatorConfig = {
    email: {
        required: true,
        type: TYPES.email,
    },
    name: {
        minLength: 4,
        required: true,
        type: TYPES.string,
    }
}
export const handleNewsletterSignup = async (values, callback) => {
    const errMsg = validateObj(values, validatorConfig, true, true)
    if (errMsg) return callback(errMsg)

    const { email, name } = values
    const exits = await signups.get(email)
    if (exits) return callback(messages.signupExists)

    await signups.set(email, { name, tsCreated: new Date() }, false)
    callback(null)
}
import { TYPES } from '../utils/validator'
import { getPublicKeys } from './nacl'
import { defs } from './validation'

export default function handleGetPublicKeys(callback) {
    callback?.(null, getPublicKeys())
}
handleGetPublicKeys.params = [defs.callback]
handleGetPublicKeys.result = defs.publicKeys
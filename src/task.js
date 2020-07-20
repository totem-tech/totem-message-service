import CouchDBStorage from './CouchDBStorage'
import { setTexts } from './language'
import { isFn, isObj, objClean, objContains, isArr } from './utils/utils'
import { authorizeData } from './blockchain'
import { getUserByClientId } from './users'

// Tasks database
const storage = new CouchDBStorage(null, 'task')
// error messages
const messages = setTexts({
    invalidHash: 'Invalid hash',
    invalidKeys: 'Missing on or more of the required properties',
    invalidRequest: 'Invalid request',
    loginRequired: 'Login/registration required',
    maxLenDesc: 'Description exceeds maximum acceptable length',
    maxLenTitle: 'Title exceeds maximum acceptable length',
})
const REQUIRED_KEYS = [
    'address',
    'currency',
    'published',
    'title',
]
// all acceptable keys
const VALID_KEYS = [
    ...REQUIRED_KEYS,
    'description',
    'tags',
]
const MAX = {
    // maximum number of characters alllowed in description
    description: 5000,
    // maximum number of characters allowed in title
    title: 128,
}

// handleTaskGet retrieves non-blockchain task details from database
//
// Params:
// @ids         array/string: single or array of task IDs (task hash)
// @callback    function: callback args =>
//                  @err    string: error message, if any
//                  @result array: 2D array of task objects. Intended to be used as a Map, eg: `new Map(result)`
export async function handleTaskGet(ids, callback) {
    if (!isFn(callback)) return
    ids = isArr(ids) ? ids : [ids].filter(Boolean)
    callback(null, await storage.getAll(ids, true, 100))
}

// handleTask saves non-blockchain task details to the database.
// Requires pre-authentication using BONSAI with the blockchain identity that owns the task.
// Login is required simply for the purpose of loggin the User ID who saved the data.
// 
// Params:
// @id          string: hash of the task
// @task        object: see `REQUIRED_KEYS` & `VALID_KEYS` for a list of accepted properties
// @callback    function: callback args:
//                  @err    string: error message, if any
export async function handleTask(id, task = {}, callback) {
    if (!isFn(callback)) return
    if (!!isObj(task)) return callback(messaages.invalidRequest)
    // check if all the required keys are present
    if (!objContains(REQUIRED_KEYS)) return callback(`${messages.invalidKeys}: ${REQUIRED_KEYS.join(', ')}`)
    // TODO: add data type, length etc validation

    const client = this
    const user = getUserByClientId(client.id)
    if (!user) return callback(messages.loginRequired)

    // get rid of any unwanted properties
    task = objClean(task, VALID_KEYS)
    task.savedBy = user.id

    // check if data has been authorized using BONSAI
    // const authorized = await authorizeData(hash, task)

    // save to database
    await storage.set(id, task)

    callback()
}
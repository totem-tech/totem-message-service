import CouchDBStorage from './CouchDBStorage'
import { setTexts } from './language'
import { isFn, isObj, objClean, objContains, isArr, arrUnique } from './utils/utils'
import { authorizeData, recordTypes } from './blockchain'
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
// @ids         array/string: single or array of task IDs
// @callback    function: callback args =>
//                  @err    string: error message, if any
//                  @result array: 2D array of task objects. Intended to be used as a Map, eg: `new Map(result)`
export async function handleTaskGetById(ids, callback) {
    if (!isFn(callback)) return
    ids = arrUnique((isArr(ids) ? ids : [ids]).filter(Boolean))
    const result = await storage.getAll(ids, true, ids.length)
    callback(null, result)
}

// handleTask saves non-blockchain task details to the database.
// Requires pre-authentication using BONSAI with the blockchain identity that owns the task.
// Login is required simply for the purpose of loggin the User ID who saved the data.
// 
// Params:
// @taskId      string: ID of the task
// @task        object: see `REQUIRED_KEYS` & `VALID_KEYS` for a list of accepted properties
// @callback    function: callback args:
//                  @err    string: error message, if unsuccessful
export async function handleTask(taskId, task = {}, ownerAddress, callback) {
    if (!isFn(callback)) return
    if (!isObj(task)) return callback(messages.invalidRequest)
    // check if all the required keys are present
    if (!objContains(task, REQUIRED_KEYS)) return callback(`${messages.invalidKeys}: ${REQUIRED_KEYS.join(', ')}`)
    // TODO: add data type, length etc validation

    const client = this
    const user = getUserByClientId(client.id)
    if (!user) return callback(messages.loginRequired)
    task = objClean(task, VALID_KEYS)
    // check if data has been authorized using BONSAI
    const tokenData = `${recordTypes.task}${ownerAddress}${JSON.stringify(task)}`
    const authErr = await authorizeData(taskId, tokenData)
    if (authErr) return callback(authErr)

    const tsUpdated = new Date()
    const existingTask = await storage.get(taskId)
    task = {
        // if an entry already exists merge with new information
        ...existingTask || {
            createdBy: user.id,
            tsCreated: tsUpdated,
        },
        // get rid of any unwanted properties
        ...task,
        updatedBy: user.id,
        tsUpdated,
    }


    // save to database
    const result = await storage.set(taskId, task)
    callback(null, result)
}
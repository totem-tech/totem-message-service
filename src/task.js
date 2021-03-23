import CouchDBStorage from './utils/CouchDBStorage'
import { isFn, objClean, isArr, arrUnique } from './utils/utils'
import { TYPES, validateObj, validate } from './utils/validator'
import { authorizeData, recordTypes } from './blockchain'
import { setTexts } from './language'

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
// configuration to validate task object using `validateObj` function
const validatorConfig = {
    amountXTX: {
        required: true,
        type: TYPES.integer,
    },
    currency: {
        required: true,
        type: TYPES.string,
    },
    deadline: {
        min: 1,
        required: true,
        type: TYPES.integer,
    },
    description: {
        min: 0,
        maxLength: 5000,
        required: false,
        type: TYPES.string,
    },
    dueDate: {
        min: 1,
        required: true,
        type: TYPES.integer,
    },
    isMarket: {
        required: true,
        type: TYPES.boolean,
    },
    isSell: {
        accept: [0, 1],
        required: true,
        type: TYPES.integer,
    },
    parentId: {
        required: false,
        type: TYPES.hex,
    },
    tags: {
        required: false,
        type: TYPES.array
    },
    title: {
        maxLength: 160,
        minLength: 3,
        required: true,
        type: TYPES.string
    },
}
const REQUIRED_KEYS = Object.keys(validatorConfig)
// handleTask saves non-blockchain task details to the database.
// Requires pre-authentication using BONSAI with the blockchain identity that owns the task.
// Login is required simply for the purpose of loggin the User ID who saved the data.
// 
// Params:
// @taskId      string: ID of the task
// @task        object: see `validatorConfig` for a list of properties and their respected accepted data types etc.
// @callback    function: callback args:
//                  @err    string: error message, if unsuccessful
export async function handleTask(taskId, task = {}, ownerAddress, callback) {
    if (!isFn(callback)) return
    // validate object properties including taskId
    let err = validate(taskId, { required: true, type: TYPES.hex })
        || validateObj(task, validatorConfig, true, true)
    if (err) return callback(err)

    const [client, user] = this
    // const user = getUserByClientId(client.id)
    if (!user) return callback(messages.loginRequired)

    task = objClean(task, REQUIRED_KEYS)
    // check if data has been authorized using BONSAI
    const tokenData = `${recordTypes.task}${ownerAddress}${JSON.stringify(task)}`
    const authErr = await authorizeData(taskId, tokenData)
    if (authErr) return callback(authErr)

    const tsUpdated = new Date()
    const existingTask = (await storage.get(taskId)) || {
        createdBy: user.id,
        tsCreated: tsUpdated,
    }
    task = {
        // if an entry already exists merge with new information
        ...existingTask,
        // get rid of any unwanted properties
        ...task,
        updatedBy: user.id,
        tsUpdated,
    }

    // save to database
    const result = await storage.set(taskId, task)
    callback(null, result)
}
handleTask.requireLogin = true

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

export async function handleTaskMarketplaceSearch(filters = {}, callback) {
    if (!isFn(callback)) return
    const { keywords, tags, amountXTX, deadline, tsCreated } = filters


}
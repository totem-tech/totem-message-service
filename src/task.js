import CouchDBStorage from './utils/CouchDBStorage'
import {
    arrUnique,
    isArr,
    isFn,
    isStr,
    isValidNumber,
    objClean,
} from './utils/utils'
import {
    TYPES,
    validate,
    validateObj,
} from './utils/validator'
import { authorizeData, recordTypes } from './blockchain'
import { setTexts } from './language'

// Tasks database
const tasks = new CouchDBStorage(null, 'task')
// error messages
let messages = {
    errTask404: 'task not found',
    errAlreadyApplied: 'you have already applied for this task',
    invalidKeys: 'Missing on or more of the required properties',
    invalidRequest: 'Invalid request',
    loginRequired: 'Login/registration required',
    maxLenDesc: 'Description exceeds maximum acceptable length',
    maxLenTitle: 'Title exceeds maximum acceptable length',
}
messages = setTexts(messages)
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
        maxLength: 3,
        required: false,
        type: TYPES.array,
    },
    title: {
        maxLength: 160,
        minLength: 3,
        required: true,
        type: TYPES.string
    },
}
const REQUIRED_KEYS = Object.keys(validatorConfig)

const processTasksResult = (tasks = new Map(), userId) => (isArr(tasks)
    ? tasks
    : [...tasks.values()]
)
    .forEach(task => {
        if (!task.isMarket) return

        // exclude all other applicants user IDs
        task.applications = (task.applications || [])
            .map(x =>
                x.userId === userId
                    ? x
                    : objClean(x, ['workerAddress'])
            )
    })

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
    if (isStr(task.tags)) task.tags = task
        .tags
        .split(',')
        .filter(Boolean)
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
    const existingTask = (await tasks.get(taskId)) || {
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
    if (task.isMarket) task.applications = []

    // save to database
    const result = await tasks.set(taskId, task)
    callback(null, result)
}
handleTask.requireLogin = true

/**
 * @name    handleTaskGet 
 * @summary retrieves non-blockchain task details from database
 * 
 * @param   {Array}     ids 
 * @param   {Function}  callback args =>
 *                               @err    string: error message, if any
 *                               @result array: 2D array of task objects.
 *                                      Intended to be used as a Map, eg: `new Map(result)`
 */
export async function handleTaskGetById(ids, callback) {
    if (!isFn(callback)) return
    const [_, user] = this
    const { id: userId } = user || {}
    ids = arrUnique(
        isArr(ids)
            ? ids
            : [ids]
    ).filter(Boolean)
    const tasksMap = await tasks.getAll(
        ids,
        true,
        ids.length,
    )
    processTasksResult(tasksMap, userId)
    callback(null, tasksMap)
}
handleTaskGetById.requireLogin = true

export async function handleTaskMarketApply(taskId, workerAddress, callback) {
    if (!isFn(callback)) return

    const [_, user] = this
    const { id: userId } = user
    const task = await tasks.get(taskId)
    if (!task) return callback(messages.errTask404)

    const err = validate(workerAddress, { type: TYPES.identity })
    if (err) return callback(err)

    task.applications = task.applications || []
    const alreadyApplied = task
        .applications
        .find(x =>
            x.workerAddress === workerAddress
            || x.userId === userId
        )
    if (alreadyApplied) return callback(messages.errAlreadyApplied)

    task.applications.push({
        date: new Date(),
        userId,
        workerAddress,
    })
    await tasks.set(taskId, task)
    // application successful
    return callback()
}
handleTaskMarketApply.requireLogin = true

/**
 * @name    handleTaskSearch
 * @summary search for marketplace tasks
 * 
 * @param   {Object}    filter
 * @param   {String}    filter.keywords
 * @param   {Number}    filter.pageNo
 * 
 * @param   {Function}  callback
 */
export async function handleTaskMarketSearch(filter = {}, callback) {
    if (!isFn(callback)) return
    const [_, user] = this
    const { id: userId } = user
    let {
        createdBy,
        description,
        keywords = '',
        pageNo = 1,
        tags,
    } = filter
    pageNo = !isValidNumber(pageNo) || pageNo <= 1
        ? 1
        : pageNo
    const limit = 100
    let selector = {
        isMarket: true,
    }
    let result
    if (!!keywords) {
        selector = [
            {
                isMarket: true,
                title: { $gte: keywords },
            },
            {
                isMarket: true,
                createdBy: createdBy || keywords,
            },
            {
                isMarket: true,
                description: { $gte: description || keywords },
            },
            {
                isMarket: true,
                tags: { $in: tags || [keywords] },
            },
        ].filter(Boolean)

        result = await tasks.searchMulti(selector, limit)
    } else {
        const skip = (pageNo - 1) * limit
        const extraProps = {
            sort: !keywords
                ? [{ tsCreated: 'desc' }]
                : ['title']
        }
        result = await tasks.search(
            selector,
            limit,
            skip,
            true,
            extraProps,
        )
    }

    // console.log(JSON.stringify(selector, null, 4))
    // console.log(result, '\n\n')

    processTasksResult(result, userId)
    callback(null, result)
}
handleTaskMarketSearch.requireLogin = true

setTimeout(async () => {
    // create an index for the field `roles`, ignores if already exists
    const indexDefs = [
        {
            index: { fields: ['createdBy'] },
            name: 'createdBy-index',
        },
        {
            index: {
                fields: [
                    'description',
                    'isMarket',
                    'tags',
                    'title',
                ],
            },
            name: 'search-index',
        },
        {
            index: { fields: ['isMarket'] },
            name: 'isMarket-index',
        },
        {
            index: { fields: ['tsCreated'] },
            name: 'tsCreated-index',
        },
        {
            index: { fields: ['title'] },
            name: 'title-index',
        },
    ]
    indexDefs.forEach(async (def) =>
        await (await tasks.getDB())
            .createIndex(def)
    )

    // create design document to enable case-insensitive search of twitter handles
    await tasks.viewCreateMap(
        'lowercase',
        'twitterHandle',
        `function (doc) {
            if(!(doc.socialHandles || {}).twitter) return
            emit(doc.socialHandles.twitter.handle.toLowerCase(), null)
        }`
    )
})
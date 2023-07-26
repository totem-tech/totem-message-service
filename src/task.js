import CouchDBStorage from './utils/CouchDBStorage'
import {
    arrUnique,
    generateHash,
    isArr,
    isFn,
    isHash,
    isMap,
    isStr,
    isValidNumber,
    objClean,
    toArray,
} from './utils/utils'
import {
    TYPES,
    validate,
    validateObj,
} from './utils/validator'
import { authorizeData, recordTypes } from './blockchain'
import { setTexts } from './language'
import { commonConfs, sendNotification } from './notification'
import { broadcast, broadcastCRUD, systemUserSymbol } from './users'

// Tasks database
const tasks = new CouchDBStorage(null, 'task')
// error messages
let messages = {
    errAccessDenied: 'access denied',
    errAlreadyApplied: 'you have already applied for this task',
    errApplicantIsOwner: 'you cannot apply to the task you created',
    errTask404: 'task not found',
    errTaskClosed: 'applications are no longer being accepted',
    invalidKeys: 'missing on or more of the required properties',
    invalidRequest: 'invalid request',
    loginRequired: 'login/registration required',
    maxLenDesc: 'description exceeds maximum acceptable length',
    maxLenTitle: 'title exceeds maximum acceptable length',
}
messages = setTexts(messages)
const applicationStatus = {
    submitted: 0,
    accepted: 1,
    rejected: 2,
}
// configuration to validate task object using `validateObj` function
const validatorConfig = {
    fulfiller: {
        required: false,
        type: TYPES.identity,
    },
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
        min: 50,
        maxLength: 2000,
        required: false,
        type: TYPES.string,
    },
    dueDate: {
        min: 1,
        required: true,
        type: TYPES.integer,
    },
    isClosed: { // no longer accepting applications
        required: false,
        type: TYPES.boolean,
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
    orderType: {
        required: true,
        type: TYPES.integer,
    },
    parentId: {
        ...commonConfs.idHash,
        required: false,
    },
    productId: commonConfs.idHash,
    proposalRequired: {
        required: false,
        type: TYPES.boolean,
    },
    tags: {
        maxLength: 6,
        required: false,
        type: TYPES.array,
    },
    title: {
        maxLength: 80,
        minLength: 3,
        required: true,
        type: TYPES.string
    },
}
const VALID_KEYS = Object.keys(validatorConfig)

const processTasksResult = (tasks = new Map(), userId) => (
    isArr(tasks)
        ? tasks
        : [...tasks.values()]
).forEach(task => {
    const {
        applications,
        createdBy,
        isMarket,
    } = task
    if (!isMarket) return

    const isOwner = userId === createdBy
    // exclude all other applicants user IDs
    task.applications = (applications || []).map(x =>
        isOwner || x.userId === userId
            ? x
            : objClean(x, ['workerAddress'])
    )
})

/**
 * @name    handleTask
 * @summary saves off-chain task details to the database.
 * Requires pre-authentication using BONSAI with the blockchain identity that owns the task.
 * Login is required simply for the purpose of logging the User ID who saved the data.
 * 
 * @description 'task-market-created' event will be broadcasted whenever a new marketplace task is created.
 * @param   {String}    taskId          task ID
 * @param   {Object}    task            see `validatorConfig` for accepted properties.
 * @param   {String}    ownerAddress    task owner identity
 * @param   {Function}  callback        callback args:
 *                                      @err    string: error message, if unsuccessful
 */
export async function handleTask(taskId, task = {}, ownerAddress, callback) {
    if (!isFn(callback)) return

    const [_, user] = this
    // validate object properties including taskId
    if (isStr(task.tags)) task.tags = task
        .tags
        .split(',')
        .filter(Boolean)

    let err = validate(taskId, commonConfs.idHash)
        || validateObj(task, validatorConfig, true, true)
    if (err) return callback(err)

    // const user = getUserByClientId(client.id)
    if (!user) return callback(messages.loginRequired)

    task = objClean(task, VALID_KEYS)
    // check if data has been authorized using BONSAI
    const tokenData = `${recordTypes.task}${ownerAddress}${JSON.stringify(task)}`
    const authErr = await authorizeData(taskId, tokenData)
    if (authErr) return callback(authErr)

    const tsUpdated = new Date()
    const existingTask = await tasks.get(taskId)
    task = {
        // if an entry already exists merge with new information
        ...task.isMarket && { applications: [] },
        ...existingTask || {
            createdBy: user.id,
            tsCreated: tsUpdated,
        },
        // get rid of any unwanted properties
        ...task,
        updatedBy: user.id,
        tsUpdated,
    }
    // if (task.isMarket) task.applications = existingTask.applications || []

    // save to database
    await tasks.set(taskId, task)
    callback(null)

    // broadcast new marketplace task creation
    if (!existingTask && task.isMarket) broadcast([], 'task-market-created', [taskId])

    // broadcast task details for frontend to update
    broadcastCRUD(
        'task',
        taskId,
        !existingTask
            ? broadcastCRUD.actions.create
            : broadcastCRUD.actions.update,
        task
    )
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
    if (!ids.length) return callback(null, new Map())

    const tasksMap = await tasks.getAll(
        ids,
        true,
        ids.length,
    )
    // const tasksArr = isMap(tasksMap) && toArray(tasksMap) || []
    // for (const i in tasksArr) {
    //     const task = tasksArr[i]
    //     const { createdBy, isMarket } = task
    //     if (!isMarket || createdBy !== userId) continue

    //     const childrenMap = await handleTaskGetByParentId.call(
    //         this,
    //         task._id,
    //         () => { },
    //     )
    //     processTasksResult(childrenMap || new Map(), userId)
    //     task.children = childrenMap
    // }
    processTasksResult(tasksMap, userId)
    callback(null, tasksMap)
}

/**
 * @name    handleTaskGetByParentId
 * @summary search for tasks by parent ID
 * 
 * @param   {String}    parentId 
 * @param   {Function}  callback args =>
 *                               @err    string: error message, if any
 *                               @result array: 2D array of task objects.
 *                                      Intended to be used as a Map, eg: `new Map(result)`
 * 
 * @returns {Map} result
 */
export async function handleTaskGetByParentId(parentId, callback) {
    if (!isFn(callback)) return

    const [_, user] = this
    const { id: userId } = user || {}

    const tasksMap = await tasks.search(
        { parentId },
        1000,
    )
    processTasksResult(tasksMap, userId)
    callback(null, tasksMap)

    return tasksMap
}

/**
 * @name    taskMarketApply
 * @summary apply for an open marketplace task
 * 
 * @param   {Object}    application
 * @param   {Array}     application.links
 * @param   {String}    application.proposal
 * @param   {String}    application.taskId
 * @param   {String}    application.workerAddress
 * @param   {Function}  callback    Callback function expected arguments:
 *                                  @err    String: error message if request failed
 */
export async function handleTaskMarketApply(application, callback) {
    if (!isFn(callback)) return

    const [_, user] = this
    const { validationConf, validKeys } = handleTaskMarketApply
    const err = validateObj(
        application,
        validationConf,
        true,
        true,
    )
    if (err) return callback(err)

    const { id: userId } = user
    const {
        links,
        taskId,
        workerAddress,
    } = application
    const task = await tasks.get(taskId)
    if (!task) return callback(messages.errTask404)

    let {
        applications = [],
        createdBy,
        isClosed,
        isMarket,
    } = task
    if (createdBy === userId) return callback(messages.errApplicantIsOwner)
    if (isClosed || !isMarket) return callback(messages.errTaskClosed)

    const existingApplication = applications.find(x =>
        x.workerAddress === workerAddress
        || x.userId === userId
    )
    if (existingApplication) return callback(messages.errAlreadyApplied)

    const now = new Date()
    application = {
        tsCreated: now,
        ...application,
        links: links.map(link =>
            `${link}`.slice(0, 100)
        ),
        status: (existingApplication || {}).status || 0,
        tsUpdated: now,
        userId,
    }
    task.applications = [
        ...applications,
        objClean(application, validKeys),
    ]
    task.applicationsCount = task.applications.length
    await tasks.set(taskId, task)
    // application successful >> send notification to task owner.
    // predetermined ID limits the number of application notifications to 1.
    const notificationId = generateHash('task', + taskId + createdBy)
    sendNotification.call(
        [systemUserSymbol],
        userId,
        [createdBy],
        'task',
        'marketplace_apply',
        undefined,
        {
            applications: task.applications.length,
            taskId,
        },
        notificationId,
    )
    return callback()
}
handleTaskMarketApply.requireLogin = true
handleTaskMarketApply.validationConf = {
    links: {
        maxLength: 5,
        required: false,
        type: TYPES.array,
    },
    name: {
        maxLength: 32,
        minLength: 3,
        required: true,
        type: TYPES.string,
    },
    proposal: {
        maxLength: 2000,
        minLength: 50,
        required: false,
        type: TYPES.string,
    },
    taskId: commonConfs.idHash,
    workerAddress: commonConfs.identity,
}
// valid properties for application
handleTaskMarketApply.validKeys = [
    ...Object.keys(handleTaskMarketApply.validationConf),
    'tsCreated',
    'tsUpdated',
    'userId',
].sort()

/**
 * @name    handleTaskMarketApplication
 * @summary task owner/publisher accept/rejects application(s)
 * 
 * @param   {Object}    data 
 * @param   {Boolean}   data.rejectOthers   (optional) if true all applications excluding accepted ones will be rejected
 * @param   {Boolean}   data.status         set accepted/rejected status for a specific applicant
 * @param   {String}    data.taskId
 * @param   {String}    data.workerAddress
 * @param   {Function}  callback            Args: [error String, updateCount Number]
 */
export async function handleTaskMarketApplyResponse(data, callback) {
    if (!isFn(callback)) return

    const [_, { _id: userId }] = this
    const {
        rejectOthers,
        silent = false,
        status,
        taskId,
        workerAddress,
    } = data
    const err = validateObj(data, handleTaskMarketApplyResponse.validationConf)
    if (err) return callback(err)

    const task = await tasks.get(taskId)
    if (!task) return callback(messages.errTask404)

    const {
        applications = [],
        createdBy,
    } = task
    if (userId !== createdBy) return callback(messages.errAccessDenied)

    const application = applications.find(x =>
        x.workerAddress === workerAddress
    )
    if (!application) return callback(messages.invalidRequest)

    let updateCount = 0
    for (const application of applications) {
        let {
            status: aStatus,
            userId: applicantId,
            workerAddress: aWorkerAddress,
        } = application

        // status cannot be changed if already accepted
        const alreadyAccepted = aStatus === applicationStatus.accepted
        if (alreadyAccepted) continue

        // update status here
        aStatus = workerAddress === aWorkerAddress
            ? status
            : rejectOthers
                ? applicationStatus.rejected
                : aStatus
        // status unchanged
        if (aStatus === application.status) continue

        application.status = aStatus
        updateCount++
        const accepted = aStatus === applicationStatus.accepted
        // No need to notify if accepted. Task creation will send a notification
        if (accepted) continue

        // notify rejected user
        const doNotify = userId !== applicantId
            && (accepted || !silent)
        doNotify && sendNotification(
            createdBy,
            [application.userId],
            'task',
            'marketplace_apply_response',
            null,
            { status, taskId },
            generateHash(taskId, workerAddress)
        )
    }

    updateCount && await tasks.set(taskId, task)

    callback(null, updateCount)
}
handleTaskMarketApplyResponse.requireLogin = true
handleTaskMarketApplyResponse.validationConf = {
    rejectOthers: { required: false, type: TYPES.boolean },
    status: {
        accept: Object.values(applicationStatus),
        required: true,
        type: TYPES.integer,
    },
    taskId: commonConfs.idHash,
    workerAddress: commonConfs.identity,
}

// /**
//  * @name    handleTaskMarketCompleted
//  * @summary retrieve all tasks completed by user
//  * 
//  * @param   {Function} callback 
//  */
// export async function handleTaskMarketCompleted(callback) {
//     if (!isFn(callback)) return


// }
// handleTaskMarketCompleted.loginRequired = true

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
    const { id: userId } = user || {}
    let {
        keywords = '',
        pageNo = 1,
    } = filter

    if (!isStr(keywords)) keywords = ''

    pageNo = !isValidNumber(pageNo) || pageNo <= 1
        ? 1
        : pageNo
    const limit = 100
    const skip = (pageNo - 1) * limit
    let selector = {
        isMarket: true,
    }
    let result, extraProps
    if (isHash(keywords)) {
        // fetch by id
        const task = await tasks.get(keywords)
        const { _id, isMarket } = task || {}
        result = new Map(
            _id && isMarket
                ? [[_id, task]]
                : undefined
        )
    } else if (keywords.startsWith('@')) {
        // search by creator user ID
        const createdBy = keywords
            .replace('@', '')
            .trim()
        selector = {
            isMarket: true,
            createdBy,
        }
    } else if (keywords.startsWith('tag:')) {
        const tags = keywords
            .replace('tag:', '')
            .split(',')
        selector = {
            isMarket: true,
            tags: {
                $in: isArr(tags)
                    ? tags
                    : [keywords],
            },
        }
    } else if (!!keywords) {
        // search by title, description and tags
        result = await tasks.view('search', 'search-market', {
            keys: keywords
                .split(' ')
                .filter(Boolean),
            limit: 100,
            group: true,
        }, false)
        const ids = arrUnique(
            result
                .map(x => (x.value || []))
                .flat()
            // .flat() 
        ).slice(skip, limit)

        result = await tasks.getAll(ids)
    }
    if (!result) {
        extraProps = {
            sort: !keywords
                ? [{ tsCreated: 'desc' }]
                : undefined
        }
    }
    result = result || await tasks.search(
        selector,
        limit,
        skip,
        true,
        extraProps,
    )

    processTasksResult(result, userId)
    callback(null, result)
}

setTimeout(async () => {
    // create an index for the field `roles`, ignores if already exists
    const indexDefs = [
        {
            index: { fields: ['isMarket', 'createdBy'] },
            name: 'createdBy-index',
        },
        {
            index: { fields: ['isMarket', 'description'] },
            name: 'isMarket-index',
        },
        {
            index: { fields: ['isMarket', 'tags'] },
            name: 'tags-index',
        },
        {
            index: { fields: ['isMarket', 'title'] },
            name: 'title-index',
        },
        {
            index: { fields: ['isMarket', 'tsCreated'] },
            name: 'tsCreated-index',
        },
        {
            index: { fields: ['parentId'] },
            name: 'parentId-index',
        },
    ]
    indexDefs.forEach(async (def) =>
        await (await tasks.getDB())
            .createIndex(def)
    )

    // create map function for search
    const mapFunc = `function (doc) {
    if (!doc.isMarket || doc.parentId) return

    const numRegex = /^[0-9]+$/
    doc.title
        .toLowerCase()
        .match(/[a-z0-9\ ]/g)
        .join('')
        .split(' ')
        .filter(x => x && x.length > 2 && !numRegex.test(x))
        .forEach(word => emit(word, doc._id))
    
    // doc.description && doc
    //     .description
    //     .toLowerCase()
    //     .match(/[a-z0-9\ ]/g)
    //     .join('')
    //     .split(' ')
    //     .filter(x => x && x.length > 1 && !numRegex.test(x))
    //     .forEach(word => emit(word, doc._id))
    
    Array.isArray(doc.tags)
        && doc.tags.length > 0
        && doc.tags.forEach(tag =>
            emit(tag, doc._id)
        )
}`

    // required to get gruped IDS
    const reduceFunc = '(_, values) => values'
    await tasks.viewCreateMap(
        'search',
        'search-market',
        mapFunc,
        reduceFunc,
    )
})


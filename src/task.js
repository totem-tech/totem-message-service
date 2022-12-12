import CouchDBStorage from './utils/CouchDBStorage'
import { subjectAsPromise } from './utils/reactHelper'
import { blockToDate, dateToBlock } from './utils/time'
import {
    arrSort,
    arrUnique,
    generateHash,
    isArr,
    isError,
    isFn,
    isHash,
    isStr,
    isValidNumber,
    objClean,
} from './utils/utils'
import {
    TYPES,
    validate,
    validateObj,
} from './utils/validator'
import { authorizeData, recordTypes, rxBlockNumber } from './blockchain'
import { setTexts } from './language'
import { commonConfs, sendNotification } from './notification'
import { systemUserSymbol } from './users'

// Tasks database
const tasks = new CouchDBStorage(null, 'task')
// error messages
let messages = {
    errAcceptDeadline: 'worker must be given at least 12 hours prior to deadline',
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
        required: true,
        type: TYPES.boolean,
    },
    tags: {
        maxLength: 6,
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
    task.applications = (applications || [])
        .map(x =>
            isOwner || x.userId === userId
                ? x
                : objClean(x, ['workerAddress'])
        )
})

// handleTask saves non-blockchain task details to the database.
// Requires pre-authentication using BONSAI with the blockchain identity that owns the task.
// Login is required simply for the purpose of logging the User ID who saved the data.
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

    let err = validate(taskId, commonConfs.idHash)
        || validateObj(task, validatorConfig, true, true)
    if (err) return callback(err)

    const [_, user] = this
    // const user = getUserByClientId(client.id)
    if (!user) return callback(messages.loginRequired)

    task = objClean(task, VALID_KEYS)
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
export async function handleTaskMarketApplication(data, callback) {
    if (!isFn(callback)) return

    const [_, { _id: userId }] = this
    const {
        rejectOthers,
        status,
        taskId,
        workerAddress,
    } = data
    const err = validateObj(data, handleTaskMarketApplication.validationConf)
    if (err) return callback(err)

    const task = await tasks.get(taskId)
    if (!task) return callback(messages.errTask404)

    const {
        applications = [],
        createdBy,
        deadline,
    } = task
    if (userId !== createdBy) return callback(messages.errAccessDenied)

    const application = applications.find(x => x.workerAddress === workerAddress)
    if (!application) return callback(messages.invalidRequest)

    // check if deadline is at least 12 hours from now.
    // assignee must be given sufficient time to accept the task before the deadline.
    const doAccept = status === applicationStatus.accepted
    if (doAccept) {
        // resolve only when a block number has been received
        // ToDo: deal with block number not getting updated due to disconnection from node
        const [promise] = subjectAsPromise(rxBlockNumber, n => n > 0, 10000)
        const currentBlock = await promise.catch(err => err)
        if (isError(currentBlock)) return callback(`${currentBlock}`)

        // convert deadline (block number) to Date and then subtract by 12 hours
        const deadlineDate = blockToDate(deadline, currentBlock, false)
        const hours12 = 60 * 60 * 12
        deadlineDate.setSeconds(-hours12)

        // convert Date back to block number and compare with current block number
        const preDeadlineBlock = dateToBlock(deadlineDate, currentBlock)
        if (preDeadlineBlock >= currentBlock) return callback(messages.errAcceptDeadline)
    }
    let updateCount = 0
    for (const application of applications) {
        let {
            status: aStatus,
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
        // notify rejected user???
        sendNotification(
            createdBy,
            [application.userId],
        )
    }

    updateCount && await tasks.set(taskId, task)

    callback(null, updateCount)
}
handleTaskMarketApplication.requireLogin = true
handleTaskMarketApplication.validationConf = {
    rejectOthers: { required: false, type: TYPES.boolean },
    status: {
        accept: Object.values(applicationStatus),
        required: true,
        type: TYPES.integer,
    },
    taskId: commonConfs.idHash,
    workerAddress: commonConfs.identity,
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

    const { validationConf, validKeys } = handleTaskMarketApply
    const err = validateObj(
        application,
        validationConf,
        true,
        true,
    )
    if (err) return callback(err)

    const [_, user] = this
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
            `${link}`.slice(0, 96)
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
    // application successful >> send notification to task owner
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
    proposal: {
        maxLength: 500,
        minLength: 50,
        required: false,
        type: TYPES.string,
    },
    taskId: commonConfs.idHash,
    workerAddress: commonConfs.identity,
}
handleTaskMarketApply.validKeys = [
    ...Object.keys(handleTaskMarketApply.validationConf),
    'tsCreated',
    'tsUpdated',
    'userId',
].sort()

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
    if (isHash(keywords)) {
        const task = await tasks.get(keywords)
        const result = new Map(
            task.isMarket
                ? [task._id, task]
                : []
        )
        return callback(null, result)
    } else if (!!keywords) {
        selector = [
            {
                ...selector,
                tags: {
                    $in: isArr(tags)
                        ? tags
                        : [keywords],
                },
            },
            {
                ...selector,
                createdBy: { $eq: createdBy || keywords },
            },
            {
                ...selector,
                title: { $gte: keywords },
            },
            {
                ...selector,
                description: { $gte: description || keywords },
            },
        ].filter(Boolean)
        result = await tasks.searchMulti(selector, limit)
    }
    const skip = (pageNo - 1) * limit
    const extraProps = {
        sort: !keywords
            ? [{ tsCreated: 'desc' }]
            : undefined
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
handleTaskMarketSearch.requireLogin = true

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
    ]
    indexDefs.forEach(async (def) =>
        await (await tasks.getDB())
            .createIndex(def)
    )
})
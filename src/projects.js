import CouchDBStorage from './utils/CouchDBStorage'
import PromisE from './utils/PromisE'
import {
    isFn,
    isObj,
    objClean,
} from './utils/utils'
import { TYPES } from './utils/validator'
import { authorizeData } from './blockchain'
import { setTexts } from './language'
import { broadcastCRUD } from './system'

const messages = {
    accessDenied: 'Access denied',
    arrayRequired: 'Array required',
    bonsaiAuthFailed: 'BONSAI authentication failed',
    exists: 'Activity already exists. Please use a different combination of owner address, name and description.',
    loginRequired: 'You must be logged in to perform this action',
    projectNotFound: 'Activity not found',
}
setTexts(messages)
const activityConf = {
    name: 'activity',
    properties: {
        description: {
            required: true,
            maxLength: 160,
            minLength: 3,
            type: TYPES.string,
        },
        // id: {
        //     required: true,
        //     type: TYPES.hash,
        // },
        name: {
            maxLength: 64,
            minLength: 3,
            required: true,
            type: TYPES.string,
        },
        ownerAddress: {
            required: true,
            type: TYPES.identity,
        },
    },
    type: TYPES.object,
}
const projects = new CouchDBStorage(null, 'projects')

// Create/get/update project. 
// To get a project only `@hash` and `@callback` are required.
// Otherwise, all properties are required.
//
// Params:
// @hash        string: project hash (AKA ID)
// @project     object: an object including all project properties.
//                  See `validKeys` and `requiredKeys` variables above for a list of properties that are accepted.
// @token       string: BONSAI token to authorize that data is valid and approved by the project owner's identity only
// @create      bool: whether to create or update the project.
//                  If truthy and a project already exists, will return an error.
export async function handleProject(id, project, create, callback) {
    if (!isFn(callback)) return

    const [_, user] = this
    const existingProject = await projects.get(id)
    if (create && !!existingProject) return callback(messages.exists)

    // return existing project
    if (!isObj(project)) return callback(
        !!existingProject
            ? null
            : messages.projectNotFound,
        existingProject
    )

    // validate data
    const { bonsaiKeys } = handleProject

    // exclude any unwanted data and only update the properties that's supplied
    project = objClean({
        ...existingProject,
        ...project,
    }, bonsaiKeys)

    // Authenticate using BONSAI
    const err = await PromisE.timeout(
        authorizeData(id, project),
        10000, //timeout after 10 seconds
    )// return error to the client instead of throwing it.
        .catch(err => `${err}`.replace('Error: ', ''))
    if (err) return callback(err)

    const now = new Date().toISOString()
    const {
        createdAt = now
    } = existingProject || {}
    project.tsCreated = createdAt
    project.tsUpdated = now

    // store user information
    if (create) {
        // created by user ID
        project.userId = user.id
    } else {
        project.updatedBy = user.id
    }

    // Add/update project
    await projects.set(id, project)
    callback(null, project)

    // broadcast the ID of the activity so that frontend can update accordingly
    broadcastCRUD({
        action: create
            ? broadcastCRUD.actions.create
            : broadcastCRUD.actions.update,
        data: project,
        id,
        type: 'project',
    })
}
handleProject.bonsaiKeys = Object.keys(activityConf.properties)
handleProject.description = 'Create, update and fetch activity'
handleProject.eventName = 'project'
handleProject.params = [
    {
        name: 'id',
        required: true,
        type: TYPES.hash,
    },
    {
        description: 'If not an activity will return Activity by ID',
        ...activityConf,
        defaultValue: null,
        required: false,
    },
    {
        defaultValue: false,
        name: 'create',
        required: false,
        type: TYPES.boolean,
    },
    {
        name: 'callback',
        required: true,
        type: TYPES.function,
    },
]
handleProject.requireLogin = true
handleProject.result = activityConf
// handleProject.validationConf = {
//     description: {
//         required: true,
//         maxLength: 160,
//         minLength: 3,
//         type: TYPES.string,
//     },
//     id: {
//         required: true,
//         type: TYPES.hash,
//     },
//     name: {
//         maxLength: 64,
//         minLength: 3,
//         required: true,
//         type: TYPES.string,
//     },
//     ownerAddress: {
//         required: true,
//         type: TYPES.identity,
//     },

// }

/**
 * @name    handleProjectsByHashes
 * @summary Fetch Activties by IDs
 * 
 * @param   {String}    ids 
 * @param   {Function}  callback
 */
export const handleProjectsByHashes = async (ids, callback) => {
    // if (!isFn(callback)) return
    // if (!isArr(hashArr) || hashArr.length === 0) return callback(messages.arrayRequired)
    const result = await projects.getAll(ids)
    callback(null, Array.from(result))
}
handleProjectsByHashes.description = 'Fetch Activties by IDs'
handleProjectsByHashes.eventName = 'projects-by-hashes'
handleProjectsByHashes.params = [
    {
        minLength: 1,
        name: 'activityIds',
        required: true,
        type: TYPES.array,
    },
    {
        name: 'callback',
        required: true,
        type: TYPES.function,
    },
]
handleProjectsByHashes.result = {
    name: 'activities',
    type: 'map',
}

export const eventHandlers = {
    [handleProject.eventName]: handleProject,
    [handleProjectsByHashes.eventName]: handleProjectsByHashes,
}
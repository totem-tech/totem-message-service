import CouchDBStorage from './utils/CouchDBStorage'
import { isArr, isFn, isObj, objClean } from './utils/utils'
import { TYPES, validateObj } from './utils/validator'
import { authorizeData } from './blockchain'
import { setTexts } from './language'

const projects = new CouchDBStorage(null, 'projects')
// Must-have properties
const requiredKeys = ['name', 'ownerAddress', 'description']
// All the acceptable properties
const validKeys = [...requiredKeys]
// Internally managed keys : ['tsCreated']
const descMaxLen = 160
const messages = setTexts({
    accessDenied: 'Access denied',
    arrayRequired: 'Array required',
    bonsaiAuthFailed: 'BONSAI authentication failed',
    exists: 'Activity already exists. Please use a different combination of owner address, name and description.',
    loginRequired: 'You must be logged in to perform this action',
    projectNotFound: 'Activity not found',
})

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
    const { validationConf, validKeys } = handleProject
    let err = validateObj(
        { id, ...project },
        validationConf,
        true,
        true,
    )
    if (err) return callback(err)

    // exclude any unwanted data and only update the properties that's supplied
    project = objClean({ ...existingProject, ...project }, validKeys)

    // Authenticate using BONSAI
    err = await authorizeData(id, project)
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
    console.log(`Activity ${create ? 'created' : 'updated'}: ${id} `)
}
handleProject.requireLogin = true
handleProject.validationConf = {
    description: {
        required: true,
        maxLength: 160,
        minLength: 3,
        type: TYPES.string,
    },
    id: {
        required: true,
        type: TYPES.hash,
    },
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

}
handleProject.validKeys = Object.keys(handleProject.validationConf)

// user projects by list of project hashes
// Params
// @hashArr	array
// @callback	function: 
//						Params:
//						@err	string, 
//						@result map, 
export const handleProjectsByHashes = async (hashArr, callback) => {
    if (!isFn(callback)) return
    if (!isArr(hashArr) || hashArr.length === 0) return callback(messages.arrayRequired)

    let result = await projects.getAll(hashArr)
    const hashesNotFound = hashArr.filter(hash => !result.get(hash))
    callback(null, result, hashesNotFound)
}
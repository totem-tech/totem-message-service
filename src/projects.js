import CouchDBStorage from './CouchDBStorage'
import { isArr, isDefined, isFn, isObj, objClean } from './utils/utils'
import { authorizeData } from './blockchain'
import { setTexts } from './language'
import { getUserByClientId } from './users'

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
    invalidDescMaxLen: `Description must not exceed ${descMaxLen} characters`,
    loginRequired: 'You must be logged in to perform this action',
    projectInvalidKeys: `Activity must contain all of the following properties: ${requiredKeys.join()} and an unique hash`,
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
export async function handleProject(hash, project, create, callback) {
    const client = this
    if (!isFn(callback)) return;
    const existingProject = await projects.get(hash)
    if (create && !!existingProject) return callback(messages.exists)

    // return existing project
    if (!isObj(project)) return callback(
        !!existingProject ? null : messages.projectNotFound,
        existingProject
    )

    // check if user is logged in
    // getUserByClientId will return a user only when a user is logged in with client ID
    const user = await getUserByClientId(client.id)
    if (!user) return callback(messages.loginRequired)
    // // makes sure only the project owner can execute the update operation
    // const { userId } = existingProject || {}
    // if (!create && isDefined(userId) && user.id !== userId) return callback(messages.accessDenied)

    // check if project contains all the required properties
    const invalid = !hash || !project || requiredKeys.reduce((invalid, key) => invalid || !project[key], false)
    if (invalid) return callback(messages.projectInvalidKeys)
    if (project.description.length > descMaxLen) return callback(messages.invalidDescMaxLen)
    // exclude any unwanted data and only update the properties that's supplied
    project = objClean({ ...existingProject, ...project }, validKeys)

    // Authenticate using BONSAI
    const valid = await authorizeData(hash, project)
    if (!valid) return callback(messages.bonsaiAuthFailed)

    project.tsCreated = (existingProject || {}).createdAt || (new Date()).toISOString()
    project.tsUpdated = new Date().toISOString()

    // store user information
    if (create) {
        // created by user ID
        project.userId = user.id
    } else {
        project.updatedBy = user.id
    }

    // Add/update project
    await projects.set(hash, project)
    callback(null, project)
    console.log(`Activity ${create ? 'created' : 'updated'}: ${hash} `)
}

// user projects by list of project hashes
// Params
// @hashArr	array
// @callback	function: 
//						Params:
//						@err	string, 
//						@result map, 
export const handleProjectsByHashes = async (hashArr, callback) => {
    if (!isFn(callback)) return;
    if (!isArr(hashArr) || hashArr.length === 0) return callback(messages.arrayRequired)
    let result = await projects.getAll(hashArr)
    const hashesNotFound = hashArr.filter(hash => !result.get(hash))
    callback(null, result, hashesNotFound)
}
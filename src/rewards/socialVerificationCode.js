import { generateHash } from '../utils/utils'

/**
 * @name    generateCode
 * @summary generates user's social media handle verification code
 * 
 * @param   {String} userId 
 * @param   {String} platform 
 * @param   {String} handle 
 * 
 * @returns {String} hex string
 */
export default async function generateCode(userId, platform, handle) {
    handle = handle
        .split('@')
        .join('')
        .trim()
    const code = generateHash(
        `${userId}:${platform}:${handle}`,
        'blake2',
        32,
    )
    console.log({ userId, platform, handle, code })
    return code.substr(2) // get rid of 0x prefix
}
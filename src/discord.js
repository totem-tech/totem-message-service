/**
 * Send message to Discord channels using webhook
 */
import request from 'request'
const ERROR_URL = process.env.DISCORD_WEBHOOK_URL
const ERROR_AVATAR_URL = process.env.DISCORD_WEBHOOK_AVATAR_URL
const ERROR_USERNAME = process.env.DISCORD_WEBHOOK_USERNAME

export const logError = (message, callback) => {
    request({
        json: true,
        method: 'POST',
        timeout: 30000,
        url: ERROR_URL,
        body: {
            avatar_url: ERROR_AVATAR_URL,
            content,
            username: ERROR_USERNAME || 'Messaging Service Logger'
        }
    }, callback)
}

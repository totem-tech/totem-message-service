import { setTexts } from '../language'
import {
    isFn,
    isObj,
    isStr,
    objClean
} from '../utils/utils'
import { TYPES, validateObj } from '../utils/validator'
import {
    clients,
    dbUsers,
    idExists,
    log,
    onlineUsers,
    RESERVED_IDS,
    rxUserLoggedIn,
    rxUserRegistered,
    secretConf,
    userClientIds,
    userIdConf,
} from './users'

// Error messages
const messages = {
    alreadyRegistered: 'You have already registered! Please contact support for instructions if you wish to get a new user ID.',
    userIdTaken: 'User ID is taken',
}
setTexts(messages)
let signupCount = 0

/**
 * @name    handleRegister
 * @summary user registration event handler
 * 
 * @param   {String}            userId 
 * @param   {String}            secret 
 * @param   {String|Object}     referredBy          (optional) referrer user ID or social handle reference as following:
 *                                                      `${handle}@${platform}`
 *                                                  Example: 'twitter_user@twitter'
 * @param   {String}            referredBy.handle   Social media user identifier
 * @param   {String}            referredBy.platform Social media platform identitifier. Eg: 'twitter'
 * @param   {Function}  callback  args => @err string: error message if registration fails
 */
export default async function handleRegister(userId, secret, address, referredBy, callback) {
    if (!isFn(callback)) return

    const [client, user] = this
    // prevent already registered user's attempt to register again!
    if (!!user) return callback(messages.alreadyRegistered)

    if (isStr(referredBy) && referredBy.includes('@')) {
        const [handle, platform] = referredBy.split('@')
        referredBy = { handle, platform }
    }

    const tsCreated = new Date()
    const newUser = {
        address,
        id: userId,
        secret,
        socialHandles: {},
        tsCreated,
    }
    const conf = { ...handleRegister.validationConfig }
    // make sure users don't use themselves as referrer
    conf.referredBy = {
        ...conf.referredBy,
        reject: userId,
    }
    const err = validateObj(newUser, conf, true, true)
    if (err) return callback(err)

    // check if user ID already exists
    if (await idExists([userId])) return callback(messages.userIdTaken)

    if (isStr(referredBy)) {
        // direct referral by user ID
        const { _id } = await dbUsers.get(referredBy) || {}
        // removes referrer ID if referrer user not found
        referredBy = RESERVED_IDS.includes(_id)
            ? undefined
            : _id
    } else if (isObj(referredBy)) {
        /*
         * referrer validation not required as referral program is closed now
         */

        // Check if referrer user is valid and referrer's social handle has been verified
        // let referrer
        // let { handle, platform } = referredBy
        // handle = `${handle}`.toLowerCase()

        // if (platform === 'twitter') {
        //     // lowercase twitter handle search using custom view
        //     referrer = (await dbUsers.view('lowercase', 'twitterHandle', { key: handle }))[0]
        // } else {
        //     // referral through other platforms
        //     referrer = await dbUsers.find({
        //         [`socialHandles.${platform}.handle`]: handle,
        //         [`socialHandles.${platform}.verified`]: true
        //     })
        // }

        // ignore if referrer and referred user's address is the same
        // referredBy = !referrer || referrer.address === address
        //     ? undefined
        //     : {
        //         handle,
        //         platform,
        //         userId: referrer._id,
        //     }

        referredBy = objClean(referredBy, Object.keys(referredByObjConf.properties))
    } else {
        referredBy = undefined
    }
    newUser.referredBy = referredBy
    await dbUsers.set(userId, newUser)

    // attach userId to client object
    client.___userId = userId
    onlineUsers.set(userId, newUser)

    // add to websocket client list
    clients.set(client.id, client)

    // add client ID to user's clientId list
    log('New User registered:', JSON.stringify({ userId, referredBy }))
    console.log('signupCount:', ++signupCount)
    userClientIds.set(userId, [client.id])

    rxUserRegistered.next({
        address,
        clientId: client.id,
        userId,
        referredBy,
    })
    rxUserLoggedIn.next({
        address,
        clientId: client.id,
        clientIds: [client.id],
        userId,
    })
    callback(null)
}
const referredByObjConf = {
    properties: {
        handle: {
            maxLength: 64,
            minLegth: 3,
            required: true,
            type: TYPES.string,
        },
        platform: {
            accept: [
                'discord',
                'facebook',
                'instagram',
                'telegram',
                'twitter',
                'x', // Twitter's new name
                'whatsapp',
            ],
            maxLength: 32,
            minLegth: 3,
            required: true,
            type: TYPES.string,
        },
        userId: {
            ...userIdConf,
            required: false,
        },
    },
    required: false,
    type: TYPES.object,
}
handleRegister.description = 'New user registration.'
handleRegister.params = [
    userIdConf,
    secretConf,
    {
        name: 'address',
        type: TYPES.string,
    },
    {
        description: 'accepts either a string (user ID) or alternatively an object (see `or` property for details).',
        ...userIdConf,
        name: 'referredBy',
        required: false,
        or: referredByObjConf,
    },
    {
        name: 'callback',
        params: [
            { name: 'error', type: TYPES.string },
        ],
        required: true,
        type: TYPES.function,
    },
]
handleRegister.validationConfig = {
    id: userIdConf,
    referredBy: {
        description: 'accepts either a string (user ID) or alternatively an object (see `or` property for details).',
        ...userIdConf,
        required: false,
        or: {
            config: {
                handle: {
                    maxLength: 64,
                    minLegth: 3,
                    required: true,
                    type: TYPES.string,
                },
                platform: {
                    accept: [
                        'discord',
                        'facebook',
                        'instagram',
                        'telegram',
                        'twitter',
                        'x', // Twitter's new name
                        'whatsapp',
                    ],
                    maxLength: 32,
                    minLegth: 3,
                    required: true,
                    type: TYPES.string,
                },
                userId: {
                    ...userIdConf,
                    required: false,
                },
            },
            required: true,
            type: TYPES.object,
        },
    },
    secret: {
        minLegth: 10,
        maxLength: 64,
        type: TYPES.string,
    },
}

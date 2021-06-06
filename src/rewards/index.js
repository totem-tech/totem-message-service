import { sendNotification } from '../notification'
import { rxUserRegistered, users } from "../users"

const dbRewards = new CouchDBStorage(null, 'rewards')

// Listen for new user registrations and process referral and signup rewards
rxUserRegistered.subscribe(({ userId, referredBy }) => {
    // pay signup reward to the user

    // pay referral reward (if any)

    // notify referrer
    sendNotification(
        userId,
        [referredBy],
        'chat',
        'referralSuccess',
        null,
        null
    ).catch(err => {
        console.error('Failed to send notification to user referrer.', err)
        // ToDo: report incident 
    })

})
/*
rewards.set(
    'testUser',
    {
        signupReward: {
            amount: 9999,
            amountUSD: 9999,
            tsCreated: new Date().toISOString(),
        },
        socialRewards: [
            {
                amount: 9999,
                amountUSD: 9999,
                campaign: 'signup',
                platform: 'twitter',
                tsCreated: new Date().toISOString(),
            }
        ],
        appRewards: []
    }
)
rewards.set(
    'testUser',
    {
        amount: 9999,
        currency: 'TOTEM',
        type: 'signup-twitter',
        tsCreated: new Date().toISOString(),
        tsUpdated: new Date().toISOString(),
    }
)
*/
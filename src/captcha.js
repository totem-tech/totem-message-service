// import { setTexts } from "./language"
// import { users } from "./users"
// import { isFn, isStr } from "./utils/utils"

// const actions = [
//     // simple math operations
//     {
//         action: 'plus',
//         expect: 'equal',
//         getResult: (num1, num2) => num1 + num2,
//     },
//     {
//         action: 'minus',
//         expect: 'equal',
//         getResult: (num1, num2) => num1 - num2,
//     },
//     {
//         action: 'multiplied by',
//         expect: 'equal',
//         getResult: (num1, num2) => num1 * num2,
//     },
//     {
//         action: 'divided by',
//         expect: 'equal',
//         getResult: (num1, num2) => num1 / num2,
//     },
//     // boolean questions
//     {
//         action: 'is greater than',
//         expect: 'boolean',
//         getResult: (num1, num2) => num1 > num2,
//     },
//     {
//         action: 'is greater or equal',
//         expect: 'boolean',
//         getResult: (num1, num2) => num1 >= num2,
//     },
//     {
//         action: 'is smaller than',
//         expect: 'boolean',
//         getResult: (num1, num2) => num1 < num2,
//     },
//     {
//         action: 'is smaller or equal',
//         expect: 'boolean',
//         getResult: (num1, num2) => num1 <= num2,
//     },
// ]
// export const generateQuiz = async (userId) => {
//     if (!isStr(userId)) return

//     const user = await users.get(userId)
//     if (!user || user.human === true) return

//     const randomNum1 = parseInt(Math.random(20) * 20)
//     const randomNum2 = parseInt(Math.random(20) * 20)
//     const len = actions.length
//     const randomActionIndex = parseInt(Math.random(len) * len)
//     const { action, getResult } = actions[randomActionIndex] || {}

//     if (!action || !isFn(getResult)) throw new Error('Unexpected error occured while generating quiz!')

//     const question = `${randomNum1} ${action} ${randomNum2}`
//     const now = new Date().toISOString()
//     const human = {
//         action,
//         tsCreated: now,
//         tsUpdated: now,
//         values: [randomNum1, randomNum2],
//     }

//     // update user entry with the quiz for later verification
//     await users.set(userId, { human }, true, true)
//     return question
// }

// const verifyQuiz = user => {

// }

// export const handleCaptchaGet = async (result, callback) => {
//     const [client, user] = this
//     // if (result === null)
// }
// handleCaptchaGet.requireLogin = true
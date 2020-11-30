import { isFn } from '../utils/utils'

// ToDo: Change values
export const LEVEL_MULTIPLIERS = [
    1.0000,
    3.0000,
    5.0000,
    7.0000,
    9.0000,
    11.0000,
    13.0000,
    15.0000,
    17.0000,
]
export const LEVEL_ENTRY_USD = [
    0,
    100,
    1000 * 2,
    1000 * 5,
    1000 * 10,
    1000 * 15,
    1000 * 25,
    1000 * 50,
    1000 * 100,
]
// start of level 9 (negotiable multiplier)
export const Level_NEGOTIATE_Entry_USD = 1000 * 200

export const handleCrowdsaleConstants = callback => isFn(callback) && callback(null, {
    Level_NEGOTIATE_Entry_USD,
    LEVEL_MULTIPLIERS,
    LEVEL_ENTRY_USD,
})
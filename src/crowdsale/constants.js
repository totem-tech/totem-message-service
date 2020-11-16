import { isFn } from '../utils/utils'

// ToDo: Change values
export const RATIO2XTX = {
    BTC: 1442914053,
    DOT: 40327188,
    ETH: 396006,
}
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
export const LEVEL_ENTRY_XTX = [
    0,
    9082700,
    181654000,
    454135000,
    908270000,
    1362405000,
    2270675000,
    4541350000,
    9082700000,
]
// start of level 9 (negotiable multiplier)
export const ENTRY_NEGOTIATE_XTX = 90827000000

export const handleCrowdsaleConstants = callback => isFn(callback) && callback(null, {
    ENTRY_NEGOTIATE_XTX,
    LEVEL_MULTIPLIERS,
    LEVEL_ENTRY_XTX,
    RATIO2XTX,
})
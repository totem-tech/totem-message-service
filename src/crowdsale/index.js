import { handleCrowdsaleKyc } from './kyc'
import { handleCrowdsaleCheckDeposits, handleCrowdsaleDAA } from './depositAddress'
import { handleCrowdsaleConstants } from './constants'

export const handlers = {
    'crowdsale-check-deposits': handleCrowdsaleCheckDeposits,
    'crowdsale-constants': handleCrowdsaleConstants,
    'crowdsale-kyc': handleCrowdsaleKyc,
    'crowdsale-daa': handleCrowdsaleDAA,
}
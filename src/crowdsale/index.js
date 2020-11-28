import { handleCrowdsaleKyc } from './kyc'
import { handleCrowdsaleBalanceCheck, handleCrowdsaleDAA } from './depositAddress'
import { handleCrowdsaleConstants } from './constants'

export const handlers = {
    'crowdsale-check-balance': handleCrowdsaleBalanceCheck,
    'crowdsale-constants': handleCrowdsaleConstants,
    'crowdsale-kyc': handleCrowdsaleKyc,
    'crowdsale-daa': handleCrowdsaleDAA,
}
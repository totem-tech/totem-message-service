import { handleCrowdloan, handleCrowdloanPledgedTotal } from './crowdloan'

export const handlers = {
    'crowdloan': handleCrowdloan,
    'crowdloan-pledged-total': handleCrowdloanPledgedTotal
}
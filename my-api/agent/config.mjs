// every setting for the scraper and pipeline

import './env.mjs'

const env = process.env

export const config = {
    scraper: {
        // api url
        serverUrl: env.SERVER_URL ?? 'http://localhost:3000',
        maxPages: 5,
        searchPageAttempts: 3,
        // false for debug
        headless: env.HEADLESS !== 'false',
    },

    rules: {
        minPrice: 50,
    },

    triage: {
        model: env.OPENAI_TRIAGE_MODEL ?? 'gpt-5-nano',
        // only GENUINE_SALE above this confidence goes on to analysis
        minConfidence: 0.7,
        maxDescriptionLength: 3000,
    },

    analysis: {
        model: env.OPENAI_ANALYSIS_MODEL ?? 'gpt-5',
        // stops a confused agent looping forever
        recursionLimit: 20,
        // a car that can't be checked against its MOT record can't score above this
        unverifiedMaxScore: 6,
        minBuyScore: 7,
        maxDescriptionLength: 4000,
    },

    // Tools the analysis agent can use.

    tools: {
        mot: {
            // on automatically once the DVSA credentials are in .env. MOT_ENABLED=false forces it off.
            enabled: env.MOT_ENABLED !== 'false' && Boolean(env.MOT_API_KEY && env.MOT_CLIENT_ID && env.MOT_CLIENT_SECRET && env.MOT_TOKEN_URL),
        },
        photos: {
            enabled: env.PHOTOS_ENABLED !== 'false',
            model: env.OPENAI_PHOTO_MODEL ?? 'gpt-5-mini',
            maxImages: 8,
        },
        marketValue: {
            enabled: env.MARKET_VALUE_ENABLED !== 'false',
            // fewer comparable listings than this and the agent estimates the price itself
            minComparables: 3,
        },
    },

    matching: {
        // analysed cars with these recommendations get matched to users' filters
        recommendations: ['BUY', 'MAYBE'],
    },
}

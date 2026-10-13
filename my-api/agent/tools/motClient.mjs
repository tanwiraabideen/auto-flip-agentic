// client for DVSA API, no langchain here

// REQUIRES FOLLOWING .env VARs (waiting approval from DVSA)
//   MOT_CLIENT_ID, MOT_CLIENT_SECRET, MOT_API_KEY
//   MOT_TOKEN_URL 

const API_URL = 'https://history.mot.api.gov.uk/v1/trade/vehicles/registration'
const SCOPE = 'https://tapi.dvsa.gov.uk/.default'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

export const normaliseRegistration = (registration) => registration.toUpperCase().replace(/[^A-Z0-9]/g, '')


// DVSA's microsoft auth uses an access token. so we don't have to keep authenticating with secrets

let cachedToken = null
let tokenExpiresAt = 0

export async function getAccessToken() {
    // refresh a minute early so a token never expires halfway through a request
    if (cachedToken && Date.now() < tokenExpiresAt - 60 * 1000) {
        return cachedToken
    }

    const { MOT_TOKEN_URL, MOT_CLIENT_ID, MOT_CLIENT_SECRET } = process.env
    if (!MOT_TOKEN_URL || !MOT_CLIENT_ID || !MOT_CLIENT_SECRET) {
        throw new Error('MOT API credentials missing, set MOT_TOKEN_URL, MOT_CLIENT_ID and MOT_CLIENT_SECRET in .env')
    }

    const res = await fetch(MOT_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: MOT_CLIENT_ID,
            client_secret: MOT_CLIENT_SECRET,
            scope: SCOPE,
        }),
    })
    if (!res.ok) {
        throw new Error(`Failed to get MOT API token (${res.status}): ${await res.text()}`)
    }

    const data = await res.json()
    cachedToken = data.access_token
    tokenExpiresAt = Date.now() + data.expires_in * 1000
    return cachedToken
}

export async function getMotHistory(registration, attempt = 1) {
    const reg = normaliseRegistration(registration)
    if (!process.env.MOT_API_KEY) {
        throw new Error('MOT API key missing, set MOT_API_KEY in .env')
    }

    const res = await fetch(`${API_URL}/${reg}`, {
        headers: {
            Authorization: `Bearer ${await getAccessToken()}`,
            'X-API-Key': process.env.MOT_API_KEY,
        },
    })

    if (res.status === 404) {
        return null
    }

    // 429 means too many requests. wait and retry
    if (res.status === 429 && attempt <= 2) {
        await sleep(2000 * attempt)
        return getMotHistory(registration, attempt + 1)
    }

    // 401 means token rejected so access token probs expired
    if (res.status === 401 && attempt === 1) {
        cachedToken = null
        return getMotHistory(registration, attempt + 1)
    }

    if (!res.ok) {
        throw new Error(`MOT API request failed (${res.status}): ${await res.text()}`)
    }
    return res.json()
}

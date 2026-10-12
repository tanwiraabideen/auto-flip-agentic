// check simple rules before spending on analysis. If car failes, analysis status set to REJECTED_RULES, so we never analayse but we keep it in the db

export const MIN_PRICE = 50

const JUNK_DESCRIPTION_PATTERN = /\b(breaking(?!\s+(system|assist|pads?|discs?)\b)|for\s+parts|wanted)\b/i

// returns { pass: true, reason: null } or { pass: false, reason: why the car was rejected }
export function checkRules(car) {
    const descriptionMatch = car.description?.match(JUNK_DESCRIPTION_PATTERN)
    if (descriptionMatch) {
        return { pass: false, reason: `description contains "${descriptionMatch[0]}"` }
    }

    if (!car.imageUrls?.length) {
        return { pass: false, reason: 'no images' }
    }

    if (car.price < MIN_PRICE) {
        return { pass: false, reason: `price £${car.price} is under £${MIN_PRICE}` }
    }

    return { pass: true, reason: null }
}

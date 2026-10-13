// get_market_value tool - checks db for similar cars

import { tool } from '@langchain/core/tools'
import { MarketValueInput } from '../schemas.mjs'
import { prisma } from '../db.mjs'
import { config } from '../config.mjs'

// if not this many comparables, it's pointless
const { minComparables } = config.tools.marketValue

const median = (numbers) => {
    const sorted = [...numbers].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

const formatPrice = (price) => `£${price.toLocaleString('en-GB')}`

// find price and mileage of comparable listings
export async function getMarketValue({ make, model, year, excludeListingId }) {
    return prisma.cars.findMany({
        where: {
            make: { equals: make, mode: 'insensitive' },
            model: { equals: model, mode: 'insensitive' },
            // +- 1 year
            ...(year ? { year: { gte: year - 1, lte: year + 1 } } : {}),
            analysisStatus: { notIn: ['REJECTED_RULES', 'REJECTED_TRIAGE'] },
            ...(excludeListingId ? { id: { not: excludeListingId } } : {}),
        },
        select: { price: true, mileage: true },
    })
}

export const getMarketValueTool = tool(
    async ({ make, model, year, excludeListingId }) => {
        try {
            const comparables = await getMarketValue({ make, model, year, excludeListingId })
            const yearRange = year ? `, ${year - 1}-${year + 1}` : ''

            if (comparables.length < minComparables) {
                return `Only ${comparables.length} comparable listings for ${make} ${model}${yearRange}, not enough for a reliable typical price. ` +
                    'Estimate the typical value from your own knowledge of UK used car prices, and lower your confidence.'
            }

            const prices = comparables.map(car => car.price)
            const mileages = comparables.map(car => car.mileage).filter(mileage => mileage != null)
            return [
                `${comparables.length} comparable listings for ${make} ${model}${yearRange}.`,
                `Median asking price: ${formatPrice(median(prices))} (range ${formatPrice(Math.min(...prices))} to ${formatPrice(Math.max(...prices))}).`,
                mileages.length ? `Median mileage: ${median(mileages).toLocaleString('en-GB')}.` : 'Mileage: not known for these listings.',
                'These are asking prices, cars usually sell for a little less. Adjust for mileage if this car is well above or below the median.',
            ].join('\n')
        } catch (error) {
            return `Could not get market value: ${error.message}`
        }
    },
    {
        name: 'get_market_value',
        description: 'Looks up the asking prices of similar cars (same make and model, a year either side) from other Gumtree listings. ' +
            'Returns the median price and range, to judge whether this car is cheap or expensive.',
        schema: MarketValueInput,
    }
)

// Runs the analysis agent and prints the results. Doesn't save anything yet. From my-api/:
//   node scripts/runAnalysis.mjs --id 12      <- one specific car
//   node scripts/runAnalysis.mjs --limit 3    <- the next 3 cars that passed triage
import { prisma } from '../agent/db.mjs'
import { analyseListing } from '../agent/analysisAgent.mjs'

const args = process.argv.slice(2)
const argValue = (name) => {
    const index = args.indexOf(name)
    return index === -1 ? undefined : parseInt(args[index + 1], 10)
}
const id = argValue('--id')
const limit = argValue('--limit') ?? 1

const select = { id: true, make: true, model: true, year: true, price: true, mileage: true, location: true, description: true, imageUrls: true }

try {
    const cars = id
        ? await prisma.cars.findMany({ where: { id }, select })
        // passed triage = still PENDING but has a triage category (only GENUINE_SALE gets through)
        : await prisma.cars.findMany({ where: { analysisStatus: 'PENDING', triageCategory: 'GENUINE_SALE' }, orderBy: { id: 'asc' }, take: limit, select })

    if (cars.length === 0) {
        console.log('No cars to analyse.')
    }

    for (const car of cars) {
        console.log(`\n===== #${car.id} ${car.year ?? ''} ${car.make} ${car.model}, £${car.price} =====`)
        try {
            const { analysis, toolCalls } = await analyseListing(car)
            console.log('Tools used:')
            for (const call of toolCalls) {
                // image URL lists are long, just show how many
                const args = call.args.imageUrls ? { imageUrls: `${call.args.imageUrls.length} urls` } : call.args
                console.log(`  ${call.tool} ${JSON.stringify(args)}`)
            }
            console.log(JSON.stringify(analysis, null, 2))
        } catch (error) {
            console.log(`Analysis failed: ${error.message}`)
        }
    }
} finally {
    await prisma.$disconnect()
}

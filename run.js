// runs the whole pipeline:
//   - scrape new Gumtree listings (saved as PENDING)
//   - for every PENDING car: rules -> triage -> analysis -> filter matches

// takes --skip-scrape (run pipeline on cars in the db)
// takes --limit (run on the first x pending cars)

// ATM scraping runs and then the analysis runs, maybe make them run in parallel?

import fetchNewData from './webScraping.js'
import { checkRules } from './ruleFilter.js'
import { matchesFilter } from './filterMatch.js'
import { prisma } from './my-api/agent/db.mjs'
import { triageListing, passesTriage } from './my-api/agent/triage.mjs'
import { analyseListing } from './my-api/agent/analysisAgent.mjs'
import { traceable, flushTraces } from './my-api/agent/tracing.mjs'
import { config } from './my-api/agent/config.mjs'




// wrapped in traceable() below, so each car is one LangSmith trace with its triage and agent run inside
const processListing = traceable(async function processListing({ car, filters }) {
    // regex check
    const rules = checkRules(car)
    if (!rules.pass) {
        await prisma.cars.update({ where: { id: car.id }, data: { analysisStatus: 'REJECTED_RULES' } })
        console.log(`  rejected by rules: ${rules.reason}`)
        return 'rejectedRules'
    }

    // triage
    if (!car.triageCategory) {
        const triage = await triageListing({
            description: car.description,
            price: car.price,
            makeModel: `${car.make} ${car.model}`,
            mileage: car.mileage,
        })
        const passed = passesTriage(triage)

        await prisma.cars.update({
            where: { id: car.id },
            data: {
                triageCategory: triage.category,
                triageConfidence: triage.confidence,
                triageReason: triage.reason,
                analysisStatus: passed ? 'PENDING' : 'REJECTED_TRIAGE',
            },
        })
        console.log(`  triage: ${triage.category} (${triage.confidence}) - ${triage.reason}`)
        if (!passed) {
            return 'rejectedTriage'
        }
    }

    // analysis agent

    await prisma.cars.update({ where: { id: car.id }, data: { analysisStatus: 'ANALYSING' } })

    const { analysis, toolCalls } = await analyseListing(car)
    console.log(`  tools used: ${toolCalls.map(call => call.tool).join(' -> ') || 'none'}`)
    console.log(`  analysis: ${analysis.score}/10 ${analysis.recommendation} (${analysis.confidence} confidence)`)

    const analysisData = {
        score: analysis.score,
        recommendation: analysis.recommendation,
        summary: analysis.summary,
        redFlags: analysis.redFlags,
        positives: analysis.positives,
        confidence: analysis.confidence,
        registration: analysis.registration,
    }
    await prisma.$transaction([
        prisma.listingAnalysis.upsert({
            where: { listingId: car.id },
            create: { listingId: car.id, ...analysisData },
            update: analysisData,
        }),
        prisma.cars.update({ where: { id: car.id }, data: { analysisStatus: 'DONE' } }),
    ])

    // check against filters (maybe change flow, do we need to spend tokens on cars that don't even match filters?)
    if (config.matching.recommendations.includes(analysis.recommendation)) {
        const matchingFilters = filters.filter(filter => matchesFilter(car, filter))
        if (matchingFilters.length) {
            // skipDuplicates: the FilterListing id is (filterId, listingId), so re-running never creates a second match
            await prisma.filterListing.createMany({
                data: matchingFilters.map(filter => ({ filterId: filter.id, listingId: car.id })),
                skipDuplicates: true,
            })
            console.log(`  matched ${matchingFilters.length} filter(s): ${matchingFilters.map(filter => filter.id).join(', ')}`)
        }
    }
    return 'done'
}, {
    name: 'process-listing',
    // only log the car's key details as the trace input, not the whole filter list
    processInputs: ({ car }) => ({ id: car.id, make: car.make, model: car.model, year: car.year, price: car.price, url: car.url }),
})


async function runPipeline({ limit } = {}) {
    const summary = { rejectedRules: 0, rejectedTriage: 0, done: 0, failed: 0, otherErrors: 0 }

    // try again for cars stuck in analysing
    const reset = await prisma.cars.updateMany({ where: { analysisStatus: 'ANALYSING' }, data: { analysisStatus: 'PENDING' } })
    if (reset.count) {
        console.log(`Reset ${reset.count} car(s) left in ANALYSING by a previous run`)
    }

    const filters = await prisma.filters.findMany()
    const cars = await prisma.cars.findMany({
        where: { analysisStatus: 'PENDING' },
        orderBy: { id: 'asc' },
        take: limit,
    })
    console.log(`\nProcessing ${cars.length} pending car(s) against ${filters.length} filter(s)`)

    for (const car of cars) {
        console.log(`\n#${car.id} ${car.year ?? ''} ${car.make} ${car.model}, £${car.price}`)
        try {
            const outcome = await processListing({ car, filters })
            summary[outcome]++
        } catch (error) {
            console.log(`  error: ${error.message}`)
            // FAILED if error in analysis
            try {
                const { count } = await prisma.cars.updateMany({
                    where: { id: car.id, analysisStatus: 'ANALYSING' },
                    data: { analysisStatus: 'FAILED' },
                })
                summary[count ? 'failed' : 'otherErrors']++
            } catch (updateError) {
                console.log(`  couldn't update status: ${updateError.message}`)
                summary.otherErrors++
            }
        }
    }

    console.log(`\nPipeline finished: ${JSON.stringify(summary)}`)
    return summary
}


const args = process.argv.slice(2)
const skipScrape = args.includes('--skip-scrape')
const limitIndex = args.indexOf('--limit')
const limit = limitIndex === -1 ? undefined : parseInt(args[limitIndex + 1], 10)

try {
    if (!skipScrape) {
        await fetchNewData() // run the scraper if no skip-scrape flag
    }
    await runPipeline({ limit })
    await flushTraces()
    await prisma.$disconnect()
    process.exit(0)
} catch (error) {
    console.error(error)
    await flushTraces()
    await prisma.$disconnect()
    process.exit(1)
}

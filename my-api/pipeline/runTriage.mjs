// triages every car that's still PENDING and hasn't been triaged yet.
// runs after every scrape
import { fileURLToPath } from 'url'
import { PrismaClient } from '../generated/prisma/index.js'
import { withAccelerate } from '@prisma/extension-accelerate'
import dotenv from 'dotenv'
import { triageListing, passesTriage } from './triage.mjs'

// load my-api/.env even when this is imported from the scraper's folder
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

// how many OpenAI requests run at once
const CONCURRENCY = 5

export async function runTriage({ limit, dryRun = false } = {}) {
    const prisma = new PrismaClient().$extends(withAccelerate())
    const summary = { passed: 0, rejected: 0, failed: 0 }

    try {
        const cars = await prisma.cars.findMany({
            where: { analysisStatus: 'PENDING', triageCategory: null },
            orderBy: { id: 'asc' },
            take: limit,
            select: { id: true, description: true, price: true, make: true, model: true, mileage: true },
        })
        console.log(`Triaging ${cars.length} cars${dryRun ? ' (dry run, nothing will be saved)' : ''}`)

        for (let i = 0; i < cars.length; i += CONCURRENCY) {
            await Promise.all(cars.slice(i, i + CONCURRENCY).map(async (car) => {
                try {
                    const result = await triageListing({
                        description: car.description,
                        price: car.price,
                        makeModel: `${car.make} ${car.model}`.trim(),
                        mileage: car.mileage,
                    })
                    const passed = passesTriage(result)
                    console.log(`#${car.id} ${passed ? 'PASS' : 'REJECT'} ${result.category} (${result.confidence}) - ${result.reason}`)

                    if (!dryRun) {
                        await prisma.cars.update({
                            where: { id: car.id },
                            data: {
                                triageCategory: result.category,
                                triageConfidence: result.confidence,
                                triageReason: result.reason,
                                analysisStatus: passed ? 'PENDING' : 'REJECTED_TRIAGE',
                            },
                        })
                    }
                    summary[passed ? 'passed' : 'rejected']++
                } catch (error) {
                    console.log(`#${car.id} triage failed, will retry next run: ${error.message}`)
                    summary.failed++
                }
            }))
        }
    } finally {
        await prisma.$disconnect()
    }

    console.log(`Triage finished: ${JSON.stringify(summary)}`)
    return summary
}

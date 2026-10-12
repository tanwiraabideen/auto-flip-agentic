// a script that runs the initial non-llm filter check on current cars in the db

import { PrismaClient } from '../generated/prisma/index.js';
import { withAccelerate } from '@prisma/extension-accelerate';
import dotenv from 'dotenv';
import { checkRules } from '../../ruleFilter.js';

dotenv.config();

const apply = process.argv.includes('--apply')
const prisma = new PrismaClient().$extends(withAccelerate());

try {
    const cars = await prisma.cars.findMany({
        where: { analysisStatus: 'PENDING' },
        select: { id: true, url: true, description: true, imageUrls: true, price: true },
    })

    const rejected = cars
        .map(car => ({ car, ...checkRules(car) }))
        .filter(({ pass }) => !pass)

    for (const { car, reason } of rejected) {
        console.log(`#${car.id} ${reason} - ${car.url}`)
    }
    console.log(`\n${rejected.length} of ${cars.length} pending cars fail the rules.`)

    if (!apply) {
        console.log('Dry run, nothing changed. Re-run with --apply to update the db.')
    } else if (rejected.length) {
        const ids = rejected.map(({ car }) => car.id)
        const [removedMatches, updated] = await prisma.$transaction([
            prisma.filterListing.deleteMany({ where: { listingId: { in: ids } } }),
            prisma.cars.updateMany({ where: { id: { in: ids } }, data: { analysisStatus: 'REJECTED_RULES' } }),
        ])
        console.log(`Marked ${updated.count} cars REJECTED_RULES and removed ${removedMatches.count} filter matches.`)
    }
} finally {
    await prisma.$disconnect()
}

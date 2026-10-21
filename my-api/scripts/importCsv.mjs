// loads old listings from data/Cars.csv into the db so get_market_value has comparables

// cars are saved as IMPORTED, so run.js never triages or analyses them

import { readFileSync } from 'fs'
import { prisma } from '../agent/db.mjs'
import { checkRules } from '../../ruleFilter.js'

const BATCH_SIZE = 500

const apply = process.argv.includes('--apply')

function parseCsv(text) {
    const rows = []
    let row = []
    let field = ''
    let quoted = false
    for (let i = 0; i < text.length; i++) {
        const char = text[i]
        if (quoted) {
            if (char === '"' && text[i + 1] === '"') { field += '"'; i++ }
            else if (char === '"') quoted = false
            else field += char
        } else if (char === '"') {
            quoted = true
        } else if (char === ',') {
            row.push(field)
            field = ''
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[i + 1] === '\n') i++
            row.push(field)
            rows.push(row)
            row = []
            field = ''
        } else {
            field += char
        }
    }
    if (field || row.length) {
        row.push(field)
        rows.push(row)
    }
    const [header, ...data] = rows
    return data.map(values => Object.fromEntries(header.map((key, i) => [key, values[i]])))
}

const toDate = (value) => value ? new Date(`${value.replace(' ', 'T')}Z`) : null
const toInt = (value) => value ? parseInt(value, 10) : null

const rows = parseCsv(readFileSync(new URL('../data/Cars.csv', import.meta.url), 'utf8'))

const cars = rows.map(row => {
    const car = {
        id: toInt(row.id),
        url: row.url || null,
        make: row.make,
        model: row.model,
        description: row.description,
        imageUrls: row.imageUrl ? [row.imageUrl] : [],
        price: toInt(row.price),
        timePosted: toDate(row.timePosted),
        location: row.location,
        mileage: toInt(row.mileage),
        year: toInt(row.year),
        timeAddedToDataBase: toDate(row.timeAddedToDataBase) ?? new Date(),
    }
    const rules = checkRules({ ...car, imageUrls: ['skip the image rule'] })
    return { ...car, analysisStatus: rules.pass ? 'IMPORTED' : 'REJECTED_RULES' }
})

try {
    const existing = await prisma.cars.findMany({ where: { id: { in: cars.map(car => car.id) } }, select: { id: true } })
    const existingIds = new Set(existing.map(car => car.id))
    const toImport = cars.filter(car => !existingIds.has(car.id))

    console.log(`${cars.length} cars in the csv, ${existingIds.size} already in the db.`)
    console.log(`Importing ${toImport.length}: ${toImport.filter(car => car.analysisStatus === 'IMPORTED').length} IMPORTED, ` +
        `${toImport.filter(car => car.analysisStatus === 'REJECTED_RULES').length} REJECTED_RULES.`)

    if (!apply) {
        console.log('Dry run, nothing changed. Re-run with --apply to write to the db.')
    } else {
        let created = 0
        for (let i = 0; i < toImport.length; i += BATCH_SIZE) {
            const result = await prisma.cars.createMany({ data: toImport.slice(i, i + BATCH_SIZE), skipDuplicates: true })
            created += result.count
            process.stdout.write(`\r${created}/${toImport.length} imported`)
        }
        process.stdout.write('\n')

        await prisma.$queryRawUnsafe(`SELECT setval(pg_get_serial_sequence('"Cars"', 'id'), (SELECT MAX(id) FROM "Cars"))`)
        console.log('Id sequence moved past the imported ids.')
    }
} finally {
    await prisma.$disconnect()
}

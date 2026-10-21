// runs evaluation pipeline on labelled dataset of 90 cars

// LangSmith trace for each listing

// takes --skip-analysis                to test triage only
// takes --label junk/bad/good          only evals cars with this label

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { checkRules } from '../../ruleFilter.js'
import { prisma } from '../agent/db.mjs'
import { triageListing, passesTriage } from '../agent/triage.mjs'
import { analyseListing } from '../agent/analysisAgent.mjs'
import { traceable, flushTraces } from '../agent/tracing.mjs'

const CONCURRENCY = 3

const args = process.argv.slice(2)
const skipAnalysis = args.includes('--skip-analysis')
const labelIndex = args.indexOf('--label')
const onlyLabel = labelIndex === -1 ? null : args[labelIndex + 1]

const dataset = JSON.parse(readFileSync(new URL('./dataset.json', import.meta.url)))
    .filter(item => !onlyLabel || item.label === onlyLabel)



const evaluateItem = traceable(async function evaluateItem(item) {
    const car = item.listing
    const result = { id: item.id, label: item.label, rules: checkRules(car) }

    try {
        result.triage = await triageListing({
            description: car.description,
            price: car.price,
            makeModel: `${car.make} ${car.model}`,
            mileage: car.mileage,
        })
        result.triagePass = passesTriage(result.triage)
    } catch (error) {
        result.triageError = error.message
        return result
    }

    result.pipelinePass = result.rules.pass && result.triagePass
    if (result.pipelinePass && !skipAnalysis) {
        try {
            const { analysis, toolCalls } = await analyseListing(car)
            result.analysis = analysis
            result.toolCalls = toolCalls.map(call => call.tool)
        } catch (error) {
            result.analysisError = error.message
        }
    }
    return result
}, {
    name: 'eval-listing',
    project_name: 'auto-flip-eval',
    tags: ['eval'],
    processInputs: (item) => ({ id: item.id, label: item.label, expectedCategories: item.expectedCategories, note: item.note }),
})

// runs fn on every item, a few at a time
async function mapWithConcurrency(items, limit, fn) {
    const results = []
    for (let i = 0; i < items.length; i += limit) {
        results.push(...await Promise.all(items.slice(i, i + limit).map(fn)))
        process.stdout.write(`\r${results.length}/${items.length} done`)
    }
    process.stdout.write('\n')
    return results
}


// helpers

const pct = (part, whole) => whole ? `${part}/${whole} (${Math.round(part / whole * 100)}%)` : 'n/a'
const mean = (numbers) => numbers.length ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length : null
const round1 = (n) => n == null ? 'n/a' : n.toFixed(1)
const countBy = (values) => values.reduce((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {})

// the share of (good, bad) pairs where the good car scored higher. 100% = perfectly separated, 50% = no better than chance.
function pairwiseRanking(goodScores, badScores) {
    if (!goodScores.length || !badScores.length) return null
    let wins = 0
    for (const good of goodScores) {
        for (const bad of badScores) {
            wins += good > bad ? 1 : good === bad ? 0.5 : 0
        }
    }
    return wins / (goodScores.length * badScores.length)
}


// run and export

console.log(`Evaluating ${dataset.length} listings${skipAnalysis ? ' (triage only)' : ''}...`)
const byId = Object.fromEntries(dataset.map(item => [item.id, item]))
let results
try {
    results = await mapWithConcurrency(dataset, CONCURRENCY, evaluateItem)
} finally {
    await flushTraces()
    await prisma.$disconnect()
}

console.log('\nlabel  id     car                            price    rules  triage                       score  rec    conf    tools')
for (const r of results) {
    const item = byId[r.id]
    const car = `${item.listing.year} ${item.listing.make} ${item.listing.model}`.slice(0, 30).padEnd(30)
    const triageCorrect = r.triagePass === item.expectedTriagePass
    const triage = r.triageError
        ? `ERROR ${r.triageError}`.slice(0, 28)
        : `${triageCorrect ? '✓' : '✗'} ${r.triage.category} ${r.triage.confidence}`
    const analysis = r.analysis
        ? `${String(r.analysis.score).padEnd(5)}  ${r.analysis.recommendation.padEnd(5)}  ${r.analysis.confidence.padEnd(6)}  ${r.toolCalls.join(' > ')}`
        : r.analysisError ? `ERROR ${r.analysisError}` : '-'
    console.log(`${r.label.padEnd(5)}  ${String(r.id).padEnd(5)}  ${car} £${String(item.listing.price).padEnd(7)} ${(r.rules.pass ? 'pass' : 'REJ').padEnd(5)}  ${triage.padEnd(28)} ${analysis}`)
}

// triage accuracy: did it pass genuine sales and reject junk?
const triaged = results.filter(r => !r.triageError)
const junk = triaged.filter(r => r.label === 'junk')
const genuine = triaged.filter(r => r.label !== 'junk')
const triageCorrect = triaged.filter(r => r.triagePass === byId[r.id].expectedTriagePass)
const junkCategoryCorrect = junk.filter(r => byId[r.id].expectedCategories.includes(r.triage.category))

console.log('\n===== TRIAGE')
console.log(`accuracy (pass/reject):     ${pct(triageCorrect.length, triaged.length)}`)
console.log(`  junk rejected:            ${pct(junk.filter(r => !r.triagePass).length, junk.length)}`)
console.log(`  genuine sales passed:     ${pct(genuine.filter(r => r.triagePass).length, genuine.length)}`)
console.log(`junk category exactly right: ${pct(junkCategoryCorrect.length, junk.length)}`)
for (const r of triaged.filter(r => r.triagePass !== byId[r.id].expectedTriagePass)) {
    console.log(`  ✗ #${r.id} (${r.label}) got ${r.triage.category} ${r.triage.confidence}: ${r.triage.reason}`)
}
if (results.some(r => r.triageError)) {
    console.log(`  ${results.filter(r => r.triageError).length} triage call(s) errored and aren't counted`)
}

// the rules and triage together, as the real pipeline runs them
console.log('\n===== RULES + TRIAGE (the real pipeline)')
console.log(`rules caught junk:          ${pct(results.filter(r => r.label === 'junk' && !r.rules.pass).length, results.filter(r => r.label === 'junk').length)}`)

const ruleReasons = countBy(results.filter(r => r.label === 'junk' && !r.rules.pass).map(r => r.rules.reason.replace(/".*"/, '"…"').replace(/£\d+/, '£…')))
for (const [reason, count] of Object.entries(ruleReasons)) {
    console.log(`  ${count} by: ${reason}`)
}
console.log(`rules wrongly rejected:     ${pct(results.filter(r => r.label !== 'junk' && !r.rules.pass).length, results.filter(r => r.label !== 'junk').length)} genuine sales`)
for (const r of results.filter(r => r.label !== 'junk' && !r.rules.pass)) {
    console.log(`  ✗ #${r.id} (${r.label}) rejected by rules: ${r.rules.reason}`)
}
console.log(`junk stopped by either:     ${pct(junk.filter(r => !r.pipelinePass).length, junk.length)}`)
console.log(`genuine reaching analysis:  ${pct(genuine.filter(r => r.pipelinePass).length, genuine.length)}`)

// score spread: do good deals score higher than overpriced cars?
if (!skipAnalysis) {
    const analysed = results.filter(r => r.analysis)
    const scoresFor = (label) => analysed.filter(r => r.label === label).map(r => r.analysis.score)
    const goodScores = scoresFor('good')
    const badScores = scoresFor('bad')

    console.log('\n===== SCORES')
    for (const [label, scores] of [['good', goodScores], ['bad', badScores], ['junk', scoresFor('junk')]]) {
        if (!scores.length) continue
        const recommendations = countBy(analysed.filter(r => r.label === label).map(r => r.analysis.recommendation))
        console.log(`${label.padEnd(5)} n=${scores.length}  mean ${round1(mean(scores))}  min ${Math.min(...scores)}  max ${Math.max(...scores)}  ` +
            `scores [${[...scores].sort((a, b) => a - b).join(', ')}]  ${JSON.stringify(recommendations)}`)
    }
    if (goodScores.length && badScores.length) {
        console.log(`separation (good mean - bad mean): ${round1(mean(goodScores) - mean(badScores))}`)
        console.log(`good scored above bad:             ${Math.round(pairwiseRanking(goodScores, badScores) * 100)}% of pairs (50% = chance)`)
    }
    const confidence = countBy(analysed.map(r => r.analysis.confidence))
    console.log(`confidence: ${JSON.stringify(confidence)}${confidence.LOW ? '  (LOW = unverified, so capped at 6. Expected until the MOT key is set up.)' : ''}`)
    if (results.some(r => r.analysisError)) {
        console.log(`${results.filter(r => r.analysisError).length} analysis run(s) errored`)
    }
}

// keep the raw results so runs can be compared after prompt changes
const resultsDir = new URL('./results/', import.meta.url)
mkdirSync(resultsDir, { recursive: true })
const file = new URL(`./${new Date().toISOString().replace(/[:.]/g, '-')}.json`, resultsDir)
writeFileSync(file, JSON.stringify(results, null, 2))
console.log(`\nRaw results saved to eval/results/${file.pathname.split('/').pop()}`)

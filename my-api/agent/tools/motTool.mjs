// get_mot_history tool the analysis agent can call.

import { tool } from '@langchain/core/tools'
import { MotHistoryInput } from '../schemas.mjs'
import { getMotHistory, normaliseRegistration } from './motClient.mjs'
import { config } from '../config.mjs'

const { rollbackToleranceMiles } = config.tools.mot

// regex to group advisories  (maybe remove because we want model to do judgment)
const ADVISORY_GROUPS = {
    'rust/corrosion': /corro|rust/i,
    'brakes': /brake/i,
    'tyres': /tyre/i,
    'suspension': /suspension|shock absorber|spring|bush|ball joint/i,
    'exhaust': /exhaust/i,
    'oil leak': /oil leak/i,
    'steering': /steering/i,
}

const formatDate = (date) => date ? new Date(date).toLocaleDateString('en-GB') : 'unknown'


// turning the raw DVSA res into summary for model (save tokens)
export function summariseMotHistory(vehicle) {
    const lines = []

    lines.push(`Vehicle: ${vehicle.make} ${vehicle.model}, ${vehicle.primaryColour}, ${vehicle.fuelType}`)
    lines.push(`First registered: ${formatDate(vehicle.firstUsedDate ?? vehicle.registrationDate)}`)

    const tests = [...(vehicle.motTests ?? [])].sort((a, b) => new Date(a.completedDate) - new Date(b.completedDate))

    if (tests.length === 0) {
        lines.push('No MOT tests on record, the car is probably under 3 years old.')
        return lines.join('\n')
    }

    const latest = tests[tests.length - 1]
    lines.push(`Latest MOT: ${latest.testResult} on ${formatDate(latest.completedDate)}, expires ${formatDate(latest.expiryDate)}`)

    // mileage readings. and check if there is rollback
    const readings = tests
        .filter(test => test.odometerResultType === 'READ' && test.odometerValue)
        .map(test => ({ date: test.completedDate, miles: parseInt(test.odometerValue, 10), unit: test.odometerUnit?.toLowerCase() ?? 'mi' }))

    lines.push(`Mileage readings: ${readings.map(r => `${formatDate(r.date)} ${r.miles.toLocaleString('en-GB')}${r.unit}`).join(', ') || 'none'}`)

    // small drops are typos or retests, so they're reported but not called a rollback
    const rollbacks = []
    const smallDrops = []
    for (let i = 1; i < readings.length; i++) {
        const drop = readings[i - 1].miles - readings[i].miles
        if (drop <= 0) continue
        const text = `${readings[i - 1].miles.toLocaleString('en-GB')} -> ${readings[i].miles.toLocaleString('en-GB')} on ${formatDate(readings[i].date)}`
        if (drop > rollbackToleranceMiles) rollbacks.push(text)
        else smallDrops.push(text)
    }
    lines.push(rollbacks.length ? `MILEAGE ROLLBACK DETECTED: ${rollbacks.join('; ')}` : 'Mileage rollback: none')
    if (smallDrops.length) {
        lines.push(`Small mileage drops of ${rollbackToleranceMiles} miles or less, most likely a recording error or retest, not a rollback: ${smallDrops.join('; ')}`)
    }

    // fails
    const failCount = tests.filter(test => test.testResult === 'FAILED').length
    lines.push(`Tests: ${tests.length} total, ${failCount} failed`)

    // recurring advisories: in how many tests each problem group showed up
    const groupCounts = {}
    for (const test of tests) {
        const advisoryText = (test.defects ?? [])
            .filter(defect => defect.type === 'ADVISORY' || defect.type === 'MINOR')
            .map(defect => defect.text)
            .join(' ')

        for (const [group, pattern] of Object.entries(ADVISORY_GROUPS)) {
            if (pattern.test(advisoryText)) {
                groupCounts[group] = (groupCounts[group] ?? 0) + 1
            }
        }
    }
    const topGroups = Object.entries(groupCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    lines.push(`Recurring advisories: ${topGroups.map(([group, count]) => `${group} (${count} test${count === 1 ? '' : 's'})`).join(', ') || 'none'}`)

    // the latest test's actual defect text, since that's the car's current condition
    const latestDefects = (latest.defects ?? []).map(defect => `- [${defect.type}] ${defect.text}`)
    if (latestDefects.length) {
        lines.push('Latest test defects:', ...latestDefects.slice(0, 10))
    }

    return lines.join('\n')
}

// LangChain tool has function, name+desc, input structure


export const getMotHistoryTool = tool(
    async ({ registration }) => {
        const reg = normaliseRegistration(registration)
        try {
            const vehicle = await getMotHistory(reg)
            if (!vehicle) {
                return `No MOT record found for ${reg}. The registration may be wrong, or the car may be too new for an MOT.`
            }
            return summariseMotHistory(vehicle)
        } catch (error) {
            return `Could not get MOT history for ${reg}: ${error.message}`
        }
    },
    {
        name: 'get_mot_history',
        description: 'Looks up the official DVSA MOT history for a UK car by its registration. ' +
            'Returns the make and model on record, the latest MOT result and expiry, mileage readings over time ' +
            'with a check for mileage rollback, the number of failed tests and recurring advisories.',
        schema: MotHistoryInput,
    }
)

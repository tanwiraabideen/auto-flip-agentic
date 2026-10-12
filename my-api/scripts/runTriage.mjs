// Run triage on its own. From my-api/:
//   node scripts/runTriage.mjs --dry-run --limit 5   <- try it on a few cars without saving
//   node scripts/runTriage.mjs                       <- triage every untriaged PENDING car
import { runTriage } from '../pipeline/runTriage.mjs'

const args = process.argv.slice(2)
const limitIndex = args.indexOf('--limit')

await runTriage({
    dryRun: args.includes('--dry-run'),
    limit: limitIndex === -1 ? undefined : parseInt(args[limitIndex + 1], 10),
})

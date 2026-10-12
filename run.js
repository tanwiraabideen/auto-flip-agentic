import fetchNewData from './webScraping.js'
import { runTriage } from './my-api/pipeline/runTriage.mjs'

fetchNewData()
    .then(() => runTriage())
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

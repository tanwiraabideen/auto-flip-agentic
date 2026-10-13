// LangSmith tracing. Switched on by these in my-api/.env:
//   LANGSMITH_TRACING=true
//   LANGSMITH_API_KEY=lsv2_...
//   LANGSMITH_PROJECT=auto-flip
// With LANGSMITH_TRACING unset everything here does nothing, so the pipeline runs the same either way.
//
// Every LangChain call (models, tools, the agent loop) is traced automatically once it's on.
// traceable() wraps one of our own functions so that everything it calls is grouped under it,
// e.g. one trace per car with the triage call and the whole agent run inside it.
import './env.mjs'
import { Client } from 'langsmith'
import { traceable as langsmithTraceable } from 'langsmith/traceable'
import { awaitAllCallbacks } from '@langchain/core/callbacks/promises'

const client = new Client()

export const traceable = (fn, options) => langsmithTraceable(fn, { client, ...options })

// traces are uploaded in the background. Call this before process.exit() or the last few are lost.
export async function flushTraces() {
    await awaitAllCallbacks()
    await client.awaitPendingTraceBatches()
}

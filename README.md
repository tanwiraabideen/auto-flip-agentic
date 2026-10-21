# Auto-Flip Agentic

An AI pipeline that finds used cars worth flipping. It scrapes new car listings from Gumtree, throws out the junk, and uses an LLM agent to score each remaining car as a resale opportunity. Cars that look like good deals are matched against users' saved search filters.

## How it works

Every listing goes through a funnel. Each stage is more expensive than the last, so cheap checks run first and only promising cars reach the full agent.

```
Gumtree ──► 1. Scrape ──► 2. Rule filter ──► 3. LLM triage ──► 4. Analysis agent ──► 5. Filter matching
            (Puppeteer)   (regex, no LLM)    (cheap model)     (tool-using agent)    (user filters)
```

1. **Scrape** (`webScraping.js`): Puppeteer works through the newest Gumtree car search pages and pulls the price, mileage, year, location, description and photos from each listing. Make and model come from the breadcrumbs, matched against `gumtree-car-data.json`. Listings are saved through the API with status `PENDING`. URLs already in the database are skipped.
2. **Rule filter** (`ruleFilter.js`): plain checks that cost nothing. A listing is rejected (`REJECTED_RULES`) if it has no photos, is priced under £50, or its description says "breaking", "for parts" or "wanted".
3. **Triage** (`my-api/agent/triage.mjs`): a cheap model (`gpt-5-nano` by default) puts the ad into one category: `GENUINE_SALE`, `SPARES_OR_REPAIRS`, `BREAKING_FOR_PARTS`, `WANTED_AD`, `WRITE_OFF`, `SCAM_SUSPECTED` or `NOT_A_CAR`. Only a `GENUINE_SALE` with confidence of 0.6 or more moves on, so write-offs of any category are rejected. Everything else is marked `REJECTED_TRIAGE`.
4. **Analysis agent** (`my-api/agent/analysisAgent.mjs`): a LangChain agent (`gpt-5` by default) that decides for itself which tools to call and in what order:
   - `analyse_photos`: a vision model reads the number plate and body colour, and looks for major damage.
   - `get_mot_history`: looks up the official DVSA MOT history by registration. It checks for mileage rollback, failed tests and recurring advisories, and whether the make, model and colour match the listing.
   - `get_market_value`: finds the median asking price of similar cars already in the database (same make and model, one year either side).

   The agent scores the car out of 10 using a fixed rubric (price against market value, MOT history, damage) and returns a recommendation (`BUY` / `MAYBE` / `AVOID`), a confidence level, a summary, red flags and positives. A car that can't be checked against an MOT record is "unverified" and can't score above 6.
5. **Filter matching** (`filterMatch.js`): `BUY` and `MAYBE` cars are checked against every user's saved filter (make, model, price, year and mileage ranges). Each match is recorded in `FilterListing`.

Each listing's `analysisStatus` tracks where it got to: `PENDING → ANALYSING → DONE`, or `REJECTED_RULES`, `REJECTED_TRIAGE` or `FAILED`. Cars left in `ANALYSING` by a crashed run go back to `PENDING` on the next run. Old listings loaded from `my-api/data/Cars.csv` are `IMPORTED`: they only serve as market value comparables and are never analysed.

## Project structure

```
.
├── run.js                  # runs the whole pipeline (scrape, then process every PENDING car)
├── webScraping.js          # Gumtree scraper
├── ruleFilter.js           # non-LLM rule checks
├── filterMatch.js          # matches a car against a user filter
├── gumtree-car-data.json   # Gumtree's list of makes and models
└── my-api/
    ├── server.js           # Express API over the database (port 3000)
    ├── prisma/             # database schema and migrations (PostgreSQL)
    ├── agent/
    │   ├── config.mjs      # every setting for the scraper and pipeline
    │   ├── triage.mjs      # stage-one LLM classifier
    │   ├── analysisAgent.mjs
    │   ├── schemas.mjs     # zod schemas for model outputs and tool inputs
    │   ├── tracing.mjs     # optional LangSmith tracing
    │   ├── db.mjs, env.mjs
    │   └── tools/          # photo, MOT (DVSA client + tool) and market value tools
    ├── scripts/
    │   ├── applyRuleFilter.mjs   # apply the rule filter to cars already in the db
    │   ├── runAnalysis.mjs       # run the agent on chosen cars and print the result
    │   └── importCsv.mjs         # load data/Cars.csv as market value comparables
    └── eval/
        ├── dataset.json    # 90 labelled listings (30 junk, 30 good, 30 bad)
        └── runEval.mjs     # measures triage accuracy and score separation
```

## Tech stack

- **Node.js** (ES modules), **Puppeteer** for scraping
- **Express** API, **Prisma** with **PostgreSQL** (via Prisma Accelerate)
- **LangChain** with **OpenAI** models, **zod** for structured output
- **LangSmith** for tracing (optional)
- **DVSA MOT History API** for vehicle checks

## Setup

### 1. Install dependencies

```bash
npm install            # scraper and pipeline (root)
cd my-api
npm install            # API and agent
npx prisma generate    # builds the Prisma client into my-api/generated/prisma
npx prisma migrate deploy
```

### 2. Environment variables

Create `my-api/.env`. The pipeline loads this file wherever it's run from.

```bash
# Database (required)
DATABASE_URL=...            # Prisma Accelerate connection string
DIRECT_URL=...              # direct PostgreSQL connection, used for migrations

# OpenAI (required)
OPENAI_API_KEY=sk-...

# DVSA MOT History API (optional). The MOT tool switches on once all four are set.
MOT_CLIENT_ID=...
MOT_CLIENT_SECRET=...
MOT_API_KEY=...
MOT_TOKEN_URL=...

# LangSmith tracing (optional)
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_PROJECT=auto-flip
```

Optional overrides:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SERVER_URL` | `http://localhost:3000` | API the scraper saves listings to |
| `HEADLESS` | `true` | set to `false` to watch the browser while scraping |
| `OPENAI_TRIAGE_MODEL` | `gpt-5-nano` | triage model |
| `OPENAI_ANALYSIS_MODEL` | `gpt-5` | analysis agent model |
| `OPENAI_PHOTO_MODEL` | `gpt-5-mini` | vision model for photos |
| `MOT_ENABLED` / `PHOTOS_ENABLED` / `MARKET_VALUE_ENABLED` | on | set to `false` to turn a tool off |

Other settings (pages to scrape, minimum price, confidence thresholds, score cap) are in `my-api/agent/config.mjs`. The agent's system prompt is built from this config, so it is only told about the tools that are switched on.

## Usage

Start the API first. The scraper saves listings through it:

```bash
cd my-api
npm run dev
```

Then, from the project root, run the pipeline:

```bash
npm run scrape                       # scrape Gumtree, then process every PENDING car
node run.js --skip-scrape            # only process cars already in the database
node run.js --skip-scrape --limit 5  # only process the first 5 pending cars
```

Helper scripts (run from `my-api/`):

```bash
node scripts/runAnalysis.mjs --id 12      # run the agent on one car and print the result (saves nothing)
node scripts/runAnalysis.mjs --limit 3    # the next 3 cars that passed triage
node scripts/applyRuleFilter.mjs          # dry run of the rule filter on pending cars
node scripts/applyRuleFilter.mjs --apply  # actually mark failing cars REJECTED_RULES
node scripts/importCsv.mjs                # dry run of loading data/Cars.csv
node scripts/importCsv.mjs --apply        # load it (as IMPORTED, skipping ids already in the db)
```

## API

`my-api/server.js` serves the database on port 3000:

| Method | Route | Description |
| --- | --- | --- |
| GET | `/listings` | all listings |
| GET | `/listings/:id` | one listing with its analysis |
| GET | `/listings/:id/analysis` | a listing's analysis |
| POST | `/listings` | create a listing (used by the scraper) |
| GET | `/cars/user/:userId` | every car matched to a user's filters, best score first |
| GET | `/filters` | all filters |
| GET | `/filters/:id` | one filter |
| GET | `/filters/user/:userId` | a user's filters |
| POST | `/filters` | create a filter |
| DELETE | `/filters/delete/:id` | delete a filter |
| POST | `/filterListing` | record a filter/car match |
| POST | `/user` | create a user |
| GET | `/user/:clerkId` | look up a user by Clerk id |

## Evaluation

`my-api/eval/dataset.json` holds 90 hand-labelled listings: 30 **junk** (should be rejected: spares or repairs, write-offs, breakers, wanted ads), 30 **good** deals and 30 **bad** (overpriced) cars. Good and bad are judged against the median price of the same make and model, both for the exact year and a year either side. The eval runs the rules, triage and agent on each one and reports:

- triage accuracy: junk rejected, genuine sales let through
- how much junk the rule filter and triage catch together
- score separation: mean score for good cars against bad ones, and the share of good/bad pairs where the good car scored higher (50% is chance)

```bash
cd my-api
node eval/runEval.mjs                   # full eval
node eval/runEval.mjs --skip-analysis   # triage only (cheap)
node eval/runEval.mjs --label good      # only one label
```

Raw results are saved to `my-api/eval/results/` (ignored by git), so runs can be compared after prompt changes. With LangSmith on, each listing is traced under the `auto-flip-eval` project.

## Notes

- Market value only uses listings already in the database, so it gets more accurate as more cars are scraped. With fewer than 3 comparables the agent estimates the price itself.

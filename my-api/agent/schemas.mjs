// every zod schema the agent uses, in one place
//
// model output schemas: the shape a model must reply in (used with withStructuredOutput / responseFormat)
// tool input schemas:   the arguments the agent must fill in to call a tool
import { z } from 'zod'


// ---------- model output schemas ----------

// keep in sync with the TriageCategory enum in prisma/schema.prisma
export const TRIAGE_CATEGORIES = [
    'GENUINE_SALE',
    'SPARES_OR_REPAIRS',
    'BREAKING_FOR_PARTS',
    'WANTED_AD',
    'WRITE_OFF',
    'SCAM_SUSPECTED',
    'NOT_A_CAR',
]

// triage.mjs
export const TriageResult = z.object({
    category: z.enum(TRIAGE_CATEGORIES).describe('The category that best describes the advert'),
    confidence: z.number().min(0).max(1).describe('How sure you are of the category, from 0 to 1'),
    reason: z.string().describe('One short sentence explaining why you chose the category'),
})

// tools/photoTool.mjs
export const PhotoAnalysis = z.object({
    plate: z.string().nullable()
        .describe('The UK number plate exactly as shown, e.g. "AB12 CDE". null if no plate is readable (hidden, blurred, cropped or too small).'),
    plateConfidence: z.number().min(0).max(1)
        .describe('How sure you are that the plate is read correctly, from 0 to 1. Use 0 if plate is null.'),
    colour: z.string()
        .describe('Main body colour in one or two words, e.g. "Blue", "Dark Grey"'),
    majorDamage: z.array(z.string())
        .describe('Each major problem seen, with where it is, e.g. "Crumpled front wing and bonnet". An empty list if none.'),
})

// analysisAgent.mjs
export const AnalysisResult = z.object({
    score: z.number().int().min(0).max(10).describe('Final score out of 10, worked out with the scoring rubric'),
    recommendation: z.enum(['BUY', 'MAYBE', 'AVOID']),
    summary: z.string().describe('Three or four sentences: what the car is, how it scored and why'),
    redFlags: z.array(z.string()).describe('Every problem found, one short sentence each. An empty list if none.'),
    positives: z.array(z.string()).describe('Every good point found, one short sentence each. An empty list if none.'),
    registration: z.string().nullable().describe('The registration used for the MOT check, e.g. "AB12CDE", or null if none was found'),
    confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']).describe('How much the score can be trusted, see the confidence rules'),
})


// ---------- tool input schemas ----------

// tools/motTool.mjs
export const MotHistoryInput = z.object({
    registration: z.string().describe('UK registration plate, e.g. "AB12 CDE"'),
})

// tools/photoTool.mjs
export const PhotoInput = z.object({
    imageUrls: z.array(z.string()).describe('The listing photo URLs, copied exactly'),
})

// tools/valuationTool.mjs
export const MarketValueInput = z.object({
    make: z.string().describe('Make as shown in the listing, e.g. "Ford"'),
    model: z.string().describe('Model as shown in the listing, e.g. "Focus"'),
    year: z.number().int().nullable().describe('Year of the car, or null if unknown'),
    excludeListingId: z.number().int().nullable().describe('The id of the listing being analysed, so it isn\'t compared with itself'),
})

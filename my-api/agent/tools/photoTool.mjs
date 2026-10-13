// analyse_photos tool that calls a model to analyse image

// reads the number plate and colour, and looks for major damage

import { tool } from '@langchain/core/tools'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { PhotoAnalysis, PhotoInput } from '../schemas.mjs'
import { config } from '../config.mjs'

// every photo costs tokens, and the first few (front, back, sides, interior) are usually enough
const { model, maxImages } = config.tools.photos

const SYSTEM_PROMPT = `You inspect photos from UK used car adverts for someone who buys cars to resell.
Advert photos are usually small and taken to flatter the car, so you can only spot big problems. Report only what you can clearly see.

Number plate:
- Read it from any photo where it's clear. UK plates look like "AB12 CDE" (current), "A123 BCD" (older) or a private plate.
- If the plate is blurred, covered, cropped or too small to read every character, return null. A wrong plate is worse than none.
- Only read the plate of the car being sold, not cars in the background.

Major damage: only report problems that are obvious in the photos, such as
- crash damage: crumpled or pushed-in panels, a bent bumper or bonnet, misaligned panels
- cracked or smashed windscreen, windows or lights
- missing panels, bumpers, wheels or doors
- deployed airbags, fire or flood damage
- rust holes in the bodywork
Don't report scratches, stone chips, scuffs, small dents, kerbed wheels or general wear. They can't be judged from advert photos.`


let structuredModel = null
function getModel() {
    structuredModel ??= new ChatOpenAI({
        model,
    }).withStructuredOutput(PhotoAnalysis, { name: 'photo_analysis' })
    return structuredModel
}

export async function analysePhotos(imageUrls) {
    const urls = [...new Set(imageUrls)]
        .filter(url => url.startsWith('https://'))
        .slice(0, maxImages)

    if (urls.length === 0) {
        throw new Error('no usable image URLs')
    }

    const message = new HumanMessage({
        content: [
            { type: 'text', text: `Here are ${urls.length} photos from one car advert.` },
            ...urls.map(url => ({ type: 'image_url', image_url: { url, detail: 'high' } })),
        ],
    })

    return getModel().invoke([new SystemMessage(SYSTEM_PROMPT), message])
}


// tool

export const analysePhotosTool = tool(
    // like get_mot_history, always return a string so a failure doesn't stop the main agent
    async ({ imageUrls }) => {
        try {
            const result = await analysePhotos(imageUrls)
            return JSON.stringify(result)
        } catch (error) {
            return `Could not analyse photos: ${error.message}`
        }
    },
    {
        name: 'analyse_photos',
        description: 'Inspects the listing photos with a vision model. Returns the number plate (if readable) with a confidence, ' +
            'the body colour, and any major damage such as crash damage or broken glass. ' +
            'Use the plate with get_mot_history, and compare the colour with the MOT record.',
        schema: PhotoInput,
    }
)

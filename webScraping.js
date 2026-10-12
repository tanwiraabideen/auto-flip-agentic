"use server"

import { createRequire } from 'module'
import puppeteer from "puppeteer";
import { checkRules } from './ruleFilter.js'

const SERVER_URL = process.env.SERVER_URL ?? "http://192.168.1.101:3000"
const MAX_PAGES_TO_SCRAPE = 5
const MAX_SEARCH_PAGE_ATTEMPTS = 3

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const require = createRequire(import.meta.url)
const carData = require('./gumtree-car-data.json')

const makes = Object.values(carData).map(make => make.name).sort((a, b) => b.length - a.length)


// parsing helpers

const minutesAgoToISO = (minutesAgo) => new Date(Date.now() - minutesAgo * 60 * 1000).toISOString()

const UNIT_MINUTES = { second: 1 / 60, sec: 1 / 60, minute: 1, min: 1, hour: 60, hr: 60, day: 1440, week: 10080, month: 43200 }

// turn gumtree labels like 'just now' or '5 minutes ago' into ISO format
function parseTimePosted(text) {
    if (!text) return null
    const lower = text.toLowerCase()

    if (/\bnow\b/.test(lower)) return minutesAgoToISO(0)
    if (lower.includes('yesterday')) return minutesAgoToISO(UNIT_MINUTES.day)

    const match = lower.match(/(\d+|an?)\s*(second|sec|minute|min|hour|hr|day|week|month)/)
    if (!match) return null

    const amount = /^\d+$/.test(match[1]) ? parseInt(match[1], 10) : 1
    return minutesAgoToISO(amount * UNIT_MINUTES[match[2]])
}

// "£12,500" -> 12500, "£12,500.00" -> 12500, "POA" / missing -> null
function parsePrice(text) {
    const match = text?.match(/\d[\d,]*(\.\d+)?/)
    if (!match) return null
    return Math.round(parseFloat(match[0].replace(/,/g, '')))
}

// "45,000 miles" -> 45000, "2015 (15 reg)" -> 2015, missing / "Unlisted" -> null
function parseInteger(text) {
    const value = parseInt(text?.replace(/,/g, ''), 10)
    return Number.isNaN(value) ? null : value
}


function splitMakeAndModel(breadcrumbs) {
    for (let i = breadcrumbs.length - 1; i >= 0; i--) {
        const upperCrumb = breadcrumbs[i].toUpperCase()
        const make = makes.find(make => {
            const upperMake = make.toUpperCase()
            return upperCrumb === upperMake || upperCrumb.startsWith(`${upperMake} `)
        })

        if (make) {
            const model = breadcrumbs[i].substring(make.length).trim() || breadcrumbs[i + 1] || ''
            return { make, model }
        }
    }
    return null
}

// getting url so we can check duplicates
function normaliseUrl(href) {
    const url = new URL(href)
    url.search = ''
    url.hash = ''
    return url.toString()
}


// filter check

const normaliseText = (value) => String(value ?? '').toLowerCase().replace(/[_-]/g, ' ').trim()
const isWildcard = (value) => value == null || value === '' || normaliseText(value) === 'any'

const withinRange = (value, min, max) => {
    if (min != null && (value == null || value < min)) return false
    if (max != null && (value == null || value > max)) return false
    return true
}

function matchesFilter(listing, filter) {
    return withinRange(listing.price, filter.minPrice, filter.maxPrice) &&
        withinRange(listing.year, filter.minYear, filter.maxYear) &&
        withinRange(listing.mileage, filter.minMileage, filter.maxMileage) &&
        (isWildcard(filter.make) || normaliseText(filter.make) === normaliseText(listing.make)) &&
        (isWildcard(filter.model) || normaliseText(filter.model) === normaliseText(listing.model))
}


// API helpers

async function apiRequest(path, options = {}) {
    const res = await fetch(`${SERVER_URL}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers },
    })
    if (!res.ok) {
        throw new Error(`${options.method ?? 'GET'} ${path} failed with ${res.status}: ${await res.text()}`)
    }
    return res.json()
}


// scraping

// clicks "Accept" on the cookie banner if one shows up. The banner is sometimes inside an iframe,
// so every frame is checked. Once accepted the cookie lasts for the rest of the browser session.
async function acceptCookies(page) {
    const deadline = Date.now() + 10000

    while (Date.now() < deadline) {
        for (const frame of page.frames()) {
            const clicked = await frame.evaluate(() => {
                const button = document.querySelector('#onetrust-accept-btn-handler') ??
                    Array.from(document.querySelectorAll('button')).find(button => /^\s*accept( all)?( cookies)?\s*$/i.test(button.innerText))
                if (!button) return false
                button.click()
                return true
            }).catch(() => false)

            if (clicked) {
                console.log('Accepted cookies')
                await sleep(1000)
                return true
            }
        }
        await sleep(500)
    }

    console.log('No cookie banner found')
    return false
}

// returns the listing URLs on a search page, or null if the page couldn't be loaded after retrying
let cookiesAccepted = false
async function getListingUrls(page, pageNum) {
    const searchUrl = `https://www.gumtree.com/search?search_category=cars&search_location=uk&sort=date&page=${pageNum}`

    for (let attempt = 1; attempt <= MAX_SEARCH_PAGE_ATTEMPTS; attempt++) {
        try {
            await page.goto(searchUrl, { waitUntil: "domcontentloaded" })
            if (!cookiesAccepted) {
                cookiesAccepted = await acceptCookies(page)
            }
            // no tag name in the selector: gumtree moved data-q='search-result' from an <article> to a <div>
            await page.waitForSelector("[data-q='search-result']")

            return await page.evaluate(() => {
                const urls = []
                document.querySelectorAll("[data-q='search-result']").forEach((listing) => {
                    const link = listing.querySelector("a[data-q='search-result-anchor']") ?? listing.querySelector("a[href*='/p/']")
                    if (link) {
                        urls.push(link.href)
                    }
                })
                return urls
            })
        } catch (error) {
            console.log(`Failed to load search page ${pageNum} (attempt ${attempt}/${MAX_SEARCH_PAGE_ATTEMPTS}): ${error}`)
            // saved so you can see what the page actually looked like when it failed
            await page.screenshot({ path: `debug-search-page-${pageNum}.png` }).catch(() => {})
            if (attempt < MAX_SEARCH_PAGE_ATTEMPTS) {
                console.log('Sleeping for 2 mins before retrying')
                await sleep(1000 * 120)
            }
        }
    }
    return null
}

// pulls the raw text off a listing page. All parsing happens back in Node.
async function scrapeListingPage(page, listingUrl) {
    await page.goto(listingUrl, { waitUntil: "domcontentloaded" })

    return page.evaluate(() => {
        const getText = (selector) => document.querySelector(selector)?.innerText?.trim() || null

        const attributes = {}
        document.querySelectorAll("[data-q='car-attributes-name']").forEach((nameElement) => {
            const row = nameElement.closest('li') ?? nameElement.parentElement
            const value = row?.querySelector("[data-q='car-attributes-value']")?.innerText?.trim()
            const name = nameElement.innerText?.trim()
            if (name && value) {
                attributes[name] = value
            }
        })

        const breadcrumbs = Array.from(document.querySelectorAll("li.breadcrumbs-link a.link"))
            .map(link => link.innerText?.trim())
            .filter(Boolean)

        // all gallery images. Only look inside the list holding the first image so a "similar ads"
        // carousel further down the page doesn't add other cars' photos
        const getLargestSrc = (img) => {
            const srcsetEntries = (img.getAttribute('srcset') || img.dataset.srcset || '')
                .split(',')
                .map(entry => entry.trim().split(/\s+/))
                .filter(([url]) => url)
            if (srcsetEntries.length) {
                // srcset entries look like "url 800w", so take the widest
                srcsetEntries.sort((a, b) => (parseInt(b[1], 10) || 0) - (parseInt(a[1], 10) || 0))
                return srcsetEntries[0][0]
            }
            // lazy loaded images keep the real url in a data attribute until they're scrolled into view
            return img.dataset.src || img.dataset.lazy || img.currentSrc || img.src
        }

        const firstGalleryImage = document.querySelector("[role='listitem'] img")
        const gallery = firstGalleryImage?.closest("[role='list']") ?? firstGalleryImage?.parentElement
        const galleryImages = gallery ? Array.from(gallery.querySelectorAll("[role='listitem'] img")) : []
        const imageUrls = [...new Set(
            galleryImages
                .map(getLargestSrc)
                .filter(url => url && !url.startsWith('data:'))
                .map(url => new URL(url, document.baseURI).href)
        )]

        return {
            imageUrls,
            description: getText("[itemprop='description']"),
            price: getText("[data-q='ad-price']"),
            location: getText("[data-q='ad-location']"),
            timePosted: getText("[data-q='Posted-value']"),
            year: attributes['Year'] ?? null,
            mileage: attributes['Mileage'] ?? null,
            breadcrumbs,
        }
    })
}

// turns raw page text into a Cars record
function buildListing(raw, listingUrl) {
    const makeModel = splitMakeAndModel(raw.breadcrumbs)
    if (!makeModel) {
        return { error: `couldn't find a make in breadcrumbs ${JSON.stringify(raw.breadcrumbs)}` }
    }

    const price = parsePrice(raw.price)
    if (price == null) {
        return { error: `no price found (got ${JSON.stringify(raw.price)})` }
    }

    return {
        listing: {
            url: listingUrl,
            make: makeModel.make,
            model: makeModel.model,
            description: raw.description ?? '',
            imageUrls: raw.imageUrls,
            price,
            timePosted: parseTimePosted(raw.timePosted),
            location: raw.location ?? '',
            mileage: parseInteger(raw.mileage),
            year: parseInteger(raw.year),
        }
    }
}

export default async function fetchNewData() {
    const summary = { added: 0, rejected: 0, skipped: 0, failed: 0, matches: 0 }

    const filters = await apiRequest('/filters')
    if (!Array.isArray(filters)) {
        throw new Error(`Expected an array of filters, got ${JSON.stringify(filters)}`)
    }
    console.log(`Found ${filters.length} filters.`)

    const existingListings = await apiRequest('/listings')
    const seenUrls = new Set(existingListings.filter(listing => listing.url).map(listing => normaliseUrl(listing.url)))
    console.log(`Found ${seenUrls.size} listings already in the db.`)

    let browser = null
    try {
        browser = await puppeteer.launch({
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
    } catch (error) {
        throw new Error(`Error when opening puppeteer: ${error}`)
    }

    try {
        const page = await browser.newPage();

        for (let pageNum = 1; pageNum <= MAX_PAGES_TO_SCRAPE; pageNum++) {
            const listingUrls = await getListingUrls(page, pageNum)
            if (!listingUrls) {
                console.log(`Skipping search page ${pageNum}, it never loaded`)
                continue
            }

            for (const rawUrl of listingUrls) {
                const listingUrl = normaliseUrl(rawUrl)

                if (seenUrls.has(listingUrl)) {
                    summary.skipped++
                    continue
                }
                seenUrls.add(listingUrl)

                try {
                    console.log(`Starting to scrape listing, ${listingUrl}`)
                    const raw = await scrapeListingPage(page, listingUrl)
                    const { listing, error } = buildListing(raw, listingUrl)

                    if (error) {
                        console.log(`Skipping ${listingUrl}: ${error}`)
                        summary.skipped++
                    } else {
                        // junk ads are still saved so they aren't scraped again, but are marked rejected
                        const rules = checkRules(listing)
                        if (!rules.pass) {
                            console.log(`Rejected by rules (${rules.reason}): ${listingUrl}`)
                            listing.analysisStatus = 'REJECTED_RULES'
                        }

                        console.log(`Adding following listing to db: ${JSON.stringify(listing)}`)
                        const savedListing = await apiRequest('/listings', {
                            method: 'POST',
                            body: JSON.stringify(listing),
                        })

                        if (!rules.pass) {
                            summary.rejected++
                            await sleep(6000)
                            continue
                        }
                        summary.added++

                        // checking if new listing matches any filters
                        for (const filter of filters.filter(filter => matchesFilter(listing, filter))) {
                            try {
                                console.log(`FOUND A MATCH for filter ${filter.id}`)
                                await apiRequest('/filterListing', {
                                    method: 'POST',
                                    body: JSON.stringify({ filterId: filter.id, listingId: savedListing.id }),
                                })
                                summary.matches++
                            } catch (err) {
                                console.log(`Error when adding filter-car match: ${err}`)
                            }
                        }
                    }
                } catch (error) {
                    console.log(`Error when scraping ${listingUrl}: ${error}`)
                    summary.failed++
                }
                await sleep(6000)
            }
        }
    } finally {
        await browser.close()
    }

    console.log(`Scrape finished: ${JSON.stringify(summary)}`)
    return summary
}

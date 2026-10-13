// loads my-api/.env into process.env. Import this first in any file that reads env vars when it loads.
// Uses this file's location, so it works whether you run from my-api/ or the project root.
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

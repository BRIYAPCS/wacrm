#!/usr/bin/env node
// ============================================================
// scripts/setup.mjs — assisted first-time setup for a new deployment.
//
//   npm run setup
//
// What it does (all idempotent + safe to re-run):
//   1. Ensures a `.env` exists (copies from .env.local.example if not).
//   2. Generates the two secrets you shouldn't hand-pick:
//        ENCRYPTION_KEY          (64 hex, AES-256-GCM)  — ONLY if missing.
//        AUTOMATION_CRON_SECRET  (32-byte hex)          — ONLY if missing.
//   3. Reports which REQUIRED values are still placeholders, and prints
//      the next steps.
//
// It NEVER overwrites a real ENCRYPTION_KEY — rotating that orphans every
// stored WhatsApp/AI token — so on re-run it leaves a valid key alone.
// ============================================================

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_PATH = join(repoRoot, '.env')
const EXAMPLE_PATH = join(repoRoot, '.env.local.example')

const B = (s) => `\x1b[1m${s}\x1b[0m`
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`
const DIM = (s) => `\x1b[2m${s}\x1b[0m`

// ---- 1. ensure .env exists ----
if (!existsSync(ENV_PATH)) {
  if (existsSync(EXAMPLE_PATH)) {
    copyFileSync(EXAMPLE_PATH, ENV_PATH)
    console.log(`\n${GREEN('✓')} Created .env from .env.local.example`)
  } else {
    writeFileSync(ENV_PATH, '')
    console.log(`\n${GREEN('✓')} Created an empty .env`)
  }
} else {
  console.log(`\n${DIM('· .env already exists — leaving your values in place')}`)
}

let lines = readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)

// Return the current value of KEY from an UNCOMMENTED assignment, or null.
function getVal(key) {
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '').trim()
  }
  return null
}

// Set KEY=value — replace an existing (commented or uncommented) line, else append.
function setVal(key, value) {
  const re = new RegExp(`^\\s*#?\\s*${key}\\s*=`)
  const idx = lines.findIndex((l) => re.test(l))
  const assignment = `${key}=${value}`
  if (idx >= 0) lines[idx] = assignment
  else {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('')
    lines.push(assignment)
  }
}

const PLACEHOLDER = /^$|your-|YOUR-|<[^>]+>|generate-a|example\.com|\[YOUR-PASSWORD\]/

// ---- 2. generate secrets (only if missing/placeholder) ----
const generated = []

const encKey = getVal('ENCRYPTION_KEY')
const encValid = encKey && /^[0-9a-f]{64}$/i.test(encKey)
if (!encValid) {
  if (encKey && !PLACEHOLDER.test(encKey)) {
    console.log(
      `\n${YELLOW('!')} ENCRYPTION_KEY is set but not 64 hex chars — leaving it ` +
        `alone (change it by hand only if you know every token will need re-saving).`,
    )
  } else {
    setVal('ENCRYPTION_KEY', randomBytes(32).toString('hex'))
    generated.push('ENCRYPTION_KEY')
  }
}

const cron = getVal('AUTOMATION_CRON_SECRET')
if (!cron || PLACEHOLDER.test(cron)) {
  setVal('AUTOMATION_CRON_SECRET', randomBytes(32).toString('hex'))
  generated.push('AUTOMATION_CRON_SECRET')
}

writeFileSync(ENV_PATH, lines.join('\n'))
if (generated.length) {
  console.log(`${GREEN('✓')} Generated: ${generated.join(', ')}`)
}

// ---- 3. validate required values + report ----
const REQUIRED = [
  ['NEXT_PUBLIC_SUPABASE_URL', 'Supabase → Settings → API'],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'Supabase → Settings → API'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'Supabase → Settings → API (secret)'],
  ['SUPABASE_DB_URL', 'Supabase → Connect → Session pooler (port 5432)'],
  ['ENCRYPTION_KEY', 'generated above'],
  ['META_APP_SECRET', 'Meta → App Settings → Basic (can add later)'],
]

const missing = []
for (const [key, where] of REQUIRED) {
  const v = getVal(key)
  const ok = v && !PLACEHOLDER.test(v)
  console.log(`  ${ok ? GREEN('✓') : YELLOW('•')} ${key.padEnd(30)} ${ok ? '' : DIM(where)}`)
  if (!ok) missing.push(key)
}

console.log('')
if (missing.length === 0) {
  console.log(`${GREEN(B('All required values are set.'))} Next:`)
  console.log(`  ${B('npm run db:deploy')}   ${DIM('apply the database schema')}`)
  console.log(`  ${B('npm run dev')}          ${DIM('http://localhost:3000')}`)
} else {
  console.log(`${YELLOW(B(`${missing.length} value(s) still needed`))} — edit ${B('.env')}, then re-run ${B('npm run setup')}.`)
  console.log(DIM('  Full guide: DEPLOYMENT.md'))
}

console.log(
  `\n${DIM('Reminder: sign-up is invite-only + invites are emailed — configure SMTP')}` +
    `\n${DIM('in your Supabase project (Auth → SMTP) before inviting anyone. See DEPLOYMENT.md Step 4.')}\n`,
)

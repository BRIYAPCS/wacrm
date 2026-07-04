#!/usr/bin/env node
// ============================================================
// scripts/db-deploy.mjs — one-command database deployment.
//
// Applies every SQL file in supabase/migrations/ (in filename
// order) to your Supabase Postgres database: tables, RLS
// policies, storage buckets, functions, triggers, and the
// realtime publication.
//
// Every migration in this repo is idempotent (IF NOT EXISTS /
// DROP ... IF EXISTS), so this script is safe to re-run. It also
// records applied versions in a `wacrm_schema_migrations` table
// and skips anything already applied, so re-runs are fast.
//
// Usage:
//   npm run db:deploy
//
// Requires SUPABASE_DB_URL in .env — the Postgres connection
// string from Supabase Dashboard -> Connect -> Session pooler.
// (The service-role key can't run DDL; only a Postgres
// connection can.)
// ============================================================

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const migrationsDir = join(repoRoot, 'supabase', 'migrations')

// ------------------------------------------------------------
// Load SUPABASE_DB_URL. Prefer a value already in the
// environment (e.g. from `node --env-file=.env`); otherwise
// parse .env ourselves so this works on any Node 20+.
// ------------------------------------------------------------
function loadEnvVar(name) {
  if (process.env[name]) return process.env[name]
  for (const file of ['.env.local', '.env']) {
    try {
      const raw = readFileSync(join(repoRoot, file), 'utf8')
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
        if (m && m[1] === name) {
          let v = m[2].trim()
          if (
            (v.startsWith('"') && v.endsWith('"')) ||
            (v.startsWith("'") && v.endsWith("'"))
          ) {
            v = v.slice(1, -1)
          }
          if (v) return v
        }
      }
    } catch {
      // file may not exist — try the next one
    }
  }
  return undefined
}

const connectionString = loadEnvVar('SUPABASE_DB_URL')

if (!connectionString) {
  console.error(
    [
      '',
      '✗ SUPABASE_DB_URL is not set.',
      '',
      '  Add it to your .env file. Get it from the Supabase Dashboard:',
      '    Project -> Connect -> Session pooler -> URI',
      '',
      '  It looks like:',
      '    SUPABASE_DB_URL=postgresql://postgres.<ref>:<YOUR-DB-PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres',
      '',
      '  Use the Session pooler (port 5432), not the Transaction',
      '  pooler (6543) — DDL needs a session connection.',
      '',
    ].join('\n')
  )
  process.exit(1)
}

// ------------------------------------------------------------
// Collect migrations in filename order (001..030..).
// ------------------------------------------------------------
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b, 'en'))

if (files.length === 0) {
  console.error(`✗ No .sql files found in ${migrationsDir}`)
  process.exit(1)
}

// Guard against the placeholder value shipped in .env / the example,
// and against anything that isn't a parseable URL, so the first run
// gives clear instructions instead of a driver stack trace.
const looksLikePlaceholder =
  /\[YOUR-PASSWORD\]|<region>|<ref>|your-project/i.test(connectionString)
let urlOk = true
try {
  new URL(connectionString)
} catch {
  urlOk = false
}
if (looksLikePlaceholder || !urlOk) {
  console.error(
    [
      '',
      '✗ SUPABASE_DB_URL is still a placeholder (or not a valid URL).',
      '',
      '  Replace it in .env with your real connection string from:',
      '    Supabase Dashboard -> Connect -> Session pooler -> URI',
      '',
      '  Paste your database password in place of [YOUR-PASSWORD], and',
      '  make sure the host/region come from the dashboard (not <region>).',
      '  Use the Session pooler (port 5432), not the Transaction pooler (6543).',
      '',
    ].join('\n')
  )
  process.exit(1)
}

// Supabase requires TLS. The pooler presents a cert that doesn't
// chain to a public root, so we don't verify it (standard for
// Supabase connection strings).
const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
})

async function main() {
  console.log(`\n→ Connecting to database…`)
  await client.connect()

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.wacrm_schema_migrations (
      version     text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
  `)

  const { rows } = await client.query(
    'SELECT version FROM public.wacrm_schema_migrations'
  )
  const applied = new Set(rows.map((r) => r.version))

  let ran = 0
  for (const file of files) {
    const version = file.replace(/\.sql$/, '')
    if (applied.has(version)) {
      console.log(`  ⏭  ${file} (already applied)`)
      continue
    }

    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    process.stdout.write(`  ▶  ${file} … `)

    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query(
        'INSERT INTO public.wacrm_schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING',
        [version]
      )
      await client.query('COMMIT')
      console.log('done')
      ran++
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      console.log('FAILED')
      console.error(`\n✗ Migration ${file} failed:\n  ${err.message}\n`)
      throw err
    }
  }

  console.log(
    `\n✓ Database up to date — ${ran} migration(s) applied, ${files.length - ran} already present.\n`
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await client.end().catch(() => {})
  })

import express from 'express'
import postgres from 'postgres'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sql = postgres(process.env.DATABASE_URL)
const app = express()
app.use(express.json({ limit: '1mb' }))

await sql`
  CREATE TABLE IF NOT EXISTS bmls_teams (
    id INT PRIMARY KEY DEFAULT 1,
    data JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`
await sql`
  CREATE TABLE IF NOT EXISTS bmls_fixtures (
    fixture_id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`

app.get('/api/state', async (req, res) => {
  const [teamRows, fixRows] = await Promise.all([
    sql`SELECT data FROM bmls_teams WHERE id = 1`,
    sql`SELECT data FROM bmls_fixtures ORDER BY updated_at`
  ])
  res.json({
    teams: teamRows[0]?.data ?? [],
    fixtures: fixRows.map(r => r.data)
  })
})

app.put('/api/teams', async (req, res) => {
  await sql`
    INSERT INTO bmls_teams (id, data) VALUES (1, ${sql.json(req.body)})
    ON CONFLICT (id) DO UPDATE SET data = ${sql.json(req.body)}, updated_at = NOW()
  `
  res.json({ ok: true })
})

app.put('/api/fixture/:id', async (req, res) => {
  const { id } = req.params
  await sql`
    INSERT INTO bmls_fixtures (fixture_id, data) VALUES (${id}, ${sql.json(req.body)})
    ON CONFLICT (fixture_id) DO UPDATE SET data = ${sql.json(req.body)}, updated_at = NOW()
  `
  res.json({ ok: true })
})

app.delete('/api/fixture/:id', async (req, res) => {
  await sql`DELETE FROM bmls_fixtures WHERE fixture_id = ${req.params.id}`
  res.json({ ok: true })
})

app.get('/bundle.js', (req, res) => {
  res.sendFile(join(__dirname, 'bundle.js'))
})

app.get('/service-worker.js', (req, res) => {
  res.setHeader('Service-Worker-Allowed', '/')
  res.setHeader('Cache-Control', 'no-cache')
  res.sendFile(join(__dirname, 'service-worker.js'))
})

app.get('/manifest.json', (req, res) => {
  res.sendFile(join(__dirname, 'manifest.json'))
})

app.get('/icon.svg', (req, res) => {
  res.sendFile(join(__dirname, 'icon.svg'))
})

app.use('/fonts', express.static(join(__dirname, 'fonts')))

app.get('/worldcup', (req, res) => {
  res.sendFile(join(__dirname, 'worldcup.html'))
})
app.get('/worldcup/bundle.js', (req, res) => {
  res.sendFile(join(__dirname, 'worldcup-bundle.js'))
})

app.get('/betting', (req, res) => {
  res.sendFile(join(__dirname, 'betting.html'))
})
app.get('/betting/bundle.js', (req, res) => {
  res.sendFile(join(__dirname, 'betting-bundle.js'))
})

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'))
})

const PORT = process.env.PORT || 3006
app.listen(PORT, () => console.log(`bmls-api :${PORT}`))

// server.js
const express = require('express');
const fs = require('fs');
const fsAsync = require('fs').promises;
const path = require('path');
const cors = require('cors');
const crypto = require('crypto'); // For safe temp file naming

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite')); // Built into Node 22.13+ (no npm package needed)
} catch (err) {
  console.error('This server needs Node.js 22.13 or newer (built-in SQLite). Current version:', process.version);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

const DB_FILE = path.join(__dirname, 'tracker.db');
const LEGACY_DATA_FILE = path.join(__dirname, 'data.json'); // pre-database storage, imported once
const GEOFENCE_FILE = path.join(__dirname, 'geofence.json');
const DEFAULT_LIMIT = 1000;   // GET /api/location without filters returns the latest N points
const MAX_LIMIT = 100000;     // upper bound for a single response

// ---- Helpers ----

// Synchronous load is acceptable ONLY on initial server startup
function loadJSONSync(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (raw && raw.trim().length > 0) return JSON.parse(raw);
    }
  } catch (err) {
    console.error(`Error loading ${filePath} on startup:`, err);
  }
  return defaultValue;
}

// Asynchronous atomic save to prevent blocking the event loop
async function saveJSONAtomic(filePath, data) {
  try {
    if (data === null) {
      if (fs.existsSync(filePath)) await fsAsync.unlink(filePath);
      return true;
    }
    // Append random string to prevent race conditions from simultaneous writes
    const tempSuffix = crypto.randomBytes(4).toString('hex');
    const tmpFile = `${filePath}.${tempSuffix}.tmp`;

    await fsAsync.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf8');
    await fsAsync.rename(tmpFile, filePath);
    return true;
  } catch (err) {
    console.error(`Async save error for ${filePath}:`, err);
    return false;
  }
}

// Accepts epoch milliseconds or an ISO date string. undefined = not given, NaN = invalid.
function parseTimeParam(value) {
  if (value === undefined) return undefined;
  const n = Number(value);
  const ms = Number.isFinite(n) ? n : Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
}

// ---- Points database (SQLite) ----
// One row per point, appended with a single INSERT — the full history is kept.
// `ts` is the point's time in epoch ms (receive time if `time` can't be parsed) and is indexed for day/range queries.
const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS points (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    latitude    REAL    NOT NULL,
    longitude   REAL    NOT NULL,
    time        TEXT    NOT NULL,
    ts          INTEGER NOT NULL,
    received_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_points_ts ON points (ts);
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const stmt = {
  insert: db.prepare('INSERT INTO points (latitude, longitude, time, ts, received_at) VALUES (?, ?, ?, ?, ?)'),
  latest: db.prepare('SELECT id, latitude, longitude, time FROM points ORDER BY id DESC LIMIT ?'),
  lastId: db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM points'),
  count: db.prepare('SELECT COUNT(*) AS c FROM points'),
  clear: db.prepare('DELETE FROM points'),
  days: db.prepare(`
    SELECT date(ts / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS count, MIN(ts) AS first, MAX(ts) AS last
    FROM points GROUP BY day ORDER BY day DESC`),
  getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
  setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
};

function transaction(fn) {
  db.exec('BEGIN');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}

function insertPoint(point, receivedAt) {
  const parsed = Date.parse(point.time);
  const ts = Number.isFinite(parsed) ? parsed : receivedAt;
  return stmt.insert.run(point.latitude, point.longitude, point.time, ts, receivedAt);
}

// The data epoch changes whenever history is cleared, so clients know to reload instead of
// asking for "points after id X" from a history that no longer exists.
function newEpoch() {
  const epoch = crypto.randomBytes(6).toString('hex');
  stmt.setMeta.run('epoch', epoch);
  return epoch;
}
let dataEpoch = stmt.getMeta.get('epoch')?.value || newEpoch();

// One-time import of the old data.json (the file itself is left untouched)
function importLegacyData() {
  if (stmt.getMeta.get('legacy_import')) return;
  const legacy = loadJSONSync(LEGACY_DATA_FILE, []);
  let imported = 0;
  if (stmt.count.get().c === 0 && Array.isArray(legacy) && legacy.length) {
    transaction(() => {
      for (const p of legacy) {
        const lat = Number(p && p.latitude), lon = Number(p && p.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const time = p.time ? String(p.time) : new Date().toISOString();
        const parsed = Date.parse(time);
        insertPoint({ latitude: lat, longitude: lon, time }, Number.isFinite(parsed) ? parsed : Date.now());
        imported++;
      }
    });
  }
  stmt.setMeta.run('legacy_import', JSON.stringify({ at: new Date().toISOString(), imported }));
  if (imported) console.log(`Imported ${imported} points from data.json (file left untouched)`);
}
importLegacyData();

// ---- In-memory state (Loaded synchronously on boot) ----
let geofence = loadJSONSync(GEOFENCE_FILE, null);

// ---- Middleware ----
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- API Routes ----

// POST /api/location (Receives data from ESP32)
app.post('/api/location', (req, res) => {
  const body = req.body || {};
  const lat = Number(body.latitude);
  const lon = Number(body.longitude);

  // Strict physical boundary validation
  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ error: 'Valid latitude (-90 to 90) and longitude (-180 to 180) are required' });
  }

  const point = {
    latitude: lat,
    longitude: lon,
    time: body.time ? String(body.time) : new Date().toISOString()
  };

  try {
    insertPoint(point, Date.now());
  } catch (err) {
    console.error('Failed to store point:', err);
    return res.status(500).json({ error: 'Failed to store point' });
  }

  return res.status(200).json({ ok: true });
});

// GET /api/location
//   (no query)        → latest 1000 points, oldest first (same as before)
//   ?after=<id>       → only points newer than id (incremental polling)
//   ?from=&to=        → points in a time range (epoch ms or ISO), e.g. one day
//   ?limit=<n>        → cap the number of points (max 100000)
// Response headers: X-Data-Epoch (changes when history is cleared), X-Last-Id, X-Truncated (1 if limit was hit)
app.get('/api/location', (req, res) => {
  const { after, from, to, limit } = req.query;
  const hasFilter = after !== undefined || from !== undefined || to !== undefined;
  const afterId = after === undefined ? undefined : Number(after);
  const fromMs = parseTimeParam(from);
  const toMs = parseTimeParam(to);
  const max = limit === undefined ? (hasFilter ? MAX_LIMIT : DEFAULT_LIMIT) : Number(limit);

  if (afterId !== undefined && (!Number.isInteger(afterId) || afterId < 0)) {
    return res.status(400).json({ error: '"after" must be a non-negative integer id' });
  }
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return res.status(400).json({ error: '"from" and "to" must be epoch milliseconds or ISO dates' });
  }
  if (!Number.isInteger(max) || max < 1 || max > MAX_LIMIT) {
    return res.status(400).json({ error: `"limit" must be an integer from 1 to ${MAX_LIMIT}` });
  }

  let rows, truncated = false;
  if (!hasFilter) {
    rows = stmt.latest.all(max).reverse();
  } else {
    const where = [], params = [];
    if (afterId !== undefined) { where.push('id > ?'); params.push(afterId); }
    if (fromMs !== undefined) { where.push('ts >= ?'); params.push(fromMs); }
    if (toMs !== undefined) { where.push('ts < ?'); params.push(toMs); }
    rows = db.prepare(`SELECT id, latitude, longitude, time FROM points WHERE ${where.join(' AND ')} ORDER BY id ASC LIMIT ?`)
      .all(...params, max + 1);
    if (rows.length > max) { rows.pop(); truncated = true; }
  }

  res.set({
    'Cache-Control': 'no-store',
    'X-Data-Epoch': dataEpoch,
    'X-Last-Id': String(stmt.lastId.get().id),
    'X-Truncated': truncated ? '1' : '0'
  });
  res.json(rows);
});

// GET /api/location/days — days that have points (server local time), newest first
app.get('/api/location/days', (req, res) => {
  const days = stmt.days.all().map((r) => {
    const [y, m, d] = r.day.split('-').map(Number);
    return {
      day: r.day,
      count: r.count,
      from: new Date(y, m - 1, d).getTime(),
      to: new Date(y, m - 1, d + 1).getTime(),
      first: new Date(r.first).toISOString(),
      last: new Date(r.last).toISOString()
    };
  });
  res.set('Cache-Control', 'no-store');
  res.json(days);
});

// GET /api/location/latest
app.get('/api/location/latest', (req, res) => {
  const last = stmt.latest.get(1);
  if (!last) return res.status(204).send();
  res.json(last);
});

// DELETE /api/location (Aligns with frontend 'Clear Track' button)
app.delete('/api/location', (req, res) => {
  try {
    dataEpoch = transaction(() => {
      stmt.clear.run();
      return newEpoch();
    });
  } catch (err) {
    console.error('Failed to clear points:', err);
    return res.status(500).json({ error: 'Failed to clear data on disk' });
  }
  return res.json({ ok: true, message: 'Tracking history cleared' });
});

// POST /api/geofence
app.post('/api/geofence', async (req, res) => {
  const body = req.body;
  const isDelete = (body === null) || (typeof body === 'object' && Object.keys(body || {}).length === 0);

  if (isDelete) {
    geofence = null;
    await saveJSONAtomic(GEOFENCE_FILE, null);
    return res.json({ ok: true, deleted: true });
  }

  geofence = body;
  const ok = await saveJSONAtomic(GEOFENCE_FILE, geofence);

  if (!ok) return res.status(500).json({ error: 'Failed to save geofence' });
  return res.json({ ok: true, deleted: false });
});

// DELETE /api/geofence
app.delete('/api/geofence', async (req, res) => {
  geofence = null;
  await saveJSONAtomic(GEOFENCE_FILE, null);
  return res.json({ ok: true, deleted: true });
});

// GET /api/geofence
app.get('/api/geofence', (req, res) => {
  if (!geofence) return res.status(204).send();
  res.json(geofence);
});

// Fallback for undefined API endpoints
app.use('/api', (req, res) => {
  return res.status(404).json({ error: 'API endpoint not found' });
});
// ---- Start Server ----
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Stored points: ${stmt.count.get().c} (database: ${path.basename(DB_FILE)})`);
  console.log(`Geofence loaded: ${geofence ? 'yes' : 'no'}`);
});

// Close the database cleanly on Ctrl+C / service stop
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    try { db.close(); } catch (e) {}
    process.exit(0);
  });
}

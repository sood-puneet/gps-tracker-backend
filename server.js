// server.js
const express = require('express');
const fs = require('fs');
const fsAsync = require('fs').promises;
const path = require('path');
const cors = require('cors');
const crypto = require('crypto'); // For safe temp file naming

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, 'data.json');
const GEOFENCE_FILE = path.join(__dirname, 'geofence.json');
const MAX_POINTS = 1000;

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

// ---- In-memory state (Loaded synchronously on boot) ----
let points = loadJSONSync(DATA_FILE, []);
let geofence = loadJSONSync(GEOFENCE_FILE, null);

if (!Array.isArray(points)) points = [];
if (points.length > MAX_POINTS) points = points.slice(points.length - MAX_POINTS);

// ---- Middleware ----
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- API Routes ----

// POST /api/location (Receives data from ESP32)
app.post('/api/location', async (req, res) => {
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

  points.push(point);
  
  if (points.length > MAX_POINTS) {
    points = points.slice(points.length - MAX_POINTS);
  }

  // Await the async save so we don't freeze the server responding to other requests
  await saveJSONAtomic(DATA_FILE, points);

  return res.status(200).json({ ok: true });
});

// GET /api/location
app.get('/api/location', (req, res) => {
  res.json(points);
});

// GET /api/location/latest
app.get('/api/location/latest', (req, res) => {
  if (points.length === 0) return res.status(204).send();
  res.json(points[points.length - 1]);
});

// DELETE /api/location (Aligns with frontend 'Clear Track' button)
app.delete('/api/location', async (req, res) => {
  points = [];
  const success = await saveJSONAtomic(DATA_FILE, points);
  
  if (!success) return res.status(500).json({ error: 'Failed to clear data on disk' });
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
  console.log(`Stored points: ${points.length}`);
  console.log(`Geofence loaded: ${geofence ? 'yes' : 'no'}`);
});
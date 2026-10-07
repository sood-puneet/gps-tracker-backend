# LocalTracker — Handover

> **Round 1–2:** UI only (`public/index.html`) + frontend bug fixes + smooth replay. See §1–§6.
> **Round 3:** issues #6, #12, #13 — full history in SQLite, saved-day view, incremental polling.
> Touches `server.js` and `public/index.html`. See **§7** (supersedes the storage/API notes in §1).
> Still plain HTTP; CORS, validation and everything else unchanged by request.

Status: ✅ Done — implemented and browser-tested (2026-10-04).

---

## 1. Project overview (current state)

Self-hosted live GPS tracking dashboard. A device (ESP32) POSTs coordinates to a small
Node/Express server; a single-page Leaflet frontend renders the live track with geofence alerts.

### Files

| File | Role |
|---|---|
| `server.js` | Express 5 server, port `3000` (or `PORT` env), CORS, serves `public/` |
| `data.json` | Persisted location points (rolling cap of **1000**) |
| `geofence.json` | Persisted geofence (GeoJSON Feature / Polygon) |
| `public/index.html` | Entire frontend — HTML + CSS + JS in one file |
| `package.json` | Deps: `express`, `cors`. Start: `npm start` |

### Run

```powershell
cd C:\Users\teamd\Chandan\Tools\gps-local\gps-local
npm install      # first time only
npm start        # http://localhost:3000
```

### Backend API (unchanged)

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/location` | Body `{ latitude, longitude, time? }` — validated, appended, saved |
| GET | `/api/location` | All stored points |
| GET | `/api/location/latest` | Last point (204 if none) |
| DELETE | `/api/location` | Clear history |
| GET | `/api/geofence` | Current geofence (204 if none) |
| POST | `/api/geofence` | Save geofence (empty body = delete) |
| DELETE | `/api/geofence` | Remove geofence |

### Frontend features (before this round)

- Leaflet map (OSM tiles), Leaflet.Draw polygon geofence, Turf.js distance / point-in-polygon.
- Polls `/api/location` every 1s / 2s / 5s; computes speed + compass heading client-side.
- Route polyline with animated dashes, start/current markers, per-point dots with tooltips, optional arrows.
- Follow mode + recenter button, telemetry overlay (Started / Current / Speed).
- Sidebar with timeline scrubber and virtualised list of point cards.
- Geofence breach detection with status pill, pulsing polygon and toasts.

### UI problems found

- Emoji used as icons (📍 ◀ ▶ ✅ ⚠️); inconsistent SVGs; wrong metaphors
  (Clear Track = warning triangle, Geofence = trash can); `fill: currentColor` breaks stroke icons.
- `select` has no dropdown chevron; no tooltips on buttons; no dark mode; not responsive.
- Default Leaflet / Leaflet.Draw controls don't match the app; busy OSM base map.
- Native `confirm()` dialog; plain toasts; no empty state; offline errors silently swallowed.
- Tooltip arrow CSS selector was wrong (`.custom-tooltip .leaflet-tooltip-top:before`).
- CDN libraries loaded **unversioned** (`unpkg.com/leaflet`) — could break when a new major ships.

### Bugs found

1. **Live updates stop at 1000 points.** Server caps history at 1000; client only appended when
   `pts.length > fullPointsData.length`, so once the cap is hit (or history is cleared from another
   tab) no new points are ever shown.
2. **Duplicate geofence layer.** Changing the poll interval re-ran `startLoop()`, which re-fetched the
   geofence and added another copy to the map each time. The loaded GeoJSON was also added as a
   nested group, which Leaflet.Draw's editor doesn't handle well.

---

## 2. Planned updates (this round)

### Icons
- One consistent inline SVG sprite (Lucide-style, 24px grid, 2px stroke, MIT) — no emoji anywhere.
- Correct metaphors: Follow = locate, Arrows = arrow, Geofence = polygon shape, Clear = trash.

### Header
- Brand mark + "LocalTracker / Live Asset Monitor".
- Connection pill (Connecting / Live / Waiting for GPS / Offline / Paused) with pulsing dot,
  "Last fix 12s ago" (amber when stale), geofence chip (Inside / Outside zone).
- Grouped actions: Follow + Arrows segmented toggle · poll-interval select with chevron ·
  Geofence menu (Draw / Edit / Remove) · theme toggle · Clear track.
- Tooltips + aria-labels on all buttons.

### Map
- Base-map switcher: Auto (follows theme) / Light / Dark / Streets / Satellite.
- Custom control group (zoom, recenter, layers) styled to match the app.
- Leaflet.Draw toolbar replaced by header menu + guided banner (Undo point / Cancel / Save).
- Pulsing current-position marker with heading cone; flag start marker; three-layer route line.
- Dark tooltip cards; restyled edit handles and attribution.

### Telemetry panel
- Tile grid: Speed (with state), Distance, Elapsed (since start), Points, Heading, Position (copy).
- LIVE / HISTORY tag, tabular numbers, collapsible (remembered).

### Sidebar
- Chevron toggle tab; timeline with styled slider, Play/Pause replay, step back/forward,
  point readout, "Back to live".
- Point cards: index, time, relative age, coordinates, colour-coded speed, rotated heading arrow,
  selected/latest/future states; clicking a map dot or card selects and syncs both.
- Empty state.

### Feedback
- Toasts with icon, title, message, coloured accent, close button.
- In-app confirmation modal (Clear track, Remove zone) instead of `confirm()`.
- Geofence breach banner with "Locate" action.

### System
- Design tokens; **dark mode** (system default + manual toggle, remembered).
- Responsive: header actions collapse into a menu, sidebar becomes a bottom sheet on mobile.
- Focus-visible rings, reduced-motion support.
- Pin CDN versions: Leaflet 1.9.4, Leaflet.Draw 1.0.4, Turf 6.5.0.

### Bug fixes
1. Sync points by matching the last known point inside the server response (handles the
   1000-point rolling window and history cleared elsewhere → full resync).
2. Geofence is loaded once at startup; changing the poll interval only reschedules the timer.
   The polygon itself (not a nested group) is added to the edit layer.

---

## 3. What was actually delivered

Everything in §2 was implemented in `public/index.html`. Differences from the plan, and extra
fixes found while testing:

| Item | Detail |
|---|---|
| Base maps | CARTO now returns an "API KEY REQUIRED" image, so **Light/Dark use Esri Canvas** (keyless, with label overlay). Streets = OpenStreetMap, Satellite = Esri World Imagery. No API keys needed. |
| Map controls | Built as a plain overlay (not a Leaflet control) so the Map-style popover stacks above the telemetry panel and banners. |
| Toasts | Top-right of the map (beside the controls) so they never cover the breach banner. |
| **Bug 3 (new)** | On startup with a saved geofence, an animated "fit to geofence" raced the first "jump to asset", leaving the map on the default view with the route not drawn. The first poll now runs first and both moves are instant. |
| Breach state | Resets when the track becomes empty, so a new breach after clearing shows the correct "since" time. |
| Clear track | History is only cleared in the UI if the server confirms the delete (error toast otherwise). Previously the UI cleared even if the request failed. |
| Follow | Now a true toggle (click again to turn off). Dragging the map turns it off; the recenter button shows a blue dot when follow is off. |
| Replay / history | Polling pauses while in history or replay; status shows "Paused · history" / "Replaying". "Back to live" or the recenter button resumes live tracking. |

### 3a. Smooth route replay (round 2, after user feedback)

Feedback: pressing Play with 2 points finished instantly and jumped straight back to LIVE (old code
stepped one point every 250 ms, discretely). Replaced with real playback:

| Aspect | Behaviour |
|---|---|
| Motion | Marker **glides** along each leg (requestAnimationFrame, interpolated lat/lng) from point 1 → 2 → 3 … |
| Map | Played trail solid, un-played route shown faded/dashed, un-played dots dimmed and lit as they're passed; heading arrow rotates per leg. |
| Pacing (1×) | ~1.5 s per leg; whole replay clamped to **6 s – 60 s**, so 2-point tracks play slowly and long tracks (up to 1000 pts) speed up automatically. |
| Speed control | 0.5× · 1× · 2× · 4× · 8× (remembered). Sidebar shows "Full route ≈ m:ss". Can change while playing. |
| Camera | On play: fit the whole route clear of the overlays (works for far-apart points), then a gentle pan only if the marker nears the edge. User zoom is respected. On mobile the bottom sheet collapses so the map is visible. |
| Sync | Slider moves continuously; readout "Point 12 of 40 · 0:42 left" + interpolated time; list highlights & scrolls to the current point; telemetry shows the current leg's speed/heading and running distance/elapsed. Badge: REPLAY / PAUSED. |
| Controls | Pause/resume mid-leg; **Space** toggles play/pause; dragging the slider, step buttons or clicking a point/card stops the replay at that point; Play then continues **from the scrubbed point**. |
| End | Stops on the last point ("Replay complete · N points") instead of jumping to LIVE. Play again restarts from point 1; "Back to live" returns to live tracking. |

New localStorage key: `lt-replay-speed`.

### Preferences remembered in the browser (localStorage)
`lt-theme` (light/dark), `lt-map-style`, `lt-stats-collapsed`, and `geofence` (existing key, unchanged).

---

## 4. Testing done

Run against a **separate copy** of the server in a temp folder (port 3917) — the project's real
`data.json` / `geofence.json` were not used. Headless Microsoft Edge driven via DevTools protocol.

| Check | Result |
|---|---|
| Initial load: 40 points, route, markers, telemetry, list | ✅ |
| Change poll interval 4× → still exactly 1 geofence on the map (bug 2) | ✅ |
| Post 1,015 points → server capped at 1000 → UI shows 1000 and the newest point (bug 1) | ✅ |
| More points after the cap → UI keeps updating (old code froze here) | ✅ |
| History deleted by another client → UI empties; new points then appear | ✅ |
| Theme toggle, Geofence menu, Draw/Edit banners + cancel, timeline step/back-to-live, card select, confirm dialog + Esc, map-style switch | ✅ |
| JavaScript console errors | none |
| Visual check: desktop light, desktop dark, mobile (390px) | ✅ |
| **Replay:** starts at point 1, slider advances continuously (2.01 → 2.19 → 2.37…), marker position changes every sample, faded route drawn | ✅ |
| Replay pause freezes / resume continues; list highlights current point | ✅ |
| Replay at 8× finishes (~7 s for 40 pts) and holds "Replay complete · 40 points"; Play again restarts at 1 | ✅ |
| Scrub to point 10 stops replay; Play continues from point 10; Back to live | ✅ |
| User's 2-point case (~195 km apart): ≈6 s at 1×, both points framed, marker visible mid-way, completes | ✅ |

**Not tested automatically:** actually drawing/editing a polygon with the mouse, and real phone
devices. Please do a quick manual pass (see §6).

---

## 5. Notes / known items (not changed — outside UI scope)

- **Server write race on Windows:** with many simultaneous POSTs, `saveJSONAtomic` can fail with
  `EPERM` on `rename` (seen during the 1000-point stress test). In-memory data stays correct and the
  next write succeeds; a single ESP32 posting every few seconds is unlikely to hit it. Fix would be
  in `server.js` (serialise writes) — not done, per scope.
- **No authentication** on the API — fine on a LAN, risky if exposed to the internet.
- **No validation** of the geofence body on `POST /api/geofence`.
- Tile providers are free/public services (Esri, OSM) — fine for light internal use; heavy or
  commercial use should check their terms.
- Speed is calculated from the device timestamps; if the ESP32 clock is off or sends duplicate
  times, speed shows 0.0.
- Project is not a git repository. A backup of the original UI was saved outside the project
  (Claude scratchpad, temporary) — keep your own copy if you need rollback.

---

## 6. Manual checklist for the next person

1. `npm start`, open http://localhost:3000.
2. Geofence ▸ Draw zone → click 4–5 points → click the first point → "Geofence saved" toast.
3. Geofence ▸ Edit zone → drag a handle → Save changes.
4. Send a point outside the zone → red banner, red pulsing zone, "Outside zone" chip.
5. Timeline: press Play → map fits the route and the marker glides point to point; try Pause,
   Space key, speed 0.5×–8×, dragging the slider, then Play again; Back to live. Click a list card → map flies there.
6. Theme toggle (moon/sun) and Map style (layers button) — check both themes.
7. Narrow the browser to phone width → menu button in header, bottom-sheet track log.

---

## 7. Round 3 — storage, history, incremental polling (issues #6, #12, #13)

Requested: fix only #6 (history too short), #12 (every poll downloads everything) and
#13 (whole file rewritten per point). Keep HTTP; change nothing else.

### What changed

| Issue | Before | After |
|---|---|---|
| **#13** storage | Every POST rewrote the whole `data.json` | Points stored in **SQLite** (`tracker.db`, Node's built-in `node:sqlite`, WAL mode). Each POST is one small `INSERT`. No new npm packages. |
| **#6** history | Hard cap of 1000 points — older ones silently deleted (~33 min at a 2 s interval) | **Every point is kept.** New **History** menu in the sidebar lists saved days (count + time span). Pick a day to view it, scrub it, or replay it. **Back to live** returns. |
| **#12** polling | Each poll downloaded all points (~90 KB for 1000) | First load gets the latest 1000; every poll after that asks `?after=<lastId>` → an idle poll is ~350 B including headers. History cleared elsewhere is detected via a data epoch and the window reloads. |

### Files

| File | Change |
|---|---|
| `server.js` | SQLite storage + new query options + `/api/location/days`. Geofence code untouched (still `geofence.json`). |
| `public/index.html` | Incremental sync, History menu & saved-day view, dot sampling for long days. |
| `tracker.db` (+ `-wal`, `-shm`) | **Created on first start.** This is now the data store — back it up instead of `data.json`. |
| `data.json` | **Imported once** into the database on first start, then no longer used. The file is left untouched; you may delete or archive it after confirming the import. |
| `package.json` | Not changed. Requires **Node.js 22.13+** (built-in SQLite). You have 24.18. The server prints a clear error on older Node. |

### API (backwards compatible — the ESP32 needs no change)

| Method | Endpoint | Behaviour |
|---|---|---|
| POST | `/api/location` | Unchanged body/response. Stored with one INSERT. |
| GET | `/api/location` | **No query → latest 1000 points, oldest first (same as before)**, each now also has an `id`. |
| GET | `/api/location?after=<id>` | Only points newer than `id` (incremental polling). |
| GET | `/api/location?from=<ms\|ISO>&to=<ms\|ISO>` | Points in a time range (used for a day). |
| GET | `/api/location?limit=<n>` | Cap results (1–100000). Invalid params → 400 JSON error. |
| GET | `/api/location/days` | `[{ day, count, from, to, first, last }]`, newest first, server local time. |
| GET | `/api/location/latest` | Unchanged (now includes `id`). |
| DELETE | `/api/location` | Deletes **all** history (every day) and changes the data epoch. |

Response headers on `GET /api/location`: `X-Data-Epoch` (changes when history is cleared),
`X-Last-Id` (newest id), `X-Truncated` (`1` if `limit` was hit).

### Dashboard behaviour

- **Live** keeps the latest 1,000 points on screen (as before) and appends only new ones.
- **History ▸ day:** loads that whole day; status shows "Saved history", badges show the day
  (e.g. YESTERDAY). Live polling pauses; "Last fix" still shows the live asset; geofence
  alerts stay based on the live asset (a past day never triggers a breach).
- Long days (> 2,000 points) draw every n-th dot so the map stays fast; the route line, list,
  timeline and replay still use every point. Replay of a 6,000-point day measured at 60 fps.
- **Clear track** now warns that it deletes every saved day.
- Small fixes found while testing: the list scrolls back to the newest point on "Back to live";
  the point-count pill no longer wraps; the replay speed row stacks on phones.

### Testing (separate server copy, headless Edge)

| Check | Result |
|---|---|
| `data.json` (4 points) imported once into `tracker.db`; file untouched | ✅ |
| 1,820 points over 3 days all kept (no 1000 cap); `/days` correct | ✅ |
| Live view: first request `?limit=1000` (88 KB) → later polls `?after=<id>` (~350 B) | ✅ |
| New point arrives via incremental poll; live window stays 1,000 | ✅ |
| History menu lists Live + days; Yesterday loads 300 pts; live points don't leak in | ✅ |
| Replay on a saved day; Back to live reloads window incl. points posted meanwhile | ✅ |
| 6,000-point day loads (~1.5 s) and replays at 60 fps | ✅ |
| History cleared elsewhere → epoch change → UI empties; new points then appear | ✅ |
| Invalid query params → 400 JSON; `limit` truncation header | ✅ |
| Desktop + 390 px phone screenshots | ✅ |
| JS console errors | none |

### Notes

- **Restart the server** after updating (`Ctrl+C`, then `npm start`) — the running process still has the old code.
- Days are grouped by the **server's local time zone**.
- Database grows ~100 bytes per point (≈4 MB/day at a 2 s interval). No automatic retention/cleanup —
  **Clear track** removes everything. Ask if you want per-day delete or a retention period.
- Points are still kept in **arrival order** (issue #8, not in scope) — if the device sends late/buffered
  points, they appear in the order received.
- Backups made before this round: Claude scratchpad `backup-before-storage/` (temporary).

---

## 8. Round 4 — "Test data" menu (demo & testing without the console)

Requested: easy, no-extra-database ways to create demo/test points instead of typing
`fetch('/api/location', …)` in the browser console, and keep them visible in History.
Real ESP32 flow unchanged. `server.js` unchanged.

### Where
Header ▸ **Test data** (flask icon). On phones it's inside the ☰ menu.

| Action | What it does |
|---|---|
| **Add by clicking the map** | Crosshair mode; every click POSTs a point (like the device). Banner shows the count; **Done** or **Esc** ends it. Double-click zoom is paused meanwhile. |
| **Enter coordinates…** | Dialog: latitude, longitude (with range hints), optional date & time via a **custom date-time picker** (calendar with month navigation, today marker, future dates disabled, hour/minute/second steppers, Clear / Now / Done, arrow-key navigation, Esc closes only the picker; matches light/dark theme) plus a **Now** button (blank = now). Pasting `28.99254, 77.99993` into Latitude fills both fields. Inline success/error message; stays open for the next point; if a time was given it advances by 10 s. One column on phones. |
| **Upload JSON file(s)…** | Pick one or more `.json` files (or **drag & drop onto the map**). Shows a confirmation with point count, skipped invalid entries and which days they belong to, then sends them with a progress bar (Cancel keeps what was sent). Files whose points are all on past days open that day in History automatically. |
| **Load demo route** | `public/demo/demo-route.json` — 59 points, 10.1 km **round trip in Gurugram**: Genpact, Sector 18 Sarhol (28.488969 N, 77.078904 E) → Sikandarpur Metro → back to the exact same coordinate. Real roads via OSRM, one point every 30 s, natural traffic speeds (avg ~20 km/h, max ~36), two signal stops and a 1-minute stop at the metro, ~29 min. (A 4–5 km round trip isn’t possible by road here — the shortest one-way is ~4.5 km.) Timestamps are shifted so the drive **ends now** → appears under Today. |
| **Download this view** | Saves the points on screen (live window or the open saved day) as JSON. |
| **Download all history** | Saves every stored point (up to 100,000) as one JSON file — use it as a backup before a Render restart and re-upload later. |

### JSON format (upload = download format)
```json
[
  { "latitude": 28.99254, "longitude": 77.99993, "time": "2026-10-06T10:00:00Z" },
  { "latitude": 28.99310, "longitude": 78.00050, "time": "2026-10-06T10:00:10Z" }
]
```
- `time` optional (ISO or epoch ms). Without it the server stamps the arrival time.
- Also accepted: `lat`/`lng`/`lon` keys, or `{ "points": [ ... ] }`.
- Several files are combined; if every point has a time they're sent in time order.

### How it stores data
Every added/imported point goes through `POST /api/location`, exactly like the ESP32, so it is saved in
`tracker.db` and appears in Live and History. On Render free this lasts until the next restart — keep
your demo files (or "Download all history") and re-upload after a restart.

### Notes
- Points added by clicking quickly get arrival-time stamps, so speeds look unrealistic. For a realistic
  demo use the demo route, an uploaded file with times, or Enter coordinates with a time.
- Points are stored in arrival order (issue #8): importing an old day also puts those points at the end
  of the Live window; the day itself is shown correctly under History.
- "Clear track" removes test points together with everything else.

### Testing (separate server copy, headless Edge)
All passed, no JS errors: menu; click-to-add (3 clicks → 3 points, Done/Esc, no adds after Done);
manual entry (paste split, validation, timed point lands on Yesterday, +10 s step, Esc closes);
upload via picker (25 valid + 1 invalid → confirmation summary → imported → day opened in History);
drag & drop; demo route (59-point Gurugram round trip under Today, ends ≈ now, map fits the whole route); progress banner and Cancel with
150 ms simulated latency; download view / all history → valid JSON in the upload format.

### 8a. Demo route always in History

History menu (sidebar ▸ **Live ▾**) now has a permanent **Demo route** entry under "View"
(Genpact Sarhol ⇄ Sikandarpur Metro, 59 points). It is read straight from
`public/demo/demo-route.json`, **not from the database**, so it:

- is always available — after a server/Render restart, with an empty database, and after **Clear track**;
- never mixes with real ESP32 data and writes nothing to `tracker.db`;
- opens like a saved day (badge "DEMO ROUTE"): map fitted to the route, list, timeline, replay,
  "Download this view"; **Back to live** returns.
- Times shown are the file's own (10:00–10:29 am); the "x min ago" label is hidden for the demo.

Difference from **Test data ▸ Load demo route**: that one *sends* the points to the server as if a
device were driving now (appears under Today, triggers live behaviour/geofence), and it is stored
in the database (lost on a Render restart, removed by Clear track).

To change the permanent demo, replace `public/demo/demo-route.json` (same JSON format as uploads).

Tested on an empty test server: entry shown with "No saved history yet", opens 59 points ending at
28.48897, 77.07890, replay works, nothing written to the database, still available after Clear track,
no JS errors.

### 8b. Demo day = "Thu, 1 Oct", preselected on page load

- `public/demo/demo-route.json` times now run **1 Oct 2026, 10:00:00 → 10:29:00 am IST** (04:30–04:59 UTC).
- The demo is no longer a separate "Demo route" item: it is listed under **Saved days** like any other
  day — **Thu, 1 Oct · 59 points · 10:00 am–10:29 am** — sorted by date among real days.
- The dashboard **opens on this day by default** (every page load/refresh). Live data still loads in the
  background ("Last fix", geofence state); use **Back to live** or **Live ▾ → Live** for real ESP32 tracking.
- Still read from the file, not the database: survives Render restarts and **Clear track**, writes nothing.
- Times are shown in the viewer's time zone (10:00 am for viewers in India).
- To change the demo day/route, replace the JSON file; its date becomes the label automatically.

Tested (headless Edge, Asia/Kolkata): preselected on load and after refresh, badge/label "Thu, 1 Oct",
point #1 at 10:00:00 am, menu order Today → Sat, 3 Oct → Thu, 1 Oct, Live switch, still present after
Clear track, database untouched, no JS errors.

### 8c. Two demo files (History day vs Test data)

| File | Used by | Route |
|---|---|---|
| `public/demo/demo-route.json` | **History ▸ Thu, 1 Oct** (built-in day, preselected, never stored) | Genpact Sarhol ⇄ Sikandarpur Metro, 59 pts, 1 Oct 10:00–10:29 am |
| `public/demo/test-route.json` | **Test data ▸ Load demo route** (sent to the server, re-timed to end now) | Genpact Sarhol → **Ambience Mall** → shopping & lunch → back to Genpact |

`test-route.json` (77 points, ~2 h 15 min, real roads via OSRM, starts/ends at 28.488969 N, 77.078904 E):
- Drive out 5.5 km via NH-48 (one point / 30 s, natural speeds, one signal stop) — ~15 min.
- Park at the mall, **shop ~1 h** (walking inside the mall, one point / 4 min).
- **Eat ~45 min** at the food court (stationary, tiny GPS drift, one point / 5 min).
- Walk back to the car, drive back 3.6 km to Genpact.

Tested: imports 77 points under Today ending ≈ now, ends at Genpact, elapsed 2h 15m, mall stay shows
as Stationary, History's "Thu, 1 Oct" day unchanged, no JS errors.

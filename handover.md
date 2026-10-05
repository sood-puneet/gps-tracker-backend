# LocalTracker — Handover

> Scope of this round: **UI only** (`public/index.html`) + two frontend bug fixes.
> `server.js`, `package.json`, `data.json`, `geofence.json` are **not modified**.

Status: ✅ Done — implemented and browser-tested (2026-10-04). See §3–§5.

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

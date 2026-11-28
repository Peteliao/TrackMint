# RoamEtch: Open-source GPS tracker, GPX trip recorder, and encrypted live meetup chat PWA

[简体中文](README.md) | English

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-2bcda7?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-no%20framework-3178c6?style=flat-square)](https://www.typescriptlang.org/)
[![PWA](https://img.shields.io/badge/PWA-offline--ready-5a67d8?style=flat-square)](https://peteliao.github.io/RoamEtch/)
[![Live demo](https://img.shields.io/badge/demo-peteliao.github.io%2FRoamEtch-2bcda7?style=flat-square)](https://peteliao.github.io/RoamEtch/)

**RoamEtch** (Chinese name **迹刻**, pronounced *jìkè*) is a free, open-source GPS tracker and trip recorder that runs in your browser. **Roam** means roaming, road trips, and hiking exploration; **Etch** means etching journeys. Record hikes, bike rides, runs, road trips, and travel; analyze elevation and speed; import and export GPX; create shareable posters, replay videos, and self-contained trip pages; and stay together with end-to-end encrypted live meetups and ephemeral team chat. No account and no cloud trip library — your journeys stay in your own browser, and the installed PWA can open from your home screen like a native app.

**Try it online: [https://peteliao.github.io/RoamEtch/](https://peteliao.github.io/RoamEtch/)**<br>
Open it in any modern mobile browser. On iPhone and iPad, use Safari and choose “Add to Home Screen”.

> **No GPS?** The four main tabs are **Record, Trips, Team, and Settings**. Open Trips, load the demo trip, then choose **Overview / Data / Share** to explore analysis, posters, replay video, and self-contained HTML export. You can also visit `?demo=1`; contributors can use `?sim=1` to replay the demo as live GPS on a desktop.

> **TL;DR**: RoamEtch is a privacy-first, local-first GPX recorder PWA for hiking, cycling, running, road trips, and outdoor teams. It combines trip recording, elevation and speed analysis, shareable posters and videos, WGS-84 file export, and encrypted real-time teammate locations in one page — without sign-up.

## Screenshots

<p align="center">
  <img src="docs/screenshots/en/demo.webp" width="300" alt="Recording demo: a live track grows on the map; tapping Finish suggests a trip name, and saving returns to Auto detection with Start ready">
  <br><sub><b>Complete recording flow</b> · live track → Finish → name &amp; save → Auto / Start</sub>
</p>

<table>
  <tr>
    <td align="center" width="50%"><img src="docs/screenshots/en/record.png" width="280" alt="Live GPS track recorder with distance, duration, speed, altitude, ascent, and GPS signal"><br><sub><b>Live recording</b> · track, altitude, ascent, GPS signal, activity detection</sub></td>
    <td align="center" width="50%"><img src="docs/screenshots/en/meet.png" width="280" alt="Live meetup with an encrypted room, teammate positions, a rally point, team spread, and temporary markers"><br><sub><b>Live meetup</b> · teammate positions, rally point, team spread, encrypted markers</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/en/trips.png" width="280" alt="Local trip library, yearly footprint, and illuminated city map"><br><sub><b>Trip library</b> · local tracks, yearly stats, city footprints, batch import and export</sub></td>
    <td align="center"><img src="docs/screenshots/en/analysis.png" width="390" alt="Trip analysis with elevation, speed, slope, calories, and map waypoints"><br><sub><b>Trip analysis</b> · elevation/speed charts, slope, score, map waypoints</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/en/poster.png" width="292" alt="Share poster with route map, trip score, elevation profile, and branded QR code"><br><sub><b>Share poster</b> · route map, score, elevation, branded QR</sub></td>
    <td align="center"><img src="docs/screenshots/en/share.png" width="280" alt="Sharing and export with privacy circles, posters, video, GPX, and HTML"><br><sub><b>Share &amp; privacy</b> · privacy crop, poster/video, GPX and HTML</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/en/settings.png" width="280" alt="Settings with English and Chinese UI, metric and imperial units, and OLED-friendly themes"><br><sub><b>Personalisation</b> · bilingual UI, units, OLED-friendly themes</sub></td>
    <td align="center"><img src="docs/screenshots/en/install.png" width="280" alt="Install guide showing how to add the web app to the iPhone home screen"><br><sub><b>Home-screen install</b> · step-by-step on iOS, Android, desktop</sub></td>
  </tr>
  <tr>
    <td align="center" colspan="2"><img src="docs/screenshots/en/safety.png" width="280" alt="Safety settings with local contacts, privacy guidance, and notification options"><br><sub><b>Safety &amp; Check-in</b> · local credentials, emergency contacts, and notification options</sub></td>
  </tr>
</table>

## Why RoamEtch

- **Local-first, data ownership included**: trips, track points, waypoints, and photos live in your browser's IndexedDB. There is no account and no cloud trip library; back up, restore, or export whenever you want.
- **One page, complete workflow**: record → analyze → poster/video/HTML → GPX/GeoJSON/KML. The whole pipeline runs locally, so you do not need to move files between several tools.
- **Privacy is the default**: shared trip data lives only in the URL `#` fragment; start/end privacy circles trim sensitive track sections; photo EXIF is stripped before storage; coordinates stay in WGS-84.
- **Live meetup and encrypted chat with ciphertext-only relays**: a versioned invite carries a random public room id and a 256-bit secret; the secret never reaches the relay. Positions, text, thumbnails, and WebRTC signaling are encrypted with AES-256-GCM and forwarded by a public MQTT broker or your own WebSocket relay. HD originals move only on demand over a DTLS-encrypted one-to-one DataChannel, bypassing the meetup relay; rooms and messages are not stored in the cloud.
- **Maps that adapt to the network**: AMap and Tianditu in mainland China; OpenStreetMap, OpenTopoMap, and Esri elsewhere — automatically selected or manually overridden, with custom raster tiles supported. GCJ-02 offsets are applied only at render time.
- **Open source and auditable**: GPL-3.0, TypeScript with native DOM, no opaque SDKs. Deploy the static build to any host you trust.

**Made for**: weekend hikes, trail-running sessions, city rides, long road trips, travel footprints, camping and convoy coordination, finding friends in crowded places, and anyone who needs WGS-84 GPX files for Garmin, Strava, TwoNav, or other compatible tools.

## Features

### Record: open the page and go

- Live distance, total and moving time, current/average speed, pace, altitude, ascent/descent, calories, and GPS signal strength.
- Automatic activity detection for hiking, driving, cycling, running, and travel; change the activity at any time while recording.
- Pause/resume, add waypoints mid-recording, rename in the result sheet, and resume as a new segment after the browser is backgrounded or the screen locks. Tap Finish to save immediately and show a suggested trip name based on activity and time; edit it if needed, then tap Save. The track stays visible for analysis or sharing while the controls return to Auto detection and Start.
- Three recording-frequency presets (high accuracy, balanced, power saving), screen wake lock, fullscreen, and a true-black OLED pocket lock to reduce accidental touches and battery drain on long trips. Its button sits directly in the right-side map tools, and a smooth foreground-brightness slider keeps controls and text readable even at the minimum. The pocket lock is progress-only, with no pause, resume, or finish controls and no recording-state changes; hold the ring for 1.5 seconds to unlock. Locking the screen with the power button or backgrounding the browser can still pause geolocation.
- **Track editing**: Edit mode is available only for a finished trip opened from **Trips → View on map**, directly below OLED pocket lock. It reveals Undo/Redo underneath for node edits and track-point dragging; ordinary recording and freshly finished result tracks stay read-only.
- **In-app photo waypoints**: while recording or paused, open Node and choose Photo waypoint to shoot in the viewfinder and link each photo to the current WGS-84 position and altitude. Flash, vibration, continuous shooting, thumbnail, undo, and a “Done (N)” counter are included. Each shot keeps the in-app 1600 px version plus a full-resolution original that “Save original” can hand to the system through the share sheet, save picker, or a download; browsers cannot silently write to the OS photo gallery. Photos stay in local IndexedDB and are never uploaded.
- **Multi-photo waypoint editor**: select several album images at once or open the camera and shoot a burst inside the node editor. Every captured or selected image is appended to the waypoint until you save it.
- **Pocket-lock quick camera**: drag the bottom-right camera knob left by at least 120 px in the OLED pocket lock. Taps and short drags are ignored; the camera closes after 20 seconds without interaction, and a saved shot returns to the black pocket lock after 3 seconds or offers “shoot again” / “lock now”.
- **Re-walk**: follow a reference track with remaining-time estimates, lookahead turn prompts, persistent off-route timing, and optional heading-up navigation that stops when the map is moved manually. Spoken waypoint type, name, and notes still play as you approach each node. When you are far from the trip, explicitly open AMap or Google Maps to navigate to its start/end and use the map's turn-by-turn voice guidance; local distance and bearing announcements resume near the target. RoamEtch does not upload your live track.

### Analyze: understand the route, not just the line

- A compact 13-metric card (4 hero metrics + 9 details) covering distance, duration, average/max speed, pace, moving/stopped time, ascent/descent, max/min altitude, calories, and track points.
- Elevation profile and speed chart linked to the map; hover on desktop or press and drag on touch to locate the same point on the map and read live values.
- **Distance splits** at 500 m, 1 km, 2 km, or 5 km, with exact boundary interpolation in the background. Selecting a split row, chart, or map position highlights all three without drawing false lines across recording pauses.
- **Professional split metrics**: endpoint altitude, continuous net elevation change, average slope, stopped/break time, speed and pace variation, and thresholded climb efficiency, with explanations for missing altitude and calculation boundaries.
- **Two-track comparison**: load and simplify two tracks locally, then use a Worker to evaluate forward/reverse geometric alignment, mean/P95 deviation, matched coverage, distance ratio, and GPS quality. Select the worst-deviation sample to locate it on the map. Direction describes geometric correspondence; loops and parallel roads can remain ambiguous.
- Slope distribution, difficulty estimate, gap detection, timeline, and waypoints; calorie and trip-score estimates based on the selected activity.
- **GPS quality report and reversible cleaning**: real-sample accuracy, poor-fix ratio, time gaps, and altitude jumps produce a 0–100 score. Cleaning previews anomaly types, counts, and offsets, then keeps a durable original snapshot that can be restored or undone.
- One-click gap repair sends only the endpoints of a detected gap to a public routing service (BRouter / OSRM) to rebuild the missing road track. Multi-segment repairs commit in one transaction after rechecking the trip revision and original points; any failed segment rolls back the whole repair, and undo/redo cannot overwrite later edits.

### Organize: keep a growing library manageable

- Favorite and pin trips, add up to 8 tags, search names and tags, and filter by activity or favorites; sort by recently updated, newest, longest distance, or name.
- **Advanced filters**: combine search, activity, and favorites with inclusive local dates, distance/ascent ranges in the selected unit, photo presence, minimum waypoint count, recording-time completeness, place, and country. The cancellable IndexedDB index reads waypoint summaries without loading photo blobs.
- **All-history heatmap**: switch the yearly footprint between all years and one year, then generate a distance-weighted activity heatmap. Global privacy circles are applied before aggregation, recording segments are never connected, and progress/cancel/failure states are visible.
- **Yearly footprint**: a collapsed-by-default accordion above the trip list. Expand it for trips, distance, ascent, active days, and a 12-month distribution for each year, computed entirely from local trips. City identity includes country code to avoid merging same-named cities across countries.
- **Annual activity report and personal bests**: view monthly distance, activity trip share, active days, current/longest streaks, and weekly highlights by local calendar year. Personal 5 km / 10 km records are ranked separately by activity and moving time, with total time, pace, source range, split provenance, and boundary interpolation. Tracks are loaded locally one at a time only after the report is opened; trips and recording gaps are never stitched together.
- **Footprint sharing**: export a 1080×1620 yearly summary card or a 9-second 1080×1920 video with the original on-device soundtrack, with preview, save, and native share. Only yearly totals are drawn — no trip names, tracks, places, waypoints, or photos.
- **Travel story and book**: the trip Story tab groups tracks, nodes, and photos into local-day chapters, with a cover title, introduction, and per-day notes. Photos can be matched into a trip by EXIF capture time and GPS; candidates are previewed and can be confirmed or cancelled as a batch before writing. Weather is requested per day and location from Open-Meteo (recent forecast or historical archive), with source, sample time, cache state, and missing fields labeled, plus a clearly marked manual supplement. Sunrise and sunset are computed offline and shown separately from weather. Export a printable single-file HTML travel book with a cover, table of contents, routes, nodes, photos, and weather disclosure; privacy cropping is applied before day grouping. Fetching weather requires a network; offline, only cached days and manual values remain.
- Favorites, tags, footprint stats, and share artwork stay on this device — nothing is uploaded.

### Professional map tools

- Open Map tools from the Trips more menu to overlay several historical tracks on demand, with independent visibility, color, opacity, measured-slope coloring, and fit-all controls.
- Slope uses measured altitude and horizontal distance between adjacent points; missing altitude falls back to the track color, and recording segments are drawn independently.
- Look up WGS-84 or GCJ-02 coordinates. An explicit elevation query prefers trusted GPS values or a local cache; otherwise only the queried point is sent to the configured elevation service, never the whole track.
- Layer preferences stay local and do not retain track geometry. Contours, hillshade, and installable offline terrain packages are not provided.

### Share and export: turn a track into something people open

- **Posters**: portrait 1080×1920 and square 1080×1080, with route map, start/end time, trip score, GPS signal, elevation profile, sampled place names, and a branded QR code — theme-aware for dark and light canvases.
- **Share style editor**: posters and videos share a background (theme / night / paper), layout (map + info / map overlay), title font (sans / serif / mono), map ratio, track color and width, stats-card toggle, and custom title. Changes preview immediately, one tap resets them, and a trip or style change invalidates stale output so files never disagree with the preview.
- **Replay videos**: 10 / 15 / 30-second map replays with synchronized metrics and one of four original looping soundtracks, synthesized on-device, randomly chosen by default or selected manually, and muxed into the MP4 or WebM export. Choose auto push-in, follow, aerial, or fixed overview cameras; waypoint photos can cut in, and the elevation curve, distance, speed, and grade follow the replay. Rendering can be cancelled and never leaves a half-written file.
- **Self-contained HTML**: a single offline-capable page with full stats, elevation profile, zoomable map, waypoints, and photos — ideal for people who do not have the app. The progress bar and elevation chart can be scrubbed to a real held position, with route progress, current marker, stats sheet, and elevation cursor staying in sync; recording segments are drawn independently and never joined across gaps. Node photos open in a previous/next lightbox, Space/arrows/Home/End/zoom/R/T provide full keyboard control, and themes can be switched in place.
- **Standard files**: WGS-84 GPX (works with Garmin, Strava, TwoNav, and similar tools), GeoJSON, and KML. Import GPX, XML, and ZIP batches; batch-export ZIP.
- **Verifiable backup**: the v3 full-library ZIP carries SHA-256 content checksums, trip schema versions, and pre-clean original snapshots while retaining v1 and checksummed v2 restore compatibility; v2/v3 archives without valid integrity metadata are rejected. Restore shows the export time, contents, duplicate trips, and verification result, can download a snapshot of the current database first, and refuses corrupted archives. Before writing, restore validates archive size, paths, entries, and record relationships, then applies everything in one transaction that rolls back on failure. Ordinary ZIP imports stream entry by entry and hash media incrementally instead of buffering the whole archive. Decompression input is capped at 4 KiB slices, and the ZIP end record and central directory are validated. Pending reads cancel immediately; cancellation after a committed restore no longer misreports stored data as failed. Legacy encrypted backups still require one-shot envelope decryption. Backups can optionally be password-encrypted (PBKDF2-SHA-256 600,000 iterations + AES-256-GCM). New files use `.roametch.enc`; older `.trackmint.enc` backups remain restorable. Store unencrypted backups somewhere you trust.
- **Backup and restore history**: Settings keeps the latest 20 exports, pre-restore snapshots, restore results, restore drills, and failures. It stores only file summaries and counts — never passwords, tracks, or photos. History can be cleared separately and survives app-data erasure.
- **Guided restore drill**: synthetic trips and photos exercise export, integrity checks, skip/overwrite conflicts, corruption rejection, and rollback through the production pipeline. It runs only in two isolated temporary databases, never reads or writes real trips, deletes those databases afterward, and records a non-sensitive result in history.
- **Storage health and persistence**: Settings offers a bounded, cancellable read-only check for orphaned or malformed records, duplicate fixes, missing photos, and snapshot integrity, with progress plus track-point and photo-byte totals. You can also request browser persistent storage to reduce eviction risk; it does not replace a backup.
- **Compact import link**: pack a simplified track and waypoints into a URL `#` fragment under 1.5 KB. Opening it imports the trip; it is not a public page and contains no photos.
- **Privacy review**: start/end privacy circles, sensitive-waypoint hiding, independent start/end marker hiding, EXIF stripping, and WGS-84 export are shown together before you share or download. Marker choices stay consistent across poster, video, HTML, and travel-book previews and files.
- **Promo artwork**: generate a 1080×1350 card from Settings. Each theme ships 25 designs — eight product/feature templates plus 17 audience variants — with matching Chinese or English captions, picked at random without immediate repeats and browsable with “Next”. Product info and a QR code only; no personal data.

### Live meetup: stay together in real time

- Create a meetup invite (`TM2.<roomId>.<secret>`) and share it as a link or QR code; joining can scan a live camera frame or decode a QR image from the album, and the session auto-ends after 1, 2, 4, or 8 hours. Old v1 12-character codes are rejected with an explicit message and must be replaced by a new invite.
- The map shows your position and every teammate with live distance and bearing, using amber for the host and teal for members. It smoothly zooms in as teammates approach and pauses automatic framing after manual map controls; the list highlights the nearest teammate and stale signals, and can plan a team route to a selected teammate.
- The invite secret bootstraps the room: HKDF-SHA-256 derives an AES-256-GCM base key bound to the room id, with a per-session nonce prefix and monotonic counter; protocol v3 then rotates fresh epoch keys over pairwise ECDH channels. The room id (128 random bits) is independent of the secret (256 random bits), so the relay only sees a random public identifier and ciphertext. Ordinary packets use a strict per-sender sequence guard; RTC signaling is handled separately because redundant brokers can reorder it, and is protected by sender/message-id dedupe, a 30-second expiry, and per-sender rate limits. By default the app connects to several public MQTT WSS providers concurrently (EMQX China/global and mqtt-dashboard); the fastest node starts the session immediately, while every connected node also forwards outgoing ciphertext as redundancy. A custom MQTT URL and topic prefix in Settings or your own WebSocket relay are supported.
- Chat with online teammates after joining. Remote messages play a soft notification sound, animate the chat button, show an unread badge, and pulse the dot to the left of the persistent service-region label. Messages live only in this tab's memory: late joiners see no history, messages are not replayed after disconnection, and everything is cleared when the session ends. System notices cover joins, leaves, removals, rally-point changes, key rotation, and host changes; clients with an incompatible protocol version are rejected with an explicit reason and never silently downgraded.
- **Encrypted photo chat**: the camera button opens an in-app viewfinder with flip, torch where supported, album import, optional caption, and a preview showing compressed dimensions/size. Images step down for weak networks (720 px long edge, 480 px in low-data mode, 56 KB raw cap), are encrypted end-to-end, and have a 5-second sender cooldown. Received photos show an encryption badge, open in an enlarged viewer, and can pin their optional capture location on the map.
- **On-demand HD originals**: with the default-off peer-to-peer original switch enabled, choosing **Load original** creates a one-to-one WebRTC DataChannel. The file holder is always the Offerer; the original travels in 16 KiB chunks and is checked against SHA-256. A failure, timeout, or checksum rejection affects only that original — location, text, and thumbnails keep working. The connection closes after 30 seconds idle.
- Only the latest 20 chat thumbnails remain in session memory; older payloads become expired placeholders. The sender caches at most 10 originals/50 MB and the receiver at most 4 blobs/64 MB. Chat photos and originals are never written to IndexedDB, included in backups, or uploaded to a RoamEtch server.
- **Member key rotation and per-teammate visibility**: when a member joins, leaves, or is removed, the host distributes a new room-key generation through pairwise ECDH P-256 channels; removed members never receive the new secret, and the security strip shows the current generation. Each teammate row has an eye button that hides or restores your position for that teammate alone; while hidden, location packets are not broadcast to the room and are sent only to other visible teammates as pairwise encrypted direct packets, while room chat continues. The footer shows the remaining location-sharing time.
- Pause or resume sharing, remove a teammate on the host device, reset the invite (new room and key), or end the session. Expiry and manual end clear the local session.
- The invite, room, and chat exist only in the link `#` fragment and local memory; no cloud room is stored. Useful for hiking groups, convoys, camping, and crowded venues.

> Live meetup needs a network connection and browser location. Mobile operating systems may pause GPS when the screen is locked or the app is backgrounded. It is not an SOS or professional rescue tool. A frontend-only app cannot force a hostile client offline or erase positions already received by another device. A removed teammate stops receiving new room-key generations, but the invite remains a copyable bearer capability; if they still hold the full invite and rejoin under a new identity, clients cannot distinguish them. When P2P originals are enabled, both devices can see each other’s network IP addresses during ICE negotiation and transfer; STUN/TURN servers also receive the relevant connection metadata. Original bytes bypass the meetup relay, but a configured TURN server may carry the still-encrypted DataChannel traffic.

### Safety & Check-in: report that you are safe or ask for help

- Opt in after reading the bilingual risk disclosure in **Settings → Safety & Check-in**. Your sender alias, emergency contacts, webhook secrets, and TG credentials live only in independent local storage, outside trip sharing, GPX/KML/HTML exports, cross-device sync, and trip backups.
- Tap the map’s safety button for a check-in confirmation or hold it for 2 seconds to send SOS. When safety is enabled, OLED pocket lock also offers a dedicated SOS action. Keyboard activation is available, and manual sends have a 10-second cooldown.
- Reports use the original WGS-84 position with accuracy, altitude, distance, duration, battery, and activity state. Safety reports deliberately bypass global start/end privacy-circle trimming. AMap navigation links convert to GCJ-02 only for that navigation target; stored coordinates remain unchanged.
- Emergency email can use the system `mailto:` handler or self-hosted relay SMTP. The optional emergency phone stays local and only opens `sms:` offline; it is never uploaded to a server. Enterprise WeCom, Feishu, DingTalk, ntfy, Bark, and custom JSON webhooks are supported, with copy/text fallbacks when delivery fails. Webhook and relay URLs must use HTTPS.
- TG accepts a Bot Token, numeric or `@username` Chat ID, optional forum Topic ID, optional native location, and direct/custom-HTTPS/Node-relay/Cloudflare-Worker delivery. With native location enabled, it sends a WGS-84 location with AMap/Google/Apple navigation buttons, then replies with the complete HTML telemetry report.
- Automatic check-ins run every 15, 30, or 60 minutes while the page is visible, a recording is active, and the position is no more than 5 minutes old; automatic sends remain at least 15 minutes apart. On supported browsers, a configurable low-battery threshold sends one report per charging cycle. Hidden pages, OS suspension, unavailable APIs, and outages can prevent delivery.
- Before using TG, send `/start` to the bot. Private chats must permit bot messages; group chats require adding the bot and granting posting permission. Enter the target Chat ID and optional Topic ID, then run a test. Browser CORS/User-Agent restrictions, regional networks, API limits, inactive bots, outages, and revoked tokens can all fail delivery; use a supported self-hosted relay when direct access is restricted.

> Safety notifications do not guarantee rescue or message delivery. Browser visibility, system sleep, battery policy, location failures, and provider outages can interrupt automatic reports. Test with trusted contacts first and use local emergency channels as well in an emergency.

### Cross-device sync: two devices, no cloud copy

- In **Settings → Cross-device sync**, one device creates an `RMS1.` sync code and the other scans or pastes it. Both devices must be online at the same time and confirm the displayed device fingerprint. Sync codes carry an expiry and should only be shown to devices you trust.
- Each device has an ECDSA P-256 identity with a short human-checkable fingerprint. Signaling is encrypted through a blind relay that sees only a random room id and ciphertext; trips, tracks, waypoints, and photos move only over a WebRTC data channel. The first pairing pins the peer identity (TOFU); a later identity change is refused until you remove and re-pair the device.
- **Actually incremental**: the peer manifest carries a SHA-256 hash, version timestamp, and deletion tombstone per record, so only missing or changed rows move. Photos transfer in 16 KiB chunks with content hashes, and a final ledger digest confirms both sides match. Repeated syncs exchange only differences, deletions propagate, and a cancelled or failed transfer does not commit incomplete rows.
- The scope is finished trips, recording segments, track chunks, waypoints, and photos; story titles, day notes, and manual weather travel with the trip. Recordings that are active or paused are skipped at first pairing and arrive after they finish. Settings, backup history, elevation caches, repair snapshots, and quarantined rows are not synced.
- The sync ledger lives in a separate local database. Removing a paired device deletes only local pairing data and cursors, never trips, and cannot erase the other device. Sync is not a replacement for a full backup. There is no account, cloud copy, or automatic background sync.
- Advanced controls switch between public MQTT and a custom WS signaling relay and accept STUN/TURN entries for symmetric NAT. Relay addresses and TURN credentials stay on this device. If direct connection fails, configure TURN; the app never falls back to uploading data to a cloud store.

### Install and go offline

- A one-time install prompt appears on mobile; the same guide is always available in Settings, with platform-specific steps for iOS, Android, and desktop.
- Installed PWAs launch from the home screen and cache the app shell plus map tiles you have already viewed.
- Managed offline map packages are not available: unvisited areas may lack a basemap offline, and browsers may evict cached tiles. A complete offline region package requires an authorized map source, quota, and persistence strategy. A dedicated persisted Route database and frontend road-network route planner are also not implemented.
- Loaded screens, recording, statistics, posters, videos, and file exports work locally. First visits, uncached map areas, live meetup, and some place/routing services still need network access.
- App updates reload only after you confirm; the update action is disabled while recording or paused so it cannot interrupt a trip. Fixes that fail to reach IndexedDB stay buffered and retry automatically.
- Geolocation requires HTTPS (or localhost) and browser location permission.
- Map rendering uses MapLibre GL JS 6 and requires WebGL2 (supported by current Chrome, Edge, Safari, and Firefox).

### Maps and coordinates

- Mainland China network: AMap streets/satellite and Tianditu; global network: OpenStreetMap, OpenTopoMap, Esri imagery, and more. Choose automatically or override manually.
- Custom raster tiles are supported. If a basemap is offline or CORS-restricted, RoamEtch falls back to a vector-only drawing.
- Storage, analysis, GPX, GeoJSON, and KML always use WGS-84. GCJ-02 is applied only at render time for basemaps such as AMap, so source data is never polluted.

### Themes and languages

- OLED-friendly true-black dark, light, high-contrast sunlight, and a hacker-inspired **Matrix** theme. Matrix adds terminal typography, fluorescent green, grids, scanlines, and subtle digital rain, honors reduced-motion preferences, and suppresses all decoration in OLED pocket lock. Automatic mode still switches only between light and dark at local sunrise and sunset.
- Six UI languages: Simplified Chinese, Traditional Chinese, English, Japanese, Korean and Spanish, with metric and imperial units. UI language is independent from the map service region.

## Install on your phone or desktop

1. **iPhone / iPad**: open the [live app](https://peteliao.github.io/RoamEtch/) in Safari, tap **Share**, choose **Add to Home Screen**, then **Add**. iOS only exposes installation through the Safari share menu.
2. **Android**: open the app in Chrome or Edge, open the browser menu, and choose **Install app** or **Add to Home screen**.
3. **Desktop**: click the install icon in the Chrome/Edge address bar when it appears, or open **Settings → Home-screen icon** inside the app for step-by-step guidance.

Installation never uploads your data. Tracks and photos remain on this device. Export a full backup before clearing browser data or uninstalling the PWA.

## Quick start

Use the hosted app — no installation required:

**<https://peteliao.github.io/RoamEtch/>**

Local development or self-hosting:

```bash
npm install
npm run dev        # development server
npm run typecheck  # TypeScript type check
npm test           # core algorithm unit tests
npm run test:e2e   # Chromium end-to-end regressions
npm run test:offline # production-build offline export regressions
npm run test:memory # 20k-point production-build memory baseline
npm run build      # type check + production build (dist/)
npm run preview    # preview the production build
```

`dist/` is fully static. Deploy it to GitHub Pages, Cloudflare Pages, Netlify, Vercel, or any static web server. There is no business backend and no database to provision. CI runs typecheck, unit tests, Playwright end-to-end and offline regressions, the 20k-point Chromium memory baseline, and the production build on every push and pull request. The 52-cell physical-iPhone Safari/PWA matrix still requires separate pre-release capture, and its verifier fails while evidence is missing. Pushing a `v*` tag publishes a GitHub Release with `roametch-dist.zip` and pushes the container images.

### Docker self-hosting

The repository includes a multi-stage `Dockerfile` and an `nginx.conf` with correct PWA cache headers for `sw.js` and `index.html`. Release tags publish images to GitHub Container Registry:

```bash
docker run --rm -p 8080:80 ghcr.io/peteliao/roametch:latest
# open http://localhost:8080
```

Or build from source:

```bash
docker build -t roametch .
docker run --rm -p 8080:80 roametch
```

Geolocation and PWA installation on phones require HTTPS (except `localhost`), so put a TLS reverse proxy such as Caddy, Nginx, or Cloudflare Tunnel in front. This also works on a home NAS or a private server and does not depend on GitHub Pages.

### Private meetup relay (optional)

The default setup uses several public MQTT nodes concurrently and is suitable for testing. For a more stable or private relay, use the minimal blind WebSocket relay in [`relay/`](relay/README.md):

```bash
docker run --rm -p 8080:8080 ghcr.io/peteliao/roametch-relay:latest
# or from source:
cd relay && npm install && npm start
# or
docker build -t roametch-relay ./relay
docker run --rm -p 8080:8080 roametch-relay
```

Then choose **Settings → Team relay → Custom WS relay** and enter `wss://your-host/room/{room}`. The meetup relay forwards ciphertext only and stores no messages.

The same Node service can optionally enable stateless safety-notification forwarding and SMTP delivery for enterprise webhooks, TG, and email mode. It is off by default; when enabled, expose it over HTTPS with hostname/IP allowlists, an auth token, timeouts, and rate limits. Safety requests carry plaintext coordinates and notification credentials for delivery, but the service writes no coordinate or message logs. Setup steps, the Cloudflare Worker template, and the Node DNS-pinning limitation are documented in [`relay/README.md`](relay/README.md).

## Architecture

- Build: [Vite 6](https://vite.dev/) + TypeScript + native ES Modules, no frontend framework
- Maps: [MapLibre GL JS](https://maplibre.org/) with self-contained raster styles and no external style/font dependency
- Storage: [Dexie](https://dexie.org/) (IndexedDB); statistics run in a Web Worker
- Charts: [uPlot](https://github.com/leeoniya/uPlot)
- i18n: [i18next](https://www.i18next.com/)
- Files and photos: fflate (ZIP), exifr (EXIF parsing and stripping)
- Offline: [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) (Workbox)
- Meetup: v2 invite (random public room id + 256-bit secret) + protocol v3 + HKDF-SHA-256 + AES-256-GCM; ordinary packets use per-sender sequence replay protection, while RTC signaling uses sender/message-id dedupe, expiry, and per-sender rate limits. Pairwise ECDH P-256 channels rotate the room key when membership changes and carry per-teammate hidden locations. Positions, text, thumbnails, and signaling use concurrent public MQTT WSS nodes or a custom WebSocket blind relay; HD originals use on-demand WebRTC DataChannels.
- Camera: `getUserMedia` + inline video + Canvas; chat thumbnails are weak-network compressed and only the latest 20 remain in memory, while local shots become photo waypoints linked to WGS-84 coordinates and can export a full-resolution original during the session
- Safety: independent local notification settings, cooldowns, and automatic monitoring; direct provider calls or stateless Node-relay/Cloudflare-Worker forwarding; native TG location followed by an HTML telemetry reply, with GCJ-02 conversion limited to AMap navigation
- Tests: Vitest covers coordinate conversion, track statistics, backup integrity and encryption, yearly footprints, GPS quality, GPX/KML/GeoJSON, share links and share styles, meetup crypto and publish cadence, protocol rejection and ECDH key rotation, per-teammate visibility, MQTT frame validation, QR decoding, chat-image compression/validation, RTC signaling, ICE configuration, caches, and the transfer state machine, plus photo matching, story day grouping, weather parsing and travel books, sync identity/protocol/engine/transport, repository contracts, and Worker task dispatch/cancellation. Playwright covers demo analysis, privacy cropping, posters, text-only HTML export, the encrypted backup round-trip, in-app photo bursts/save/undo/original download, multi-photo nodes, two-client encrypted text and image chat, camera and image QR join, public MQTT delivery, on-demand WebRTC originals/privacy refusal/room-reset races, and OLED anti-mistouch/auto-lock; CI runs typecheck, unit tests, E2E, offline regressions, the 20k-point memory baseline, and the production build
- Safety tests: six-language disclosures, local credential isolation, cooldowns and automatic reports, low-battery deduplication, TG two-message/topic/coordinate/HTML escaping, offline fallbacks, and Node/Worker allowlists, payload sanitization, and safe errors
- Self-hosting: multi-stage Dockerfile + nginx.conf; an optional minimal blind relay template lives in [`relay/`](relay/README.md)

```text
GPS / GPX / photos
       │
       ▼
  recorder ──────► IndexedDB (Dexie) ──────► statistics worker
       │                    │
       ├── live map         ├── charts / score / gap repair
       │                    ├── poster / video / standalone HTML
       │                    └── GPX / GeoJSON / KML / backup
       │
       └── live meetup
             ├── positions / text / thumbnails / RTC signals
             │      └── on-device encryption ──► public or custom relay (ciphertext only)
             └── requested HD original
                    └── on-demand WebRTC DataChannel ──► teammate (DTLS; optional TURN)
```

## How it compares

| Capability | Typical cloud fitness platform | Generic GPS logger | RoamEtch |
| --- | --- | --- | --- |
| Account and cloud | Usually requires an account | Not always | No account, no cloud trip library |
| Track storage | Vendor cloud | Local files or device | Local IndexedDB with full backup |
| GPX import / export | Often limited by plan or format | Usually supported | Import GPX/XML/ZIP; export GPX/GeoJSON/KML |
| Elevation, speed, slope analysis | Yes | Basic or external tools | Built in, with charts, score, and gap repair |
| Poster / video / standalone HTML | Rare | Rare | All generated locally |
| Live teammate locations and chat | Yes, through cloud accounts | Uncommon | End-to-end encrypted temporary rooms and chat |
| China / global basemaps | Depends on product | Usually manual setup | Automatic detection plus manual override |
| Offline use | Limited | Recording often works offline | PWA shell + previously viewed map tiles |
| Open source and auditable | No | Depends on project | GPL-3.0, full source available |

## Privacy and data boundaries

RoamEtch is designed to keep data on your device, but “local-first” does not mean every network request disappears. Here is the precise boundary:

- **Stored locally**: trips, track points, waypoints, photo thumbnails, and settings live in IndexedDB/localStorage. There is no account system, business backend, or in-app analytics reporting.
- **Safety notifications**: only an explicit opt-in followed by a manual or automatic trigger sends precise WGS-84 coordinates and telemetry to your configured email, webhook, TG destination, or relay, so safety reports bypass global privacy-circle trimming. Credentials and contacts remain in separate local storage and never enter trip exports, shares, sync, or trip backups. The optional Node relay forwards requests and sends SMTP mail in memory without persisting coordinate/message logs; the Cloudflare Worker is likewise stateless. Receiving providers still handle location, IP, and message data under their own policies, which RoamEtch cannot control.
- **Share links**: trip data and meetup invites are placed only in the URL `#` fragment. Browsers do not send the fragment to servers; anyone who receives the link can read the data inside, so share only with people you trust.
- **Live meetup**: positions, text, thumbnails, and RTC signaling are encrypted on-device. The default public MQTT relay or a custom relay sees only ciphertext and the random public room id. The room id (128 random bits) and the invite secret (256 random bits) are generated independently, so observing the topic reveals no key material. Leaking the invite does expose positions and chat. Old v1 invites are rejected rather than downgraded. A relay can observe ciphertext packet sizes and timing, so it can infer that a thumbnail or signal is being sent, but cannot see its contents.
- **Photos and P2P originals**: EXIF location data is stripped before local storage. Chat thumbnails are redrawn/compressed in memory from the camera or album, never written to the device gallery or IndexedDB, and only the latest 20 remain in the session. HD originals are off by default and move only after an explicit request over a DTLS-encrypted WebRTC DataChannel, with SHA-256 and image validation. They bypass the meetup relay and remain in bounded memory caches, but both devices can observe each other’s network IP addresses; STUN/TURN servers receive connection metadata and a configured TURN server may relay encrypted bytes. Exported posters, videos, and HTML use the locally processed images only.
- **External service requests**: basemap tiles, elevation, place-name, and routing services require network access and receive the coordinates/viewport needed to render or compute a result, plus normal network information such as your IP. When generating a poster or video, sampled coordinates may be sent to OpenStreetMap-based reverse geocoding to label the route, and the result is cached locally. Gap repair and meetup routing send endpoints only when you explicitly trigger them. These requests never upload photos or the full trip library.
- **Device risk**: clearing browser data, uninstalling the PWA, or changing devices removes local trips — keep a full backup. Anyone who can unlock your device may be able to read browser storage.
- **Full backups**: the backup ZIP contains complete tracks, waypoints, and photos. By default it is not encrypted, so anyone with the file can read it. You can set a password when exporting to produce an encrypted `.roametch.enc` file; older `.trackmint.enc` backups remain restorable (PBKDF2-SHA-256 600,000 iterations + AES-256-GCM). The password is never stored and cannot be recovered. Either way, keep backups somewhere you trust.
- **Original music**: replay-video soundtracks are synthesized in the browser; no external music files are downloaded or bundled.

## FAQ

### Is RoamEtch free and open source?

Yes. It is released under GPL-3.0. The hosted version is free, with no account or paywall, and you can deploy `dist/` to your own static host.

### Does it upload my tracks?

Not to a RoamEtch business server: there is no business backend or cloud trip library. Third-party basemap, elevation, place-name, and routing services receive coordinates required for those specific features; see “Privacy and data boundaries” above.

### Can I record offline?

Yes. Once installed as a PWA, the app shell and map tiles you have viewed are cached, and recording, statistics, and exports run locally. Uncached map areas, online place names, live meetup, weather fetching, cross-device sync, and some routing services need network access.

### Which file formats are supported?

Import: GPX, XML, and ZIP archives containing GPX/XML. Export: GPX, GeoJSON, KML, image posters, MP4/WebM replay videos, self-contained HTML, printable travel-book HTML, and full-library backups. GPX, GeoJSON, and KML use WGS-84.

### Is live meetup secure?

Positions, text, thumbnails, and WebRTC signaling use AES-256-GCM end-to-end encryption; the invite carries a 256-bit secret, and the public room id is independent of it. Public or custom relays only forward ciphertext; messages and thumbnails live only in memory and have no replay history. Thumbnails have a 5-second sender cooldown and only the latest 20 remain in memory. HD originals are disabled by default: after you explicitly enable P2P and load one, a one-to-one DTLS DataChannel verifies SHA-256 and transfers it without the meetup relay. This exposes the devices’ network IP addresses to each other and relevant metadata to STUN/TURN. Original bytes never enter IndexedDB or backups. Send invites through a trusted channel, not a public group. Old v1 12-character codes and incompatible protocol versions are rejected explicitly, never silently downgraded. When members join, leave, or are removed, the host distributes a new room-key generation over pairwise encrypted channels; removed members do not receive it, and the old key is kept for only 20 seconds for in-flight packets. Positions can be hidden per teammate; while hidden, they are sent only as pairwise encrypted direct packets to other visible teammates. There is still no independent sender identity authentication or forward secrecy: anyone holding the invite can rejoin and receive a new key, and a relay cannot stop a modified client from spoofing an identity or saving what it already received. RoamEtch is not an SOS/rescue device and cannot stop someone who has received a position, message, or photo from saving it.

### Is cross-device sync secure?

The sync code contains an ephemeral access secret and should only be shown to a trusted device. The relay sees only a random room id and AES-GCM-encrypted signaling; trips, tracks, waypoints, and photos travel directly over a DTLS-encrypted WebRTC data channel with SHA-256 verification. The first pairing pins the peer identity, and a later identity change is refused. During NAT traversal both devices may learn each other’s public IP addresses; STUN/TURN receive connection metadata, and a configured TURN server forwards the still-encrypted traffic. There is no account or cloud copy and no automatic background sync. Removing a paired device cleans up only local records and cannot erase data already received by the other device. Sync excludes settings, backup history, elevation caches, and unfinished recordings, and it is not a replacement for a full backup.

### Does recording continue with the screen off?

RoamEtch requests a screen wake lock while recording, and the OLED pocket lock keeps a true-black progress dashboard visible and awake without hiding the page. Its smooth foreground-brightness slider reduces OLED foreground power use while keeping controls and text visible at the minimum. It does not change recording state and has no pause, resume, or finish controls; hold the ring for 1.5 seconds to unlock, while a tap does nothing. It cannot prevent system sleep: iOS and Android may still pause browser geolocation when the screen is locked with the power button or the app is backgrounded. RoamEtch re-locates and resumes when you return. Drag the pocket-lock camera knob left by at least 120 px to shoot without unlocking; the camera closes after 20 seconds without interaction and returns to the black lock 3 seconds after a shot. Behavior depends on the OS and battery policy, so keep the app in the foreground for critical activities.

### Why do maps differ between regions?

RoamEtch selects a service stack by network region: AMap/Tianditu in mainland China and OpenStreetMap/OpenTopoMap/Esri elsewhere. You can override the basemap manually. GCJ-02 offsets are applied only at render time; storage and export remain WGS-84.

### How do I install it on my phone?

On iPhone/iPad, open in Safari and use **Share → Add to Home Screen**. On Android, use the Chrome/Edge menu and choose **Install app** or **Add to Home screen**. On desktop, click the install icon in the address bar. The in-app Settings page also walks through each platform.

### How do I delete or migrate my data?

Delete a single trip from the trip library, or clear site data in the browser to remove everything locally. To migrate, prefer cross-device incremental sync in Settings for finished trips, tracks, waypoints, and photos, or use **Backup / Restore**. Sync excludes settings, backup history, elevation caches, and active recordings; share links and individual exports do not include the full photo library. None of these replace a full backup.

### Why the name “迹刻”?

Roam means roaming, road trips, and hiking exploration; Etch means etching journeys. The Chinese name 迹刻 sounds like 即刻 (“right now”) — open the page and record immediately. Roam free, etched into your map. Data stays yours—never in the cloud.

## Contributing

Issues and pull requests are welcome. When reporting a bug, include the browser/OS, whether the app is installed as a PWA, the map region, reproduction steps, and expected behavior. Remove meetup invites, share links, and personal tracks first. Before submitting code, run:

```bash
npm run typecheck
npm test
npm run build
```

Run `cd relay && npm test` as well when changing the relay. Project conventions, dual-region test methods, and debug entry points are in [CONTRIBUTING.md](CONTRIBUTING.md); modules and data flow are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the security model and private vulnerability reporting are in [SECURITY.md](SECURITY.md); community standards are in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md); release notes are in [CHANGELOG.md](CHANGELOG.md).

The project is committed to local-first storage, no accounts, no cloud trip library, and WGS-84 data. When adding a dependency or external service, document its privacy impact as well.

## License

[GPL-3.0](LICENSE) © 2026 Peteliao

Released under the GNU General Public License v3.0. You are free to use, modify, and redistribute it, provided derivative works remain under the same license and retain the copyright notice.

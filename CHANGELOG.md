# Changelog

All notable changes to RoamEtch are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions use
[Semantic Versioning](https://semver.org/).

## [3.14.0] - 2026-11-28

### Added

- Added Safety & Check-in with explicit bilingual disclosure, manual check-ins and
  SOS from the recording map, keyboard activation, and an OLED pocket-lock SOS action.
- Added local-only safety contacts and credentials, email/SMS fallbacks, enterprise
  webhooks, ntfy, Bark, custom JSON webhooks, optional relay SMTP, scheduled check-ins,
  and one low-battery report per charging cycle.
- Added TG delivery through the direct Bot API, a custom HTTPS API root, the Node
  relay, or the Cloudflare Worker, including chat/topic targeting and native WGS-84
  locations with accuracy, heading, and localized navigation buttons.
- TG telemetry follows the location as an HTML reply with sender, time, coordinates,
  accuracy, altitude, distance, duration, battery, activity, and report status.

### Changed

- Kept safety credentials in independent local storage, outside trip exports, sharing,
  synchronization, and reset-preserved trip data. Settings reset now clears safety
  credentials and contacts without deleting trips, waypoints, or photos.
- Expanded safety setup and delivery-limit guidance across Simplified Chinese,
  Traditional Chinese, English, Japanese, Korean, and Spanish.
- Compacted promotional-preview actions while preserving save/share availability
  detection and the three-action fallback on unsupported browsers.
- Updated the optional Node relay to Node.js 20+ and patched Nodemailer 10.6.1,
  with clean frontend and relay dependency audits.

### Fixed

- Included direct TG channels in automatic scheduled and low-battery reporting.
- Kept the Safety action clickable in the expanded recording panel, enforced HTTPS
  notification transport in the client and both relays, and stopped skipped mail drafts
  from turning successful automatic delivery into a failure.
- Persisted attempted low-battery reports across reloads so each charging cycle sends
  at most one low-battery report.
- Sanitized Node relay and Worker payloads, rejected mismatched location/telemetry
  targets, normalized TG heading to the Bot API range, and prevented provider errors
  from exposing notification credentials.
- Removed empty conditional Webhook fields from the rendered DOM so TG forms no
  longer display stray null text.

## [3.13.0] - 2026-11-28

### Added

- Added live weather from Open-Meteo Global and CMA GRAPES with automatic latency
  probing, fastest-provider selection, local caching and offline fallback.
- Added configurable custom weather endpoints, headers, field mappings and alert
  parsing for regional or self-hosted weather APIs.
- Added compact top-bar weather, extreme-weather OLED pocket alerts and recorded
  trip weather snapshots surfaced in stories and travel-book exports.

### Changed

- Rebuilt all 25 promotional designs across six languages around a shared alignment
  grid, clearer type hierarchy, quieter contour backgrounds and consistent cards.
- Reworked the recording-recovery flow with numbered steps, symmetric status tags,
  semantic interruption markers, an independent gap-repair module and equal stats.
- Simplified promotional footers with a soft QR tile, highlighted URL, compact
  language list and high-contrast supporting text for light and contrast themes.

### Fixed

- Fixed promotional preview action alignment, wrapping and overflow on narrow
  screens, including the three-action layout when file sharing is unavailable.
- Kept long localized promotional copy within canvas bounds without ellipsis and
  preserved QR readability across every supported theme.

## [3.12.0] - 2026-11-28

### Added

- Added Smart video pacing with route-node reading and photo holds, an endpoint
  dwell, and a final promotional outro.
- Added a route waypoint type. Recording creates route nodes by default while
  retaining every other waypoint type, and custom route names drive poster and
  video route labels in route order.
- Added map-picked meet rally points, rendered-member overview fitting,
  zoom-scaled markers, and clearer incompatible-client update guidance.

### Changed

- Square posters now reserve chart space in both stacked and overlay layouts,
  and generic promotional images draw each complete localized slogan on one line.
- OLED pocket lock is available while idle as well as during recording.
- Service-worker updates activate and clean outdated caches without reloading
  during recording or while an unsaved overlay is open.

### Fixed

- Prevented video node cards and photo cut-ins from covering the route, restored
  waypoint photos with thumbnail/original fallback decoding, and aligned the
  poster and video route endpoints.
- Fixed automatic and manual full-track fitting, story-header alignment, excess
  analysis-chart gutters, and Wake Lock acquire/release races.

## [3.11.0] - 2026-11-28

### Added

- Added stable privacy-circle center offsets and an optional start/end-only
  cropping mode, with clear warnings and coverage across recording segments.
- Added recording/privacy break labels, optional dashed recording-gap links,
  direction arrows, 1×/2×/5× replay, speed/slope profiles, and waypoint-centered
  map/replay synchronization to standalone HTML exports.
- Added a large-gap repair prompt after driving and cycling recordings, linked
  directly to the Data tab's track-repair card.

### Fixed

- Added a negotiated, persist-before-ack completion handshake so synchronization
  no longer reports a false incomplete result when the connection closes immediately
  after the final protocol message.
- Unified exported distance, waypoint distance/progress, profile axes and replay
  on the final simplified geometry, including segment boundaries and overlapping
  out-and-back routes.
- Fixed privacy intersections on multi-edge tracks and continued end-only trimming
  across fully hidden segments without exposing the next segment's hidden prefix.

## [3.10.0] - 2026-11-28

### Added

- Added complete Traditional Chinese, Japanese, Korean and Spanish UI
  localization alongside Simplified Chinese and English, including browser
  language detection, localized dates, exported pages and re-walk speech.
- Added translation coverage tests for all six languages, including key and
  interpolation-placeholder parity.

### Changed

- Each localized slogan now renders in full on one proportional line in
  Settings and is included on every generic promotional image.
- Promotional captions and documentation now advertise all six UI languages.

### Fixed

- Corrected singular and plural English and Spanish backup, export and story
  counts, and made re-walk speech prefer an exact Chinese locale or script voice.
- Kept every localized slogan within narrow mobile cards across platform font
  fallbacks without reducing it below the proportional readability threshold.
- Calibrated Chromium startup and recovery node budgets for the overlapping
  outgoing map and incoming shell during reload, while retaining the stricter
  post-garbage-collection growth limit.

## [3.9.1] - 2026-11-28

### Changed

- Replaced the advertising slogan everywhere with the bilingual
  “漫游有迹，刻入舆图；数据归己，不寄云端。” / “Roam free, etched into your
  map. Data stays yours—never in the cloud.” Canvas posters, track videos, and
  HTML exports render it on two lines so the longer copy fits.
- The trip library activity filter is now one dropdown — all, hike, drive, bike,
  run, travel, favorites — defaulting to all, replacing the chip row.

### Fixed

- Track comparison now fits the map to the actual A and B segment geometry
  instead of leaving the viewport near Beijing with no visible tracks, and the
  map section explains that it overlays only the selected two tracks.
- The comparison result no longer renders a literal `null` after its note when
  there are no invalid points.
- The comparison panel no longer overflows horizontally on phones: selectors,
  summary cards, charts, and the map stay within the sheet, while wide split
  tables scroll inside their own container.
- Past-route suggestions now state that selecting one replaces track B only and
  never adds a third track.
- Video photo cut-ins now include the node description instead of showing only
  the photo, title, and type.
- Meet “fit team” no longer double-counts the bottom-sheet inset, so the whole
  team is framed above the panel instead of leaving the camera unchanged; using
  it also pauses automatic proximity zoom for 12 seconds.

## [3.9.0] - 2026-11-28

### Added

- Added a share-style editor shared by posters and videos: theme/night/paper
  backgrounds, stack/overlay layouts, sans/serif/mono title fonts, map ratio,
  track color and width, stats-card visibility, and a custom title, with live
  preview, one-tap reset, and stale-output invalidation.
- Added four video camera paths — auto push-in, follow, aerial, and fixed
  overview — plus waypoint photo cut-ins and a replay-synced elevation cursor
  with live distance, speed, altitude, ascent/descent, and grade. Video rendering
  remains cancellable and never leaves a half-written file.
- Added interactive standalone HTML replay: real progress-bar and elevation-chart
  scrubbing that keeps the chosen position, route progress with a moving marker,
  recording segments drawn independently, a node photo gallery and lightbox with
  previous/next, keyboard control (Space, arrows, Home/End, zoom, reset, theme),
  and consistent preview/export privacy.
- Added independent start- and end-marker hiding to posters, videos, HTML, and the
  travel book, separate from the start/end privacy circle.
- Added a trip Story tab that groups a track into local-day chapters, independent
  of recording segments, with a cover title, introduction, per-day notes, day
  metrics, nodes, and photos. Photos can be matched by EXIF capture time and GPS
  into a previewable candidate list and confirmed or cancelled before writing.
- Added per-day, per-location weather from Open-Meteo (recent forecast or
  historical archive) with temperature, condition, rain probability, wind, and UV,
  explicit source/sample-time/network/cache labels, partial-field disclosure, and
  manual supplements stored locally. Sunrise and sunset are computed offline with
  NOAA and shown separately as ambient context, never as weather data.
- Added a printable single-file travel book with cover, table of contents, day
  chapters, route sketches, nodes, photos, weather disclosure, and sunrise/sunset
  notes. Privacy cropping, sensitive-node hiding, and start/end icon choices are
  applied before day grouping, so hidden geometry never reaches the file.
- Added real cross-device incremental sync in Settings. Devices pair by `RMS1.`
  QR code or pasted code using an ECDSA P-256 device identity and a human-readable
  fingerprint; signaling is AES-GCM encrypted through the same blind relay model,
  and trip bytes move only over an authenticated WebRTC data channel with TOFU
  device pinning.
- Sync compares SHA-256 record hashes against a paged manifest, applies
  last-writer-wins versions and tombstones, and pages missing records by table.
  Media moves in 16 KiB chunks with per-payload hashes, and a final ledger digest
  verifies both sides before completion. The sync ledger lives in a separate
  `roametch-sync` IndexedDB so erasing pairing data never deletes trips.
- Added paired-device management, per-peer last-sync/count details, cancellable
  transfers, relay/STUN/TURN overrides, and clear privacy copy. In-progress
  recordings are skipped on first pairing; once finished, a later sync brings
  them over.
- Added protocol v3 to live meetups: explicit protocol-range/feature negotiation
  with hard rejection, ephemeral ECDH P-256 pairwise channels, host-driven epoch
  key rotation on join/leave/removal/host election, a 20-second old-key grace for
  in-flight packets, and per-teammate location visibility. System chat now covers
  key rotation and host changes, and the security strip shows the key generation.
- Added formal storage and service boundaries: `TripRepository`,
  `MediaRepository`, `RouteRepository`, `DexieSyncDataRepository`,
  `SyncDataRepository`, and `BackupService`, with contract tests. UI sync code goes
  through `SyncService`, and remaining raw Dexie reads are confined to the
  storage layer.
- Extended Worker coverage to streamed GPX import, GPX/GeoJSON/KML export,
  heatmaps, two-track comparison, annual reports, profile resampling, and backup
  archive construction. Shared workers now release when idle, abortable tasks get
  dedicated workers, large point arrays use transferables, and session tokens stop
  stale replies from overwriting newer state. Cancelling one task no longer kills
  other tasks or falls back to blocking the main thread.

### Changed

- The share view now groups privacy, style, and export controls and reuses one
  normalized style across posters, videos, and HTML/book output.
- Trip detail adds a Story section between Data and Share; story text and manual
  weather travel with the trip record and therefore participate in backup and
  sync.
- Large GPX exports switch to the Worker above 100k points, backup ZIP creation
  runs in the Worker, and GPX imports at or above 256 KiB stream in a dedicated
  Worker with acknowledgement-based backpressure and cleanup on cancel.
- Documentation, changelog, security notes, and architecture diagrams now cover
  protocol v3, incremental sync boundaries, the repository layering, and Worker
  ownership.

### Security

- Sync relay traffic contains only a random pairing room id plus AES-GCM
  ciphertext; the invitation secret is carried out of band and never sent to the
  relay. The data channel uses ephemeral WebRTC DTLS keys, and a changed peer
  identity is refused instead of silently re-pinned.
- Team epoch rotation is not full forward secrecy: the base invitation key still
  bootstraps `hello`, and a removed member who retains the full invite can rejoin
  under a new identity. Pairwise direct packets hide locations from a hidden
  teammate but reveal that ciphertext is being sent to others.

### Not included

- Device sync is explicit and device-to-device only. There is no account, cloud
  history, automatic background sync, or server copy. Settings, backup history,
  elevation caches, repair snapshots, quarantined rows, and unfinished recordings
  are not synchronized; sync is not a replacement for a full backup.
- Weather requires a network. Cached days and manual supplements are the only
  offline sources, and a cached forecast is labeled rather than refreshed
  silently.

## [3.8.0] - 2026-11-27

### Added

- Added temporary team markers with six types (here, rally, supply, danger, scenic,
  parking), custom labels, and 15/30/60/120-minute choices. Markers carry creator,
  coordinates, creation time, and expiry; they are capped at 8 per teammate and 48 per
  session, expire on every device, and disappear on leave or removal. Reconnection
  republishes remaining lifetime without extending older markers.
- Added a host-only rally point with a label, clear action, map card, team distance, and
  system-chat notice. Other members can view and fit to it but cannot move or clear it.
- Added a team-spread view computed locally from fresh, unexpired positions, including
  the farthest pair and a one-tap “fit team” action.
- Added configurable local distance and rally-point drift alerts with a 100–5000 m
  threshold, 1/3/5/10-minute cooldown, a near-to-far transition rule, and a global
  on/off switch. Alerts use a local system notification and send no additional data.
- Added signed invite lifetimes of 1 hour, 6 hours, 24 hours, or 7 days. The host signs
  the expiry with HMAC-SHA-256 inside the link, and joiners reject expired, tampered, or
  wrong-room expiry parameters with distinct errors. Link expiry stays independent of
  the session auto-end timer and does not affect members already in the room.
- Added teammate capability exchange and an explicit legacy badge/system notice so
  older clients are visible without silently weakening the current packet format.
- Added join, leave, removal, rally-point-set, and rally-point-cleared system chat rows,
  plus sender-side sliding-window limits for text, voice, markers, and rally points.
- Added Simplified Chinese and English copy, settings controls, map pins, sheet layouts,
  and unit tests for collaboration helpers, signed invite expiry, marker lifecycle,
  host-only goals, legacy notices, and sender limits.

### Changed

- The team panel now shows the rally point, temporary markers, team spread, invite
  lifetime, and legacy teammates alongside existing location and chat controls; the
  marker and rally-point tools remain usable while sharing is paused only where local
  editing is safe.
- Marker and rally-point data travel as encrypted `mk` and `goal` packets inside the
  existing room protocol; the relay still receives only room-scoped ciphertext.

### Not included

- At this release the raw TM2 invite remained a bearer secret and signed expiry could
  not revoke an already-copied key. Key rotation/revocation on membership change,
  per-peer location visibility, protocol rejection, and roadmap items 20–23 were
  deferred; 3.9.0 delivers the membership and protocol parts and the remaining
  product-deepening items.

## [3.7.1] - 2026-11-27

### Security

- Overrode the build-time `glob` dependency of `workbox-build` to 14.0.6 so its
  transitive `minimatch` resolves to 11.0.9, resolving the Dependabot
  GHSA-g3hv-75wg-m249 globparts amplification advisory. `npm audit` reports zero
  vulnerabilities and PWA precache generation was rebuilt and verified.

## [3.7.0] - 2026-11-27

### Added

- Added combined advanced trip filters for inclusive local dates, distance and
  ascent ranges in the selected unit, photo presence, point count, recording-time
  completeness, place, and country. The cancellable IndexedDB index reads waypoint
  summaries without loading photo blobs.
- Added all-history and per-year activity heatmaps with distance-weighted sampling,
  global privacy circles applied before aggregation, Worker calculation, and explicit
  recording-segment boundaries. City identities now retain country code and
  administrative area to avoid merging same-named cities across countries.
- Added an annual activity report with monthly distance, activity trip share, active
  days, current/longest streaks, weekly highlights, and personal 5 km / 10 km records
  ranked separately by activity and moving time. Record details expose elapsed and
  moving time, cumulative source range, split/part provenance, and boundary
  interpolation without stitching across trips or recording gaps.
- Added professional split metrics: endpoint altitude, continuous net elevation,
  average slope, stopped and break time, speed/pace variation, and thresholded climb
  efficiency. Split rows, charts, and the analysis map share one guarded selection.
- Added local two-track comparison with Worker calculation, forward/reverse geometric
  alignment, mean/P95 deviation, matched coverage, distance ratio, GPS quality,
  sampling limits, and clickable worst-deviation locations.
- Added multi-track map tools with on-demand loading, visibility/color/opacity controls,
  measured-slope coloring, fit-all, WGS-84/GCJ-02 coordinate lookup, and explicit
  single-point elevation-service disclosure. Layer preferences are stored locally
  without retaining track geometry.
- Enhanced rewalk navigation with remaining-time estimates and speed sources,
  lookahead turn prompts, persistent off-route timing, segment-safe projection, and
  optional heading-up following that stops when the map is manually moved.
- Added complete Simplified Chinese and English copy for the new workflows.

### Changed

- Large-track Worker messages now use transferable columnar typed arrays instead of
  cloning object graphs. GPX streaming yields cooperatively, IndexedDB track reads
  page through chunks, and geometry-only views no longer load photo blobs.
- Export summaries, thumbnail hydration, map warming, and HTML size estimates use
  bounded preview samples; formal exports retain complete track precision and privacy
  clipping. Map edit indexes are built only for visible vertices.
- The million-point Chromium import → storage → Worker → map → edit → export → cold
  start regression now meets its original 10 s long-task and 12 s frame-gap budgets.
  This remains synthetic desktop-browser evidence, not physical-device soak evidence.

### Fixed

- Annual reports now attribute a cross-year personal record to the local year in
  which the effort actually starts, and keep successful records when one track fails
  or is missing so the affected year/activity can be retried later. The report no
  longer renders a literal `null` placeholder or collapses monthly bars.
- Privacy clipping treats a zero radius as “no circle cropping” even when explicit
  start/end anchors are supplied, and fails closed when a positive-radius anchor is
  invalid so uncropped geometry can never leak through an export.
- Map tools restore and persist the chosen overlay order, and support picking a
  WGS-84 coordinate directly on the map without automatically sending it to an
  elevation service.
- Re-walk turn and waypoint announcements, annual report/share, comparison, filter,
  and map-tool copy now use complete Simplified Chinese and English keys with filled
  placeholders instead of raw key names or empty `{{...}}` tokens.
- Longitude interpolation in distance splits and personal records is antimeridian
  aware, so efforts crossing ±180° no longer gain false distance or false records.

### Not included

- Managed offline map packages, a dedicated persisted Route domain/library, and
  road-network route planning remain planned work. Cached PWA tiles are not presented
  as offline map packages. No contour, hillshade, or offline terrain layer is claimed
  without an authorized data source.

## [3.6.0] - 2026-11-27

### Added

- Scoped asynchronous edits, undo/redo, altitude backfill, rewalk, and navigation to
  stable trip sessions with cancellation and stale-result suppression.
- Separated team network contact from GPS sample freshness, including weak/stale/paused
  location states, accuracy trends, update age, and out-of-order packet protection.
- Upgraded full backups to format v4 across all nine tables, including share-import
  fingerprints and quarantine records, with historical v1–v4 restore fixtures.
- Added persistent quarantine preview, backup, restore, and discard flows for damaged
  records instead of silently deleting them at startup.
- Added recording-quality trends, fix age, sampling/completeness metrics, storage and
  battery warnings, and explainable multi-feature activity classification.
- Expanded the signed physical-iPhone release gate to 64 cells, including independent
  incoming-call, network-switch, and web-app-update evidence, a configurable TTL,
  attachment verification, and mandatory release-workflow enforcement.
- Added a production Chromium stress suite for million-point import → IndexedDB →
  Worker → map → edit → export, accelerated eight-hour recording recovery, and CDP
  throughput/latency/packet-loss/offline shaping. These are synthetic desktop-browser
  regressions, not physical-iPhone or real-world soak evidence.
- Added classified, explainable GPS repair with selectable reasons, before/after
  overlays and metrics, Worker previews, persistent repair versions, and scoped restore.
- Added verified pre-migration checkpoints, streaming fingerprints, quota-safe failure
  before upgrade, and automatic rollback when post-migration verification fails.
  Rollback journals survive interrupted restarts, and shared/exclusive cross-tab locks
  keep ordinary writes out of migration and recovery windows.

### Changed

- Large-track map simplification, GPX export, repair previews, and cancellable compute
  tasks now use Workers; unchanged trip versions reuse track arrays, statistics,
  previews, and share-link work instead of repeating full-track calculations.
- Backup export and restore now enforce a 256 MiB envelope and 3,000,000-point
  combined limit with actionable GPX/media/share-import guidance and transaction-time
  conflict checks.
- Media cleanup previews revalidate TTL, content versions, and references under a Web
  Lock and again inside the deletion transaction.

### Fixed

- Mid-recording waypoint text/photo save, move, delete, undo, and redo now retain the
  active recorder trip without leaking edits across trip sessions or views.
- Live map following now starts before the asynchronous trip metadata read, keeping
  the first fixes centered above the expanding recording-quality panel.
- Stale team heartbeats, duplicate packets, and delayed location packets can no longer
  restore GPS freshness or move a peer's last-known position.

## [3.5.0] - 2026-11-27

### Added

- Added privacy-safe backup history and a guided restore rehearsal that exercises
  export, integrity checks, conflict handling, corruption rejection, and rollback
  in isolated temporary databases without reading or writing real trips.
- Added a 52-cell physical-iPhone release-evidence contract and verifier covering
  Safari/PWA, large tracks and backups, offline use, lifecycle interruptions,
  quota, memory pressure, and system termination. Real-device evidence remains
  required before that release gate can pass.
- Added production Chromium memory regressions for 20,000-point cold startup,
  storage-health scans, GPS cleanup/restore, and recording-spill recovery, with
  heap, task, script, transient-node, and retained-node budgets.

### Changed

- Gap repair and GPS cleanup now prepare all results before writing and commit
  through version-guarded transactions; stale or concurrently changed tracks are
  rejected instead of overwritten.
- Ordinary ZIP backup imports decode bounded 4 KiB slices, validate the ZIP end
  record and central directory, cancel pending reads immediately, and preserve
  committed restores when cancellation arrives at the commit boundary. Legacy
  encrypted imports retain their one-shot compatibility path.
- Storage-health scans, cleanup previews, recording recovery, and snapshot summaries
  now use bounded reads, compact Worker plans, streamed media-content revisions, or
  cursor aggregation instead of retaining complete large-track and media arrays.

### Fixed

- Temporary restore-drill databases are closed and deleted on success, abort,
  failure, blocked deletion, and timeout; incomplete cleanup never reports success.
  The drill now injects a failure after overwrite deletions and verifies the prior
  target state is restored before certifying transactional rollback.
- Backup history records committed restores before user callbacks, imports legacy
  history before the first new row, and excludes passwords, paths, blobs,
  coordinates, and track data.
- Version 2/3 backups without valid integrity metadata are rejected; prepared
  inspections reverify payload and media digests before restore, and cancelled
  routing, progress callbacks, transactions, or unavailable-Worker fallbacks no
  longer continue sensitive or expensive work after cancellation. Cancelling a
  blocked compute task terminates its Worker so synchronous work and cloned track
  data are released immediately.
- Storage-health scans retry when concurrent inserts change table counts or a
  final consistent read transaction detects equal-count updates, and fail
  explicitly if writes continue instead of reporting transient state as corruption.
- Gap repair, GPS cleanup/restoration, and backup restore bind cancellation to the
  active write transaction so pre-commit cancellation rolls back while an already
  committed restore remains successful.
- Quick-photo save/undo and active-recording reattachment refresh waypoints or use
  bounded previews without materializing the full track and media library.

## [3.4.0] - 2026-11-26

### Added

- Added bounded recorder persistence with a 5,000-fix pending cap, explicit
  degraded save status, coalesced flush requests, and emergency spill retention
  until every accepted batch is durable.
- Added unit and real IndexedDB/mobile-browser regressions for storage failure,
  recovery, bounded altitude patches, and streaming altitude backfill.

### Changed

- Stream altitude backfill one track chunk at a time and bound late-altitude
  correction to the newest 32 chunks to reduce peak memory on large trips.

## [3.3.0] - 2026-11-26

### Added

- Added production iPhone WebKit offline cold-start and GPX, HTML, vector-poster,
  and backup export coverage, plus mobile Chromium media persistence and verified
  binary backup coverage. CI, Pages deployment, and release verification now run
  this offline gate.
- Added bounded streaming GPX imports with batched point/waypoint writes, ZIP entry
  streams, cancellation, malformed-entry draining, and transactional rollback of
  unpublished imports.
- Added read-only unreferenced-media cleanup previews, expiring one-time tokens,
  explicit danger confirmation, and transactional reference revalidation.
- Added atomic waypoint/media persistence so photo writes, reference updates, and
  last-reference deletion roll back together.

### Changed

- Multi-trip ZIP and full-backup exports now compress entries incrementally instead
  of materializing every uncompressed entry and an extra whole-archive copy.
- ZIP extraction now bounds entry count, decompressed entry size, and queued bytes
  across entries while preserving streamed parser input.
- Storage health copy now distinguishes read-only inspection/preview from confirmed
  destructive cleanup.

## [3.2.5] - 2026-11-26

### Changed

- Theme startup, pending-spill recovery, and interrupted-trip map previews now use
  bounded IndexedDB queries instead of materializing full tracks and media.
- Added read-only trip previews capped at 16 chunks and 500 points, while explicit
  analysis, editing, and export continue to load complete trip data.
- Added unit and real-IndexedDB regressions for large-track startup, first-point
  lookup, timestamp recovery, and preview/full-load separation.

## [3.2.4] - 2026-11-26

### Added

- Added a named database migration registry with read-only preflight checks,
  post-migration row/schema verification, and explicit recovery guidance.
- Added real IndexedDB regressions for v1–v3 upgrades, future-schema blocking,
  failed-transaction rollback, repair/recovery, and legacy backup restores.
- Added backup trip-schema validation and transactional isolation of damaged
  segments, chunks, and original-track snapshots.

### Changed

- Database preflight now runs before theme initialization can implicitly open
  Dexie, and native IndexedDB versions are mapped to logical schema versions.
- Unsupported trip schemas are rejected in both upgrading and current databases
  without clearing existing trip data.

## [3.2.3] - 2026-11-26

### Added

- Added deterministic GPS scenarios for hiking, cycling, driving, drift, location
  loss, altitude spikes, stationary periods, sudden stops, background suspension,
  and network switching.
- Added accelerated scenario playback through the real recorder, with 4/8-hour
  recording coverage and 100k/500k/1M-point generation and statistics benchmarks.

### Changed

- Exposed simulation tools through the diagnostics harness and the
  `?sim=1&scenario=...` entry point while preserving built-in GPX demo playback.

## [3.2.2] - 2026-11-26

### Changed

- Stopping a recording now prunes empty segments from chunk counts without loading
  the full track, waypoints, or photo blobs.
- Interrupted-trip recovery loads track-only data and rebuilds summary statistics in
  a worker without allocating chart series.
- Live map updates are batched and long-running geometry is bounded while preserving
  recent detail and route endpoints.
- Poster exports skip unused per-point series to reduce peak memory on large trips.

## [3.2.1] - 2026-11-26

### Added

- Added reversible GPS cleanup with anomaly type/count/offset previews, a durable
  chunked pre-clean snapshot, stale-preview protection, and original-track restore.
- Added fixed-distance splits at 500 m, 1 km, 2 km, and 5 km, computed off the main
  thread with exact boundary interpolation and linked map/chart highlighting.
- Added read-only storage health checks for orphaned or malformed records, duplicate
  fixes, missing photo blobs, snapshot integrity, point counts, and photo bytes.
- Added persistent-storage status and an explicit browser persistence request in
  Settings, with clear guidance that persistence does not replace backups.

### Changed

- Upgraded full backups to format v3 with trip schema versions and pre-clean snapshots,
  while retaining legacy v1/v2 restore compatibility and transactional validation.
- Statistics cache writes no longer change a trip's edit timestamp, so derived results
  do not invalidate an unchanged track-editing preview.
- Trip edits now receive transactionally monotonic revision timestamps, while cache-only
  writes remain revision-neutral.
- Backup exports read all database tables from one consistent read transaction.
- Altitude backfill merges into the latest chunk rows instead of overwriting concurrent edits.
- Statistics, charts, fixed-distance splits, and shared-link distances now exclude invalid,
  backwards, and duplicate timestamps consistently.
- Failed undo/redo actions remain available for retry, concurrent history operations are
  serialized, and failed statistics workers are replaced with a main-thread fallback for
  pending work.
- Live altitude results now merge into the latest chunk without dropping concurrent appends.

### Fixed

- GPS restoration now leaves segments created after the snapshot untouched and rejects
  tracks or snapshots that changed after confirmation, even if their timestamp did not.
- Snapshot and backup validation now reject duplicate, missing, or noncontiguous chunk
  sequences, snapshot-index mismatches, and malformed point records before restoration writes.
- Track appends now select the highest chunk sequence, and overwrite restores atomically
  remove shared-link mappings for replaced trips.
- GPS anomaly map navigation now uses the correct latitude/longitude order.

## [3.1.7] - 2026-11-25

### Added

- Added Sakura mist, Butterfly dream, Pearl, and Rose themes with refined light
  and dark palettes across the interface, MapLibre controls, canvas artwork,
  promotional variants, and standalone HTML exports.

### Changed

- Rebuilt Neon and Starship backgrounds with soft atmospheric light, sparse
  accents, and restrained navigation details instead of dense grids, scanlines,
  and high-contrast HUD framing.

## [3.1.6] - 2026-11-25

### Added

- Added 17 audience-specific promotional designs and matching Chinese/English
  captions for solo outdoors, road crews, travel creators, cross-border users,
  frontend/open-source learners, endurance athletes, commuters, families,
  overland travelers, event leaders, field researchers, track-data stewards,
  yearly-memory keepers, night/OLED users, dog walkers, site visitors and loved
  ones.
- Expanded every explicit theme from 8 to 25 promo designs while retaining the
  original feature artwork and applying each theme palette to all new artwork.
- Added a 25-option promo preview selector alongside random and sequential
  switching, with synchronized image, filename, caption, save and share state.

### Changed

- Rewrote existing promotional copy to remove absolute privacy claims and clarify
  local storage, cached offline use, relay metadata, session cleanup, online
  services and on-device video rendering.
- Corrected README wording about yearly image dimensions and network-dependent
  services.

## [3.1.5] - 2026-11-25

### Added

- Renamed the high-contrast theme to Blazing sun and added Neon, Starship,
  Aurora, Amber, Deep sea, and Vermilion themes across the interface, MapLibre
  controls, canvas exports, and standalone HTML viewer.
- Added activity-type editing for finished trips, with immediate recalculation of
  activity-dependent statistics while preserving raw points and trip metadata.

### Fixed

- Separated the yearly footprint month summary from month labels, kept privacy
  copy inside the footer border, and placed city count beside the headline KPIs.
- Cleared live recording metrics and signal immediately after finishing, and
  ignored late recorder ticks or altitude results from the previous session.
- Centered recording and teammate markers in the visible map area above bottom
  panels, including panel collapse and viewport resizing.

## [3.1.4] - 2026-11-25

### Added

- Added a smooth foreground-brightness slider to OLED pocket lock, with a
  readable minimum and persistent setting that leaves the true-black background
  unchanged.
- Added remote team-chat notification sounds, an animated chat button and unread
  badge, and a synchronized alert on the persistent service-region dot.
- Added distinct amber host and teal member map colors, plus smooth proximity
  zoom that frames approaching teammates and pauses after manual map controls.

### Changed

- Removed the redundant Map Tools panel; Edit mode now sits directly below OLED
  pocket lock and reveals Undo/Redo underneath without overlapping record controls.
- Trip charts now use their actual container width and tighter axis gutters to
  reduce empty space while keeping labels readable.

### Fixed

- Preserved proximity auto-zoom after an initial single-person fit, camera
  movement, and basemap style reloads.

## [3.1.3] - 2026-11-25

### Added

- Added a manual Matrix theme with fluorescent-green tokens, terminal typography,
  subtle digital rain, grids, scanlines, and glow across the responsive UI and
  MapLibre controls.
- Applied Matrix palettes to posters, recap videos, promotional artwork, yearly
  footprint images/videos, and standalone HTML exports; exported HTML can cycle
  through all four manual themes.
- Added palette, settings-persistence, promo-rendering, and browser regression
  coverage for Matrix switching, narrow screens, reduced motion, OLED pocket
  lock, and exports.

### Changed

- Matrix keeps raster basemaps in full color while adapting vector backgrounds,
  tracks, controls, and attribution; reduced-motion users get static decoration.
- OLED pocket lock temporarily returns to pure dark without changing the saved
  Matrix preference or recording state, then restores Matrix after unlocking.

### Fixed

- Preserved Matrix track colors on dark raster maps and corrected dark-theme
  detection in promotional and yearly-footprint artwork.

## [3.1.2] - 2026-11-25

### Added

- Added explicit cross-city re-walk navigation through AMap in mainland China
  and Google Maps elsewhere, with a privacy notice, external turn-by-turn voice
  guidance, and local distance/bearing announcements near the target.
- Added navigation-link, approach-voice, map-editing, and re-walk browser
  regression coverage.

### Changed

- Moved the passive OLED pocket-lock button into the right-side recording map
  tools without adding recording controls.
- Moved Yearly Footprint below the Trips header as an accessible accordion that
  is collapsed by default and loads its map only when expanded.

### Fixed

- Limited map editing and waypoint changes to finished trips opened from Trips
  with “View on map”; ordinary recording and finished-result views stay read-only.
- Restored visible Undo/Redo controls in Edit mode and redraw the trip map after
  edits, undo, and redo.

## [3.1.1] - 2026-11-25

### Fixed

- Restored regular mouse and touch clicks on Finish instead of requiring the
  previous long-press or swipe gesture.
- Kept the suggested activity-and-time trip name in the result sheet, renamed
  its dismissal action to Save, and restored Auto detection with Start after a
  successful finish.
- Updated the bilingual README animated demos to show recording, finishing,
  naming, saving, and the next-trip ready state.

## [3.1.0] - 2026-11-25

### Changed

- Reduced the main navigation to Record, Trips, Team, and Settings. Trip
  Overview, Data, and Share now live under one trip detail with a single active
  trip selection.
- Kept finished tracks visible after recording and added an inline result sheet
  for naming and opening analysis or sharing. OLED pocket lock is now passive:
  recording continues without pause, resume, or finish controls, and a 1.5-second
  hold unlocks it.
- Moved the trip list ahead of yearly footprints, consolidated import and data
  management actions, and reorganized Settings into six sections with team and
  basemap controls under Advanced and seven-tap developer-tool unlock.
- Preserved generated exports across same-trip refreshes, invalidated stale work
  only after real trip changes, added dynamic privacy summaries and shared empty
  states with record, sample, and import actions, and limited share prewarming to
  the visible Share section.
- Added team unread badges, a live team-status indicator, a clickable recording
  indicator, retained ephemeral chat drafts, accessible modal focus management,
  camera/QR focus traps, and live-region toasts.
- Added browser-history handling for trip detail, dialogs, the result sheet,
  camera, and QR scanner, plus normalized and validated cross-view navigation.
- Added chart legend toggles, touch scrubbing readouts, expandable timeline rows,
  chart render caching, and stable recorder metric nodes.
- Made requested pre-restore snapshots mandatory for restore and moved shared-link
  deduplication into a durable transactional IndexedDB index.

## [3.0.0] - 2026-11-24

### Added

- Eight bilingual, data-free promo variants with preview cycling.
- Recap videos with nodes, notes, and photos; city footprints, lit maps, and
  random music.

### Changed

- Rebranded the app as **RoamEtch (迹刻)** and moved the hosted app to
  `https://peteliao.github.io/RoamEtch/`. Roam means roaming, road trips, and
  hiking exploration; Etch means etching journeys.
- Release assets and GHCR images now use `roametch-dist.zip`,
  `ghcr.io/peteliao/roametch`, and `ghcr.io/peteliao/roametch-relay`. Legacy
  protocol identifiers remain for compatibility, and older `.trackmint.enc`
  backups remain restorable alongside new `.roametch.enc` exports.

### Fixed

- Reliable WebRTC originals, offline thumbnail recovery, merged elevation/speed
  charts, rewalk pronunciation, camera tap-to-focus, and background GPS recovery.

### Removed

- **Record:** manual-create button removed without affecting existing trips.

## [2.5.0] - 2026-11-24

### Added

- A 36-emoji picker in encrypted meetup chat, with cursor-aware insertion and
  large emoji-only bubbles. Emoji continue to use the existing ephemeral,
  end-to-end encrypted text-message path.
- WeChat-style press-and-hold voice messages with live waveform, duration,
  slide-up cancellation, keyboard hold support, automatic 15-second stop, and
  one-at-a-time playback. Voice uses bounded 64 KB Opus/WebM, Opus/Ogg or MP4
  packets over the existing encrypted relay and is never persisted.
- Microphone permission and recording-error guidance in Chinese and English,
  plus cleanup of audio players and object URLs when messages expire or chat
  closes.

### Tests

- Added protocol validation, encrypted packet-size, in-memory expiry, emoji and
  voice session tests, plus a real two-client Chromium E2E covering emoji,
  recording, encrypted delivery, playback and slide-to-cancel.

## [2.4.0] - 2026-11-24

### Added

- Opt-in WebRTC delivery for full-resolution meetup chat originals. Encrypted
  thumbnails still use the existing MQTT/WS relay; the original moves only after
  an explicit request over a one-to-one DataChannel, with the file holder always
  acting as Offerer.
- Targeted, encrypted RTC signaling for pull requests, rejection, Offer/Answer,
  ICE and abort. Signals are bounded, expire after 30 seconds, use a 500-entry
  sender/message-id deduplicator, and are rate-limited per sender so redundant
  broker delivery cannot start duplicate sessions.
- Reliable 16 KiB original transfer with SCTP backpressure, SHA-256 and image
  header/dimension verification, 10-second connection timeout, 30-second idle
  cleanup, and a two-session sender limit. The sender keeps at most 10 originals
  or 50 MB in memory; evicted files are reported as expired.
- Original-image progress, cancellation, retry and inline failure states in
  encrypted chat, plus an original viewer and save action. Location, text and
  thumbnails remain usable when a direct connection fails.
- A default-off P2P privacy switch with a first-use IP-visibility notice, three
  bundled STUN defaults, and optional custom STUN/TURN credentials stored only
  in local settings. No public TURN server is bundled.

### Fixed

- Fresh P2P opt-in now survives reload instead of being mistaken for a legacy
  settings record; RTC dedupe is scoped by sender and expires over time.
- RTC signaling has an independent bounded send lane and incoming per-sender
  rate limits, keeping signaling floods away from the location/chat send chain.
- Optional HD preparation failures fall back to the thumbnail, and preparation
  that spans an invite reset can no longer publish into the new room.
- Original requests require an exact SHA-256 match. Cancellation and cache keys
  include the peer/file/hash identity, preventing cancelled transfers from
  reopening and collisions across senders or reused file ids.
- Binary framing rejects empty, short, or extra chunks. The connection deadline
  now lasts until the DataChannel opens, stalled transfers time out, and late
  async completions cannot revive closed sessions.
- Leaving, removal, and invite reset close P2P sessions even for peers no longer
  present in the ordinary member list.
- STUN and TURN textareas now initialize their live values correctly, so the
  default ICE pool and saved custom configuration are visible and editable.

### Security

- Documented the split between strict ordinary-packet sequence replay checks
  and RTC sender/message dedupe, the DTLS DataChannel boundary, memory limits,
  peer/STUN/TURN IP visibility, and the fact that original bytes bypass the
  meetup relay while TURN may carry encrypted traffic.
- Upgraded i18next to the patched 26.3.4 release, restoring a clean
  `npm audit --omit=dev` result. Remaining moderate glob/minimatch advisories
  are confined to the development-only Workbox build chain.

### Tests

- Added transport state-machine tests for fixed-Offerer handshakes, early ICE,
  exact chunk framing, duplicate EOF, checksum rejection, backpressure,
  expiry/privacy refusal, sender limits, channel-open and stalled timeouts,
  oversized requests, and synchronous cancellation.
- Added RTC sender-aware dedupe/rate-limit, ICE configuration, original-cache,
  settings-migration, thumbnail-fallback, and room-reset race regressions.
- Added a real two-client Chromium E2E test that verifies lazy connection,
  encrypted relay signaling, wrong-hash rejection, original
  bytes/hash/dimensions, download, privacy refusal and continued chat after
  failure, plus default-off/custom ICE persistence and failure-path E2E cases.

## [2.3.0] - 2026-11-24

### Added

- One-tap “save original” for every quick camera shot. The full-resolution JPEG
  is kept transiently in the camera session and handed to the system through the
  Web Share files sheet, the File System Access save picker, or a download
  fallback. Browsers cannot silently add files to the OS photo gallery, so the
  saved chip and OLED result card expose this action explicitly instead of
  pretending the original was already in the album.
- Meetup join by QR code: scan a live camera frame or choose a QR image from the
  album. Both paths normalize through the existing v2 invite parser and reject
  legacy or malformed codes explicitly.
- Waypoint editor photo actions now accept multiple album files at once and an
  in-camera burst. Every captured or selected image is appended to the node, and
  the pending strip is cleaned up when the editor closes.
- The quick camera keeps the shutter available after each save, so a burst is
  added as separate photo waypoints until the photographer taps Done.
- Multiple default public MQTT providers (`broker-cn.emqx.io`,
  `broker.emqx.io`, and `mqtt-dashboard.com`) connect concurrently. The app
  subscribes everywhere to maximize reachability and selects the fastest
  responding connection while retaining the others as redundancy; empty custom
  URLs now mean automatic public selection.

### Changed

- The OLED pocket-lock action rail now stacks the swipe-to-shoot track above the
  1.5-second unlock button. Drag feedback is interpolated with
  `requestAnimationFrame` and a CSS custom property, so the knob follows the
  finger without layout churn while the 120 px anti-mistouch threshold, tap
  rejection, 20-second camera idle close, and 3-second relock remain unchanged.

### Fixed

- Public MQTT meetups failed to connect because SUBACK validation rejected real
  3-byte acknowledgements (packet id plus grant byte). The parser now accepts
  standards-compliant SUBACK packets and still rejects malformed or refused
  subscriptions.
- The save-original button no longer shares the undo button class, keeping the
  undo action unambiguous for assistive selectors and automated tests.

### Tests

- Added QR pixel decoding tests, a Playwright camera-scan and image-scan join
  test, and a gated two-client public MQTT test that creates a room, joins from a
  second browser context, sends text and an encrypted image, and asserts each
  message appears exactly once.
- Extended camera E2E coverage for original-image download, three-shot bursts,
  multi-select node photos, and burst photos inside the node editor. The OLED
  test now asserts the camera rail sits below the unlock control.

## [2.2.0] - 2026-11-24

### Added

- Embedded in-PWA camera for encrypted meetup chat photos. It uses
  `getUserMedia`, an inline viewfinder, album/shutter/flip controls, torch where
  supported, a quick preview with compressed dimensions/size, and an optional
  caption. The PWA stays in the foreground instead of handing off to the system
  camera, reducing iOS Safari background pauses.
- Weak-network chat image encoding: WebP where supported with JPEG fallback,
  quality and dimension stepping, a 720 px long edge (480 px in low-data mode),
  and a 56 KB raw-image cap before encryption/base64 expansion.
- Incoming chat photos show an encryption badge, open in an enlarged viewer,
  and can pin their optional WGS-84 capture point on the map.
- One-tap photo capture while recording or paused. Each shot becomes a local
  photo waypoint linked to a fresh-enough WGS-84 position and altitude, with
  flash, vibration, thumbnail, undo, burst capture, and a saved-shot counter.
  Media, waypoint, and trip timestamps commit atomically; paused or stale
  captures request a one-shot fix without adding a track point.
- OLED pocket-lock camera rail: drag the bottom-right knob left by at least
  120 px to open the camera without unlocking. A tap or short drag does nothing;
  the camera closes after 20 seconds without interaction, and a saved shot
  offers “shoot again” or a 3-second automatic return to the black pocket lock.

### Changed

- Meetup relay frame limits are now 128 KB on the client, bundled relay, and
  custom WebSocket receiver so compressed encrypted photos fit after base64
  expansion. Oversized frames are rejected deterministically with close code
  `1009`. The relay also bounds message bytes and queued outbound bytes, closing
  abusive or slow peers with `1008` or `1013`; malformed MQTT frames terminate
  with `1002` and do not reconnect.
- Chat photos use a 5-second sender cooldown and a 4.25-second receiver gap.
  Only the latest 20 image payloads remain in session memory; object URLs are
  bounded and revoked, and chat photos are never written to IndexedDB.
- Camera streams and the iOS 1 px keepalive video are coordinated so closing a
  camera or finishing an OLED shot re-arms keepalive without stopping GPS or the
  meetup relay.

### Security

- Untrusted image packets validate base64 shape and decoded size, MIME, integer
  dimensions, coordinate/accuracy ranges, and encoded WebP/JPEG headers before
  entering chat state or decoding pixels; declared dimensions must match the
  header and stay within the edge/pixel budget.
- Image memory and URL caches are bounded; pruned payloads render an explicit
  expired placeholder instead of retaining old photos.
- Chat captures refresh coordinates at shutter time, and paused photo captures
  request a fresh one-shot fix both when opening and when saving. Local album
  inputs are bounded to 32 MB and 40 MP, with JPEG/PNG/WebP headers checked before
  object URL creation or pixel decode. Discarded preview jobs cannot replace a
  newer capture, and late save results release their thumbnails after camera close.
- MQTT control flags and body lengths are validated; malformed or unsupported
  packets terminate with `1002`. Relay binary frames count against rate/byte
  budgets before rejection, and forwarded ciphertext remains a text frame.

### Tests

- Added image compression/validation unit tests, a 100 KB relay pass / 129 KB
  relay reject boundary test, and Playwright fake-camera coverage for quick
  photo save/undo, pending-save thumbnail cleanup, oversized-album rejection,
  stale-preview isolation, two-client encrypted image delivery and map locate,
  OLED anti-mistouch, 3-second auto-lock, and 20-second idle close.

## [2.1.0] - 2026-11-23

### Added

- Optional password encryption for full-library backups. Encrypted backups use a
  `TRKMBKP1` envelope with PBKDF2-SHA-256 (600,000 iterations), a random 16-byte
  salt, and AES-256-GCM, and are saved as `.trackmint.enc`. Restoring prompts for
  the password, retries without touching local data on failure, and shows the
  integrity and snapshot preview before writing.
- Playwright end-to-end smoke suite covering demo analysis and chart switching,
  privacy crop, poster rendering, text-only HTML export, encrypted backup
  export → wipe IndexedDB → restore, and the iOS storage nudge. CI runs it on
  every push.
- Release workflow for `v*` tags: typecheck, unit tests, build, a
  `trackmint-dist.zip` release asset, and GHCR images `ghcr.io/peteliao/trackmint`
  and `ghcr.io/peteliao/trackmint-relay`.
- Closable 7-day IndexedDB eviction warning on iOS in a browser tab, with
  Add to Home Screen and backup actions. Dismissal is remembered locally.
- Animated bilingual WebP demos in both READMEs, regenerated with
  `npm run promo:webp`.

### Changed

- Meetup publishes adapt to movement: about 5 seconds between updates while
  moving and 25 seconds when stationary, instead of one fixed cadence.
- Re-walk speech is primed synchronously inside the start gesture so iOS
  `speechSynthesis` works on the first waypoint; the global voice toggle is
  persisted across sessions.
- Video export detects WebM-only browsers and explains the limitation before
  and after export.
- Self-contained HTML export offers clear / light / text-only image tiers,
  per-tier photo budgets, and an estimated file size before export.
- The bundled relay now enforces 8 KB frames, a per-socket token bucket,
  room/client caps, and a 12-hour idle-room sweep; docs cover reverse-proxy
  per-IP limiting.
- SECURITY documents that host-kick is advisory and explains how authority
  differs between the public MQTT broker and a self-hosted relay.

### Fixed

- The restore file picker now accepts `.trackmint.enc` backups instead of
  filtering them out.

## [2.0.0] - 2026-11-23

### Added

- Meetup protocol v2: invites are now `TM2.<roomId>.<secret>`, with a random
  128-bit public room id and an independent 256-bit secret. The relay topic and
  WS path contain only the room id.
- HKDF-SHA-256 derives a non-extractable AES-256-GCM key bound to the room id,
  with a per-session nonce prefix and monotonic 32-bit counter.
- Strict per-sender replay protection for every packet type. Locations, status,
  and hello packets cannot be replaced by older or repeated sequences, and chat
  keeps its random message-id dedupe set.
- Protocol tests for invite entropy and normalization, HKDF/AAD separation, v1
  envelope rejection, tamper detection, nonce uniqueness, and replay handling.

### Changed

- The meetup UI shows a public room label, the full invite token, and separate
  copy-invite / copy-link actions. QR codes and deep links carry the v2 invite.
- Default MQTT prefix is `trackmint/v2/meet`; settings migrate only the exact old
  default prefix, and relay docs describe the public random room id.
- README, SECURITY, ARCHITECTURE, and relay documentation now describe the v2
  encryption boundary, legacy retirement, and the remaining Phase 2/3 work
  (sender identity authentication, host authority, key rotation, forward secrecy).

### Fixed

- Replay of an early-session packet is rejected instead of passing a sliding
  window.
- A reset or relay switch during in-flight encryption can no longer publish
  old-room ciphertext to the new room.

### Security

- **Breaking:** the retired 12-character meetup code and v1 invites/packets are
  rejected with an explicit message; there is no silent downgrade. Existing
  teams must create and share a new v2 invite.
- The invite secret never appears in the relay topic, URL query, HTTP path, or
  relay log. Anyone holding the full invite remains a room member by design.

## [1.9.0] - 2026-11-22

### Added

- Failure-safe recording persistence: incremental saves are serialized, failed
  writes stay buffered and retry every five seconds, and `pagehide` spills pending
  fixes to local storage so they can be recovered on the next boot.
- Explicit save status in the live panel and a retry banner when fixes cannot be
  written or a trip cannot be finalized.
- PWA update prompt: a new service worker waits for confirmation, and the update
  action is disabled while recording or paused so a reload cannot interrupt a trip.
- Recorded-time and gap-time rows in the analysis sheet and self-contained HTML
  export; the gap row appears only when a trip actually has inactive intervals.
- Unit tests for archive path traversal, oversized entries, zip-bomb ratios,
  manifest count/relationship errors, missing media, and transactional rollback.

### Changed

- Backup restore now validates every archive entry and manifest relationship
  before writing, then restores trips, segments, chunks, waypoints, media, and
  overwrite deletions in a single IndexedDB transaction. Restore reuses the
  inspected archive instead of unzipping it twice.
- Statistics now separate wall duration, recorded/active time, moving time,
  still time, and gap time. Pauses and intervals longer than 60 seconds no longer
  inflate still time.
- Version strings come from `package.json`; the app, diagnostics, About panel,
  and promo artwork report 1.9.0 from one source.

### Fixed

- Pause and finish no longer report success when pending track points failed to
  reach IndexedDB; they keep the recording state and show a retry action.
- Starting a recording cleans up its lock, wake lock, timers, and a newly created
  trip if setup fails.
- Unsupported geolocation and temporary OS location loss now pause the recording
  instead of continuing without fixes. Synchronous `watchPosition` failures are
  handled, and a failed resume rolls back to the paused state.
- Appending points updates chunks, segment end time, and trip update time
  atomically.

### Security

- Backup archives are capped at 256 MB compressed and 512 MB uncompressed, with
  per-entry, entry-count, manifest-size, point-count, duplicate-path, compression
  ratio, and path-whitelist checks. Missing media and inconsistent record
  references block restore.

## [1.8.0] - 2026-11-22

### Added

- Yearly footprint sharing: export a 1080×1350 summary card or a 9-second
  1080×1920 video with the original on-device soundtrack. Both show yearly
  aggregates only — trip count, distance, ascent, active days, and the 12-month
  rhythm — with preview, save, native share, and copy-caption actions. Trip
  names, tracks, coordinates, waypoints, and photos never enter the artwork.
- Three promo designs per theme: a local-first journey card, a yearly-footprint
  card, and an encrypted-meetup card. “Generate promo image” picks one at random
  without immediate repeats and pairs it with the matching caption.
- Continuous touch scrubbing on the analysis elevation and speed charts: press
  and drag to move the map marker and live readout, while vertical page scrolling
  remains available.
- Unit tests for the footprint recap summary (active months, top month, units,
  and empty years).

### Changed

- The OLED pocket lock is now the only on-screen mode. The artificial blackout /
  “sleep” submode was removed because browsers suspend geolocation while the page
  is hidden or the device is locked; the lock copy now states this plainly.
- The analysis statistics card is more compact: four hero metrics plus nine
  secondary metrics in a 3×3 grid (426 px → 308 px on a 390 px-wide phone).
- Replay and footprint videos now share one MediaRecorder helper with MP4/H.264
  preferred and a WebM fallback.

### Fixed

- Lifting the finger after the 1.5-second OLED unlock no longer synthesizes a
  click on the Start button underneath, which could accidentally begin a trip.

### Security

- Footprint share art and captions expose annual aggregates only. Promo artwork
  is generic and contains no trip or personal data.

## [1.7.0] - 2026-11-22

### Added

- Original soundtrack for replay videos: four instrumental loops (Dawn Mist,
  Far Ridges, Starlight, Breeze) synthesized on-device with Web Audio and a
  generated reverb tail. No audio files, samples, vocals, or third-party
  recordings are bundled.
- Music selection in the video card: random by default, or a specific track. The
  choice persists locally, and the selected track is shown after rendering.
- Audio is muxed into the MP4/WebM export with fade-in/out, looping for the full
  intro + replay + outro duration. Browsers without Web Audio fall back to a
  silent video.
- Refreshed promo artwork for 1.7 with shorter bilingual copy, new footprint,
  verified-backup, encrypted-meetup, and soundtracked-recap tiles, and matching
  share captions.
- Unit tests for the music catalog, random/manual resolution, loop composition,
  tempos, and note bounds.

### Changed

- Replay-video helper text now mentions the original looping music.
- About text and diagnostic version report 1.7.

### Security

- Video music is generated locally and makes no network request; it is not
  derived from copyrighted recordings.

## [1.6.0] - 2026-11-22

### Added

- Backup format v2 with a SHA-256 payload digest and per-file media checksums, plus
  integrity status on export, inspect, and restore. Version 1 backups are still
  accepted and restore without a checksum.
- Restore preview listing export time, trips, waypoints, photos, duplicate IDs, and
  checksum status, with an optional snapshot of the current database before
  restoring. Corrupted or modified archives are blocked.
- Favorites and up to 8 tags per trip, search across names and tags, activity and
  favorite filters, and sorting by recently updated, newest, distance, or name.
- Yearly footprint card: trips, distance, ascent, active days, and a 12-month
  distribution for the selected year.
- GPS quality report in analysis: average accuracy, poor-fix ratio, time gaps,
  altitude jumps, and a 0–100 score derived from recorded samples.
- Backup reminder when no full backup exists or the last one is over 30 days old,
  and storage/backup status in Settings.
- `CODE_OF_CONDUCT.md`, `docs/ARCHITECTURE.md`, and a pull-request template.
- Unit tests for backup integrity and tamper detection, footprints, and GPS quality.

### Changed

- Backup counts now include segments and track chunks, and the Settings data card
  shows the last full backup and storage usage.
- Backup exports record `lastBackupAt`, shared by the Trips and Settings views.

### Fixed

- Backup verification no longer reports a false failure when a photo legitimately
  has no thumbnail or when JSON fields are `undefined`.
- The footprint card renders its KPI and monthly bars correctly.

### Security

- Backup checksums detect modified manifests and media, and restore is blocked when
  verification fails. Checksums are corruption/tamper detection, not signatures.
- Backup screens, READMEs, and SECURITY now state that backup ZIPs are **not
  encrypted** and contain full tracks, waypoints, and photos.

## [1.5.0] - 2026-11-22

### Added

- Built-in demo trip: the empty Trips tab can load a full hike with elevation,
  waypoints, and timestamps, then jump straight into analysis, posters, replay
  video, or self-contained HTML export without GPS.
- `?demo=1` opens the demo trip directly; `?sim=1` replays it through the real
  recorder pipeline as simulated GPS fixes for desktop testing.
- Vitest unit tests for coordinate conversion, track math, statistics, privacy
  cropping, GPX/KML/GeoJSON, compact share links, meetup key derivation and
  AES-GCM envelopes, and the demo track.
- GitHub Actions CI (typecheck, unit tests, production build) and a separate
  relay test job. The Pages deploy workflow now runs tests before publishing.
- Multi-stage `Dockerfile` plus `nginx.conf` for self-hosting with correct PWA
  cache headers.
- Minimal blind WebSocket relay template in `relay/` with room isolation,
  payload limits, heartbeat, rate limiting, health endpoint, Dockerfile, and
  tests.
- `SECURITY.md` with the meetup threat model, key derivation, relay-visible
  metadata, and private reporting instructions.
- `CONTRIBUTING.md`, GitHub issue templates, and this changelog.

### Changed

- Map tile caches now cap each provider bucket at 500 entries (300 for the
  extra global bucket) and evict on storage quota errors, reducing the chance of
  exhausting iOS CacheStorage or IndexedDB quota.
- MapLibre GL JS upgraded to 6.19.0 (ESM-only, WebGL2 required), with the
  worker URL wired through Vite so the rendered map works from the production
  build. This resolves the sanitizer-bypass advisory affecting older releases.
- Statistics now treat an epoch-zero timestamp as a real timestamp instead of
  missing time.
- Version bumped to 1.5.0.

### Fixed

- KML exports used an invalid `<color>` value with a space; the RoamEtch accent
  is now written as valid `AABBGGRR`.
- Tracks beginning at timestamp `0` no longer lose their first interval from
  duration and moving-time calculations.

### Security

- Production dependencies now audit clean: MapLibre GL JS 6.19.0 fixes the
  style sanitizer bypass present through 6.4.0.
- Documented the existing domain separation between the meetup room id and the
  AES key, the 5-minute replay window, and the lack of sender authentication or
  forward secrecy.
- Confirmed that the 12-character code never enters MQTT topics, WS paths, query
  strings, or relay message payloads.

## [1.4.0] - 2026-11-21

### Added

- Dual-region adaptive maps (AMap / Tianditu vs. OpenStreetMap / OpenTopoMap /
  Esri) with manual override, custom tiles, and GCJ-02 render-only adaptation.
- Re-walk mode with off-route alerts and spoken waypoint announcements.
- BRouter / OSRM gap repair for track breaks.
- End-to-end encrypted live meetup and ephemeral team chat over public MQTT or a
  custom WebSocket relay, with host handover hints, kick requests, code reset,
  and a two-to-eight-hour self-destruct timer.
- Branded promo sharing, one-tap settings reset, OLED pocket lock, bilingual
  READMEs, and zh/en screenshots.

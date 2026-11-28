// RoamEtch迹刻 bootstrap — pure frontend, offline-first, dual-region adaptive.
import './styles/main.css';
import './styles/story.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import { initI18n, t, currentLang } from './core/i18n';
import { initRegion, regionState } from './core/region';
import * as themeCore from './core/theme';
import { on as busOn } from './core/events';
import { isolateDamaged, createTrip, addSegment, appendPoints, addWaypoint } from './core/store';
import * as storeCore from './core/store';
import * as migrationCore from './core/migrations';
import * as databaseCheckpointCore from './core/databaseCheckpoint';
import * as recorderCore from './core/recorder';
import * as weatherCore from './core/weatherService';
import * as simulationCore from './core/simulation';
import * as rewalkCore from './core/rewalk';
import * as batchCore from './core/batch';
import * as backupCore from './core/backup';
import * as safetyCore from './core/safety';
import * as notifierCore from './core/notifier';
import { startSafetyMonitor } from './core/safetyMonitor';
import { handleSafetyMonitorResult, safetyPositionFromRecorder } from './ui/safety';
import * as coordsCore from './core/coords';
import * as keepaliveCore from './core/keepalive';
import { parseShareFragment, shareFragmentFingerprint } from './core/shareLink';
import { parseMeetLink, isLegacyMeetCode } from './core/meetLink';
import { importDemoTrip } from './core/demo';
import * as meetCore from './core/meet';
import * as meetLinkCore from './core/meetLink';
import { setActiveTrip } from './ui/state';
import { createShell } from './ui/shell';
import { initInstall } from './ui/install';
import { initUpdates, showUpdateNotice } from './ui/updates';
import { toast } from './ui/helpers';
import { diag } from './core/diag';

const SHARE_IMPORTS_KEY = 'roametch.shareImports.v1';
const legacySharedImportTrips = loadLegacySharedImportTrips();
const sharedImportsInFlight = new Map<string, Promise<boolean>>();
let sharedImportQueue: Promise<boolean> = Promise.resolve(false);

function loadLegacySharedImportTrips() {
  const imports = new Map<string, string>();
  try {
    const raw = localStorage.getItem(SHARE_IMPORTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' ? Object.entries(parsed) : [];
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [fingerprint, tripId] = entry;
      if (typeof fingerprint === 'string' && fingerprint && typeof tripId === 'string' && tripId) {
        imports.set(fingerprint, tripId);
      }
    }
  } catch { /* unavailable or malformed cache: durable imports still work */ }
  return imports;
}

async function migrateLegacySharedImports() {
  if (!legacySharedImportTrips.size) return;
  try {
    for (const [fingerprint, tripId] of legacySharedImportTrips) {
      await storeCore.rememberShareImport(fingerprint, tripId);
    }
    localStorage.removeItem(SHARE_IMPORTS_KEY);
    legacySharedImportTrips.clear();
  } catch { /* retain the in-memory fallback when IndexedDB is unavailable */ }
}

async function lookupSharedImport(fingerprint) {
  const legacyTripId = legacySharedImportTrips.get(fingerprint);
  if (legacyTripId) return legacyTripId;
  return (await storeCore.getShareImport(fingerprint))?.tripId || '';
}

async function rememberSharedImport(fingerprint, tripId) {
  legacySharedImportTrips.delete(fingerprint);
  await storeCore.rememberShareImport(fingerprint, tripId);
}

async function forgetSharedImport(fingerprint) {
  legacySharedImportTrips.delete(fingerprint);
  await storeCore.forgetShareImport(fingerprint);
}

function clearSharedFragment(hash) {
  if (location.hash !== hash || /[#&]meet=/.test(location.hash)) return;
  try {
    history.replaceState(history.state || {}, '', location.pathname + location.search);
  } catch { /* fragment cleanup is best-effort */ }
}

function sharedImportFailed(error) {
  console.warn('share import failed', error);
  toast(t('trips.shareImportErr'), 'err');
}

async function openSharedTrip(shell, tripId) {
  const full = await setActiveTrip(tripId);
  if (!full) return false;
  shell.navigate('trips', { detail: true, tripId, section: 'overview' });
  return true;
}

async function performSharedTripImport(shell, hash, fingerprint, shared) {
  try {
    const knownTripId = await lookupSharedImport(fingerprint);
    if (knownTripId) {
      const knownTrip = await storeCore.getTrip(knownTripId);
      if (knownTrip) {
        await rememberSharedImport(fingerprint, knownTripId);
        if (location.hash !== hash || /[#&]meet=/.test(location.hash)) return true;
        clearSharedFragment(hash);
        if (!await openSharedTrip(shell, knownTripId)) throw new Error('shared-trip-open-failed');
        return true;
      }
      await forgetSharedImport(fingerprint);
    }

    const result = await storeCore.runShareImportTransaction(async () => {
      const existing = await storeCore.getShareImport(fingerprint);
      if (existing && await storeCore.getTrip(existing.tripId)) {
        return { tripId: existing.tripId, created: false };
      }
      if (existing) await storeCore.forgetShareImport(fingerprint);

      const sharedName = shared.name === 'Shared trip' ? t('trips.untitled') : shared.name;
      const trip = await createTrip({ name: sharedName, activity: shared.activity, status: 'finished' });
      const sharedSegments = shared.segments?.length ? shared.segments : [shared.points];
      for (const points of sharedSegments) {
        const seg = await addSegment(trip.id);
        await appendPoints(seg.id, trip.id, points.map((p) => ({ ...p, t: null, alt: null, altSrc: null, acc: null, speed: null })));
      }
      for (const waypoint of shared.waypoints) {
        await addWaypoint({ ...waypoint, tripId: trip.id, desc: '', time: null, hidden: false, mediaIds: [] });
      }
      if (shared.reportedDistance != null) await storeCore.updateTrip(trip.id, { reportedDistance: shared.reportedDistance });
      await rememberSharedImport(fingerprint, trip.id);
      return { tripId: trip.id, created: true };
    });

    if (location.hash !== hash || /[#&]meet=/.test(location.hash)) return true;
    clearSharedFragment(hash);
    if (!await openSharedTrip(shell, result.tripId)) throw new Error('shared-trip-open-failed');
    if (result.created) toast(t('trips.importOk', { name: shared.name === 'Shared trip' ? t('trips.untitled') : shared.name }), 'ok');
    return true;
  } catch (error) {
    sharedImportFailed(error);
    return false;
  }
}

/** Reused by cold-start and hashchange handling; one fingerprint imports once. */
async function importSharedTrip(shell, hash) {
  if (!hash || /[#&]meet=/.test(hash) || !/[#&]t=/.test(hash)) return false;
  let shared;
  let fingerprint;
  try {
    shared = parseShareFragment(hash);
    if (!shared) throw new Error('invalid-share-fragment');
    fingerprint = await shareFragmentFingerprint(hash);
    if (!fingerprint) throw new Error('invalid-share-fingerprint');
  } catch (error) {
    sharedImportFailed(error);
    return false;
  }

  const pending = sharedImportsInFlight.get(fingerprint);
  if (pending) return pending;
  const job = performSharedTripImport(shell, hash, fingerprint, shared);
  sharedImportsInFlight.set(fingerprint, job);
  try {
    return await job;
  } finally {
    if (sharedImportsInFlight.get(fingerprint) === job) sharedImportsInFlight.delete(fingerprint);
  }
}

function queueSharedTripImport(shell, hash) {
  const queued = sharedImportQueue.then(() => importSharedTrip(shell, hash));
  sharedImportQueue = queued.catch(() => false);
  return queued;
}

function migrationActionableMessage(error) {
  switch (error?.code) {
    case 'migration-checkpoint-capacity': return t('boot.migrationCheckpointCapacity');
    case 'migration-checkpoint-failed': return t('boot.migrationCheckpointFailed');
    case 'migration-checkpoint-verification-failed': return t('boot.migrationCheckpointVerificationFailed');
    case 'migration-checkpoint-blocked': return t('boot.migrationCheckpointBlocked');
    case 'migration-rollback-journal-invalid': return t('boot.migrationRollbackJournalInvalid');
    case 'migration-rollback-verification-failed': return t('boot.migrationRollbackVerificationFailed');
    case 'migration-rollback-checkpoint-invalid': return t('boot.migrationRollbackCheckpointInvalid');
    case 'migration-rollback-blocked': return t('boot.migrationRollbackBlocked');
    case 'migration-rollback-failed': return t('boot.migrationRollbackFailed');
    default:
      if (String(error?.code || '').startsWith('migration-checkpoint-')) return t('boot.migrationCheckpointFailed');
      if (String(error?.code || '').startsWith('migration-rollback-')) return t('boot.migrationRollbackFailed');
      return '';
  }
}

async function boot() {
  const bootSub = document.getElementById('boot-sub');
  await initI18n();
  const bootLogo = document.querySelector('.boot-logo');
  if (bootLogo) bootLogo.textContent = t('app.name');
  bootSub && (bootSub.textContent = t('boot.region'));
  initRegion();

  const preflight = await migrationCore.preflightDatabase();
  if (preflight.blocking) throw migrationCore.migrationErrorFromPreflight(preflight);
  diag('store', 'database preflight', {
    fromVersion: preflight.fromVersion, toVersion: preflight.toVersion,
    needsUpgrade: preflight.needsUpgrade, skipped: preflight.skipped,
    issues: preflight.issues.reduce((sum, issue) => sum + issue.count, 0)
  });
  const startup = await databaseCheckpointCore.openDatabaseWithMigrationRecovery(storeCore.db, preflight);
  const migration = startup.migration;

  // Theme initialization reads the latest trip reference, so it must follow migration checks.
  await themeCore.initTheme();

  diag('store', startup.rolledBack ? 'database migration rolled back' : migration.skipped ? 'database preflight skipped' : migration.needsUpgrade ? 'database migrated' : 'database current', {
    fromVersion: migration.fromVersion, toVersion: migration.toVersion, verified: migration.verified
  });
  if (preflight.issues.length) {
    toast(t('boot.migrationAdvisory', { n: preflight.issues.reduce((sum, issue) => sum + issue.count, 0) }), 'warn', 6000);
  }

  // integrity: isolate damaged rows before UI loads
  try {
    const removed = await isolateDamaged();
    if (removed) {
      diag('store', 'damaged rows isolated', { removed });
      toast(t('boot.damagedIsolated', { n: removed }), 'warn', 7000);
    }
  } catch (e) { console.warn('integrity check failed', e); }

  // fixes spilled synchronously on pagehide that never reached IndexedDB
  try {
    const recovered = await recorderCore.recoverPendingSpill();
    if (recovered) diag('recorder', 'pending points recovered', { count: recovered });
  } catch (e) { console.warn('pending spill recovery failed', e); }

  await migrateLegacySharedImports();
  weatherCore.initWeatherMonitor();

  const shell = createShell(document.getElementById('app'));
  startSafetyMonitor({
    getSnapshot: () => ({
      position: safetyPositionFromRecorder(),
      recording: recorderCore.rec.status === 'recording'
    }),
    getLanguage: currentLang,
    onResult: handleSafetyMonitorResult
  });
  document.getElementById('boot-splash')?.remove();
  diag('boot', 'app ready', { lang: navigator.language });
  // debug handle for diagnostics & acceptance testing (spec: debuggability)
  window.__lt = { recorder: recorderCore, weather: weatherCore, simulation: simulationCore, store: storeCore, migration: migrationCore, databaseCheckpoint: databaseCheckpointCore, coords: coordsCore, region: regionState, shell, theme: themeCore, rewalk: rewalkCore, batch: batchCore, backup: backupCore, keepalive: keepaliveCore, meet: meetCore.meet, meetCore, meetLink: meetLinkCore, safety: safetyCore, notifier: notifierCore, updates: { show: showUpdateNotice } };

  // Live fragment imports. A meet invite takes precedence when both coexist.
  const hasMeetFragment = /[#&]meet=/.test(location.hash);
  const hasShareFragment = !hasMeetFragment && /[#&]t=/.test(location.hash);
  window.addEventListener('hashchange', () => {
    const hash = location.hash;
    if (/[#&]meet=/.test(hash)) return;
    void queueSharedTripImport(shell, hash);
  });

  const meetLink = parseMeetLink(location.hash);
  const meetInvite = meetLink?.invite || '';
  const legacyMeetLink = hasMeetFragment && isLegacyMeetCode(location.hash);
  if (hasMeetFragment && !meetInvite) {
    history.replaceState(history.state || {}, '', location.pathname + location.search);
    shell.navigate('meet');
    toast(legacyMeetLink ? t('meet.legacyCode') : t('meet.autoJoinFail'), 'err', legacyMeetLink ? 5200 : 4200);
  } else if (meetInvite) {
    shell.navigate('meet');
    try {
      await meetCore.joinMeetSession(meetInvite, {
        inviteExpiresAt: meetLink?.exp || 0,
        inviteSig: meetLink?.sig || ''
      });
      toast(t('meet.autoJoined'), 'ok', 3500);
    } catch (e: any) {
      console.warn('meet auto-join failed', e);
      history.replaceState(history.state || {}, '', location.pathname + location.search);
      const reason = e?.message;
      const legacy = reason === 'legacy-meet-invite';
      const expired = reason === 'meet-invite-expired';
      const badSig = reason === 'meet-invite-signature' || reason === 'meet-invite-invalid';
      toast(
        legacy ? t('meet.legacyCode')
          : expired ? t('meet.inviteExpiredJoin')
            : badSig ? t('meet.inviteBadSignature')
              : t('meet.autoJoinFail'),
        'err',
        legacy || expired ? 5200 : 4200
      );
    }
  } else if (hasShareFragment) {
    // Shared-link import (#t=…) — the fragment never reaches a server.
    await queueSharedTripImport(shell, location.hash);
  }

  // Desktop entry points: ?demo=1 opens the built-in trip, ?sim=1 replays it as live GPS.
  if (!hasMeetFragment && !hasShareFragment) {
    const entry = new URLSearchParams(location.search);
    if (entry.get('demo') === '1') {
      try {
        const trip = await importDemoTrip();
        await setActiveTrip(trip.id);
        shell.navigate('trips', { detail: true, section: 'overview' });
        toast(t('demo.loaded'), 'ok');
      } catch (e) { console.warn('demo load failed', e); }
    } else if (entry.get('sim') === '1') {
      try {
        const simulator = await import('./core/simulator');
        shell.navigate('record');
        if (entry.get('scenario')) {
          const durationMs = Number(entry.get('duration'));
          await simulator.startScenario({
            scenario: entry.get('scenario') as (typeof simulationCore.SIMULATION_SCENARIOS)[number],
            ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs } : {})
          });
        } else {
          await simulator.startPlayback({});
        }
      } catch (e) { console.warn('sim playback failed', e); }
    }
  }

  // network state toasts
  busOn('network:offline', () => toast(t('toast.offlineMode'), 'warn', 4000));
  busOn('network:online', () => toast(t('toast.backOnline'), 'ok', 2500));

  initInstall({ nudge: !hasMeetFragment && !hasShareFragment });

  // Service worker: prompt before reloading so an active recording is never interrupted.
  initUpdates();
}

boot().catch((e) => {
  console.error('boot failed', e);
  const sub = document.getElementById('boot-sub');
  if (!sub) return;
  if (e?.name === 'DatabaseMigrationError') {
    const title = e.code === 'future-database-version' || e.code === 'future-trip-schema-version'
      ? t('boot.migrationFuture')
      : e.code === 'invalid-trip-schema-version'
        ? t('boot.migrationInvalid')
        : t('boot.migrationFailed');
    const actionable = migrationActionableMessage(e);
    sub.textContent = `${title}${actionable ? `\n${actionable}` : ''}\n${t('boot.migrationRecovery')}`;
  } else {
    sub.textContent = t('boot.failed', { message: e?.message || e });
  }
});

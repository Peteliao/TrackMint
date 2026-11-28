import { expect, test, type CDPSession, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const POINTS = 20_000;
const BASE_TIME = 1_700_000_000_000;

type MetricName = 'JSHeapUsedSize' | 'TaskDuration' | 'ScriptDuration' | 'Nodes';
type Metrics = Record<MetricName, number>;
type Counts = Record<string, unknown>;

interface Thresholds {
  heapBytes: number;
  taskSeconds: number;
  scriptSeconds: number;
  nodeGrowth: number;
  retainedNodeGrowth: number;
}

// Broad headroom for a mobile viewport in desktop Chromium, while still catching
// unbounded previews, detached DOM growth, and runaway work. These are regression
// budgets, not Safari memory limits; calibrate them on the release build machine.
// Reload sampling can include both the outgoing map and incoming shell; retained growth stays capped at 6k.
const STARTUP: Thresholds = { heapBytes: 220 * 1024 * 1024, taskSeconds: 12, scriptSeconds: 5, nodeGrowth: 8_000, retainedNodeGrowth: 6_000 };
const HEALTH: Thresholds = { heapBytes: 300 * 1024 * 1024, taskSeconds: 15, scriptSeconds: 6, nodeGrowth: 6_000, retainedNodeGrowth: 6_000 };
// Chromium's Nodes metric also grows with chart/map internals for a full 20k-point
// analysis view. Bound transient and retained growth linearly instead of pretending
// the absolute count is a small static-page DOM count.
const GPS: Thresholds = { heapBytes: 350 * 1024 * 1024, taskSeconds: 30, scriptSeconds: 12, nodeGrowth: 15 * POINTS, retainedNodeGrowth: 12 * POINTS };
const RECOVERY: Thresholds = { heapBytes: 220 * 1024 * 1024, taskSeconds: 15, scriptSeconds: 6, nodeGrowth: 8_000, retainedNodeGrowth: 6_000 };

const failureState = new WeakMap<Page, { pageErrors: string[]; crashes: number }>();

async function cdp(page: Page): Promise<CDPSession> {
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  return session;
}

async function metrics(session: CDPSession): Promise<Metrics> {
  const { metrics: values } = await session.send('Performance.getMetrics');
  const result = {} as Metrics;
  for (const name of ['JSHeapUsedSize', 'TaskDuration', 'ScriptDuration', 'Nodes'] as const) {
    const value = values.find((metric) => metric.name === name)?.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`CDP metric missing: ${name}`);
    result[name] = value;
  }
  return result;
}

async function samplePeaks(session: CDPSession, baseline: Metrics) {
  let peak = { ...baseline };
  let samples = 1;
  const pending = new Set<Promise<void>>();
  const timer = setInterval(() => {
    const request = metrics(session).then((value) => {
      samples++;
      for (const name of Object.keys(peak) as MetricName[]) peak[name] = Math.max(peak[name], value[name]);
    }).catch(() => { /* The final read below surfaces protocol failures. */ })
      .finally(() => { pending.delete(request); });
    pending.add(request);
  }, 75);
  try {
    return { stop: async () => { clearInterval(timer); await Promise.all(pending); return { peak, samples }; } };
  } catch (error) {
    clearInterval(timer);
    throw error;
  }
}

async function measure(
  page: Page,
  session: CDPSession,
  testInfo: TestInfo,
  scenario: string,
  thresholds: Thresholds,
  action: () => Promise<Counts>
) {
  await session.send('HeapProfiler.collectGarbage');
  const baseline = await metrics(session);
  const started = Date.now();
  const sampling = await samplePeaks(session, baseline);
  let counts: Counts = {};
  let failure: unknown = null;
  try {
    counts = await action();
  } catch (error) {
    failure = error;
  }
  const { peak, samples } = await sampling.stop();
  await session.send('HeapProfiler.collectGarbage');
  const final = await metrics(session);
  const elapsedMs = Date.now() - started;
  const taskSeconds = final.TaskDuration - baseline.TaskDuration;
  const scriptSeconds = final.ScriptDuration - baseline.ScriptDuration;
  const checks = {
    heap: peak.JSHeapUsedSize <= thresholds.heapBytes,
    task: taskSeconds <= thresholds.taskSeconds,
    script: scriptSeconds <= thresholds.scriptSeconds,
    nodes: peak.Nodes - baseline.Nodes <= thresholds.nodeGrowth,
    retainedNodes: final.Nodes - baseline.Nodes <= thresholds.retainedNodeGrowth
  };
  const effectiveThresholds = {
    ...thresholds,
    maxNodes: baseline.Nodes + thresholds.nodeGrowth,
    maxRetainedNodes: baseline.Nodes + thresholds.retainedNodeGrowth
  };
  const report = {
    scenario,
    source: 'chromium-cdp-Performance.getMetrics',
    capturedAt: new Date().toISOString(),
    browserVersion: page.context().browser()?.version() ?? null,
    viewport: page.viewportSize(),
    syntheticPoints: POINTS,
    pageErrors: failureState.get(page)?.pageErrors ?? [],
    crashes: failureState.get(page)?.crashes ?? 0,
    baseline,
    final,
    sampledPeak: peak,
    delta: {
      JSHeapUsedSize: final.JSHeapUsedSize - baseline.JSHeapUsedSize,
      TaskDuration: taskSeconds,
      ScriptDuration: scriptSeconds,
      Nodes: final.Nodes - baseline.Nodes
    },
    thresholds: effectiveThresholds,
    checks,
    samples,
    elapsedMs,
    counts,
    passed: Object.values(checks).every(Boolean) && failure === null
      && (failureState.get(page)?.pageErrors.length ?? 0) === 0 && (failureState.get(page)?.crashes ?? 0) === 0
  };
  const reportDirectory = join(testInfo.project.outputDir, '..', 'reports');
  mkdirSync(reportDirectory, { recursive: true });
  const reportPath = join(reportDirectory, `memory-${scenario}.json`);
  const reportJson = JSON.stringify(report, null, 2) + '\n';
  writeFileSync(reportPath, reportJson);
  await testInfo.attach(`memory-${scenario}.json`, { body: reportJson, contentType: 'application/json' });
  if (failure) throw failure;
  expect(report.checks, JSON.stringify({ scenario, peak, taskSeconds, scriptSeconds })).toEqual({
    heap: true, task: true, script: true, nodes: true, retainedNodes: true
  });
  return report;
}

function watchFailures(page: Page) {
  const pageErrors: string[] = [];
  let crashes = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('crash', () => { crashes++; });
  const state = { pageErrors, crashes };
  failureState.set(page, state);
  return {
    assert: () => {
      expect(state.pageErrors, 'uncaught browser errors').toEqual([]);
      expect(state.crashes, 'renderer crashes').toBe(0);
    }
  };
}

/** Only local production assets are allowed; tiles/elevation must not skew timing. */
async function blockRemote(page: Page) {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && url.port === '5201') return route.continue();
    return route.abort();
  });
}

async function ready(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__lt)), { timeout: 45_000 }).toBe(true);
}

async function seedTracks(page: Page, options: { count?: number; gps?: boolean; paused?: boolean } = {}) {
  return page.evaluate(async ({ count, gps, paused, points, baseTime }) => {
    const store = (window as any).__lt.store;
    const ids: string[] = [];
    const segmentIds: string[] = [];
    for (let tripIndex = 0; tripIndex < count; tripIndex++) {
      const status = paused && tripIndex === 0 ? 'paused' : 'finished';
      const trip = await store.createTrip({
        name: `内存矩阵 ${tripIndex + 1}`,
        activity: gps ? 'drive' : 'hike',
        status,
        createdAt: Date.now() - (count - tripIndex) * 60_000
      });
      const segment = await store.addSegment(trip.id, baseTime);
      const track = Array.from({ length: points }, (_, index) => {
        const anomaly = gps && index >= 10_000 && index < 10_003;
        const returnToAnchor = gps && index === 10_003;
        const longitudeIndex = returnToAnchor ? 9_999 : gps && index >= 10_004 ? index - 4 : index;
        return {
          lat: 30,
          lon: 120 - longitudeIndex * 100 / 95_600 + (anomaly ? 35 / 111_320 : 0),
          t: baseTime + index * 5_000 - (gps && index === 10_000 ? 4_750 : 0),
          acc: 5,
          alt: 100
        };
      });
      await store.appendPoints(segment.id, trip.id, track);
      ids.push(trip.id);
      segmentIds.push(segment.id);
    }
    return { ids, segmentIds };
  }, { count: options.count ?? 1, gps: options.gps ?? false, paused: options.paused ?? false, points: POINTS, baseTime: BASE_TIME });
}

async function setup(page: Page) {
  const failures = watchFailures(page);
  await blockRemote(page);
  await page.goto('/');
  await ready(page);
  return failures;
}

async function previewCounts(page: Page, tripId: string) {
  return page.evaluate(async (id) => {
    const preview = await (window as any).__lt.store.loadTripPreview(id);
    return {
      points: preview.segments[0].points.length,
      readOnly: preview.readOnly,
      hasMedia: Object.hasOwn(preview, 'media')
    };
  }, tripId);
}

test('cold document startup loads bounded previews from three 20k-point trips', async ({ page }, testInfo) => {
  const failures = await setup(page);
  const seeded = await seedTracks(page, { count: 3, paused: true });
  const session = await cdp(page);
  await measure(page, session, testInfo, 'cold-start', STARTUP, async () => {
    await page.reload();
    await ready(page);
    await expect(page.locator('#view-record')).toContainText('内存矩阵 1');
    await expect(page.locator('#view-record canvas').first()).toBeVisible();
    const previews = await Promise.all(seeded.ids.map((id) => previewCounts(page, id)));
    expect(previews).toEqual(Array.from({ length: 3 }, () => ({ points: 500, readOnly: true, hasMedia: false })));
    return { trips: 3, trackPoints: 3 * POINTS, previewPoints: previews.map((item) => item.points), boundedReadOnly: true };
  });
  failures.assert();
  await session.detach();
});

test('storage health scans 20k points and remains read-only', async ({ page }, testInfo) => {
  const failures = await setup(page);
  const { ids } = await seedTracks(page);
  await page.evaluate(async (tripId) => {
    const { store } = (window as any).__lt;
    await store.addMedia({ tripId, blob: new Blob(['unreferenced-memory-fixture']), width: 1, height: 1 });
    await store.db.trackChunks.add({
      id: 'memory-orphan-chunk', tripId: 'missing-trip', segmentId: 'missing-segment', seq: 0, points: []
    });
  }, ids[0]);
  await page.evaluate(() => (window as any).__lt.shell.navigate('settings'));
  await expect(page.locator('#view-settings')).toHaveClass(/active/);
  const before = await page.evaluate(async () => {
    const { db } = (window as any).__lt.store;
    return { chunks: await db.trackChunks.count(), media: await db.media.count() };
  });
  const session = await cdp(page);
  await measure(page, session, testInfo, 'health-check', HEALTH, async () => {
    await page.getByRole('button', { name: '检查存储完整性', exact: true }).click();
    const health = page.locator('.storage-health');
    await expect(health).toContainText('孤立轨迹块');
    await expect(health).toContainText('未被节点引用的媒体');
    await expect(health).toContainText('检查与清理预览均为只读');
    await expect(health.locator('.health-issue')).toHaveCount(2);
    const after = await page.evaluate(async () => {
      const { db } = (window as any).__lt.store;
      return {
        chunks: await db.trackChunks.count(),
        media: await db.media.count(),
        orphan: Boolean(await db.trackChunks.get('memory-orphan-chunk'))
      };
    });
    expect(after).toEqual({ ...before, orphan: true });
    return { trackPoints: POINTS, issues: 2, before, after, readOnly: true };
  });
  failures.assert();
  await session.detach();
});

test('GPS repair preview, versioned apply, and restore preserve exact large-track counts', async ({ page }, testInfo) => {
  const failures = await setup(page);
  const { ids } = await seedTracks(page, { gps: true });
  await page.evaluate((tripId) => {
    (window as any).__lt.shell.navigate('trips', { detail: true, tripId, section: 'data' });
  }, ids[0]);
  const quality = page.locator('#view-analysis .quality-card');
  const repair = quality.locator('.gps-repair');
  await expect(quality).toContainText('可解释轨迹修复');
  const speed = repair.locator('.repair-category').filter({ hasText: '速度跳变' });
  await expect(speed).toContainText('3 项');
  await expect(speed.getByRole('checkbox')).toBeChecked();
  await expect(repair.locator('.repair-metrics').getByRole('row', { name: new RegExp(`轨迹点\\s+${POINTS}\\s+${POINTS - 3}`) })).toBeVisible();
  const session = await cdp(page);
  await measure(page, session, testInfo, 'gps-preview-repair-restore', GPS, async () => {
    await speed.locator('.repair-reasons summary').click();
    await expect(speed.locator('.repair-reason')).toHaveCount(3);
    await speed.locator('.repair-reason').first().click();
    await expect(page.locator('.analysis-map canvas').first()).toBeVisible();
    await expect(page.locator('.analysis-map .chart-hover-dot')).toBeVisible();
    await page.locator('#trip-detail button[data-section="data"]').click();
    await repair.getByRole('button', { name: '应用选中修复', exact: true }).click();
    const repairDialog = page.getByRole('dialog', { name: '确认轨迹修复' });
    await expect(repairDialog).toContainText('独立快照');
    await repairDialog.getByRole('button', { name: '应用选中修复', exact: true }).click();
    await expect(quality).toContainText('已保留清洗前快照');
    await expect(quality).toContainText('修复版本对比');
    const repaired = await page.evaluate(async (tripId) => {
      const store = (window as any).__lt.store;
      const full = await store.loadTripFull(tripId);
      const snapshot = await store.getTrackSnapshotSummary(tripId);
      const versions = await store.listTrackRepairVersions(tripId);
      return { points: full.segments[0].points.length, snapshotPoints: snapshot?.points, versions: versions.length };
    }, ids[0]);
    expect(repaired).toEqual({ points: POINTS - 3, snapshotPoints: POINTS, versions: 1 });
    await quality.getByRole('button', { name: '恢复原始轨迹', exact: true }).click();
    const restoreDialog = page.getByRole('dialog', { name: '恢复清洗前轨迹' });
    await restoreDialog.getByRole('button', { name: '恢复原始轨迹', exact: true }).click();
    await expect(quality).toContainText('已保留清洗前快照');
    await expect.poll(() => page.evaluate(async (tripId) => {
      const full = await (window as any).__lt.store.loadTripFull(tripId);
      return full.segments[0].points.length;
    }, ids[0])).toBe(POINTS);
    const restored = await page.evaluate(async (tripId) => {
      const full = await (window as any).__lt.store.loadTripFull(tripId);
      return full.segments[0].points.length;
    }, ids[0]);
    expect(restored).toBe(POINTS);
    return { inputPoints: POINTS, anomalies: 3, repaired, restored };
  });
  failures.assert();
  await session.detach();
});

test('startup recovers 400 spilled fixes into a paused 20k-point trip', async ({ page }, testInfo) => {
  const failures = await setup(page);
  const { ids, segmentIds } = await seedTracks(page, { paused: true });
  await page.evaluate(({ tripId, segmentId, points, baseTime }) => {
    localStorage.setItem('roametch.pendingPoints.v1', JSON.stringify({
      tripId,
      segmentId,
      points: Array.from({ length: points }, (_, index) => ({
        lat: 30,
        lon: 120 - (20_000 + index) * 100 / 95_600,
        t: baseTime + (20_000 + index) * 5_000,
        acc: 5,
        alt: 100
      }))
    }));
  }, { tripId: ids[0], segmentId: segmentIds[0], points: 400, baseTime: BASE_TIME });
  const session = await cdp(page);
  await measure(page, session, testInfo, 'recording-recovery', RECOVERY, async () => {
    await page.reload();
    await ready(page);
    await expect(page.locator('#view-record')).toContainText('内存矩阵 1');
    const recovered = await page.evaluate(async (tripId) => {
      const store = (window as any).__lt.store;
      const full = await store.loadTripFull(tripId);
      return {
        points: full.segments[0].points.length,
        spill: localStorage.getItem('roametch.pendingPoints.v1'),
        preview: (await store.loadTripPreview(tripId)).segments[0].points.length
      };
    }, ids[0]);
    expect(recovered).toEqual({ points: POINTS + 400, spill: null, preview: 500 });
    return recovered;
  });
  failures.assert();
  await session.detach();
});

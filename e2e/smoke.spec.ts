import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { blockExternal, gotoTab, gotoTripSection, openDemo } from './utils';

async function expectCompactPromoActions(page: import('@playwright/test').Page, count: number) {
  const actions = page.locator('.promo-actions');
  await expect(actions.locator('button')).toHaveCount(count);
  const layout = await actions.evaluate((node) => {
    const boxes = [...node.querySelectorAll('button')].map((button) => {
      const rect = button.getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    });
    return {
      columns: getComputedStyle(node).gridTemplateColumns.split(' ').length,
      boxes
    };
  });
  expect(layout.columns).toBe(count);
  expect(new Set(layout.boxes.map((box) => Math.round(box.top))).size).toBe(1);
  expect(layout.boxes.every((box) => box.height >= 46 && box.height <= 55)).toBe(true);
}

test('RoamEtch record view starts directly without manual creation', async ({ page }) => {
  await blockExternal(page);
  await page.goto('/');
  await expect(page).toHaveTitle(/RoamEtch迹刻/);
  await gotoTab(page, 'record');
  await expect(page.locator('#view-record .rec-pill.start')).toBeVisible();
  await expect(page.locator('#view-record .rec-pill.ghost')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '手动', exact: true })).toHaveCount(0);
});

test('OLED pocket lock works while idle and restores the saved theme', async ({ page }) => {
  await blockExternal(page);
  await page.goto('/');
  await gotoTab(page, 'record');
  const before = await page.evaluate(() => {
    const info = (window as any).__lt.theme.themeInfo();
    return { mode: info.mode, effective: info.effective };
  });
  const entry = page.locator('.iconbtn[aria-label="OLED 口袋锁"]');
  await expect(entry).toBeEnabled();
  await entry.click();
  await expect(page.locator('#oled-dash')).toHaveClass(/active/);
  await expect(page.locator('html')).toHaveClass(/oled-lock/);
  await expect.poll(() => page.evaluate(() => (window as any).__lt.theme.themeInfo().effective)).toBe('dark');

  const unlock = page.locator('#oled-dash .ps-unlock');
  const box = await unlock.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1700);
  await page.mouse.up();
  await expect(page.locator('#oled-dash')).not.toHaveClass(/active/);
  await expect(page.locator('html')).not.toHaveClass(/oled-lock/);
  expect(await page.evaluate(() => {
    const info = (window as any).__lt.theme.themeInfo();
    return { mode: info.mode, effective: info.effective };
  })).toEqual(before);
});

test('six UI languages keep each complete slogan readable on one line', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await blockExternal(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await gotoTab(page, 'settings');

  const languages = [
    { code: 'zh', tag: 'zh-CN', label: '简体中文', record: '记录', slogan: '漫游有迹，刻入舆图；数据归己，不寄云端。' },
    { code: 'zh-TW', tag: 'zh-TW', label: '繁體中文', record: '記錄', slogan: '漫遊有跡，刻入輿圖；資料歸己，不寄雲端。' },
    { code: 'en', tag: 'en', label: 'English', record: 'Record', slogan: 'Roam free, etched into your map. Data stays yours—never in the cloud.' },
    { code: 'ja', tag: 'ja', label: '日本語', record: '記録', slogan: '自由に旅し、地図に刻もう。データは手元に、クラウドには預けない。' },
    { code: 'ko', tag: 'ko', label: '한국어', record: '기록', slogan: '자유롭게 여행해, 지도에 새겨요. 데이터는 내 것, 클라우드엔 없이.' },
    { code: 'es', tag: 'es', label: 'Español', record: 'Registro', slogan: 'Viaja libre, deja tu huella en el mapa. Tus datos son tuyos: nunca en la nube.' }
  ];

  for (const language of languages) {
    await page.getByRole('button', { name: language.label, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', language.tag);
    await expect(page.locator('.tabbar button[data-tab="record"]')).toContainText(language.record);
    const slogans = page.locator('.promo-slogan');
    await expect(slogans).toHaveCount(1);
    await expect(slogans.first()).toHaveText(language.slogan);
    await expect(page.locator('#view-settings')).toHaveClass(/active/);
    await expect(page.locator('.promo-hero')).toBeVisible();
    await page.locator('.promo-hero').scrollIntoViewIfNeeded();
    const layout = await page.locator('.promo-hero').evaluate((card) => {
      const headline = card.querySelector('.promo-headline') as HTMLElement;
      const brand = card.querySelector('.promo-brand-line') as HTMLElement;
      const lines = [...card.querySelectorAll('.promo-slogan')] as HTMLElement[];
      return {
        cardOverflow: card.scrollWidth - card.clientWidth,
        lineOverflows: lines.map((line) => line.scrollWidth - line.clientWidth),
        lineCounts: lines.map((line) => {
          const range = document.createRange();
          range.selectNodeContents(line);
          return range.getClientRects().length;
        }),
        headlineSize: parseFloat(getComputedStyle(headline).fontSize),
        brandSize: parseFloat(getComputedStyle(brand).fontSize)
      };
    });
    expect(layout.cardOverflow, language.code).toBeLessThanOrEqual(1);
    expect(layout.lineOverflows, language.code).toEqual([0]);
    expect(layout.lineCounts, language.code).toEqual([1]);
    expect(layout.headlineSize, language.code).toBeGreaterThanOrEqual(layout.brandSize * 0.6);
    expect(layout.headlineSize, language.code).toBeLessThanOrEqual(layout.brandSize + 4);
  }

  await page.locator('.promo-card .btn.primary').click();
  const preview = page.locator('.promo-preview-img');
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => preview.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(1080);
  expect(errors).toEqual([]);
});

test('promo preview lists 25 designs, advances and switches audiences', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
  });
  await blockExternal(page);
  await page.goto('/');
  await gotoTab(page, 'settings');
  await page.getByRole('button', { name: '生成宣传图', exact: true }).click();
  const preview = page.locator('.promo-preview-img');
  const select = page.locator('.promo-variant-select');
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.promo-actions')).toHaveClass(/three/);
  await expectCompactPromoActions(page, 3);
  await expect(select.locator('option')).toHaveCount(25);
  const first = Number(await preview.getAttribute('data-variant'));
  await page.getByRole('button', { name: '换一张', exact: true }).click();
  await expect.poll(async () => Number(await preview.getAttribute('data-variant'))).toBe((first + 1) % 25);

  const previousSrc = await preview.getAttribute('src');
  await select.selectOption('8');
  await expect(preview).toHaveAttribute('data-variant', '8', { timeout: 30_000 });
  await expect(select).toHaveValue('8');
  expect(await preview.getAttribute('src')).not.toBe(previousSrc);
  const overflow = await page.locator('.modal-backdrop .modal').evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.keyboard.press('Escape');
  await expect(page.locator('.promo-modal')).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => undefined });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
  });
  await page.getByRole('button', { name: '生成宣传图', exact: true }).click();
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.promo-actions')).not.toHaveClass(/three/);
  await expectCompactPromoActions(page, 4);
  expect(errors).toEqual([]);
});

test('demo trip renders charts and privacy crop feedback', async ({ page }) => {
  await blockExternal(page);
  await openDemo(page);

  const chartCard = page.locator('#view-analysis .chart-card');
  await expect(chartCard.locator('.chart-wrap canvas').first()).toBeVisible();

  const legend = chartCard.locator('.chart-legend');
  await expect(legend).toContainText('海拔');
  await expect(legend).toContainText('速度');
  const chartLayout = await chartCard.locator('.chart-wrap').evaluate((wrap) => {
    const plot = wrap.querySelector('.uplot') as HTMLElement;
    const rect = wrap.getBoundingClientRect();
    const plotRect = plot.getBoundingClientRect();
    return {
      wrapWidth: rect.width,
      plotWidth: plotRect.width,
      leftGap: plotRect.left - rect.left,
      rightGap: rect.right - plotRect.right,
      overflow: wrap.scrollWidth - wrap.clientWidth
    };
  });
  expect(chartLayout.wrapWidth).toBeGreaterThan(280);
  expect(chartLayout.plotWidth / chartLayout.wrapWidth).toBeGreaterThan(0.9);
  expect(chartLayout.leftGap).toBeLessThanOrEqual(1);
  expect(chartLayout.rightGap).toBeLessThanOrEqual(1);
  expect(chartLayout.overflow).toBeLessThanOrEqual(1);

  await gotoTripSection(page, 'share');
  await page.locator('#view-export .privacy-adjust').click();
  const radius = page.locator('#view-export input[type="number"]');
  await radius.fill('5000');
  await radius.press('Tab');
  await expect(page.locator('#view-export')).toContainText(/隐私圈隐藏 [1-9]\d* 个轨迹点/);
});

test('trip rows keep nested controls independent and deleting detail returns to the list', async ({ page }) => {
  await blockExternal(page);
  await openDemo(page);
  await page.locator('.trip-detail-back').click();
  await expect(page.locator('#trip-detail')).not.toHaveClass(/active/);

  const row = page.locator('.trip-item').first();
  const favorite = row.locator('.fav-toggle');
  await favorite.focus();
  await favorite.press('Space');
  await expect(favorite).toHaveClass(/active/);
  await expect(page.locator('#trip-detail')).not.toHaveClass(/active/);

  await row.click();
  await expect(page.locator('#trip-detail')).toHaveClass(/active/);
  await page.locator('.trip-detail-actions .danger').click();
  const confirmation = page.locator('.modal-backdrop .modal');
  await confirmation.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.locator('#trip-detail')).not.toHaveClass(/active/);
  await expect(page.locator('.trip-item')).toHaveCount(0);
  await expect(page.locator('#view-trips')).toContainText('还没有行程');
});

test('vector-only poster renders a preview at export resolution', async ({ page }) => {
  await blockExternal(page);
  await openDemo(page);
  await gotoTripSection(page, 'share');

  await page.locator('#view-export .privacy-adjust').click();
  const privacyCard = page.locator('#view-export .card').filter({ hasText: '纯矢量模式' });
  await privacyCard.locator('.switch').last().click();

  const posterCard = page.locator('#view-export .card').filter({ hasText: '图片海报' });
  await posterCard.getByRole('button', { name: '生成' }).click();

  const preview = posterCard.locator('.poster-preview img');
  await expect(preview).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => preview.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(1080);
  await expect(posterCard.locator('button[aria-label="下载海报"]')).toBeVisible();
});

test('text-only self-contained HTML export downloads without photos', async ({ page }) => {
  await blockExternal(page);
  await openDemo(page);
  await gotoTripSection(page, 'share');

  const card = page.locator('#view-export .card').filter({ hasText: '自包含网页' });
  await card.getByRole('button', { name: '纯文字（无照片）' }).click();

  const photos = card.locator('label.row input[type="checkbox"]');
  await expect(photos).toBeDisabled();
  await expect(photos).not.toBeChecked();
  await expect(card).toContainText(/预计约/);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    card.getByRole('button', { name: '自包含网页' }).click()
  ]);
  expect(download.suggestedFilename()).toMatch(/\.html$/);
  const path = await download.path();
  const html = readFileSync(path!, 'utf8');
  expect(html).toContain('<canvas');
  expect(html.length).toBeGreaterThan(20_000);
});

test('shared-link imports stay deduplicated without localStorage cache', async ({ page }) => {
  await blockExternal(page);
  await openDemo(page);
  await page.locator('#trip-detail button[data-section="share"]').click();
  const link = await page.locator('.link-input').inputValue();
  expect(link).toContain('#t=');
  expect(await page.evaluate(() => window.__lt.store.listTrips())).toHaveLength(1);

  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  await expect(page.locator('#trip-detail.active')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => history.state?.lt?.type)).toBe('view');
  expect(await page.evaluate(() => window.__lt.store.listTrips())).toHaveLength(2);
  expect(await page.evaluate(() => window.__lt.store.db.shareImports.count())).toBe(1);

  await page.goto(link);
  await expect(page.locator('#trip-detail.active')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => history.state?.lt?.type)).toBe('view');
  expect(await page.evaluate(() => window.__lt.store.listTrips())).toHaveLength(2);
  expect(await page.evaluate(() => window.__lt.store.db.shareImports.count())).toBe(1);
});

test('streaming GPX import batches large tracks and rolls back failed imports', async ({ page }) => {
  await blockExternal(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__lt))).toBe(true);

  const result = await page.evaluate(async () => {
    const points = Array.from({ length: 1001 }, (_, index) =>
      `<trkpt lat="${30 + index / 100000}" lon="${120 + index / 100000}"><ele>${index}</ele><time>2024-01-01T00:${String(index % 60).padStart(2, '0')}:00Z</time></trkpt>`
    ).join('');
    const file = new File([`<gpx><metadata><name>Streaming import</name></metadata><trk><trkseg>${points}</trkseg></trk></gpx>`], 'streaming.gpx', { type: 'application/gpx+xml' });
    const imported = await (window as any).__lt.batch.importTripFiles([file]);
    const trips = await (window as any).__lt.store.listTrips();
    const full = await (window as any).__lt.store.loadTripFull(trips[0].id);
    const pointCount = full.segments.reduce((sum: number, segment: any) => sum + segment.points.length, 0);
    const chunkCount = await (window as any).__lt.store.db.trackChunks.where('tripId').equals(trips[0].id).count();

    const malformed = new File(['<gpx><trk>'], 'broken.gpx', { type: 'application/gpx+xml' });
    const failed = await (window as any).__lt.batch.importTripFiles([malformed]);
    const zipped = await (window as any).__lt.batch.exportTripsZip([trips[0].id]);
    const zippedResult = await (window as any).__lt.batch.importTripFiles([new File([zipped.blob], zipped.filename)]);
    const beforeAbortTrips = await (window as any).__lt.store.db.trips.orderBy('id').keys();
    const zipTripCount = beforeAbortTrips.length;
    const controller = new AbortController();
    controller.abort();
    let abortName = '';
    try {
      await (window as any).__lt.batch.importTripFiles([file], { signal: controller.signal });
    } catch (error) {
      abortName = (error as Error).name;
    }
    return {
      imported, pointCount, chunkCount, failed, zippedResult, zipTripCount,
      beforeAbortTrips, abortName,
      trips: (await (window as any).__lt.store.db.trips.orderBy('id').keys())
    };
  });

  expect(result.imported).toEqual({ ok: 1, fail: 0 });
  expect(result.pointCount).toBe(1001);
  expect(result.chunkCount).toBe(3);
  expect(result.failed).toEqual({ ok: 0, fail: 1 });
  expect(result.zippedResult).toEqual({ ok: 1, fail: 0 });
  expect(result.zipTripCount).toBe(2);
  expect(result.abortName).toBe('AbortError');
  expect(result.trips.sort()).toEqual(result.beforeAbortTrips.sort());
});

test('storage cleanup confirms and removes only unreferenced media', async ({ page }) => {
  await blockExternal(page);
  await openDemo(page);
  const ids = await page.evaluate(async () => {
    const { store } = (window as any).__lt;
    await store.db.media.clear();
    const trip = (await store.listTrips())[0];
    const used = await store.addMedia({ tripId: trip.id, blob: new Blob(['used']), thumb: null, width: 10, height: 10 });
    const unused = await store.addMedia({ tripId: trip.id, blob: new Blob(['unused']), thumb: null, width: 10, height: 10 });
    await store.addWaypoint({ tripId: trip.id, lat: 30, lon: 120, name: 'Referenced media', mediaIds: [used.id] });
    return { used: used.id, unused: unused.id };
  });

  await gotoTab(page, 'settings');
  await page.getByRole('button', { name: '检查存储完整性', exact: true }).click();
  const details = page.locator('#view-settings .storage-health');
  await expect(details).toBeVisible();
  await expect(details).toContainText('发现 1 份未被任何节点引用的媒体');
  await details.getByRole('button', { name: '清理媒体', exact: true }).click();
  const confirmation = page.locator('.modal-backdrop .modal');
  await expect(confirmation).toContainText('已引用照片不会删除');
  await confirmation.getByRole('button', { name: '清理媒体', exact: true }).click();
  await expect(page.locator('#toast-root .toast.ok').last()).toContainText('已删除 1 份未引用媒体');
  await expect(details).toContainText('没有可清理的未引用媒体');
  expect(await page.evaluate(({ used, unused }) => Promise.all([
    (window as any).__lt.store.db.media.get(used).then(Boolean),
    (window as any).__lt.store.db.media.get(unused).then(Boolean)
  ]), ids)).toEqual([true, false]);
});

test('requested pre-restore snapshot failure blocks restore', async ({ page }) => {
  await blockExternal(page);
  await openDemo(page);
  await gotoTab(page, 'settings');
  await page.getByRole('button', { name: '整库备份' }).click();
  const exportModal = page.locator('.modal-backdrop .modal');
  await exportModal.locator('input[type="checkbox"]').uncheck();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportModal.getByRole('button', { name: '开始导出' }).click()
  ]);
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();
  await page.evaluate(() => window.__lt.store.eraseAll());

  const restore = async () => {
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '恢复备份' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(backupPath!);
    const preview = page.locator('.modal-backdrop .modal').filter({ hasText: '恢复备份' });
    await expect(preview).toBeVisible();
    return preview;
  };

  await page.evaluate(() => {
    (window as any).__originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'MicroMessenger E2E' });
  });
  const blockedPreview = await restore();
  await blockedPreview.locator('.backup-snapshot-toggle').click();
  await blockedPreview.locator('.m-foot').getByRole('button', { name: '恢复', exact: true }).click();
  await expect(page.locator('#toast-root .toast.err').last()).toContainText('快照导出失败');
  expect(await page.evaluate(() => window.__lt.store.listTrips())).toHaveLength(0);

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => (window as any).__originalUserAgent });
  });
  const preview = await restore();
  await preview.locator('.m-foot').getByRole('button', { name: '恢复', exact: true }).click();
  await expect(page.locator('#toast-root .toast.ok').last()).toContainText(/已恢复 1 条行程/);
  expect(await page.evaluate(() => window.__lt.store.listTrips())).toHaveLength(1);
});

test('encrypted backup export, wipe and restore round-trip', async ({ page }) => {
  await blockExternal(page);
  await openDemo(page);
  expect(await page.evaluate(() => window.__lt.store.listTrips())).toHaveLength(1);

  await gotoTab(page, 'settings');
  await page.getByRole('button', { name: '整库备份' }).click();

  const modal = page.locator('.modal-backdrop .modal');
  await expect(modal).toContainText('导出整库备份');
  const passwords = modal.locator('input[type="password"]');
  await passwords.nth(0).fill('roametch-e2e-1234');
  await passwords.nth(1).fill('roametch-e2e-1234');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    modal.getByRole('button', { name: '开始导出' }).click()
  ]);
  expect(download.suggestedFilename()).toMatch(/\.roametch\.enc$/);
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();

  await page.evaluate(() => window.__lt.store.eraseAll());
  expect(await page.evaluate(() => window.__lt.store.listTrips())).toHaveLength(0);

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '恢复备份' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(backupPath!);

  const unlock = page.locator('.modal-backdrop .modal').filter({ hasText: '输入备份密码' });
  await expect(unlock).toBeVisible();
  await unlock.locator('input[type="password"]').fill('roametch-e2e-1234');
  await unlock.getByRole('button', { name: '解锁' }).click();

  const preview = page.locator('.modal-backdrop .modal').filter({ hasText: '恢复备份' });
  await expect(preview).toContainText('加密');
  await expect(preview).toContainText('SHA-256 校验通过');
  await expect(preview.locator('.backup-snapshot-toggle')).toHaveAttribute('aria-pressed', 'false');
  await preview.locator('.m-foot').getByRole('button', { name: '恢复', exact: true }).click();

  await expect(page.locator('#toast-root .toast.ok').last()).toContainText(/已恢复 1 条行程/);
  expect(await page.evaluate(() => window.__lt.store.listTrips())).toHaveLength(1);
});

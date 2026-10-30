/* npm run build — 固定版面習字本 PDF 構建（GitHub Pages 發布用）
 *
 * 流程（順序執行、單一 Chromium 分頁、無並列渲染）：
 *   1. 本機 localhost 靜態伺服器（scripts/static-server.mjs）serve 原始站；
 *   2. Playwright Chromium 載入 index.html，等待 app.js 資料就緒；
 *   3. 注入教育部註解資料、jsPDF 與僅供構建使用的 scripts/pdf-renderer.js；
 *   4. 在分頁內列舉全部「非空」目標（每課一 PDF＋每學期一 PDF），
 *      路徑由 worksheetPath() 產生，頁數依放大註解換行後的實際版面計算；
 *   5. 逐目標 buildWorksheetPdf({version,grade,semester,course})，
 *      course=null 為整學期；回傳 {b64,pageCount} 寫入 _site/<path>；
 *   6. 驗證：PDF 檔頭 %PDF-／檔尾 %%EOF、manifest.json（路徑/課數/頁數/位元組）、
 *      總大小對照 GitHub Pages 容量；
 *   7. 下載面板 worksheet-download.js 為公開資產，下載本構建產出的 PDF
 *      （中文檔名＋Unity 存檔橋接；見該檔頂部說明）。
 * 無任何 dummy PDF；任一目標失敗 → 非零結束（不留半成品通過）。
 * 結束（含失敗/訊號）一律關閉 browser 與 static server。
 *
 * Windows / Ubuntu 皆可直接執行（npm ci && npx playwright install chromium && npm run build）。
 */
import { spawn } from 'node:child_process';
import { cp, mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const SITE = join(ROOT, '_site');
const PAGES_HARD_LIMIT = 1_000_000_000;       // GitHub Pages 完整網站容量上限（保守採十進位 GB）
const PAGES_SOFT_LIMIT = 800 * 1024 * 1024;    // 網站接近容量上限時提醒維護者
const PDF_TIMEOUT_MS = 120_000;                // 單一 PDF 上限（整學期含線上補筆順）

/* ── 清理 ─────────────────────────────────────────────── */
let serverProc = null;
let browser = null;
async function cleanup() {
  try { if (browser) await browser.close(); } catch { /* 已關 */ }
  try {
    if (serverProc && serverProc.exitCode === null) {
      serverProc.kill('SIGTERM');
      await Promise.race([
        new Promise((r) => serverProc.once('close', r)),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      if (serverProc.exitCode === null) serverProc.kill('SIGKILL');
    }
  } catch { /* 忽略 */ }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await cleanup(); process.exit(130); });

/* ── 靜態伺服器 ────────────────────────────────────────── */
function startServer() {
  return new Promise((res, rej) => {
    serverProc = spawn(process.execPath, [join(here, 'static-server.mjs'), ROOT, '0'], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: process.env,
    });
    serverProc.on('error', rej);
    serverProc.on('exit', (code) => rej(new Error(`static-server exited before readiness: ${code}`)));
    let buf = '';
    const ondata = (d) => {
      buf += d.toString();
      const m = buf.match(/LISTENING (\d+)\r?\n?/);
      if (m) { serverProc.stdout.off('data', ondata); res(Number(m[1])); }
    };
    serverProc.stdout.on('data', ondata);
  });
}

/* 公開資產明確列舉：不發布原始教材、構建程式、套件或本機診斷檔。
 * 新增公開入口／資源時同步更新此清單；遺漏或無法讀取時中止發布。 */
const PUBLIC_ASSETS = [
  'index.html', 'style.css', 'app.js', 'worksheet-download.js', 'bpmf.js', 'bpmf_demo.html', 'update.js',
  'data.js', 'dict.js', 'hanzi-data.js', 'hanzi-writer.min.js',
  'fonts/TW-Kai.woff2', 'fonts/Bpmf.woff2', 'fonts/BpmfGsr.woff2',
];
async function copyWebAssets() {
  let bytes = 0;
  for (const file of PUBLIC_ASSETS) {
    const source = join(ROOT, file);
    const target = join(SITE, file);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target);
    bytes += (await stat(target)).size;
  }
  return bytes;
}

/* ── 分頁端工具 ────────────────────────────────────────── */
const listTargetsPageFn = async () => {
  const out = [];
  const V = Object.keys(DATA);
  for (const version of V) {
    const grd = DATA[version];
    for (const grade of Object.keys(grd).sort((a, b) => a - b)) {
      for (const semester of Object.keys(grd[grade]).sort((a, b) => a - b)) {
        const sem = grd[grade][semester];
        const sel = { version, grade, semester };
        let semesterPages = 0;
        for (const course of Object.keys(sem).sort((a, b) => Number(a) - Number(b))) {
          const chars = sem[course] || [];
          if (!chars.length) continue;
          const expectedPages = await worksheetPdfPageCount({ ...sel, course });
          semesterPages += expectedPages;
          out.push({ ...sel, course, expectedPages, wholeSemester: false,
            path: worksheetPath({ ...sel, course }, false) });
        }
        if (semesterPages) {
          out.push({ ...sel, course: null, expectedPages: semesterPages,
            wholeSemester: true, path: worksheetPath(sel, true) });
        }
      }
    }
  }
  return out;
};

// 合約：buildWorksheetPdf({version,grade,semester,course})，course=null → 整學期；回 {b64,pageCount}。
// Playwright evaluate 無 per-call 逾時參數 → Promise.race 兜底。
async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 逾時 ${ms / 1000}s`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/* ── 主流程 ───────────────────────────────────────────── */
async function main() {
  const t0 = Date.now();
  console.log('=== 手寫練習 PDF 構建 ===');
  await rm(SITE, { recursive: true, force: true });
  await mkdir(SITE, { recursive: true });
  const assetBytes = await copyWebAssets();
  console.log('網站資源已複製 → _site/');

  const port = await withTimeout(startServer(), 30_000, '本機預覽伺服器啟動');
  console.log(`static server → http://127.0.0.1:${port}/`);

  const { chromium } = await import('playwright');
  browser = await chromium.launch({
    headless: true,
    args: ['--font-render-hinting=none', '--js-flags=--max-old-space-size=4096'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(120_000);
  page.on('pageerror', (e) => console.error('[page error]', e.message));

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  // app.js 頂層 const DATA 不在 window；以 HANDWRITING_DATA＋合約函式判斷就緒。
  await page.waitForFunction(() => typeof window.worksheetPath === 'function'
    && typeof window.sheetCourses === 'function'
    && window.HANDWRITING_DATA && Object.keys(window.HANDWRITING_DATA).length);

  // PDF 工具與渲染器只在構建環境載入，平板不下載或執行它們。
  await page.addScriptTag({ path: join(ROOT, 'jspdf.umd.min.js') });
  await page.addScriptTag({ path: join(ROOT, 'scripts', 'pdf-annotations.js') });
  // 構建渲染器（非公開資產；index 不引用）。
  await page.addScriptTag({ path: join(ROOT, 'scripts', 'pdf-renderer.js') });
  await page.waitForFunction(() => typeof window.buildWorksheetPdf === 'function');
  const opts = await page.evaluate(() => SHEET_OPTIONS);
  console.log('SHEET_OPTIONS =', JSON.stringify(opts));

  const targets = await withTimeout(page.evaluate(listTargetsPageFn), 120_000, '目標列舉');
  console.log(`目標：${targets.length} 份 PDF`);
  const expCourse = targets.filter((t) => !t.wholeSemester).length;
  const expSem = targets.filter((t) => t.wholeSemester).length;
  console.log(`  課程=${expCourse} 學期=${expSem}`);
  if (targets.length === 0) throw new Error('沒有列舉到任何目標 — DATA 未載入？');
  if (new Set(targets.map((target) => target.path)).size !== targets.length) {
    throw new Error('不同課程產生相同檔案路徑');
  }

  const entries = [];
  let totalBytes = 0, totalPages = 0, lastLog = t0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    let res;
    try {
      res = await withTimeout(page.evaluate((arg) => buildWorksheetPdf(arg), {
        version: t.version,
        grade: t.grade,
        semester: t.semester,
        course: t.course, // null → 整學期
      }), PDF_TIMEOUT_MS, t.path);
    } catch (err) {
      throw new Error(`${t.path}: ${err.message || err}`, { cause: err });
    }
    if (res.pageCount !== t.expectedPages) {
      throw new Error(`${t.path}: 頁數 ${res.pageCount} 與註解版面 ${t.expectedPages} 不符`);
    }
    const buf = Buffer.from(res.b64, 'base64');
    if (buf.length < 64 || !buf.subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
      throw new Error(`${t.path}: 非 PDF 檔頭`);
    }
    // %%EOF 容許尾隨空白（jsPDF 輸出有）。
    const tail = buf.subarray(Math.max(0, buf.length - 64)).toString('latin1');
    if (!tail.includes('%%EOF')) {
      throw new Error(`${t.path}: 缺少 PDF 結尾`);
    }
    await mkdir(join(SITE, dirname(t.path)), { recursive: true });
    await writeFile(join(SITE, t.path), buf);
    totalBytes += buf.length;
    totalPages += res.pageCount;
    entries.push({ path: t.path, selection: t.wholeSemester
      ? { version: t.version, grade: t.grade, semester: t.semester }
      : { version: t.version, grade: t.grade, semester: t.semester, course: t.course },
      wholeSemester: t.wholeSemester,
      pageCount: res.pageCount,
      bytes: buf.length });
    const now = Date.now();
    if ((i + 1) % 25 === 0 || now - lastLog > 30_000) {
      lastLog = now;
      console.log(`[${i + 1}/${targets.length}] ${t.path}（${res.pageCount} 頁, ${(buf.length / 1048576).toFixed(2)}MB）累計 ${(totalBytes / 1048576).toFixed(1)}MB`);
    }
  }

  /* 驗證與 manifest */
  entries.sort((a, b) => a.path < b.path ? -1 : 1);
  const manifest = {
    generatedAt: new Date().toISOString(),
    options: opts,
    count: entries.length,
    totalBytes,
    totalPages,
    files: entries,
  };
  await mkdir(join(SITE, 'downloads', 'worksheets'), { recursive: true });
  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(join(SITE, 'downloads', 'worksheets', 'manifest.json'), manifestJson);
  const siteBytes = assetBytes + totalBytes + Buffer.byteLength(manifestJson);

  const minSize = entries.length ? Math.min(...entries.map((e) => e.bytes)) : 0;
  console.log('────────────────────────────');
  console.log(`完成 ${entries.length}/${targets.length} 份 PDF`);
  console.log(`總頁數 ${totalPages}（依教育部註解實際換行與分頁）`);
  console.log(`PDF 總大小 ${(totalBytes / 1048576).toFixed(2)} MB（最小單檔 ${minSize} B）`);
  console.log(`網站容量上限 ${PAGES_HARD_LIMIT} B，預警 ${(PAGES_SOFT_LIMIT / 1048576).toFixed(0)} MiB`);

  console.log(`完整網站 ${(siteBytes / 1048576).toFixed(2)} MB`);
  if (siteBytes > PAGES_HARD_LIMIT) throw new Error(`網站 ${siteBytes} B 超過 Pages 容量上限`);
  if (siteBytes > PAGES_SOFT_LIMIT) console.warn('網站已超過 800 MB，後續新增教材請留意容量。');

  console.log(`_site/ 完成（${Math.floor((Date.now() - t0) / 1000)}s），含 manifest.json`);
}

main().then(async () => { await cleanup(); process.exit(0); })
  .catch(async (err) => {
    console.error('構建失敗：', err && err.stack || err);
    await cleanup();
    process.exit(1);
  });

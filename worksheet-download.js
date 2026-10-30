/* worksheet-download.js — 習字本 PDF 下載面板（公開資產，index.html 須在 app.js 之前載入）。
 *
 * 合約：window.WorksheetDownloads.open(selection, opener)
 *   - selection = {version, grade, semester, course}，開面板時即複製；
 *     下載進行中（bridge/fetching/awaiting/uncertain）再呼叫 open 只顯示面板，
 *     不會切換進行中的下載。
 *   - 關掉面板不等於取消：pending 的 fetch／Unity 請求繼續，重開顯示同一
 *     選擇與狀態；同一選擇已有結果（成功或失敗）→ 重開保留該結果。
 *   - #worksheetPanel／#worksheetStatus 皆帶 data-state（idle/bridge/fetching/
 *     awaiting/done/error/uncertain）供 CSS 著色；pending 狀態視覺化。
 *
 * 檔案來源（靜態預產，見 scripts/build-pdfs.mjs 產物 _site/downloads/worksheets/）：
 *   https://aifunschoolproject.github.io/handwriting/ + worksheetPath(...)，
 *   再附 ?v=<meta name="app-version"> 供版本辨識／避快取。
 * 中文檔名：習字本_南南版_一年級_上學期_第1課.pdf；整學期＝
 *   習字本_南南版_一年級_上學期_整學期.pdf（與 Unity 端 ChineseFileName 一致）；
 *   course '0'＝特殊單元。
 *
 * 兩種通道：
 *   1. 一般瀏覽器：fetch（AbortController 上限 60 秒、不重試）→ 驗證 %PDF-
 *      檔頭 → Blob → 同域 blob 錨點（a.download 帶中文檔名）。存檔位置由瀏覽器
 *      決定，只回報「下載已開始」。
 *   2. 嵌入式 WebView：偵測＝window.vuplex.postMessage 存在（永遠優先）
 *      或 Android WebView UA（含「; wv)」）。
 *      送出 window.vuplex.postMessage(JSON.stringify({type:'worksheet',
 *      action:'download',requestId,url,fileName}))；Vuplex postMessage 回傳 void，
 *      不做回傳值判斷。送出請求後不宣稱已存檔，等待 Unity 回 ACK：
 *      Unity 直接呼叫 window.hwWorksheetAck({requestId, ok, error})。
 *      ok 必須嚴格 === true 才算成功；error 代碼（http_error/invalid_url/
 *      invalid_filename/cancelled/save_failed）映射為中文訊息。
 *      15 秒無 ACK → 狀態「不確定」，按鈕保持停用（不重複送出），仍接受遲到 ACK。
 *      橋接就緒最多等 2 秒（vuplex 可能尚未掛上；vuplexready 事件為安全網）；
 *      逾時仍無 → 直接報錯，不在不支援的 WebView 內啟動下載；一般瀏覽器完全不等待。
 *
 * 本檔在 app.js 之前執行：頂層不得存取 app.js 全域（worksheetPath、
 * VERSION_LABELS）；只在 open()／下載被呼叫時才使用。
 * 面板 HTML（#worksheetPanel 等 ID）由 index.html 提供；版面幾何全在 CSS。
 */
(function () {
  'use strict';

  const BASE_URL = 'https://aifunschoolproject.github.io/handwriting/';
  const ACK_TIMEOUT_MS = 15000;   // Unity ACK 上限；逾時＝不確定，不重送
  const BRIDGE_TIMEOUT_MS = 2000; // 嵌入式環境等待 vuplex 掛上的上限
  const FETCH_TIMEOUT_MS = 60000; // 一般瀏覽器 fetch 網路操作上限（不重試）
  const EMBEDDED_UA = /;\s*wv\)/i; // Android System WebView UA 含「; wv)」
  const CN_NUMS = ['', '一', '二', '三', '四', '五', '六'];

  const UNITY_ERRORS = {
    http_error: '下載失敗：伺服器回應錯誤，請稍後重試。',
    invalid_url: '下載失敗：網址無效，請重新選擇課程。',
    invalid_filename: '下載失敗：檔名無效，請重新選擇課程。',
    cancelled: '已取消存檔。',
    save_failed: '儲存失敗：裝置端無法把檔案存到儲存空間，請稍後重試。',
  };

  /* 狀態：idle → bridge → fetching/awaiting → done|error|uncertain */
  const BUSY = new Set(['bridge', 'fetching', 'awaiting', 'uncertain']);
  let current = null;    // 進行中／最近一次選擇的複製 {version,grade,semester,course,scope}
  let state = 'idle';
  let message = '';
  let lastResult = null; // {resultKey, scope, fileName, ok, message}
  let pendingAck = null; // {requestId, fileName, timer}（timer 可在逾時後為 null，仍接受遲到 ACK）
  let ackSeq = 0;
  let shown = false;
  let opener = null;
  let prevInert = null;

  /* ── 工具 ─────────────────────────────────────────────── */
  const el = (id) => document.getElementById(id);

  // app.js 全域（classic script 頂層函式／常數），只在呼叫時存取。
  function versionLabel(v) {
    try {
      return (typeof VERSION_LABELS !== 'undefined' && VERSION_LABELS[v]) || v;
    } catch { return v; }
  }
  function sheetPathOf(selection, wholeSemester) {
    if (typeof worksheetPath !== 'function') throw new Error('worksheetPath 未就緒');
    return worksheetPath(selection, wholeSemester);
  }
  function bridge() {
    const v = window.vuplex;
    return v && typeof v.postMessage === 'function' ? v : null;
  }
  /* window.vuplex.postMessage 存在＝嵌入式（永遠優先）；
   * 其次 Android WebView UA（'; wv)'）＝嵌入式但橋接可能尚未掛上。 */
  function isEmbedded() {
    return !!bridge() || EMBEDDED_UA.test(navigator.userAgent);
  }
  function keyOf(selection) {
    return selection.version + '/' + selection.grade + '/' + selection.semester + '/' + selection.course;
  }

  /* 中文檔名：習字本_南南版_一年級_上學期_第1課.pdf；
   * course '0'＝特殊單元；整學期＝…_上學期_整學期.pdf（與 Unity 端一致）。 */
  function sheetFileName(selection, wholeSemester) {
    const v = versionLabel(selection.version);
    const g = CN_NUMS[selection.grade] || selection.grade;
    const s = selection.semester === '1' ? '上學期' : '下學期';
    const c = wholeSemester ? '_整學期'
      : '_' + (selection.course === '0' ? '特殊單元' : '第' + selection.course + '課');
    return '習字本_' + v + '版_' + g + '年級_' + s + c + '.pdf';
  }

  /* 正規 HTTPS 位址＋版本參數（來自 <meta name="app-version">）。 */
  function sheetUrl(selection, wholeSemester) {
    const path = sheetPathOf(selection, wholeSemester);
    const meta = document.querySelector('meta[name="app-version"]');
    const v = meta && meta.content ? '?v=' + encodeURIComponent(meta.content) : '';
    return BASE_URL + path + v;
  }

  function selectionText(selection) {
    const v = versionLabel(selection.version);
    const g = CN_NUMS[selection.grade] || selection.grade;
    const s = selection.semester === '1' ? '上學期' : '下學期';
    const c = selection.scope === 'semester'
      ? '整學期'
      : (selection.course === '0' ? '特殊單元' : '第 ' + selection.course + ' 課');
    return v + '版・' + g + '年級・' + s + '・' + c;
  }

  function currentFileName() {
    return current ? sheetFileName(current, current.scope === 'semester') : '';
  }

  /* ── 面板顯示 / 焦點 / inert ─────────────────────────── */
  const INERT_SELECTORS = ['.topbar', 'main', '#setup', '#detail'];

  function applyInert(on) {
    if (on) {
      prevInert = {};
      for (const sel of INERT_SELECTORS) {
        const n = document.querySelector(sel);
        if (n) { prevInert[sel] = n.inert; n.inert = true; }
      }
    } else if (prevInert) {
      for (const sel of Object.keys(prevInert)) {
        const n = document.querySelector(sel);
        if (n) n.inert = prevInert[sel];
      }
      prevInert = null;
    }
  }

  function render() {
    const panel = el('worksheetPanel');
    if (!panel) return;
    const selBox = el('worksheetSelection');
    const nameBox = el('worksheetFileName');
    const statusBox = el('worksheetStatus');
    if (selBox) selBox.textContent = current ? selectionText(current) : '';
    if (nameBox) nameBox.textContent = current ? currentFileName() : '';
    if (statusBox) {
      statusBox.textContent = message;
      statusBox.dataset.state = state; // CSS 依 data-state 著色（pending 視覺化）
    }
    panel.dataset.state = state;
    if (!current) return;
    const busy = BUSY.has(state);
    for (const r of panel.querySelectorAll('input[name="worksheetScope"]')) {
      r.checked = r.value === current.scope;
      r.disabled = busy;
    }
    const btn = el('btnWorksheetDownload');
    if (btn) btn.disabled = busy;
  }

  function setState(next, msg) {
    state = next;
    if (msg !== undefined) message = msg;
    // 每次失敗都取代舊結果，避免重開面板誤顯示上一次下載成功。
    if (next === 'error' && current) {
      lastResult = {
        resultKey: keyOf(current), scope: current.scope,
        fileName: currentFileName(), ok: false, message,
      };
    }
    render();
  }

  function trapTab(e) {
    const panel = el('worksheetPanel');
    const focusables = [...panel.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )].filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (!focusables.length) { e.preventDefault(); return; }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (!active || !panel.contains(active) || !focusables.includes(active)) {
      // 焦點在標題（tabindex=-1）或面板外：一律拉回範圍內（兩個方向都算）。
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if (e.shiftKey) {
      if (active === first) { e.preventDefault(); last.focus(); }
    } else if (active === last) {
      e.preventDefault(); first.focus();
    }
  }

  function onKey(e) {
    if (!shown) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') trapTab(e);
  }

  function close() {
    if (!shown) return;
    shown = false;
    const panel = el('worksheetPanel');
    if (panel) panel.hidden = true;
    document.removeEventListener('keydown', onKey, true);
    applyInert(false);
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    // 不取消任何進行中的下載／請求；狀態與結果保留於 current／lastResult。
  }

  /* ── 一般瀏覽器下載 ──────────────────────────────────── */
  async function startBrowser(fileName, url) {
    setState('fetching', '正在下載習字本 PDF…');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { credentials: 'omit', signal: controller.signal });
      if (!res.ok) {
        setState('error', '下載失敗：伺服器回應 ' + res.status + '，請稍後重試。');
        return;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const head = buf.length >= 5 ? String.fromCharCode(buf[0], buf[1], buf[2], buf[3], buf[4]) : '';
      if (head !== '%PDF-') {
        setState('error', '收到的檔案不是有效的 PDF，已取消下載。');
        return;
      }
      const blob = new Blob([buf], { type: 'application/pdf' });
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = fileName; // 中文檔名由瀏覽器依 download 屬性呈現
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 延遲釋放，確保瀏覽器已取走串流；釋放失敗不影響已開始的下載。
      setTimeout(() => { try { URL.revokeObjectURL(objectUrl); } catch { /* 已釋放 */ } }, 60000);
      lastResult = {
        resultKey: keyOf(current),
        scope: current.scope, fileName: fileName, ok: true,
        message: '下載已開始（' + fileName + '）。存檔位置由你的瀏覽器決定。',
      };
      setState('done', lastResult.message);
    } catch (err) {
      console.warn('worksheet download fetch failed:', err);
      if (err && err.name === 'AbortError') {
        setState('error', '下載逾時（60 秒），請檢查網路後重試。');
      } else {
        setState('error', '網路連線失敗，無法下載（可能無網路或跨域限制）。請檢查連線後重試。');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /* ── 嵌入式（Unity Vuplex）下載 ─────────────────────── */
  /* 等 window.vuplex 掛上（vuplex 就緒事件 'vuplexready' 亦為安全網），
   * 最多 BRIDGE_TIMEOUT_MS；立即檢查優先。 */
  function waitBridge() {
    return new Promise((resolve) => {
      const start = Date.now();
      let timer = null;
      const onReady = () => done(bridge());
      const done = (v) => {
        clearInterval(timer);
        window.removeEventListener('vuplexready', onReady);
        resolve(v || null);
      };
      window.addEventListener('vuplexready', onReady);
      timer = setInterval(() => {
        const v = bridge();
        if (v) done(v);
        else if (Date.now() - start >= BRIDGE_TIMEOUT_MS) done(null);
      }, 50);
      const v = bridge();
      if (v) done(v);
    });
  }

  /* Unity 端回 ACK：直接呼叫 window.hwWorksheetAck({requestId, ok, error})。
   * ok 必須嚴格 === true；error 為代碼字串，映射為中文訊息。 */
  function handleAck(payload) {
    const p = payload && typeof payload === 'object' ? payload : null;
    if (!p || typeof p.requestId !== 'string') return;
    if (!pendingAck || p.requestId !== pendingAck.requestId) return;
    const pa = pendingAck;
    pendingAck = null;
    clearTimeout(pa.timer);
    if (!current) return; // 進行中選擇已重置：遲到 ACK 不再覆寫
    if (p.ok === true) {
      lastResult = {
        resultKey: keyOf(current),
        scope: current.scope, fileName: pa.fileName, ok: true,
        message: '已存檔：' + pa.fileName,
      };
      setState('done', lastResult.message);
    } else {
      const code = typeof p.error === 'string' && p.error ? p.error : '';
      console.warn('worksheet ACK not ok:', code || 'no error field', p);
      setState('error', UNITY_ERRORS[code] || '儲存失敗：裝置端回傳不明錯誤，請稍後重試。');
    }
  }

  function onAckTimeout() {
    if (!pendingAck) return;
    // 保留 requestId（timer 置空），接受遲到 ACK；不重送。
    pendingAck.timer = null;
    lastResult = {
      resultKey: keyOf(current),
      scope: current.scope, fileName: pendingAck.fileName, ok: null,
      message: '等待存檔確認逾時（15 秒）。不會重複送出請求；若稍後收到確認，結果會更新在這裡。',
    };
    setState('uncertain', lastResult.message);
  }

  async function startUnity(fileName, url) {
    setState('bridge', '正在檢查裝置存檔介面…');
    let vuplex = bridge();
    if (!vuplex) {
      vuplex = await waitBridge();
      if (!vuplex) {
        setState('error', '偵測到嵌入式瀏覽器，但未找到 Unity 存檔介面（Vuplex），無法在此環境下載。');
        return;
      }
    }
    const requestId = 'hw-' + Date.now() + '-' + (++ackSeq);
    const payload = JSON.stringify({
      type: 'worksheet', action: 'download', requestId: requestId, url: url, fileName: fileName,
    });
    // 同步 ACK 必須能生效：先設 pendingAck＋逾時＋等待狀態，再送出；
    // Vuplex postMessage 回傳 void，不做回傳值判斷。
    pendingAck = { requestId: requestId, fileName: fileName, timer: setTimeout(onAckTimeout, ACK_TIMEOUT_MS) };
    setState('awaiting', '請求已送出，等待存檔確認…');
    try {
      vuplex.postMessage(payload);
    } catch (err) {
      console.warn('worksheet postMessage failed:', err);
      clearTimeout(pendingAck.timer);
      pendingAck = null;
      lastResult = null;
      setState('error', '送出下載請求失敗，請稍後重試。');
    }
  }

  /* ── 下載入口 ────────────────────────────────────────── */
  function startDownload() {
    if (!current || BUSY.has(state)) return;
    const whole = current.scope === 'semester';
    const fileName = sheetFileName(current, whole);
    let url;
    try {
      url = sheetUrl(current, whole);
    } catch (err) {
      console.warn('worksheet URL failed:', err);
      setState('error', '找不到此課程的習字本 PDF，請先選課後再試。');
      return;
    }
    if (isEmbedded()) startUnity(fileName, url);
    else startBrowser(fileName, url);
  }

  function onScopeChange(e) {
    if (!current || BUSY.has(state)) { render(); return; }
    current.scope = e.target.value === 'semester' ? 'semester' : 'course';
    // 換 scope＝不同檔案：舊結果／訊息不適用，回到待下載。
    lastResult = null;
    setState('idle', '');
  }

  /* ── 對外合約 ────────────────────────────────────────── */
  function open(selection, srcOpener) {
    const panel = el('worksheetPanel');
    if (!panel) { console.error('worksheet panel not found'); return; }
    const sel = {
      version: String((selection && selection.version) ?? ''),
      grade: String((selection && selection.grade) ?? ''),
      semester: String((selection && selection.semester) ?? ''),
      course: String((selection && selection.course) ?? ''),
    };
    if (!BUSY.has(state)) {
      // 未進行中：採用最新選擇（複製，之後的 state 變更不影響下載）；
      // 同一選擇已有結果 → 重開保留該結果（成功或失敗都照實顯示）。
      if (lastResult && lastResult.resultKey === keyOf(sel)) {
        current = { version: sel.version, grade: sel.grade, semester: sel.semester, course: sel.course, scope: lastResult.scope };
        const s = lastResult.ok === true ? 'done' : lastResult.ok === false ? 'error' : 'uncertain';
        setState(s, lastResult.message);
      } else {
        current = { version: sel.version, grade: sel.grade, semester: sel.semester, course: sel.course, scope: 'course' };
        setState('idle', '');
      }
    }
    // 進行中：current 維持原樣（進行中的下載不會被隱式切換）。
    opener = srcOpener && typeof srcOpener.focus === 'function' ? srcOpener : null;
    if (!shown) {
      shown = true;
      panel.hidden = false;
      applyInert(true); // 已開啟時不重複呼叫，避免蓋掉既有 inert 記憶值
      document.addEventListener('keydown', onKey, true);
      const title = el('worksheetTitle');
      if (title) title.focus({ preventScroll: true });
    }
    render();
  }

  /* 初始化：面板 ID 固定（見 index.html 合約）；綁定一次即可。 */
  function init() {
    const panel = el('worksheetPanel');
    if (!panel) { console.warn('worksheet panel absent; module idle'); return; }
    const closeBtn = el('btnWorksheetClose');
    if (closeBtn) closeBtn.addEventListener('click', close);
    const downloadBtn = el('btnWorksheetDownload');
    if (downloadBtn) downloadBtn.addEventListener('click', startDownload);
    for (const r of panel.querySelectorAll('input[name="worksheetScope"]')) {
      r.addEventListener('change', onScopeChange);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.WorksheetDownloads = { open: open };
  // Unity ACK 通道：一次指派（Unity 端直接呼叫 window.hwWorksheetAck({requestId, ok, error})）。
  window.hwWorksheetAck = handleAck;
})();

/* ── 手寫練習 ─────────────────────────────────────────────
 * 資料來源：
 *   115上114下學期生字表 xlsx（南一／康軒／翰林）→ data.js
 *   教育部《國語辭典》2014 版匯出 → dict.js（逐讀音 注音/釋義/例詞/部首/IDS，含字詞號）
 *   唸字功能已移除（內嵌瀏覽器無 TTS）；注音改為版面顯示
 *   HanziWriter（筆順動畫＋逐筆練習）
 *   習字本 PDF：靜態預產（scripts/build-pdfs.mjs + scripts/pdf-renderer.js）
 *   存放於 downloads/worksheets/；worksheet-download.js 提供瀏覽器下載與 Unity 公開存檔。
 * DATA[版本][年級 1..6][學期 1|2][課次 '0'=特殊單元,'1'..'12'] = [{name,zhuYin,fullStroke,radical,type}]
 * ──────────────────────────────────────────────────────── */
'use strict';

const DATA = window.HANDWRITING_DATA;
// 版本顯示名（資料鍵與 localStorage 鍵仍用原值 南一/康軒/翰林）
const VERSION_LABELS = { '南一': '南南', '康軒': '康康', '翰林': '翰翰' };
const DICT = window.HANDWRITING_DICT || {};

/* ── 習字本 PDF（靜態預產）────────────────────────────
 * 版面固定全開（筆順／注音／釋義例詞／描紅格皆含），
 * 檔案由 build 端（scripts/pdf-renderer.js）預產到
 * downloads/worksheets/；網頁下載既有 PDF，不重新產生或改變固定版面。 */
// PDF 建置使用的固定版面選項。
const SHEET_OPTIONS = Object.freeze({ stroke: true, pinyin: true, dict: true, trace: true });
const SHEET_SLUG = { '南一': 'nanyi', '康軒': 'kangxuan', '翰林': 'hanlin' };
// 選課 → 靜態 PDF 相對路徑（整學期＝semester.pdf，單課＝course-N.pdf）。
function worksheetPath(selection, wholeSemester) {
  const v = SHEET_SLUG[selection?.version];
  if (!v) throw new Error(`worksheetPath: 未知版本 ${selection?.version}`);
  const course = String(selection?.course ?? '');
  const file = wholeSemester ? 'semester.pdf' : `course-${course}.pdf`;
  return `downloads/worksheets/${v}/g${selection.grade}/s${selection.semester}/${file}`;
}

/* ── 狀態 ── */
const state = {
  version: null,
  grade: '1',
  semester: '1',
  course: '1',
  currentChar: null,
  currentName: null,
  charIdx: null, // 本課字序（課內 ‹ › 翻字）
  ghostOn: true,
  gridOn: true, // 格線預設開（與 btnGrid 初始「開」一致；未初始化會吃掉第一下切換）
  fs: 22, // 沿用 hw_fs 儲存值：22 標準／26.4 特大；整個介面倍率為 1／1.2。
  done: {}, // { "南一/1/1/1": Set("一","二") }
};

const $ = (id) => document.getElementById(id);
const selVersion = $('selVersion');
const selGrade = $('selGrade');
const selSemester = $('selSemester');
const selClass = $('selClass');
const progressPill = $('progressPill');
const fsCtl = $('fsCtl');
const classNote = $('classNote');
const grid = $('charGrid');


const detail = $('detail');
const dChar = $('dChar');
const dZhuYin = $('dZhuYin');
const dMeta = $('dMeta');
const writerBox = $('writerBox');
const doneFlag = $('doneFlag');
const writerHint = $('writerHint');
const dictBox = $('dictBox');
const dictBody = $('dictBody');


/* ── 進度持久化（localStorage）── */
// 內嵌 WebView／空間不足時 localStorage 可能不可用；資料損壞（非物件、值非陣列）
// 一律視為無資料，不讓啟動或完成字時拋錯。
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 寫入失敗（滿/被禁用）靜默 */ } },
};
function loadDone() {
  try {
    const raw = JSON.parse(store.get('hw_practice_done') || '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const k in raw) {
        const v = raw[k];
        state.done[k] = Array.isArray(v) ? new Set(v.filter((x) => typeof x === 'string')) : new Set();
      }
    }
  } catch { /* 損壞 → 清空重來 */ }
}
function saveDone() {
  const out = {};
  for (const k in state.done) out[k] = [...state.done[k]];
  store.set('hw_practice_done', JSON.stringify(out));
}
function courseKey() { return `${state.version}/${state.grade}/${state.semester}/${state.course}`; }
function doneSet() {
  const k = courseKey();
  if (!state.done[k]) state.done[k] = new Set();
  return state.done[k];
}
function markDone(name) {
  if (state.currentName !== name) return;
  doneSet().add(name);
  saveDone();
  refreshProgress();
  refreshCardStates();
  doneFlag.classList.add('show');
  setInstructionKey('done');
  if (navigator.vibrate) navigator.vibrate(12);
}

/* ── 課程資料 ── */
function courseChars() {
  const ver = DATA[state.version];
  if (!ver) return [];
  const grd = ver[state.grade];
  if (!grd) return [];
  const sem = grd[state.semester];
  if (!sem) return [];
  const cls = sem[state.course];
  return cls ? cls.slice() : [];
}

/* ── 篩選器 ── */
function fillVersions() {
  selVersion.innerHTML = '';
  for (const v of Object.keys(DATA)) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = (VERSION_LABELS[v] || v) + ' 版';
    selVersion.appendChild(opt);
  }
  state.version = selVersion.value;
}
function fillGrades() {
  const ver = DATA[state.version];
  selGrade.innerHTML = '';
  const grades = ver ? Object.keys(ver).sort((a, b) => a - b) : ['1'];
  for (const g of grades) {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = `${['', '一', '二', '三', '四', '五', '六'][g] || g}年級`;
    selGrade.appendChild(opt);
  }
  if (!ver?.[state.grade]) state.grade = grades[0];
  selGrade.value = state.grade;
}
function validCourse(ver, grade, sem) {
  const cls = ver?.[grade]?.[sem] || {};
  return cls[state.course] ? state.course : cls['0'] ? '0' : '1';
}
function fillClasses() {
  const sem = DATA[state.version]?.[state.grade]?.[state.semester];
  selClass.innerHTML = '';
  if (sem?.['0']) {
    const opt0 = document.createElement('option');
    opt0.value = '0';
    opt0.textContent = '特殊單元';
    selClass.appendChild(opt0);
  }
  const n = sem ? Math.max(...Object.keys(sem).map(Number)) : 0;
  for (let i = 1; i <= n; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `第 ${i} 課`;
    selClass.appendChild(opt);
  }
  state.course = validCourse(DATA[state.version], state.grade, state.semester);
  selClass.value = state.course;
}

function refreshProgress() {
  const chars = courseChars();
  const uniq = new Set(chars.map((c) => c.name));
  const d = doneSet();
  const count = [...uniq].filter((n) => d.has(n)).length;
  progressPill.textContent = `${count}/${uniq.size}`;
  progressPill.title = '本課已練習字數（共 ' + uniq.size + ' 字）';
}

function refreshCardStates() {
  const d = doneSet();
  for (const el of grid.querySelectorAll('.char-card')) {
    const isDone = d.has(el.dataset.name);
    el.classList.toggle('done', isDone);
    el.setAttribute('aria-pressed', String(isDone)); // 字卡＝button，完成狀態同步
    let mark = el.querySelector('.done-mark');
    if (isDone && !mark) {
      mark = document.createElement('span');
      mark.className = 'done-mark';
      mark.textContent = '✔';
      el.appendChild(mark);
    } else if (!isDone && mark) {
      mark.remove();
    }
  }
}
function renderGrid() {
  grid.innerHTML = '';
  const chars = courseChars();
  const nRead = chars.filter((c) => c.type === '認讀字').length;
  classNote.innerHTML = bpmf(
    `${state.course === '0' ? '特殊單元' : `第 ${state.course} 課`} ・ 共 ${chars.length} 字` +
    (nRead ? `（含認讀字 ${nRead}）` : ''));
  const d = doneSet();
  const frag = document.createDocumentFragment();
  for (const c of chars) {
    const dc = DICT[c.name];
    const radForm = dc?.radForm || c.radical;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'char-card' + (d.has(c.name) ? ' done' : '');
    card.dataset.name = c.name;
    const isDone = d.has(c.name);
    card.setAttribute('aria-pressed', String(isDone));
    card.setAttribute('aria-label',
      `字「${c.name}」，注音 ${c.zhuYin}${isDone ? '，已練習' : ''}${c.type === '認讀字' ? '，認讀字' : ''}`);
    card.innerHTML =
      `<span class="card-body">` +
      `<span class="zhuyin">${window.bpmfRuby(c.zhuYin)}</span>` +
      `<span class="char">${c.name}</span>` +
      `</span>` +
      (radForm ? `<span class="rad-badge" title="部首：${dc?.radical || radForm}">${radForm}</span>` : '') +
      `<span class="strokes">${c.fullStroke} 筆</span>` +
      (c.type === '認讀字' ? '<span class="type-tag" title="認讀字（認得即可）">認</span>' : '') +
      (isDone ? '<span class="done-mark">✔</span>' : '');
    card.addEventListener('click', () => openDetail(c));
    frag.appendChild(card);
  }
  grid.appendChild(frag);
  refreshProgress();
}

function onFilterChange() {
  const prevKey = courseKey();
  state.version = selVersion.value;
  state.grade = selGrade.value;
  state.semester = selSemester.value;
  fillGrades();
  fillClasses();
  if (courseKey() !== prevKey && !detail.hidden) closeDetail(); // 已開字卡屬於舊課
  renderGrid();
  setupSave();
}

/* ── HanziWriter（筆順動畫＋逐筆練習）──
 * 筆順資料：本機 hanzi-data.js（全課 2994 字，含教育部筆順網補字與米／反組字「粄」）。
 * 彎筆中線沿中心線重算，離線可用；缺字時回落 jsdelivr；兩者皆無 → 靜態大字模式。 */
let hanziDataReady = null; // Promise
function loadHanziData() {
  if (window.HANZI_DATA) return Promise.resolve(true);
  if (hanziDataReady) return hanziDataReady;
  let settled = false;
  hanziDataReady = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'hanzi-data.js?v=4';
    const finish = (ok) => { if (!settled) { settled = true; if (!ok) hanziDataReady = null; resolve(ok); } };
    s.onload = () => finish(true);
    s.onerror = () => finish(false); // 離線包不在 → 靠 CDN 回落
    setTimeout(() => finish(false), 15000); // 下載卡住也放行,避免「產生中…」永不結束
    document.head.appendChild(s);
  });
  return hanziDataReady;
}

function charDataLoader(char, onOK, onErr) {
  loadHanziData().then((localOk) => {
    const d = localOk && window.HANZI_DATA && window.HANZI_DATA[char];
    if (d) { onOK(d); return; }
    // 離線缺字 → 線上補抓（jsdelivr 需 percent-encoding）
    fetch(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${encodeURIComponent(char)}.json`)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(onOK)
      .catch(onErr);
  });
}

const WRITER_SIZE = 480; // SVG 內部解析度；viewBox 讓 CSS 等比縮放
let writer = null;
let svgObserver = null;

function ensureSvgScale() {
  const svg = writerBox.querySelector('svg');
  if (!svg) return;
  svg.setAttribute('viewBox', `0 0 ${WRITER_SIZE} ${WRITER_SIZE}`);
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.display = 'block';
}

function fallbackStatic(name) {
  practiceAction++;
  // 套件沒有公開 destroy API；保留唯一 writer 與 SVG，換回有筆順的字時重用。
  if (svgObserver) svgObserver.disconnect();
  if (writer) writer.cancelQuiz();
  const svg = writerBox.querySelector('svg');
  if (svg) svg.style.display = 'none';
  writerBox.querySelectorAll('.static-char, .static-note').forEach((el) => el.remove());
  const glyph = document.createElement('div');
  glyph.className = 'static-char';
  glyph.textContent = name;
  const note = document.createElement('div');
  note.className = 'static-note';
  note.textContent = '此字無筆順動畫，請依範字書寫';
  writerBox.append(glyph, note);
  setInstruction('這個字沒有筆順，先看著範字練習。');
}
// 單一 writer 實例；換字用 setCharacter（自動清手筆＋重載筆順），
// 避免每次 create 在 document 累積 mouseup/touchend 監聽器。
let writerPromise = Promise.resolve();
let practiceAction = 0; // 新操作使舊動畫的非同步回覆失效。
function ensureWriter(name) {
  writerBox.querySelectorAll('.static-char, .static-note').forEach((el) => el.remove());
  if (!writer) {
    writerBox.innerHTML = '';
    writer = HanziWriter.create(writerBox, name, {
      width: WRITER_SIZE,
      height: WRITER_SIZE,
      padding: 12,
      showOutline: true,
      strokeFadeDuration: 0,                       // 0=筆順播完筆畫留在畫面（預設會淡出）
      outlineColor: '#5d85d5',                        // 淡藍虛影
      highlightColor: 'rgba(232, 89, 12, 0.25)',  // 當前筆提示
      characterTransitionDuration: 300,
      strokeAnimationSpeed: 1,
      delayBetweenStrokes: 300,
      charDataLoader,
    });
    svgObserver = new MutationObserver(ensureSvgScale);
  }
  if (svgObserver) {
    svgObserver.observe(writerBox, { childList: true, subtree: true });
  }
  writerPromise = writer.setCharacter(name);
  return writerPromise;
}

// 等筆順資料落地：成功進逐筆練習，失敗顯示靜大字
function showWriter(name) {
  writerPromise.then(() => {
    if (state.currentName !== name) return; // 已換字
    const failed = !writer || !writer._character || writer._loadingManager.loadingFailed;
    if (failed) { fallbackStatic(name); return; }
    ensureSvgScale();
    startQuiz();
  }).catch(() => {
    if (state.currentName === name) fallbackStatic(name);
  });
}

function startQuiz() {
  if (!writer || writerBox.querySelector('.static-char')) return;
  practiceAction++;
  clearTimeout(hintTimer);
  writerHint.classList.remove('show');
  writer.cancelQuiz();
  writer.quiz({
    onComplete: (summary) => {
      if (state.currentName === summary.character) {
        markDone(summary.character);
      }
    },
  });
  setInstructionKey('start');
}

// 一進寫字畫面即逐筆練習；「自己寫」＝重新開始逐筆；「再寫一次」＝重來；
// 「看筆順」＝播放示範，播完筆畫留在畫面（可描摹），要自己寫再按「自己寫」。
function resetWriter() {
  if (!writer || writerBox.querySelector('.static-char')) return;
  startQuiz();
  setInstructionKey('redo');
}
let hintTimer = null;
function showWriterHint(text) {
  writerHint.innerHTML = bpmf(text);
  writerHint.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => writerHint.classList.remove('show'), 4000);
}
// 練習說明（#practiceInstruction）：純文字經 bpmf() 加注音後寫入；
// 只換內容、不自動跳字（無輪播、無定時切換）。
const INSTRUCT = {
  start: '照著淡藍色的字，一筆一筆寫。',
  redo: '好，一筆一筆自己寫。',
  animating: '正在看筆順…',
  animated: '筆順留在畫面上，可沿著描；要自己寫按「自己寫」。',
  done: '寫完了，很棒！可以換下一個字，或再寫一次。',
};
function setInstruction(text) {
  $('practiceInstruction').innerHTML = bpmf(text);
}
function setInstructionKey(k) { setInstruction(INSTRUCT[k]); }
function playAnimate() {
  if (!writer || writerBox.querySelector('.static-char')) return;
  const name = state.currentName;
  const action = ++practiceAction;
  writer.cancelQuiz();
  setInstructionKey('animating');
  writer._withDataPromise
    .catch(() => {})
    .then(() => {
      if (practiceAction !== action || state.currentName !== name || !writer._character) return;
      return writer.animateCharacter();
    })
    .then(() => {
      if (practiceAction !== action || state.currentName !== name) return;
      setInstructionKey('animated');
      showWriterHint('筆順筆畫留在畫面上，可沿著描寫；要自己寫請按「自己寫」');
    });
}

function setGhost(on) {
  state.ghostOn = on;
  $('btnGhost').textContent = (on ? '提示字：開' : '提示字：關');
  $('btnGhost').setAttribute('aria-pressed', String(on));
  if (writer && !writerBox.querySelector('.static-char')) (on ? writer.showOutline() : writer.hideOutline());
}
function setGrid(on) {
  state.gridOn = on;
  $('writerWrap').classList.toggle('no-grid', !on);
  $('btnGrid').textContent = (on ? '▦ 格線：開' : '▦ 格線：關');
  $('btnGrid').setAttribute('aria-pressed', String(on));
}


/* ── 國語辭典面板（逐讀音釋義＋例詞點播＋偏旁說明）──
 * 2014 版每個讀音（字詞號）自帶釋義；課本音標「課本」。
 * 課本音比對：先精確（去 ˙），再退一步去調號（課本「個」讀輕聲 ˙ㄍㄜ，
 * 辭典只有 ㄍㄜˋ/ㄍㄜˇ）。 */
const bookZyHit = (d, bookRaw) => {
  if (!d?.readings?.length || !bookRaw) return null;
  const strip = (z, tones) => (z || '').replace(/˙/g, '').replace(/[ˊˇˋ]/g, tones ? '' : '$&');
  let hit = d.readings.find((r) => strip(r.z) === strip(bookRaw));
  if (!hit) {
    const flat = strip(bookRaw, true);
    hit = flat && d.readings.find((r) => strip(r.z, true) === flat) || null;
  }
  return hit;
};
function renderDict(c) {
  dictBody.scrollTop = 0; // 換字從第一個釋義開始，不沿用上一字的閱讀位置。
  $('dictTitle').textContent = `「${c.name}」的國語辭典`;
  const d = DICT[c.name];
  if (!d) {
    dictBody.innerHTML = '<p class="dict-none">' + bpmf('辭典未收錄此字。') + '</p>';
    return;
  }
  const bookHit = bookZyHit(d, c.zhuYin);
  let h = '';
  // 偏旁／結構說明（給小朋友看）
  if (d.ids) {
    const parts = d.ids.slice(1).replace(/[⿰⿱⿲⿳⿴⿵⿶]/g, '＋');
    const rad = d.radForm || d.radical || '';
    h += `<div class="dict-rad">
      <span class="dict-rad-chip">${rad}</span>
      <span class="dict-rad-text">${bpmf(`偏旁是「${rad}」，這個字由「${parts}」組成`)}</span></div>`;
  }
  // 讀音列（課本音標「課本」，每讀音自帶釋義與例詞）
  h += '<div class="dict-readings">';
  for (const r of d.readings) {
    const isBook = bookHit === r;
    const defs = r.defs || [];
    h += `<div class="dict-reading-group${isBook ? ' is-book' : ''}">
      <div class="dict-reading">
        <span class="dict-zy">${r.z}</span>
        ${isBook ? '<span class="book-tag">課本</span>' : ''}
        ${r.ex ? `<span class="dict-ex-inline">${bpmf(r.ex)}</span>` : ''}
      </div>`;
    if (defs.length) {
      h += '<ol class="dict-defs">';
      for (const it of defs) {
        h += `<li>${it.d}${it.ex ? `<span class="dict-ex">${it.ex}</span>` : ''}</li>`;
      }
      h += '</ol>';
    }
    h += '</div>';
  }
  h += '</div>';
  dictBody.innerHTML = h;
}
/* ── 字典翻頁：保留按鈕操作；拖曳由共用 bindPanelScroll 處理。 ── */
function dictPage(delta) {
  const max = dictBody.scrollHeight - dictBody.clientHeight;
  if (max <= 0) return;
  const step = dictBody.clientHeight * 0.85;
  dictBody.scrollTo({ top: Math.max(0, Math.min(max, dictBody.scrollTop + delta * step)), behavior: 'smooth' });
}
function bindDictScroll() {
  const btnUp = $('btnDictUp'), btnDown = $('btnDictDown');
  btnUp.addEventListener('click', () => dictPage(-1));
  btnDown.addEventListener('click', () => dictPage(1));
  const updateButtons = () => {
    btnUp.disabled = dictBody.scrollTop <= 1;
    btnDown.disabled = dictBody.scrollTop >= dictBody.scrollHeight - dictBody.clientHeight - 1;
  };
  dictBody.addEventListener('scroll', updateButtons, { passive: true });
  $('btnDictClose').addEventListener('click', () => { dictBox.open = false; });
  dictBox.addEventListener('toggle', () => {
    updateButtons();
    if (dictBox.open) dictBody.focus({ preventScroll: true });
    else if (!detail.hidden) dictBox.querySelector('summary').focus({ preventScroll: true });
  });
  new ResizeObserver(updateButtons).observe(dictBody);
  updateButtons();

}

/* Unity 部分 WebView 把觸控轉成 mouse pointer，瀏覽器不會替它原生捲動。
 * 只補 mouse 的垂直拖曳；真 touch 維持原生手勢，書寫畫布與輸入欄位不攔截。
 * 超過門檻才捕捉 pointer，拖曳後吃掉合成 click，避免滑過課卡／按鈕卻誤觸。
 */
function bindPanelScroll() {
  const regions = '.topbar, main, #setup, .detail-inner, #dictBody, .worksheet-panel-inner';
  let drag = null;
  let suppressClick = false;

  const stopDrag = () => {
    if (!drag) return;
    const { panel, id } = drag;
    drag = null;
    if (panel.hasPointerCapture(id)) panel.releasePointerCapture(id);
  };
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    stopDrag();
    suppressClick = false;
    const target = e.target;
    if (!(target instanceof Element) ||
        target.closest('.writer-wrap, input, textarea, select, a, [contenteditable="true"]')) return;
    const panel = target.closest(regions);
    if (!panel || panel.scrollHeight <= panel.clientHeight + 1) return;
    const rect = panel.getBoundingClientRect();
    if (e.clientX >= rect.left + panel.clientWidth) return; // 原生捲軸自行處理。
    drag = {
      panel, id: e.pointerId, x: e.clientX, y: e.clientY,
      top: panel.scrollTop, moved: false,
    };
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(dy) < 8 || Math.abs(dy) <= Math.abs(e.clientX - drag.x)) return;
      drag.moved = true;
      suppressClick = true;
      drag.panel.setPointerCapture(drag.id);
    }
    e.preventDefault();
    drag.panel.scrollTop = drag.top - dy;
  }, { passive: false });
  document.addEventListener('pointerup', (e) => {
    if (drag?.id === e.pointerId) stopDrag();
  });
  document.addEventListener('pointercancel', (e) => {
    if (drag?.id !== e.pointerId) return;
    stopDrag();
    suppressClick = false;
  });
  document.addEventListener('lostpointercapture', (e) => {
    if (drag?.id === e.pointerId) drag = null;
  });
  window.addEventListener('blur', () => {
    stopDrag();
    suppressClick = false;
  });
  document.addEventListener('click', (e) => {
    if (!suppressClick || e.detail === 0) return; // 鍵盤操作不受影響。
    suppressClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
}

/* ── 詳細視窗 ──
 * 畫布左右 ‹ › ＝課內上一字／下一字（邊界自動禁用）；
 * 頂列 ✕（及 Esc）＝關閉回字卡，並回捲到該字卡；字卡頁頂欄「選課」換課次。 */
function openDetail(c) {
  const chars = courseChars();
  let idx = chars.indexOf(c);
  if (idx < 0) idx = chars.findIndex((x) => x.name === c.name);
  state.currentChar = c;
  state.currentName = c.name;
  state.charIdx = idx;
  const d = DICT[c.name];
  dChar.textContent = c.name;
  // 注音＝課本讀音（非辭典第一讀音），右側直排 .z-ruby 結構
  dZhuYin.innerHTML = window.bpmfRuby(c.zhuYin);
  const radForm = d?.radForm || c.radical;
  const radicalName = d?.radical || c.radical || '';
  // 注音函數只收純文字；HTML 片段組裝完成後再插入
  dMeta.innerHTML = [
    (idx >= 0 ? `<span class="meta-item">${bpmf(`第 ${idx + 1}／${chars.length} 字`)}</span>` : ''),
    `<span class="meta-item">${bpmf('✍️ ')}${d?.strokes || c.fullStroke} ${bpmf('畫')}</span>`,
    (radForm ? `<span class="meta-item">${bpmf('🔤 部首 ')}${radForm}${radicalName && radicalName !== radForm ? bpmf(`（${radicalName}）`) : ''}</span>` : ''),
  ].join('');
  // 視窗打開時焦點移入視窗、不留在被遮的字卡上；關閉時焦點還原字卡（見 closeDetail）
  const firstOpen = detail.hidden;
  detail.hidden = false;
  document.body.style.overflow = 'hidden';
  if (firstOpen) {
    setInstructionKey('start');
    $('btnClose').focus();
  }
  // 「已練習」標記隨字更新（完成才顯示，換字不殘留）
  doneFlag.classList.toggle('show', doneSet().has(c.name));
  const atFirst = idx <= 0, atLast = idx < 0 || idx >= chars.length - 1;
  $('btnPrev').disabled = atFirst;
  $('btnNext').disabled = atLast;

  // 固定 480 內部空間，CSS 縮放；首次開啟延遲載入離線筆順包
  ensureWriter(c.name);
  setGhost(state.ghostOn);
  showWriter(c.name);
  renderDict(c);
  dictBox.removeAttribute('open');
}

function closeDetail() {
  practiceAction++;
  clearTimeout(hintTimer);
  writerHint.classList.remove('show');
  const el = grid.querySelector(`.char-card[data-name="${CSS.escape(state.currentName)}"]`);
  // 先取消逐筆練習：避免視窗已關、慢速 onComplete 回調仍標記完成（stale async callback）
  if (writer) writer.cancelQuiz();
  detail.hidden = true;
  state.currentChar = null;
  state.currentName = null;
  state.charIdx = null;
  // writer 常駐（setCharacter 會清手筆），僅隱藏視窗
  document.body.style.overflow = '';
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' }); // 回捲到該字卡
    el.focus({ preventScroll: true }); // 焦點還原到字卡，不留在已隱藏視窗內
  }
  refreshCardStates();
  refreshProgress();
}

// 課內翻字：‹ 上一字／› 下一字（邊界無可翻字時按鈕禁用）
function stepChar(delta) {
  if (state.charIdx == null) return;
  const chars = courseChars();
  const ni = state.charIdx + delta;
  if (ni < 0 || ni >= chars.length) return;
  setInstructionKey('start'); // 翻字＝新字，說明回到起步語（startQuiz 同文，不重複觸發）
  openDetail(chars[ni]);
}



/* ── PDF 建置共用資料（無網頁預覽介面）───────────── */
// PDF 格內座標：依教育部手冊，調號位於末符右上，輕聲在整個字音上方。
function sheetRubyMarks(reading) {
  const { bopo, tone, light } = bpmfParts(reading);
  const symbols = [...bopo];
  const top = 500 - (symbols.length - 1) * 150 / 2;
  const marks = symbols.map((text, i) => ({ text, x: 800, y: top + i * 150 }));
  if (tone) marks.push({ text: tone, x: 925, y: top + (symbols.length - 1) * 150 - 75 });
  if (light) marks.push({ text: light, x: 800, y: top - 140 });
  return marks;
}

function sheetCourses(selection, wholeSemester) {
  // 建置端明確指定選課；整學期包含特殊單元 0。
  const sem = DATA[selection.version]?.[selection.grade]?.[selection.semester];
  if (!sem) return [];
  const nums = Object.keys(sem).map(Number).sort((a, b) => a - b);
  const sel = wholeSemester ? nums : [Number(selection.course)];
  const semName = { '1': '上學期', '2': '下學期' }[selection.semester] || '';
  return sel.filter((n) => sem[n]).map((n) => ({
    title: (n === 0 ? '特殊單元' : `第 ${n} 課`) +
      `　${VERSION_LABELS[selection.version] || selection.version}版・${['', '一', '二', '三', '四', '五', '六'][selection.grade] || selection.grade}年級・${semName}`,
    chars: sem[n].slice(),
  }));
}

/* ── 事件綁定 ── */
function bind() {
  selVersion.addEventListener('change', onFilterChange);
  selGrade.addEventListener('change', onFilterChange);
  selSemester.addEventListener('change', onFilterChange);
  selClass.addEventListener('change', () => {
    if (!selClass.value) return;
    const wasDetailOpen = !detail.hidden && state.course !== selClass.value;
    if (wasDetailOpen) closeDetail(); // 已開字卡屬於舊課
    state.course = selClass.value;
    renderGrid();
    if (wasDetailOpen) selClass.focus(); // 舊字卡已重建，焦點回到操作中的課次選單
    setupSave();
    if (!$('setup').hidden) renderSetupSteps();
  });

  // 詳細視窗開關
  $('btnClose').addEventListener('click', closeDetail);
  detail.addEventListener('click', (e) => { if (e.target === detail) closeDetail(); });
  bindDictScroll();
  bindPanelScroll();
  document.addEventListener('keydown', (e) => {
    if (!$('worksheetPanel').hidden) return; // 下載面板自行處理焦點與 Escape。
    if (e.key === 'Escape') {
      if (dictBox.open) dictBox.open = false;
      else if (!detail.hidden) closeDetail();
      return;
    }
    // 寫字畫面：← → 課內翻字
    if (!detail.hidden) {
      if (e.key === 'ArrowLeft') stepChar(-1);
      else if (e.key === 'ArrowRight') stepChar(1);
    }
  });

  // 寫字控制
  $('btnAnimate').addEventListener('click', playAnimate);
  $('btnQuiz').addEventListener('click', startQuiz);
  $('btnClear').addEventListener('click', resetWriter);
  $('btnGrid').addEventListener('click', () => setGrid(!state.gridOn));
  $('btnGhost').addEventListener('click', () => setGhost(!state.ghostOn));
  $('btnPrev').addEventListener('click', () => stepChar(-1));
  $('btnNext').addEventListener('click', () => stepChar(1));

  // 先選課，再決定開始練習或下載；點選課次不自動離開選課頁。
  $('setupSteps').addEventListener('click', (e) => {
    const card = e.target.closest('.setup-card');
    if (!card) return;
    const k = card.dataset.k, v = card.dataset.v;
    if (k === 'v') applySel(v, null, null, null, false);
    else if (k === 'g') applySel(null, v, null, null, false);
    else if (k === 's') applySel(null, null, v, null, false);
    else applySel(null, null, null, v, false);
    // 選課會重建卡片，將鍵盤焦點還給同一張卡。
    Array.from($('setupSteps').querySelectorAll('.setup-card'))
      .find((button) => button.dataset.k === k && button.dataset.v === v)?.focus({ preventScroll: true });
  });
  $('btnStart').addEventListener('click', () => applySel(null, null, null, null, true));
  $('btnChoose').addEventListener('click', showSetup);
  $('btnSetup').addEventListener('click', showSetup);
  for (const button of document.querySelectorAll('[data-open-download]')) {
    button.addEventListener('click', () => {
      $('appSettings').open = false;
      window.WorksheetDownloads.open({
        version: state.version, grade: state.grade, semester: state.semester, course: state.course,
      }, button);
    });
  }

  // 整個介面大小自動記憶；宿主安全區不跟著縮放。
  fsCtl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-fs]');
    if (!b) return;
    setFs(Number(b.dataset.fs));
  });
}

/* ── 介面用字加注音（bpmf.js）：只在「學習內容」區域加注音（課次說明、國語辭典）。
   標題／篩選器／按鈕等 UI 標籤不加：注音在狹窄標籤會折行、蓋住文字；
   生字讀音已顯示在字卡與寫字畫面，UI 標籤不必重複。 */
function annotateUI() {
  const sum = document.querySelector('.detail-dict > summary');
  if (sum) sum.textContent = '教育部國語辭典';
}

/* ── 進入引導：先選版本→年級→學期→課次，再開始練習或下載 ── */
const sel = { version: null, grade: null, semester: null, course: null };
function refreshSel() {
  sel.version = selVersion.value || null;
  sel.grade = selGrade.value || null;
  sel.semester = selSemester.value || null;
  sel.course = selClass.value || null;
}
function setupLast() {
  try {
    const raw = JSON.parse(store.get('hw_last_course') || 'null');
    return raw && typeof raw === 'object' ? raw : null;
  } catch { return null; }
}
function setupSave() {
  refreshSel();
  const v = VERSION_LABELS[state.version] || state.version || '';
  const g = ['', '一', '二', '三', '四', '五', '六'][state.grade] || state.grade || '';
  store.set('hw_last_course', JSON.stringify({
    v, gk: state.grade, g, s: state.semester, c: state.course,
    text: `${v}・${g}年級・${state.semester === '1' ? '上' : '下'}學期・${state.course === '0' ? '特殊單元' : `第 ${state.course} 課`}`,
  }));
  $('currentSelection').textContent =
    `${v}版・${g}年級・${state.semester === '1' ? '上' : '下'}學期・${state.course === '0' ? '特殊單元' : `第 ${state.course} 課`}`;
  document.dispatchEvent(new CustomEvent('worksheet-selection-change', {
    detail: { version: state.version, grade: state.grade, semester: state.semester, course: state.course },
  }));
}
function semNames(ver, grade) {
  const out = [];
  for (const s of ['1', '2']) if (ver?.[grade]?.[s]) out.push(s);
  return out.length ? out : ['1'];
}
function renderSetupSteps() {
  refreshSel();
  const stepsBox = $('setupSteps');
  const summary = $('setupSummary');
  let h = '';
  const step = (label, cards, current, kind) => {
    h += `<section class="setup-step" aria-label="${label}"><h3 class="setup-step-label">${label}</h3><div class="setup-cards${kind === 'c' ? ' setup-cards-course' : ''}">`;
    for (const c of cards) {
      h += `<button type="button" class="setup-card${kind === 'c' ? ' setup-card-course' : ''}${c.v === current ? ' on' : ''}" data-k="${kind}" data-v="${c.v}" aria-pressed="${c.v === current}">${c.text}</button>`;
    }
    h += '</div></section>';
  };
  step('版本', Object.keys(DATA).map((v) => ({ v, text: (VERSION_LABELS[v] || v) + '版' })), sel.version, 'v');
  const ver = DATA[sel.version];
  const grades = sel.version && ver ? Object.keys(ver).sort((a, b) => a - b) : ['1'];
  step('年級', grades.map((g) => ({ v: g, text: `${['', '一', '二', '三', '四', '五', '六'][g] || g}年級` })), sel.grade, 'g');
  const sems = semNames(ver, sel.grade);
  step('學期', sems.map((s) => ({ v: s, text: `${s === '1' ? '上' : '下'}學期` })), sel.semester, 's');
  const cls = ver?.[sel.grade]?.[sel.semester] || {};
  const courses = Object.keys(cls).sort((a, b) => Number(a) - Number(b));
  step('課次', courses.map((c) => ({ v: c, text: c === '0' ? '特殊單元' : `第 ${c} 課` })), sel.course, 'c');
  stepsBox.innerHTML = h;
  const v = VERSION_LABELS[sel.version] || sel.version || '';
  const g = ['', '一', '二', '三', '四', '五', '六'][sel.grade] || sel.grade || '';
  const courseTxt = sel.course === '0' ? '特殊單元' : `第 ${sel.course} 課`;
  summary.textContent = `${v}版・${g}年級・${sel.semester === '1' ? '上' : '下'}學期・${courseTxt}`;
}
function applySel(version, grade, semester, course, startPractice) {
  if (version) state.version = version;
  if (grade) state.grade = grade;
  if (semester) state.semester = semester;
  const ver = DATA[state.version];
  if (!ver?.[state.grade]) state.grade = Object.keys(ver).sort((a, b) => a - b)[0];
  if (!ver[state.grade][state.semester]) state.semester = semNames(ver, state.grade)[0];
  if (course) state.course = course;
  state.course = validCourse(ver, state.grade, state.semester);
  fillGrades();
  selVersion.value = state.version;
  selGrade.value = state.grade;
  selSemester.value = state.semester;
  fillClasses();
  selClass.value = state.course;
  renderGrid();
  if (!$('setup').hidden) renderSetupSteps();
  setupSave();
  if (startPractice) {
    $('setup').hidden = true;
    document.querySelector('main').inert = false;
    $('appSettings').open = false;
    document.querySelector('main').scrollTop = 0;
    grid.querySelector('.char-card')?.focus({ preventScroll: true });
  }
}
function showSetup() {
  if (!detail.hidden) closeDetail(); // 選課前先關字卡，避免選課後還留著舊字
  renderSetupSteps();
  $('setup').hidden = false;
  document.querySelector('main').inert = true;
  $('appSettings').open = false;
  $('setup').scrollTop = 0;
  $('setupTitle').focus({ preventScroll: true });
}
function initSetup() {
  const last = setupLast();
  let v, g, s, c;
  if (last) {
    const vk = Object.keys(VERSION_LABELS).find((k) => VERSION_LABELS[k] === last.v) || last.v;
    const gkMap = { '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6' };
    if (last.v && DATA[vk]) { v = vk; g = last.gk || gkMap[last.g] || last.g; s = last.s; c = last.c; }
  }
  if (!v) {
    v = Object.keys(DATA)[0];
    g = Object.keys(DATA[v]).sort((a, b) => a - b)[0];
    s = '1';
    c = DATA[v]?.[g]?.['0'] ? '0' : '1';
  }
  applySel(v, g, s, c, false);
  showSetup();
}

/* ── 畫面大小：沿用 hw_fs 值，標準 33px／特大 39.6px（瀏覽器預設 16px 時）。 ── */
const FS_LEVELS = [22, 26.4];
function setFs(px) {
  if (!FS_LEVELS.includes(px)) return;
  state.fs = px;
  document.documentElement.style.setProperty('--ui-scale', String(px / 22));
  store.set('hw_fs', String(px));
  for (const b of fsCtl.querySelectorAll('button[data-fs]')) {
    b.classList.toggle('on', Number(b.dataset.fs) === px);
    b.setAttribute('aria-pressed', String(Number(b.dataset.fs) === px));
  }
}
function loadFs() {
  const saved = Number(store.get('hw_fs'));
  setFs(FS_LEVELS.includes(saved) ? saved : 22);
}

/* ── 啟動 ── */
loadFs();
loadDone();
fillVersions();
fillGrades();
fillClasses();
renderGrid();
bind();
annotateUI();
initSetup();

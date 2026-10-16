/* ── 手寫練習 ─────────────────────────────────────────────
 * 資料來源：
 *   115上114下學期生字表 xlsx（南一／康軒／翰林）→ data.js
 *   教育部《國語辭典》2014 版匯出 → dict.js（逐讀音 注音/釋義/例詞/部首/IDS，含字詞號）
 *   唸字功能已移除（內嵌瀏覽器無 TTS）；注音改為版面顯示
 *   HanziWriter（筆順動畫＋逐筆練習）
 * DATA[版本][年級 1..6][學期 1|2][課次 '0'=特殊單元,'1'..'12'] = [{name,zhuYin,fullStroke,radical,type}]
 * ──────────────────────────────────────────────────────── */
'use strict';

const DATA = window.HANDWRITING_DATA;
// 版本顯示名（資料鍵與 localStorage 鍵仍用原值 南一/康軒/翰林）
const VERSION_LABELS = { '南一': '南南', '康軒': '康康', '翰林': '翰翰' };
const DICT = window.HANDWRITING_DICT || {};

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
  fs: 22, // 介面字號：22 特大(基準)／29 超大（root font-size 驅動整體放大）
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
function loadDone() {
  try { state.done = JSON.parse(localStorage.getItem('hw_practice_done') || '{}'); }
  catch { state.done = {}; }
  for (const k in state.done) state.done[k] = new Set(state.done[k]);
}
function saveDone() {
  const out = {};
  for (const k in state.done) out[k] = [...state.done[k]];
  localStorage.setItem('hw_practice_done', JSON.stringify(out));
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
  if (!selClass.value || !sem?.[state.course]) state.course = sem?.['0'] ? '0' : '1';
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
    const card = document.createElement('div');
    card.className = 'char-card' + (d.has(c.name) ? ' done' : '');
    card.dataset.name = c.name;
    card.innerHTML =
      `<div class="card-body">` +
      `<span class="zhuyin">${c.zhuYin}</span>` +
      `<span class="char">${c.name}</span>` +
      `</div>` +
      (radForm ? `<span class="rad-badge" title="部首：${dc?.radical || radForm}">${radForm}</span>` : '') +
      `<span class="strokes">${c.fullStroke} 筆</span>` +
      (c.type === '認讀字' ? '<span class="type-tag" title="認讀字（認得即可）">認</span>' : '') +
      (d.has(c.name) ? '<span class="done-mark">✔</span>' : '');
    card.addEventListener('click', () => openDetail(c));
    frag.appendChild(card);
  }
  grid.appendChild(frag);
  refreshProgress();
}

function onFilterChange() {
  state.version = selVersion.value;
  state.grade = selGrade.value;
  state.semester = selSemester.value;
  fillGrades();
  fillClasses();
  renderGrid();
  setupSave();
}

/* ── HanziWriter（筆順動畫＋逐筆練習）──
 * 筆順資料：本機 hanzi-data.js（全課 2993 字，含教育部筆順網補 20 字、彎筆中線
 * 沿中心線重算，離線可用）；缺字時回落 jsdelivr 線上資料；兩者皆無 → 靜態大字模式。 */
let hanziDataReady = null; // Promise
function loadHanziData() {
  if (window.HANZI_DATA) return Promise.resolve(true);
  if (hanziDataReady) return hanziDataReady;
  hanziDataReady = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'hanzi-data.js?v=3';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false); // 離線包不在 → 靠 CDN 回落
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
  // 無筆順資料：顯示靜態大字供臨摹。
  if (svgObserver) { svgObserver.disconnect(); svgObserver = null; }
  writer = null;
  writerBox.innerHTML =
    `<div class="static-char">${name}</div>` +
    '<div class="static-note">此字無筆順動畫，請依範字書寫</div>';
}
// 單一 writer 實例；換字用 setCharacter（自動清手筆＋重載筆順），
// 避免每次 create 在 document 累積 mouseup/touchend 監聽器。
let writerPromise = Promise.resolve();
function ensureWriter(name) {
  if (!writer || writerBox.querySelector('.static-char')) {
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
  if (!writer) return;
  writer.cancelQuiz();
  writer.quiz({
    onComplete: (summary) => {
      if (state.currentName === summary.character) {
        markDone(summary.character);
      }
    },
  });
}

// 一進寫字畫面即逐筆練習；重來＝重新開始；
// 筆順動畫＝播放示範，播完筆畫留在畫面（可描摹），要自己寫再按「逐筆練習」或「重來」。
function resetWriter() {
  if (!writer) return;
  startQuiz();
}
let hintTimer = null;
function showWriterHint(text) {
  writerHint.innerHTML = bpmf(text);
  writerHint.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => writerHint.classList.remove('show'), 4000);
}
function playAnimate() {
  if (!writer) return;
  const name = state.currentName;
  writer.cancelQuiz();
  writer._withDataPromise
    .catch(() => {})
    .then(() => {
      if (state.currentName !== name || !writer._character) return;
      return writer.animateCharacter();
    })
    .then(() => {
      if (state.currentName !== name) return;
      showWriterHint('筆順筆畫留在畫面上，可沿著描寫；要自己寫請按「逐筆練習」');
    });
}

function setGhost(on) {
  state.ghostOn = on;
  $('btnGhost').textContent = (on ? '👁 虛影：開' : '👁 虛影：關');
  $('btnGhost').setAttribute('aria-pressed', String(on));
  if (writer) (on ? writer.showOutline() : writer.hideOutline());
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
  dZhuYin.textContent = c.zhuYin;
  const radForm = d?.radForm || c.radical;
  const radicalName = d?.radical || c.radical || '';
  dMeta.innerHTML = bpmf([
    (idx >= 0 ? `<span class="meta-item">第 ${idx + 1}／${chars.length} 字</span>` : ''),
    `<span class="meta-item">✍️ ${d?.strokes || c.fullStroke} 畫</span>`,
    (radForm ? `<span class="meta-item">🔤 部首 ${radForm}${radicalName && radicalName !== radForm ? `（${radicalName}）` : ''}</span>` : ''),
  ].join(''));
  detail.hidden = false;
  document.body.style.overflow = 'hidden';
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
  const el = grid.querySelector(`.char-card[data-name="${CSS.escape(state.currentName)}"]`);
  detail.hidden = true;
  state.currentChar = null;
  state.currentName = null;
  state.charIdx = null;
  // writer 常駐（setCharacter 會清手筆），僅隱藏視窗
  document.body.style.overflow = '';
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); // 回捲到該字卡
  refreshCardStates();
  refreshProgress();
}

// 課內翻字：‹ 上一字／› 下一字（邊界無可翻字時按鈕禁用）
function stepChar(delta) {
  if (state.charIdx == null) return;
  const chars = courseChars();
  const ni = state.charIdx + delta;
  if (ni < 0 || ni >= chars.length) return;
  openDetail(chars[ni]);
}



/* ── 習字本／學習手冊（生成＋列印）─────────────
 * 每字一組：六格全寬（範字／筆順＋號／描紅／空格×3）在上，
 * 學習手冊註解（注音・筆畫・部首・釋義・例詞）整行在下；
 * 每課分頁（A4 每頁 8 字）；「整學期」＝同年級同學期全部課次。
 * 筆順 SVG 直接取 window.HANZI_DATA（hanzi-writer 格式，y 向上，資料框 0..1024 / -124..900）。 */
const SHEET_PAGE_CHARS = 8;
const SHEET_NS = 'http://www.w3.org/2000/svg';

// 筆順 SVG（紅筆畫，無筆順號）；無筆順資料回 null（該格變空格）。
// 筆畫資料為 hanzi-writer 慣例：y 向上、資料框 x 0..1024 / y -124..900；
// SVG 座標 y 向下，故群組翻轉＋縮放讓筆畫正立。
function strokeSvg(name) {
  const d = window.HANZI_DATA && window.HANZI_DATA[name];
  if (!d || !d.strokes) return null;
  const s = 1000 / 1024;               // 資料框 1024 → 1000
  const fy = (900 * s).toFixed(2);      // y 翻轉的平移項
  const svg = document.createElementNS(SHEET_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 1000');
  svg.setAttribute('aria-hidden', 'true');
  const g = document.createElementNS(SHEET_NS, 'g');
  g.setAttribute('transform', `matrix(${s},0,0,${-s},0,${fy})`);
  d.strokes.forEach((st) => {
    const p = document.createElementNS(SHEET_NS, 'path');
    p.setAttribute('d', st);
    g.appendChild(p);
  });
  svg.appendChild(g);
  return svg;
}

// 一格：cls='cell-ref' 黑字／'cell-stroke' 紅筆順／'cell-trace' 淡灰描紅／'cell-blank' 空格。
// 範字／描紅用 SVG 文字（viewBox 0 0 1000 1000），隨格子等比縮放，
// 手機小格與 A4 大格字體比例一致，不會溢出格子。
function sheetCell(name, cls) {
  const cell = document.createElement('div');
  cell.className = 'cell ' + cls;
  if (cls === 'cell-stroke') {
    const svg = strokeSvg(name);
    if (svg) { cell.appendChild(svg); return cell; }
  }
  if (name && (cls === 'cell-ref' || cls === 'cell-trace')) {
    const svg = document.createElementNS(SHEET_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 1000 1000');
    svg.setAttribute('aria-hidden', 'true');
    const t = document.createElementNS(SHEET_NS, 'text');
    t.setAttribute('x', '500');
    t.setAttribute('y', '500');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.classList.add('cell-glyph');
    t.textContent = name;
    svg.appendChild(t);
    cell.appendChild(svg);
  }
  return cell;
}

function sheetRow(ch) {
  const opts = { stroke: $('sheetStroke').checked, trace: $('sheetTrace').checked,
                 dict: $('sheetDict').checked, pinyin: $('sheetPinyin').checked };
  const row = document.createElement('div');
  row.className = 'ch-row';
  // 六格全寬（與 A4 同比例，不縮小）
  const cells = document.createElement('div');
  cells.className = 'ch-cells';
  cells.append(sheetCell(ch.name, 'cell-ref'));
  cells.appendChild(opts.stroke ? sheetCell(ch.name, 'cell-stroke') : sheetCell('', 'cell-blank'));
  cells.append(opts.trace ? sheetCell(ch.name, 'cell-trace') : sheetCell('', 'cell-blank'),
               sheetCell('', 'cell-blank'), sheetCell('', 'cell-blank'), sheetCell('', 'cell-blank'));
  row.appendChild(cells);
  // 學習手冊註解：移到格子下方整行（不擠在右側窄欄，不再把行撐高、行間出現白帶）
  if (opts.dict) {
    const d = DICT[ch.name];
    const reading = bookZyHit(d, ch.zhuYin) || (d && d.readings && d.readings[0]);
    const radForm = d?.radForm || ch.radical;
    const info = document.createElement('div');
    info.className = 'ch-info';
    info.innerHTML =
      (opts.pinyin ? `<span class="i-zy">${ch.zhuYin}</span>　` : '') +
      `<span class="i-meta">${d?.strokes || ch.fullStroke} 筆` +
      (radForm ? `・部首 ${radForm}` : '') + (ch.type === '認讀字' ? '・認讀字' : '') + '　</span>' +
      (reading?.defs?.[0]?.d ? `<span class="i-def">${reading.defs[0].d}</span>` : '') +
      (reading?.ex ? `<span class="i-ex">例：${reading.ex.split('、')[0]}</span>` : '');
    row.appendChild(info);
  }
  return row;
}

function sheetPageHead(title) {
  const hd = document.createElement('div');
  hd.className = 'sheet-hd';
  hd.innerHTML =
    `<span class="hd-title">${title}</span><span class="hd-line"></span>` +
    '<span class="hd-label">姓名：<span class="hd-line"></span></span>';
  return hd;
}

function sheetCourses() {
  // 「整學期」＝同年級同學期全部課次（含特殊單元 0）；否則目前課
  const sem = DATA[state.version]?.[state.grade]?.[state.semester];
  if (!sem) return [];
  const nums = Object.keys(sem).map(Number).sort((a, b) => a - b);
  const sel = $('sheetGrade').checked ? nums : [Number(state.course)];
  const semName = { '1': '上學期', '2': '下學期' }[state.semester] || '';
  return sel.filter((n) => sem[n]).map((n) => ({
    title: (n === 0 ? '特殊單元' : `第 ${n} 課`) +
      `　${VERSION_LABELS[state.version] || state.version}版・${['', '一', '二', '三', '四', '五', '六'][state.grade] || state.grade}年級・${semName}`,
    chars: sem[n].slice(),
  }));
}

function renderSheet() {
  const scroll = $('sheetScroll');
  scroll.innerHTML = '';
  let total = 0;
  for (const cr of sheetCourses()) {
    const rows = cr.chars.map((ch) => { total++; return sheetRow(ch); });
    for (let i = 0; i < rows.length; i += SHEET_PAGE_CHARS) {
      const page = document.createElement('section');
      page.className = 'sheet-page';
      page.appendChild(sheetPageHead(cr.title));
      for (const r of rows.slice(i, i + SHEET_PAGE_CHARS)) page.appendChild(r);
      scroll.appendChild(page);
    }
  }
  $('sheetCount').textContent = total ? `共 ${total} 字・${scroll.querySelectorAll('.sheet-page').length} 頁 A4` : '（此課沒有生字）';
}

let sheetToken = 0;
function openSheet() {
  const tok = ++sheetToken;
  $('sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  // 筆順 SVG 需要 hanzi-data（延遲載入）；先顯示格子，資料落地再補筆順
  renderSheet();
  loadHanziData().then(() => { if (tok === sheetToken) renderSheet(); });
}
function closeSheet() {
  sheetToken++;
  $('sheet').hidden = true;
  document.body.style.overflow = '';
}

/* ── 習字本 PDF 下載（jsPDF + canvas 自繪 A4 版面）──
 * 嵌入式 WebView 的 window.print() 常無支援、系統預覽頁裁切也不可靠；
 * 改由 canvas 直接繪製每一頁 A4（版型與螢幕 .sheet-page 相同），jsPDF 輸出真實
 * PDF 檔（字型嵌入、任何裝置開啟一致）並下載。
 * 尺寸：mm → px 固定 4（1mm＝4px），1191×1684px＝A4。 */
function sheetOpts() {
  return { stroke: $('sheetStroke').checked, trace: $('sheetTrace').checked,
           dict: $('sheetDict').checked, pinyin: $('sheetPinyin').checked };
}

// 筆順 path 解析（hanzi-writer 格式：y 向上、資料框 1024、M/L/Q/C/Z 指令）；
// 轉成 0..1000 格內座標（y 向下），回每筆畫的段序列 [ ['M',x,y], ['L',..], ['Q',..], ['C',..] ]。
function strokePaths(name) {
  const d = window.HANZI_DATA && window.HANZI_DATA[name];
  if (!d || !d.strokes) return null;
  const s = 1000 / 1024, fy = 900 * s;
  const X = (v) => v * s, Y = (v) => fy - v * s;
  const out = [];
  const re = /([MLQC])([^MLQC]*)/g;
  for (const str of d.strokes) {
    const stroke = [];
    let m;
    while ((m = re.exec(str))) {
      const op = m[1];
      const n = m[2].trim().split(/[\s,]+/).map(parseFloat);
      if (op === 'M') { stroke.push(['M', X(n[0]), Y(n[1])]); }
      else if (op === 'L') { stroke.push(['L', X(n[0]), Y(n[1])]); }
      else if (op === 'Q') { stroke.push(['Q', X(n[0]), Y(n[1]), X(n[2]), Y(n[3])]); }
      else if (op === 'C') { stroke.push(['C', X(n[0]), Y(n[1]), X(n[2]), Y(n[3]), X(n[4]), Y(n[5])]); }
    }
    if (stroke.length) out.push(stroke);
  }
  return out.length ? out : null;
}

function truncPx(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

// 繪一頁 A4 到 canvas（g：course 資料＋該頁字元）。版面＝螢幕 .sheet-page 的鏡像。
function drawSheetPage(cv, g) {
  const ctx = cv.getContext('2d');
  const W = 1191, H = 1684;                 // A4 @4px/mm
  const px = (mm) => mm * 4;
  const padT = px(4), padL = px(3), padB = px(4), padR = px(3);
  const cw = W - padL - padR;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const ink = '#33302c', muted = '#8a8378', blue = '#4263eb', accent = '#e8590c';
  const F = (sz, fam, w) => `${w || 400} ${sz}px ${fam || '"TW-Kai","BiauKai","Kaiti TC",serif'}`;
  // 表頭（hd-title 11pt≈57px）＋頁碼
  let x = padL;
  ctx.fillStyle = ink; ctx.font = F(57, null, 700); ctx.textBaseline = 'alphabetic';
  ctx.fillText(g.title, x, padT + 57); x += ctx.measureText(g.title).width + px(2.4);
  ctx.font = F(31, null, 400); ctx.fillStyle = muted;
  const label = '姓名：';
  ctx.fillText(label, x + px(12), padT + 45);
  const lw = ctx.measureText(label).width;
  const lineY = padT + 50, lineEnd = W - padR - px(16) - px(30) - px(11);
  ctx.strokeStyle = '#c9c2b4'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.moveTo(x + px(2.4), lineY); ctx.lineTo(lineEnd, lineY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + lw + px(12), lineY); ctx.lineTo(W - padR - px(16) - px(18), lineY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = muted; ctx.font = F(34, null, 400);
  ctx.textAlign = 'right';
  ctx.fillText(`第 ${g.pg} 頁`, W - padR, padT + 45);
  ctx.textAlign = 'left';
  const ruleY = padT + px(2.4) + 57 + px(1);
  ctx.strokeStyle = ink; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(padL, ruleY); ctx.lineTo(W - padR, ruleY); ctx.stroke();
  // 8 列
  const top = ruleY + px(2), bottom = H - padB;
  const gapRows = px(0.6) * 8;
  const infoH = g.dict ? 44 : 0;
  const gapInfo = g.dict ? px(0.6) * 8 : 0;
  const cell = Math.min(cw, Math.floor((bottom - top - gapRows - infoH * 8 - gapInfo) / 8));
  let y = top;
  const opts = g.opts;
  for (const ch of g.chars) {
    // 六格
    const gap = px(1.2);
    const total = cell * 6 + gap * 5;
    const ox = padL + Math.floor((cw - total) / 2);
    for (let i = 0; i < 6; i++) {
      const cx0 = ox + i * (cell + gap);
      if (i === 0 || i === 2) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx0, y, cell, cell);
        ctx.strokeStyle = '#e8b4b4'; ctx.lineWidth = 2;
        const mid = cell / 2;
        ctx.beginPath();
        ctx.moveTo(cx0 + mid, y); ctx.lineTo(cx0 + mid, y + cell);
        ctx.moveTo(cx0, y + mid); ctx.lineTo(cx0 + cell, y + mid);
        ctx.stroke();
        ctx.strokeStyle = ink; ctx.lineWidth = 2.5;
        ctx.strokeRect(cx0 + 1.25, y + 1.25, cell - 2.5, cell - 2.5);
        if (i === 0) {
          ctx.fillStyle = ink; ctx.font = F(cell * 0.95);
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(ch.name, cx0 + cell / 2, y + cell / 2 + cell * 0.04);
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        } else if (opts.stroke) {
          const paths = strokePaths(ch.name);
          if (paths) {
            ctx.save();
            ctx.translate(cx0, y);
            ctx.scale(cell / 1000, cell / 1000);
            ctx.strokeStyle = 'rgba(212,56,13,.40)';
            ctx.lineWidth = 30;
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath();
            for (const stroke of paths) {
              for (const seg of stroke) {
                if (seg[0] === 'M') ctx.moveTo(seg[1], seg[2]);
                else if (seg[0] === 'L') ctx.lineTo(seg[1], seg[2]);
                else if (seg[0] === 'Q') ctx.quadraticCurveTo(seg[1], seg[2], seg[3], seg[4]);
                else ctx.bezierCurveTo(seg[1], seg[2], seg[3], seg[4], seg[5], seg[6]);
              }
            }
            ctx.stroke();
            ctx.restore();
          }
        } else if (i === 2 && opts.trace) {
          ctx.fillStyle = 'rgba(60,60,60,.30)'; ctx.font = F(cell * 0.95);
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(ch.name, cx0 + cell / 2, y + cell / 2 + cell * 0.04);
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        }
      } else {
        ctx.strokeStyle = ink; ctx.lineWidth = 2.5;
        ctx.strokeRect(cx0 + 1.25, y + 1.25, cell - 2.5, cell - 2.5);
      }
    }
    y += cell + px(0.6);
    if (opts.dict) {
      const d = DICT[ch.name];
      const reading = g.readings && g.readings[ch.name];
      ctx.fillStyle = blue; ctx.font = F(42, '"BpmfGenSenRounded","TW-Kai",serif', 700);
      let ix = ox;
      if (opts.pinyin) { ctx.fillText(ch.zhuYin, ix, y + 40); ix += ctx.measureText(ch.zhuYin).width + 18; }
      ctx.fillStyle = muted; ctx.font = F(33);
      const meta = `${d && d.strokes ? d.strokes : ch.fullStroke} 筆` +
        (d && d.radForm ? `・部首 ${d.radForm}` : '') +
        (ch.type === '認讀字' ? '・認讀字' : '') + '　';
      ctx.fillText(meta, ix, y + 40); ix += ctx.measureText(meta).width;
      if (reading) {
        const def = reading.defs && reading.defs[0] && reading.defs[0].d;
        const ex = reading.ex ? `例：${reading.ex.split('、')[0]}` : '';
        const maxDef = W - padR - ix - (ex ? 40 + 33 : 0) - 10;
        if (def) { ctx.fillStyle = ink; ctx.font = F(33); ctx.fillText(truncPx(ctx, def, maxDef), ix, y + 40); ix += ctx.measureText(def).width + 12; }
        if (ex) { ctx.fillStyle = accent; ctx.font = F(33); ctx.fillText(ex, ix, y + 40); }
      }
      y += 44 + px(0.6);
    }
  }
}

let sheetPdfBusy = false;
async function sheetPdf() {
  if (sheetPdfBusy) return;
  const courses = sheetCourses();
  if (!courses.length) { alert('（此課沒有生字）'); return; }
  sheetPdfBusy = true;
  const btn = $('btnSheetPrint');
  btn.disabled = true; btn.textContent = '⏳ 產生中…';
  try {
    const opts = sheetOpts();
    // 字型先載入再繪（canvas 用已載入字型；PDF 內 jsPDF 再嵌入子集）
    try {
      await Promise.all([
        document.fonts.load('700 57px "TW-Kai"'), document.fonts.load('400 33px "TW-Kai"'),
        document.fonts.load('700 42px "BpmfGenSenRounded"'),
      ]);
    } catch {}
    // 筆順資料（缺字先補抓）
    const names = [];
    for (const c of courses) for (const ch of c.chars) names.push(ch.name);
    await loadHanziData();
    const miss = names.filter((n) => !(window.HANZI_DATA && window.HANZI_DATA[n]));
    if (opts.stroke && miss.length) await Promise.all(miss.map((n) => new Promise((res) =>
      charDataLoader(n, res, res))));
    // 每字一頁內註解資料
    const readings = {};
    for (const c of courses) for (const ch of c.chars) {
      const d = DICT[ch.name];
      readings[ch.name] = bookZyHit(d, ch.zhuYin) || (d && d.readings && d.readings[0]);
    }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const cv = document.createElement('canvas');
    cv.width = 1191; cv.height = 1684;
    let pg = 0, first = true;
    const tick = () => new Promise((r) => setTimeout(r, 0));
    for (const c of courses) {
      const rows = c.chars.slice();
      for (let i = 0; i < rows.length; i += SHEET_PAGE_CHARS) {
        pg++;
        drawSheetPage(cv, { title: c.title, pg, chars: rows.slice(i, i + SHEET_PAGE_CHARS), opts, readings });
        if (!first) pdf.addPage();
        first = false;
        pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
        btn.textContent = `⏳ ${pg} 頁…`;
        await tick(); // 每頁讓出主線程,長學期不凍結畫面
      }
    }
    const semName = { '1': '上', '2': '下' }[state.semester] || '';
    const fname = `習字本_${VERSION_LABELS[state.version] || state.version}_${state.grade}年${semName}${pg}頁.pdf`;
    pdf.save(fname);
    btn.textContent = '✅ 已下載';
  } catch (err) {
    console.error('PDF 產生失敗', err);
    alert('PDF 產生失敗：' + err.message);
    btn.textContent = '⬇ 下載 PDF';
  } finally {
    sheetPdfBusy = false;
    btn.disabled = false;
    setTimeout(() => { if (!sheetPdfBusy) btn.textContent = '⬇ 下載 PDF'; }, 1500);
  }
}



/* ── 事件綁定 ── */
function bind() {
  selVersion.addEventListener('change', onFilterChange);
  selGrade.addEventListener('change', onFilterChange);
  selSemester.addEventListener('change', onFilterChange);
  selClass.addEventListener('change', () => {
    if (!selClass.value) return;
    state.course = selClass.value;
    renderGrid();
    setupSave();
    if (!$('setup').hidden) renderSetupSteps();
  });

  // 詳細視窗開關
  $('btnClose').addEventListener('click', closeDetail);
  detail.addEventListener('click', (e) => { if (e.target === detail) closeDetail(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!$('sheet').hidden) closeSheet(); else if (!detail.hidden) closeDetail(); return; }
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

  // 進入引導（大圖卡選課，點課卡即練）
  $('setupSteps').addEventListener('click', (e) => {
    const card = e.target.closest('.setup-card');
    if (!card) return;
    const k = card.dataset.k, v = card.dataset.v;
    if (k === 'v') applySel(v, null, null, null, false);
    else if (k === 'g') applySel(null, v, null, null, false);
    else if (k === 's') applySel(null, null, v, null, false);
    else applySel(null, null, null, v, true); // 課次：點一下即開始練習
  });
  $('btnStart').addEventListener('click', () => applySel(null, null, null, null, true));
  $('btnChoose').addEventListener('click', showSetup);
  $('btnSetup').addEventListener('click', showSetup);

  // 習字本／學習手冊
  $('btnSheet').addEventListener('click', openSheet);
  $('btnSheetClose').addEventListener('click', closeSheet);
  $('btnSheetPrint').addEventListener('click', () => sheetPdf());
  for (const id of ['sheetGrade', 'sheetStroke', 'sheetPinyin', 'sheetDict', 'sheetTrace']) {
    $(id).addEventListener('change', renderSheet);
  }

  // 字號（整介面等比放大，自動記憶）
  fsCtl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-fs]');
    if (!b) return;
    setFs(Number(b.dataset.fs));
  });
}

/* ── 介面用字加注音（bpmf.js）：只在「學習內容」區域加注音（課次說明、國語辭典）。
   標題／篩選器／按鈕等 UI 標籤不加：注音在狹窄標籤會折行、蓋住文字；
   生字讀音已顯示在字卡、寫字畫面與習字本，UI 標籤不必重複。 */
function annotateUI() {
  const h1 = document.querySelector('.topbar h1');
  if (h1) h1.textContent = '✍️ 手寫練習';
  const sum = document.querySelector('.detail-dict > summary');
  if (sum) sum.innerHTML = bpmf('📖 教育部《國語辭典》');
}

/* ── 進入引導：大圖卡選 版本→年級→學期→課次，點課卡即練 ── */
const sel = { version: null, grade: null, semester: null, course: null }; // topbar selects 為單一來源
function refreshSel() {
  sel.version = selVersion.value || null;
  sel.grade = selGrade.value || null;
  sel.semester = selSemester.value || null;
  sel.course = selClass.value || null;
}
function setupLast() {
  try { return JSON.parse(localStorage.getItem('hw_last_course') || 'null'); } catch { return null; }
}
function setupSave() {
  refreshSel();
  const v = VERSION_LABELS[state.version] || state.version || '';
  const g = ['', '一', '二', '三', '四', '五', '六'][state.grade] || state.grade || '';
  localStorage.setItem('hw_last_course', JSON.stringify({
    v, gk: state.grade, g, s: state.semester, c: state.course,
    text: `${v}・${g}年級・${state.semester === '1' ? '上' : '下'}學期・${state.course === '0' ? '特殊單元' : `第 ${state.course} 課`}`,
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
    h += `<div class="setup-step"><div class="setup-step-label">${bpmf(label)}</div><div class="setup-cards">`;
    for (const c of cards) {
      h += `<button type="button" class="setup-card${c.v === current ? ' on' : ''}" data-k="${kind}" data-v="${c.v}">${c.html}</button>`;
    }
    h += '</div></div>';
  };
  step('版本', Object.keys(DATA).map((v) => ({ v, html: bpmf((VERSION_LABELS[v] || v) + ' 版') })), sel.version, 'v');
  const ver = DATA[sel.version];
  const grades = sel.version && ver ? Object.keys(ver).sort((a, b) => a - b) : ['1'];
  step('年級', grades.map((g) => ({ v: g, html: bpmf(`${['', '一', '二', '三', '四', '五', '六'][g] || g} 年級`) })), sel.grade, 'g');
  const sems = semNames(ver, sel.grade);
  if (sems.length > 1) step('學期', sems.map((s) => ({ v: s, html: bpmf(`${s === '1' ? '上' : '下'}學期`) })), sel.semester, 's');
  const cls = ver?.[sel.grade]?.[sel.semester] || {};
  if (cls['0']) h += `<div class="setup-step"><div class="setup-step-label">${bpmf('課次')}</div><div class="setup-cards"><button type="button" class="setup-card${sel.course === '0' ? ' on' : ''}" data-k="0" data-v="0">${bpmf('特殊單元')}</button></div></div>`;
  const nums = Object.keys(cls).filter((k) => k !== '0').map(Number).sort((a, b) => a - b);
  if (nums.length) {
    h += `<div class="setup-step"><div class="setup-step-label">${bpmf('課次（點一下即開始練習）')}</div><div class="setup-cards setup-cards-course">`;
    for (const i of nums) h += `<button type="button" class="setup-card setup-card-course${sel.course === String(i) ? ' on' : ''}" data-k="${i}" data-v="${i}">${bpmf(`第 ${i} 課`)}</button>`;
    h += '</div></div>';
  }
  stepsBox.innerHTML = h;
  const v = VERSION_LABELS[sel.version] || sel.version || '';
  const g = ['', '一', '二', '三', '四', '五', '六'][sel.grade] || sel.grade || '';
  const courseTxt = sel.course === '0' ? '特殊單元' : `第 ${sel.course} 課`;
  summary.innerHTML = bpmf(`${v}・${g}年級・${sel.semester === '1' ? '上' : '下'}學期・${courseTxt}`);
}
function validCourse(ver, grade, sem) {
  const cls = ver?.[grade]?.[sem] || {};
  return cls[state.course] ? state.course : cls['0'] ? '0' : '1';
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
  if (startPractice) $('setup').hidden = true;
}
function showSetup() { renderSetupSteps(); $('setup').hidden = false; }
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

/* ── 字號（整介面等比放大）：root font-size 由 --fs 驅動，特大22(基準)/超大29，自動記憶 ── */
const FS_LEVELS = [22, 29];
function setFs(px) {
  if (!FS_LEVELS.includes(px)) return;
  state.fs = px;
  document.documentElement.style.setProperty('--fs', px + 'px');
  localStorage.setItem('hw_fs', String(px));
  for (const b of fsCtl.querySelectorAll('button[data-fs]')) {
    b.classList.toggle('on', Number(b.dataset.fs) === px);
  }
}
function loadFs() {
  const saved = Number(localStorage.getItem('hw_fs'));
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

/* ── 手寫練習 ─────────────────────────────────────────────
 * 資料來源：
 *   115上114下學期生字表 xlsx（南一／康軒／翰林）→ data.js
 *   教育部《國語辭典》2014 版匯出 → dict.js（逐讀音 注音/釋義/例詞/部首/IDS，含字詞號）
 *   唸字功能已移除（內嵌瀏覽器無 TTS）；注音改為版面顯示
 *   HanziWriter（筆順動畫＋逐筆練習）
 *   習字本 PDF：靜態預產（scripts/build-pdfs.mjs + scripts/pdf-renderer.js）
 *   存放於 downloads/worksheets/；網頁「⬇ 習字本」可依選課下載
 *   （App 內 Vuplex 存公開下載資料夾、一般瀏覽器直接下載）。
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
 * downloads/worksheets/；僅保留建置所需資料與函式，不提供網頁預覽。
 * 網頁下載路徑與本函式同一來源（見下方「習字本下載」），版本參數
 * ?v= 取 index.html 的 app-version（與 PDF下載連結.csv 同慣例）。 */
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
  fs: 22, // 介面字號：22 正常(基準)／26.4 特大(1.2倍)（root font-size 驅動整體放大）
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
  if (courseKey() !== prevKey) setDlStatus(''); // 選課已變，舊結果不再代表本課
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
/* ── 字典翻頁（宿主兜底）──
 * 宿主 Unity Webview 只送 mouse drag（無 native touch 序列）時，
 * overflow-y:auto 容器不會被 mouse drag 捲動；真 touch 裝置原生捲動正常。
 * 這裡提供兩層兜底、皆只作用 .dict-body：
 *  1. ▲/▼ 按鈕：固定步長翻頁，任何輸入模式皆可按；
 *  2. pointer drag：pointerType=mouse 在 .dict-body 上拖曳 → scrollTop，
 *     touch pointer 不攔截（維持原生捲動），畫布 touch-action:none 不經此路徑。 */
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

  let pointer = null, startY = 0, startScroll = 0;
  dictBody.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    pointer = e.pointerId;
    startY = e.clientY;
    startScroll = dictBody.scrollTop;
    dictBody.setPointerCapture(pointer);
  });
  dictBody.addEventListener('pointermove', (e) => {
    if (pointer !== e.pointerId || Math.abs(e.clientY - startY) < 4) return;
    dictBody.scrollTop = startScroll - (e.clientY - startY);
  });
  const stopDrag = () => { pointer = null; };
  dictBody.addEventListener('pointerup', stopDrag);
  dictBody.addEventListener('pointercancel', stopDrag);
  dictBody.addEventListener('lostpointercapture', stopDrag);
  window.addEventListener('blur', stopDrag);
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



/* ── 習字本下載（靜態 PDF）──────────────────────────
 * 路徑＝worksheetPath() 單一來源；?v= 版本參數取 index.html 的
 * app-version（與 PDF下載連結.csv 同慣例，供快取失效與 App 端校驗）。
 * App 內（Vuplex）：送 JSON 字串 {type:'worksheet',action:'download',
 *   requestId,url,fileName}，App 存進公開「下載」資料夾後經
 *   window.hwWorksheetAck({requestId,ok,error}) 回傳；UI 依 requestId
 * 對應本筆請求。規則（不假稱成功、不靜默無動作）：
 *   - ok 必須 === true（嚴格的 boolean 比較，字串 "false" 不算成功）。
 *   - 15 秒內沒 ack ≠ 失敗：App 可能仍在存檔，結果未知。顯示「狀態
 *     未知」，按鈕保持鎖定（避免重送造成重複下載）；晚到的 ack 仍會
 *     更新狀態，或重新載入頁面恢復（選課與練習紀錄保留）。
 *   - 沒有任何「逾時＝失敗」的斷言：沒有 ACK 就無法知道結果。
 * App 判定（window.vuplex 可能晚於頁面載入注入）：
 *   點按時先看 UA 是否像內嵌 WebView（UA 含 "vuplex" 標記即算——
 *   App 端可用 SetUserAgent 追加；否則依 Android "wv)"／iOS WKWebView
 *   簽名）；像則短輪詢等 vuplex 最長 2 秒，出現即走 App 路徑，未出現
 *   則報「App 未就緒」——絕不回落瀏覽器跳轉（避免把 App 內頁面偷偷導走）。
 * 一般瀏覽器：a[download] 真 PDF 下載，target=_blank＋rel=noopener
 *   開新分頁，本頁不導走；不送訊息、不假設有 App；狀態只說「已開始下載」。
 * 狀態列一律純文字（不加注音、不寫 HTML——介面標籤無注音慣例，
 * 且窄頂欄內注音疊字會與下方元素重疊）；同步顯示於頂欄與選課畫面。 */
const WORKSHEET_ACK_WAIT_MS = 15000;   // 逾時＝狀態未知（非失敗），晚到 ack 仍有效
const VUPLEX_INJECT_WAIT_MS = 2000;    // vuplex 注入延遲的短輪詢上限
const WORKSHEET_SITE = 'https://aifunschoolproject.github.io/handwriting/';
let worksheetDl = null; // {id,label,settled,timer}
const dlStatusEls = [$('dlStatus'), $('dlStatusSetup')];
const dlBtns = [$('btnDlCourse'), $('btnDlSemester'), $('btnDlCourseSetup'), $('btnDlSemesterSetup')];

function worksheetVersionTag() {
  return document.querySelector('meta[name="app-version"]')?.content || '';
}
function worksheetDownloadUrl(selection, wholeSemester) {
  const u = new URL(worksheetPath(selection, wholeSemester), WORKSHEET_SITE);
  const v = worksheetVersionTag();
  if (v) u.searchParams.set('v', v);
  return u.toString();
}
function worksheetDownloadName(selection, wholeSemester) {
  const v = SHEET_SLUG[selection?.version];
  if (!v) throw new Error(`worksheetDownloadName: 未知版本 ${selection?.version}`);
  const file = wholeSemester ? 'semester' : `course-${String(selection?.course ?? '')}`;
  return `${v}-g${selection.grade}-s${selection.semester}-${file}.pdf`;
}
function worksheetLabel(selection, wholeSemester) {
  const v = VERSION_LABELS[selection.version] || selection.version || '';
  const g = ['', '一', '二', '三', '四', '五', '六'][selection.grade] || selection.grade || '';
  const s = selection.semester === '1' ? '上' : '下';
  const c = wholeSemester ? '整學期'
    : (selection.course === '0' ? '特殊單元' : `第 ${selection.course} 課`);
  return `${v}版・${g}年級・${s}學期・${c}`;
}
function setDlStatus(kind, text) {
  // kind: ''（空）/ pending / unknown / ok / err；純文字、無注音（aria-live 由元素承擔）
  const cls = 'worksheet-dl-status' + (kind ? ` ${kind}` : '');
  for (const el of dlStatusEls) {
    el.className = cls;
    el.textContent = text || '';
  }
}
function setDlButtons(enabled) {
  for (const b of dlBtns) b.disabled = !enabled;
}
// 像內嵌 WebView 嗎？Vuplex 可另以 SetUserAgent 追加自訂標記（UA 含 "vuplex" 即算）；
// 否則依平台簽名：Android 系統 WebView（UA 含 "wv)"）／iOS WKWebView
//（有 AppleWebKit 版號＋Mobile、無 Safari 的 Version/ 段）。
function looksEmbeddedWebView() {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (/vuplex|wv\)/.test(ua)) return true;
  if (ua.includes('applewebkit/') && ua.includes('mobile') && !ua.includes('version/')) return true;
  return false;
}
function waitForVuplex(ms) {
  if (window.vuplex) return Promise.resolve(true);
  return new Promise((res) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (window.vuplex) { clearInterval(timer); res(true); }
      else if (Date.now() - t0 >= ms) { clearInterval(timer); res(false); }
    }, 100);
  });
}
// App 回傳結果（Vuplex 以 ExecuteJavaScript 呼叫；只認目前這筆請求的 requestId，
// 且可晚於 15 秒逾時到達——逾時只改顯示「狀態未知」，不等於失敗）。
window.hwWorksheetAck = (raw) => {
  let ack = null;
  try { ack = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
  if (!ack || !worksheetDl || ack.requestId !== worksheetDl.id) return;
  const req = worksheetDl;
  req.settled = true;
  worksheetDl = null; // 已確認結果 → 解除單一請求，允許下次下載
  clearTimeout(req.timer);
  setDlButtons(true);
  if (ack.ok === true) setDlStatus('ok', `${req.label} 習字本已存進裝置下載資料夾`);
  else setDlStatus('err', `${req.label} 下載失敗：${ack.error || 'App 未給出原因'}`);
};
async function downloadWorksheet(wholeSemester) {
  if (worksheetDl) return; // 前一筆尚未確認結果（pending／狀態未知）；重新載入可恢復
  const selection = { version: state.version, grade: state.grade, semester: state.semester, course: state.course };
  let url, name;
  try {
    url = worksheetDownloadUrl(selection, wholeSemester);
    name = worksheetDownloadName(selection, wholeSemester);
  } catch (err) {
    setDlStatus('err', `下載失敗：${err.message}`);
    return;
  }
  const label = worksheetLabel(selection, wholeSemester);
  // vuplex 可能晚於頁面注入：僅在 UA 像 WebView 時才等（一般瀏覽器不等、不延遲）
  if (!window.vuplex && looksEmbeddedWebView()) await waitForVuplex(VUPLEX_INJECT_WAIT_MS);
  const vuplex = window.vuplex;
  if (vuplex && typeof vuplex.postMessage === 'function') {
    // App 內：請 App 端存公開「下載」資料夾；結果經 hwWorksheetAck 回傳
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    worksheetDl = { id, label, settled: false, timer: null };
    setDlButtons(false);
    setDlStatus('pending', `${label} 習字本儲存中…（App 存檔，請稍候）`);
    worksheetDl.timer = setTimeout(() => {
      if (worksheetDl?.id !== id || worksheetDl.settled) return;
      // 逾時 ≠ 失敗：App 可能仍在存檔。保持鎖定等晚到 ack；重新載入可恢復。
      setDlStatus('unknown', `${label} 狀態未知：App 可能仍在存檔，若有結果會自動更新，或重新載入頁面`);
    }, WORKSHEET_ACK_WAIT_MS);
    try {
      vuplex.postMessage(JSON.stringify({ type: 'worksheet', action: 'download', requestId: id, url, fileName: name }));
    } catch {
      // 送出失敗＝確定沒送出 → 可再試（不等於「狀態未知」）
      const req = worksheetDl;
      req.settled = true;
      clearTimeout(req.timer);
      worksheetDl = null;
      setDlButtons(true);
      setDlStatus('err', `${label} 下載失敗：無法送出下載請求`);
    }
  } else if (looksEmbeddedWebView()) {
    // 像 App 內但 vuplex 未就緒：報錯，不回落瀏覽器跳轉（避免靜默導走 App 頁面）
    setDlStatus('err', `${label} 無法由 App 存檔：App 未就緒，請重新開啟 App 再試`);
  } else {
    // 一般瀏覽器：真實 PDF 下載；新分頁開啟，本頁留在原處
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setDlStatus('ok', `${label} 已開始下載（新分頁開啟 PDF），請在瀏覽器下載或另存`);
  }
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
  bindDictScroll(); // 字典 ▲/▼ 翻頁＋mouse-drag 兜底（見 renderDict 後說明）
  document.addEventListener('keydown', (e) => {
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

  // 字號（整介面等比放大，自動記憶）
  fsCtl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-fs]');
    if (!b) return;
    setFs(Number(b.dataset.fs));
  });

  // 習字本下載（依目前選課；頂欄與選課畫面兩組控制項，App 內走 Vuplex 存公開下載資料夾）
  for (const b of dlBtns) {
    b.addEventListener('click', () => downloadWorksheet(b.id.includes('Semester')));
  }
}

/* ── 介面用字加注音（bpmf.js）：只在「學習內容」區域加注音（課次說明、國語辭典）。
   標題／篩選器／按鈕等 UI 標籤不加：注音在狹窄標籤會折行、蓋住文字；
   生字讀音已顯示在字卡與寫字畫面，UI 標籤不必重複。 */
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
      h += `<button type="button" class="setup-card${c.v === current ? ' on' : ''}" data-k="${kind}" data-v="${c.v}" aria-pressed="${c.v === current}">${c.html}</button>`;
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
  if (cls['0']) h += `<div class="setup-step"><div class="setup-step-label">${bpmf('課次')}</div><div class="setup-cards"><button type="button" class="setup-card${sel.course === '0' ? ' on' : ''}" data-k="0" data-v="0" aria-pressed="${sel.course === '0'}">${bpmf('特殊單元')}</button></div></div>`;
  const nums = Object.keys(cls).filter((k) => k !== '0').map(Number).sort((a, b) => a - b);
  if (nums.length) {
    h += `<div class="setup-step"><div class="setup-step-label">${bpmf('課次（點一下即開始練習）')}</div><div class="setup-cards setup-cards-course">`;
    for (const i of nums) h += `<button type="button" class="setup-card setup-card-course${sel.course === String(i) ? ' on' : ''}" data-k="${i}" data-v="${i}" aria-pressed="${sel.course === String(i)}">${bpmf(`第 ${i} 課`)}</button>`;
    h += '</div></div>';
  }
  stepsBox.innerHTML = h;
  const v = VERSION_LABELS[sel.version] || sel.version || '';
  const g = ['', '一', '二', '三', '四', '五', '六'][sel.grade] || sel.grade || '';
  const courseTxt = sel.course === '0' ? '特殊單元' : `第 ${sel.course} 課`;
  summary.innerHTML = bpmf(`${v}・${g}年級・${sel.semester === '1' ? '上' : '下'}學期・${courseTxt}`);
}
function applySel(version, grade, semester, course, startPractice) {
  const prevKey = courseKey();
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
  if (courseKey() !== prevKey) setDlStatus(''); // 選課已變，舊結果不再代表本課
  if (startPractice) {
    $('setup').hidden = true;
    document.querySelector('main').scrollTop = 0;
    grid.querySelector('.char-card')?.focus({ preventScroll: true });
  }
}
function showSetup() {
  if (!detail.hidden) closeDetail(); // 選課前先關字卡，避免選課後還留著舊字
  renderSetupSteps();
  $('setup').hidden = false;
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

/* ── 字號（整介面等比放大）：root font-size 由 --fs 驅動，正常22(基準)/特大26.4(1.2倍)，自動記憶 ── */
const FS_LEVELS = [22, 26.4];
function setFs(px) {
  if (!FS_LEVELS.includes(px)) return;
  state.fs = px;
  document.documentElement.style.setProperty('--fs', px + 'px');
  store.set('hw_fs', String(px));
  for (const b of fsCtl.querySelectorAll('button[data-fs]')) {
    b.classList.toggle('on', Number(b.dataset.fs) === px);
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

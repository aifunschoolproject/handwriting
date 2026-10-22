/* ── 手寫練習 ─────────────────────────────────────────────
 * 資料來源：
 *   115上114下學期生字表 xlsx（南一／康軒／翰林）→ data.js
 *   教育部《國語辭典》2014 版匯出 → dict.js（逐讀音 注音/釋義/例詞/部首/IDS，含字詞號）
 *   唸字功能已移除（內嵌瀏覽器無 TTS）；注音改為版面顯示
 *   HanziWriter（筆順動畫＋逐筆練習）
 *   習字本 PDF：靜態預產（scripts/build-pdfs.mjs + scripts/pdf-renderer.js）
 *   存放於 downloads/worksheets/，app 端只預覽版面＋以 <a> 連結下載。
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
 * downloads/worksheets/；app 端預覽同一版面、以 <a> 連結下載。 */
// 固定版面選項（build 與 app 共用；公開頁面已無選項開關）。
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

// SVG 預覽與 PDF 共用 1000×1000 格內座標，聲調在右、輕聲在上。
function sheetRubyMarks(reading) {
  const { bopo, tone, light } = bpmfParts(reading);
  const symbols = [...bopo];
  const top = 500 - (symbols.length - 1) * 150 / 2;
  const marks = symbols.map((text, i) => ({ text, x: 800, y: top + i * 150 }));
  if (tone) marks.push({ text: tone, x: 925, y: 500 });
  if (light) marks.push({ text: light, x: 800, y: top - 140 });
  return marks;
}

// 一格：cls='cell-ref' 黑字／'cell-stroke' 紅筆順／'cell-trace' 淡灰描紅／'cell-blank' 空格。
// 範字／描紅用 SVG 文字（viewBox 0 0 1000 1000），隨格子等比縮放，
// 手機小格與 A4 大格字體比例一致，不會溢出格子。
function sheetCell(name, cls, reading = '') {
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
    t.setAttribute('x', reading ? '410' : '500');
    t.setAttribute('y', '500');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.classList.add('cell-glyph');
    if (reading) t.style.fontSize = '580px';
    t.textContent = name;
    svg.appendChild(t);
    for (const mark of sheetRubyMarks(reading)) {
      const ruby = document.createElementNS(SHEET_NS, 'text');
      ruby.setAttribute('x', mark.x);
      ruby.setAttribute('y', mark.y);
      ruby.setAttribute('text-anchor', 'middle');
      ruby.setAttribute('dominant-baseline', 'central');
      ruby.setAttribute('font-family', 'Bpmf');
      ruby.setAttribute('font-size', '155');
      ruby.setAttribute('fill', '#4263eb');
      ruby.textContent = mark.text;
      svg.appendChild(ruby);
    }
    cell.appendChild(svg);
  }
  return cell;
}

function sheetRow(ch) {
  const opts = SHEET_OPTIONS;
  const row = document.createElement('div');
  row.className = 'ch-row';
  // 六格全寬（與 A4 同比例，不縮小）
  const cells = document.createElement('div');
  cells.className = 'ch-cells';
  cells.append(sheetCell(ch.name, 'cell-ref', opts.pinyin ? ch.zhuYin : ''));
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

function sheetCourses(selection = state, wholeSemester) {
  // 「整學期」＝同年級同學期全部課次（含特殊單元 0）；否則目前課。
  // selection／wholeSemester 皆為可選（build 端以明確選課呼叫）；
  // 不傳時＝頂欄目前選課＋「整學期」核取方塊。
  const selSel = wholeSemester !== undefined ? wholeSemester : $('sheetGrade').checked;
  const sem = DATA[selection.version]?.[selection.grade]?.[selection.semester];
  if (!sem) return [];
  const nums = Object.keys(sem).map(Number).sort((a, b) => a - b);
  const sel = selSel ? nums : [Number(selection.course)];
  const semName = { '1': '上學期', '2': '下學期' }[selection.semester] || '';
  return sel.filter((n) => sem[n]).map((n) => ({
    title: (n === 0 ? '特殊單元' : `第 ${n} 課`) +
      `　${VERSION_LABELS[selection.version] || selection.version}版・${['', '一', '二', '三', '四', '五', '六'][selection.grade] || selection.grade}年級・${semName}`,
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
  refreshSheetDownload();
  loadHanziData().then(() => { if (tok === sheetToken) { renderSheet(); } });
}
function closeSheet() {
  sheetToken++;
  $('sheet').hidden = true;
  document.body.style.overflow = '';
}
// 固定 PDF 保留 HTTPS 下載；Vuplex 使用 afs-aps2 已註冊的 SaveMessageRouter，
// {type:'save', name, b64} → DownloadsStore（公開 Download/）→ hwSaveAck({ok})。
// 回覆沒有 request id：同時只允許一筆；逾時仍保留待確認狀態，避免晚到回覆認錯檔案。
const sheetDl = $('sheetDownload');
let sheetSaveRequest = null;
function sheetSaveStatus(text) {
  const status = $('sheetSaveStatus');
  status.hidden = false;
  status.textContent = text;
}

window.hwSaveAck = (result) => {
  const request = sheetSaveRequest;
  if (!request?.waiting || typeof result?.ok !== 'boolean') return;
  clearTimeout(request.timer);
  sheetSaveRequest = null;
  refreshSheetDownload();
  sheetSaveStatus(result.ok
    ? `App 已回報儲存成功：${request.name}。請開啟平板「我的檔案／檔案」→「下載（Download）」查看。`
    : `App 回報儲存失敗：${request.name}。請確認平板儲存空間後再試；本次未確認存檔成功。`);
};

async function saveSheetPdf(event) {
  if (sheetSaveRequest || !sheetDl.hasAttribute('href')) {
    event.preventDefault();
    return;
  }
  if (typeof window.vuplex?.postMessage !== 'function') {
    sheetSaveStatus('已交由目前瀏覽器處理下載。網頁無法確認儲存結果與位置；請查看瀏覽器的下載清單。');
    return;
  }
  event.preventDefault(); // 不導向 PDF、不跳出 App；檔案交給現有原生儲存介面。
  const request = { name: sheetDl.download, waiting: false, timer: null };
  const url = sheetDl.href;
  sheetSaveRequest = request;
  refreshSheetDownload();
  sheetSaveStatus(`正在取得 ${request.name}，請稍候…`);
  const controller = new AbortController();
  const fetchTimer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`PDF 連線失敗（HTTP ${response.status}）`);
    const pdf = await response.blob();
    if (await pdf.slice(0, 5).text() !== '%PDF-') throw new Error('伺服器未回傳有效的 PDF');
    const b64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
      reader.onerror = () => reject(new Error('無法讀取 PDF 內容'));
      reader.readAsDataURL(pdf);
    });
    request.waiting = true;
    sheetSaveStatus(`正在請 App 儲存 ${request.name}，等待儲存結果…`);
    request.timer = setTimeout(() => {
      sheetSaveStatus(`App 尚未回報 ${request.name} 的儲存結果。請先到平板「檔案」→「下載」查看；為避免重複送出，收到回報前暫停再次儲存。`);
    }, 30000);
    window.vuplex.postMessage(JSON.stringify({ type: 'save', name: request.name, b64 }));
  } catch (error) {
    clearTimeout(request.timer);
    sheetSaveRequest = null;
    refreshSheetDownload();
    sheetSaveStatus(`尚未完成儲存：${error.name === 'AbortError' ? '取得 PDF 逾時，請確認網路後再試' : error.message}。`);
  } finally {
    clearTimeout(fetchTimer);
  }
}
function refreshSheetDownload() {
  const total = sheetCourses().reduce((n, c) => n + c.chars.length, 0);
  if (!total) {
    sheetDl.removeAttribute('href');
    sheetDl.removeAttribute('download');
    sheetDl.textContent = '此課沒有生字';
    sheetDl.setAttribute('aria-disabled', 'true');
    return;
  }
  const whole = $('sheetGrade').checked;
  const ver = VERSION_LABELS[state.version] || state.version;
  const semName = state.semester === '1' ? '上學期' : '下學期';
  const scope = whole ? '整學期' : (state.course === '0' ? '特殊單元' : `第${state.course}課`);
  const url = new URL(worksheetPath(state, whole), document.baseURI);
  url.searchParams.set('v', document.querySelector('meta[name="app-version"]').content);
  sheetDl.href = url.href;
  sheetDl.download = `習字本_${ver}_${state.grade}年${semName}_${scope}.pdf`;
  sheetDl.textContent = sheetSaveRequest ? '等待儲存結果…' : (whole ? '下載整學期 PDF' : '下載本課 PDF');
  if (sheetSaveRequest) sheetDl.setAttribute('aria-disabled', 'true');
  else sheetDl.removeAttribute('aria-disabled');
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
      if (!$('sheet').hidden) closeSheet();
      else if (dictBox.open) dictBox.open = false;
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

  // 習字本／學習手冊（固定版面；只有「整學期」可選，下載為預產 PDF）
  $('btnSheet').addEventListener('click', openSheet);
  $('btnSheetClose').addEventListener('click', closeSheet);
  $('sheetGrade').addEventListener('change', () => { renderSheet(); refreshSheetDownload(); });
  sheetDl.addEventListener('click', saveSheetPdf);
  // 頂欄篩選（版本/年級/學期/課次）變化時，若習字本開著要同步預覽與下載連結
  for (const el of [selVersion, selGrade, selSemester, selClass]) {
    el.addEventListener('change', () => { if (!$('sheet').hidden) { renderSheet(); refreshSheetDownload(); } });
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
    document.querySelector('main').scrollTop = 0;
    grid.querySelector('.char-card')?.focus({ preventScroll: true });
  }
}
function showSetup() {
  if (!detail.hidden) closeDetail(); // 選課前先關字卡，避免選課後還留著舊字
  if (!sheet.hidden) closeSheet(); // 選課引導不可被舊習字本遮住，也不保留舊課下載連結。
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

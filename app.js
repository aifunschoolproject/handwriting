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
 * 筆順資料：本機 hanzi-data.js（全課 2993 字，含教育部筆順網補 20 字、彎筆中線
 * 沿中心線重算，離線可用）；缺字時回落 jsdelivr 線上資料；兩者皆無 → 靜態大字模式。 */
let hanziDataReady = null; // Promise
function loadHanziData() {
  if (window.HANZI_DATA) return Promise.resolve(true);
  if (hanziDataReady) return hanziDataReady;
  let settled = false;
  hanziDataReady = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'hanzi-data.js?v=3';
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
  const opts = sheetOpts();
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
// 最近一次生成的 PDF（b64＝base64 字串、fname＝檔名）
let sheetLastPdf = null;
let pdfBlobUrl = null; // PDF 預覽用的 blob URL（開 viewer 時建立、關時釋放）
function openSheet() {
  const tok = ++sheetToken;
  $('sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  // 筆順 SVG 需要 hanzi-data（延遲載入）；先顯示格子，資料落地再補筆順
  renderSheet();
  loadHanziData().then(() => { if (tok === sheetToken) renderSheet(); });
  $('btnSheetOpen').hidden = !sheetLastPdf;
}
function closeSheet() {
  sheetToken++;
  closePdfViewer();
  sheetLastPdf = null;
  $('sheet').hidden = true;
  document.body.style.overflow = '';
}
const isIOSBrowser = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1); // iPadOS 13+ 偽裝 Mac
const isAndroidWebView = () => Boolean(window.vuplex) ||
  (/Android/i.test(navigator.userAgent) && /;\s*wv\b|Version\/4\.0/i.test(navigator.userAgent));
const b64ToPdfBlob = (b64) => {
  const bin = atob(b64), len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
};
// App 僅走原生橋接；一般瀏覽器才使用 blob 下載，兩者不得互相降級。
const canRenderPdfIframe = () => isIOSBrowser() && !isAndroidWebView();
function showPdfViewer(b64, fname) {
  resetPdfSave();
  if (pdfBlobUrl) { URL.revokeObjectURL(pdfBlobUrl); pdfBlobUrl = null; }
  pdfBlobUrl = URL.createObjectURL(b64ToPdfBlob(b64));
  const frame = $('pdfViewFrame');
  const renderable = canRenderPdfIframe();
  frame.classList.toggle('pdf-frame-hidden', !renderable);
  $('pdfViewFrame').parentElement.classList.toggle('pdf-frame-empty', !renderable);
  if (renderable) frame.src = pdfBlobUrl;
  const MB = (b64.length * 3 / 4 / 1048576).toFixed(1);
  $('pdfViewName').textContent = fname + `（${MB} MB）`;
  if (isAndroidWebView()) {
    setPdfSaveStatus('點「儲存 PDF」交由目前的容器處理；是否可存檔取決於容器提供的下載功能。', '');
  } else if (isIOSBrowser()) {
    setPdfSaveStatus('可點「儲存 PDF」下載，或從 PDF 預覽的分享選單選擇「儲存到檔案」。', '');
  } else {
    setPdfSaveStatus('點「儲存 PDF」開始下載；儲存位置依瀏覽器設定。', '');
  }
  $('btnPdfSave').hidden = false;
  $('btnPdfNewTab').hidden = renderable || isAndroidWebView();
  $('pdfView').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closePdfViewer() {
  resetPdfSave();
  $('pdfView').hidden = true;
  $('pdfViewFrame').src = 'about:blank';
  if (pdfBlobUrl) { URL.revokeObjectURL(pdfBlobUrl); pdfBlobUrl = null; }
  if ($('sheet').hidden) document.body.style.overflow = '';
}
// 沿用既有容器協定：送 { type: 'save', name, b64 }，回覆 { ok: boolean }。
// 不要求容器新增 requestId；原協定無法辨識跨次操作的延遲回覆。
let pdfSaveTimer = null;
let pdfSaveRequest = null;
let pdfBridgeCleanup = null;
function resetPdfSave() {
  clearTimeout(pdfSaveTimer);
  pdfSaveTimer = null;
  pdfSaveRequest = null;
  if (pdfBridgeCleanup) pdfBridgeCleanup();
  $('btnPdfSave').disabled = false;
}
function setPdfSaveStatus(text, kind) { // kind: ''|'ok'|'err'
  const el = $('pdfViewHelp');
  el.textContent = text;
  el.classList.toggle('pdf-help-ok', kind === 'ok');
  el.classList.toggle('pdf-help-err', kind === 'err');
}
function savePdfToDevice() {
  if (!sheetLastPdf || pdfSaveRequest) return;
  const { b64, fname } = sheetLastPdf;
  if (isAndroidWebView()) {
    const request = { sent: false };
    pdfSaveRequest = request;
    $('btnPdfSave').disabled = true;
    setPdfSaveStatus('正在連接 App 儲存功能…', '');
    const send = () => {
      if (pdfSaveRequest !== request || request.sent || typeof window.vuplex?.postMessage !== 'function') return;
      if (pdfBridgeCleanup) pdfBridgeCleanup();
      clearTimeout(pdfSaveTimer);
      setPdfSaveStatus('正在存進「下載」資料夾…', '');
      pdfSaveTimer = setTimeout(() => {
        resetPdfSave();
        setPdfSaveStatus('尚未收到容器的存檔結果，無法確認是否成功。請先檢查「下載」資料夾。', 'err');
      }, 12000);
      try {
        request.sent = true;
        window.vuplex.postMessage(JSON.stringify({ type: 'save', name: fname, b64 }));
      } catch (e) {
        resetPdfSave();
        console.warn('vuplex 交接失敗:', e);
        setPdfSaveStatus('送檔給 App 失敗，請重試。', 'err');
      }
    };
    window.addEventListener('vuplexready', send);
    pdfBridgeCleanup = () => {
      window.removeEventListener('vuplexready', send);
      pdfBridgeCleanup = null;
    };
    pdfSaveTimer = setTimeout(() => {
      resetPdfSave();
      setPdfSaveStatus('目前容器未提供可用的儲存橋接；網頁無法直接寫入裝置資料夾，也不會自動跳出 App。', 'err');
    }, 3000);
    send();
    return;
  }
  // 獨立 URL 不受關閉預覽釋放資源影響；瀏覽器並不回報是否已寫入磁碟。
  const href = URL.createObjectURL(b64ToPdfBlob(b64));
  const link = document.createElement('a');
  try {
    link.href = href;
    link.download = fname;
    document.body.appendChild(link);
    link.click();
    setPdfSaveStatus('已送出下載請求，請查看瀏覽器下載清單。', '');
  } catch (e) {
    setPdfSaveStatus('無法啟動下載，請改用「新分頁開啟」。', 'err');
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  }
}
// 僅在送出存檔後接受明確的布林結果，不能把 { ok: false } 當成成功。
window.hwSaveAck = (result) => {
  if (!pdfSaveRequest?.sent || typeof result?.ok !== 'boolean') return;
  resetPdfSave();
  setPdfSaveStatus(result.ok
    ? '已存到「下載」資料夾'
    : 'App 存檔失敗，請重試並檢查裝置儲存空間。', result.ok ? 'ok' : 'err');
};
// 只有一般瀏覽器可開新分頁；blob 避免大型 data URL 導航遭攔截。
function openPdfNewTab() {
  if (!sheetLastPdf || isAndroidWebView()) return;
  const href = URL.createObjectURL(b64ToPdfBlob(sheetLastPdf.b64));
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60000);
}
// 「開啟/預覽 PDF」鈕:App 內預覽＋儲存指引(任何時候都能重開,不被彈窗攔截)
function sheetOpenLast() {
  if (!sheetLastPdf) return;
  showPdfViewer(sheetLastPdf.b64, sheetLastPdf.fname);
}

/* ── 習字本 PDF：canvas 繪製頁面後以 JPEG 嵌入 jsPDF，字形不依賴閱讀器字型。
 * App 經 SaveMessageRouter 寫入公開下載；瀏覽器使用 blob 下載或預覽。
 * 尺寸：mm → px 固定 8（1mm＝8px），1680×2376px＝A4。 */
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

// 繪一頁習字本到 canvas（g：course 資料＋該頁字元）。
// 版面＝A4 全幅（210×297mm）鏡像 .sheet-page 的內部版面：S＝8px/mm、1680×2376px、
// 內距 7/7/6mm（同 .sheet-page）、pt→mm 用 25.4/72、六格高度受限使 8 列全部入版。
// 六格高度受限（A4 較 190mm 頁高，每列可用高決定格子邊長）、8 列 flex 均分剩餘高；
// 8 列以 flex 均分剩餘高（.ch-row flex:1 0 auto、gap 0.6mm）、每列＝格子＋0.6mm＋.ch-info 行；
// 表頭＝11pt 粗體標題行＋姓名/頁碼 baseline 對齊＋1px dotted＋0.5mm padding-bottom＋1.5px 墨線＋2mm margin。
// 註解（.ch-info）：注音 8pt 藍粗＋「N 筆・部首 X」6.8pt 灰＋釋義 6.6pt＋例詞 6.6pt 橙，
// 整行 nowrap、釋義截斷不溢出、左緣對齊第一格。
function drawSheetPage(cv, g) {
  const ctx = cv.getContext('2d');
  const S = 8;                         // px/mm
  const mm = (v) => v * S;             // mm→px
  const PT = 25.4 / 72;                // mm/pt
  const W = 1680, H = 2376;            // A4 @8px/mm
  const padT = mm(7), padL = mm(7), padB = mm(6), padR = mm(7);
  const cw = W - padL - padR;          // 196mm 內容寬（210−2×7）
  const ink = '#33302c', muted = '#8a8378', blue = '#4263eb', accent = '#e8590c';
  const KA = '"TW-Kai","BiauKai","Kaiti TC",serif';
  const ZY = '"Bpmf","TW-Kai",serif';
  const F = (ptv, w) => `${w || 400} ${mm(ptv * PT)}px ${KA}`;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const opts = g.opts;
  // 表頭：11pt 字（行盒 1.36em）、基線＝頂＋11pt＋約 0.8mm descent、dotted 同基線、
  // 墨線＝行盒底＋0.5mm＋1.5px、rowsTop＝墨線＋2mm
  const titleH = mm(11 * PT) * 1.36;
  const baseY = padT + mm(11 * PT) + mm(0.8);
  const dotY = baseY;
  const ruleY = padT + titleH + mm(0.5) + 1.5;
  const rowsTop = ruleY + mm(2);
  // 六格＝全寬（寬度受限）、註解行高（.ch-info 6.6pt×1.3）
  const cellGap = mm(1.2);
  const cell = (cw - cellGap * 5) / 6;            // 31.67mm
  const infoH = opts.dict ? mm(6.6 * PT) * 1.3 : 0;
  const infoGap = opts.dict ? mm(0.6) : 0;
  const n = g.chars.length;
  const rowH = (H - padB - rowsTop + mm(0.6) * (n - 1)) / n;  // flex 均分
  const cellF = Math.min(cell, rowH - infoH - infoGap);
  const total = cellF * 6 + cellGap * 5;
  const ox = padL + Math.floor((cw - total) / 2);
  // ── 表頭 ──
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = ink; ctx.font = F(11, 700);
  ctx.fillText(g.title, padL, baseY);
  const tw = ctx.measureText(g.title).width;
  const gap = mm(3.5);                         // .sheet-hd gap 0.6rem（root 22px＝13.2px）
  const pgTxt = `第 ${g.pg} 頁`;
  ctx.font = F(6.8);
  const pgW = ctx.measureText(pgTxt).width;
  const pgX = W - padR;
  ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.setLineDash([1, 2]);
  ctx.beginPath();
  ctx.moveTo(padL + tw + gap, dotY); ctx.lineTo(pgX - pgW - gap, dotY);
  ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = muted; ctx.font = F(7.5);
  ctx.fillText('姓名：', padL + tw + gap, baseY);
  ctx.textAlign = 'right';
  ctx.fillText(pgTxt, pgX, baseY);
  ctx.textAlign = 'left';
  ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(padL, ruleY); ctx.lineTo(W - padR, ruleY); ctx.stroke();
  // ── 各列 ──
  let y = rowsTop;
  for (const ch of g.chars) {
    for (let i = 0; i < 6; i++) {
      const cx0 = ox + i * (cellF + cellGap);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx0, y, cellF, cellF);
      // 田字格淡紅十字：範字格＋所有空格；筆順/描紅有內容時不加
      const cross = i === 0 || (i === 1 && !opts.stroke) || (i === 2 && !opts.trace) || i >= 3;
      if (cross) {
        ctx.strokeStyle = '#e8b4b4'; ctx.lineWidth = mm(0.5);
        ctx.beginPath();
        ctx.moveTo(cx0 + cellF / 2, y); ctx.lineTo(cx0 + cellF / 2, y + cellF);
        ctx.moveTo(cx0, y + cellF / 2); ctx.lineTo(cx0 + cellF, y + cellF / 2);
        ctx.stroke();
      }
      ctx.strokeStyle = ink; ctx.lineWidth = mm(0.35);
      ctx.strokeRect(cx0 + mm(0.35) / 2, y + mm(0.35) / 2, cellF - mm(0.35), cellF - mm(0.35));
    }
    // 範字與右側注音位置和 SVG 預覽共用；關閉注音時範字恢復置中。
    const rubyMarks = opts.pinyin ? sheetRubyMarks(ch.zhuYin) : [];
    ctx.fillStyle = ink;
    ctx.font = `400 ${Math.round(cellF * (rubyMarks.length ? 0.58 : 0.64))}px ${KA}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch.name, ox + cellF * (rubyMarks.length ? 0.41 : 0.5), y + cellF / 2);
    if (rubyMarks.length) {
      ctx.save();
      ctx.fillStyle = blue;
      ctx.font = `400 ${cellF * 0.155}px ${ZY}`;
      for (const mark of rubyMarks) ctx.fillText(mark.text, ox + cellF * mark.x / 1000, y + cellF * mark.y / 1000);
      ctx.restore();
    }
    // 筆順（第 2 格：fill 淡紅、無描邊）
    if (opts.stroke) {
      const paths = strokePaths(ch.name);
      if (paths) {
        const cx0 = ox + (cellF + cellGap);
        ctx.save();
        ctx.translate(cx0, y);
        ctx.scale(cellF / 1000, cellF / 1000);
        ctx.fillStyle = 'rgba(212,56,13,.40)';
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        for (const stroke of paths) {
          ctx.beginPath();
          for (const seg of stroke) {
            if (seg[0] === 'M') ctx.moveTo(seg[1], seg[2]);
            else if (seg[0] === 'L') ctx.lineTo(seg[1], seg[2]);
            else if (seg[0] === 'Q') ctx.quadraticCurveTo(seg[1], seg[2], seg[3], seg[4]);
            else ctx.bezierCurveTo(seg[1], seg[2], seg[3], seg[4], seg[5], seg[6]);
          }
          ctx.fill();
        }
        ctx.restore();
      }
    }
    // 描紅（第 3 格：30% 淡字）
    if (opts.trace) {
      const cx0 = ox + 2 * (cellF + cellGap);
      ctx.fillStyle = 'rgba(60,60,60,.30)';
      ctx.font = `400 ${Math.round(cellF * 0.64)}px ${KA}`;
      ctx.fillText(ch.name, cx0 + cellF / 2, y + cellF / 2);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    // 註解（.ch-info：整行 baseline 對齊、左緣＝第一格）
    const iy = y + cellF + infoGap + infoH * 0.7;
    if (opts.dict) {
      const d = DICT[ch.name];
      const reading = g.readings && g.readings[ch.name];
      const radForm = (d && d.radForm) || ch.radical;
      const def = reading && reading.defs && reading.defs[0] && reading.defs[0].d;
      const ex = reading && reading.ex ? `例：${reading.ex.split('、')[0]}` : '';
      let ix = ox;
      const meta = `${(d && d.strokes) || ch.fullStroke} 筆` +
        (radForm ? `・部首 ${radForm}` : '') + (ch.type === '認讀字' ? '・認讀字' : '');
      ctx.font = F(6.6);
      const exW = ex ? ctx.measureText(ex).width + mm(1) : 0;
      const maxDef = W - padR - ix - exW;
      ctx.fillStyle = muted; ctx.font = F(6.8);
      const mt = truncPx(ctx, meta, maxDef);
      ctx.fillText(mt, ix, iy);
      ix += ctx.measureText(mt).width + (def ? mm(1) : 0);
      if (def) {
        ctx.fillStyle = ink; ctx.font = F(6.6);
        const dt = truncPx(ctx, def, maxDef);
        ctx.fillText(dt, ix, iy);
        ix += ctx.measureText(dt).width;
      }
      if (ex) { ctx.fillStyle = accent; ctx.font = F(6.6); ctx.fillText(ex, ix, iy); }
    }
    y += rowH;
  }
}

let sheetPdfBusy = false;
async function sheetPdf() {
  if (sheetPdfBusy) return;
  const courses = sheetCourses().filter((course) => course.chars.length);
  if (!courses.length) { alert('（此課沒有生字）'); return; }
  const token = sheetToken;
  const { version, grade, semester } = state;
  sheetPdfBusy = true;
  const btn = $('btnSheetPrint');
  btn.disabled = true; btn.textContent = '⏳ 產生中…';
  try {
    const opts = sheetOpts();
    // 字型先載入再繪（canvas 內文 96dpi：11pt＝14.7px、範字約 130px）
    try {
      await Promise.all([
        document.fonts.load('700 15px "TW-Kai"'), document.fonts.load('400 130px "TW-Kai"'),
        document.fonts.load('400 9px "TW-Kai"'), document.fonts.load('400 10px "Bpmf"'),
      ]);
    } catch {}
    // 筆順資料（缺字先補抓）
    if (opts.stroke) {
      await loadHanziData();
      if (token !== sheetToken) return;
      const names = new Set(courses.flatMap((course) => course.chars.map((ch) => ch.name)));
      const miss = [...names].filter((name) => !window.HANZI_DATA?.[name]);
      await Promise.all(miss.map((name) => new Promise((resolve) => charDataLoader(name, resolve, resolve))));
    }
    if (token !== sheetToken) return;
    // 每字一頁內註解資料
    const readings = {};
    for (const c of courses) for (const ch of c.chars) {
      const d = DICT[ch.name];
      readings[ch.name] = bookZyHit(d, ch.zhuYin) || (d && d.readings && d.readings[0]);
    }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const cv = document.createElement('canvas');
    cv.width = 1680; cv.height = 2376;
    let pg = 0, first = true;
    const tick = () => new Promise((r) => setTimeout(r, 0));
    for (const c of courses) {
      const rows = c.chars;
      for (let i = 0; i < rows.length; i += SHEET_PAGE_CHARS) {
        if (token !== sheetToken) return;
        pg++;
        drawSheetPage(cv, { title: c.title, pg, chars: rows.slice(i, i + SHEET_PAGE_CHARS), opts, readings });
        if (!first) pdf.addPage();
        first = false;
        pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
        btn.textContent = `⏳ ${pg} 頁…`;
        await tick(); // 每頁讓出主線程,長學期不凍結畫面
      }
    }
    if (token !== sheetToken) return;
    const semName = { '1': '上', '2': '下' }[semester] || '';
    const fname = `習字本_${VERSION_LABELS[version] || version}_${grade}年${semName}${pg}頁.pdf`;
    // 生成 PDF → base64(記下供「開啟/下載」隨時重開)。平板瀏覽器不會自動
    // 提示存檔 → 直接在 App 內展示 PDF＋給出明確的儲存步驟/按鈕。
    const dataUrl = pdf.output('datauristring');
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    sheetLastPdf = { b64, fname };
    $('btnSheetOpen').hidden = false;
    $('btnSheetOpen').textContent = '↗ 開啟/預覽 PDF';
    showPdfViewer(b64, fname);
    btn.textContent = '✅ PDF 已就緒';
  } catch (err) {
    if (token === sheetToken) {
      console.error('PDF 產生失敗', err);
      alert('PDF 產生失敗：' + err.message);
    }
  } finally {
    sheetPdfBusy = false;
    btn.disabled = false;
    btn.textContent = '⬇ 下載 PDF';
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
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!$('pdfView').hidden) closePdfViewer(); else if (!$('sheet').hidden) closeSheet(); else if (!detail.hidden) closeDetail(); return; }
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
  $('btnSheetOpen').addEventListener('click', sheetOpenLast);
  $('btnPdfClose').addEventListener('click', closePdfViewer);
  $('btnPdfSave').addEventListener('click', savePdfToDevice);
  $('btnPdfNewTab').addEventListener('click', openPdfNewTab);
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

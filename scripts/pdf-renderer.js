/* ── 習字本 PDF 產生器（build-only）──────────────────────────────
 * 供 scripts/build-pdfs.mjs 在 Playwright 中注入使用，公開頁面不引用：
 *   載入順序＝app.js → pdf-annotations.js → jspdf.umd.min.js → 本檔。
 * A4 六格習字列搭配 14pt 註解與右側 6pt 注音，依實際內容高度分頁。
 * 註解不截斷、不平均撐開列距；教育部讀音資料由 build-pdf-annotations 產生。
 *
 * buildWorksheetPdf({ version, grade, semester, course }) →
 *   Promise<{ b64, pageCount }>；course＝null 或 'semester'＝整學期
 *   全部課次（含特殊單元 0，等同 app 的 sheetCourses(sel, true)）。
 * 依賴 app 的全域（同 global scope，bare 存取）：
 *   SHEET_OPTIONS / WORKSHEET_ANNOTATIONS /
 *   sheetCourses / sheetRubyMarks / loadHanziData / bpmfParts
 * 以及 window.HANZI_DATA（hanzi-data.js 設定）、window.jspdf（jsPDF UMD）。
 * 失敗一律 throw，不產出假檔。 */
(() => {
  'use strict';

  const KA = '"TW-Kai","BiauKai","Kaiti TC",serif';
  const ZY = '"Bpmf","TW-Kai",serif';

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

  const SCALE = 8;
  const POINT = 25.4 / 72 * SCALE;
  const TEXT_SIZE = 14 * POINT;
  const RUBY_SIZE = 6 * POINT;
  const LINE_HEIGHT = 24 * POINT;
  const WIDTH = 1680, HEIGHT = 2376;
  const PAD = 7 * SCALE, BOTTOM = 6 * SCALE;
  const CONTENT_WIDTH = WIDTH - PAD * 2;
  const CELL_GAP = 1.2 * SCALE;
  const CELL_SIZE = (CONTENT_WIDTH - CELL_GAP * 5) / 6;
  const ROWS_TOP = PAD + 11 * POINT * 1.36 + 0.5 * SCALE + 1.5 + 2 * SCALE;
  const INFO_GAP = 1.2 * SCALE, ROW_GAP = 2 * SCALE;
  const rowCache = new Map();
  const measure = document.createElement('canvas').getContext('2d');
  const recognitionLabel = [
    { text: '，', reading: '' }, { text: '認', reading: 'ㄖㄣˋ' },
    { text: '讀', reading: 'ㄉㄨˊ' }, { text: '字', reading: 'ㄗˋ' },
  ];

  function wrapAnnotation(sections) {
    measure.font = `400 ${TEXT_SIZE}px ${KA}`;
    const lines = [];
    for (const section of sections) {
      let tokens = [], width = 0;
      for (const token of section.tokens) {
        const glyphWidth = measure.measureText(token.text).width;
        const item = { ...token, glyphWidth,
          width: glyphWidth + (token.reading ? RUBY_SIZE * 1.7 : 0) + 2 };
        if (width + item.width > CONTENT_WIDTH && tokens.length) {
          const carry = [];
          // 行首不放句末標點，行尾不留開括號；不以裁切或縮小字體處理。
          if (/^[，。！？；：、）」』》】]$/.test(item.text) ||
              /^[（「『《【]$/.test(tokens[tokens.length - 1].text)) {
            carry.push(tokens.pop());
          }
          if (tokens.length) lines.push({ kind: section.kind, tokens });
          tokens = carry;
          width = carry.reduce((sum, t) => sum + t.width, 0);
        }
        tokens.push(item);
        width += item.width;
      }
      if (tokens.length) lines.push({ kind: section.kind, tokens });
    }
    return lines;
  }

  function layoutRow(ch) {
    const key = `${ch.name}\t${ch.zhuYin}`;
    const cacheKey = `${key}\t${ch.type}`;
    if (rowCache.has(cacheKey)) return rowCache.get(cacheKey);
    const annotation = window.WORKSHEET_ANNOTATIONS?.[key];
    if (!annotation?.reading || !annotation.sections?.length) {
      throw new Error(`缺少經核對的教育部註解資料：${key}`);
    }
    const sections = annotation.sections.map((section) => ({
      kind: section.kind,
      tokens: section.kind === 'meta' && ch.type === '認讀字'
        ? [...section.tokens, ...recognitionLabel] : section.tokens,
    }));
    const lines = SHEET_OPTIONS.dict ? wrapAnnotation(sections) : [];
    const height = CELL_SIZE + (lines.length ? INFO_GAP + lines.length * LINE_HEIGHT : 0);
    if (height > HEIGHT - BOTTOM - ROWS_TOP) {
      throw new Error(`單字註解超過一頁，請檢查教育部來源：${key}`);
    }
    const row = { ch, reading: annotation.reading, lines, height };
    rowCache.set(cacheKey, row);
    return row;
  }

  async function planPages(sel) {
    await ensureFonts();
    const { version, grade, semester, course } = sel || {};
    if (!version || !grade || !semester) throw new Error('缺少 version/grade/semester');
    const whole = course === null || course === undefined || course === 'semester';
    const courses = sheetCourses({ version, grade, semester, course: whole ? '1' : String(course) }, whole);
    const pages = [];
    for (const c of courses) {
      let rows = [], used = 0;
      for (const ch of c.chars) {
        const row = layoutRow(ch);
        const gap = rows.length ? ROW_GAP : 0;
        if (rows.length && used + gap + row.height > HEIGHT - BOTTOM - ROWS_TOP) {
          pages.push({ title: c.title, rows });
          rows = [];
          used = 0;
        }
        used += (rows.length ? ROW_GAP : 0) + row.height;
        rows.push(row);
      }
      if (rows.length) pages.push({ title: c.title, rows });
    }
    if (!pages.length) throw new Error('沒有可繪製的生字');
    return pages;
  }

  window.worksheetPdfPageCount = async (sel) => (await planPages(sel)).length;

  function drawAnnotation(ctx, lines, left, top) {
    ctx.textBaseline = 'middle';
    for (const line of lines) {
      let x = left;
      const y = top + LINE_HEIGHT / 2;
      for (const token of line.tokens) {
        ctx.font = `400 ${TEXT_SIZE}px ${KA}`;
        ctx.fillStyle = line.kind === 'example' ? '#94420b' : '#33302c';
        ctx.textAlign = 'left';
        ctx.fillText(token.text, x, y);
        if (token.reading) {
          const { bopo, tone, light } = bpmfParts(token.reading);
          const symbols = [...bopo];
          const rubyX = x + token.glyphWidth + RUBY_SIZE * 0.55;
          const rubyTop = y - (symbols.length - 1) * RUBY_SIZE / 2;
          ctx.font = `400 ${RUBY_SIZE}px ${ZY}`;
          ctx.fillStyle = '#3155a0';
          ctx.textAlign = 'center';
          symbols.forEach((symbol, i) => ctx.fillText(symbol, rubyX, rubyTop + i * RUBY_SIZE));
          // 教育部《國語注音符號手冊》：四聲在末符右上，輕聲在字音上方。
          if (tone) ctx.fillText(tone, rubyX + RUBY_SIZE * 0.8,
            rubyTop + (symbols.length - 1) * RUBY_SIZE - RUBY_SIZE * 0.5);
          if (light) ctx.fillText(light, rubyX, rubyTop - RUBY_SIZE * 0.85);
        }
        x += token.width;
      }
      top += LINE_HEIGHT;
    }
  }

  // 六格尺寸不因頁面字數改變；註解自動換行，逐列緊接排列。
  function drawSheetPage(cv, g) {
    const ctx = cv.getContext('2d');
    const S = 8;                         // px/mm
    const mm = (v) => v * S;             // mm→px
    const PT = 25.4 / 72;                // mm/pt
    const W = 1680, H = 2376;            // A4 @8px/mm
    const padT = mm(7), padL = mm(7), padR = mm(7);
    const ink = '#33302c', muted = '#8a8378', blue = '#4263eb';
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
    const cellGap = CELL_GAP;
    const cellF = CELL_SIZE;
    const ox = padL;
    // ── 表頭 ──
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillStyle = ink; ctx.font = F(11, 700);
    ctx.fillText(g.title, padL, baseY);
    const tw = ctx.measureText(g.title).width;
    const gap = mm(3.5);                         // 表頭間距
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
    for (const row of g.rows) {
      const ch = row.ch;
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
      // 範字與右側注音使用固定格內座標；關閉注音時範字恢復置中。
      const rubyMarks = opts.pinyin ? sheetRubyMarks(row.reading) : [];
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
      if (opts.dict) drawAnnotation(ctx, row.lines, ox, y + cellF + INFO_GAP);
      y += row.height + ROW_GAP;
    }
  }

  // 字型先載入再繪（canvas 內文 96dpi）；woff2 為固定字型，任一大小載入即
  // 觸發同一個檔案，故各載入一個代表尺寸，再以 check 確認就緒。
  async function ensureFonts() {
    try {
      await Promise.all([
        document.fonts.load('700 16px "TW-Kai"'),
        document.fonts.load('400 16px "TW-Kai"'),
        document.fonts.load('400 170px "TW-Kai"'),
        document.fonts.load('400 40px "Bpmf"'),
      ]);
    } catch (e) {
      throw new Error('載入字型失敗：' + (e && e.message ? e.message : e));
    }
    if (!document.fonts.check('400 16px "TW-Kai"') || !document.fonts.check('400 40px "Bpmf"')) {
      throw new Error('TW-Kai／Bpmf 字型未就緒，PDF 版面會失真，取消產生');
    }
  }

  window.buildWorksheetPdf = async function buildWorksheetPdf(sel) {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF 未注入（先載入 jspdf.umd.min.js）');
    const pages = await planPages(sel);
    const opts = SHEET_OPTIONS;
    if (opts.stroke) {
      const ok = await loadHanziData();
      if (!ok || !window.HANZI_DATA) throw new Error('本機筆順資料載入失敗');
      const names = new Set(pages.flatMap((page) => page.rows.map((row) => row.ch.name)));
      const missing = [...names].filter((name) => !window.HANZI_DATA[name]?.strokes?.length);
      if (missing.length) throw new Error(`筆順資料缺字：${missing.join('、')}`);
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const cv = document.createElement('canvas');
    cv.width = 1680; cv.height = 2376;
    let pg = 0, first = true;
    const tick = () => new Promise((r) => setTimeout(r, 0));
    try {
      for (const page of pages) {
        pg++;
        drawSheetPage(cv, { ...page, pg, opts });
        if (!first) pdf.addPage();
        first = false;
        // 203 dpi、0.82 JPEG：保留大字與注音辨識度，控制整批 Pages 發布容量。
        const image = cv.toDataURL('image/jpeg', 0.82);
        pdf.addImage(image, 'JPEG', 0, 0, 210, 297);
        await tick();
      }
    } finally {
      cv.width = cv.height = 1; // 釋放 canvas 記憶體
    }
    const b64 = pdf.output('datauristring').split(',')[1];
    if (!b64) throw new Error('jsPDF 輸出為空');
    return { b64, pageCount: pg };
  };
})();

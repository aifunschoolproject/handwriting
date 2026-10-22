/* ── 習字本 PDF 產生器（build-only）──────────────────────────────
 * 供 scripts/build-pdfs.mjs 在 Playwright 中注入使用，公開頁面不引用：
 *   載入順序＝app.js（先）→ jspdf.umd.min.js → 本檔（最後）。
 * 固定 A4 版面使用專案字型與 1000×1000 格內筆順／注音座標，
 * 逐頁以 canvas 繪製，再由 jsPDF 組裝；不依賴網頁預覽 DOM 或樣式。
 *
 * buildWorksheetPdf({ version, grade, semester, course }) →
 *   Promise<{ b64, pageCount }>；course＝null 或 'semester'＝整學期
 *   全部課次（含特殊單元 0，等同 app 的 sheetCourses(sel, true)）。
 * 依賴 app 的全域（同 global scope，bare 存取）：
 *   DICT / SHEET_OPTIONS / SHEET_PAGE_CHARS /
 *   sheetCourses / bookZyHit / sheetRubyMarks / loadHanziData
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

  function truncPx(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    let t = text;
    while (t.length && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  }

  // 繪一頁習字本到 canvas（g：course 資料＋該頁字元）。
  // A4 全幅（210×297mm）：S＝8px/mm、1680×2376px，
  // 內距 7/7/6mm、pt→mm 用 25.4/72、六格高度受限使 8 列全部入版。
  // 表頭＝11pt 粗體標題行＋姓名/頁碼 baseline 對齊＋1px dotted＋0.5mm padding-bottom＋1.5px 墨線＋2mm margin。
  // 註解：「N 筆・部首 X」6.8pt 灰＋釋義 6.6pt＋例詞 6.6pt 橙，
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
    // 六格＝全寬（寬度受限）、註解行高 6.6pt×1.3
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
      // 範字與右側注音使用固定格內座標；關閉注音時範字恢復置中。
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
      // 註解：整行 baseline 對齊、左緣＝第一格
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
    const { version, grade, semester, course } = sel || {};
    if (!version || !grade || !semester) throw new Error('缺少 version/grade/semester');
    const semSel = course === null || course === undefined || course === 'semester';
    const selForData = { version, grade, semester, course: semSel ? '1' : String(course) };
    const opts = SHEET_OPTIONS;
    if (!opts) throw new Error('SHEET_OPTIONS 未定義（app 代碼未先載入）');
    const courses = sheetCourses(selForData, semSel).filter((c) => c.chars.length);
    if (!courses.length) throw new Error(`沒有可繪製的生字：${version}/${grade}/${semester}/${course}`);

    // 發布使用專案內完整筆順包，避免 CDN 狀態改變產物或產生空白筆順格。
    if (opts.stroke) {
      const ok = await loadHanziData();
      if (!ok || !window.HANZI_DATA) throw new Error('本機筆順資料載入失敗');
      const names = new Set(courses.flatMap((c) => c.chars.map((ch) => ch.name)));
      const missing = [...names].filter((name) => !window.HANZI_DATA[name]?.strokes?.length);
      if (missing.length) throw new Error(`筆順資料缺字，請先更新 hanzi-data.js：${missing.join('、')}`);
    }
    // 每字一頁內註解資料（課本音比對，與 app 相同）
    const readings = {};
    for (const c of courses) for (const ch of c.chars) {
      const d = DICT[ch.name];
      readings[ch.name] = bookZyHit(d, ch.zhuYin) || (d && d.readings && d.readings[0]);
    }
    await ensureFonts();

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const cv = document.createElement('canvas');
    cv.width = 1680; cv.height = 2376;
    let pg = 0, first = true;
    const tick = () => new Promise((r) => setTimeout(r, 0));
    try {
      for (const c of courses) {
        const rows = c.chars;
        for (let i = 0; i < rows.length; i += SHEET_PAGE_CHARS) {
          pg++;
          drawSheetPage(cv, { title: c.title, pg, chars: rows.slice(i, i + SHEET_PAGE_CHARS), opts, readings });
          if (!first) pdf.addPage();
          first = false;
          const image = cv.toDataURL('image/jpeg', 0.92);
          pdf.addImage(image, 'JPEG', 0, 0, 210, 297);
          await tick(); // 每頁讓出主線程，長學期不凍結
        }
      }
    } finally {
      cv.width = cv.height = 1; // 釋放 canvas 記憶體
    }
    if (!pg) throw new Error(`沒有可繪製的生字：${selForData.version}/${selForData.grade}/${selForData.semester}`);
    const b64 = pdf.output('datauristring').split(',')[1];
    if (!b64) throw new Error('jsPDF 輸出為空');
    return { b64, pageCount: pg };
  };
})();

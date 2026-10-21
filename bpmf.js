/* ── bpmf.js：介面用字加注音 ─────────────────────────────
 * 預設 bpmf()＝旁式（bpmfSide）：注音符號直排於漢字右側；
 * bpmfTop()＝上式（注音符號疊在漢字上方，教科書慣例，不佔寬度）。
 * 注音來源：window.HANDWRITING_DICT（教育部《國語辭典》2014 版，全課 2994 字，離線）。
 * 多音字依介面語境選音（OVER 覆寫）；查不到就留原字、不加注音。需先載入 dict.js。
 *
 * 共用 helper（習字本 SVG/canvas 繪製也用）：
 *   bpmfParts(reading) => { bopo, tone, light }
 *     純解析：字串拆成 本位符號列／調號 ˊˇˋ／輕聲 ˙；空字串回三個 ''。
 *   bpmfRuby(reading) => .z-ruby 結構 HTML（直排小字，含調號）；
 *     無讀音回空字串（供字卡右側注音、單字直排注音用）。
 * 注音是純文字（無 HTML 標籤）；bpmf() 傳入的介面文字也必須是純文字，
 * 含 HTML 的片段請改組裝完成後再插入 DOM，不要餵給 bpmf()。
 * ─────────────────────────────────────────────────────── */
'use strict';
(function () {
  const DICT = window.HANDWRITING_DICT || {};
  // 介面語境的正確讀音：辭典未收（唸／翰），或多音字依介面詞義選音。
  const OVER = {
    唸: 'ㄋㄧㄢˋ', 翰: 'ㄏㄢˋ',          // 唸字、翰林（非課內字，辭典無）
    旁: 'ㄆㄤˊ', 首: 'ㄕㄡˇ', 語: 'ㄩˇ',   // 偏旁、部首、語言
    重: 'ㄔㄨㄥˊ',                          // 重來（＝再，非「重量」ㄓㄨㄥˋ）
    的: '˙ㄉㄜ', 著: '˙ㄓㄜ', 了: '˙ㄌㄜ', // 操作提示中的助詞；生字仍使用課本讀音
  };
  function zy(ch) {
    if (OVER[ch]) return OVER[ch];
    const d = DICT[ch];
    return d && d.readings && d.readings.length ? d.readings[0].z : null;
  }
  /** 純解析注音字串：{ bopo, tone, light }；空/非字串回三個空字串。
   *  bopo＝本位符號（不含調號）；tone＝尾調 ˊˇˋ；light＝輕聲 ˙。 */
  window.bpmfParts = function (reading) {
    const out = { bopo: '', tone: '', light: '' };
    if (typeof reading !== 'string' || !reading.length) return out;
    let bopo = reading;
    const last = bopo.slice(-1);
    if (last === 'ˊ' || last === 'ˇ' || last === 'ˋ') {
      out.tone = last;
      bopo = bopo.slice(0, -1);
    } else if (last === '˙') {
      out.light = '˙';
      bopo = bopo.slice(0, -1);
    } else if (bopo.charAt(0) === '˙') {
      out.light = '˙';
      bopo = bopo.slice(1);
    }
    out.bopo = bopo;
    return out;
  };
  /** .z-ruby 結構（直排小字＋調號，見 style.css .z-ruby）；供 .zhuyin／
   *  dZhuYin 等右側注音容器、bpmfSide 與習字本共用。無讀音回空字串。 */
  window.bpmfRuby = function (reading) {
    if (!reading) return '';
    const p = window.bpmfParts(reading);
    const bopoHtml = [...p.bopo].map((c) => '<span>' + c + '</span>').join('');
    return '<span class="z-ruby">' +
      (p.light ? '<span class="z-tone-light">' + p.light + '</span>' : '') +
      '<span class="z-main"><span class="z-bopo">' + bopoHtml + '</span>' +
      (p.tone ? '<span class="z-tone">' + p.tone + '</span>' : '') +
      '</span></span>';
  };
  /** 上式注音：中文字→<span class="bpmf"><i>注</i>字</span>（注音疊在字上方）。 */
  function bpmfTop(text) {
    let out = '';
    for (const ch of String(text ?? '')) {
      const z = zy(ch);
      out += z ? '<span class="bpmf"><i class="bpmf-z">' + z + '</i>' + ch + '</span>' : ch;
    }
    return out;
  }
  /** 旁式注音：注音符號直排顯示於漢字右側（調號拆開對齊）。
   *  需 .z-word/.z-char/.z-ruby/.z-main/.z-bopo/.z-tone/.z-tone-light 樣式（見 style.css）。 */
  function bpmfSide(text) {
    let out = '';
    for (const ch of String(text ?? '')) {
      const z = zy(ch);
      if (!z) { out += ch; continue; }
      out += '<span class="z-word"><span class="z-char">' + ch + '</span>' + window.bpmfRuby(z) + '</span>';
    }
    return out;
  }
  /** 預設＝旁式（bpmfSide，直排於右側）；上式用 bpmfTop。 */
  window.bpmf = bpmfSide;
  window.bpmfSide = bpmfSide;
  window.bpmfTop = bpmfTop;
})();

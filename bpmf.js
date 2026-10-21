/* ── bpmf.js：介面用字加注音 ─────────────────────────────
 * 預設 bpmf()＝上式：注音符號疊在漢字上方（教科書慣例，不佔寬度、
 * 不會把版面撐斷行）；bpmfSide()＝旁式（注音符號直排於漢字右側）保留可選。
 * 注音來源：window.HANDWRITING_DICT（教育部《國語辭典》2014 版，全課 2994 字，離線）。
 * 多音字依介面語境選音（OVER 覆寫）；查不到就留原字、不加注音。需先載入 dict.js。
 * ─────────────────────────────────────────────────────── */
'use strict';
(function () {
  const DICT = window.HANDWRITING_DICT || {};
  // 介面語境的正確讀音：辭典未收（唸／翰），或多音字依介面詞義選音。
  const OVER = {
    唸: 'ㄋㄧㄢˋ', 翰: 'ㄏㄢˋ',          // 唸字、翰林（非課內字，辭典無）
    旁: 'ㄆㄤˊ', 首: 'ㄕㄟˇ', 語: 'ㄩˋ',   // 偏旁、部首、語言
    重: 'ㄓㄨㄥˊ',                          // 重來（＝再，非「重量」ㄓㄨㄥˋ）
  };
  function zy(ch) {
    if (OVER[ch]) return OVER[ch];
    const d = DICT[ch];
    return d && d.readings && d.readings.length ? d.readings[0].z : null;
  }
  /** 上式注音：中文字→<span class="bpmf"><i>注</i>字</span>（注音疊在字上方）。 */
  function bpmfTop(text) {
    let out = '';
    for (const ch of String(text ?? '')) {
      const z = zy(ch);
      out += z ? '<span class="bpmf"><i class="bpmf-z">' + z + '</i>' + ch + '</span>' : ch;
    }
    return out;
  };
  /** 旁式注音：注音符號直排顯示於漢字右側（調號拆開對齊）。
   *  需 .z-word/.z-char/.z-ruby/.z-main/.z-bopo/.z-tone/.z-tone-light 樣式（見 style.css）。 */
  window.bpmfSide = function (text) {
    let out = '';
    for (const ch of String(text ?? '')) {
      const z = zy(ch);
      if (!z) { out += ch; continue; }
      let bopo = z, tone = '', light = '';
      const last = z.slice(-1);
      if (last === 'ˊ' || last === 'ˇ' || last === 'ˋ') { tone = last; bopo = z.slice(0, -1); }
      else if (last === '˙') { light = '˙'; bopo = z.slice(0, -1); }
      else if (z.charAt(0) === '˙') { light = '˙'; bopo = z.slice(1); }
      const bopoHtml = [...bopo].map((c) => '<span>' + c + '</span>').join('');
      out += '<span class="z-word"><span class="z-char">' + ch + '</span><span class="z-ruby">' +
        (light ? '<span class="z-tone-light">' + light + '</span>' : '') +
        '<span class="z-main"><span class="z-bopo">' + bopoHtml + '</span>' +
        (tone ? '<span class="z-tone">' + tone + '</span>' : '') +
        '</span></span></span>';
    }
    return out;
  };
  /** 預設＝上式（bpmfTop，不佔寬度）；旁式用 bpmfSide。 */
  window.bpmf = bpmfTop;
  window.bpmfTop = bpmfTop;
})();

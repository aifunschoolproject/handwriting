/* 發布時同步更新 index.html 的 app-version 與有變更資源的 v。
 * 版本檢查不使用 HTTP 快取；更新只重新載入頁面，不清除 localStorage。
 * 不在孩子書寫或 PDF 尚未儲存時自動重新載入。 */
(() => {
  'use strict';
  const version = document.querySelector('meta[name="app-version"]').content;
  const panel = document.getElementById('appUpdate');
  const status = document.getElementById('updateStatus');
  const check = document.getElementById('btnCheckUpdate');
  const reload = document.getElementById('btnForceUpdate');
  let busy = false;
  let checkedAt = 0;
  status.textContent = `目前版本：${version}`;

  async function checkVersion(force = false, manual = false) {
    if (busy || (!manual && Date.now() - checkedAt < 60000)) return;
    if (force && !window.confirm('重新載入最新版？已完成的練習紀錄會保留；未完成筆畫與尚未儲存的 PDF 不會保留。')) return;
    busy = true;
    check.disabled = reload.disabled = true;
    if (manual) status.textContent = '正在連線檢查最新版…';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const url = new URL('index.html', location.href);
      url.search = location.search;
      url.hash = location.hash;
      url.searchParams.set('_update', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = new DOMParser().parseFromString(await response.text(), 'text/html');
      const latest = html.querySelector('meta[name="app-version"]')?.content;
      if (!latest || !html.querySelector('#btnStart')) throw new Error('版本資訊無效');
      checkedAt = Date.now();
      if (force) {
        status.textContent = '正在載入最新版…';
        location.replace(url.href);
      } else if (latest !== version) {
        status.textContent = `新版 ${latest} 已上線。更新會保留已完成的練習紀錄。`;
        reload.textContent = '立即更新';
        panel.open = true;
      } else {
        status.textContent = `目前已是最新版：${version}`;
        reload.textContent = '強制更新';
      }
    } catch {
      status.textContent = '無法取得最新版，請確認網路後再試；目前畫面與練習紀錄不受影響。';
      if (manual) panel.open = true;
    } finally {
      clearTimeout(timer);
      busy = false;
      check.disabled = reload.disabled = false;
    }
  }
  check.addEventListener('click', () => checkVersion(false, true));
  reload.addEventListener('click', () => checkVersion(true, true));
  window.addEventListener('pageshow', () => checkVersion());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkVersion();
  });
  checkVersion();
})();

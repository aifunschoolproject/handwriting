/* 發布時同步更新 index.html 的 app-version 與有變更資源的 v。
 * 版本檢查不使用 HTTP 快取；更新只重新載入頁面，不清除 localStorage。
 * 進站、返回前景、恢復連線及前景每分鐘檢查；有新版直接更新，未完成筆畫會中斷。 */
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
    busy = true;
    checkedAt = Date.now();
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
      if (force || latest.localeCompare(version, undefined, { numeric: true }) > 0) {
        // 防止宿主忽略快取參數、重新導向後仍回傳舊 HTML 時無限重載。
        if (!force && new URL(location.href).searchParams.get('_appVersion') === latest) {
          status.textContent = `新版 ${latest} 尚未載入成功，請稍後按「強制更新」。練習紀錄仍保留。`;
          panel.open = true;
          return;
        }
        status.textContent = `正在自動更新至 ${latest}，已完成的練習紀錄會保留…`;
        url.searchParams.set('_appVersion', latest);
        location.replace(url.href);
      } else {
        status.textContent = `目前版本：${version}，已啟用自動更新。`;
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
  const resumeCheck = () => {
    checkedAt = 0;
    checkVersion();
  };
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) resumeCheck();
    else checkVersion();
  });
  window.addEventListener('online', resumeCheck);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumeCheck();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') checkVersion();
  }, 60000);
  checkVersion();
})();

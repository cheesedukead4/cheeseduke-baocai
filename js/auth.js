/*
 * Google 登入（CMSAuth）
 * ---------------------------------------------------------------
 * 啟用方式：config.js 填入 CMS_AUTH.clientId（Google Cloud 的 OAuth 用戶端 ID，是公開資訊，可以放在網站檔案裡）。
 * 沒填就是舊模式（團隊通行碼＋管理員密碼），App 照舊運作。
 *
 * 流程：開啟 App → 沒有有效登入就只顯示登入畫面 → 「使用 Google 登入」→ 拿 Google 的身分憑證給雲端後端驗證
 *   → 後端確認這個 Gmail 在管理員設定的名單內，發一組工作階段（30 天，使用中自動延長）→ 之後每次讀寫雲端資料都帶這組工作階段。
 * 名單與每個人可用的頁面由管理員在「系統設定 → 人員與權限」管理，存在雲端後端；不在名單的人拿不到任何資料。
 * 管理員是後端設定的 Gmail（Code.gs 的 ADMIN_EMAILS_），登入後自動進入管理員模式，不再有固定的管理員密碼。
 *
 * 這裡存的登入狀態（localStorage 'cms_auth'）：{ s: 工作階段, exp, email, name, role: 'admin'|'user', pages: [頁面代號] | null }
 * pages 只是用來決定選單要顯示哪些頁面（畫面權限）；真正擋資料的是後端的名單與工作階段。
 */
(function (root) {
  'use strict';

  var KEY = 'cms_auth';
  var cfg = root.CMS_AUTH || {};
  var enabled = !!cfg.clientId;
  var cloudUrl = function () { return ((root.CMS_CLOUD_PRESET || {}).url || '').trim(); };
  var state = null;
  var listeners = [];
  var wasReady = false, resolveReady;
  var ready = new Promise(function (r) { resolveReady = r; });
  var gateEl = null, gsiPromise = null, busy = false;

  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function html() { return document.documentElement; }
  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } }); }

  // ---------- 儲存 ----------
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (isObj(s) && s.s && s.exp > Date.now() + 60000 && s.email) return s;
    } catch (e) {}
    return null;
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function clearStored() {
    state = null;
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  // ---------- 目前登入的人 ----------
  function session() { return state ? state.s : ''; }
  function name() { return state ? String(state.name || '') : ''; }
  function email() { return state ? String(state.email || '') : ''; }
  function isAdmin() { return !!state && state.role === 'admin'; }
  function pages() { return state && Array.isArray(state.pages) ? state.pages : []; }
  function user() { return state ? { email: state.email, name: state.name, role: state.role, pages: pages() } : null; }

  // 雲端回應帶來最新的人員資料（名字、角色、頁面）與延長後的工作階段
  function applyMe(j) {
    if (!enabled || !state || !isObj(j)) return;
    var changed = false, perm = false;
    if (isObj(j.me)) {
      ['name', 'role'].forEach(function (k) { if (j.me[k] != null && j.me[k] !== state[k]) { state[k] = j.me[k]; changed = perm = true; } });
      var np = Array.isArray(j.me.pages) ? j.me.pages : null;
      if (JSON.stringify(np) !== JSON.stringify(state.pages)) { state.pages = np; changed = perm = true; }
    }
    if (j.session && j.session !== state.s) { state.s = j.session; state.exp = j.exp; changed = true; }
    if (changed) { persist(); if (perm) emit(); }
  }

  // ---------- 登入畫面 ----------
  var CSS_ID = 'cmsLoginGateCss';
  function buildGate() {
    if (gateEl) return gateEl;
    var g = document.createElement('div');
    g.id = 'loginGate';
    g.setAttribute('role', 'dialog');
    g.setAttribute('aria-modal', 'true');
    g.setAttribute('aria-labelledby', 'lgTitle');
    g.innerHTML =
      '<div class="lg-box">' +
      '<img src="icons/icon.svg" alt="" width="64" height="64">' +
      '<h1 id="lgTitle">檔期包材管理系統</h1>' +
      '<p class="lg-sub">請用 Google 帳號（Gmail）登入</p>' +
      '<div id="lgBtn" class="lg-btn"></div>' +
      '<p id="lgMsg" class="lg-msg" aria-live="polite"></p>' +
      '<button type="button" id="lgRetry" class="lg-retry" style="display:none">重新載入登入按鈕</button>' +
      (cfg.mock && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
        ? '<div class="lg-mock"><input id="lgMockEmail" placeholder="測試用 Gmail（僅本機測試環境）"><button type="button" id="lgMockBtn">測試登入</button></div>' : '') +
      '<p class="lg-help">只有管理員加入名單的 Gmail 才能進入，進入後只會看到被開放的頁面。<br>沒有權限的話，請把你的 Gmail 地址告訴管理員。</p>' +
      '</div>';
    document.body.appendChild(g);
    gateEl = g;
    g.querySelector('#lgRetry').onclick = function () { gsiPromise = null; renderGoogleButton(); };
    var mb = g.querySelector('#lgMockBtn');
    if (mb) mb.onclick = function () { var v = g.querySelector('#lgMockEmail').value.trim(); if (v) onCredential({ credential: 'mock:' + v }); };
    return g;
  }
  function setMsg(t, bad) {
    var m = document.getElementById('lgMsg');
    if (m) { m.textContent = t || ''; m.className = 'lg-msg' + (bad ? ' bad' : ''); }
  }
  function showGate(msg, bad) {
    html().classList.add('auth-locked');
    var show = function () { buildGate(); setMsg(msg, bad); renderGoogleButton(); };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, { once: true });
  }
  function loadGsi() {
    if (gsiPromise) return gsiPromise;
    gsiPromise = new Promise(function (resolve, reject) {
      if (root.google && google.accounts && google.accounts.id) return resolve();
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { s.remove(); reject(new Error('load')); };
      document.head.appendChild(s);
    });
    gsiPromise.catch(function () { gsiPromise = null; });
    return gsiPromise;
  }
  function renderGoogleButton() {
    var retry = document.getElementById('lgRetry'), box = document.getElementById('lgBtn');
    if (!box) return;
    if (retry) retry.style.display = 'none';
    loadGsi().then(function () {
      google.accounts.id.initialize({ client_id: cfg.clientId, callback: onCredential, auto_select: false, cancel_on_tap_outside: true });
      box.innerHTML = '';
      google.accounts.id.renderButton(box, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', logo_alignment: 'left', width: 280, locale: 'zh_TW' });
    }).catch(function () {
      setMsg(navigator.onLine === false ? '目前沒有網路，連上網路後才能登入。' : '無法載入 Google 登入，請確認網路後再試。', true);
      if (retry) retry.style.display = 'inline-block';
    });
  }
  function postLogin(idToken) {
    var u = cloudUrl();
    if (!u) return Promise.reject(new Error('尚未設定雲端網址（config.js）'));
    return fetch(u, { method: 'POST', redirect: 'follow', cache: 'no-store', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'login', idToken: idToken }) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function onCredential(resp) {
    if (busy || !resp || !resp.credential) return;
    busy = true;
    setMsg('登入中…');
    postLogin(resp.credential).then(function (j) {
      busy = false;
      if (j && j.ok && j.session && j.me) {
        state = { s: j.session, exp: j.exp, email: j.me.email, name: j.me.name, role: j.me.role, pages: Array.isArray(j.me.pages) ? j.me.pages : null };
        persist();
        html().classList.remove('auth-locked');
        if (gateEl) { gateEl.remove(); gateEl = null; }
        if (wasReady) { location.reload(); return; } // App 已經在跑（登入過期後重新登入）：整個重新載入最單純
        wasReady = true; resolveReady(); emit();
        return;
      }
      if (j && j.error === 'forbidden') setMsg('「' + (j.email || '這個帳號') + '」不在人員名單內。請把這個 Gmail 地址告訴管理員，請他加進「系統設定 → 人員與權限」；如果你有其他 Gmail，也可以換一個登入。', true);
      else setMsg((j && j.message) || '登入失敗，請再試一次。', true);
    }).catch(function (e) {
      busy = false;
      setMsg(navigator.onLine === false ? '目前沒有網路，連上網路後才能登入。' : '無法連線到雲端：' + e.message, true);
    });
  }

  // ---------- 被拒絕、登出 ----------
  // 雲端說「登入過期」或「帳號已停用／移出名單」：回到登入畫面
  function denied(code) {
    if (!enabled || !state) return;
    var removed = code === 'forbidden';
    clearStored();
    try { sessionStorage.removeItem('cms_current_page'); } catch (e) {}
    // 被移出名單的人，這台裝置上的資料也清掉（有還沒上傳的修改就先保留，不冒險弄丟）
    var clean = !root.CMSCloud || !CMSCloud.status().dirty;
    var wipe = removed && clean && root.CMSCloud && CMSCloud.wipeLocal ? CMSCloud.wipeLocal() : Promise.resolve();
    wipe.then(function () {
      emit();
      showGate(removed ? '你的帳號已被停用或移出名單，請聯絡管理員。' : '登入已過期，請重新登入。', removed);
    });
  }
  // 登出：先把還沒上傳的修改送出，再清掉這台裝置上的資料（資料都在雲端，下次登入會重新下載）
  function logout() {
    if (!enabled) return Promise.resolve(false);
    var C = root.CMSCloud;
    var pre = C && C.status().dirty ? C.syncNow().catch(function () {}) : Promise.resolve();
    return pre.then(function () {
      var left = C ? C.status().dirty : 0;
      var q = left
        ? '還有 ' + left + ' 類修改沒能上傳到雲端，現在登出會遺失這些修改。\n確定要登出嗎？'
        : '登出後，這台裝置上的資料會清除（資料都在雲端，下次登入會重新下載）。\n確定要登出嗎？';
      if (!confirm(q)) return false;
      var wipe = C && C.wipeLocal ? C.wipeLocal() : Promise.resolve();
      return wipe.then(function () {
        clearStored();
        try { sessionStorage.clear(); } catch (e) {}
        try { if (root.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (e) {}
        location.reload();
        return true;
      });
    });
  }

  // ---------- 後端 API（人員管理用）----------
  function api(action, payload) {
    var u = cloudUrl();
    if (!enabled || !state || !u) return Promise.reject(new Error('尚未登入'));
    var req;
    if (action === 'users') {
      req = fetch(u + (u.indexOf('?') < 0 ? '?' : '&') + 'action=users&token=' + encodeURIComponent(state.s) + '&_=' + Date.now(), { method: 'GET', redirect: 'follow', cache: 'no-store' });
    } else {
      var body = Object.assign({ action: action, token: state.s }, payload || {});
      req = fetch(u, { method: 'POST', redirect: 'follow', cache: 'no-store', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    }
    return req.then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
      if (j && j.ok) { applyMe(j); return j; }
      var err = new Error((j && j.message) || (j && j.error === 'busy' ? '雲端忙碌中，請稍後再試' : '雲端回應錯誤'));
      err.code = j && j.error;
      if (err.code === 'unauthorized' || (err.code === 'forbidden' && !(j && j.message))) denied(err.code);
      throw err;
    });
  }

  // ---------- 啟動 ----------
  function init() {
    if (!enabled) { wasReady = true; resolveReady(); return; }
    // 改用 Google 登入後，舊的團隊通行碼設定不再有用，直接清掉（避免留在裝置上）
    try { localStorage.removeItem('cms_cloud_config'); localStorage.removeItem('cms_cloud_config_token'); localStorage.removeItem('cms_person'); localStorage.removeItem('cms_login_fail'); } catch (e) {}
    try { sessionStorage.removeItem('campaign_admin_logged_in'); } catch (e) {}
    state = load();
    if (state) { wasReady = true; resolveReady(); return; }
    clearStored();
    showGate('');
  }
  init();

  root.CMSAuth = {
    enabled: enabled, ready: ready,
    session: session, name: name, email: email, isAdmin: isAdmin, pages: pages, user: user,
    applyMe: applyMe, denied: denied, logout: logout, api: api,
    on: function (fn) { listeners.push(fn); }
  };
})(window);

/*
 * 人員登入與頁面權限（CMSAccess）
 * ---------------------------------------------------------------
 * 管理員在「系統設定 → 人員與權限」新增人員、設定每個人能用哪些頁面；同事用自己的登入碼登入後，
 * 選單只會出現被開放的頁面。沒登入的人維持只能看首頁。
 *
 * 這是「畫面權限」：擋的是選單與頁面入口，不是資料安全防護。知道團隊通行碼又懂技術的人，仍可能讀到全部資料；
 * 管理員密碼（legacy-4.js 的 ADMIN_PASSWORD）可以看到全部頁面。
 *
 * 資料：db.users = [{ id, name, active, pages:[頁面代號], salt, hash, iter, createdAt, createdBy, updatedAt, updatedBy }]
 *   登入碼不存明碼，只存 PBKDF2-SHA256 雜湊（每人一組隨機 salt）；人員資料跟著其他資料同步給所有裝置。
 * 這台裝置的登入狀態存在 localStorage 'cms_person'：{ id, stamp }，stamp＝雜湊前 16 碼，
 * 另有 sid（登入世代）：人員被停用或重設登入碼時換一個新的，所以「停用再啟用」也不會讓舊裝置的登入復活。
 * 管理員重設登入碼、停用或刪除人員後，那台裝置會自動變回未登入，正在看的頁面也會回首頁。
 */
(function (root) {
  'use strict';

  var LS_KEY = 'cms_person';
  var FAIL_KEY = 'cms_login_fail';
  var ITER = 100000;
  var MAX_FAIL = 5, LOCK_MS = 60 * 1000;
  var ADMIN_ONLY = ['xUsers']; // 只有管理員密碼能進、不能開放給人員的頁面

  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function getDb() { try { return db; } catch (e) { return null; } } // 原系統的全域資料，載入完成後才有
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(t) { if (root.cmsToast) root.cmsToast(t); }
  function adminMode() { return document.body.classList.contains('admin-mode'); }
  function users() { var d = getDb(); return d && Array.isArray(d.users) ? d.users.filter(isObj) : []; }

  // ---------- 雜湊 ----------
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function fromHex(s) { var a = new Uint8Array(s.length / 2); for (var i = 0; i < a.length; i++) a[i] = parseInt(s.substr(i * 2, 2), 16); return a; }
  function canHash() { return !!(root.crypto && root.crypto.subtle && root.crypto.getRandomValues); }
  function hashCode(code, saltHex, iter) {
    var enc = new TextEncoder();
    return root.crypto.subtle.importKey('raw', enc.encode(String(code)), 'PBKDF2', false, ['deriveBits'])
      .then(function (key) { return root.crypto.subtle.deriveBits({ name: 'PBKDF2', salt: fromHex(saltHex), iterations: iter || ITER, hash: 'SHA-256' }, key, 256); })
      .then(hex);
  }
  // 產生一組新的登入憑證：{ salt, hash, iter }
  function makeCredential(code) {
    if (!canHash()) return Promise.reject(new Error('這個網址不支援加密（需要 https），不能設定登入碼'));
    var salt = hex(root.crypto.getRandomValues(new Uint8Array(16)));
    return hashCode(code, salt, ITER).then(function (h) { return { salt: salt, hash: h, iter: ITER }; });
  }
  function randomCode() { // 6 位數字
    var a = root.crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
    return ('00000' + a).slice(-6);
  }

  // ---------- 目前登入的人 ----------
  function readSaved() { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; } }
  function user() {
    var s = readSaved();
    if (!isObj(s)) return null;
    var u = users().find(function (x) { return String(x.id) === String(s.id); });
    if (!u || u.active === false || !u.hash || String(u.hash).slice(0, 16) !== s.stamp || String(u.sid || '') !== String(s.sid || '')) return null;
    return u;
  }
  // 管理員模式下不用人員的名字（避免主管在共用平板登入管理員後，紀錄被記成前一位登入的人）
  function name() { if (adminMode()) return ''; var u = user(); return u ? String(u.name || '') : ''; }
  // 這一頁現在能不能進：管理員全部可以；首頁人人可以；人員只能進被開放的頁面
  function canOpen(page) {
    if (adminMode() || page === 'dashboard') return true;
    if (ADMIN_ONLY.indexOf(page) >= 0) return false;
    var u = user();
    return !!(u && Array.isArray(u.pages) && u.pages.indexOf(String(page)) >= 0);
  }
  // 可以開放給人員的頁面（依選單順序）：[{ id, title, group }]
  function assignablePages() {
    var out = [];
    document.querySelectorAll('#nav .navbtn[data-page]').forEach(function (b) {
      var id = b.dataset.page;
      if (id === 'dashboard' || ADMIN_ONLY.indexOf(id) >= 0 || out.some(function (o) { return o.id === id; })) return;
      var sp = b.querySelector('span'), grp = b.closest('.nav-group'), lab = grp && grp.previousElementSibling;
      var gname = '';
      if (lab && lab.classList.contains('nav-label')) { var c = lab.cloneNode(true); var i = c.querySelector('i'); if (i) i.remove(); gname = c.textContent.trim(); }
      out.push({ id: id, title: (sp ? sp.textContent : id).trim(), group: gname || '其他' });
    });
    return out;
  }

  // ---------- 畫面 ----------
  function ensureButtons() {
    var foot = document.querySelector('.sidebar-foot');
    if (foot && !document.getElementById('personLoginBtn')) {
      var ref = document.getElementById('adminLoginBtn');
      var ico = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>';
      var a = document.createElement('button');
      a.id = 'personLoginBtn'; a.type = 'button'; a.className = 'btn gray side-btn'; a.innerHTML = ico + '<span>人員登入</span>';
      a.onclick = function () { openLogin(); };
      var b = document.createElement('button');
      b.id = 'personLogoutBtn'; b.type = 'button'; b.className = 'btn gray side-btn'; b.style.display = 'none'; b.innerHTML = ico + '<span></span>';
      b.onclick = function () { logout(); };
      foot.insertBefore(a, ref || foot.firstChild); foot.insertBefore(b, ref || foot.firstChild);
    }
    var ta = document.querySelector('.topbar-actions');
    if (ta && !document.getElementById('personBadge')) {
      var s = document.createElement('span');
      s.id = 'personBadge'; s.className = 'person-badge';
      ta.insertBefore(s, ta.firstChild);
    }
  }
  // 依目前的登入狀態更新選單、按鈕與標籤
  function apply() {
    var u = user(), admin = adminMode(), mode = !!u && !admin;
    document.body.classList.toggle('user-mode', mode);
    ensureButtons();
    document.querySelectorAll('#nav .navbtn.admin-nav').forEach(function (b) {
      b.classList.toggle('user-ok', mode && canOpen(b.dataset.page));
    });
    // 人員登入時，沒被開放的頁面直接隱藏；整組都沒有頁面的，連群組標題也藏起來
    document.querySelectorAll('#nav .nav-group').forEach(function (g) {
      var lab = g.previousElementSibling, hasAny = true;
      if (mode) hasAny = Array.prototype.some.call(g.querySelectorAll('.navbtn'), function (b) { return !b.classList.contains('admin-nav') || b.classList.contains('user-ok'); });
      g.style.display = hasAny ? '' : 'none';
      if (lab && lab.classList.contains('nav-label')) lab.style.display = hasAny ? '' : 'none';
    });
    var li = document.getElementById('personLoginBtn'), lo = document.getElementById('personLogoutBtn'), bd = document.getElementById('personBadge');
    if (li) li.style.display = (u || admin) ? 'none' : 'flex';
    if (lo) { lo.style.display = (u && !admin) ? 'flex' : 'none'; var sp = lo.querySelector('span'); if (sp) sp.textContent = '登出（' + (u ? u.name : '') + '）'; }
    if (bd) bd.textContent = mode ? '登入：' + u.name : '';
    enforce();
  }
  // 權限變動（被停用、刪除、重設登入碼、收回這一頁）時，正在看的頁面不能留著：馬上回首頁
  var enforcing = false;
  function enforce() {
    if (enforcing || adminMode()) return;
    var cur = document.querySelector('#nav .navbtn.active'), p = cur && cur.dataset.page;
    if (!p || p === 'dashboard' || canOpen(p)) return;
    var home = document.querySelector('#nav .navbtn[data-page="dashboard"]');
    if (!home) return;
    enforcing = true;
    try { home.click(); } finally { enforcing = false; }
    if (user()) toast('你的權限已變更，已回到首頁。');
  }

  // ---------- 登入 ----------
  function failState() { try { return JSON.parse(localStorage.getItem(FAIL_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function setFail(o) { try { localStorage.setItem(FAIL_KEY, JSON.stringify(o)); } catch (e) {} }
  function login(uid, code) {
    var f = failState();
    if (f.until && Date.now() < f.until) return Promise.resolve({ ok: false, error: '輸入錯誤太多次，請 ' + Math.ceil((f.until - Date.now()) / 1000) + ' 秒後再試。' });
    var u = users().find(function (x) { return String(x.id) === String(uid) && x.active !== false; });
    if (!u) return Promise.resolve({ ok: false, error: '找不到這位人員，或帳號已停用。' });
    if (!canHash()) return Promise.resolve({ ok: false, error: '這個網址不支援登入（需要 https）。' });
    if (!code) return Promise.resolve({ ok: false, error: '請輸入登入碼。' });
    return hashCode(code, u.salt, u.iter).then(function (h) {
      if (h !== u.hash) {
        var n = (f.n || 0) + 1;
        setFail(n >= MAX_FAIL ? { n: 0, until: Date.now() + LOCK_MS } : { n: n });
        return { ok: false, error: n >= MAX_FAIL ? '輸入錯誤太多次，請 1 分鐘後再試。' : '登入碼不正確（還可以試 ' + (MAX_FAIL - n) + ' 次）。' };
      }
      setFail({});
      try { localStorage.setItem(LS_KEY, JSON.stringify({ id: u.id, stamp: String(h).slice(0, 16), sid: u.sid || '' })); } catch (e) { return { ok: false, error: '無法記住登入狀態：' + e.message }; }
      apply();
      return { ok: true, user: u };
    });
  }
  function logout() {
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    apply();
    var home = document.querySelector('#nav .navbtn[data-page="dashboard"]');
    if (home) home.click();
    toast('已登出');
  }

  function openLogin() {
    var list = users().filter(function (x) { return x.active !== false && x.hash; });
    var mask = document.createElement('div');
    mask.className = 'cms-modal show x-dialog';
    mask.innerHTML = '<div class="cms-modal-box"><div class="cms-modal-head"><h3>人員登入</h3></div>' +
      (list.length
        ? '<div class="x-form"><label class="x-field x-full"><span>姓名</span><select data-f="uid">' + list.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>'; }).join('') + '</select></label>' +
          '<label class="x-field x-full"><span>登入碼</span><input data-f="code" type="password" inputmode="text" autocomplete="off" placeholder="管理員給你的登入碼"></label></div>' +
          '<p class="small" data-err style="color:var(--bad);font-weight:700;min-height:20px;margin:8px 0 0"></p>'
        : '<p class="small" style="margin:6px 0 10px">目前還沒有設定任何人員。請管理員先登入，到「系統設定 → 人員與權限」新增。</p>') +
      '<div class="cms-modal-actions"><button type="button" class="btn gray" data-x="admin">我是管理員</button><span class="spacer"></span><button type="button" class="btn gray" data-x="cancel">取消</button>' +
      (list.length ? '<button type="button" class="btn primary" data-x="ok">登入</button>' : '') + '</div></div>';
    document.body.appendChild(mask);
    var busy = false;
    function close() { mask.remove(); }
    function submit() {
      if (busy) return;
      var uid = mask.querySelector('[data-f="uid"]').value, code = mask.querySelector('[data-f="code"]').value;
      var err = mask.querySelector('[data-err]'), btn = mask.querySelector('[data-x="ok"]');
      busy = true; btn.disabled = true; err.textContent = '';
      login(uid, code).then(function (r) {
        busy = false; btn.disabled = false;
        if (r.ok) { close(); toast('歡迎，' + r.user.name); return; }
        err.textContent = r.error; var c = mask.querySelector('[data-f="code"]'); c.value = ''; c.focus();
      }).catch(function (e) { busy = false; btn.disabled = false; err.textContent = '登入失敗：' + e.message; });
    }
    mask.addEventListener('click', function (e) {
      var a = e.target.closest('[data-x]');
      if (e.target === mask || (a && a.dataset.x === 'cancel')) close();
      else if (a && a.dataset.x === 'ok') submit();
      else if (a && a.dataset.x === 'admin') { close(); if (typeof root.adminLogin === 'function') root.adminLogin(); }
    });
    mask.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (mask.querySelector('[data-x="ok"]')) submit(); } });
    var first = mask.querySelector('[data-f="code"]'); if (first) setTimeout(function () { first.focus(); }, 30);
  }

  // 點到沒權限的選單：人員登入中 → 提示沒權限；沒登入 → 開登入視窗（可以改選管理員登入）
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('.admin-nav');
    if (!b || adminMode() || canOpen(b.dataset.page)) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    var sp = b.querySelector('span');
    if (user()) toast('你沒有「' + (sp ? sp.textContent.trim() : b.dataset.page) + '」這一頁的權限，需要的話請找管理員。');
    else openLogin();
  }, true);

  window.addEventListener('load', apply);
  // 同一台裝置的另一個分頁登入、登出或換人時，這個分頁也跟著更新
  window.addEventListener('storage', function (e) { if (e.key === LS_KEY) apply(); });
  document.addEventListener('DOMContentLoaded', function () { ensureButtons(); });
  // 同事（管理員）改了人員資料時，這台裝置馬上更新選單
  if (root.CMSCloud && CMSCloud.on) {
    CMSCloud.on(function (type, payload) {
      if (type === 'remote-change' && payload && Array.isArray(payload.keys) && payload.keys.indexOf('users') >= 0) apply();
    });
  }

  root.CMSAccess = {
    user: user, name: name, canOpen: canOpen, apply: apply, login: login, logout: logout, openLogin: openLogin,
    makeCredential: makeCredential, randomCode: randomCode, canHash: canHash, assignablePages: assignablePages, ADMIN_ONLY: ADMIN_ONLY, _hashCode: hashCode
  };
})(window);

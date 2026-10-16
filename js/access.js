/*
 * 頁面權限（CMSAccess）
 * ---------------------------------------------------------------
 * Google 登入模式（config.js 有填 CMS_AUTH.clientId，見 js/auth.js）：
 *   - 登入的 Gmail 若是管理員（雲端後端設定）→ 自動進入管理員模式，全部頁面可用
 *   - 名單內的人 → 選單只會出現管理員開放給他的頁面，首頁人人可看
 *   - 沒登入就只會看到登入畫面，所以不會有「未登入的人」
 * 舊模式（沒填 clientId）：維持原本的管理員密碼，沒登入只能看首頁。
 *
 * 這是畫面權限：擋的是選單與頁面入口。資料本身只有「名單內的 Gmail」讀得到；
 * 名單內的人在技術上讀得到全部資料（包含客戶訂單），所以請只把名單開給信任的人。
 * 管理員模式下 body 有 admin-mode，人員登入時 body 有 user-mode。
 */
(function (root) {
  'use strict';

  var ADMIN_ONLY = ['xUsers']; // 只有管理員能進、不能開放給人員的頁面

  function authOn() { return !!(root.CMSAuth && CMSAuth.enabled); }
  function toast(t) { if (root.cmsToast) root.cmsToast(t); }
  function adminMode() { return document.body.classList.contains('admin-mode'); }

  // ---------- 目前登入的人 ----------
  function user() { return authOn() ? CMSAuth.user() : null; }
  function name() { return authOn() ? CMSAuth.name() : ''; }
  // 這一頁現在能不能進：管理員全部可以；首頁人人可以；人員只能進被開放的頁面
  function canOpen(page) {
    if (authOn()) {
      if (CMSAuth.isAdmin() || page === 'dashboard') return true;
      if (ADMIN_ONLY.indexOf(page) >= 0) return false;
      return CMSAuth.pages().indexOf(String(page)) >= 0;
    }
    return adminMode() || page === 'dashboard';
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
    if (foot && !document.getElementById('personLogoutBtn')) {
      var ref = document.getElementById('adminLoginBtn');
      var b = document.createElement('button');
      b.id = 'personLogoutBtn'; b.type = 'button'; b.className = 'btn gray side-btn'; b.style.display = 'none';
      b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11"/></svg><span></span>';
      b.onclick = function () { CMSAuth.logout(); };
      foot.insertBefore(b, ref || foot.firstChild);
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
    var on = authOn(), u = user(), admin = adminMode(), mode = on && !!u && !admin;
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
    var lo = document.getElementById('personLogoutBtn'), bd = document.getElementById('personBadge');
    var ab = document.getElementById('adminLoginBtn'), al = document.getElementById('adminLogoutBtn');
    if (on) { // Google 登入模式：不再有管理員密碼，只留「登出」
      if (ab) ab.style.display = 'none';
      if (al) al.style.display = 'none';
    }
    if (lo) {
      lo.style.display = (on && u) ? 'flex' : 'none';
      var sp = lo.querySelector('span');
      if (sp) sp.textContent = '登出（' + (u ? (u.name || u.email) : '') + '）';
      lo.title = u ? u.email : '';
    }
    if (bd) bd.textContent = mode ? '登入：' + (u.name || u.email) : '';
    enforce();
  }
  // 權限變動（被收回這一頁）時，正在看的頁面不能留著：馬上回首頁
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

  // 點到沒權限的選單：Google 登入模式 → 提示沒權限；舊模式交給原本的管理員登入視窗（legacy-4.js）
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('.admin-nav');
    if (!b || !authOn() || adminMode() || canOpen(b.dataset.page)) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    var sp = b.querySelector('span');
    toast('你沒有「' + (sp ? sp.textContent.trim() : b.dataset.page) + '」這一頁的權限，需要的話請找管理員。');
  }, true);

  function refresh() {
    // 管理員身分改變時，legacy-4.js 的 adminApply 會一併呼叫 apply()
    if (typeof root.adminApply === 'function') root.adminApply(); else apply();
  }
  window.addEventListener('load', apply);
  document.addEventListener('DOMContentLoaded', ensureButtons);
  // 管理員在別處改了這個人的權限（雲端回應帶回新的頁面清單）→ 馬上更新選單
  if (root.CMSAuth && CMSAuth.on) CMSAuth.on(refresh);

  root.CMSAccess = {
    user: user, name: name, canOpen: canOpen, apply: apply, assignablePages: assignablePages, ADMIN_ONLY: ADMIN_ONLY
  };
})(window);

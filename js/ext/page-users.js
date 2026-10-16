/*
 * 人員與權限（xUsers，系統設定，只有管理員進得去）
 *  - 用 Gmail 地址新增人員，勾選每個人能用哪些頁面；可停用、啟用、刪除
 *  - 名單存在雲端後端（不是跟資料一起同步），所以不在名單的人拿不到任何資料；管理員是後端設定的 Gmail
 *  - 人員用自己的 Google 帳號登入，沒有另外的密碼（見 js/auth.js）
 */
(function (X, A) {
  'use strict';
  if (!X || !A) return;

  var esc = X.esc;
  var QUICK_PAGES = ['xQuickEntry', 'xStocktake']; // 「現場人員」組合
  var cache = null;   // { users: [...], admins: [...] }
  var loading = false;

  function pageTitle(id) { var p = A.assignablePages().find(function (x) { return x.id === id; }); return p ? p.title : id; }
  function validEmail(s) { return /^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$/.test(s) && s.length <= 120; }
  function sameEmail(a, b) { return String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); }
  function ago(t) {
    if (!t) return '還沒登入過';
    var d = Math.floor((Date.now() - t) / 86400000);
    return d <= 0 ? '今天' : d + ' 天前';
  }

  // ---------- 對話框 ----------
  function modal(html, onClick) {
    var mask = document.createElement('div');
    mask.className = 'cms-modal show x-dialog';
    mask.innerHTML = '<div class="cms-modal-box" style="width:min(600px,100%)">' + html + '</div>';
    document.body.appendChild(mask);
    mask.addEventListener('click', function (e) {
      if (e.target === mask) { mask.remove(); return; }
      var a = e.target.closest('[data-x]');
      if (a) onClick(a.dataset.x, a, mask);
    });
    return mask;
  }

  function personDialog(u, done) {
    var edit = !!u, pages = A.assignablePages(), groups = [];
    pages.forEach(function (p) { var g = groups.find(function (x) { return x.name === p.group; }); if (!g) groups.push(g = { name: p.group, items: [] }); g.items.push(p); });
    var have = edit && Array.isArray(u.pages) ? u.pages : [];
    var html = '<div class="cms-modal-head"><h3>' + (edit ? '修改人員：' + esc(u.name || u.email) : '新增人員') + '</h3></div>' +
      '<div class="x-form">' +
      '<label class="x-field x-full"><span>Gmail 地址 <i>*</i></span><input data-f="email" type="email" maxlength="120" autocomplete="off" value="' + esc(edit ? u.email : '') + '"' + (edit ? ' readonly' : '') + ' placeholder="例：mei@gmail.com"></label>' +
      '<label class="x-field x-full"><span>姓名（顯示用，修改紀錄會記這個名字）</span><input data-f="name" maxlength="30" value="' + esc(edit ? u.name : '') + '" placeholder="例：小美；留白就用 Google 帳號上的名字"></label></div>' +
      '<p class="small" style="margin:6px 0 12px">對方用這個 Gmail 登入 Google 就能進來，不用另外設密碼。不是 Gmail 的 Google 帳號（公司網域）也可以。</p>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px"><b>可以使用的頁面</b>' +
      '<button type="button" class="btn gray" data-x="p-all" style="min-height:32px;padding:4px 10px">全部勾選</button>' +
      '<button type="button" class="btn gray" data-x="p-quick" style="min-height:32px;padding:4px 10px">現場人員（快速輸入、盤點）</button>' +
      '<button type="button" class="btn gray" data-x="p-none" style="min-height:32px;padding:4px 10px">全部取消</button></div>' +
      '<p class="small" style="margin:0 0 8px">首頁登入後人人都看得到，不用勾選。</p>' +
      groups.map(function (g) {
        return '<div class="xu-group"><div class="xu-group-name">' + esc(g.name) + '</div><div class="xu-checks">' + g.items.map(function (p) {
          return '<label class="xu-check"><input type="checkbox" data-pg="' + esc(p.id) + '"' + (have.indexOf(p.id) >= 0 ? ' checked' : '') + '> ' + esc(p.title) + '</label>';
        }).join('') + '</div></div>';
      }).join('') +
      '<p class="small" data-err style="color:var(--bad);font-weight:700;min-height:20px;margin:10px 0 0"></p>' +
      '<div class="cms-modal-actions"><span class="spacer"></span><button type="button" class="btn gray" data-x="cancel">取消</button><button type="button" class="btn primary" data-x="save">儲存</button></div>';
    var busy = false;
    modal(html, function (act, btn, mask) {
      var boxes = mask.querySelectorAll('[data-pg]');
      if (act === 'cancel') mask.remove();
      else if (act === 'p-all') boxes.forEach(function (c) { c.checked = true; });
      else if (act === 'p-none') boxes.forEach(function (c) { c.checked = false; });
      else if (act === 'p-quick') boxes.forEach(function (c) { c.checked = QUICK_PAGES.indexOf(c.dataset.pg) >= 0; });
      else if (act === 'save' && !busy) {
        var err = mask.querySelector('[data-err]');
        var email = mask.querySelector('[data-f="email"]').value.trim(), nm = mask.querySelector('[data-f="name"]').value.trim();
        var chosen = []; boxes.forEach(function (c) { if (c.checked) chosen.push(c.dataset.pg); });
        err.textContent = '';
        if (!validEmail(email)) { err.textContent = 'Gmail 地址格式不對。'; return; }
        if (!edit && cache && cache.users.some(function (x) { return sameEmail(x.email, email); })) { err.textContent = '這個 Gmail 已經在名單裡了。'; return; }
        busy = true; btn.disabled = true; btn.textContent = '儲存中…';
        CMSAuth.api('userSave', { email: email, name: nm, pages: chosen, enabled: edit ? u.enabled : true }).then(function (j) {
          cache.users = j.users;
          mask.remove();
          X.toast('已儲存 ' + (nm || email));
          done();
        }).catch(function (e) { busy = false; btn.disabled = false; btn.textContent = '儲存'; err.textContent = e.message; });
      }
    });
    setTimeout(function () { var f = document.querySelector('.x-dialog [data-f="' + (edit ? 'name' : 'email') + '"]'); if (f) f.focus(); }, 30);
  }

  // ---------- 動作 ----------
  function find(email) { return cache && cache.users.find(function (x) { return sameEmail(x.email, email); }); }
  function toggle(email, done) {
    var t = find(email);
    if (!t) return;
    var on = t.enabled === false;
    if (!on && !confirm('停用「' + (t.name || t.email) + '」後，這個人馬上不能讀取資料、不能登入。確定嗎？')) return;
    CMSAuth.api('userSave', { email: t.email, name: t.name, pages: t.pages, enabled: on }).then(function (j) {
      cache.users = j.users; X.toast((on ? '已啟用 ' : '已停用 ') + (t.name || t.email)); done();
    }).catch(function (e) { X.toast('失敗：' + e.message); });
  }
  function remove(email, done) {
    var t = find(email);
    if (!t || !confirm('確定刪除「' + (t.name || t.email) + '」嗎？刪除後這個人馬上不能讀取資料，要再用就得重新新增。')) return;
    CMSAuth.api('userDelete', { email: t.email }).then(function (j) {
      cache.users = j.users; X.toast('已刪除 ' + (t.name || t.email)); done();
    }).catch(function (e) { X.toast('失敗：' + e.message); });
  }

  // ---------- 畫面 ----------
  function draw(el) {
    var users = cache.users, active = users.filter(function (u) { return u.enabled !== false; });
    var all = A.assignablePages();
    var html = X.ui.banner('info', '登入方式是 <b>Google 帳號</b>：你把同事的 Gmail 加進下面的名單、勾選能用的頁面，同事打開 App 按「使用 Google 登入」就能進來。不在名單的人登入後只會看到「不在名單內」，讀不到任何資料。') +
      X.ui.banner('warn', '頁面勾選只是「畫面上」的分工；名單內的人在技術上讀得到全部資料（含客戶訂單）。所以名單請只開給信任的人，不用了就停用或刪除。');
    html += X.ui.kpis([
      { label: '人員（不含管理員）', value: users.length + ' 位', tone: 'info' },
      { label: '啟用中', value: active.length + ' 位', tone: active.length ? 'ok' : 'muted' },
      { label: '可開放的頁面', value: all.length + ' 頁', tone: 'muted', sub: '首頁登入後人人看得到' }
    ]);
    var cols = [
      { label: 'Gmail／姓名', render: function (u) { return '<b>' + esc(u.name || '（未填姓名）') + '</b><br><span class="small">' + esc(u.email) + '</span>'; } },
      { label: '狀態', render: function (u) { return u.enabled === false ? X.ui.tag('已停用', 'muted') : X.ui.tag('啟用中', 'ok'); } },
      { label: '可以使用的頁面', render: function (u) {
        var p = Array.isArray(u.pages) ? u.pages : [];
        if (!p.length) return '<span class="small">只能看首頁</span>';
        return p.slice(0, 6).map(function (id) { return X.ui.tag(pageTitle(id), 'info'); }).join(' ') + (p.length > 6 ? ' <span class="small">等 ' + p.length + ' 頁</span>' : '');
      } },
      { label: '最後登入', render: function (u) { return '<span class="small">' + esc(ago(u.lastLogin)) + '</span>'; } },
      { label: '', render: function (u) {
        var k = esc(u.email);
        return '<div class="x-row-actions"><button type="button" class="btn primary" data-act="edit" data-id="' + k + '" style="min-height:36px;padding:4px 12px">修改權限</button>' +
          '<button type="button" class="btn gray" data-act="toggle" data-id="' + k + '" style="min-height:36px;padding:4px 12px">' + (u.enabled === false ? '啟用' : '停用') + '</button>' +
          '<button type="button" class="btn red" data-act="del" data-id="' + k + '" style="min-height:36px;padding:4px 12px">刪除</button></div>';
      } }
    ];
    html += X.ui.card('人員名單', X.ui.table(cols, users, { empty: '還沒有人員，按右上角「新增人員」輸入同事的 Gmail。' }),
      '<button type="button" class="btn primary" data-act="new" style="min-height:42px">＋ 新增人員</button>');
    html += X.ui.card('管理員', '<p style="margin:0 0 6px">' + (cache.admins.length ? cache.admins.map(function (m) { return X.ui.tag(m, 'warn'); }).join(' ') : '<span class="small">（讀不到）</span>') + '</p>' +
      '<p class="small" style="margin:0">管理員擁有全部頁面，包括這一頁。管理員的 Gmail 是在雲端後端（Apps Script 的 ADMIN_EMAILS_ 設定）裡指定的，不能在這裡修改，這樣名單才不會被誤改而把自己鎖在外面。</p>');
    el.innerHTML = html;
    el.onclick = function (e) {
      var a = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!a) return;
      var act = a.dataset.act, id = a.dataset.id, again = function () { draw(el); };
      if (act === 'new') personDialog(null, again);
      else if (act === 'edit') { var u = find(id); if (u) personDialog(u, again); }
      else if (act === 'toggle') toggle(id, again);
      else if (act === 'del') remove(id, again);
    };
  }

  function render(el) {
    if (!(window.CMSAuth && CMSAuth.enabled)) {
      el.innerHTML = X.ui.banner('warn', '還沒有啟用 Google 登入，所以這裡不能管理人員。啟用方式請見「使用說明」的「Google 登入」一節（需要在 Google Cloud 建一個登入用的用戶端 ID，再把它填進 config.js 與雲端後端）。');
      return;
    }
    if (!X.isAdmin()) { el.innerHTML = X.ui.banner('warn', '這一頁需要管理員身分。'); return; }
    if (cache) draw(el);
    else el.innerHTML = '<p class="small" style="padding:16px">讀取人員名單中…</p>';
    if (loading) return;
    loading = true;
    CMSAuth.api('users').then(function (j) {
      loading = false;
      cache = { users: j.users || [], admins: j.admins || [] };
      if (el.isConnected) draw(el);
    }).catch(function (e) {
      loading = false;
      if (!cache) el.innerHTML = X.ui.banner('warn', '讀不到人員名單：' + esc(e.message) + '。請確認網路，並確認雲端後端已更新成支援 Google 登入的版本。');
    });
  }

  X.registerPage({
    id: 'xUsers', group: 'system', order: 3, stage: 'ready',
    title: '人員與權限', sub: '用 Gmail 新增人員、設定每個人能用哪些頁面',
    icon: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.7-3.2 3-5 6-5s5.3 1.8 6 5"/><path d="M16.5 5.2a3 3 0 0 1 0 5.6M18 14.2c1.8.6 3 2.3 3.4 4.8"/>',
    render: function (el) { render(el); }
  });
})(window.CMSX, window.CMSAccess);

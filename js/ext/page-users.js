/*
 * 人員與權限（xUsers，系統設定，只有管理員密碼能進）
 *  - 新增人員：姓名、登入碼（可留白由系統產生 6 位數字）、勾選能用哪些頁面
 *  - 修改頁面權限、重設登入碼、停用／啟用、刪除
 *  - 資料存在 db.users；登入碼只存雜湊（見 js/access.js），新增或重設後只會顯示一次
 * 這是畫面權限，不是資料安全防護（頁面上的說明也這樣寫）。
 */
(function (X, A) {
  'use strict';
  if (!X || !A) return;

  var esc = X.esc;
  var QUICK_PAGES = ['xQuickEntry', 'xStocktake']; // 「現場人員」組合

  function list() { return X.get('users').filter(function (u) { return u && typeof u === 'object'; }); }
  function sameName(a, b) { return String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); }
  function pageTitle(id) { var p = A.assignablePages().find(function (x) { return x.id === id; }); return p ? p.title : id; }

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

  function personDialog(u) {
    var edit = !!u, hadHash = edit && !!u.hash, pages = A.assignablePages(), groups = [];
    pages.forEach(function (p) { var g = groups.find(function (x) { return x.name === p.group; }); if (!g) groups.push(g = { name: p.group, items: [] }); g.items.push(p); });
    var have = edit && Array.isArray(u.pages) ? u.pages : [];
    var html = '<div class="cms-modal-head"><h3>' + (edit ? '修改人員：' + esc(u.name) : '新增人員') + '</h3></div>' +
      '<div class="x-form">' +
      '<label class="x-field"><span>姓名 <i>*</i></span><input data-f="name" maxlength="30" value="' + esc(edit ? u.name : '') + '" placeholder="例：小美"></label>' +
      '<label class="x-field"><span>登入碼</span><input data-f="code" maxlength="40" autocomplete="off" placeholder="' + (edit ? '留白＝不更改' : '留白＝系統產生 6 位數字') + '"></label></div>' +
      '<p class="small" style="margin:6px 0 12px">登入碼至少 6 個字元。' + (edit ? '填了新的登入碼就等於重設，原本的登入碼立刻失效，這個人在其他裝置也會被登出。' : '建立後只會顯示這一次，請交給本人。') + '</p>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px"><b>可以使用的頁面</b>' +
      '<button type="button" class="btn gray" data-x="p-all" style="min-height:32px;padding:4px 10px">全部勾選</button>' +
      '<button type="button" class="btn gray" data-x="p-quick" style="min-height:32px;padding:4px 10px">現場人員（快速輸入、盤點）</button>' +
      '<button type="button" class="btn gray" data-x="p-none" style="min-height:32px;padding:4px 10px">全部取消</button></div>' +
      '<p class="small" style="margin:0 0 8px">首頁人人都看得到，不用勾選。</p>' +
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
        var err = mask.querySelector('[data-err]'), nm = mask.querySelector('[data-f="name"]').value.trim(), code = mask.querySelector('[data-f="code"]').value.trim();
        var chosen = []; boxes.forEach(function (c) { if (c.checked) chosen.push(c.dataset.pg); });
        err.textContent = '';
        if (!nm) { err.textContent = '請填姓名。'; return; }
        if (list().some(function (x) { return (!edit || x.id !== u.id) && sameName(x.name, nm); })) { err.textContent = '已經有同名的人員，請加上區別（例如姓名＋班別）。'; return; }
        if (code && code.length < 6) { err.textContent = '登入碼至少 6 個字元。'; return; }
        if (!A.canHash()) { err.textContent = '這個網址不支援加密（需要 https），不能設定登入碼。'; return; }
        busy = true; btn.disabled = true;
        var plain = code || (!hadHash ? A.randomCode() : '');
        var make = plain ? A.makeCredential(plain) : Promise.resolve(null);
        make.then(function (cred) {
          var users = X.ensure('users'), now = Date.now(), by = X.userName();
          if (edit) {
            var t = users.find(function (x) { return x.id === u.id; });
            if (!t) throw new Error('這位人員已經被刪除。');
            t.name = nm; t.pages = chosen; t.updatedAt = now; t.updatedBy = by;
            if (cred) { t.salt = cred.salt; t.hash = cred.hash; t.iter = cred.iter; t.sid = X.uid('s'); }
          } else {
            users.push({ id: X.uid('u'), name: nm, active: true, pages: chosen, salt: cred.salt, hash: cred.hash, iter: cred.iter, sid: X.uid('s'), createdAt: now, createdBy: by, updatedAt: now, updatedBy: by });
          }
          if (!X.save()) throw new Error('儲存失敗，請再試一次。');
          A.apply();
          mask.remove();
          if (plain) codeDialog(nm, plain, hadHash);
          else X.toast('已儲存 ' + nm + ' 的設定');
        }).catch(function (e) { busy = false; btn.disabled = false; err.textContent = e.message; });
      }
    });
    setTimeout(function () { var f = document.querySelector('.x-dialog [data-f="name"]'); if (f) f.focus(); }, 30);
  }

  function codeDialog(nm, code, reset) {
    modal('<div class="cms-modal-head"><h3>' + esc(nm) + ' 的登入碼</h3></div>' +
      '<p style="margin:0 0 10px">請把登入碼交給本人。<b>關閉這個視窗後就看不到了</b>（系統只存加密後的結果），忘記時要重設。</p>' +
      '<div class="xu-code">' + esc(code) + '</div>' +
      (reset ? '<p class="small" style="margin:10px 0 0">原本的登入碼已經失效。</p>' : '') +
      '<div class="cms-modal-actions"><button type="button" class="btn gray" data-x="copy">複製登入碼</button><span class="spacer"></span><button type="button" class="btn primary" data-x="done">我已經交給本人了</button></div>',
      function (act, btn, mask) {
        if (act === 'done') mask.remove();
        else if (act === 'copy') {
          var ok = function () { btn.textContent = '已複製'; };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(ok, function () { prompt('請自行複製：', code); });
          else prompt('請自行複製：', code);
        }
      });
  }

  // ---------- 動作 ----------
  function toggle(id) {
    var t = X.ensure('users').find(function (x) { return x.id === id; });
    if (!t) return;
    var on = t.active === false;
    if (!on && !confirm('停用「' + t.name + '」後，這個人會馬上被登出，不能再登入；之後再啟用，也要重新輸入登入碼。確定嗎？')) return;
    t.active = on; t.updatedAt = Date.now(); t.updatedBy = X.userName();
    if (!on) t.sid = X.uid('s'); // 停用時換掉登入世代，之後再啟用，舊裝置也要重新輸入登入碼
    if (X.save()) { A.apply(); X.toast((on ? '已啟用 ' : '已停用 ') + t.name); }
  }
  function remove(id) {
    var users = X.ensure('users'), t = users.find(function (x) { return x.id === id; });
    if (!t || !confirm('確定刪除「' + t.name + '」嗎？刪除後這個人會馬上被登出，要再用就得重新新增。')) return;
    users.splice(users.indexOf(t), 1);
    if (X.save()) { A.apply(); X.toast('已刪除 ' + t.name); }
  }

  // ---------- 畫面 ----------
  function render(el) {
    if (!X.isAdmin()) { el.innerHTML = X.ui.banner('warn', '這一頁需要管理員登入。'); return; }
    var users = list(), active = users.filter(function (u) { return u.active !== false; });
    var all = A.assignablePages();
    var html = X.ui.banner('info', '在這裡新增人員、設定每個人能用哪些頁面。同事按選單左下角的「人員登入」，輸入自己的登入碼後，選單只會出現被開放的頁面；沒登入的人只能看首頁。') +
      X.ui.banner('warn', '這是<b>畫面上的權限</b>，擋的是選單與頁面入口，不是資料防護：知道團隊通行碼又懂技術的人，仍可能讀到全部資料。管理員密碼目前是固定的，知道的人可以看到所有頁面，包括這一頁。');
    html += X.ui.kpis([
      { label: '人員', value: users.length + ' 位', tone: 'info' },
      { label: '啟用中', value: active.length + ' 位', tone: active.length ? 'ok' : 'muted' },
      { label: '可開放的頁面', value: all.length + ' 頁', tone: 'muted', sub: '首頁人人都看得到' }
    ]);
    var cols = [
      { label: '姓名', render: function (u) { return '<b>' + esc(u.name) + '</b>' + (u.hash ? '' : ' ' + X.ui.tag('沒有登入碼', 'warn')); } },
      { label: '狀態', render: function (u) { return u.active === false ? X.ui.tag('已停用', 'muted') : X.ui.tag('啟用中', 'ok'); } },
      { label: '可以使用的頁面', render: function (u) {
        var p = Array.isArray(u.pages) ? u.pages : [];
        if (!p.length) return '<span class="small">只能看首頁</span>';
        return p.slice(0, 6).map(function (id) { return X.ui.tag(pageTitle(id), 'info'); }).join(' ') + (p.length > 6 ? ' <span class="small">等 ' + p.length + ' 頁</span>' : '');
      } },
      { label: '最後修改', render: function (u) { return '<span class="small">' + esc(X.fmtTime(u.updatedAt || u.createdAt)) + (u.updatedBy ? '<br>' + esc(u.updatedBy) : '') + '</span>'; } },
      { label: '', render: function (u) {
        return '<div class="x-row-actions"><button type="button" class="btn primary" data-act="edit" data-id="' + esc(u.id) + '" style="min-height:36px;padding:4px 12px">修改權限／重設登入碼</button>' +
          '<button type="button" class="btn gray" data-act="toggle" data-id="' + esc(u.id) + '" style="min-height:36px;padding:4px 12px">' + (u.active === false ? '啟用' : '停用') + '</button>' +
          '<button type="button" class="btn red" data-act="del" data-id="' + esc(u.id) + '" style="min-height:36px;padding:4px 12px">刪除</button></div>';
      } }
    ];
    html += X.ui.card('人員名單', X.ui.table(cols, users, { empty: '還沒有人員，按右上角「新增人員」建立第一位。' }),
      '<button type="button" class="btn primary" data-act="new" style="min-height:42px">＋ 新增人員</button>');
    html += '<p class="small" style="margin:8px 0 0">登入碼輸錯 5 次會鎖 1 分鐘。人員資料會同步給所有裝置，登入碼只存加密後的結果，管理員也看不到原本的登入碼，忘記時用「修改權限／重設登入碼」重設。</p>';
    el.innerHTML = html;
    el.onclick = function (e) {
      var a = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!a) return;
      var act = a.dataset.act, id = a.dataset.id;
      if (act === 'new') personDialog(null);
      else if (act === 'edit') { var u = list().find(function (x) { return x.id === id; }); if (u) personDialog(u); }
      else if (act === 'toggle') toggle(id);
      else if (act === 'del') remove(id);
    };
  }

  X.registerPage({
    id: 'xUsers', group: 'system', order: 3, stage: 'ready',
    title: '人員與權限', sub: '新增人員、設定每個人能用哪些頁面',
    icon: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.7-3.2 3-5 6-5s5.3 1.8 6 5"/><path d="M16.5 5.2a3 3 0 0 1 0 5.6M18 14.2c1.8.6 3 2.3 3.4 4.8"/>',
    render: function (el) { render(el); }
  });
})(window.CMSX, window.CMSAccess);

/*
 * 現貨同步（xHqStock，系統設定）
 * ---------------------------------------------------------------
 * 首頁禮盒、單條的「現貨」＝入口網站（物管駕駛艙 logistics-console）「總表」的「剩餘庫存 → 現貨」。
 * 那個網站要用 Google 登入，這裡的 App 不能直接去讀，所以用「書籤」一鍵帶過來：
 *   1. 在入口網站登入、打開總表
 *   2. 按一下書籤「同步現貨到包材系統」→ 書籤在入口網站讀取今天的總表（只讀，不會改任何東西），
 *      把各品號的現貨數字放進網址的 # 後面（不會送到任何伺服器），再開啟這個 App
 *   3. App 開啟後（登入後）自動把數字存進 db.hqStock，並同步給所有同事
 * 資料：db.hqStock = { date: 總表日期, updatedAt, updatedBy, source, items: { 品號: 現貨數量 } }
 * 品號對應：禮盒、單條的「品號」要和總表的品號一樣；總表沒有的品號，首頁現貨顯示「—」。
 */
(function (X, root) {
  'use strict';
  if (!X) return;

  var PENDING_KEY = 'cms_hqstock_pending';
  var PORTAL = 'https://cheeseduke.flowings.app/logistics-console';
  var esc = X.esc;

  // ---------- 網址帶來的資料 ----------
  // 越早收起來越好：先存進 sessionStorage 並把網址的 # 清掉（登入畫面或重新載入都不會弄丟）
  (function stash() {
    var h = String(location.hash || '');
    var m = /^#hqstock=([A-Za-z0-9_-]+)$/.exec(h);
    if (!m) return;
    try { sessionStorage.setItem(PENDING_KEY, m[1]); } catch (e) {}
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  })();

  function decode(b64) {
    var s = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return JSON.parse(decodeURIComponent(escape(atob(s))));
  }
  function clean(p) {
    if (!p || typeof p !== 'object' || !p.i || typeof p.i !== 'object') throw new Error('資料格式不對');
    var items = {}, n = 0;
    Object.keys(p.i).slice(0, 3000).forEach(function (k) {
      var v = Number(p.i[k]);
      if (/^[\w.|\-]{1,60}$/.test(k) && Number.isFinite(v) && v >= 0 && v < 1e9) { items[k] = Math.round(v * 100) / 100; n++; }
    });
    if (!n) throw new Error('沒有讀到任何現貨數字');
    var d = /^\d{4}-\d{2}-\d{2}$/.test(String(p.d || '')) ? p.d : '';
    return { date: d, items: items, count: n };
  }

  // 登入並載入完成後由 app-shell 呼叫：有待處理的資料就存進系統
  function applyPending() {
    var raw = null;
    try { raw = sessionStorage.getItem(PENDING_KEY); } catch (e) {}
    if (!raw) return;
    try { sessionStorage.removeItem(PENDING_KEY); } catch (e) {}
    if (!X.isAdmin() && !(root.CMSAccess && CMSAccess.canOpen('xHqStock'))) {
      X.toast('你沒有「現貨同步」的權限，這次的現貨資料沒有存。');
      return;
    }
    try {
      var c = clean(decode(raw));
      var o = X.ensure('hqStock');
      o.date = c.date; o.items = c.items; o.updatedAt = Date.now(); o.updatedBy = X.userName(); o.source = '入口網站總表（剩餘庫存 現貨）';
      if (!X.save()) throw new Error('儲存失敗');
      X.toast('已更新現貨：' + c.count + ' 個品號' + (c.date ? '（總表日期 ' + c.date + '）' : ''));
      if (typeof root.render === 'function') { try { root.render(); } catch (e) {} }
      var cur = document.querySelector('#nav .navbtn[data-page="xHqStock"]');
      if (cur) cur.click();
    } catch (e) {
      X.toast('現貨資料讀取失敗：' + e.message);
    }
  }

  // ---------- 書籤 ----------
  function bookmarklet() {
    var app = location.origin + location.pathname;
    // 日期優先用總表頁面上選的日期（找不到就用今天）；失敗時把網址、狀態與回應內容顯示出來，方便找原因
    var code = "(async()=>{var u='';try{var p=function(n){return String(n).padStart(2,'0')},d=new Date(),ds=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()),pk=document.querySelector('input[type=date]');" +
      "if(pk&&/^\\d{4}-\\d{2}-\\d{2}$/.test(pk.value))ds=pk.value;" +
      "u=location.origin+'/api/internal/logistics-console/hq-ledger?date='+ds;" +
      "var r=await fetch(u,{credentials:'include',headers:{Accept:'application/json'}});" +
      "if(!r.ok){var tx='';try{tx=(await r.text()).slice(0,200)}catch(e){}throw new Error('HTTP '+r.status+'\\n網址：'+u+'\\n回應：'+tx)}" +
      "var j=await r.json(),it={};(j.rows||[]).forEach(function(x){var s=x.row&&x.row.closing&&x.row.closing.stock;if(x.code&&typeof s==='number')it[x.code]=s});" +
      "if(!Object.keys(it).length)throw new Error('總表沒有資料（'+ds+'）');" +
      "var b=btoa(unescape(encodeURIComponent(JSON.stringify({d:j.date||ds,i:it})))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');" +
      "location.href='" + app + "#hqstock='+b}catch(e){alert('讀取總表失敗：'+e.message+'\\n\\n請確認已經登入入口網站，並且在總表頁面按這個書籤')}})()";
    return 'javascript:' + encodeURIComponent(code);
  }

  // ---------- 畫面 ----------
  function stockOf(code) { var o = X.get('hqStock'); return o && o.items && Object.prototype.hasOwnProperty.call(o.items, code) ? o.items[code] : null; }

  function render(el) {
    var o = X.get('hqStock'), has = o && o.items && Object.keys(o.items).length;
    var prods = (X.products ? X.products() : []).filter(function (p) { return p && p.code; });
    var gifts = prods.filter(function (p) { return String(p.category || '').trim() !== '單條'; });
    var singles = prods.filter(function (p) { return String(p.category || '').trim() === '單條'; });
    function tab(list) {
      return X.ui.table([
        { label: '品號', render: function (p) { return esc(p.code); } },
        { label: '品名', render: function (p) { return esc(p.name || ''); } },
        { label: '現貨', render: function (p) { var v = stockOf(p.code); return v == null ? '<span class="small">總表沒有這個品號</span>' : '<b>' + esc(v) + '</b>'; } }
      ], list, { empty: '沒有資料' });
    }
    var html = X.ui.banner('info', '首頁「禮盒品項」「單條內容物」的<b>現貨</b>＝入口網站「總表」的「剩餘庫存 → 現貨」。入口網站要 Google 登入，所以用下面的書籤一鍵帶過來，不用抄數字。');
    html += X.ui.kpis([
      { label: '上次更新', value: has ? X.fmtTime(o.updatedAt) : '還沒同步過', tone: has ? 'ok' : 'warn', sub: has ? (o.updatedBy || '') : '' },
      { label: '總表日期', value: has && o.date ? o.date : '—', tone: 'info' },
      { label: '品號數', value: has ? Object.keys(o.items).length + ' 個' : '0', tone: 'muted' }
    ]);
    html += X.ui.card('怎麼同步現貨',
      '<ol style="margin:0;padding-left:20px;line-height:2">' +
      '<li>第一次：把這顆按鈕<b>拖曳到瀏覽器的書籤列</b>（電腦版 Chrome／Edge 按 Ctrl+Shift+B 可以顯示書籤列）：<br>' +
      '<a class="btn primary" id="xhqBm" style="display:inline-block;margin:6px 0;text-decoration:none;cursor:grab">同步現貨到包材系統</a></li>' +
      '<li>打開<a href="' + PORTAL + '" target="_blank" rel="noopener">入口網站的總表</a>並登入（用 Google 登入），等表格出現。</li>' +
      '<li>按書籤列的「同步現貨到包材系統」→ 會回到這個 App，自動存好並同步給大家，畫面右下角會顯示「已更新現貨」。</li></ol>' +
      '<p class="small" style="margin:8px 0 0">書籤只在入口網站讀取今天總表的現貨數字（只讀，不會改動入口網站的任何資料），數字放在網址 # 後面，不會傳給任何伺服器。現貨是「按書籤當下」的數字，要最新的就再按一次。手機沒有書籤列時，請用電腦操作。</p>');
    html += X.ui.card('禮盒的現貨（' + gifts.length + ' 項）', tab(gifts));
    html += X.ui.card('單條的現貨（' + singles.length + ' 項）', tab(singles));
    el.innerHTML = html;
    var a = el.querySelector('#xhqBm');
    if (a) {
      a.setAttribute('href', bookmarklet());
      a.addEventListener('click', function (e) { e.preventDefault(); X.toast('請把這顆按鈕「拖曳」到書籤列，不是在這裡按。'); });
    }
  }

  X.registerPage({
    id: 'xHqStock', group: 'system', order: 4, stage: 'ready',
    title: '現貨同步', sub: '從入口網站總表帶入禮盒與單條的現貨',
    icon: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
    render: function (el) { render(el); }
  });

  root.CMSHqStock = { applyPending: applyPending, stockOf: stockOf, _clean: clean, _decode: decode };
})(window.CMSX, window);

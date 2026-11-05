/*
 * 從舊版 HTML 檔直接匯入過去訂單
 * 舊版把過去訂單寫死在 HTML 檔裡，開啟時才載入瀏覽器；資料太大時會超過瀏覽器儲存上限而載入失敗，
 * 匯出的 JSON 備份也就不含訂單。這裡直接從舊版 HTML 讀出訂單，照舊版相同的規則組合後加入。
 * 檔案只在這台裝置讀取，不會上傳到網站；加入後的資料會照常同步到雲端。
 */
(function (root) {
  'use strict';

  var NAMES = ['PRELOADED_ORDER_HISTORY', 'PRELOADED_ORDER_HISTORY_JAN2026', 'PRELOADED_ALL_CO_ORDER_HISTORY',
    'ORDER_DEPARTMENT_LOOKUP', 'ORIGINAL_DEPARTMENT_LOOKUP'];

  // 舊版的資料是一行 `const 名稱=[...];`，內容是標準 JSON
  function extract(text, name) {
    var marker = '\nconst ' + name + '=';
    var i = text.indexOf(marker);
    if (i < 0) return null;
    var start = i + marker.length;
    var end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    var lit = text.slice(start, end).trim().replace(/;\s*$/, '');
    try { return JSON.parse(lit); } catch (e) { throw new Error('舊版檔案的 ' + name + ' 格式無法讀取'); }
  }

  function parseOldHtml(text) {
    text = '\n' + String(text).replace(/\r\n?/g, '\n');
    var out = {};
    NAMES.forEach(function (n) { out[n] = extract(text, n); });
    if (!out.PRELOADED_ORDER_HISTORY && !out.PRELOADED_ORDER_HISTORY_JAN2026 && !out.PRELOADED_ALL_CO_ORDER_HISTORY) {
      throw new Error('這個檔案裡找不到過去訂單資料，請確認選的是舊版的「檔期包材管理系統」HTML 檔');
    }
    return out;
  }

  // 照舊版的順序與去重複規則組出完整訂單（ensurePreloaded → ensureJan2026 → ensureAllHistoricalCO → applyOrderDepartments）
  function buildOldOrders(p) {
    var list = (p.PRELOADED_ORDER_HISTORY || []).slice();
    var narrow = function (r) { return [r.date, r.orderNo, r.productCode, r.name, r.customer, r.qty].join('|'); };
    var wide = function (r) { return [r.date, r.orderNo, r.sourceOrderNo, r.productCode, r.name, r.customer, r.channel, r.qty, r.note].join('|'); };
    var keys = new Set(list.map(narrow));
    (p.PRELOADED_ORDER_HISTORY_JAN2026 || []).forEach(function (r) {
      var k = narrow(r);
      if (!keys.has(k)) { list.push(r); keys.add(k); }
    });
    keys = new Set(list.map(wide));
    (p.PRELOADED_ALL_CO_ORDER_HISTORY || []).forEach(function (r) {
      var k = wide(r);
      if (!keys.has(k)) { list.push(r); keys.add(k); }
    });
    return list.map(function (r) { return applyDepartment(Object.assign({}, r), p); });
  }

  function applyDepartment(r, p) {
    var k = [r.date || '', r.orderNo || '', r.sourceOrderNo || '', r.productCode || ''].join('|');
    if (p.ORDER_DEPARTMENT_LOOKUP && p.ORDER_DEPARTMENT_LOOKUP[k]) r.orderDepartment = p.ORDER_DEPARTMENT_LOOKUP[k];
    if (p.ORIGINAL_DEPARTMENT_LOOKUP && p.ORIGINAL_DEPARTMENT_LOOKUP[k]) r.department = p.ORIGINAL_DEPARTMENT_LOOKUP[k];
    return r;
  }

  // 加入目前資料：已有的（同 id）不重複加入，但補上部門資料；手動新增的訂單保留
  function mergeInto(target, p) {
    if (!Array.isArray(target.orderHistory)) target.orderHistory = [];
    var before = target.orderHistory.length;
    var ids = new Set(target.orderHistory.map(function (r) { return String(r.id); }));
    var built = buildOldOrders(p);
    var added = 0;
    built.forEach(function (r) {
      if (ids.has(String(r.id))) return;
      target.orderHistory.push(r);
      ids.add(String(r.id));
      added++;
    });
    target.orderHistory.forEach(function (r) { applyDepartment(r, p); });
    target.orderHistoryImportVersion = target.orderHistoryImportVersion || '2026-10-07-import-1';
    target.orderHistoryImportJan2026 = target.orderHistoryImportJan2026 || '2026-01-v1';
    target.orderHistoryAllCOVersion = target.orderHistoryAllCOVersion || 'ALL-CO-2026-10-07';
    return { before: before, added: added, total: target.orderHistory.length, fromFile: built.length };
  }

  var api = { parseOldHtml: parseOldHtml, buildOldOrders: buildOldOrders, mergeInto: mergeInto };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.CMSOldOrders = api;

  // ---------- 畫面：加在「備份／還原」頁 ----------
  function mountPanel() {
    var page = document.getElementById('backup');
    if (!page || document.getElementById('oldOrdersPanel')) return;
    var panel = document.createElement('div');
    panel.className = 'panel';
    panel.id = 'oldOrdersPanel';
    panel.innerHTML =
      '<h2>從舊版 HTML 匯入過去訂單</h2>' +
      '<p class="small">舊版的過去訂單寫在 HTML 檔裡，匯出的備份檔不一定有。選擇舊版的 HTML 檔，系統會讀出全部過去訂單與部門資料並加入，已經有的不會重複。檔案只在這台裝置讀取，不會上傳到網站。</p>' +
      '<div class="toolbar"><label class="btn primary">選擇舊版 HTML 檔' +
      '<input id="oldOrdersFile" type="file" accept=".html,.htm,text/html" hidden></label></div>' +
      '<div id="oldOrdersMsg" class="small" aria-live="polite"></div>';
    page.appendChild(panel);
    document.getElementById('oldOrdersFile').addEventListener('change', onFile);
  }

  function setMsg(t, ok) {
    var m = document.getElementById('oldOrdersMsg');
    m.textContent = t;
    m.style.color = ok === false ? 'var(--bad)' : ok ? 'var(--ok)' : '';
  }

  function onFile(ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    setMsg('讀取中…');
    var reader = new FileReader();
    reader.onerror = function () { setMsg('無法讀取這個檔案', false); };
    reader.onload = function () {
      var p, d;
      try { p = parseOldHtml(reader.result); } catch (e) { setMsg(e.message, false); return; }
      try { d = db; } catch (e) { setMsg('系統還沒載入完成，請稍後再試', false); return; }
      var preview = buildOldOrders(p).length;
      if (!confirm('在舊版檔案中找到 ' + preview.toLocaleString() + ' 筆過去訂單。\n要加入目前的資料嗎？（已經有的不會重複加入，並會同步給所有同事）')) { setMsg(''); return; }
      var r = mergeInto(d, p);
      try { persist(); } catch (e) { setMsg('儲存失敗：' + e.message, false); return; }
      try { if (typeof refreshOrderYearOptions === 'function') refreshOrderYearOptions(); } catch (e) {}
      try { if (typeof refreshOrderFilterChannelOptions === 'function') refreshOrderFilterChannelOptions(); } catch (e) {}
      setMsg('完成：新增 ' + r.added.toLocaleString() + ' 筆，目前共有 ' + r.total.toLocaleString() + ' 筆過去訂單。請等右上角變成「已同步」再關閉。', true);
      if (root.cmsToast) root.cmsToast('已匯入過去訂單：新增 ' + r.added.toLocaleString() + ' 筆');
    };
    reader.readAsText(f, 'utf-8');
  }

  // ---------- 用交易明細匯入檔「取代」過去訂單 ----------
  // 匯入檔（格式 cms-orders-v1，內容是 orders 陣列：id、date、orderNo、productCode、name、qty、amount、channel、orderDepartment、department…）
  // 選檔後先顯示筆數、日期範圍、金額合計，確認後：① 先下載一份現有過去訂單的備份 ② 刪除全部現有過去訂單 ③ 換成匯入檔的訂單。只有管理員能做。
  var txPending = null;
  function txMsg(t, ok) { var m = document.getElementById('txMsg'); if (!m) return; m.textContent = t; m.style.color = ok === false ? 'var(--bad)' : ok ? 'var(--ok)' : ''; }
  function txFmt(n) { return Number(n).toLocaleString('en-US'); }
  function mountReplacePanel() {
    var page = document.getElementById('backup');
    if (!page || document.getElementById('txReplacePanel')) return;
    var panel = document.createElement('div');
    panel.className = 'panel';
    panel.id = 'txReplacePanel';
    panel.innerHTML = '<h2>用交易明細匯入檔取代過去訂單</h2>' +
      '<p class="small">把交易明細表整理成的匯入檔（.json，含金額）換進來：<b>先下載一份現有過去訂單的備份，再刪除全部現有過去訂單，最後匯入檔裡的訂單</b>，並同步給所有同事。選檔後會先顯示筆數、日期範圍和金額合計，確認才會動資料。只有管理員能用。</p>' +
      '<div class="toolbar"><label class="btn primary">選擇匯入檔（.json）<input id="txFile" type="file" accept=".json,application/json" hidden></label></div>' +
      '<div id="txMsg" class="small" aria-live="polite"></div><div id="txPreview"></div>';
    page.appendChild(panel);
    document.getElementById('txFile').addEventListener('change', onTxFile);
  }
  function onTxFile(ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    txPending = null;
    document.getElementById('txPreview').innerHTML = '';
    if (!f) return;
    if (!(typeof root.adminIsLoggedIn === 'function' && root.adminIsLoggedIn())) { txMsg('只有管理員能取代過去訂單', false); return; }
    txMsg('讀取中…');
    var reader = new FileReader();
    reader.onerror = function () { txMsg('無法讀取這個檔案', false); };
    reader.onload = function () {
      var pkg;
      try { pkg = JSON.parse(reader.result); } catch (e) { txMsg('檔案格式錯誤（不是 JSON）', false); return; }
      if (!pkg || pkg.format !== 'cms-orders-v1' || !Array.isArray(pkg.orders) || !pkg.orders.length) { txMsg('這不是交易明細匯入檔（找不到 cms-orders-v1 的訂單）', false); return; }
      var bad = 0, byMonth = {}, amt = 0, lo = '9999', hi = '0000', ids = {}, dup = 0;
      pkg.orders.forEach(function (o) {
        if (!o || !/^\d{4}-\d{2}-\d{2}$/.test(String(o.date || '')) || !String(o.productCode || '').trim() || !isFinite(Number(o.qty)) || (o.amount != null && !isFinite(Number(o.amount)))) { bad++; return; }
        if (ids[o.id]) dup++; ids[o.id] = 1;
        var m = o.date.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + 1; amt += Number(o.amount) || 0;
        if (o.date < lo) lo = o.date; if (o.date > hi) hi = o.date;
      });
      if (bad || dup) { txMsg('匯入檔有 ' + bad + ' 筆資料不完整、' + dup + ' 筆 id 重複，沒有動任何資料。請重新產生匯入檔。', false); return; }
      var cur = Array.isArray(db.orderHistory) ? db.orderHistory.length : 0;
      txPending = pkg;
      txMsg('');
      document.getElementById('txPreview').innerHTML = '<div class="x-banner x-warn" style="margin:8px 0">' +
        '匯入檔：<b>' + txFmt(pkg.orders.length) + '</b> 筆訂單明細，日期 ' + lo + '～' + hi + '，金額合計 <b>' + txFmt(Math.round(amt)) + '</b>。<br>' +
        '各月筆數：' + Object.keys(byMonth).sort().map(function (m) { return m + '：' + txFmt(byMonth[m]); }).join('、') + '。<br>' +
        '目前系統裡有 <b>' + txFmt(cur) + '</b> 筆過去訂單，<b>確認後會全部刪除</b>（刪除前會先下載備份），換成上面這 ' + txFmt(pkg.orders.length) + ' 筆。' +
        '</div><div class="toolbar"><button type="button" class="btn red" id="txGo">確認：備份後刪除全部，改匯入這份</button> <button type="button" class="btn gray" id="txCancel">取消</button></div>';
      document.getElementById('txCancel').onclick = function () { txPending = null; document.getElementById('txPreview').innerHTML = ''; txMsg('已取消，沒有動任何資料'); };
      document.getElementById('txGo').onclick = doTxReplace;
    };
    reader.readAsText(f, 'utf-8');
  }
  function downloadJson(name, obj) {
    var blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }
  function doTxReplace() {
    var pkg = txPending;
    if (!pkg) return;
    if (!(typeof root.adminIsLoggedIn === 'function' && root.adminIsLoggedIn())) { txMsg('只有管理員能取代過去訂單', false); return; }
    var old = Array.isArray(db.orderHistory) ? db.orderHistory : [];
    if (!confirm('最後確認：會先下載現有 ' + txFmt(old.length) + ' 筆過去訂單的備份，然後全部刪除，改匯入 ' + txFmt(pkg.orders.length) + ' 筆。\n\n要繼續嗎？')) return;
    var stamp = new Date().toISOString().slice(0, 10);
    try { downloadJson('過去訂單_取代前備份_' + stamp + '.json', { orderHistory: old, exportedAt: new Date().toISOString(), note: '用交易明細匯入檔取代之前的備份' }); }
    catch (e) { txMsg('備份下載失敗，沒有動任何資料：' + e.message, false); return; }
    var before = db.orderHistory;
    db.orderHistory = pkg.orders.map(function (o) { return Object.assign({}, o); });
    db.orderHistoryReplacedAt = new Date().toISOString();
    try { persist(); } catch (e) { db.orderHistory = before; txMsg('儲存失敗，已還原原本的過去訂單：' + e.message, false); return; }
    try { if (typeof refreshOrderYearOptions === 'function') refreshOrderYearOptions(); } catch (e) {}
    try { if (typeof refreshOrderFilterChannelOptions === 'function') refreshOrderFilterChannelOptions(); } catch (e) {}
    txPending = null;
    document.getElementById('txPreview').innerHTML = '';
    txMsg('完成：已刪除原本 ' + txFmt(old.length) + ' 筆，匯入 ' + txFmt(pkg.orders.length) + ' 筆過去訂單（含金額）。備份檔已下載，請等右上角變成「已同步」再關閉。', true);
    if (root.cmsToast) root.cmsToast('已取代過去訂單：' + txFmt(pkg.orders.length) + ' 筆');
  }

  // ---------- 保護：「匯入 JSON」不會無聲刪掉過去訂單 ----------
  // 原系統的 importData 會整份取代資料；舊版備份常常沒有過去訂單，直接取代會讓所有人的訂單從雲端消失。
  var ORDER_FLAGS = ['orderHistoryImportVersion', 'orderHistoryImportJan2026', 'orderHistoryAllCOVersion'];
  function guardedImportData(el) {
    var f = el && el.files && el.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var incoming;
      try { incoming = JSON.parse(reader.result); } catch (e) { alert('檔案格式錯誤'); el.value = ''; return; }
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) { alert('檔案格式錯誤'); el.value = ''; return; }
      var current = db;
      var curList = Array.isArray(current.orderHistory) ? current.orderHistory : [];
      var note = '';
      var keepCurrent = false;
      if (curList.length && !Array.isArray(incoming.orderHistory)) {
        keepCurrent = true;
        note = '\n備份裡沒有過去訂單，已保留目前的 ' + curList.length.toLocaleString() + ' 筆過去訂單。';
      } else if (curList.length && incoming.orderHistory.length < curList.length) {
        keepCurrent = !confirm('這份備份只有 ' + incoming.orderHistory.length.toLocaleString() + ' 筆過去訂單，目前有 ' + curList.length.toLocaleString() + ' 筆。\n\n' +
          '按「確定」：用備份取代，過去訂單會變成 ' + incoming.orderHistory.length.toLocaleString() + ' 筆（會同步給所有人）。\n' +
          '按「取消」：保留目前的 ' + curList.length.toLocaleString() + ' 筆過去訂單，其他資料仍照備份還原。');
        if (keepCurrent) note = '\n已保留目前的 ' + curList.length.toLocaleString() + ' 筆過去訂單。';
      }
      if (keepCurrent) {
        incoming.orderHistory = curList;
        ORDER_FLAGS.forEach(function (k) { if (current[k] !== undefined) incoming[k] = current[k]; });
      }
      // 人員與權限只由「人員與權限」頁管理：還原備份不會動到（備份也不含人員），避免舊備份把人員清空或讓已刪除的人員復活
      if (Array.isArray(current.users)) incoming.users = current.users; else delete incoming.users;
      db = incoming;
      try { if (typeof ensureHomeOrder === 'function') ensureHomeOrder(); } catch (e) {}
      persist();
      el.value = '';
      alert('匯入完成' + note);
    };
    reader.readAsText(f);
  }

  // 過去訂單是空的時候，告訴使用者去哪裡匯入
  function emptyOrdersHint() {
    var body = document.getElementById('orderHistoryBody');
    var d; try { d = db; } catch (e) { return; }
    if (!body || (Array.isArray(d.orderHistory) && d.orderHistory.length)) return;
    body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;white-space:normal">' +
      '還沒有過去訂單。舊版的過去訂單寫在舊版 HTML 檔裡，請到「備份／還原」頁，用「從舊版 HTML 匯入過去訂單」加入。' +
      '<div style="margin-top:10px"><button type="button" class="btn primary" id="goOldOrdersImport">前往匯入</button></div></td></tr>';
    document.getElementById('goOldOrdersImport').onclick = function () {
      var b = document.querySelector('#nav .navbtn[data-page="backup"]');
      if (b) b.click();
      setTimeout(function () { var p = document.getElementById('oldOrdersPanel'); if (p) p.scrollIntoView({ behavior: 'smooth' }); }, 50);
    };
  }

  // 原系統的程式由 app-shell 在頁面載入後才載入，完成時會再觸發一次 load 事件；在那之後才包裝它的函式
  function installGuards() {
    if (typeof root.importData === 'function' && !root.importData.__cmsGuarded) {
      guardedImportData.__cmsGuarded = true;
      root.importData = guardedImportData;
    }
    // 匯出備份不含人員（含加密後的登入碼）；清空全部資料時保留人員與權限
    if (typeof root.exportData === 'function' && !root.exportData.__cmsGuarded) {
      var origExport = root.exportData;
      var wrappedExport = function () {
        var u = db.users, had = Object.prototype.hasOwnProperty.call(db, 'users');
        delete db.users;
        try { return origExport.apply(this, arguments); } finally { if (had) db.users = u; }
      };
      wrappedExport.__cmsGuarded = true;
      root.exportData = wrappedExport;
    }
    if (typeof root.wipeAll === 'function' && !root.wipeAll.__cmsGuarded) {
      var origWipe = root.wipeAll;
      var wrappedWipe = function () {
        var keep = Array.isArray(db.users) ? db.users : null, before = db;
        var r = origWipe.apply(this, arguments);
        if (db !== before && keep) { db.users = keep; try { persist(); } catch (e) {} }
        return r;
      };
      wrappedWipe.__cmsGuarded = true;
      root.wipeAll = wrappedWipe;
    }
    if (typeof root.renderOrderHistory === 'function' && !root.renderOrderHistory.__cmsGuarded) {
      var originalRender = root.renderOrderHistory;
      var wrapped = function () { var r = originalRender.apply(this, arguments); emptyOrdersHint(); return r; };
      wrapped.__cmsGuarded = true;
      root.renderOrderHistory = wrapped;
    }
  }
  root.addEventListener('load', installGuards);

  function mountAll() { mountPanel(); mountReplacePanel(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll, { once: true });
  else mountAll();
})(typeof window !== 'undefined' ? window : this);

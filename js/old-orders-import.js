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
    if (typeof root.renderOrderHistory === 'function' && !root.renderOrderHistory.__cmsGuarded) {
      var originalRender = root.renderOrderHistory;
      var wrapped = function () { var r = originalRender.apply(this, arguments); emptyOrdersHint(); return r; };
      wrapped.__cmsGuarded = true;
      root.renderOrderHistory = wrapped;
    }
  }
  root.addEventListener('load', installGuards);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPanel, { once: true });
  else mountPanel();
})(typeof window !== 'undefined' ? window : this);

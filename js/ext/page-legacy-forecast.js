/*
 * 檔期與業績 → 業績預估
 * 沿用原本首頁的「業績預估」表（原系統功能與資料 db.salesForecastV5，完全不變），只是從首頁搬到這一頁。
 * 第一次打開這頁時，把原本的表格搬進來，並拿掉 home-table-panel，讓它不再受首頁分頁切換影響。
 */
(function (X) {
  'use strict';
  if (!X) return;

  // ---------- 鎖定日期與業績異動 ----------
  // db.salesForecastV5.lockDate：今天（含）起預估量不能直接填，改成「業績異動」：挑品項、週、部門，填新的預估量與原因，系統記錄修改前後
  // db.forecastChanges（只增不改）：{ id, seasonId, at, by, kind（'change' 業績異動｜'lock' 鎖定日期設定）, code, name, week（1～5）, range（區間文字）, loc, fromQty, toQty, fromDate, toDate, reason }
  var esc = X.esc;
  function fdb() { return X.db() && X.db().salesForecastV5; }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function mdOf(v) { var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(v || '')); return m ? Number(m[1]) + '/' + Number(m[2]) : ''; }
  function rangeText(r, n) { return r && r.dates && r.dates[n] ? mdOf(r.dates[n]) + (r.ends && r.ends[n] ? '～' + mdOf(r.ends[n]) : '') : '（未填日期）'; }
  // 到貨日期：區間起那一週的星期一往前推一週，再取星期三（1/4～1/11 → 12/30）；和採購叫貨頁同一個算法
  function arrivalOf(start) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(start || ''));
    if (!m) return '';
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]), dow = (new Date(t).getUTCDay() + 6) % 7, d = new Date(t - dow * 86400000 - 7 * 86400000 + 2 * 86400000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function arrivalOfLog(e) { // 異動當時的區間起（新紀錄有存 start；舊紀錄用現在這個品項這一週的區間起）
    var st = e.start; if (!st) { var r = fdb() && fdb().rows && fdb().rows[e.code]; st = r && r.dates && r.dates[X.num(e.week) - 1]; }
    var a = arrivalOf(st); return a ? mdOf(a) + '（三）' : '—';
  }
  function signed(n) { return (n > 0 ? '+' : (n < 0 ? '−' : '')) + X.fmt(Math.abs(n)); }
  function seasonKey() { var a = X.activeSeason(); return a ? a.id : ''; }
  function logs() { var sid = seasonKey(); return X.get('forecastChanges').filter(function (e) { return e && (!e.seasonId || e.seasonId === sid); }).sort(function (a, b) { return X.num(b.at) - X.num(a.at); }); }

  window.renderSfLock = function () {
    var box = document.getElementById('sf-lock-panel'), d = fdb();
    if (!box || !d) return;
    // 「去年業績」「實際」是怎麼算的（說明文字與判別明細）只有管理員看得到
    var adm0 = typeof adminIsLoggedIn === 'function' && adminIsLoggedIn();
    ['sf-lastyear-note', 'sf-actual-detail', 'sf-actual-explain'].forEach(function (id) { var e = document.getElementById(id); if (e) e.style.display = adm0 ? '' : 'none'; });
    var L = d.lockDate || '', locked = typeof sfLocked === 'function' && sfLocked(), isAdm = typeof adminIsLoggedIn === 'function' && adminIsLoggedIn(), left = L ? X.daysBetween(X.today(), L) : 0;
    var pnl = document.querySelector('[data-home-panel="salesForecast"]'); if (pnl) pnl.classList.toggle('sf-locked-mode', !!locked); // 鎖定後整頁改成灰色
    var h = '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 10px"><label style="display:inline-flex;gap:6px;align-items:center;white-space:nowrap"><b>鎖定日期</b><input type="date" id="sf-lock-date" value="' + esc(L) + '"' + (isAdm ? '' : ' disabled') + ' onchange="sfSetLockDate(this.value)"></label>' +
      '<span class="small">' + (!L ? '還沒設定：目前預估量可以直接填。設定後，從那一天（含）起預估量不能直接改，要用「業績異動」。' + (isAdm ? '' : '（只有管理員能設定）') : (locked ? '' : '還有 ' + left + ' 天鎖定，之前可以直接填。') + (isAdm ? '' : '（只有管理員能改）')) + '</span></div>';
    if (locked) h += '<div class="x-banner" style="margin:0 0 10px;background:#ececec;border-color:#bbb;color:#333">預估量已鎖定（' + esc(L) + ' 起）：格子不能直接改，<b>點格子</b>就會出現業績異動，填新的預估量和原因，修改前後會記在下面的「業績異動歷程」。</div>';
    box.innerHTML = h;
  };

  window.sfSetLockDate = function (v) {
    var d = fdb();
    if (!d) return;
    if (!(typeof adminIsLoggedIn === 'function' && adminIsLoggedIn())) { X.toast('只有管理員能設定鎖定日期'); renderSfLock(); return; }
    v = String(v || '').trim();
    if (v === (d.lockDate || '')) return;
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { X.toast('日期格式不對'); renderSfLock(); return; }
    var was = d.lockDate || '';
    if (v && v <= X.today() && !confirm('鎖定日期 ' + v + ' 已經到了，設定後預估量馬上鎖定，要改只能用「業績異動」。確定嗎？')) { renderSfLock(); return; }
    if (!v && was && !confirm('確定取消鎖定嗎？取消後預估量又可以直接填。')) { renderSfLock(); return; }
    d.lockDate = v;
    X.ensure('forecastChanges').push({ id: X.uid('fc'), seasonId: seasonKey(), at: Date.now(), by: X.userName(), kind: 'lock', fromDate: was, toDate: v, reason: v ? '設定鎖定日期' : '取消鎖定' });
    if (typeof scheduleSalesForecastSave === 'function') scheduleSalesForecastSave();
    X.save();
    X.toast(v ? '已設定鎖定日期 ' + v : '已取消鎖定');
    if (typeof renderSalesForecast === 'function') renderSalesForecast();
  };

  window.sfOpenChange = function (el) {
    var d = fdb();
    if (!d || typeof getForecastProducts !== 'function') return;
    var prods = getForecastProducts();
    if (!prods.length) { X.toast('還沒有本期上架的品項'); return; }
    var pre = el && el.dataset ? { code: el.dataset.sfCode, n: Number(el.dataset.sfDate), loc: el.dataset.sfLoc } : {};
    var code0 = pre.code || String(prods[0].code || prods[0].id || ''), n0 = pre.n >= 0 ? pre.n : 0, loc0 = pre.loc || SF_LOCATIONS[0];
    var cur = function (code, n, loc) { var r = sfRow(code); return Number(r.lines[n][loc].est) || 0; };
    var weekOpts = function (code) { var r = sfRow(code); return [0, 1, 2, 3, 4].map(function (n) { return { value: String(n), label: '第 ' + (n + 1) + ' 週　' + rangeText(r, n) }; }); };
    var mask = X.ui.dialog('業績異動', [
      { name: 'code', label: '品項', type: 'select', options: prods.map(function (p) { var c = String(p.code || p.id || ''); return { value: c, label: (c ? c + ' ' : '') + (p.name || '') }; }), value: code0 },
      { name: 'week', label: '週別', type: 'select', options: weekOpts(code0), value: String(n0) },
      { name: 'loc', label: '部門', type: 'select', options: SF_LOCATIONS.map(function (k) { return { value: k, label: SF_LABELS[k] }; }), value: loc0 },
      { name: 'qty', label: '新的預估量', type: 'number', value: cur(code0, n0, loc0), min: 0, step: 'any', required: true },
      { name: 'reason', label: '異動原因（必填，例如：客人加訂、通路追加）', type: 'textarea', value: '', full: true, required: true }
    ], function (f) {
      var nq = f.qty;
      if (nq == null || !(nq >= 0)) { X.toast('請填新的預估量（不能是負數）'); return false; }
      var r = sfRow(f.code), n = Number(f.week), before = cur(f.code, n, f.loc);
      if (nq === before) { X.toast('預估量沒有變'); return false; }
      var p = prods.find(function (x) { return String(x.code || x.id || '') === f.code; });
      r.lines[n][f.loc].est = nq;
      X.ensure('forecastChanges').push({ id: X.uid('fc'), seasonId: seasonKey(), at: Date.now(), by: X.userName(), kind: 'change', code: f.code, name: p ? p.name : '', week: n + 1, start: r.dates[n] || '', range: rangeText(r, n), loc: f.loc, fromQty: before, toQty: nq, reason: f.reason });
      if (typeof recalcSalesForecast === 'function') recalcSalesForecast();
      if (typeof scheduleSalesForecastSave === 'function') scheduleSalesForecastSave();
      X.save();
      X.toast('已記錄業績異動：' + signed(nq - before));
      var a = document.activeElement; if (a && a.blur) a.blur();
      if (typeof renderSalesForecast === 'function') renderSalesForecast();
    }, '儲存異動');
    var info = document.createElement('div');
    info.className = 'x-banner x-info';
    info.style.margin = '0 0 10px';
    mask.querySelector('.x-form').parentNode.insertBefore(info, mask.querySelector('.x-form'));
    var fld = function (k) { return mask.querySelector('[data-field=' + k + ']'); };
    var upd = function () {
      var c = cur(fld('code').value, Number(fld('week').value), fld('loc').value), v = fld('qty').value;
      info.innerHTML = '目前預估量 <b>' + X.fmt(c) + '</b>' + (v !== '' && !isNaN(Number(v)) && Number(v) !== c ? '　→　新 <b>' + X.fmt(Number(v)) + '</b>（<b>' + signed(Number(v) - c) + '</b>）' : '');
    };
    mask.addEventListener('change', function (e) {
      var k = e.target.dataset && e.target.dataset.field;
      if (k === 'code') { var w = fld('week'), sel = w.value; w.innerHTML = weekOpts(fld('code').value).map(function (o) { return '<option value="' + o.value + '"' + (o.value === sel ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join(''); }
      if (k === 'code' || k === 'week' || k === 'loc') fld('qty').value = cur(fld('code').value, Number(fld('week').value), fld('loc').value);
      upd();
    });
    mask.addEventListener('input', function (e) { if (e.target.dataset && e.target.dataset.field === 'qty') upd(); });
    upd();
  };

  window.renderSfChangeLog = function () {
    var box = document.getElementById('sf-change-log');
    if (!box) return;
    var l = logs();
    if (!l.length && !(typeof sfLocked === 'function' && sfLocked())) { box.innerHTML = ''; return; }
    var cols = [
      { label: '時間', render: function (e) { return esc(X.fmtTime(e.at)); } },
      { label: '品項', render: function (e) { return e.kind === 'lock' ? '<span class="small">鎖定日期</span>' : esc((e.code ? e.code + ' ' : '') + (e.name || '')); } },
      { label: '週別', render: function (e) { return e.kind === 'lock' ? '—' : esc('第 ' + e.week + ' 週 ' + (e.range || '')); } },
      { label: '到貨日期', render: function (e) { return e.kind === 'lock' ? '—' : esc(arrivalOfLog(e)); } },
      { label: '部門', render: function (e) { return e.kind === 'lock' ? '—' : esc(SF_LABELS[e.loc] || e.loc || ''); } },
      { label: '修改前', num: true, render: function (e) { return e.kind === 'lock' ? esc(e.fromDate || '（無）') : X.fmt(e.fromQty); } },
      { label: '修改後', num: true, render: function (e) { return e.kind === 'lock' ? esc(e.toDate || '（取消）') : '<b>' + X.fmt(e.toQty) + '</b>'; } },
      { label: '差異', num: true, render: function (e) { if (e.kind === 'lock') return '—'; var df = X.num(e.toQty) - X.num(e.fromQty); return '<b style="color:var(--' + (df < 0 ? 'bad' : 'warn') + ')">' + signed(df) + '</b>'; } },
      { label: '原因', render: function (e) { return '<span class="small">' + esc(e.reason || '') + '</span>'; } },
      { label: '修改人', render: function (e) { return esc(e.by || ''); } }
    ];
    box.innerHTML = X.ui.card('業績異動歷程', X.ui.table(cols, l.slice(0, 100), { empty: '還沒有異動。鎖定後修改預估量，每次都會記在這裡。' }) +
      '<p class="small" style="margin:10px 0 0">只增不改，修改人與時間用當下登入的帳號' + (l.length > 100 ? '；只列最新 100 筆' : '') + '。</p>',
      (typeof adminIsLoggedIn === 'function' && adminIsLoggedIn() && l.length) ? '<button type="button" class="btn red" data-sf-clearlog style="min-height:34px">清除異動紀錄</button>' : '');
    box.onclick = function (e) { if (e.target.closest && e.target.closest('[data-sf-clearlog]')) window.sfClearChangeLog(); };
  };

  // 清除目前檔期的業績異動紀錄（只有管理員；清除前先下載一份備份；清除後不能復原。預估量本身不會變回去，鎖定日期也不變）
  window.sfClearChangeLog = function () {
    if (!(typeof adminIsLoggedIn === 'function' && adminIsLoggedIn())) { X.toast('只有管理員能清除異動紀錄'); return; }
    var sid = seasonKey(), all = X.ensure('forecastChanges'), mine = all.filter(function (e) { return e && (!e.seasonId || e.seasonId === sid); });
    if (!mine.length) { X.toast('沒有異動紀錄可以清除'); return; }
    if (!confirm('要清除目前檔期的 ' + mine.length + ' 筆業績異動紀錄嗎？' + String.fromCharCode(10) + String.fromCharCode(10) + '・清除前會先下載一份備份（請留著）。' + String.fromCharCode(10) + '・清除後不能復原；「採購叫貨」頁的業績異動表也會跟著清空。' + String.fromCharCode(10) + '・預估量不會變回去，鎖定日期也不變。')) return;
    try {
      var blob = new Blob([JSON.stringify({ forecastChanges: mine, exportedAt: new Date().toISOString(), note: '清除前的業績異動紀錄備份' })], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = '業績異動紀錄_清除前備份_' + X.today() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    } catch (e) { X.toast('備份下載失敗，沒有清除：' + e.message); return; }
    var keep = all.filter(function (e) { return mine.indexOf(e) < 0; });
    all.splice(0, all.length);
    keep.forEach(function (e) { all.push(e); });
    X.save();
    X.toast('已清除 ' + mine.length + ' 筆業績異動紀錄');
    if (typeof window.renderSfChangeLog === 'function') window.renderSfChangeLog();
  };

  function legacyPanel() { return document.querySelector('[data-home-panel="salesForecast"]'); }

  X.registerPage({
    id: 'xSalesForecast',
    group: 'season',
    order: 20,
    title: '業績預估',
    sub: '各部門、各品項的預估業績（原本首頁的業績預估）',
    stage: 'ready',
    icon: '<path d="M4 19h16"/><path d="M6 15l4-4 3 3 5-6"/><path d="M15 8h3v3"/>',
    render: function (el) {
      var p = legacyPanel();
      if (!p) { el.innerHTML = X.ui.empty('找不到業績預估表，請重新整理頁面'); return; }
      if (p.parentNode !== el) {
        p.classList.remove('home-table-panel');
        p.classList.add('active');
        el.innerHTML = '';
        el.appendChild(p);
      }
      // 正在輸入預估數字時不重畫，避免手機上輸入框失焦
      var a = document.activeElement;
      if (a && p.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
      try {
        if (typeof renderSalesForecast === 'function') renderSalesForecast();
      } catch (e) {
        console.error('業績預估顯示錯誤', e);
      }
    }
  });
})(window.CMSX);

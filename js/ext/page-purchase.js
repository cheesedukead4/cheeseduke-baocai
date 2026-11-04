/*
 * 採購叫貨（xPurchase，規劃與庫存）
 * ---------------------------------------------------------------
 * 把「業績預估」的禮盒依「禮盒資料」的單條內容物轉成單條，算出每個單條要叫貨多少條：
 *   禮盒要備的盒數 ＝ 業績預估盒數 × 進貨比例（預設 70%，「計算規則」可改；也可以切成全量預估）
 *   單條需求       ＝ 各禮盒要備的盒數 × 該禮盒配方裡這個單條的數量（加總）
 *   建議叫貨       ＝ 單條需求 － 單條現貨（入口網站總表，「現貨同步」帶入）－ 在途（已叫貨、還沒到貨），最少 0
 * 可選「扣除已裝好的禮盒現貨」：禮盒要備的盒數先扣掉總表的禮盒現貨再換算。
 * 叫貨紀錄存在 db.purchaseOrders（陣列，會同步給所有人）：{ id, date, singleId, qty, supplier, status, receivedDate, note, by, at }
 *   status：'ordered' 已叫貨（算在途）｜'received' 已到貨（不算在途；實際庫存仍以總表現貨為準）
 * 只讀「業績預估」「禮盒資料」「總表現貨」，只寫 purchaseOrders。
 */
(function (X) {
  'use strict';
  if (!X) return;
  var esc = X.esc;
  var UI_KEY = 'cms_purchase_ui';
  var st = { basis: 'buy', deduct: false };
  try {
    var sv = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
    if (sv.basis === 'full' || sv.basis === 'buy') st.basis = sv.basis;
    st.deduct = !!sv.deduct;
  } catch (e) {}
  function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify(st)); } catch (e) {} }

  function norm(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, '').toUpperCase(); }
  function isSingle(p) { return String((p && p.category) || '').trim() === '單條'; }
  function label(p) { return (p && p.code ? p.code + ' ' : '') + (p ? p.name : '（已刪除）'); }
  function ratio() { var v = window.CMSRules ? Number(CMSRules.get('purchaseRatio')) : 70; return (v > 0 ? v : 70) / 100; }
  function ceil(v) { return Math.ceil(v - 1e-9); }

  // ---------- 計算 ----------
  function compute() {
    var fb = typeof X.forecastBoxes === 'function' ? X.forecastBoxes() : { byId: {}, any: false, name: '' };
    var byId = {}, singleByName = {}, comps = {};
    X.products().forEach(function (p) {
      if (!p) return;
      byId[String(p.id)] = p;
      if (isSingle(p)) { var n = norm(p.name); if (n && !singleByName[n]) singleByName[n] = p; }
    });
    X.components().forEach(function (c) {
      var s = c && byId[String(c.componentProductId)];
      if (!s) return;
      (comps[String(c.productId)] = comps[String(c.productId)] || []).push({ single: s, qty: X.num(c.qty) });
    });
    var r = ratio(), singles = {}, gifts = [], noComp = [];
    Object.keys(fb.byId).forEach(function (gid) {
      var g = byId[gid], est = fb.byId[gid];
      if (!g || isSingle(g) || !(est > 0)) return;
      var boxes = st.basis === 'buy' ? ceil(est * r) : est;
      var stock = window.CMSStock ? CMSStock.giftStock(gid) : null;
      var use = (st.deduct && stock != null) ? Math.max(0, boxes - Math.max(0, stock)) : boxes;
      var parts = comps[gid];
      if (!parts || !parts.length) {
        var same = (!window.CMSRules || CMSRules.get('singlesSameName')) ? singleByName[norm(g.name)] : null;
        if (same) parts = [{ single: same, qty: 1 }];
      }
      if (!parts || !parts.length) { noComp.push({ gift: g, est: est, boxes: boxes }); return; }
      gifts.push({ gift: g, est: est, boxes: boxes, stock: stock, use: use });
      parts.forEach(function (pt) {
        var k = String(pt.single.id);
        var s = singles[k] || (singles[k] = { p: pt.single, need: 0, from: [] });
        s.need += use * pt.qty;
        s.from.push({ gift: g, boxes: use, per: pt.qty, qty: use * pt.qty });
      });
    });
    var orders = X.get('purchaseOrders').filter(Boolean), transit = {};
    orders.forEach(function (o) { if (o.status !== 'received') transit[String(o.singleId)] = (transit[String(o.singleId)] || 0) + X.num(o.qty); });
    var rows = Object.keys(singles).map(function (k) {
      var s = singles[k], stock = window.CMSStock ? CMSStock.stockByCode(s.p.code) : null, t = transit[k] || 0;
      s.stock = stock; s.transit = t;
      s.suggest = Math.max(0, ceil(s.need - (stock || 0) - t));
      return s;
    });
    // 只有叫貨紀錄、這次預估沒用到的單條，在途也要看得到
    Object.keys(transit).forEach(function (k) {
      if (singles[k] || !byId[k]) return;
      rows.push({ p: byId[k], need: 0, from: [], stock: window.CMSStock ? CMSStock.stockByCode(byId[k].code) : null, transit: transit[k], suggest: 0, extra: true });
    });
    rows.sort(function (a, b) { return (b.suggest - a.suggest) || (b.need - a.need); });
    return { fb: fb, ratio: r, gifts: gifts, noComp: noComp, rows: rows, orders: orders };
  }

  // ---------- 畫面 ----------
  var chip = function (act, id, text, on) {
    return '<button type="button" class="btn ' + (on ? 'primary' : 'gray') + '" data-act="' + act + '" data-v="' + esc(id) + '" aria-pressed="' + (on ? 'true' : 'false') + '" style="min-height:30px;padding:3px 11px;font-size:15px">' + esc(text) + '</button>';
  };
  function stockText(v) { return v == null ? '—' : X.fmt(v); }

  function fromHtml(s) {
    if (!s.from.length) return '';
    return '<details style="margin-top:4px"><summary class="small" style="cursor:pointer">從哪些禮盒來（' + s.from.length + ' 個）</summary><ul class="small" style="margin:4px 0 0;padding-left:18px;line-height:1.7">' +
      s.from.map(function (f) { return '<li>' + esc(label(f.gift)) + '：' + X.fmt(f.boxes, 1) + ' 盒 × ' + X.fmt(f.per, 2) + ' 條 ＝ ' + X.fmt(f.qty, 1) + ' 條</li>'; }).join('') + '</ul></details>';
  }

  function render(el) {
    var c = compute(), pct = Math.round(c.ratio * 100) + '%';
    var html = '<p class="small" style="margin:0 0 12px">把「業績預估」的禮盒，依「禮盒資料」的單條內容物轉成單條，算出每個單條要叫貨幾條；叫貨後在下方記錄，在途的會自動扣掉。這頁只算數字，不會送出任何訂單給廠商。</p>';

    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px"><span class="small" style="min-width:60px;font-weight:700">計算依據</span>' +
      chip('basis', 'buy', '進貨量（預估 × ' + pct + '）', st.basis === 'buy') + chip('basis', 'full', '全量預估（100%）', st.basis === 'full') + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px"><span class="small" style="min-width:60px;font-weight:700">禮盒現貨</span>' +
      chip('deduct', '0', '不扣', !st.deduct) + chip('deduct', '1', '先扣掉已裝好的禮盒現貨', st.deduct) + '</div>';

    if (!c.fb.any) {
      html += X.ui.banner('warn', '「業績預估」頁還沒有填預估盒數（目前檔期：' + esc(c.fb.name || '未命名') + '），算不出單條需求。請先到「業績預估」填預估。') +
        '<div style="margin:8px 0"><button type="button" class="btn primary" data-go="xSalesForecast">到「業績預估」</button></div>';
    }

    var totalSuggest = c.rows.reduce(function (t, s) { return t + s.suggest; }, 0), totalNeed = c.rows.reduce(function (t, s) { return t + s.need; }, 0);
    var totalTransit = c.rows.reduce(function (t, s) { return t + s.transit; }, 0);
    html += X.ui.kpis([
      { label: '預估依據', value: c.fb.name || '業績預估', tone: 'info', sub: (st.basis === 'buy' ? '進貨量＝預估 × ' + pct : '全量預估') + '，共 ' + c.gifts.length + ' 個禮盒' },
      { label: '單條總需求', value: X.fmt(totalNeed) + ' 條', tone: 'muted', sub: c.rows.filter(function (s) { return s.need > 0; }).length + ' 種單條' },
      { label: '在途（已叫貨未到）', value: X.fmt(totalTransit) + ' 條', tone: totalTransit ? 'warn' : 'muted', sub: '到貨後到下方標「已到貨」' },
      { label: '建議再叫貨', value: X.fmt(totalSuggest) + ' 條', tone: totalSuggest ? 'bad' : 'ok', sub: totalSuggest ? '需求 － 現貨 － 在途' : '目前不用再叫' }
    ]);

    if (c.noComp.length) {
      html += X.ui.banner('warn', '這些禮盒有預估，但「禮盒資料」還沒有設單條內容物，沒辦法換算成單條：' + c.noComp.map(function (x) { return esc(label(x.gift)); }).join('、') + '。');
    }

    var cols = [
      { label: '單條', render: function (s) { return '<b>' + esc(label(s.p)) + '</b>' + (s.extra ? ' ' + X.ui.tag('預估沒用到', 'muted') : '') + fromHtml(s); } },
      { label: '需求（條）', num: true, render: function (s) { return s.need ? X.fmt(s.need, 1) : '—'; } },
      { label: '單條現貨', num: true, render: function (s) { return stockText(s.stock); } },
      { label: '在途（條）', num: true, render: function (s) { return s.transit ? X.fmt(s.transit) : '—'; } },
      { label: '建議叫貨（條）', num: true, render: function (s) { return s.suggest ? '<b style="color:var(--bad)">' + X.fmt(s.suggest) + '</b>' : (s.need ? X.ui.tag('夠用', 'ok') : '—'); } },
      { label: '', render: function (s) { return '<button type="button" class="btn ' + (s.suggest ? 'primary' : 'gray') + '" data-act="order" data-id="' + esc(s.p.id) + '" data-qty="' + s.suggest + '" style="min-height:34px;padding:4px 12px;white-space:nowrap">叫貨</button>'; } }
    ];
    html += X.ui.card('禮盒轉單條：建議叫貨', X.ui.table(cols, c.rows, { empty: '還沒有可以換算的單條需求。' }) +
      '<p class="small" style="margin:10px 0 0">單條現貨來自「現貨同步」帶入的入口網站總表（品號要一樣；「—」表示總表沒有這個品號，算 0）。建議叫貨＝需求 － 單條現貨 － 在途，最少 0，無條件進位。按「叫貨」會帶入建議的數量，確認後記成一筆叫貨紀錄。' +
      (st.deduct ? '目前已先扣掉禮盒現貨：禮盒要備的盒數－總表禮盒現貨（最少 0）後才換算。' : '') + '</p>',
      '<button type="button" class="btn gray" data-act="copy" style="min-height:34px">複製叫貨清單</button>');

    // 叫貨紀錄
    var byId = {}; X.products().forEach(function (p) { if (p) byId[String(p.id)] = p; });
    var recs = c.orders.slice().sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')) || (X.num(b.at) - X.num(a.at)); });
    var rcols = [
      { label: '叫貨日期', render: function (o) { return esc(o.date || ''); } },
      { label: '單條', render: function (o) { return esc(label(byId[String(o.singleId)])); } },
      { label: '數量（條）', num: true, render: function (o) { return X.fmt(o.qty); } },
      { label: '廠商', render: function (o) { return esc(o.supplier || ''); } },
      { label: '狀態', render: function (o) { return o.status === 'received' ? X.ui.tag('已到貨' + (o.receivedDate ? ' ' + o.receivedDate : ''), 'ok') : X.ui.tag('在途', 'warn'); } },
      { label: '備註', render: function (o) { return '<span class="small">' + esc(o.note || '') + (o.by ? '　' + esc(o.by) : '') + '</span>'; } },
      { label: '', render: function (o) {
        return '<div class="x-row-actions">' + (o.status === 'received' ? '' : '<button type="button" class="btn gray" data-act="recv" data-id="' + esc(o.id) + '" style="min-height:32px;padding:3px 10px">標已到貨</button>') +
          '<button type="button" class="btn gray" data-act="edit" data-id="' + esc(o.id) + '" style="min-height:32px;padding:3px 10px">編輯</button>' +
          '<button type="button" class="btn red" data-act="del" data-id="' + esc(o.id) + '" style="min-height:32px;padding:3px 10px">刪除</button></div>';
      } }
    ];
    html += X.ui.card('叫貨紀錄', X.ui.table(rcols, recs, { empty: '還沒有叫貨紀錄。按上方表格的「叫貨」，或這裡的「新增叫貨」。' }) +
      '<p class="small" style="margin:10px 0 0">「在途」＝已叫貨、還沒標「已到貨」的數量，會從上面的建議叫貨裡扣掉。標「已到貨」只是記錄；實際庫存仍以入口網站總表同步的現貨為準，到貨後記得同步現貨。</p>',
      '<button type="button" class="btn primary" data-act="new" style="min-height:34px">新增叫貨</button>');

    el.innerHTML = html;
    el.onchange = null;
    el.oninput = null;
    el.onclick = function (e) { onClick(e, el, c); };
  }

  // ---------- 叫貨紀錄 ----------
  function singleOptions() {
    return X.ui.options(X.singles().slice().sort(function (a, b) { return String(a.code || '').localeCompare(String(b.code || ''), 'zh-TW', { numeric: true }); }), 'id', label, '（選擇單條）');
  }
  function orderDialog(rec, preset) {
    var isNew = !rec;
    var v = rec || { date: X.today(), singleId: preset && preset.singleId || '', qty: preset && preset.qty || '', supplier: '', status: 'ordered', note: '' };
    X.ui.dialog(isNew ? '新增叫貨' : '編輯叫貨', [
      { name: 'date', label: '叫貨日期', type: 'date', value: v.date, required: true },
      { name: 'singleId', label: '單條', type: 'select', options: singleOptions(), value: v.singleId, required: true },
      { name: 'qty', label: '數量（條）', type: 'number', value: v.qty, min: 0, step: 'any', required: true },
      { name: 'supplier', label: '廠商', type: 'text', value: v.supplier || '', placeholder: '選填' },
      { name: 'status', label: '狀態', type: 'select', options: [{ value: 'ordered', label: '已叫貨（在途）' }, { value: 'received', label: '已到貨' }], value: v.status },
      { name: 'note', label: '備註', type: 'textarea', value: v.note || '', full: true }
    ], function (f) {
      if (!f.singleId) { X.toast('請選單條'); return false; }
      if (!(f.qty > 0)) { X.toast('數量要大於 0'); return false; }
      var list = X.ensure('purchaseOrders'), o = rec ? list.find(function (x) { return x && x.id === rec.id; }) : null;
      if (rec && !o) { X.toast('找不到這筆紀錄，可能已被刪除'); return false; }
      var received = f.status === 'received';
      if (!o) { o = { id: X.uid('po') }; list.push(o); }
      o.date = f.date; o.singleId = f.singleId; o.qty = f.qty; o.supplier = f.supplier; o.status = f.status; o.note = f.note;
      o.receivedDate = received ? (o.receivedDate || X.today()) : '';
      o.by = X.userName(); o.at = Date.now();
      X.save();
      X.toast(isNew ? '已記錄叫貨' : '已更新叫貨紀錄');
    });
  }

  function copyList(c) {
    var lines = c.rows.filter(function (s) { return s.suggest > 0; }).map(function (s) { return label(s.p) + '　' + X.fmt(s.suggest) + ' 條'; });
    if (!lines.length) { X.toast('目前沒有建議叫貨的單條'); return; }
    var text = '【叫貨清單 ' + X.today() + '】\n' + lines.join('\n');
    var ok = function () { X.toast('已複製叫貨清單（' + lines.length + ' 種）'); };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(ok, function () { window.prompt('複製下面的文字', text); }); return; } } catch (e) {}
    window.prompt('複製下面的文字', text);
  }

  function onClick(e, el, c) {
    var go = e.target.closest ? e.target.closest('[data-go]') : null;
    if (go) { X.goPage(go.dataset.go); return; }
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b) return;
    var a = b.dataset.act, id = b.dataset.id;
    if (a === 'basis') { st.basis = b.dataset.v; saveUi(); render(el); }
    else if (a === 'deduct') { st.deduct = b.dataset.v === '1'; saveUi(); render(el); }
    else if (a === 'order') orderDialog(null, { singleId: id, qty: X.num(b.dataset.qty) || '' });
    else if (a === 'new') orderDialog(null, null);
    else if (a === 'copy') copyList(c);
    else if (a === 'edit') { var o = X.get('purchaseOrders').find(function (x) { return x && x.id === id; }); if (o) orderDialog(o); }
    else if (a === 'recv') {
      var r = X.ensure('purchaseOrders').find(function (x) { return x && x.id === id; });
      if (!r) return;
      r.status = 'received'; r.receivedDate = X.today(); r.by = X.userName(); r.at = Date.now();
      X.save(); X.toast('已標為到貨');
    } else if (a === 'del') {
      var list = X.ensure('purchaseOrders'), i = list.findIndex(function (x) { return x && x.id === id; });
      if (i < 0) return;
      if (!confirm('確定刪除這筆叫貨紀錄嗎？')) return;
      list.splice(i, 1); X.save(); X.toast('已刪除');
    }
  }

  X.registerPage({
    id: 'xPurchase', group: 'plan', order: 20, stage: 'ready',
    title: '採購叫貨', sub: '業績預估的禮盒轉成單條，算出要叫多少貨',
    icon: '<path d="M3 4h2l2.4 11h10.2L20 7H6.2"/><circle cx="9" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/>',
    render: render,
    _fn: { compute: compute }
  });
})(window.CMSX);

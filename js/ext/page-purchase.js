/*
 * 採購叫貨（xPurchase，規劃與庫存）
 * ---------------------------------------------------------------
 * 把「業績預估」的禮盒依「禮盒資料」的單條內容物轉成單條，算出每個單條要叫貨多少條：
 *   禮盒要備的盒數 ＝ 業績預估盒數 × 進貨比例（預設 70%，「計算規則」可改；也可以切成全量預估）
 *   單條需求       ＝ 各禮盒要備的盒數 × 該禮盒配方裡這個單條的數量（加總）
 *   建議叫貨       ＝ 單條需求 － 單條現貨（入口網站總表，「現貨同步」帶入）－ 在途（已叫貨、還沒到貨），最少 0
 * 可選「扣除已裝好的禮盒現貨」：禮盒要備的盒數先扣掉總表的禮盒現貨再換算。
 * 資料（都會同步給所有人）：
 *   db.purchaseOrders 叫貨紀錄：{ id, date, eta（預計到貨日）, singleId, qty, supplierId, supplier（廠商名稱，建檔當下的名字）, status, receivedDate, note, by, at }
 *     status：'ordered' 已叫貨（算在途）｜'received' 已到貨（不算在途；實際庫存仍以總表現貨為準）
 *   db.suppliers 廠商資料表：{ id, name, contact, phone, leadDays（預設交期，天）, singleIds（供應哪些單條）, note, active, by, at }
 * 只讀「業績預估」「禮盒資料」「總表現貨」，只寫 purchaseOrders、suppliers。
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
  function suppliers() { return X.get('suppliers').filter(Boolean); }
  function supplierById(id) { return suppliers().find(function (s) { return s.id === id; }) || null; }
  // 叫貨紀錄的廠商名稱：有建檔的用目前的名字，否則用紀錄裡存的名字
  function supplierName(o) { var s = o.supplierId ? supplierById(o.supplierId) : null; return s ? s.name : (o.supplier || ''); }
  function addDays(date, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    if (!m) return '';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function md(date) { var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(date || '')); return m ? Number(m[1]) + '/' + Number(m[2]) : ''; }

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
    var sup = suppliers();
    // 這個單條平常跟哪個廠商叫貨：廠商資料表裡「供應單條」有勾到它、而且啟用中的第一個
    var supplierOf = function (id) { return sup.find(function (s) { return s.active !== false && Array.isArray(s.singleIds) && s.singleIds.indexOf(String(id)) >= 0; }) || null; };
    var rows = Object.keys(singles).map(function (k) {
      var s = singles[k], stock = window.CMSStock ? CMSStock.stockByCode(s.p.code) : null, t = transit[k] || 0;
      s.stock = stock; s.transit = t;
      s.suggest = Math.max(0, ceil(s.need - (stock || 0) - t));
      s.supplier = supplierOf(k);
      return s;
    });
    // 只有叫貨紀錄、這次預估沒用到的單條，在途也要看得到
    Object.keys(transit).forEach(function (k) {
      if (singles[k] || !byId[k]) return;
      rows.push({ p: byId[k], need: 0, from: [], stock: window.CMSStock ? CMSStock.stockByCode(byId[k].code) : null, transit: transit[k], suggest: 0, extra: true, supplier: supplierOf(k) });
    });
    rows.sort(function (a, b) { return (b.suggest - a.suggest) || (b.need - a.need); });
    return { fb: fb, ratio: r, gifts: gifts, noComp: noComp, rows: rows, orders: orders };
  }

  // ---------- 畫面 ----------
  var chip = function (act, id, text, on) {
    return '<button type="button" class="btn ' + (on ? 'primary' : 'gray') + '" data-act="' + act + '" data-v="' + esc(id) + '" aria-pressed="' + (on ? 'true' : 'false') + '" style="min-height:30px;padding:3px 11px;font-size:15px">' + esc(text) + '</button>';
  };
  function stockText(v) { return v == null ? '—' : X.fmt(v); }
  function rowBtn(act, id, text, cls) { return '<button type="button" class="btn ' + (cls || 'gray') + '" data-act="' + act + '" data-id="' + esc(id) + '" style="min-height:32px;padding:3px 10px;white-space:nowrap">' + text + '</button>'; }

  function fromHtml(s) {
    if (!s.from.length) return '';
    return '<details style="margin-top:4px"><summary class="small" style="cursor:pointer">從哪些禮盒來（' + s.from.length + ' 個）</summary><ul class="small" style="margin:4px 0 0;padding-left:18px;line-height:1.7">' +
      s.from.map(function (f) { return '<li>' + esc(label(f.gift)) + '：' + X.fmt(f.boxes, 1) + ' 盒 × ' + X.fmt(f.per, 2) + ' 條 ＝ ' + X.fmt(f.qty, 1) + ' 條</li>'; }).join('') + '</ul></details>';
  }
  // 預計到貨：在途且已過預計日 → 紅字「逾期 N 天」
  function etaHtml(o) {
    if (o.status === 'received') return o.receivedDate ? '<span class="small">實到 ' + esc(md(o.receivedDate)) + '</span>' : '';
    if (!o.eta) return '<span class="small">未填</span>';
    var late = X.daysBetween(o.eta, X.today());
    return esc(o.eta) + (late > 0 ? ' ' + X.ui.tag('逾期 ' + late + ' 天', 'bad') : (late === 0 ? ' ' + X.ui.tag('今天到', 'warn') : ''));
  }

  function render(el) {
    var c = compute(), pct = Math.round(c.ratio * 100) + '%';
    var html = '<p class="small" style="margin:0 0 12px">把「業績預估」的禮盒，依「禮盒資料」的單條內容物轉成單條，算出每個單條要叫貨幾條；叫貨後在下方記錄（含預計到貨日），在途的會自動扣掉。這頁只算數字，不會送出任何訂單給廠商。</p>';

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
    var pend = c.orders.filter(function (o) { return o.status !== 'received'; });
    var late = pend.filter(function (o) { return o.eta && X.daysBetween(o.eta, X.today()) > 0; }).length;
    var etas = pend.map(function (o) { return o.eta; }).filter(Boolean).sort();
    html += X.ui.kpis([
      { label: '預估依據', value: c.fb.name || '業績預估', tone: 'info', sub: (st.basis === 'buy' ? '進貨量＝預估 × ' + pct : '全量預估') + '，共 ' + c.gifts.length + ' 個禮盒' },
      { label: '單條總需求', value: X.fmt(totalNeed) + ' 條', tone: 'muted', sub: c.rows.filter(function (s) { return s.need > 0; }).length + ' 種單條' },
      { label: '在途（已叫貨未到）', value: X.fmt(totalTransit) + ' 條', tone: late ? 'bad' : (totalTransit ? 'warn' : 'muted'), sub: late ? late + ' 筆已逾預計到貨日' : (etas.length ? '最近預計 ' + md(etas[0]) + ' 到' : '到貨後到下方標「已到貨」') },
      { label: '建議再叫貨', value: X.fmt(totalSuggest) + ' 條', tone: totalSuggest ? 'bad' : 'ok', sub: totalSuggest ? '需求 － 現貨 － 在途' : '目前不用再叫' }
    ]);

    if (c.noComp.length) {
      html += X.ui.banner('warn', '這些禮盒有預估，但「禮盒資料」還沒有設單條內容物，沒辦法換算成單條：' + c.noComp.map(function (x) { return esc(label(x.gift)); }).join('、') + '。');
    }

    var cols = [
      { label: '單條', render: function (s) { return '<b>' + esc(label(s.p)) + '</b>' + (s.extra ? ' ' + X.ui.tag('預估沒用到', 'muted') : '') + fromHtml(s); } },
      { label: '廠商', render: function (s) { return s.supplier ? esc(s.supplier.name) : '<span class="small">未指定</span>'; } },
      { label: '需求（條）', num: true, render: function (s) { return s.need ? X.fmt(s.need, 1) : '—'; } },
      { label: '單條現貨', num: true, render: function (s) { return stockText(s.stock); } },
      { label: '在途（條）', num: true, render: function (s) { return s.transit ? X.fmt(s.transit) : '—'; } },
      { label: '建議叫貨（條）', num: true, render: function (s) { return s.suggest ? '<b style="color:var(--bad)">' + X.fmt(s.suggest) + '</b>' : (s.need ? X.ui.tag('夠用', 'ok') : '—'); } },
      { label: '', render: function (s) { return '<button type="button" class="btn ' + (s.suggest ? 'primary' : 'gray') + '" data-act="order" data-id="' + esc(s.p.id) + '" data-qty="' + s.suggest + '" style="min-height:34px;padding:4px 12px;white-space:nowrap">叫貨</button>'; } }
    ];
    html += X.ui.card('禮盒轉單條：建議叫貨', X.ui.table(cols, c.rows, { empty: '還沒有可以換算的單條需求。' }) +
      '<p class="small" style="margin:10px 0 0">單條現貨來自「現貨同步」帶入的入口網站總表（品號要一樣；「—」表示總表沒有這個品號，算 0）。建議叫貨＝需求 － 單條現貨 － 在途，最少 0，無條件進位。「廠商」是廠商資料表裡有勾「供應單條」的廠商。按「叫貨」會帶入建議的數量、廠商與預計到貨日，確認後記成一筆叫貨紀錄。' +
      (st.deduct ? '目前已先扣掉禮盒現貨：禮盒要備的盒數－總表禮盒現貨（最少 0）後才換算。' : '') + '</p>',
      '<button type="button" class="btn gray" data-act="copy" style="min-height:34px">複製叫貨清單</button>');

    // 叫貨紀錄
    var byId = {}; X.products().forEach(function (p) { if (p) byId[String(p.id)] = p; });
    var recs = c.orders.slice().sort(function (a, b) { return (a.status === 'received') - (b.status === 'received') || (a.status === 'received' ? String(b.date || '').localeCompare(String(a.date || '')) : String(a.eta || '9999').localeCompare(String(b.eta || '9999'))) || (X.num(b.at) - X.num(a.at)); });
    var rcols = [
      { label: '叫貨日期', render: function (o) { return esc(o.date || ''); } },
      { label: '預計到貨', render: etaHtml },
      { label: '單條', render: function (o) { return esc(label(byId[String(o.singleId)])); } },
      { label: '數量（條）', num: true, render: function (o) { return X.fmt(o.qty); } },
      { label: '廠商', render: function (o) { return esc(supplierName(o)); } },
      { label: '狀態', render: function (o) { return o.status === 'received' ? X.ui.tag('已到貨', 'ok') : X.ui.tag('在途', 'warn'); } },
      { label: '備註', render: function (o) { return '<span class="small">' + esc(o.note || '') + (o.by ? '　' + esc(o.by) : '') + '</span>'; } },
      { label: '', render: function (o) {
        return '<div class="x-row-actions">' + (o.status === 'received' ? '' : rowBtn('recv', o.id, '標已到貨')) + rowBtn('edit', o.id, '編輯') + rowBtn('del', o.id, '刪除', 'red') + '</div>';
      } }
    ];
    html += X.ui.card('叫貨紀錄', X.ui.table(rcols, recs, { empty: '還沒有叫貨紀錄。按上方表格的「叫貨」，或這裡的「新增叫貨」。' }) +
      '<p class="small" style="margin:10px 0 0">在途排在最前面，依預計到貨日由近到遠；超過預計到貨日還沒標「已到貨」的會標紅「逾期」。「在途」的數量會從上面的建議叫貨裡扣掉。標「已到貨」只是記錄；實際庫存仍以入口網站總表同步的現貨為準，到貨後記得同步現貨。</p>',
      '<button type="button" class="btn primary" data-act="new" style="min-height:34px">新增叫貨</button>');

    // 廠商資料表
    var sup = suppliers().slice().sort(function (a, b) { return (a.active === false) - (b.active === false) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW'); });
    var scols = [
      { label: '廠商', render: function (s) { return '<b>' + esc(s.name) + '</b>' + (s.active === false ? ' ' + X.ui.tag('停用', 'muted') : ''); } },
      { label: '聯絡人', render: function (s) { return esc(s.contact || ''); } },
      { label: '電話', render: function (s) { return esc(s.phone || ''); } },
      { label: '預設交期', num: true, render: function (s) { return s.leadDays > 0 ? s.leadDays + ' 天' : '—'; } },
      { label: '供應單條', render: function (s) { var l = (s.singleIds || []).map(function (id) { return label(byId[String(id)]); }); return l.length ? '<span class="small">' + esc(l.join('、')) + '</span>' : '<span class="small">未指定</span>'; } },
      { label: '備註', render: function (s) { return '<span class="small">' + esc(s.note || '') + '</span>'; } },
      { label: '', render: function (s) { return '<div class="x-row-actions">' + rowBtn('sedit', s.id, '編輯') + rowBtn('sdel', s.id, '刪除', 'red') + '</div>'; } }
    ];
    html += X.ui.card('廠商資料表', X.ui.table(scols, sup, { empty: '還沒有廠商資料。按「新增廠商」建立。' }) +
      '<p class="small" style="margin:10px 0 0">「預設交期」是這個廠商平常叫貨到到貨要幾天，叫貨時選了廠商會自動算出預計到貨日（可以自己改）。「供應單條」勾了之後，上面建議叫貨的表會顯示這個單條的廠商，叫貨時自動帶入，「複製叫貨清單」也會依廠商分開。停用的廠商不會出現在叫貨的選單，舊紀錄還是看得到名稱。</p>',
      '<button type="button" class="btn primary" data-act="snew" style="min-height:34px">新增廠商</button>');

    el.innerHTML = html;
    el.onchange = null;
    el.oninput = null;
    el.onclick = function (e) { onClick(e, el, c); };
  }

  // ---------- 叫貨紀錄 ----------
  function singleOptions() {
    return X.ui.options(X.singles().slice().sort(function (a, b) { return String(a.code || '').localeCompare(String(b.code || ''), 'zh-TW', { numeric: true }); }), 'id', label, '（選擇單條）');
  }
  function supplierOptions(currentId) {
    var list = suppliers().filter(function (s) { return s.active !== false || s.id === currentId; });
    return [{ value: '', label: '（不指定）' }].concat(list.map(function (s) { return { value: s.id, label: s.name + (s.active === false ? '（停用）' : '') }; }));
  }
  function orderDialog(rec, preset) {
    var isNew = !rec;
    var sid = rec ? (rec.supplierId || '') : (preset && preset.supplierId || '');
    var date = rec ? rec.date : X.today();
    var lead = function (id) { var s = id ? supplierById(id) : null; return s && s.leadDays > 0 ? s.leadDays : 0; };
    var v = rec || { date: date, eta: lead(sid) ? addDays(date, lead(sid)) : '', singleId: preset && preset.singleId || '', qty: preset && preset.qty || '', supplier: '', status: 'ordered', note: '' };
    var mask = X.ui.dialog(isNew ? '新增叫貨' : '編輯叫貨', [
      { name: 'date', label: '叫貨日期', type: 'date', value: v.date, required: true },
      { name: 'singleId', label: '單條', type: 'select', options: singleOptions(), value: v.singleId, required: true },
      { name: 'qty', label: '數量（條）', type: 'number', value: v.qty, min: 0, step: 'any', required: true },
      { name: 'supplierId', label: '廠商', type: 'select', options: supplierOptions(sid), value: sid },
      { name: 'eta', label: '預計到貨日', type: 'date', value: v.eta || '' },
      { name: 'status', label: '狀態', type: 'select', options: [{ value: 'ordered', label: '已叫貨（在途）' }, { value: 'received', label: '已到貨' }], value: v.status },
      { name: 'note', label: '備註', type: 'textarea', value: v.note || '', full: true }
    ], function (f) {
      if (!f.singleId) { X.toast('請選單條'); return false; }
      if (!(f.qty > 0)) { X.toast('數量要大於 0'); return false; }
      if (f.eta && f.eta < f.date) { X.toast('預計到貨日不能早於叫貨日期'); return false; }
      var list = X.ensure('purchaseOrders'), o = rec ? list.find(function (x) { return x && x.id === rec.id; }) : null;
      if (rec && !o) { X.toast('找不到這筆紀錄，可能已被刪除'); return false; }
      var received = f.status === 'received', s = f.supplierId ? supplierById(f.supplierId) : null;
      if (!o) { o = { id: X.uid('po') }; list.push(o); }
      o.date = f.date; o.eta = f.eta; o.singleId = f.singleId; o.qty = f.qty; o.supplierId = f.supplierId; o.supplier = s ? s.name : ''; o.status = f.status; o.note = f.note;
      o.receivedDate = received ? (o.receivedDate || X.today()) : '';
      o.by = X.userName(); o.at = Date.now();
      X.save();
      X.toast(isNew ? '已記錄叫貨' : '已更新叫貨紀錄');
    });
    // 選廠商或改叫貨日期時，預計到貨日自動＝叫貨日期＋廠商預設交期（只在還沒手動改過時換）
    var auto = v.eta || '';
    mask.addEventListener('change', function (e) {
      var k = e.target.dataset && e.target.dataset.field;
      if (k !== 'supplierId' && k !== 'date') return;
      var etaEl = mask.querySelector('[data-field=eta]'), d = mask.querySelector('[data-field=date]').value, n = lead(mask.querySelector('[data-field=supplierId]').value);
      if (!d || !n) return;
      if (etaEl.value === '' || etaEl.value === auto) { auto = addDays(d, n); etaEl.value = auto; }
    });
  }

  // ---------- 廠商資料 ----------
  function supplierDialog(rec) {
    var isNew = !rec, mine = (rec && rec.singleIds) || [];
    var singles = X.singles().slice().sort(function (a, b) { return String(a.code || '').localeCompare(String(b.code || ''), 'zh-TW', { numeric: true }); });
    var fields = [
      { name: 'name', label: '廠商名稱', type: 'text', value: rec ? rec.name : '', required: true },
      { name: 'contact', label: '聯絡人', type: 'text', value: rec ? rec.contact : '' },
      { name: 'phone', label: '電話', type: 'text', value: rec ? rec.phone : '' },
      { name: 'leadDays', label: '預設交期（天）', type: 'number', value: rec && rec.leadDays > 0 ? rec.leadDays : '', min: 0, step: 1, placeholder: '叫貨到到貨幾天，選填' }
    ].concat(singles.map(function (p) { return { name: 'single_' + p.id, label: '供應：' + label(p), type: 'checkbox', value: mine.indexOf(String(p.id)) >= 0 }; }))
      .concat([{ name: 'note', label: '備註', type: 'textarea', value: rec ? rec.note : '', full: true },
        { name: 'active', label: '啟用中（取消勾選＝停用，叫貨選單不再出現）', type: 'checkbox', value: rec ? rec.active !== false : true, full: true }]);
    X.ui.dialog(isNew ? '新增廠商' : '編輯廠商', fields, function (f) {
      var name = String(f.name || '').trim();
      if (!name) { X.toast('請填廠商名稱'); return false; }
      if (f.leadDays != null && f.leadDays < 0) { X.toast('預設交期不能是負數'); return false; }
      var list = X.ensure('suppliers');
      if (list.some(function (x) { return x && x.id !== (rec && rec.id) && String(x.name || '').trim() === name; })) { X.toast('已經有同名的廠商了'); return false; }
      var s = rec ? list.find(function (x) { return x && x.id === rec.id; }) : null;
      if (rec && !s) { X.toast('找不到這個廠商，可能已被刪除'); return false; }
      if (!s) { s = { id: X.uid('sup') }; list.push(s); }
      s.name = name; s.contact = f.contact; s.phone = f.phone; s.leadDays = f.leadDays > 0 ? f.leadDays : 0; s.note = f.note; s.active = !!f.active;
      s.singleIds = singles.filter(function (p) { return f['single_' + p.id]; }).map(function (p) { return String(p.id); });
      s.by = X.userName(); s.at = Date.now();
      // 叫貨紀錄存的廠商名稱跟著更新（紀錄仍用 supplierId 對應）
      X.ensure('purchaseOrders').forEach(function (o) { if (o && o.supplierId === s.id) o.supplier = s.name; });
      X.save();
      X.toast(isNew ? '已新增廠商' : '已更新廠商');
    });
  }

  function copyList(c) {
    var groups = {}, order = [];
    c.rows.filter(function (s) { return s.suggest > 0; }).forEach(function (s) {
      var g = s.supplier ? s.supplier.name : '未指定廠商';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(label(s.p) + '　' + X.fmt(s.suggest) + ' 條');
    });
    if (!order.length) { X.toast('目前沒有建議叫貨的單條'); return; }
    var text = '【叫貨清單 ' + X.today() + '】\n' + order.map(function (g) { return '■ ' + g + '\n' + groups[g].join('\n'); }).join('\n\n');
    var ok = function () { X.toast('已複製叫貨清單'); };
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
    else if (a === 'order') {
      var row = c.rows.find(function (s) { return String(s.p.id) === id; });
      orderDialog(null, { singleId: id, qty: X.num(b.dataset.qty) || '', supplierId: row && row.supplier ? row.supplier.id : '' });
    }
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
    else if (a === 'snew') supplierDialog(null);
    else if (a === 'sedit') { var s = supplierById(id); if (s) supplierDialog(s); }
    else if (a === 'sdel') {
      var sl = X.ensure('suppliers'), j = sl.findIndex(function (x) { return x && x.id === id; });
      if (j < 0) return;
      var used = X.get('purchaseOrders').filter(function (x) { return x && x.supplierId === id; }).length;
      if (!confirm('確定刪除廠商「' + sl[j].name + '」嗎？' + (used ? '\n有 ' + used + ' 筆叫貨紀錄用過它，紀錄會保留廠商名稱。' : ''))) return;
      sl.splice(j, 1); X.save(); X.toast('已刪除廠商');
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

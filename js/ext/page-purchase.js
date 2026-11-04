/*
 * 採購叫貨（xPurchase，規劃與庫存）
 * ---------------------------------------------------------------
 * 廠商進貨是以「禮盒」為單位，所以這頁以禮盒統計；單條（單賣）也列入預估量，另外以條統計。
 *   進貨比例：費雪 70%、蛋捲 100%（預估多少就下單多少），「計算規則」可改；名稱有「蛋捲」的禮盒、單條用蛋捲比例，其他用費雪比例
 *   目標叫貨量 ＝ 業績預估量（所有部門、所有日期）× 進貨比例，每個品項各自無條件進位（禮盒是盒、單條是條）
 *   建議再叫貨 ＝ 目標 － 已叫貨（這個檔期叫貨紀錄的已叫貨＋已到貨），最少 0；可選「先扣掉現貨」（入口網站總表的現貨，「入口網站同步」帶入）
 * 單條整合在同一張表：每個禮盒那一列後面直接多一欄「轉換單條」（目標盒數 × 單條內容物＝要幾條）；
 *   單條單賣的預估量（和禮盒一樣在「業績預估」頁填）列在禮盒後面，用同樣的欄位算目標、已叫貨、建議再叫。每列最前面是「預估單日期」（業績預估頁有填預估的日期）。
 * 資料（都會同步給所有人）：
 *   db.purchaseOrders 叫貨紀錄：{ id, seasonId（叫貨當時進行中的檔期）, date, eta（預計到貨日）, productId（禮盒或單條 id；舊紀錄叫 singleId＝單條）, qty（禮盒是盒、單條是條）,
 *     supplierId, supplier（廠商名稱）, status, receivedDate, note, by, at }
 *     status：'ordered' 已叫貨（算在途）｜'received' 已到貨（不算在途；實際庫存仍以總表現貨為準）
 *   db.suppliers 廠商資料表：{ id, name, contact, phone, leadDays（預設交期，天）, productIds（供應哪些禮盒、單條；舊資料叫 singleIds）, note, active, by, at }
 * 只讀「業績預估」「禮盒資料」「總表現貨」，只寫 purchaseOrders、suppliers。
 */
(function (X) {
  'use strict';
  if (!X) return;
  var esc = X.esc;
  var UI_KEY = 'cms_purchase_ui';
  var st = { deduct: false };
  try { st.deduct = !!JSON.parse(localStorage.getItem(UI_KEY) || '{}').deduct; } catch (e) {}
  function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify(st)); } catch (e) {} }

  function norm(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, '').toUpperCase(); }
  function isSingle(p) { return String((p && p.category) || '').trim() === '單條'; }
  function label(p) { return (p && p.code ? p.code + ' ' : '') + (p ? p.name : '（已刪除）'); }
  function suppliers() { return X.get('suppliers').filter(Boolean); }
  function supplierById(id) { return suppliers().find(function (s) { return s.id === id; }) || null; }
  function supplierName(o) { var s = o.supplierId ? supplierById(o.supplierId) : null; return s ? s.name : (o.supplier || ''); }
  function recProduct(o) { return String(o.productId || o.singleId || ''); }
  function addDays(date, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    if (!m) return '';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function md(date) { var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(date || '')); return m ? Number(m[1]) + '/' + Number(m[2]) : ''; }
  var SPEC = { box5: '5入費雪', box8: '8入費雪', egg10: '蛋捲10入', other: '其他禮盒', single: '單條（單賣）' };
  var SPEC_ORDER = ['box5', 'box8', 'egg10', 'other', 'single'];

  // ---------- 計算 ----------
  function compute() {
    var fb = typeof X.forecastBoxes === 'function' ? X.forecastBoxes() : { byId: {}, any: false, name: '' };
    var act = X.activeSeason(), actId = act ? act.id : '';
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
    var orders = X.get('purchaseOrders').filter(Boolean), ordered = {}, transit = {};
    orders.forEach(function (o) {
      var pid = recProduct(o), q = X.num(o.qty);
      if (!(q > 0)) return;
      if (!o.seasonId || o.seasonId === actId) ordered[pid] = (ordered[pid] || 0) + q; // 這個檔期叫的（已叫貨＋已到貨）
      if (o.status !== 'received') transit[pid] = (transit[pid] || 0) + q; // 還沒到的
    });
    var sup = suppliers();
    var supplierOf = function (pid) {
      return sup.find(function (s) { return s.active !== false && ((s.productIds || []).indexOf(String(pid)) >= 0 || (s.singleIds || []).indexOf(String(pid)) >= 0); }) || null;
    };
    var ids = {};
    Object.keys(fb.byId).concat(Object.keys(ordered)).forEach(function (k) { ids[k] = true; });
    var rows = [];
    Object.keys(ids).forEach(function (pid) {
      var p = byId[pid];
      if (!p || isSingle(p)) return; // 單條在下面「轉換單條」另外算
      var est = fb.byId[pid] || 0, single = false;
      var ratio = X.giftRatio(p), target = est > 0 ? X.buyBoxes(p, est) : 0;
      var stock = window.CMSStock ? (single ? CMSStock.stockByCode(p.code) : CMSStock.giftStock(pid)) : null;
      var aim = (st.deduct && stock != null) ? Math.max(0, target - Math.max(0, stock)) : target;
      var ord = ordered[pid] || 0;
      rows.push({
        p: p, id: pid, single: single, egg: X.isEggGift(p), spec: single ? 'single' : (X.giftGroupKey(p) || 'other'), est: est, ratio: ratio, target: target, stock: stock, aim: aim,
        ordered: ord, transit: transit[pid] || 0, remaining: Math.max(0, aim - ord), supplier: supplierOf(pid), extra: !(est > 0), dates: fb.dates[pid] || []
      });
    });
    rows.sort(function (a, b) { return (b.remaining - a.remaining) || (b.est - a.est); });
    var gifts = rows;
    // 每個禮盒的「轉換單條」：目標叫貨盒數 × 單條內容物（直接加在禮盒那一列）
    gifts.forEach(function (r) {
      r.conv = [];
      if (!(r.aim > 0)) return;
      var parts = comps[r.id];
      if (!parts || !parts.length) {
        var same = (!window.CMSRules || CMSRules.get('singlesSameName')) ? singleByName[norm(r.p.name)] : null;
        if (same) parts = [{ single: same, qty: 1 }];
      }
      if (!parts || !parts.length) { r.noComp = true; return; }
      parts.forEach(function (pt) { r.conv.push({ p: pt.single, n: r.aim * pt.qty }); });
    });
    // 單條單賣：本期上架的單條都列出來，預估量與預估單日期直接在表裡填
    var sids = {};
    X.products().forEach(function (p) { if (p && isSingle(p) && p.isListedCurrent === true) sids[String(p.id)] = true; });
    Object.keys(ordered).forEach(function (k) { if (byId[k] && isSingle(byId[k])) sids[k] = true; });
    Object.keys(fb.byId).forEach(function (k) { if (byId[k] && isSingle(byId[k])) sids[k] = true; });
    var singles = Object.keys(sids).map(function (id) {
      var p = byId[id];
      var est = fb.byId[id] || 0, dts = fb.dates[id] || [];
      var ratio = X.giftRatio(p), target = est > 0 ? X.buyBoxes(p, est) : 0;
      var stock = window.CMSStock ? CMSStock.stockByCode(p.code) : null;
      var aim = (st.deduct && stock != null) ? Math.max(0, target - Math.max(0, stock)) : target, ord = ordered[id] || 0;
      return { p: p, id: id, single: true, egg: X.isEggGift(p), spec: 'single', est: est, dates: dts, ratio: ratio, target: target, need: target, stock: stock, aim: aim,
        ordered: ord, transit: transit[id] || 0, remaining: Math.max(0, aim - ord), supplier: supplierOf(id), conv: [] };
    }).sort(function (a, b) { return (b.remaining - a.remaining) || (b.est - a.est) || String(a.p.code || '').localeCompare(String(b.p.code || ''), 'zh-TW', { numeric: true }); });
    rows = gifts.concat(singles);
    // 統計：依規格（5 入、8 入、蛋捲 10 入、其他禮盒、單條）
    var stats = {};
    rows.forEach(function (r) {
      var g = stats[r.spec] || (stats[r.spec] = { key: r.spec, est: 0, target: 0, aim: 0, ordered: 0, transit: 0, remaining: 0, n: 0 });
      g.est += r.est; g.target += r.single ? r.need : r.target; g.aim += r.aim; g.ordered += r.ordered; g.transit += r.transit; g.remaining += r.remaining; g.n++;
    });
    return { fb: fb, gifts: gifts, singles: singles, rows: rows, orders: orders,
      stats: SPEC_ORDER.filter(function (k) { return stats[k]; }).map(function (k) { return stats[k]; }),
      noComp: gifts.filter(function (r) { return r.noComp; }) };
  }

  // ---------- 畫面 ----------
  var chip = function (act, id, text, on) {
    return '<button type="button" class="btn ' + (on ? 'primary' : 'gray') + '" data-act="' + act + '" data-v="' + esc(id) + '" aria-pressed="' + (on ? 'true' : 'false') + '" style="min-height:30px;padding:3px 11px;font-size:15px">' + esc(text) + '</button>';
  };
  function stockText(v) { return v == null ? '—' : X.fmt(v); }
  function rowBtn(act, id, text, cls) { return '<button type="button" class="btn ' + (cls || 'gray') + '" data-act="' + act + '" data-id="' + esc(id) + '" style="min-height:32px;padding:3px 10px;white-space:nowrap">' + text + '</button>'; }
  function pctText(r) { return Math.round(r.ratio * 100) + '%'; }

  function etaHtml(o) {
    if (o.status === 'received') return o.receivedDate ? '<span class="small">實到 ' + esc(md(o.receivedDate)) + '</span>' : '';
    if (!o.eta) return '<span class="small">未填</span>';
    var late = X.daysBetween(o.eta, X.today());
    return esc(o.eta) + (late > 0 ? ' ' + X.ui.tag('逾期 ' + late + ' 天', 'bad') : (late === 0 ? ' ' + X.ui.tag('今天到', 'warn') : ''));
  }
  function datesText(r) { return r.dates && r.dates.length ? esc(r.dates.map(md).join('、')) : '<span class="small">未填日期</span>'; }
  function render(el) {
    var c = compute(), ratioTxt = X.giftRatioText();
    var html = '<p class="small" style="margin:0 0 12px">廠商是以<b>禮盒</b>進貨，所以這頁以<b>禮盒</b>為主，每個禮盒那一列直接帶出<b>轉換單條</b>的條數：<b>費雪禮盒叫預估的 70%、蛋捲禮盒預估多少就叫多少</b>（比例在「計算規則」可改，目前：' + esc(ratioTxt) + '）；單條單賣的預估量和禮盒一樣在「業績預估」頁填（列在禮盒後面），每列前面是預估單日期。叫貨後在下方記錄（含預計到貨日），已叫的會自動扣掉。這頁只算數字，不會送出任何訂單給廠商。</p>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px"><span class="small" style="min-width:60px;font-weight:700">現貨</span>' +
      chip('deduct', '0', '不扣', !st.deduct) + chip('deduct', '1', '先扣掉總表現貨', st.deduct) + '</div>';

    if (!c.fb.any) {
      html += X.ui.banner('warn', '「業績預估」頁還沒有填預估量（目前檔期：' + esc(c.fb.name || '未命名') + '），算不出要叫多少貨。禮盒和單條的預估量都到「業績預估」頁填。') +
        '<div style="margin:8px 0"><button type="button" class="btn primary" data-go="xSalesForecast">到「業績預估」</button></div>';
    }

    var sum = function (list, k) { return list.reduce(function (t, r) { return t + r[k]; }, 0); };
    var fee = c.gifts.filter(function (r) { return !r.egg; }), egg = c.gifts.filter(function (r) { return r.egg; });
    var pend = c.orders.filter(function (o) { return o.status !== 'received'; });
    var late = pend.filter(function (o) { return o.eta && X.daysBetween(o.eta, X.today()) > 0; }).length;
    var etas = pend.map(function (o) { return o.eta; }).filter(Boolean).sort();
    var tBox = 0, tOne = 0;
    pend.forEach(function (o) { var p = X.productById(recProduct(o)); if (p && isSingle(p)) tOne += X.num(o.qty); else tBox += X.num(o.qty); });
    html += X.ui.kpis([
      { label: '費雪禮盒：建議再叫', value: X.fmt(sum(fee, 'remaining')) + ' 盒', tone: sum(fee, 'remaining') ? 'bad' : 'ok', sub: '預估 ' + X.fmt(sum(fee, 'est')) + ' 盒 → 目標 ' + X.fmt(sum(fee, 'target')) + ' 盒，已叫 ' + X.fmt(sum(fee, 'ordered')) + ' 盒' },
      { label: '蛋捲禮盒：建議再叫', value: X.fmt(sum(egg, 'remaining')) + ' 盒', tone: sum(egg, 'remaining') ? 'bad' : 'ok', sub: '預估 ' + X.fmt(sum(egg, 'est')) + ' 盒 → 目標 ' + X.fmt(sum(egg, 'target')) + ' 盒，已叫 ' + X.fmt(sum(egg, 'ordered')) + ' 盒' },
      { label: '單條（單賣）：建議再叫', value: X.fmt(sum(c.singles, 'remaining')) + ' 條', tone: sum(c.singles, 'remaining') ? 'bad' : 'ok', sub: '預估 ' + X.fmt(sum(c.singles, 'est')) + ' 條 → 目標 ' + X.fmt(sum(c.singles, 'target')) + ' 條' },
      { label: '在途（已叫貨未到）', value: X.fmt(tBox) + ' 盒' + (tOne ? ' ＋ ' + X.fmt(tOne) + ' 條' : ''), tone: late ? 'bad' : (pend.length ? 'warn' : 'muted'), sub: late ? late + ' 筆已逾預計到貨日' : (etas.length ? '最近預計 ' + md(etas[0]) + ' 到' : '到貨後到下方標「已到貨」') }
    ]);

    if (c.noComp.length) {
      html += X.ui.banner('warn', '這些禮盒還沒有設單條內容物，「換算成單條」沒辦法算它們：' + c.noComp.map(function (r) { return esc(label(r.p)); }).join('、') + '。（叫貨盒數不受影響）');
    }

    // 統計：依規格
    var scols = [
      { label: '規格', render: function (g) { return '<b>' + SPEC[g.key] + '</b> <span class="small">' + g.n + ' 項</span>'; } },
      { label: '業績預估（單條＝單賣預估）', num: true, render: function (g) { return X.fmt(g.est) + (g.key === 'single' ? ' 條' : ' 盒'); } },
      { label: '目標叫貨（單條＝合計需求）', num: true, render: function (g) { return '<b>' + X.fmt(g.target) + '</b>' + (g.key === 'single' ? ' 條' : ' 盒'); } },
      { label: '已叫貨', num: true, render: function (g) { return X.fmt(g.ordered); } },
      { label: '在途', num: true, render: function (g) { return g.transit ? X.fmt(g.transit) : '—'; } },
      { label: '建議再叫', num: true, render: function (g) { return g.remaining ? '<b style="color:var(--bad)">' + X.fmt(g.remaining) + '</b>' : X.ui.tag('已叫足', 'ok'); } }
    ];
    var totalGift = c.stats.filter(function (g) { return g.key !== 'single'; }).reduce(function (t, g) { return { est: t.est + g.est, target: t.target + g.target, ordered: t.ordered + g.ordered, transit: t.transit + g.transit, remaining: t.remaining + g.remaining }; }, { est: 0, target: 0, ordered: 0, transit: 0, remaining: 0 });
    html += X.ui.card('叫貨盒數統計（禮盒以盒、單條以條）', X.ui.table(scols, c.stats, { empty: '還沒有預估量。' }) +
      '<p class="small" style="margin:10px 0 0"><b>禮盒合計：預估 ' + X.fmt(totalGift.est) + ' 盒 → 目標叫貨 ' + X.fmt(totalGift.target) + ' 盒</b>，已叫 ' + X.fmt(totalGift.ordered) + ' 盒（在途 ' + X.fmt(totalGift.transit) + ' 盒），建議再叫 ' + X.fmt(totalGift.remaining) + ' 盒。費雪禮盒目標＝預估 × ' + Math.round(X.giftRatio({ name: '' }) * 100) + '%、蛋捲禮盒目標＝預估 × ' + Math.round(X.giftRatio({ name: '蛋捲' }) * 100) + '%，每個禮盒各自無條件進位後再加總。</p>',
      '<button type="button" class="btn gray" data-act="copy" style="min-height:34px">複製叫貨清單</button>');

    var convText = function (r) {
      if (r.single) return '<span class="small">—</span>';
      if (r.noComp) return X.ui.tag('沒設單條內容物', 'warn');
      return r.conv.length ? r.conv.map(function (x) { return esc(x.p.name) + ' <b>' + X.fmt(x.n, 1) + '</b> 條'; }).join('<br>') : '<span class="small">—</span>';
    };
    var cols = [
      { label: '預估單日期', render: datesText },
      { label: '品項', render: function (r) { return '<b>' + esc(label(r.p)) + '</b> <span class="small">' + (r.single ? '單條' : (r.egg ? '蛋捲' : '費雪')) + '</span>' + (r.extra ? ' ' + X.ui.tag('預估沒填', 'muted') : ''); } },
      { label: '單位', render: function (r) { return r.single ? '條' : '盒'; } },
      { label: '廠商', render: function (r) { return r.supplier ? esc(r.supplier.name) : '<span class="small">未指定</span>'; } },
      { label: '業績預估', num: true, render: function (r) { return r.est > 0 ? X.fmt(r.est) : '—'; } },
      { label: '進貨比例', num: true, render: function (r) { return r.est > 0 ? pctText(r) : '—'; } },
      { label: '目標叫貨', num: true, render: function (r) { return r.est > 0 ? '<b>' + X.fmt(r.target) + '</b>' : '—'; } },
      { label: '轉換單條（目標 × 單條內容物）', render: convText },
      { label: '現貨', num: true, render: function (r) { return stockText(r.stock); } },
      { label: '已叫貨', num: true, render: function (r) { return r.ordered ? X.fmt(r.ordered) : '—'; } },
      { label: '在途', num: true, render: function (r) { return r.transit ? X.fmt(r.transit) : '—'; } },
      { label: '建議再叫', num: true, render: function (r) { return r.remaining ? '<b style="color:var(--bad)">' + X.fmt(r.remaining) + '</b>' : (r.aim > 0 ? X.ui.tag('已叫足', 'ok') : '—'); } },
      { label: '', render: function (r) { return '<button type="button" class="btn ' + (r.remaining ? 'primary' : 'gray') + '" data-act="order" data-id="' + esc(r.id) + '" data-qty="' + r.remaining + '" style="min-height:34px;padding:4px 12px;white-space:nowrap">叫貨</button>'; } }
    ];
    html += X.ui.card('禮盒（含轉換單條）', X.ui.table(cols, c.gifts.concat(c.singles), { empty: '業績預估還沒有填禮盒的預估盒數。' }) +
      '<p class="small" style="margin:10px 0 0">「預估單日期」是「業績預估」頁這個品項有填預估的日期。目標叫貨＝預估 × 進貨比例（費雪 70%、蛋捲 100%，各自無條件進位）。<b>轉換單條</b>＝這個禮盒的目標盒數 × 單條內容物，直接列在禮盒那一列。<b>單條單賣（列在禮盒後面，單位是條）</b>的預估量和禮盒一樣在「業績預估」頁填（本期上架的單條會列在禮盒後面）。已叫貨＝這個檔期叫貨紀錄的已叫貨＋已到貨；建議再叫＝目標 － 已叫貨（最少 0）' + (st.deduct ? '；目前已先扣掉總表現貨' : '') + '。現貨來自「入口網站同步」帶入的總表（「—」表示總表沒有這個品號）。按「叫貨」會帶入建議的數量、廠商與預計到貨日。</p>');

    // 叫貨紀錄
    var byId = {}; X.products().forEach(function (p) { if (p) byId[String(p.id)] = p; });
    var recs = c.orders.slice().sort(function (a, b) { return (a.status === 'received') - (b.status === 'received') || (a.status === 'received' ? String(b.date || '').localeCompare(String(a.date || '')) : String(a.eta || '9999').localeCompare(String(b.eta || '9999'))) || (X.num(b.at) - X.num(a.at)); });
    var rcols = [
      { label: '叫貨日期', render: function (o) { return esc(o.date || ''); } },
      { label: '預計到貨', render: etaHtml },
      { label: '品項', render: function (o) { var p = byId[recProduct(o)]; return esc(label(p)) + ' <span class="small">' + (p && isSingle(p) ? '單條' : '禮盒') + '</span>'; } },
      { label: '數量', num: true, render: function (o) { var p = byId[recProduct(o)]; return X.fmt(o.qty) + (p && isSingle(p) ? ' 條' : ' 盒'); } },
      { label: '廠商', render: function (o) { return esc(supplierName(o)); } },
      { label: '狀態', render: function (o) { return o.status === 'received' ? X.ui.tag('已到貨', 'ok') : X.ui.tag('在途', 'warn'); } },
      { label: '備註', render: function (o) { return '<span class="small">' + esc(o.note || '') + (o.by ? '　' + esc(o.by) : '') + '</span>'; } },
      { label: '', render: function (o) {
        return '<div class="x-row-actions">' + (o.status === 'received' ? '' : rowBtn('recv', o.id, '標已到貨')) + rowBtn('edit', o.id, '編輯') + rowBtn('del', o.id, '刪除', 'red') + '</div>';
      } }
    ];
    html += X.ui.card('叫貨紀錄', X.ui.table(rcols, recs, { empty: '還沒有叫貨紀錄。按上方表格的「叫貨」，或這裡的「新增叫貨」。' }) +
      '<p class="small" style="margin:10px 0 0">在途排在最前面，依預計到貨日由近到遠；超過預計到貨日還沒標「已到貨」的會標紅「逾期」。叫貨盒數會從上面的建議再叫裡扣掉，標「已到貨」只是記錄；實際庫存仍以入口網站總表同步的現貨為準，到貨後記得同步現貨。</p>',
      '<button type="button" class="btn primary" data-act="new" style="min-height:34px">新增叫貨</button>');

    // 廠商資料表
    var sup = suppliers().slice().sort(function (a, b) { return (a.active === false) - (b.active === false) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW'); });
    var vcols = [
      { label: '廠商', render: function (s) { return '<b>' + esc(s.name) + '</b>' + (s.active === false ? ' ' + X.ui.tag('停用', 'muted') : ''); } },
      { label: '聯絡人', render: function (s) { return esc(s.contact || ''); } },
      { label: '電話', render: function (s) { return esc(s.phone || ''); } },
      { label: '預設交期', num: true, render: function (s) { return s.leadDays > 0 ? s.leadDays + ' 天' : '—'; } },
      { label: '供應品項', render: function (s) { var l = (s.productIds || s.singleIds || []).map(function (id) { return label(byId[String(id)]); }); return l.length ? '<span class="small">' + esc(l.join('、')) + '</span>' : '<span class="small">未指定</span>'; } },
      { label: '備註', render: function (s) { return '<span class="small">' + esc(s.note || '') + '</span>'; } },
      { label: '', render: function (s) { return '<div class="x-row-actions">' + rowBtn('sedit', s.id, '編輯') + rowBtn('sdel', s.id, '刪除', 'red') + '</div>'; } }
    ];
    html += X.ui.card('廠商資料表', X.ui.table(vcols, sup, { empty: '還沒有廠商資料。按「新增廠商」建立。' }) +
      '<p class="small" style="margin:10px 0 0">「預設交期」是這個廠商平常叫貨到到貨要幾天，叫貨時選了廠商會自動算出預計到貨日（可以自己改）。「供應品項」勾了之後，上面建議叫貨的表會顯示這個品項的廠商，叫貨時自動帶入，「複製叫貨清單」也會依廠商分開。停用的廠商不會出現在叫貨的選單，舊紀錄還是看得到名稱。</p>',
      '<button type="button" class="btn primary" data-act="snew" style="min-height:34px">新增廠商</button>');

    el.innerHTML = html;
    el.oninput = null;
    el.onchange = null;
    el.onclick = function (e) { onClick(e, el, c); };
  }

  // ---------- 叫貨紀錄 ----------
  function sortedProducts() {
    return X.products().filter(Boolean).slice().sort(function (a, b) { return (isSingle(a) - isSingle(b)) || String(a.code || '').localeCompare(String(b.code || ''), 'zh-TW', { numeric: true }); });
  }
  function productOptions(currentId) {
    // 本期上架的禮盒、單條；編輯舊紀錄時它原本的品項也要在選單裡
    var list = sortedProducts().filter(function (p) { return p.isListedCurrent === true || String(p.id) === String(currentId); });
    return [{ value: '', label: '（選擇品項）' }].concat(list.map(function (p) { return { value: p.id, label: (isSingle(p) ? '單條｜' : '禮盒｜') + label(p) }; }));
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
    var pid = rec ? recProduct(rec) : (preset && preset.productId || '');
    var v = rec || { date: date, eta: lead(sid) ? addDays(date, lead(sid)) : '', qty: preset && preset.qty || '', supplier: '', status: 'ordered', note: '' };
    var mask = X.ui.dialog(isNew ? '新增叫貨' : '編輯叫貨', [
      { name: 'date', label: '叫貨日期', type: 'date', value: v.date, required: true },
      { name: 'productId', label: '品項（禮盒以盒、單條以條）', type: 'select', options: productOptions(pid), value: pid, required: true },
      { name: 'qty', label: '數量（禮盒＝盒，單條＝條）', type: 'number', value: v.qty, min: 0, step: 'any', required: true },
      { name: 'supplierId', label: '廠商', type: 'select', options: supplierOptions(sid), value: sid },
      { name: 'eta', label: '預計到貨日', type: 'date', value: v.eta || '' },
      { name: 'status', label: '狀態', type: 'select', options: [{ value: 'ordered', label: '已叫貨（在途）' }, { value: 'received', label: '已到貨' }], value: v.status },
      { name: 'note', label: '備註', type: 'textarea', value: v.note || '', full: true }
    ], function (f) {
      if (!f.productId) { X.toast('請選品項'); return false; }
      if (!(f.qty > 0)) { X.toast('數量要大於 0'); return false; }
      if (f.eta && f.eta < f.date) { X.toast('預計到貨日不能早於叫貨日期'); return false; }
      var list = X.ensure('purchaseOrders'), o = rec ? list.find(function (x) { return x && x.id === rec.id; }) : null;
      if (rec && !o) { X.toast('找不到這筆紀錄，可能已被刪除'); return false; }
      var received = f.status === 'received', s = f.supplierId ? supplierById(f.supplierId) : null;
      if (!o) { o = { id: X.uid('po'), seasonId: (X.activeSeason() || {}).id || '' }; list.push(o); } // seasonId：叫貨當時進行中的檔期，儀表板用來對檔期
      o.date = f.date; o.eta = f.eta; o.productId = f.productId; delete o.singleId; o.qty = f.qty; o.supplierId = f.supplierId; o.supplier = s ? s.name : ''; o.status = f.status; o.note = f.note;
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
    var isNew = !rec, mine = ((rec && (rec.productIds || rec.singleIds)) || []).map(String);
    var prods = sortedProducts().filter(function (p) { return p.isListedCurrent === true || mine.indexOf(String(p.id)) >= 0; });
    var fields = [
      { name: 'name', label: '廠商名稱', type: 'text', value: rec ? rec.name : '', required: true },
      { name: 'contact', label: '聯絡人', type: 'text', value: rec ? rec.contact : '' },
      { name: 'phone', label: '電話', type: 'text', value: rec ? rec.phone : '' },
      { name: 'leadDays', label: '預設交期（天）', type: 'number', value: rec && rec.leadDays > 0 ? rec.leadDays : '', min: 0, step: 1, placeholder: '叫貨到到貨幾天，選填' }
    ].concat(prods.map(function (p) { return { name: 'prod_' + p.id, label: '供應：' + (isSingle(p) ? '單條 ' : '禮盒 ') + label(p), type: 'checkbox', value: mine.indexOf(String(p.id)) >= 0 }; }))
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
      var chosen = prods.filter(function (p) { return f['prod_' + p.id]; }).map(function (p) { return String(p.id); });
      // 沒列在對話框裡的（例如已經不是本期上架）原本勾的要保留
      var keep = mine.filter(function (id) { return !prods.some(function (p) { return String(p.id) === id; }); });
      s.productIds = chosen.concat(keep); delete s.singleIds;
      s.by = X.userName(); s.at = Date.now();
      X.ensure('purchaseOrders').forEach(function (o) { if (o && o.supplierId === s.id) o.supplier = s.name; });
      X.save();
      X.toast(isNew ? '已新增廠商' : '已更新廠商');
    });
  }

  function copyList(c) {
    var groups = {}, order = [];
    c.rows.filter(function (r) { return r.remaining > 0; }).forEach(function (r) {
      var g = r.supplier ? r.supplier.name : '未指定廠商';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(label(r.p) + '　' + X.fmt(r.remaining) + (r.single ? ' 條' : ' 盒'));
    });
    if (!order.length) { X.toast('目前沒有建議叫貨的品項'); return; }
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
    if (a === 'deduct') { st.deduct = b.dataset.v === '1'; saveUi(); render(el); }
    else if (a === 'order') {
      var row = c.rows.find(function (r) { return String(r.id) === id; });
      orderDialog(null, { productId: id, qty: X.num(b.dataset.qty) || '', supplierId: row && row.supplier ? row.supplier.id : '' });
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
    title: '採購叫貨', sub: '禮盒含轉換單條，單條也列入預估，費雪 70%、蛋捲 100%',
    icon: '<path d="M3 4h2l2.4 11h10.2L20 7H6.2"/><circle cx="9" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/>',
    render: render,
    _fn: { compute: compute }
  });
})(window.CMSX);

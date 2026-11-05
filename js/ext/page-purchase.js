/*
 * 採購叫貨（xPurchase，規劃與庫存）
 * ---------------------------------------------------------------
 * 叫貨一律以「條」計算：禮盒依「禮盒資料」的單條內容物換算成條（1 盒 CO-43＝5 條鳳費），單條單賣直接算條。
 * 流程：檔期一開始就「整批一次叫完」，之後只有加量、異動——所以這頁不再逐筆叫貨、不再算「建議再叫」，改成：
 *   ① 「整批叫貨」：一鍵把每個有預估的品項，依目標叫貨量建立成這個檔期的叫貨量（起始量）。
 *   ② 每個品項的「修改叫貨量」：直接改成新的叫貨量（加量或減量），可以寫異動原因，系統自動記錄修改前後。
 *   ③ 「叫貨量異動歷程」：只增不改，時間、品項、修改前、修改後、差異、原因、修改人，都看得到。
 * 數字：
 *   預估量       ＝ 業績預估頁（禮盒、單條）所有部門、所有日期的預估量
 *   100%／70%    ＝ 預估量 × 100%／預估量 × 70%（70% 是「計算規則」的費雪進貨比例，每個品項各自無條件進位）都列出來可以對照
 *   目標叫貨     ＝ 依規則：費雪 70%、蛋捲 100%（預估多少就下單多少），名稱有「蛋捲」的禮盒、單條用蛋捲比例；禮盒先算目標盒數再 × 每盒條數；可選「先扣掉現貨」
 *   叫貨量       ＝ 這個檔期這個品項目前實際叫的條數（整批叫貨＋之後的加量／減量）；與目標的差異另外列出
 * 禮盒那一列另外列出「轉換單條」：目標條數拆成各單條的條數。
 * 資料（都會同步給所有人）：
 *   db.purchaseOrders 叫貨量：{ id, seasonId（叫貨當時進行中的檔期）, date, eta（預計到貨日）, productId（禮盒或單條 id；舊紀錄叫 singleId＝單條）,
 *     qty（目前叫貨量）, unit（'條'＝一律以條計；沒有 unit 的舊禮盒紀錄是盒、舊單條紀錄是條，修改叫貨量時會一併換成條）, supplierId, supplier（廠商名稱）,
 *     batch（true＝整批叫貨建立的）, initQty（整批叫貨的起始量）, status, receivedDate, note, by, at }
 *     每個品項在一個檔期通常只有一筆；以前逐筆叫貨留下的多筆舊紀錄，叫貨量＝加總，修改時從整批那筆（或最新一筆）增減。
 *   db.orderChanges 叫貨量異動歷程（只增不改）：{ id, seasonId, productId, at, by, kind（'create' 整批叫貨／首次設定｜'add' 加量｜'cut' 減量）, fromQty, toQty, reason }
 *   預估區間：業績預估頁每個品項每一週有「起～迄」（例如 1/4～1/11）；「到貨日期」＝區間起往前推一週的星期三（1/4～1/11 → 12/30）。
 *   日期篩選：表格上方可以只看某幾週的預估區間（可複選）：預估、100%、70%、目標叫貨只算選到的週；叫貨量是整個檔期的，不分週。
 *   db.suppliers 廠商資料表：{ id, name, contact, phone, leadDays（預設交期，天）, productIds（供應哪些禮盒、單條；舊資料叫 singleIds）, note, active, by, at }
 * 只讀「業績預估」「禮盒資料」「總表現貨」，只寫 purchaseOrders、orderChanges、suppliers。
 */
(function (X) {
  'use strict';
  if (!X) return;
  var esc = X.esc;
  var UI_KEY = 'cms_purchase_ui';
  var st = { deduct: false, weeks: [], logPid: '' }; // weeks：日期篩選選到的預估區間（區間起日期；空＝全部）；logPid：異動歷程只看哪個品項
  try { st.deduct = !!JSON.parse(localStorage.getItem(UI_KEY) || '{}').deduct; } catch (e) {}
  function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify({ deduct: st.deduct })); } catch (e) {} }

  function norm(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, '').toUpperCase(); }
  function isSingle(p) { return String((p && p.category) || '').trim() === '單條'; }
  function label(p) { return (p && p.code ? p.code + ' ' : '') + (p ? p.name : '（已刪除）'); }
  function suppliers() { return X.get('suppliers').filter(Boolean); }
  function supplierById(id) { return suppliers().find(function (s) { return s.id === id; }) || null; }
  function recProduct(o) { return String(o.productId || o.singleId || ''); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  // 預估區間的到貨日期：區間起那一週的星期一往前推一週，再取星期三（區間 1/4～1/11 → 12/30）
  function arrivalOf(start) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(start || ''));
    if (!m) return '';
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]), dow = (new Date(t).getUTCDay() + 6) % 7; // 0＝星期一
    var d = new Date(t - dow * 86400000 - 7 * 86400000 + 2 * 86400000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function md(date) { var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(date || '')); return m ? Number(m[1]) + '/' + Number(m[2]) : ''; }
  function tm(ms) { var d = new Date(Number(ms)); return isNaN(d.getTime()) ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  var SPEC = { box5: '5入費雪', box8: '8入費雪', egg10: '蛋捲10入', other: '其他禮盒', single: '單條（單賣）' };
  var SPEC_ORDER = ['box5', 'box8', 'egg10', 'other', 'single'];
  function feePct() { return Math.round(X.giftRatio({ name: '' }) * 100); }
  function eggPct() { return Math.round(X.giftRatio({ name: '蛋捲' }) * 100); }

  // 每個禮盒的單條內容物（沒設內容物、但名稱和某個單條一樣的當 1 盒＝1 條，「計算規則」可關閉）
  function convOf() {
    var byId = {}, singleByName = {}, comps = {};
    X.products().forEach(function (p) {
      if (!p) return;
      byId[String(p.id)] = p;
      if (isSingle(p)) { var n = norm(p.name); if (n && !singleByName[n]) singleByName[n] = p; }
    });
    X.components().forEach(function (c) {
      var s = c && byId[String(c.componentProductId)];
      if (s) (comps[String(c.productId)] = comps[String(c.productId)] || []).push({ single: s, qty: X.num(c.qty) });
    });
    var sameOk = !window.CMSRules || CMSRules.get('singlesSameName');
    return {
      byId: byId,
      parts: function (p) { // 回傳 [{ single, qty }]（每盒幾條）或 null
        if (isSingle(p)) return [{ single: p, qty: 1 }];
        var l = comps[String(p.id)];
        if (l && l.length) return l;
        var same = sameOk ? singleByName[norm(p.name)] : null;
        return same ? [{ single: same, qty: 1 }] : null;
      }
    };
  }
  function perBoxOf(cv, p) { var ps = p ? cv.parts(p) : null; return ps ? ps.reduce(function (t, pt) { return t + pt.qty; }, 0) : 0; }
  // 一筆叫貨量換成「條」：新紀錄（unit＝條）直接是條；舊的禮盒紀錄是盒，× 每盒條數；單條都是條
  function unitsOf(o, p, cv) {
    var q = X.num(o.qty);
    if (!p || isSingle(p) || o.unit === '條') return q;
    var per = perBoxOf(cv, p);
    return per > 0 ? q * per : q;
  }
  function seasonId() { var a = X.activeSeason(); return a ? a.id : ''; }
  function seasonRecs(pid) { // 這個檔期、這個品項、數量大於 0 的叫貨量紀錄
    var actId = seasonId();
    return X.get('purchaseOrders').filter(function (o) { return o && recProduct(o) === String(pid) && (!o.seasonId || o.seasonId === actId) && X.num(o.qty) > 0; });
  }
  function changesOf(pid) { // 這個檔期的異動歷程（可只看某個品項），新的在前
    var actId = seasonId();
    return X.get('orderChanges').filter(function (e) { return e && (!e.seasonId || e.seasonId === actId) && (!pid || String(e.productId) === String(pid)); })
      .sort(function (a, b) { return X.num(b.at) - X.num(a.at); });
  }

  // ---------- 計算 ----------
  // opts.all＝不套用日期篩選（整批叫貨用整個檔期的目標）
  function compute(opts) {
    var fb = typeof X.forecastBoxes === 'function' ? X.forecastBoxes() : { byId: {}, dates: {}, ranges: {}, any: false, name: '' };
    var cv = convOf(), byId = cv.byId, actId = seasonId();
    var orders = X.get('purchaseOrders').filter(Boolean), orderedU = {};
    orders.forEach(function (o) {
      var pid = recProduct(o), p = byId[pid], q = unitsOf(o, p, cv);
      if (!(q > 0)) return;
      if (!o.seasonId || o.seasonId === actId) orderedU[pid] = (orderedU[pid] || 0) + q; // 這個檔期叫的
    });
    var sup = suppliers();
    var supplierOf = function (pid) {
      return sup.find(function (s) { return s.active !== false && ((s.productIds || []).indexOf(String(pid)) >= 0 || (s.singleIds || []).indexOf(String(pid)) >= 0); }) || null;
    };
    var ids = {};
    Object.keys(fb.byId).concat(Object.keys(orderedU)).forEach(function (k) { ids[k] = true; });
    X.products().forEach(function (p) { if (p && isSingle(p) && p.isListedCurrent === true) ids[String(p.id)] = true; }); // 本期上架的單條都列出來
    var rows = [];
    Object.keys(ids).forEach(function (pid) {
      var p = byId[pid];
      if (!p) return;
      var single = isSingle(p), est = fb.byId[pid] || 0, ps = cv.parts(p), per = perBoxOf(cv, p), noComp = !single && !ps;
      var unitPer = noComp ? 1 : per; // 沒設單條內容物的禮盒沒辦法換算，先按 1 盒＝1 單位算
      var ratio = X.giftRatio(p), tBoxes = est > 0 ? X.buyBoxes(p, est) : 0; // 目標叫貨（盒；單條是條）
      var feeBoxes = est > 0 ? Math.ceil(est * (feePct() / 100) - 1e-9) : 0; // 費雪比例（70%）
      var stockRaw = window.CMSStock ? (single ? CMSStock.stockByCode(p.code) : CMSStock.giftStock(pid)) : null;
      var stockU = stockRaw == null ? null : stockRaw * unitPer;
      var target = tBoxes * unitPer, aim = (st.deduct && stockU != null) ? Math.max(0, target - Math.max(0, stockU)) : target;
      rows.push({
        p: p, id: pid, single: single, egg: X.isEggGift(p), spec: single ? 'single' : (X.giftGroupKey(p) || 'other'), est: est, per: unitPer, noComp: noComp,
        u100: est * unitPer, u70: feeBoxes * unitPer, ratio: ratio, targetBoxes: tBoxes, target: target, stock: stockU, aim: aim,
        ordered: orderedU[pid] || 0, supplier: supplierOf(pid), extra: !(est > 0), dates: fb.dates[pid] || [],
        ranges: (fb.ranges && fb.ranges[pid]) || [], conv: single || noComp ? [] : ps.map(function (pt) { return { p: pt.single, n: (st.deduct && stockU != null ? aim / unitPer : tBoxes) * pt.qty }; })
      });
    });
    var rank = function (r) { return r.single ? 1 : 0; };
    rows.sort(function (a, b) { return (rank(a) - rank(b)) || (b.est - a.est) || String(a.p.code || '').localeCompare(String(b.p.code || ''), 'zh-TW', { numeric: true }); });
    // 日期篩選：只看選到的預估區間（週）
    var weeksAll = Object.create(null);
    rows.forEach(function (r) { (r.ranges || []).forEach(function (g) { weeksAll[g.start] = g; }); });
    var weekList = Object.keys(weeksAll).sort().map(function (k) { return weeksAll[k]; });
    var sel = (opts && opts.all) ? [] : st.weeks.filter(function (w) { return weeksAll[w]; });
    if (sel.length) {
      rows = rows.filter(function (r) {
        var rg = (r.ranges || []).filter(function (g) { return sel.indexOf(g.start) >= 0; });
        var estSel = rg.reduce(function (t, g) { return t + g.est; }, 0);
        if (!(estSel > 0)) return false;
        var feeB = Math.ceil(estSel * (feePct() / 100) - 1e-9), tB = X.buyBoxes(r.p, estSel), ps = cv.parts(r.p);
        r.est = estSel; r.u100 = estSel * r.per; r.u70 = feeB * r.per; r.targetBoxes = tB; r.target = tB * r.per; r.aim = r.target;
        r.ranges = rg; r.dates = rg.map(function (g) { return g.start; }); r.extra = false;
        r.conv = r.single || r.noComp || !ps ? [] : ps.map(function (pt) { return { p: pt.single, n: tB * pt.qty }; });
        return true;
      });
    }
    var gifts = rows.filter(function (r) { return !r.single; }), singles = rows.filter(function (r) { return r.single; });
    // 統計：依規格（5 入、8 入、蛋捲 10 入、其他禮盒、單條），都以條計
    var stats = {};
    rows.forEach(function (r) {
      var g = stats[r.spec] || (stats[r.spec] = { key: r.spec, est: 0, u100: 0, u70: 0, target: 0, ordered: 0, n: 0 });
      g.est += r.est; g.u100 += r.u100; g.u70 += r.u70; g.target += r.target; g.ordered += r.ordered; g.n++;
    });
    return { fb: fb, gifts: gifts, singles: singles, rows: rows, orders: orders, cv: cv, weekList: weekList, sel: sel,
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
  function datesText(r) {
    return r.ranges && r.ranges.length
      ? r.ranges.map(function (g) { return esc(md(g.start) + (g.end ? '～' + md(g.end) : '')); }).join('<br>')
      : '<span class="small">未填日期</span>';
  }
  function arrivalText(r) {
    return r.ranges && r.ranges.length ? r.ranges.map(function (g) { return esc(md(arrivalOf(g.start))) + ' <span class="small">（三）</span>'; }).join('<br>') : '<span class="small">—</span>';
  }
  function unitOf(r) { return r.noComp ? '盒' : '條'; }
  function signed(n) { return (n > 0 ? '+' : (n < 0 ? '−' : '')) + X.fmt(Math.abs(n)); }
  // 叫貨量與目標的差異
  function diffHtml(r, filtered) {
    if (!(r.ordered > 0)) return r.aim > 0 ? X.ui.tag('還沒叫', 'bad') : '—';
    if (filtered) return '<span class="small">整個檔期</span>';
    var d = r.ordered - r.aim;
    return d === 0 ? X.ui.tag('和目標一致', 'ok') : '<b style="color:var(--' + (d < 0 ? 'bad' : 'warn') + ')">' + signed(d) + '</b>';
  }
  var KIND_TEXT = { create: ['整批叫貨', 'info'], add: ['加量', 'warn'], cut: ['減量', 'bad'] };
  function kindTag(k) { var t = KIND_TEXT[k] || [k || '', 'muted']; return X.ui.tag(t[0], t[1]); }

  function render(el) {
    var c = compute(), fee = feePct(), egg = eggPct(), filtered = c.sel.length > 0;
    var html = '<p class="small" style="margin:0 0 12px">叫貨<b>一律以條計算</b>：禮盒依單條內容物換算成條（1 盒鳳費5入＝5 條鳳費），單條單賣直接算條。檔期一開始會<b>整批一次叫完</b>：按「整批叫貨」就把每個品項的<b>目標叫貨</b>（費雪 ' + fee + '%、蛋捲 ' + egg + '%，比例在「計算規則」可改）建立成叫貨量；之後有加量或異動，在品項右邊按「修改叫貨量」，改了什麼、為什麼改，都會記在下面的「叫貨量異動歷程」。這頁只記錄數字，不會送出任何訂單給廠商。</p>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px"><span class="small" style="min-width:60px;font-weight:700">現貨</span>' +
      chip('deduct', '0', '不扣', !st.deduct) + chip('deduct', '1', '先扣掉總表現貨', st.deduct) + '</div>';
    if (c.weekList.length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px"><span class="small" style="min-width:60px;font-weight:700">日期篩選</span>' +
        chip('week', 'all', '全部', !filtered) +
        c.weekList.map(function (g) { return chip('week', g.start, md(g.start) + '～' + md(g.end) + '（到貨 ' + md(arrivalOf(g.start)) + '）', c.sel.indexOf(g.start) >= 0); }).join('') + '</div>';
      if (filtered) html += X.ui.banner('info', '目前只看 <b>' + c.sel.map(function (w) { var g = c.weekList.find(function (x) { return x.start === w; }); return esc(md(w) + '～' + md(g ? g.end : '')); }).join('、') + '</b> 這幾週：預估、100%、70%、目標叫貨只算這幾週；<b>叫貨量是整個檔期的，不分週</b>，所以這裡不顯示和目標的差異。按「全部」回到整個檔期。');
    }

    if (!c.fb.any) {
      html += X.ui.banner('warn', '「業績預估」頁還沒有填預估量（目前檔期：' + esc(c.fb.name || '未命名') + '），算不出要叫多少貨。禮盒和單條的預估量都到「業績預估」填。') +
        '<div style="margin:8px 0"><button type="button" class="btn primary" data-go="xSalesForecast">到「業績預估」</button></div>';
    }

    var sum = function (list, k) { return list.reduce(function (t, r) { return t + r[k]; }, 0); };
    var feeG = c.gifts.filter(function (r) { return !r.egg; }), eggG = c.gifts.filter(function (r) { return r.egg; });
    var all = compute({ all: true }), todo = all.rows.filter(function (r) { return r.aim > 0 && !(r.ordered > 0); });
    var logsAll = changesOf(''), adjN = logsAll.filter(function (e) { return e.kind !== 'create'; }).length, lastLog = logsAll[0];
    var kp = function (name, list) {
      var o = sum(list, 'ordered'), a = sum(list, 'aim');
      return { label: name + '：叫貨量', value: X.fmt(o) + ' 條', tone: o === 0 && a > 0 ? 'bad' : (o < a ? 'warn' : 'ok'), sub: '目標 ' + X.fmt(a) + (o > 0 && !filtered ? '、差異 ' + (o - a === 0 ? '0' : signed(o - a)) : '') + '；100% ' + X.fmt(sum(list, 'u100')) + '、' + fee + '% ' + X.fmt(sum(list, 'u70')) };
    };
    html += X.ui.kpis([
      kp('費雪禮盒', feeG), kp('蛋捲禮盒', eggG), kp('單條（單賣）', c.singles),
      { label: '叫貨量異動', value: adjN + ' 次', tone: adjN ? 'warn' : 'muted', sub: lastLog ? '最近 ' + tm(lastLog.at) + ' ' + (lastLog.by || '') : '整批叫貨後的加量、減量會記在下面' }
    ]);
    if (todo.length) {
      html += X.ui.banner('warn', '還有 <b>' + todo.length + '</b> 個品項沒有叫貨量（目標合計 <b>' + X.fmt(sum(todo, 'aim')) + '</b> 條）。檔期開始時按「整批叫貨」一次建立。') +
        '<div style="margin:8px 0"><button type="button" class="btn primary" data-act="batch" style="min-height:36px">整批叫貨（' + todo.length + ' 項）</button></div>';
    }

    if (c.noComp.length) {
      html += X.ui.banner('warn', '這些禮盒還沒有設單條內容物，沒辦法換算成條（先按 1 盒算，單位顯示「盒」）：' + c.noComp.map(function (r) { return esc(label(r.p)); }).join('、') + '。請到「禮盒資料」設定單條內容物。');
    }

    // 統計：每個品項一列（依規格排序，不列規格小計），都以條計；單條全部列出來
    var statRows = [];
    c.stats.forEach(function (g) {
      c.rows.filter(function (r) { return r.spec === g.key && (r.single || r.est > 0 || r.ordered > 0); }).forEach(function (r) { statRows.push(r); });
    });
    var scols = [
      { label: '品項', render: function (r) { return esc(label(r.p)) + ' <span class="small">' + (r.single ? '單條' : (r.egg ? '蛋捲' : '費雪')) + '</span>'; } },
      { label: '100%（條）', num: true, render: function (r) { return X.fmt(r.u100); } },
      { label: fee + '%（條）', num: true, render: function (r) { return X.fmt(r.u70); } },
      { label: '目標叫貨（條）', num: true, render: function (r) { return X.fmt(r.target); } },
      { label: '叫貨量（條）', num: true, render: function (r) { return r.ordered ? '<b>' + X.fmt(r.ordered) + '</b>' : '—'; } },
      { label: '和目標的差異', num: true, render: function (r) { return diffHtml(r, filtered); } }
    ];
    html += X.ui.card('叫貨條數統計（各品項，都以條計）', X.ui.table(scols, statRows, { empty: '還沒有預估量。' }) +
      '<p class="small" style="margin:10px 0 0"><b>全部合計：100% ' + X.fmt(sum(c.rows, 'u100')) + ' 條、' + fee + '% ' + X.fmt(sum(c.rows, 'u70')) + ' 條、目標叫貨 ' + X.fmt(sum(c.rows, 'target')) + ' 條、叫貨量 ' + X.fmt(sum(c.rows, 'ordered')) + ' 條</b>。目標叫貨＝費雪 ' + fee + '%、蛋捲 ' + egg + '%（每個品項各自無條件進位後再換算成條）。</p>',
      '<button type="button" class="btn gray" data-act="copy" style="min-height:34px">複製叫貨單</button>');

    var convText = function (r) {
      if (r.single) return '<span class="small">—</span>';
      if (r.noComp) return X.ui.tag('沒設單條內容物', 'warn');
      return r.conv.length ? r.conv.map(function (x) { return esc(x.p.name) + ' <b>' + X.fmt(x.n, 1) + '</b> 條'; }).join('<br>') : '<span class="small">—</span>';
    };
    var cols = [
      { label: '預估區間', render: datesText },
      { label: '到貨日期', render: arrivalText },
      { label: '品項', render: function (r) { return '<b>' + esc(label(r.p)) + '</b> <span class="small">' + (r.single ? '單條' : (r.egg ? '蛋捲' : '費雪')) + '</span>' + (r.extra ? ' ' + X.ui.tag('預估沒填', 'muted') : ''); } },
      { label: '廠商', render: function (r) { return r.supplier ? esc(r.supplier.name) : '<span class="small">未指定</span>'; } },
      { label: '業績預估', num: true, render: function (r) { return r.est > 0 ? X.fmt(r.est) + (r.single ? ' 條' : ' 盒') : '—'; } },
      { label: '每盒條數', num: true, render: function (r) { return r.single ? '—' : (r.noComp ? '—' : X.fmt(r.per, 2)); } },
      { label: '100%（條）', num: true, render: function (r) { return r.est > 0 ? X.fmt(r.u100) : '—'; } },
      { label: fee + '%（條）', num: true, render: function (r) { return r.est > 0 ? X.fmt(r.u70) : '—'; } },
      { label: '採用比例', num: true, render: function (r) { return r.est > 0 ? pctText(r) : '—'; } },
      { label: '目標叫貨（條）', num: true, render: function (r) { return r.est > 0 ? '<b>' + X.fmt(r.target) + '</b>' + (r.noComp ? ' <span class="small">盒</span>' : '') : '—'; } },
      { label: '轉換單條（目標拆成各單條）', render: convText },
      { label: '現貨（條）', num: true, render: function (r) { return stockText(r.stock); } },
      { label: '叫貨量（條）', num: true, render: function (r) { return r.ordered ? '<b>' + X.fmt(r.ordered) + '</b>' + (r.noComp ? ' <span class="small">盒</span>' : '') : '—'; } },
      { label: '和目標的差異', num: true, render: function (r) { return diffHtml(r, filtered); } },
      { label: '', render: function (r) { return rowBtn('adj', r.id, r.ordered > 0 ? '修改叫貨量' : '設定叫貨量', r.ordered > 0 ? 'gray' : 'primary'); } }
    ];
    html += X.ui.card('禮盒與單條（叫貨以條計）', X.ui.table(cols, c.gifts.concat(c.singles), { empty: '「業績預估」頁還沒有填預估量。' }) +
      '<p class="small" style="margin:10px 0 0">「預估區間」是「業績預估」頁這個品項有填預估的每一週區間（起～迄）；「到貨日期」＝區間起往前推一週的星期三（例如 1/4～1/11 → 12/30）。<b>100%（條）</b>＝預估 × 每盒條數；<b>' + fee + '%（條）</b>＝預估 × ' + fee + '% 後（無條件進位）× 每盒條數；<b>目標叫貨</b>是實際採用的比例（費雪 ' + fee + '%、蛋捲 ' + egg + '%）。<b>轉換單條</b>＝這個禮盒的目標拆成各單條的條數。單條單賣列在禮盒後面，預估量也在「業績預估」頁填。<b>叫貨量</b>＝這個檔期目前實際叫的條數；「和目標的差異」＝叫貨量 － 目標（負數＝少叫、正數＝多叫）' + (st.deduct ? '；目前目標已先扣掉總表現貨（禮盒現貨的盒數 × 每盒條數）' : '') + '。按「修改叫貨量」可以加量或減量，會記錄修改前後。現貨來自「入口網站同步」帶入的總表（「—」表示總表沒有這個品號）。</p>',
      todo.length ? '<button type="button" class="btn primary" data-act="batch" style="min-height:34px">整批叫貨</button>' : '');

    // 叫貨量異動歷程
    var names = {}, logPids = [];
    logsAll.forEach(function (e) { var k = String(e.productId); if (!names[k]) { names[k] = true; logPids.push(k); } });
    if (st.logPid && !names[st.logPid]) st.logPid = '';
    var logs = st.logPid ? logsAll.filter(function (e) { return String(e.productId) === st.logPid; }) : logsAll;
    var addQ = 0, cutQ = 0;
    logs.forEach(function (e) { if (e.kind === 'create') return; var d = X.num(e.toQty) - X.num(e.fromQty); if (d > 0) addQ += d; else cutQ += -d; });
    var lcols = [
      { label: '時間', render: function (e) { return esc(tm(e.at)); } },
      { label: '品項', render: function (e) { return esc(label(c.cv.byId[String(e.productId)])); } },
      { label: '類型', render: function (e) { return kindTag(e.kind); } },
      { label: '修改前（條）', num: true, render: function (e) { return X.fmt(e.fromQty); } },
      { label: '修改後（條）', num: true, render: function (e) { return '<b>' + X.fmt(e.toQty) + '</b>'; } },
      { label: '差異', num: true, render: function (e) { var d = X.num(e.toQty) - X.num(e.fromQty); return '<b style="color:var(--' + (d < 0 ? 'bad' : 'warn') + ')">' + signed(d) + '</b>'; } },
      { label: '原因／備註', render: function (e) { return '<span class="small">' + esc(e.reason || '') + '</span>'; } },
      { label: '修改人', render: function (e) { return esc(e.by || ''); } }
    ];
    var logSel = '<label class="small" style="display:inline-flex;gap:6px;align-items:center">只看 <select id="xpLogItem" style="min-height:32px"><option value="">全部品項</option>' +
      logPids.map(function (k) { return '<option value="' + esc(k) + '"' + (k === st.logPid ? ' selected' : '') + '>' + esc(label(c.cv.byId[k])) + '</option>'; }).join('') + '</select></label>';
    html += X.ui.card('叫貨量異動歷程（整批叫貨之後的加量、減量）', X.ui.table(lcols, logs.slice(0, 100), { empty: '還沒有異動紀錄。整批叫貨、或按品項右邊的「修改叫貨量」後，每次修改都會記在這裡。' }) +
      '<p class="small" style="margin:10px 0 0">' + (logs.length ? '共 ' + logs.length + ' 筆' + (logs.length > 100 ? '（只列最新 100 筆）' : '') + '；加量合計 <b>' + X.fmt(addQ) + '</b> 條、減量合計 <b>' + X.fmt(cutQ) + '</b> 條（不含整批叫貨的起始量）。' : '') + '歷程只增不改，修改人與時間用當下登入的帳號。</p>', logPids.length ? logSel : '');

    // 廠商資料表
    var byId = c.cv.byId;
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
      '<p class="small" style="margin:10px 0 0">「供應品項」勾了之後，上面表格會顯示這個品項的廠商，整批叫貨時自動帶入，「複製叫貨單」也會依廠商分開。停用的廠商不會再被帶入，舊紀錄還是看得到名稱。</p>',
      '<button type="button" class="btn primary" data-act="snew" style="min-height:34px">新增廠商</button>');

    el.innerHTML = html;
    el.oninput = null;
    el.onchange = function (e) {
      if (e.target && e.target.id === 'xpLogItem') { st.logPid = e.target.value; render(el); }
    };
    el.onclick = function (e) { onClick(e, el, c); };
  }

  // ---------- 叫貨量：整批叫貨與修改 ----------
  // 把這個品項的叫貨量改成 newQty（條），回傳寫進歷程的那筆；有舊的多筆紀錄時，增加加在整批那筆（沒有就加在最新一筆），減少先從整批那筆扣、再扣最新的
  function applyQty(pid, newQty, reason) {
    var actId = seasonId(), cv = convOf(), p = cv.byId[String(pid)], list = X.ensure('purchaseOrders');
    var recs = list.filter(function (o) { return o && recProduct(o) === String(pid) && (!o.seasonId || o.seasonId === actId) && X.num(o.qty) > 0; });
    recs.forEach(function (o) { o.qty = unitsOf(o, p, cv); o.unit = '條'; }); // 舊的盒紀錄先換成條，才能相加相減
    var cur = recs.reduce(function (t, o) { return t + X.num(o.qty); }, 0), delta = newQty - cur;
    if (delta === 0) return null;
    var main = recs.find(function (o) { return o.batch; }) || recs.slice().sort(function (a, b) { return X.num(b.at) - X.num(a.at); })[0];
    var now = Date.now(), by = X.userName();
    if (delta > 0) {
      if (!main) {
        var s = supplierOfId(pid);
        main = { id: X.uid('po'), seasonId: actId, date: X.today(), eta: '', productId: String(pid), qty: 0, unit: '條', supplierId: s ? s.id : '', supplier: s ? s.name : '', status: 'ordered', batch: true, initQty: newQty, note: '' };
        list.push(main);
      }
      main.qty = X.num(main.qty) + delta;
    } else {
      var need = -delta;
      recs.slice().sort(function (a, b) { return a === main ? -1 : (b === main ? 1 : X.num(b.at) - X.num(a.at)); }).forEach(function (o) {
        if (need <= 0) return;
        var take = Math.min(X.num(o.qty), need);
        o.qty = X.num(o.qty) - take; need -= take;
        if (o.qty <= 0) { var i = list.indexOf(o); if (i >= 0) list.splice(i, 1); }
      });
    }
    if (main) { main.by = by; main.at = now; }
    var entry = { id: X.uid('oc'), seasonId: actId, productId: String(pid), at: now, by: by, kind: cur === 0 ? 'create' : (delta > 0 ? 'add' : 'cut'), fromQty: cur, toQty: newQty, reason: String(reason || '') };
    X.ensure('orderChanges').push(entry);
    return entry;
  }
  function supplierOfId(pid) {
    return suppliers().find(function (s) { return s.active !== false && ((s.productIds || []).indexOf(String(pid)) >= 0 || (s.singleIds || []).indexOf(String(pid)) >= 0); }) || null;
  }

  function adjustDialog(r) {
    var cur = r.ordered, pid = r.id, un = unitOf(r), recs = seasonRecs(pid), bat = recs.find(function (o) { return o.batch; });
    var past = changesOf(pid).slice(0, 5);
    var mask = X.ui.dialog((cur > 0 ? '修改叫貨量：' : '設定叫貨量：') + label(r.p), [
      { name: 'qty', label: '新的叫貨量（' + un + '）', type: 'number', value: cur > 0 ? cur : (r.aim > 0 ? r.aim : ''), min: 0, step: 'any', required: true },
      { name: 'reason', label: '異動原因（建議寫，例如：客人加訂、預估調整）', type: 'textarea', value: '', full: true }
    ], function (f) {
      var nq = f.qty;
      if (nq == null || !(nq >= 0)) { X.toast('請填新的叫貨量（不能是負數）'); return false; }
      if (nq === cur) { X.toast('叫貨量沒有變'); return false; }
      if (nq === 0 && !confirm('確定把「' + label(r.p) + '」的叫貨量改成 0 嗎？')) return false;
      var e = applyQty(pid, nq, f.reason);
      if (!e) { X.toast('叫貨量沒有變'); return false; }
      X.save();
      X.toast(e.kind === 'create' ? '已設定叫貨量' : (e.kind === 'add' ? '已加量 ' + X.fmt(nq - cur) : '已減量 ' + X.fmt(cur - nq)));
    }, '儲存修改');
    var info = '<div class="x-banner x-info" style="margin:0 0 10px">目前叫貨量 <b>' + (cur > 0 ? X.fmt(cur) + ' ' + un : '還沒叫') + '</b>　目標叫貨 <b>' + X.fmt(r.aim) + ' ' + un + '</b>' + (bat && bat.initQty > 0 ? '　整批叫貨的起始量 <b>' + X.fmt(bat.initQty) + '</b>' : '') +
      '<div id="xpPreview" class="small" style="margin-top:4px"></div></div>' +
      (past.length ? '<div class="small" style="margin:0 0 8px"><b>這個品項最近的異動</b><br>' + past.map(function (e) { var d = X.num(e.toQty) - X.num(e.fromQty); return esc(tm(e.at)) + '　' + esc(KIND_TEXT[e.kind] ? KIND_TEXT[e.kind][0] : '') + '　' + X.fmt(e.fromQty) + ' → ' + X.fmt(e.toQty) + '（' + signed(d) + '）' + (e.reason ? '　' + esc(e.reason) : '') + '　' + esc(e.by || ''); }).join('<br>') + '</div>' : '');
    mask.querySelector('.x-form').insertAdjacentHTML('beforebegin', info);
    var upd = function () {
      var v = mask.querySelector('[data-field=qty]').value, box = mask.querySelector('#xpPreview');
      if (v === '' || isNaN(Number(v))) { box.textContent = ''; return; }
      var d = Number(v) - cur;
      box.innerHTML = d === 0 ? '和目前一樣，沒有變動' : '這次修改：<b>' + (d > 0 ? '加量 +' : '減量 −') + X.fmt(Math.abs(d)) + ' ' + un + '</b>（' + X.fmt(cur) + ' → ' + X.fmt(Number(v)) + '）；和目標差 ' + signed(Number(v) - r.aim);
    };
    mask.addEventListener('input', upd); upd();
  }

  function batchDialog() {
    var all = compute({ all: true }), todo = all.rows.filter(function (r) { return r.aim > 0 && !(r.ordered > 0); });
    if (!todo.length) { X.toast('每個有預估的品項都已經有叫貨量了'); return; }
    var total = todo.reduce(function (t, r) { return t + r.aim; }, 0);
    var mask = X.ui.dialog('整批叫貨', [
      { name: 'date', label: '叫貨日期', type: 'date', value: X.today(), required: true },
      { name: 'note', label: '備註（選填）', type: 'textarea', value: '', full: true }
    ], function (f) {
      var actId = seasonId(), list = X.ensure('purchaseOrders'), logs = X.ensure('orderChanges'), now = Date.now(), by = X.userName(), n = 0;
      todo.forEach(function (r) {
        if (seasonRecs(r.id).length) return; // 這段時間別人已經叫了就不重複
        var s = r.supplier, first = r.ranges && r.ranges.length ? r.ranges[0].start : '';
        list.push({ id: X.uid('po'), seasonId: actId, date: f.date, eta: first ? arrivalOf(first) : '', productId: String(r.id), qty: r.aim, unit: '條', supplierId: s ? s.id : '', supplier: s ? s.name : '', status: 'ordered', batch: true, initQty: r.aim, note: f.note || '', by: by, at: now });
        logs.push({ id: X.uid('oc'), seasonId: actId, productId: String(r.id), at: now, by: by, kind: 'create', fromQty: 0, toQty: r.aim, reason: f.note || '整批叫貨' });
        n++;
      });
      X.save(); X.toast('已建立整批叫貨：' + n + ' 個品項');
    }, '建立整批叫貨');
    var tcols = [
      { label: '品項', render: function (r) { return esc(label(r.p)); } },
      { label: '叫貨量（條）', num: true, render: function (r) { return '<b>' + X.fmt(r.aim) + '</b>' + (r.noComp ? ' <span class="small">盒</span>' : ''); } },
      { label: '廠商', render: function (r) { return r.supplier ? esc(r.supplier.name) : '<span class="small">未指定</span>'; } }
    ];
    mask.querySelector('.x-form').insertAdjacentHTML('beforebegin', '<div class="x-banner x-info" style="margin:0 0 10px">會把下面 <b>' + todo.length + '</b> 個品項，依目標叫貨量（費雪 ' + feePct() + '%、蛋捲 ' + eggPct() + '%' + (st.deduct ? '，已先扣掉總表現貨' : '') + '）建立成叫貨量，合計 <b>' + X.fmt(total) + '</b> 條。已經有叫貨量的品項不會動。建立後可以逐項「修改叫貨量」。</div>' +
      '<div style="max-height:240px;overflow:auto;margin:0 0 10px">' + X.ui.table(tcols, todo, {}) + '</div>');
  }

  // ---------- 廠商資料 ----------
  function sortedProducts() {
    return X.products().filter(Boolean).slice().sort(function (a, b) { return (isSingle(a) - isSingle(b)) || String(a.code || '').localeCompare(String(b.code || ''), 'zh-TW', { numeric: true }); });
  }
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
        { name: 'active', label: '啟用中（取消勾選＝停用，不再被帶入叫貨）', type: 'checkbox', value: rec ? rec.active !== false : true, full: true }]);
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

  // 複製叫貨單：依廠商分開，列出每個品項目前的叫貨量
  function copyList(c) {
    var groups = {}, order = [];
    c.rows.filter(function (r) { return r.ordered > 0; }).forEach(function (r) {
      var g = r.supplier ? r.supplier.name : '未指定廠商';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(label(r.p) + '　' + X.fmt(r.ordered) + ' ' + unitOf(r) + (!r.single && !r.noComp && r.per > 0 ? '（約 ' + X.fmt(r.ordered / r.per, 1) + ' 盒）' : ''));
    });
    if (!order.length) { X.toast('目前還沒有叫貨量，先按「整批叫貨」'); return; }
    var text = '【叫貨單 ' + X.today() + '】\n' + order.map(function (g) { return '■ ' + g + '\n' + groups[g].join('\n'); }).join('\n\n');
    var ok = function () { X.toast('已複製叫貨單'); };
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
    else if (a === 'week') {
      var wv = b.dataset.v;
      if (wv === 'all') st.weeks = [];
      else { var wi = st.weeks.indexOf(wv); if (wi >= 0) st.weeks.splice(wi, 1); else st.weeks.push(wv); }
      render(el);
    }
    else if (a === 'batch') batchDialog();
    else if (a === 'adj') { var row = c.rows.find(function (r) { return String(r.id) === id; }); if (row) adjustDialog(row); }
    else if (a === 'copy') copyList(c);
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
    title: '採購叫貨', sub: '檔期開始整批叫貨，之後加量、異動都留歷程；目標：費雪 70%、蛋捲 100%',
    icon: '<path d="M3 4h2l2.4 11h10.2L20 7H6.2"/><circle cx="9" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/>',
    render: render,
    _fn: { compute: compute }
  });
})(window.CMSX);

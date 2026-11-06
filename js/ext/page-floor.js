/*
 * 現場作業
 *  - 快速輸入分成兩個步驟（daily，需管理員，可分別開放給人員）→ movements：
 *      xQuickFold 折盒（物管）：折盒、折盒NG
 *      xQuickStock 進貨與使用（倉管）：進貨、使用、使用NG
 *    只能登記「今天」；今天的紀錄大家都可以修改數量／備註或撤銷，超過當天就鎖定（只能查看）。紀錄區可以選日期查詢。
 *    每次修改、撤銷都會寫進 db.movementLog（只增不改的修改歷程：時間、修改人、修改前後），紀錄區下方「修改歷程」可以追查。
 *  - xStocktake  盤點（daily，beta）：stocktakes
 *  - 裝盒回報（xPacking）2026-10-15 取消：頁面不再註冊（選單看不到），以前的 packRecords 紀錄保留但不再扣庫存；
 *    下面「頁面三」的程式先保留，之後要恢復只要把最下面的 registerPage 加回去，並在 js/stock-calc.js 把裝盒用量算回庫存。
 * 同一次送出的紀錄共用 batchId；紀錄區依批次分組，可整批或單筆撤銷（voided=true，不刪除）。
 * 包材庫存＝初始庫存＋快速輸入（算法在 js/stock-calc.js），快速輸入送出後就會改變首頁庫存；
 * 盤點確認目前還不會改庫存。原系統資料（materials、products、recipes、components、homeOrder）只讀不改。
 * 純計算函式放在 CMSX.floorCalc，方便測試，之後串接庫存時可以直接用。
 * 畫面原則：打字時不整頁重畫，只更新相關的小區塊；頁面被重畫（切頁、同事的雲端更新）時，
 * 包材／禮盒清單沒變就只更新紀錄區，輸入中的內容不動；清單變了才整頁重畫，並由記憶體還原輸入中的內容。
 */
(function (X) {
  'use strict';
  if (!X) return;

  var esc = X.esc, num = X.num, fmt = X.fmt;
  var LATER = ' disabled title="後續階段開放"';
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // 異動類型（與 DATASETS.movements.type 一致）
  var TYPES = {
    in: { label: '進貨', tone: 'ok' },
    fold: { label: '折盒', tone: 'info' },
    use: { label: '使用', tone: 'warn' },
    foldNg: { label: '折盒NG', tone: 'bad' },
    inNg: { label: '進貨NG', tone: 'bad' },
    useNg: { label: '使用NG', tone: 'bad' }
  };
  // 可以輸入的類型（2026-10-15 起「使用」恢復：裝盒回報取消，用掉的已折盒在這裡登記）
  var TYPE_KEYS = ['in', 'fold', 'use', 'foldNg', 'useNg', 'inNg'];
  var ALL_TYPE_KEYS = TYPE_KEYS.slice(); // 連動規則等需要完整類型清單的地方用（makeQuick 裡的 TYPE_KEYS 只有該頁面的類型）
  var TYPE_HINTS = { in: '廠商送來的未折盒', fold: '折盒完成', use: '裝盒用掉已折盒', foldNg: '折壞', useNg: '裝壞', inNg: '廠商送來就不良（從進貨數量扣掉）' };

  // =====================================================================
  // 純計算（不碰畫面，可單獨測試）
  // =====================================================================
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function round2(n) { return Math.round(num(n) * 100) / 100; }
  function filled(v) { return v !== null && v !== undefined && v !== '' && isFinite(Number(v)); }
  function sameId(a, b) { return String(a) === String(b); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function isDate(v) {
    if (!DATE_RE.test(String(v || ''))) return false;
    var p = String(v).split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]);
    return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
  }
  // 可以拿來登記的日期（電腦上逐位數打年份時，會先出現 0202 這種日期，不能當真）
  function dateOk(v) { var y = Number(String(v || '').slice(0, 4)); return isDate(v) && y >= 2000 && y <= 2100; }
  function shiftDate(v, delta) {
    var p = String(v).split('-').map(Number);
    return ymd(new Date(p[0], p[1] - 1, p[2] + num(delta)));
  }
  function shortDate(v) { var p = String(v || '').split('-'); return p.length === 3 ? Number(p[1]) + '/' + Number(p[2]) : String(v || ''); }
  function slashDate(v) { return String(v || '').replace(/-/g, '/'); }
  function hhmm(ms) { if (!ms) return ''; var d = new Date(Number(ms)); return isNaN(d.getTime()) ? '' : pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function typeLabel(k) { return TYPES[k] ? TYPES[k].label : (k || '未知'); }

  // 一筆異動對庫存的影響（與 js/stock-calc.js 同一套）：
  // 進貨＋未折；進貨NG－未折；折盒 未折→已折；使用－已折；折盒NG－未折；使用NG－已折
  function movementEffect(type, qty) {
    var q = Math.max(0, round2(qty));
    switch (type) {
      case 'in': return { unfolded: q, folded: 0 };
      case 'fold': return { unfolded: -q, folded: q };
      case 'use': return { unfolded: 0, folded: -q };
      case 'foldNg': return { unfolded: -q, folded: 0 };
      case 'inNg': return { unfolded: -q, folded: 0 };
      case 'useNg': return { unfolded: 0, folded: -q };
      default: return { unfolded: 0, folded: 0 };
    }
  }
  // 某一天的紀錄（含已撤銷），新到舊
  function dayRecords(list, date) {
    return (list || []).filter(function (r) { return isObj(r) && r.date === date; })
      .sort(function (a, b) { return num(b.at) - num(a.at); });
  }
  // 依包材加總某一天的異動（排除已撤銷），順序同 materials
  // → [{ materialId, in, fold, use, foldNg, useNg, unfolded, folded, count }]
  function summarizeMovements(list, date, materials) {
    var map = Object.create(null), keys = [];
    (list || []).forEach(function (m) {
      // 只算可以輸入的五種類型
      if (!isObj(m) || m.voided === true || TYPE_KEYS.indexOf(m.type) < 0 || (date && m.date !== date)) return;
      var q = round2(m.qty);
      if (!(q > 0)) return;
      var k = String(m.materialId), r = map[k];
      if (!r) { r = map[k] = { materialId: m.materialId, in: 0, inNg: 0, fold: 0, use: 0, foldNg: 0, useNg: 0, unfolded: 0, folded: 0, count: 0 }; keys.push(k); }
      var e = movementEffect(m.type, q);
      r[m.type] = round2(r[m.type] + q);
      r.unfolded = round2(r.unfolded + e.unfolded);
      r.folded = round2(r.folded + e.folded);
      r.count++;
    });
    var order = materialOrder(materials);
    keys.sort(function (a, b) { return orderOf(order, a) - orderOf(order, b); });
    return keys.map(function (k) { return map[k]; });
  }
  function materialOrder(materials) {
    var o = Object.create(null);
    (materials || []).forEach(function (m, i) { if (isObj(m)) o[String(m.id)] = i; });
    return o;
  }
  function orderOf(o, k) { return k in o ? o[k] : 1e9; }
  // 包材排序：照首頁的排序（db.homeOrder.material，id 陣列），沒列到的照原本順序接在後面
  function orderMaterials(materials, order) {
    var items = (materials || []).filter(isObj);
    if (!Array.isArray(order) || !order.length) return items.slice();
    var rank = Object.create(null);
    order.forEach(function (id, i) { var k = String(id); if (!(k in rank)) rank[k] = i; });
    return items.map(function (m, i) { var k = String(m.id); return { m: m, r: k in rank ? rank[k] : order.length + i }; })
      .sort(function (a, b) { return a.r - b.r; })
      .map(function (x) { return x.m; });
  }
  // 數量格：空白 → empty；負數或不是數字 → bad；其他四捨五入成整數（rounded＝原本是小數）
  function parseQty(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (s === '') return { empty: true, bad: false, qty: 0, rounded: false };
    var n = Number(s);
    if (!isFinite(n) || n < 0) return { empty: false, bad: true, qty: 0, rounded: false };
    var q = Math.round(n);
    return { empty: false, bad: false, qty: q, rounded: q !== n };
  }
  // 依批次（batchId）分組；沒有 batchId 的舊紀錄各自一批。批次新到舊，批內維持原順序
  // → [{ key, batchId, at, by, records, active（未撤銷筆數）, voided（已撤銷筆數） }]
  function groupBatches(records) {
    var map = Object.create(null), out = [];
    (records || []).forEach(function (r, i) {
      if (!isObj(r)) return;
      var k = r.batchId ? 'b:' + r.batchId : 'r:' + (r.id != null ? r.id : '#' + i);
      var g = map[k];
      if (!g) { g = map[k] = { key: k, batchId: r.batchId ? String(r.batchId) : '', at: 0, by: r.by || '', records: [], active: 0, voided: 0 }; out.push(g); }
      g.records.push(r);
      if (num(r.at) > g.at) g.at = num(r.at);
      if (r.voided === true) g.voided++; else g.active++;
    });
    return out.sort(function (a, b) { return b.at - a.at; });
  }
  // 裝盒輸入列檢查與合併：空白列略過；同一個禮盒出現多列 → 合併成一筆（盒數相加，rows 記下是第幾列）
  // rows: [{ productId, boxes }]（輸入框原始值）；isGift(id) 檢查禮盒是否還在清單裡
  // → { items: [{ productId, boxes, rows: [列號] }], errors: [{ no, field: 'product'|'boxes', msg, short }] }
  function collectPackRows(rows, isGift) {
    var items = [], byId = Object.create(null), errors = [];
    (rows || []).forEach(function (r, i) {
      var no = i + 1, pid = String((r && r.productId) == null ? '' : r.productId);
      var raw = String((r && r.boxes) == null ? '' : r.boxes).trim();
      var err = function (field, msg, short) { errors.push({ no: no, field: field, msg: '第 ' + no + ' 列' + msg, short: '第 ' + no + ' 列' + short }); };
      if (pid === '') {
        if (raw !== '' && Number(raw) !== 0) err('product', '填了盒數，但還沒選禮盒。', '還沒選禮盒');
        return;
      }
      if (isGift && !isGift(pid)) { err('product', '的禮盒已經不在清單裡，請重新選擇。', '要重新選禮盒'); return; }
      if (raw === '') { err('boxes', '選了禮盒，但還沒填盒數。', '還沒填盒數'); return; }
      var b = Number(raw);
      if (!isFinite(b) || b < 1 || Math.floor(b) !== b) { err('boxes', '的盒數要是 1 以上的整數。', '盒數不正確'); return; }
      var it = byId[pid];
      if (!it) { it = byId[pid] = { productId: pid, boxes: 0, rows: [] }; items.push(it); }
      it.boxes += b;
      it.rows.push(no);
    });
    return { items: items, errors: errors };
  }

  // 盤點：建立品項（帳面數取目前庫存）。每項帶 id（＝包材 id），多人同時盤點才能逐項合併。
  function buildStocktakeItems(materials, stockFn) {
    return (materials || []).filter(isObj).map(function (m) {
      var s = (stockFn && stockFn(m.id)) || {};
      return { id: String(m.id), materialId: m.id, bookUnfolded: round2(s.unfolded), bookFolded: round2(s.folded), countUnfolded: null, countFolded: null };
    });
  }
  // 「差異大」的門檻（%）：見「計算規則」，預設 5%
  function diffPct() { return window.CMSRules ? CMSRules.get('stocktakeDiffPct') : 5; }
  function diffPctText() { return fmt(diffPct(), 1) + '%'; }
  // 單一品項的比對：差異＝實盤合計－帳面合計；兩欄都填了才算；|差異| > |帳面合計| × 門檻% 算「差異大」
  // 寫成 |差異| × (100 ÷ 門檻) > |帳面合計|：門檻 5% 時和原本的 |差異| × 20 完全相同；門檻 0% 時任何差異都算差異大
  function itemCheck(it) {
    it = isObj(it) ? it : {};
    var book = round2(num(it.bookUnfolded) + num(it.bookFolded));
    var fu = filled(it.countUnfolded), ff = filled(it.countFolded);
    if (!fu || !ff) return { book: book, done: false, partial: fu || ff, count: null, diff: null, big: false };
    var count = round2(num(it.countUnfolded) + num(it.countFolded));
    var diff = round2(count - book);
    return { book: book, done: true, partial: false, count: count, diff: diff, big: Math.abs(diff) * (100 / diffPct()) > Math.abs(book) };
  }
  function stocktakeStats(rec) {
    var items = Array.isArray(rec && rec.items) ? rec.items.filter(isObj) : [];
    var out = { total: items.length, done: 0, diff: 0, big: 0 };
    items.forEach(function (it) {
      var c = itemCheck(it);
      if (!c.done) return;
      out.done++;
      if (c.diff !== 0) out.diff++;
      if (c.big) out.big++;
    });
    return out;
  }

  // 裝盒：只列禮盒（category 不是單條），本期上架的排前面
  function sortGifts(products) {
    return (products || []).filter(function (p) { return isObj(p) && String(p.category || '').trim() !== '單條'; })
      .slice().sort(function (a, b) {
        return (b.isListedCurrent === true) - (a.isListedCurrent === true) ||
          String(a.code || '').localeCompare(String(b.code || ''), 'zh-TW', { numeric: true }) ||
          String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW');
      });
  }
  // 某一天（date 空白＝全部）未撤銷的裝盒紀錄 → 盒數 × 配方／內容物
  // 包材用量優先用紀錄裡送出當時的配方快照（materials，和 js/stock-calc.js 相同），沒有快照才用目前配方
  // → { total, count, byProduct: [{productId, boxes, count}], materials: [{materialId, qty}], singles: [{productId, qty}],
  //     noRecipe: [沒有包材配方的禮盒 id], noComponents: [沒有單條內容物的禮盒 id] }
  function packUsage(records, date, recipes, components) {
    var boxes = Object.create(null), counts = Object.create(null), viaRecipe = Object.create(null), order = [], total = 0, count = 0;
    var mats = Object.create(null), matKeys = [], sgl = Object.create(null), sglKeys = [], noRecipe = [], noComponents = [];
    function addMat(k, q) { k = String(k); if (!(k in mats)) { mats[k] = 0; matKeys.push(k); } mats[k] = round2(mats[k] + q); }
    (records || []).forEach(function (r) {
      if (!isObj(r) || r.voided === true || (date && r.date !== date)) return;
      var b = num(r.boxes);
      if (!(b > 0)) return;
      var k = String(r.productId);
      if (!(k in boxes)) { boxes[k] = 0; counts[k] = 0; order.push(k); }
      boxes[k] += b; counts[k]++; total += b; count++;
      if (Array.isArray(r.materials) && r.materials.length) r.materials.forEach(function (m) { if (isObj(m)) addMat(m.materialId, b * num(m.qty)); });
      else viaRecipe[k] = (viaRecipe[k] || 0) + b;
    });
    order.forEach(function (pid) {
      var b = viaRecipe[pid] || 0, hit = false, hitC = false;
      (recipes || []).forEach(function (r) {
        if (!isObj(r) || String(r.productId) !== pid) return;
        hit = true;
        if (b) addMat(r.materialId, b * num(r.qty));
      });
      if (!hit && (pid in viaRecipe)) noRecipe.push(pid);
      b = boxes[pid];
      (components || []).forEach(function (c) {
        if (!isObj(c) || String(c.productId) !== pid) return;
        hitC = true;
        var k = String(c.componentProductId);
        if (!(k in sgl)) { sgl[k] = 0; sglKeys.push(k); }
        sgl[k] = round2(sgl[k] + b * num(c.qty));
      });
      if (!hitC) noComponents.push(pid);
    });
    return {
      total: round2(total), count: count,
      byProduct: order.map(function (pid) { return { productId: pid, boxes: boxes[pid], count: counts[pid] }; }),
      materials: matKeys.map(function (k) { return { materialId: k, qty: mats[k] }; }),
      singles: sglKeys.map(function (k) { return { productId: k, qty: sgl[k] }; }),
      noRecipe: noRecipe, noComponents: noComponents
    };
  }

  var calc = {
    TYPES: TYPES, movementEffect: movementEffect, dayRecords: dayRecords, summarizeMovements: summarizeMovements,
    orderMaterials: orderMaterials, parseQty: parseQty, groupBatches: groupBatches, collectPackRows: collectPackRows,
    buildStocktakeItems: buildStocktakeItems, itemCheck: itemCheck, stocktakeStats: stocktakeStats,
    sortGifts: sortGifts, packUsage: packUsage, isDate: isDate, dateOk: dateOk, shiftDate: shiftDate
  };
  if (!X.floorCalc) X.floorCalc = calc;

  // =====================================================================
  // 共用畫面工具
  // =====================================================================
  function intro(text) { return '<p class="small" style="margin:0 0 12px">' + esc(text) + '</p>'; }
  function actOf(e) { return (e.target && e.target.closest) ? e.target.closest('[data-act]') : null; }
  function list(key) { return X.get(key).filter(isObj); }
  function wrapText(t) { return '<span style="white-space:normal">' + esc(t) + '</span>'; }
  function smallLine(t) { return '<div class="small" style="margin:2px 0 0;white-space:normal">' + esc(t) + '</div>'; }
  function muted(t) { return '<span class="small" style="margin:0">' + esc(t) + '</span>'; }
  function q$(el, sel) { return el && el.querySelector ? el.querySelector(sel) : null; }
  function q$$(el, sel) { return el && el.querySelectorAll ? Array.prototype.slice.call(el.querySelectorAll(sel)) : []; }
  function focusEl(x) { if (x && x.focus) x.focus(); }
  // '' 代表「今天」（頁面開著過午夜也會自動換成新的今天）
  function effDate(v) { return isDate(v) ? v : X.today(); }
  function keepDate(v) { return isDate(v) && v !== X.today() ? v : ''; }

  // 和 X.ui.table 相同的樣式，但可以替每一列加屬性（刪除線、標紅、data-*）
  // opts.rowAttrs(r) 回傳已跳脫的屬性字串；opts.cellStyle(r, col) 回傳 td 的 style
  function tableX(cols, rows, opts) {
    opts = opts || {};
    if (!rows.length) return X.ui.empty(opts.empty || '目前沒有資料');
    return '<div class="tablewrap"><table class="x-table"><thead><tr>' +
      cols.map(function (c) { return '<th' + (c.num ? ' class="num"' : '') + '>' + esc(c.label) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr' + (opts.rowAttrs ? opts.rowAttrs(r) : '') + '>' + cols.map(function (c) {
          var st = opts.cellStyle ? opts.cellStyle(r, c) : '';
          var v = c.render ? c.render(r) : esc(r[c.key]);
          return '<td' + (c.num ? ' class="num"' : '') + (st ? ' style="' + st + '"' : '') + '>' + (v == null ? '' : v) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  // 新增一筆；儲存失敗就拿掉，避免畫面上有但沒存到
  function pushRecord(key, rec) {
    var arr = X.ensure(key);
    arr.push(rec);
    if (X.save()) return true;
    var i = arr.indexOf(rec);
    if (i >= 0) arr.splice(i, 1);
    return false;
  }
  // 一次新增多筆（不重畫整頁）；儲存失敗就全部拿掉
  function pushRecords(key, recs) {
    var arr = X.ensure(key);
    recs.forEach(function (r) { arr.push(r); });
    if (X.save({ silent: true })) return true;
    for (var i = arr.length - 1; i >= 0; i--) if (recs.indexOf(arr[i]) >= 0) arr.splice(i, 1);
    return false;
  }
  // 產生 n 個不重複的 id（同一毫秒內大量產生時，避免和既有紀錄或彼此撞號）
  function freshIds(prefix, n, existing) {
    var used = Object.create(null), out = [];
    (existing || []).forEach(function (r) { if (isObj(r) && r.id != null) used[String(r.id)] = true; });
    while (out.length < n) {
      var id = X.uid(prefix);
      if (!used[id]) { used[id] = true; out.push(id); }
    }
    return out;
  }

  // ---------- 撤銷（保留紀錄，voided=true，不重畫整頁；呼叫端自己更新紀錄區） ----------
  // 修改歷程（只增不改，db.movementLog）：action＝'edit' 修改｜'void' 撤銷；修改人與時間用當下的登入者
  function logEntry(action, rec, from, to) {
    return { id: X.uid('ml'), at: Date.now(), by: X.userName(), action: action, movementId: rec.id, batchId: rec.batchId || '', date: rec.date, materialId: rec.materialId, type: rec.type,
      fromQty: from ? from.qty : rec.qty, toQty: to ? to.qty : rec.qty, fromNote: from ? String(from.note || '') : String(rec.note || ''), toNote: to ? String(to.note || '') : String(rec.note || '') };
  }
  function dropLogs(logs) {
    var lg = X.ensure('movementLog');
    logs.forEach(function (e) { var i = lg.indexOf(e); if (i >= 0) lg.splice(i, 1); });
  }
  // ---------- 連動規則（db.materialLinks）----------
  // { id, fromMaterialId, fromType（'fold' 折盒｜'use' 使用…）, toMaterialId, toType, ratio（來源每 1 個，連動包材用幾個，預設 1）, active, note, by, at }
  // 例：共用袖套盒（蛋捲）折盒 1 個 → 共用蛋捲內襯 使用 1 個；共用袖套盒（廢雪）使用 1 個 → 共用袖套盒放入廢雪隔板 使用 1 個
  //   · 來源和連動的類型都在同一個頁面（例如進貨與使用的「使用 → 使用」）：輸入來源數量時，連動那一格自動填入（還可以自己改）
  //   · 連動的類型在另一個頁面（例如折盒 → 使用）：送出時自動多記一筆連動紀錄（auto=true，srcId 指向來源），不能單獨修改或撤銷，來源撤銷、修改時一起跟著變
  function linkRules() { return list('materialLinks').filter(function (l) { return l.active !== false && l.fromMaterialId != null && l.toMaterialId != null && TYPES[l.fromType] && TYPES[l.toType]; }); }
  function linkRatio(l) { var r = num(l.ratio); return r > 0 ? r : 1; }
  function linkQty(src, l) { return Math.max(0, Math.round(num(src) * linkRatio(l))); }
  function linkedRecs(recs) { // 這些來源紀錄連動出來、還沒撤銷的自動紀錄
    var ids = Object.create(null);
    recs.forEach(function (r) { ids[String(r.id)] = true; });
    return X.ensure('movements').filter(function (r) { return isObj(r) && r.auto === true && r.voided !== true && ids[String(r.srcId)] && recs.indexOf(r) < 0; });
  }
  // 第一次（還沒有任何規則時）依包材名稱建立預設規則：找得到唯一對應的包材才建立，找不到就不建，讓管理員自己新增
  function seedLinks() {
    var d = X.db();
    if (!d || d.materialLinksSeeded || list('materialLinks').length) return;
    var mats = X.materials().filter(function (m) { return m && m.status !== 'archived'; });
    var find = function (parts, not) {
      var hit = mats.filter(function (m) { var n = String(m.name || ''); return parts.every(function (p) { return n.indexOf(p) >= 0; }) && !(not || []).some(function (p) { return n.indexOf(p) >= 0; }); });
      return hit.length === 1 ? hit[0] : null;
    };
    var egg = find(['袖套盒', '蛋捲'], ['內襯', '隔板']), eggLiner = find(['蛋捲', '內襯']);
    var waste = find(['袖套盒', '廢雪'], ['內襯', '隔板']), wasteDiv = find(['廢雪', '隔板']);
    var out = [];
    if (egg && eggLiner) out.push({ id: X.uid('ml'), fromMaterialId: egg.id, fromType: 'fold', toMaterialId: eggLiner.id, toType: 'use', ratio: 1, active: true, note: '共用袖套盒（蛋捲）折 1 個，耗 1 個共用蛋捲內襯', by: '系統預設', at: Date.now() });
    if (waste && wasteDiv) out.push({ id: X.uid('ml'), fromMaterialId: waste.id, fromType: 'use', toMaterialId: wasteDiv.id, toType: 'use', ratio: 1, active: true, note: '共用袖套盒（廢雪）用 1 個，用 1 個放入廢雪隔板', by: '系統預設', at: Date.now() });
    d.materialLinksSeeded = true;
    if (out.length) { out.forEach(function (l) { X.ensure('materialLinks').push(l); }); X.save({ silent: true }); }
    else X.save({ silent: true });
  }

  function applyVoid(recs, msg, key) {
    if (!recs.length) return false;
    if (!confirm(msg + '\n紀錄會保留並加上刪除線，但不再計算。')) return false;
    var logs = [];
    if (key === 'movements') { var lg = X.ensure('movementLog'); recs.forEach(function (r) { var e = logEntry('void', r); lg.push(e); logs.push(e); }); }
    recs.forEach(function (r) { r.voided = true; });
    if (!X.save({ silent: true })) { recs.forEach(function (r) { r.voided = false; }); dropLogs(logs); return false; }
    X.toast('已撤銷 ' + recs.length + ' 筆');
    return true;
  }
  function voidBatch(key, batchId, what) {
    var recs = X.ensure(key).filter(function (r) { return isObj(r) && r.batchId && sameId(r.batchId, batchId) && r.voided !== true; });
    if (key === 'movements' && recs.some(function (r) { return r.date !== X.today(); })) { X.toast('已超過當日，這批紀錄已鎖定，不能撤銷'); return false; }
    var lk = key === 'movements' ? linkedRecs(recs) : [];
    return applyVoid(recs.concat(lk), recs.length > 1 ? '要撤銷這一批 ' + recs.length + ' 筆' + what + '嗎？' + (lk.length ? '\n（連動自動登記的 ' + lk.length + ' 筆也會一起撤銷）' : '') : '要撤銷這筆' + what + '嗎？' + (lk.length ? '\n（連動自動登記的 ' + lk.length + ' 筆也會一起撤銷）' : ''), key);
  }
  function voidOne(key, id, what) {
    var rec = X.ensure(key).find(function (r) { return isObj(r) && sameId(r.id, id); });
    if (key === 'movements' && rec && rec.date !== X.today()) { X.toast('已超過當日，這筆紀錄已鎖定，不能撤銷'); return false; }
    if (rec && rec.auto === true) { X.toast('這是連動自動登記的紀錄，請撤銷來源那筆'); return false; }
    var one = rec && rec.voided !== true ? [rec] : [], lk1 = key === 'movements' ? linkedRecs(one) : [];
    return applyVoid(one.concat(lk1), '要撤銷這筆' + what + '嗎？' + (lk1.length ? '\n（連動自動登記的 ' + lk1.length + ' 筆也會一起撤銷）' : ''), key);
  }

  // ---------- 依批次顯示的紀錄 ----------
  // P：class 前綴（x-qe／x-pk）；open：要保持展開的批次；o：{ unit, count(shown), item(r) 摘要文字, line(r) 明細 HTML }
  function batchHtml(P, g, open, o) {
    var allVoid = g.active === 0;
    var shown = g.records.filter(function (r) { return allVoid || r.voided !== true; });
    var items = shown.map(o.item);
    var sum = items.slice(0, 8).join('、') + (items.length > 8 ? ' 等 ' + items.length + ' ' + o.unit : '');
    var note = String(g.records[0].note || '');
    var many = g.records.length > 1;
    var editBtn = function (id) { return o.edit ? '<button type="button" class="btn gray" data-act="edit-one" data-id="' + esc(id) + '">修改</button> ' : ''; };
    var allAuto = g.records.every(function (r) { return r.auto === true; });
    var btn = allVoid ? X.ui.tag('已撤銷', 'muted')
      : allAuto ? X.ui.tag('自動連動', 'info')
      : o.locked ? X.ui.tag('已鎖定', 'muted')
      : g.batchId ? (many ? '' : editBtn(g.records[0].id)) + '<button type="button" class="btn gray" data-act="void-batch" data-batch="' + esc(g.batchId) + '">' + (many ? '撤銷這一批' : '撤銷') + '</button>'
        : editBtn(g.records[0].id) + '<button type="button" class="btn gray" data-act="void-one" data-id="' + esc(g.records[0].id) + '">撤銷</button>';
    var html = '<div class="' + P + '-batch' + (allVoid ? ' ' + P + '-batch-void' : '') + '">' +
      '<div class="' + P + '-batch-head"><div class="' + P + '-batch-info">' +
      '<div class="' + P + '-batch-meta"><b>' + esc(hhmm(g.at) || '—') + '</b><span>' + esc(g.by || '—') + '</span><span>' + esc(o.count(shown)) + '</span>' +
      (g.voided && !allVoid ? X.ui.tag('已撤銷 ' + g.voided + ' 筆', 'muted') : '') + '</div>' +
      '<div class="' + P + '-batch-sum">' + esc(sum) + '</div>' +
      (g.records[0].dept ? '<div class="' + P + '-batch-note">折盒部門：' + esc(g.records[0].dept) + '</div>' : '') +
      (note ? '<div class="' + P + '-batch-note">備註：' + esc(note) + '</div>' : '') +
      '</div>' + btn + '</div>';
    if (many) {
      html += '<details data-batch-key="' + esc(g.key) + '"' + (open[g.key] ? ' open' : '') + '><summary>看每一筆（' + g.records.length + ' 筆）</summary>' +
        '<ul class="' + P + '-recs">' + g.records.map(function (r) {
          var v = r.voided === true;
          return '<li class="' + P + '-rec' + (v ? ' ' + P + '-rec-void' : '') + '"><span class="' + P + '-rec-text">' + o.line(r) +
            (r.note && String(r.note) !== note ? '<span class="' + P + '-rec-note">' + esc(r.note) + '</span>' : '') + '</span>' +
            (v ? X.ui.tag('已撤銷', 'muted') : (r.auto === true ? X.ui.tag('自動連動', 'info') : o.locked ? '' : editBtn(r.id) + '<button type="button" class="btn gray" data-act="void-one" data-id="' + esc(r.id) + '">撤銷</button>')) + '</li>';
        }).join('') + '</ul></details>';
    }
    return html + '</div>';
  }
  // 重畫紀錄區前，記下哪些批次是展開的
  function openKeys(box) {
    var o = Object.create(null);
    q$$(box, 'details[open]').forEach(function (d) { if (d.dataset.batchKey) o[d.dataset.batchKey] = true; });
    return o;
  }
  function dayStamp(d) { var t = d === X.today(); return X.ui.tag(slashDate(d) + (t ? ' 今天' : ''), t ? 'info' : 'warn'); }
  function dateTagHtml(d, act) {
    return d === X.today() ? '' : X.ui.tag('不是今天', 'warn') + ' <button type="button" class="btn gray" data-act="' + act + '">改回今天</button>';
  }
  function homeOrderOf(kind) {
    var d = X.db(), h = d && d.homeOrder;
    return h && typeof h === 'object' && Array.isArray(h[kind]) ? h[kind] : null;
  }
  function orderedMaterials() { return orderMaterials(X.materials().filter(X.materialActive), homeOrderOf('material')); } // 下架、已封存的包材不在日常操作清單
  function nameOfMaterial(id) { var m = X.materialById(id); return m ? (m.name || X.materialLabel(m)) : '（已刪除）'; }
  function nameOfProduct(id) { var p = X.productById(id); return p ? (p.name || X.productLabel(p)) : '（已刪除）'; }

  // =====================================================================
  // 頁面一：快速輸入（xQuickEntry）
  // =====================================================================
  function makeQuick(cfg) {
    var TYPE_KEYS = cfg.types;
  // date：'' 代表今天；note：備註；vals[包材 id][類型]：輸入框裡的原始字串（頁面被整頁重畫時用來還原）
  var qe = { view: '', note: '', dept: '', from: '', to: '', auto: Object.create(null), vals: Object.create(null) };
  try { if (cfg.dept) qe.dept = localStorage.getItem('cms_fold_dept') || ''; } catch (e) {}

  function qeTypeText(t) { return typeLabel(t); }
  var QE_BATCH = {
    unit: '筆',
    count: function (shown) { return shown.length + ' 筆'; },
    item: function (r) { return nameOfMaterial(r.materialId) + ' ' + qeTypeText(r.type) + ' ' + fmt(r.qty, 2); },
    line: function (r) {
      return esc(X.materialLabel(r.materialId)) + ' ' + X.ui.tag(qeTypeText(r.type), r.voided === true ? 'muted' : (TYPES[r.type] ? TYPES[r.type].tone : 'muted')) +
        ' <b>' + esc(fmt(r.qty, 2)) + '</b>' + (r.editedAt ? ' <span class="small">（已修改）</span>' : '');
    }
  };

  function qeCellCls(p) { return p.bad ? 'x-qe-bad' : (p.qty > 0 ? 'x-qe-on' : ''); }
  function qeRowHtml(m) {
    var mid = String(m.id), v = qe.vals[mid] || {}, name = m.name || X.materialLabel(m), any = false;
    var cells = TYPE_KEYS.map(function (k) {
      var raw = v[k] == null ? '' : String(v[k]), p = parseQty(raw);
      if (!p.bad && p.qty > 0) any = true;
      return '<label class="x-qe-cell"><span class="x-qe-lab">' + esc(TYPES[k].label) + '</span>' +
        '<input type="number" inputmode="numeric" min="0" step="1" placeholder="0" enterkeyhint="next" data-mv="' + k + '" class="' + qeCellCls(p) + '"' +
        ' aria-label="' + esc(name + ' ' + TYPES[k].label) + '" value="' + esc(raw) + '"></label>';
    }).join('');
    return '<div class="x-qe-row' + (any ? ' x-qe-row-on' : '') + '" data-mid="' + esc(mid) + '">' +
      '<div class="x-qe-name">' + (m.code ? '<span class="x-qe-code">' + esc(m.code) + '</span>' : '') + '<b>' + esc(name) + '</b>' +
      (m.unit ? '<span class="x-qe-unit">（' + esc(m.unit) + '）</span>' : '') +
      '<div class="x-qe-done" data-box="qe-done"></div></div>' + cells + '</div>';
  }

  // 折盒部門清單（db.foldDepts：{ id, name }）；選單最後一項「＋ 新增部門…」誰都可以加，管理員可以用「管理部門清單」整批改
  function foldDepts() { return list('foldDepts').filter(function (d) { return String(d.name || '').trim(); }); }
  function deptOptionsHtml() {
    var names = foldDepts().map(function (d) { return String(d.name).trim(); });
    if (qe.dept && names.indexOf(qe.dept) < 0) names.push(qe.dept);
    return '<option value="">（未選）</option>' + names.map(function (n) { return '<option value="' + esc(n) + '"' + (n === qe.dept ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '<option value="__new__">＋ 新增部門…</option>';
  }
  function refreshDeptSelect(el) {
    var sel = q$(el, 'select[data-qe="dept"]');
    if (sel) sel.innerHTML = deptOptionsHtml();
  }
  function setDept(el, name) {
    qe.dept = name || '';
    try { localStorage.setItem('cms_fold_dept', qe.dept); } catch (e) {}
    refreshDeptSelect(el);
  }
  function addDeptDialog(el) {
    X.ui.dialog('新增折盒部門', [{ name: 'name', label: '部門名稱', type: 'text', value: '', required: true, placeholder: '例：物管、倉管' }], function (f) {
      var name = String(f.name || '').trim().slice(0, 20);
      if (!name) { X.toast('請填部門名稱'); return false; }
      var all = X.ensure('foldDepts');
      if (!all.some(function (d) { return isObj(d) && String(d.name || '').trim() === name; })) all.push({ id: X.uid('fd'), name: name });
      X.save({ silent: true }); setDept(el, name); X.toast('已新增「' + name + '」');
    });
    setDept(el, qe.dept); // 先把選單改回原本選的，避免停在「新增部門…」
  }
  function editDeptsDialog(el) {
    var cur = foldDepts().map(function (d) { return d.name; }).join(String.fromCharCode(10));
    X.ui.dialog('管理折盒部門清單', [{ name: 'lines', label: '一行一個部門（拿掉的部門不會再出現在選單，已登記的紀錄不受影響）', type: 'textarea', value: cur, rows: 8, full: true }], function (f) {
      var names = [];
      String(f.lines || '').split(String.fromCharCode(10)).forEach(function (n) { n = n.trim().slice(0, 20); if (n && names.indexOf(n) < 0) names.push(n); });
      var all = X.ensure('foldDepts'), old = all.slice();
      all.splice(0, all.length);
      names.forEach(function (n) { var ex = old.find(function (d) { return isObj(d) && String(d.name || '').trim() === n; }); all.push(ex || { id: X.uid('fd'), name: n }); });
      X.save({ silent: true });
      if (qe.dept && names.indexOf(qe.dept) < 0) setDept(el, ''); else refreshDeptSelect(el);
      X.toast('已更新部門清單');
    });
  }

  function renderQuickEntry(el) {
    try { seedLinks(); } catch (e) { console.warn('連動規則預設建立失敗', e); }
    var mats = orderedMaterials();
    var sig = mats.map(function (m) { return [m.id, m.code, m.name, m.unit].join('\u0001'); }).join('\u0002');
    // 包材清單沒變：只更新紀錄區與「已登記」小字，輸入中的格子完全不動
    if (mats.length && el._xqeSig === sig && q$(el, '[data-box="qe-grid"]')) { bindQuickEntry(el); refreshQuickEntry(el); return; }
    el._xqeSig = sig;
    var d = X.today();
    var html = intro(cfg.intro);
    if (!mats.length) {
      html += X.ui.card('填寫數量', X.ui.empty('還沒有包材資料，請先到「包材資料」建立包材。'));
    } else {
      html += '<div class="panel x-card x-qe-panel x-qe-n' + TYPE_KEYS.length + '">' +
        '<div class="x-card-head"><h2>' + esc(cfg.title) + '</h2></div>' +
        '<div class="x-qe-top">' +
        '<div class="x-field"><span>登記日期（只能登記今天）</span>' +
        '<input type="text" readonly data-qe="today" aria-label="登記日期" value="' + esc(slashDate(d)) + '（今天）" style="background:var(--surface-2)"></div>' +
        '<div class="x-field"><span>備註（選填，會套用到這次送出的每一筆）</span>' +
        '<input type="text" data-qe="note" maxlength="100" placeholder="例：早班、A 倉" aria-label="備註" value="' + esc(qe.note) + '"></div>' +
        (cfg.dept ? '<div class="x-field"><span>折盒部門（這次是哪個部門折的，會套用到這次送出的每一筆）' + (X.isAdmin() ? ' <button type="button" class="btn gray" data-act="dept-edit" style="min-height:26px;padding:1px 8px;font-size:13px">管理部門清單</button>' : '') + '</span>' +
          '<select data-qe="dept" aria-label="折盒部門">' + deptOptionsHtml() + '</select></div>' : '') +
        '</div>' +
        '<div class="x-qe-legend">' + TYPE_KEYS.map(function (k) { return '<span><b>' + esc(TYPES[k].label) + '</b> ' + esc(TYPE_HINTS[k]) + '</span>'; }).join('') + '</div>' +
        '<div class="x-qe-grid" data-box="qe-grid">' +
        '<div class="x-qe-headrow"><div>包材</div>' + TYPE_KEYS.map(function (k) { return '<div>' + esc(TYPES[k].label) + '<small>' + esc(TYPE_HINTS[k]) + '</small></div>'; }).join('') + '</div>' +
        mats.map(qeRowHtml).join('') +
        '</div>' +
        '<div class="x-qe-bar"><span class="x-qe-count" data-box="qe-count" aria-live="polite"></span>' +
        '<button type="button" class="btn gray x-qe-clear" data-act="qe-clear">清除</button>' +
        '<button type="button" class="btn primary x-qe-submit" data-act="qe-submit">全部送出</button></div>' +
        '</div>';
    }
    // 數量統計：查「哪一天到哪一天」的總數量（預設本月 1 日～今天）；輸入框只在整頁重畫時建立，之後只更新結果區
    if (!dateOk(qe.from)) qe.from = d.slice(0, 8) + '01';
    if (!dateOk(qe.to)) qe.to = d;
    var rbtn = function (act, text) { return '<button type="button" class="btn gray" data-act="' + act + '" style="min-height:34px;padding:4px 10px">' + text + '</button>'; };
    html += X.ui.card('數量統計（' + cfg.short + '）',
      '<div data-box="qe-range-top"></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px"><b>日期區間</b>' +
      '<input type="date" data-qe="from" aria-label="起" value="' + esc(qe.from) + '" style="padding:6px;border:1px solid var(--line-strong);border-radius:8px;font:inherit"> ～ ' +
      '<input type="date" data-qe="to" aria-label="迄" value="' + esc(qe.to) + '" style="padding:6px;border:1px solid var(--line-strong);border-radius:8px;font:inherit">' +
      rbtn('rg-today', '今天') + rbtn('rg-7', '最近 7 天') + rbtn('rg-month', '本月') + '</div>' +
      '<div data-box="qe-range-out"></div>');
    html += '<div data-box="qe-records"></div><div data-box="qe-links"></div>';
    el.innerHTML = html;
    bindQuickEntry(el);
    refreshQuickEntry(el);
  }

  // 數量統計：上面是固定的合計（不受日期影響：今年預估需要、累計登記量），下面選日期區間逐日看每天做了多少；都不含已撤銷的紀錄
  function updateQeRange(el) {
    var top = q$(el, '[data-box="qe-range-top"]'), out = q$(el, '[data-box="qe-range-out"]');
    if (!top || !out) return;
    var order = {}; orderMaterials(X.materials(), homeOrderOf('material')).forEach(function (m, i) { order[String(m.id)] = i; });
    var ord = function (a, b) { return (order[String(a.id)] == null ? 9999 : order[String(a.id)]) - (order[String(b.id)] == null ? 9999 : order[String(b.id)]); };
    var recs = list('movements').filter(function (r) { return r.voided !== true && TYPE_KEYS.indexOf(r.type) >= 0; });
    // ---- 上：固定合計（全部登記累計；折盒頁另加「今年預估需要」）----
    var cum = {}, cumM = Object.create(null);
    TYPE_KEYS.forEach(function (k) { cum[k] = 0; });
    recs.forEach(function (r) {
      var q = num(r.qty); cum[r.type] += q;
      var m = cumM[String(r.materialId)] || (cumM[String(r.materialId)] = { id: r.materialId, t: {} }); m.t[r.type] = (m.t[r.type] || 0) + q;
    });
    var withNeed = TYPE_KEYS.indexOf('fold') >= 0 && !!window.CMSStock, needBy = Object.create(null), giftBoxes = 0, giftRows = [];
    if (withNeed) {
      // 今年（目前檔期）預估所需要的盒子數量：業績預估每個禮盒所有日期、所有部門的預估盒數（和首頁「銷售預估」同一個數字）× 配方裡每個包材的用量
      var isSingleP = function (p) { return String((p && p.category) || '').trim() === '單條'; };
      X.products().forEach(function (p) { if (p && !isSingleP(p)) { var gb = num(CMSStock.giftForecast(p.id)); giftBoxes += gb; if (gb > 0) giftRows.push({ p: p, boxes: gb }); } });
      ((X.db() && X.db().recipes) || []).forEach(function (r) {
        var p = r && X.productById(r.productId);
        if (!p || isSingleP(p)) return;
        var f = num(CMSStock.giftForecast(p.id));
        if (f > 0) needBy[String(r.materialId)] = (needBy[String(r.materialId)] || 0) + f * num(r.qty);
      });
    }
    var ids = {}; Object.keys(cumM).forEach(function (k) { ids[k] = true; }); Object.keys(needBy).forEach(function (k) { ids[k] = true; });
    var trows = Object.keys(ids).map(function (k) { return { id: k, need: needBy[k] || 0, t: cumM[k] ? cumM[k].t : {} }; }).sort(ord);
    var tcols = [{ label: '包材', render: function (r) { return wrapText(X.materialLabel(r.id)); } }];
    if (withNeed) tcols.push({ label: '今年預估需要', num: true, render: function (r) { return r.need ? '<b>' + esc(fmt(r.need, 2)) + '</b>' : muted('—'); } });
    TYPE_KEYS.forEach(function (k) { tcols.push({ label: '累計' + TYPES[k].label, num: true, render: function (r) { return r.t[k] ? esc(fmt(r.t[k], 2)) : muted('—'); } }); });
    if (withNeed) {
      tcols.push({ label: '還差（預估需要 － 累計折盒）', num: true, render: function (r) { if (!r.need) return muted('—'); var left = r.need - (r.t.fold || 0); return left > 0 ? '<b style="color:var(--bad)">' + esc(fmt(left, 2)) + '</b>' : X.ui.tag('已折夠', 'ok'); } });
      tcols.push({ label: '完成率', num: true, render: function (r) { return r.need ? esc(fmt((r.t.fold || 0) / r.need * 100, 1)) + '%' : muted('—'); } });
    }
    var gcols = [
      { label: '禮盒品項', render: function (r) { return r.total ? '<b>合計</b>' : wrapText((r.p.code ? r.p.code + ' ' : '') + (r.p.name || '')); } },
      { label: '今年預估盒數', num: true, render: function (r) { return r.total ? '<b>' + esc(fmt(r.boxes, 2)) + '</b>' : esc(fmt(r.boxes, 2)); } }
    ];
    giftRows.sort(function (a, b) { return b.boxes - a.boxes; });
    var gtable = withNeed ? '<p style="margin:0 0 4px"><b>今年預估（各禮盒品項）</b></p>' + X.ui.table(gcols, giftRows.length ? giftRows.concat([{ total: true, boxes: giftBoxes }]) : [], { empty: '業績預估還沒有填預估量。' }) : '';
    top.innerHTML = gtable + '<p style="margin:' + (withNeed ? '14px' : '0') + ' 0 4px"><b>' + (withNeed ? '各包材品項：預估需要與累計' : '各包材品項：累計') + '</b></p>' + X.ui.table(tcols, trows, { empty: '還沒有登記，也沒有預估需要的包材。' }) +
      '<p class="small" style="margin:6px 0 12px">這一區是固定的合計，不受下面的日期區間影響。' + (withNeed ? '今年預估需要＝業績預估裡每個禮盒所有日期、所有部門的預估盒數 × 配方裡這個包材的用量，全部禮盒加總（目前檔期，和首頁「銷售預估」同一個數字）；累計是所有登記合計。' : '累計是所有登記合計。') + '已撤銷的不算。</p>';
    // ---- 下：日期區間，逐日看 ----
    var from = qe.from, to = qe.to;
    if (!dateOk(from) || !dateOk(to)) { out.innerHTML = X.ui.banner('info', '請選好起、迄兩個日期。'); return; }
    if (from > to) { out.innerHTML = X.ui.banner('warn', '「起」不能晚於「迄」。'); return; }
    var tot = {}, byD = Object.create(null), n = 0, rangeM = Object.create(null);
    TYPE_KEYS.forEach(function (k) { tot[k] = 0; });
    recs.forEach(function (r) {
      var dt = String(r.date || '').slice(0, 10);
      if (dt < from || dt > to) return;
      var q = num(r.qty); n++; tot[r.type] += q;
      var rm = rangeM[String(r.materialId)] || (rangeM[String(r.materialId)] = { id: r.materialId, t: {} }); rm.t[r.type] = (rm.t[r.type] || 0) + q;
      var dd = byD[dt] || (byD[dt] = { t: {}, m: Object.create(null) }); dd.t[r.type] = (dd.t[r.type] || 0) + q;
      var mm = dd.m[String(r.materialId)] || (dd.m[String(r.materialId)] = { id: r.materialId, t: {} }); mm.t[r.type] = (mm.t[r.type] || 0) + q;
    });
    var deptRows = [], hasDept = false, dm = Object.create(null);
    if (cfg.dept) {
      recs.forEach(function (r) {
        var dt = String(r.date || '').slice(0, 10);
        if (dt < from || dt > to) return;
        var k = String(r.dept || '').trim();
        if (k) hasDept = true;
        var e = dm[k || '（未填）'] || (dm[k || '（未填）'] = { name: k || '（未填）', t: {} });
        e.t[r.type] = (e.t[r.type] || 0) + num(r.qty);
      });
      deptRows = Object.keys(dm).map(function (k) { return dm[k]; }).sort(function (a, b) { return a.name === '（未填）' ? 1 : (b.name === '（未填）' ? -1 : String(a.name).localeCompare(String(b.name), 'zh-TW')); });
    }
    var dcolsDept = [{ label: '折盒部門', render: function (r) { return wrapText(r.name); } }].concat(TYPE_KEYS.map(function (k) {
      return { label: TYPES[k].label, num: true, render: function (r) { return r.t[k] ? esc(fmt(r.t[k], 2)) : muted('—'); } };
    }));
    var dkeys = Object.keys(byD).sort().reverse(), span = X.daysBetween(from, to) + 1;
    var rcols = [{ label: '包材品項', render: function (r) { return r.total ? '<b>全部合計</b>' : wrapText(X.materialLabel(r.id)); } }].concat(TYPE_KEYS.map(function (k) {
      return { label: TYPES[k].label, num: true, render: function (r) { var v = r.t[k]; return v ? (r.total ? '<b>' + esc(fmt(v, 2)) + '</b>' : esc(fmt(v, 2))) : muted('—'); } };
    }));
    var dcols = [{ label: '日期', render: function (k) { return esc(slashDate(k)); } }]
      .concat(TYPE_KEYS.map(function (t) { return { label: TYPES[t].label, num: true, render: function (k) { return byD[k].t[t] ? esc(fmt(byD[k].t[t], 2)) : muted('—'); } }; }))
      .concat([{ label: '各包材（這一天做了多少）', render: function (k) {
        var ms = Object.keys(byD[k].m).map(function (x) { return byD[k].m[x]; }).sort(ord);
        return '<span style="white-space:normal">' + ms.map(function (m) { return esc(nameOfMaterial(m.id)) + ' ' + TYPE_KEYS.filter(function (t) { return m.t[t]; }).map(function (t) { return esc(TYPES[t].label) + ' <b>' + esc(fmt(m.t[t], 2)) + '</b>'; }).join('、'); }).join('；') + '</span>';
      } }]);
    out.innerHTML = '<p style="margin:0 0 6px"><b>每一天做了多少</b>　<span class="small">' + esc(slashDate(from)) + ' ～ ' + esc(slashDate(to)) + '（共 ' + span + ' 天，有登記的 ' + dkeys.length + ' 天、' + n + ' 筆）</span></p>' +
      '<p style="margin:0 0 4px"><b>這段期間各包材品項合計</b></p>' + X.ui.table(rcols, Object.keys(rangeM).map(function (k) { return rangeM[k]; }).sort(ord).concat(Object.keys(rangeM).length ? [{ total: true, t: tot }] : []), { empty: '這段期間沒有登記' }) +
      (hasDept ? '<p style="margin:12px 0 4px"><b>這段期間依折盒部門</b></p>' + X.ui.table(dcolsDept, deptRows, {}) : '') +
      '<p style="margin:12px 0 4px"><b>逐日明細</b></p>' +
      (dkeys.length ? X.ui.table(dcols, dkeys, {}) : X.ui.empty('這段期間沒有登記'));
  }

  function renderLinksCard(el) {
    var box = q$(el, '[data-box="qe-links"]');
    if (!box) return;
    var admin = X.isAdmin(), rules = list('materialLinks');
    var cols = [
      { label: '來源（做了這個）', render: function (l) { return wrapText(nameOfMaterial(l.fromMaterialId)) + ' ' + X.ui.tag(typeLabel(l.fromType), 'info'); } },
      { label: '連動（就會這個）', render: function (l) { return wrapText(nameOfMaterial(l.toMaterialId)) + ' ' + X.ui.tag(typeLabel(l.toType), 'warn'); } },
      { label: '比例', num: true, render: function (l) { return '1 : ' + esc(fmt(linkRatio(l), 2)); } },
      { label: '怎麼連動', render: function (l) { return '<span class="small" style="white-space:normal">' + (TYPE_KEYS.indexOf(l.fromType) >= 0 && TYPE_KEYS.indexOf(l.toType) >= 0 ? '同一頁：連動那格自動填入（可以改）' : '送出時自動多記一筆「' + esc(typeLabel(l.toType)) + '」（不能單獨修改，來源撤銷會一起撤銷）') + '</span>'; } },
      { label: '狀態', render: function (l) { return l.active === false ? X.ui.tag('停用', 'muted') : X.ui.tag('啟用', 'ok'); } }
    ];
    if (admin) cols.push({ label: '', render: function (l) { return '<div class="x-row-actions"><button type="button" class="btn gray" data-act="lk-edit" data-id="' + esc(l.id) + '">編輯</button> <button type="button" class="btn red" data-act="lk-del" data-id="' + esc(l.id) + '">刪除</button></div>'; } });
    var acts = admin ? '<button type="button" class="btn primary" data-act="lk-new" style="min-height:34px">新增連動規則</button>' + (rules.length ? '' : ' <button type="button" class="btn gray" data-act="lk-seed" style="min-height:34px">依名稱建立預設規則</button>') : '';
    box.innerHTML = X.ui.card('連動規則（自動填入）', X.ui.table(cols, rules, { empty: '還沒有連動規則。' + (admin ? '按「新增連動規則」，或「依名稱建立預設規則」（共用袖套盒蛋捲折盒 → 共用蛋捲內襯使用；共用袖套盒廢雪使用 → 共用袖套盒放入廢雪隔板使用）。' : '') }) +
      '<p class="small" style="margin:8px 0 0">例：共用袖套盒（蛋捲）<b>折盒</b> 1 個，就會耗 1 個共用蛋捲內襯（<b>使用</b>）；共用袖套盒（廢雪）<b>使用</b> 1 個，就會用 1 個共用袖套盒放入廢雪隔板（<b>使用</b>）。' +
      '連動的紀錄不用再自己填，重複填會重複計算。' + (admin ? '' : '規則只有管理員能改。') + '</p>', acts);
  }
  function linkDialog(el, rec) {
    var mats = X.materials().filter(function (m) { return m && (m.status !== 'archived' || (rec && (sameId(rec.fromMaterialId, m.id) || sameId(rec.toMaterialId, m.id)))); });
    var mopts = [{ value: '', label: '（選擇包材）' }].concat(mats.map(function (m) { return { value: m.id, label: (m.code ? m.code + ' ' : '') + (m.name || X.materialLabel(m)) }; }));
    var topts = ALL_TYPE_KEYS.map(function (k) { return { value: k, label: TYPES[k].label }; });
    X.ui.dialog(rec ? '編輯連動規則' : '新增連動規則', [
      { name: 'fromMaterialId', label: '來源包材（做了這個）', type: 'select', options: mopts, value: rec ? rec.fromMaterialId : '', required: true },
      { name: 'fromType', label: '來源類型', type: 'select', options: topts, value: rec ? rec.fromType : 'fold' },
      { name: 'toMaterialId', label: '連動包材（就會這個）', type: 'select', options: mopts, value: rec ? rec.toMaterialId : '', required: true },
      { name: 'toType', label: '連動類型', type: 'select', options: topts, value: rec ? rec.toType : 'use' },
      { name: 'ratio', label: '比例：來源每 1 個，連動包材用幾個', type: 'number', value: rec ? linkRatio(rec) : 1, min: 0.01, step: 'any', required: true },
      { name: 'note', label: '備註', type: 'text', value: rec ? rec.note || '' : '' },
      { name: 'active', label: '啟用中', type: 'checkbox', value: rec ? rec.active !== false : true, full: true }
    ], function (f) {
      if (!f.fromMaterialId || !f.toMaterialId) { X.toast('請選來源包材和連動包材'); return false; }
      if (sameId(f.fromMaterialId, f.toMaterialId) && f.fromType === f.toType) { X.toast('來源和連動不能是同一個包材、同一個類型'); return false; }
      if (!(f.ratio > 0)) { X.toast('比例要大於 0'); return false; }
      var all = X.ensure('materialLinks');
      if (all.some(function (x) { return isObj(x) && (!rec || x.id !== rec.id) && sameId(x.fromMaterialId, f.fromMaterialId) && x.fromType === f.fromType && sameId(x.toMaterialId, f.toMaterialId) && x.toType === f.toType; })) { X.toast('已經有一樣的規則了'); return false; }
      var l = rec ? all.find(function (x) { return isObj(x) && x.id === rec.id; }) : null;
      if (rec && !l) { X.toast('找不到這條規則，可能已被刪除'); return false; }
      if (!l) { l = { id: X.uid('ml') }; all.push(l); }
      l.fromMaterialId = f.fromMaterialId; l.fromType = f.fromType; l.toMaterialId = f.toMaterialId; l.toType = f.toType; l.ratio = f.ratio; l.note = f.note; l.active = !!f.active; l.by = X.userName(); l.at = Date.now();
      X.save({ silent: true }); X.toast(rec ? '已更新連動規則' : '已新增連動規則'); refreshQuickEntry(el);
    });
  }

  function bindQuickEntry(el) {
    el.onclick = function (e) {
      var a = actOf(e);
      if (!a || a.disabled) return;
      var act = a.dataset.act;
      if (act === 'qe-submit') submitQuick(el);
      else if (act === 'qe-clear') clearQuick(el, true);
      else if (act === 'rg-today' || act === 'rg-7' || act === 'rg-month') {
        var t0 = X.today();
        qe.to = t0; qe.from = act === 'rg-today' ? t0 : (act === 'rg-7' ? shiftDate(t0, -6) : t0.slice(0, 8) + '01');
        var fi = q$(el, '[data-qe="from"]'), ti = q$(el, '[data-qe="to"]'); if (fi) fi.value = qe.from; if (ti) ti.value = qe.to;
        updateQeRange(el);
      }
      else if (act === 'dept-edit') editDeptsDialog(el);
      else if (act === 'lk-new') linkDialog(el, null);
      else if (act === 'lk-edit') { var lr = list('materialLinks').find(function (x) { return sameId(x.id, a.dataset.id); }); if (lr) linkDialog(el, lr); }
      else if (act === 'lk-del') {
        var all = X.ensure('materialLinks'), li = all.findIndex(function (x) { return isObj(x) && sameId(x.id, a.dataset.id); });
        if (li >= 0 && confirm('確定刪除這條連動規則嗎？已經登記的紀錄不會變。')) { all.splice(li, 1); X.save({ silent: true }); X.toast('已刪除'); refreshQuickEntry(el); }
      }
      else if (act === 'lk-seed') { var d0 = X.db(); if (d0) d0.materialLinksSeeded = false; seedLinks(); if (list('materialLinks').length) X.toast('已建立預設連動規則'); else X.toast('找不到名稱對得上的包材，請用「新增連動規則」自己選'); refreshQuickEntry(el); }
      else if (act === 'view-today') setQeView(el, X.today());
      else if (act === 'view-prev') setQeView(el, shiftDate(effDate(qe.view), -1));
      else if (act === 'view-next') setQeView(el, shiftDate(effDate(qe.view), 1));
      else if (act === 'edit-one') editQuick(el, a.dataset.id);
      else if (act === 'void-batch') { voidBatch('movements', a.dataset.batch, '登記'); refreshQuickEntry(el); }
      else if (act === 'void-one') { voidOne('movements', a.dataset.id, '登記'); refreshQuickEntry(el); }
    };
    el.oninput = function (e) {
      var t = e.target;
      if (!t || !t.dataset) return;
      if (t.dataset.mv) { keepQeCell(t); applyLiveLinks(el, t); updateQeCount(el); }
      else if (t.dataset.qe === 'note') qe.note = t.value;
    };
    el.onchange = function (e) {
      var t = e.target;
      if (!t || !t.dataset) return;
      if (t.dataset.qe === 'view') setQeView(el, t.value);
      else if (t.dataset.qe === 'dept') { if (t.value === '__new__') addDeptDialog(el); else setDept(el, t.value); }
      else if (t.dataset.qe === 'from' || t.dataset.qe === 'to') { if (dateOk(t.value)) { qe[t.dataset.qe] = t.value; updateQeRange(el); } }
      else if (t.dataset.mv) { keepQeCell(t); applyLiveLinks(el, t); updateQeCount(el); }
      else if (t.dataset.qe === 'note') qe.note = t.value;
    };
  }

  // 換「查詢」的日期（紀錄區）：只有日期真的變了才更新；打到一半或不合理的日期先不動。登記永遠是今天
  function setQeView(el, v) {
    if (!dateOk(v)) return;
    var next = keepDate(v);
    if (next === qe.view) return;
    qe.view = next;
    refreshQuickEntry(el);
  }

  // 依目前日期更新：日期提示、各列「已登記」小字、紀錄區、已填格數（輸入框本身不重畫）
  function refreshQuickEntry(el) {
    var d = X.today(), vd = effDate(qe.view);
    var td = q$(el, '[data-qe="today"]');
    if (td) td.value = slashDate(d) + '（今天）';
    var all = list('movements');
    var sums = summarizeMovements(all, d, orderedMaterials()), byMid = Object.create(null);
    sums.forEach(function (s) { byMid[String(s.materialId)] = s; });
    q$$(el, '[data-box="qe-done"]').forEach(function (box) {
      var row = box.closest('[data-mid]'), s = row ? byMid[String(row.dataset.mid)] : null;
      box.textContent = s ? '今天已登記：' +
        TYPE_KEYS.filter(function (k) { return s[k] > 0; }).map(function (k) { return TYPES[k].label + ' ' + fmt(s[k], 2); }).join('、') : '';
    });
    renderQeRecords(el, all, vd, summarizeMovements(all, vd, orderedMaterials()));
    updateQeRange(el);
    refreshDeptSelect(el);
    renderLinksCard(el);
    updateQeCount(el);
  }

  function renderQeRecords(el, all, d, sums) {
    var box = q$(el, '[data-box="qe-records"]');
    if (!box) return;
    var open = openKeys(box), isToday = d === X.today(), locked = !isToday;
    var mine = function (r) { return TYPE_KEYS.indexOf(r.type) >= 0; };
    var batches = groupBatches(dayRecords(all, d).filter(mine));
    var o = { unit: QE_BATCH.unit, count: QE_BATCH.count, item: QE_BATCH.item, line: QE_BATCH.line, locked: locked, edit: true };
    var body = (locked ? X.ui.banner('info', slashDate(d) + ' 已經過去了，這一天的紀錄已<b>鎖定</b>，只能查看，不能修改或撤銷。') : '') +
      (batches.length
        ? '<div class="x-qe-batches">' + batches.map(function (g) { return batchHtml('x-qe', g, open, o); }).join('') + '</div>' +
          '<p class="small" style="margin:10px 0 0">同一次送出的算一批。' + (locked ? '' : '今天的紀錄可以按「修改」改數量或備註，也可以「撤銷」（撤銷的紀錄會保留並加上刪除線，不再計算）；') + '<b>超過當天就會鎖定，不能再修改。</b></p>'
        : X.ui.empty(isToday ? '今天還沒有登記' : '這一天沒有登記'));
    var cols = [{ label: '包材', render: function (r) { return wrapText(X.materialLabel(r.materialId)); } }].concat(TYPE_KEYS.map(function (k) {
      return { label: TYPES[k].label, num: true, render: function (r) { return r[k] ? esc(fmt(r[k], 2)) : muted('—'); } };
    }));
    var rowsMine = sums.filter(function (r) { return TYPE_KEYS.some(function (k) { return r[k] > 0; }); });
    var btn = function (act, text) { return '<button type="button" class="btn gray" data-act="' + act + '" style="min-height:34px;padding:4px 10px">' + text + '</button>'; };
    var ctrl = '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:flex-end">' + btn('view-prev', '前一天') +
      '<input type="date" data-qe="view" aria-label="查詢日期" value="' + esc(d) + '" style="padding:6px;border:1px solid var(--line-strong);border-radius:8px;font:inherit">' + btn('view-next', '後一天') +
      (isToday ? X.ui.tag('今天（可修改）', 'info') : btn('view-today', '回到今天') + X.ui.tag('已鎖定', 'muted')) + '</div>';
    box.innerHTML = X.ui.card('這一天的紀錄（' + cfg.short + '）', body, ctrl) +
      logCard(d) +
      X.ui.card('這一天各包材小計（' + cfg.short + '）', X.ui.table(cols, rowsMine, { empty: '這一天還沒有登記' }) +
        '<p class="small" style="margin:8px 0 0">已撤銷的不算。這些數量都已經算進首頁的包材庫存（進貨加未折盒；折盒從未折盒移到已折盒；使用、使用NG 扣已折盒；折盒NG 扣未折盒）。</p>', slashDate(d) + (isToday ? ' 今天' : ' 已鎖定'));
  }

  // 修改歷程（追查用）：這一天的紀錄被修改、撤銷的每一次，只增不改，鎖定的日子也查得到
  function logCard(d) {
    var rows = list('movementLog').filter(function (e) { return e.date === d && TYPE_KEYS.indexOf(e.type) >= 0; }).sort(function (a, b) { return num(b.at) - num(a.at); });
    var when = function (ms) { var t = new Date(Number(ms)); return isNaN(t.getTime()) ? '' : (t.getMonth() + 1) + '/' + t.getDate() + ' ' + hhmm(ms); };
    var change = function (e) {
      if (e.action === 'void') return '撤銷這筆（原數量 ' + fmt(e.fromQty, 2) + '）';
      var out = [];
      if (num(e.fromQty) !== num(e.toQty)) out.push('數量 ' + fmt(e.fromQty, 2) + ' → <b>' + esc(fmt(e.toQty, 2)) + '</b>');
      if (String(e.fromNote || '') !== String(e.toNote || '')) out.push('備註「' + esc(e.fromNote || '') + '」→「' + esc(e.toNote || '') + '」');
      return out.join('；') || '（沒有變動）';
    };
    var cols = [
      { label: '修改時間', render: function (e) { return esc(when(e.at)); } },
      { label: '修改人', render: function (e) { return esc(e.by || '—'); } },
      { label: '動作', render: function (e) { return X.ui.tag(e.action === 'void' ? '撤銷' : '修改', e.action === 'void' ? 'bad' : 'warn'); } },
      { label: '包材', render: function (e) { return wrapText(X.materialLabel(e.materialId)); } },
      { label: '項目', render: function (e) { return esc(typeLabel(e.type)); } },
      { label: '修改前 → 修改後', render: function (e) { return '<span style="white-space:normal">' + (e.action === 'void' ? esc(change(e)) : change(e)) + '</span>'; } }
    ];
    return X.ui.card('修改歷程（追查用，' + rows.length + ' 筆）', X.ui.table(cols, rows, { empty: '這一天沒有人修改或撤銷過紀錄' }) +
      '<p class="small" style="margin:8px 0 0">每次修改、撤銷都會留下時間、修改人和修改前後的內容，不能刪除或更改；超過當天鎖定後，歷程仍然查得到。</p>', slashDate(d));
  }

  // 修改今天的一筆紀錄（數量、備註）；超過當天就鎖定，不能改
  function editQuick(el, id) {
    var rec = X.ensure('movements').find(function (r) { return isObj(r) && sameId(r.id, id); });
    if (!rec || rec.voided === true) return;
    if (rec.auto === true) { X.toast('這是連動自動登記的紀錄，請修改來源那筆'); return; }
    if (rec.date !== X.today()) { X.toast('已超過當日，這筆紀錄已鎖定，不能修改'); refreshQuickEntry(el); return; }
    X.ui.dialog('修改：' + nameOfMaterial(rec.materialId) + ' ' + typeLabel(rec.type), [
      { name: 'qty', label: '數量（' + typeLabel(rec.type) + '）', type: 'number', value: rec.qty, min: 1, step: 1, required: true },
      { name: 'note', label: '備註', type: 'text', value: rec.note || '' }
    ], function (f) {
      var p = parseQty(f.qty == null ? '' : String(f.qty));
      if (p.empty || p.bad || !(p.qty > 0)) { X.toast('數量要是 1 以上的整數；要取消這筆請用「撤銷」'); return false; }
      if (rec.date !== X.today()) { X.toast('已超過當日，這筆紀錄已鎖定，不能修改'); return false; }
      var old = { qty: rec.qty, note: rec.note, editedAt: rec.editedAt, editedBy: rec.editedBy };
      var newNote = String(f.note || '').trim().slice(0, 100);
      if (p.qty === old.qty && newNote === String(old.note || '')) { X.toast('內容沒有改變'); return; }
      var entry = logEntry('edit', rec, { qty: old.qty, note: old.note }, { qty: p.qty, note: newNote });
      X.ensure('movementLog').push(entry);
      rec.qty = p.qty; rec.note = newNote; rec.editedAt = Date.now(); rec.editedBy = X.userName();
      // 連動自動登記的紀錄跟著來源的新數量重算
      var lkd = linkedRecs([rec]).map(function (a) { return { a: a, qty: a.qty, to: Math.max(0, Math.round(p.qty * (num(a.ratio) > 0 ? num(a.ratio) : 1))) }; }).filter(function (x) { return x.to > 0 && x.to !== x.qty; });
      var lkLogs = lkd.map(function (x) { var e = logEntry('edit', x.a, { qty: x.qty, note: x.a.note }, { qty: x.to, note: x.a.note }); X.ensure('movementLog').push(e); x.a.qty = x.to; return e; });
      if (!X.save({ silent: true })) { rec.qty = old.qty; rec.note = old.note; rec.editedAt = old.editedAt; rec.editedBy = old.editedBy; lkd.forEach(function (x) { x.a.qty = x.qty; }); dropLogs([entry].concat(lkLogs)); return false; }
      X.toast('已修改，修改歷程已記錄');
      refreshQuickEntry(el);
    }, '儲存修改');
  }

  // 同頁面的連動規則（來源、連動的類型都在這個頁面）：來源格有數字，連動那一格就自動填入（來源 × 比例，四捨五入）；自己改過那一格就不再自動覆蓋
  function applyLiveLinks(el, changed) {
    var rules = linkRules().filter(function (l) { return TYPE_KEYS.indexOf(l.fromType) >= 0 && TYPE_KEYS.indexOf(l.toType) >= 0; });
    if (!rules.length) return;
    var cell = function (mid, type) { return q$(el, '[data-mid="' + String(mid).replace(/"/g, '') + '"] input[data-mv="' + type + '"]'); };
    var tg = Object.create(null);
    rules.forEach(function (l) { var k = l.toMaterialId + '|' + l.toType; (tg[k] = tg[k] || { mid: l.toMaterialId, type: l.toType, rules: [] }).rules.push(l); });
    Object.keys(tg).forEach(function (k) {
      var t = tg[k], inp = cell(t.mid, t.type);
      if (!inp) return;
      if (changed && changed === inp) { qe.auto[k] = false; return; } // 使用者自己改這一格：之後不再自動填
      if (qe.auto[k] === false) return;
      var sum = 0, any = false;
      t.rules.forEach(function (l) { var s = cell(l.fromMaterialId, l.fromType), p = s ? parseQty(s.value) : { empty: true }; if (!p.empty && !p.bad && p.qty > 0) { sum += linkQty(p.qty, l); any = true; } });
      if (!any && !qe.auto[k]) return;
      var v = sum > 0 ? String(sum) : '';
      if (inp.value === v) return;
      inp.value = v; qe.auto[k] = sum > 0;
      inp.title = '自動填入（連動規則），可以自己改';
      keepQeCell(inp, true);
    });
  }

  // 輸入時只記下數值、切換格子的顏色，並更新「已填 N 格」
  function keepQeCell(t, fromLink) {
    var row = t.closest('[data-mid]'), k = t.dataset.mv;
    if (!row || !TYPES[k]) return;
    var mid = row.dataset.mid;
    (qe.vals[mid] = qe.vals[mid] || {})[k] = t.value;
    var p = parseQty(t.value);
    t.classList.toggle('x-qe-on', !p.bad && p.qty > 0);
    t.classList.toggle('x-qe-bad', p.bad);
    row.classList.toggle('x-qe-row-on', q$$(row, 'input[data-mv]').some(function (i) { var x = parseQty(i.value); return !x.bad && x.qty > 0; }));
  }
  function qeCounts(el) {
    var n = 0, bad = 0;
    q$$(el, 'input[data-mv]').forEach(function (i) { var p = parseQty(i.value); if (p.bad) bad++; else if (p.qty > 0) n++; });
    return { n: n, bad: bad };
  }
  function updateQeCount(el) {
    var box = q$(el, '[data-box="qe-count"]');
    if (!box) return;
    var c = qeCounts(el);
    box.innerHTML = '已填 <b>' + c.n + '</b> 格' + (c.bad ? '<span class="x-qe-err">，' + c.bad + ' 格不正確（不能是負數）</span>' : '');
  }
  function clearQuick(el, ask) {
    var c = qeCounts(el);
    if (ask && c.n && !confirm('要清除已填的 ' + c.n + ' 格數字嗎？\n還沒送出的內容會不見。')) return;
    qe.vals = Object.create(null); qe.auto = Object.create(null);
    q$$(el, 'input[data-mv]').forEach(function (i) { i.value = ''; i.title = ''; i.classList.remove('x-qe-on'); i.classList.remove('x-qe-bad'); });
    q$$(el, '.x-qe-row-on').forEach(function (r) { r.classList.remove('x-qe-row-on'); });
    updateQeCount(el);
  }

  function submitQuick(el) {
    var date = X.today(); // 只能登記今天（超過當天就鎖定，不能補登或修改）
    var items = [], bad = [], rounded = 0, big = false;
    var warnQty = window.CMSRules ? CMSRules.get('quickEntryWarnQty') : 100000; // 多打 0 的提醒門檻：見「計算規則」
    q$$(el, 'input[data-mv]').forEach(function (inp) {
      var p = parseQty(inp.value);
      if (p.empty) return;
      if (p.bad) { bad.push(inp); return; }
      if (!(p.qty > 0)) return;
      var row = inp.closest('[data-mid]'), m = row ? X.materialById(row.dataset.mid) : null;
      if (!m || !TYPES[inp.dataset.mv]) return;
      if (p.rounded) rounded++;
      if (p.qty >= warnQty) big = true;
      items.push({ m: m, type: inp.dataset.mv, qty: p.qty });
    });
    if (bad.length) {
      alert('數量不能是負數，請修正這 ' + bad.length + ' 格：\n' + bad.slice(0, 8).map(function (i) { return i.getAttribute('aria-label') || ''; }).join('、') + (bad.length > 8 ? ' 等' : ''));
      focusEl(bad[0]);
      return;
    }
    if (!items.length) { alert('還沒有填任何數量。\n請在要登記的包材格子裡填上數量（大於 0）。'); return; }
    var noteEl = q$(el, '[data-qe="note"]');
    var note = String(noteEl ? noteEl.value : qe.note).trim().slice(0, 100);
    var deptSel = q$(el, 'select[data-qe="dept"]'), foldDept = cfg.dept ? String(deptSel && deptSel.value !== '__new__' ? deptSel.value : qe.dept || '').trim() : '';
    var names = items.map(function (it) { return (it.m.name || X.materialLabel(it.m)) + ' ' + typeLabel(it.type) + ' ' + fmt(it.qty); });
    // 連動：連動的類型不在這個頁面的規則，送出時自動多記一筆（同頁面的規則已經在格子裡自動填入了）
    var pending = [];
    items.forEach(function (it) {
      linkRules().forEach(function (l) {
        if (!sameId(l.fromMaterialId, it.m.id) || l.fromType !== it.type || TYPE_KEYS.indexOf(l.toType) >= 0) return;
        var q = linkQty(it.qty, l), tm = X.materialById(l.toMaterialId);
        if (q > 0 && tm) pending.push({ it: it, l: l, q: q, m: tm });
      });
    });
    var msg = slashDate(date) + ' 共 ' + items.length + ' 筆：' + names.slice(0, 8).join('、') + (names.length > 8 ? ' 等 ' + names.length + ' 筆' : '');
    if (pending.length) msg += '\n\n連動自動登記 ' + pending.length + ' 筆：' + pending.map(function (x) { return (x.m.name || X.materialLabel(x.m)) + ' ' + typeLabel(x.l.toType) + ' ' + fmt(x.q); }).join('、');
    if (date !== X.today()) msg += '\n\n注意：日期不是今天。';
    if (cfg.dept) msg += '\n折盒部門：' + (foldDept || '（未選）');
    if (note) msg += '\n備註：' + note;
    if (rounded) msg += '\n有 ' + rounded + ' 格填了小數，已四捨五入成整數。';
    if (big) msg += '\n有數量在 ' + fmt(warnQty) + ' 以上，請確認沒有多打 0。';
    if (!confirm(msg + '\n\n確定送出嗎？')) return;

    var batchId = X.uid('mb'), at = Date.now(), by = X.userName();
    var ids = freshIds('mv', items.length, X.get('movements'));
    var recs = items.map(function (it, i) {
      var rec0 = { id: ids[i], batchId: batchId, at: at, by: by, date: date, materialId: it.m.id, type: it.type, qty: it.qty, note: note, voided: false };
      if (foldDept) rec0.dept = foldDept;
      return rec0;
    });
    if (pending.length) {
      var lids = freshIds('mv', pending.length, X.get('movements').concat(recs));
      pending.forEach(function (x, i) {
        var src = recs[items.indexOf(x.it)];
        recs.push({ id: lids[i], batchId: 'ln-' + batchId, at: at, by: by, date: date, materialId: x.m.id, type: x.l.toType, qty: x.q, note: ('連動：' + (x.it.m.name || X.materialLabel(x.it.m)) + ' ' + typeLabel(x.it.type) + ' ' + fmt(x.it.qty)).slice(0, 100), voided: false, auto: true, srcId: src.id, linkId: x.l.id, ratio: linkRatio(x.l) });
        if (foldDept) recs[recs.length - 1].dept = foldDept;
      });
    }
    if (!pushRecords('movements', recs)) return;
    // 送出成功：清空輸入，紀錄區切到這次的日期
    qe.view = '';
    qe.note = '';
    if (noteEl) noteEl.value = '';
    clearQuick(el, false);
    refreshQuickEntry(el);
    X.toast('已登記 ' + recs.length + ' 筆' + (pending.length ? '（含連動自動登記 ' + pending.length + ' 筆）' : '') + (date !== X.today() ? '（' + shortDate(date) + '）' : ''));
  }
    return renderQuickEntry;
  }
  var renderQuickFold = makeQuick({
    types: ['fold', 'foldNg', 'inNg'], short: '折盒', dept: true, title: '步驟一：折盒（物管）',
    intro: '步驟一（物管使用）：登記今天折盒（折盒完成）、折盒NG（折壞）和進貨NG（廠商送來就不良）。每種包材有「折盒、折盒NG、進貨NG」三格，有做的才填數量，沒做的留白，填完按最下面的「全部送出」。進貨、使用、使用NG 在「進貨與使用」。只能登記今天；今天的紀錄可以修改，超過當天就鎖定。'
  });
  var renderQuickStock = makeQuick({
    types: ['in', 'use', 'useNg'], short: '進貨與使用', title: '步驟二：進貨與使用（倉管）',
    intro: '步驟二（倉管使用）：登記今天的進貨（廠商送來的未折盒）、使用（裝盒用掉已折盒）和使用NG（裝壞）。每種包材有「進貨、使用、使用NG」三格，有做的才填數量，沒做的留白，填完按最下面的「全部送出」。折盒、折盒NG 在「折盒」。只能登記今天；今天的紀錄可以修改，超過當天就鎖定。'
  });

  // =====================================================================
  // 頁面二：盤點（xStocktake）
  // =====================================================================
  var stv = { openId: '', filter: 'all', q: '' };
  var ST_STATUS = { draft: ['盤點中', 'warn'], confirmed: ['已確認', 'ok'] };
  function stFilters() { return [['all', '全部'], ['todo', '未填完'], ['diff', '有差異'], ['big', '差異超過 ' + diffPctText()]]; }

  function findStocktake(arr, id) { return (arr || []).find(function (s) { return isObj(s) && sameId(s.id, id); }) || null; }
  function statusTag(s) { var t = ST_STATUS[s.status] || ST_STATUS.draft; return X.ui.tag(t[0], t[1]); }

  function renderStocktake(el) {
    var all = list('stocktakes');
    var rec = stv.openId ? findStocktake(all, stv.openId) : null;
    if (stv.openId && !rec) stv.openId = '';
    el.innerHTML = intro('定期清點包材，把實際數到的數量和系統帳面數比對，找出差異。') + (rec ? stDetailHtml(rec) : stListHtml(all));
    if (rec) applySearch(el);

    el.onclick = function (e) {
      var a = actOf(e);
      if (!a || a.disabled) return;
      var act = a.dataset.act;
      if (act === 'st-new') newStocktake();
      else if (act === 'st-open') { stv.openId = a.dataset.id; stv.filter = 'all'; stv.q = ''; renderStocktake(el); window.scrollTo(0, 0); }
      else if (act === 'st-back') { stv.openId = ''; renderStocktake(el); }
      else if (act === 'st-del') deleteStocktake(a.dataset.id);
      else if (act === 'st-confirm') confirmStocktake(el);
    };
    el.onchange = function (e) {
      var t = e.target;
      if (!t || !t.dataset) return;
      if (t.dataset.count) saveCount(el, t);
      else if (t.dataset.act === 'st-filter') { stv.filter = t.value; renderStocktake(el); }
    };
    el.oninput = function (e) {
      var t = e.target;
      if (t && t.dataset && t.dataset.act === 'st-search') { stv.q = t.value; applySearch(el); }
    };
  }

  function stListHtml(all) {
    var rows = all.map(function (s, i) { return { s: s, i: i, k: stocktakeStats(s) }; }).sort(function (a, b) {
      return String(b.s.date || '').localeCompare(String(a.s.date || '')) || b.i - a.i;
    });
    var cols = [
      { label: '盤點日期', render: function (r) { return '<b>' + esc(r.s.date || '—') + '</b>' + (r.s.note ? smallLine(r.s.note) : ''); } },
      { label: '狀態', render: function (r) { return statusTag(r.s); } },
      { label: '建立者', render: function (r) { return esc(r.s.by); } },
      { label: '已填', num: true, render: function (r) { return esc(r.k.done + ' / ' + r.k.total); } },
      { label: '差異項目數', num: true, render: function (r) {
        if (!r.k.diff) return esc(r.k.done ? '0' : '—');
        return '<b style="color:var(--bad)">' + esc(r.k.diff) + '</b>' + (r.k.big ? smallLine('超過 ' + diffPctText() + '：' + r.k.big) : '');
      } },
      { label: '', render: function (r) {
        var draft = r.s.status !== 'confirmed';
        return '<div class="x-row-actions"><button type="button" class="btn primary" data-act="st-open" data-id="' + esc(r.s.id) + '" style="min-height:38px;padding:6px 14px">' + (draft ? '繼續盤點' : '查看') + '</button>' +
          '<button type="button" class="btn red" data-act="st-del" data-id="' + esc(r.s.id) + '" style="min-height:38px;padding:6px 14px">刪除</button></div>';
      } }
    ];
    var canNew = X.materials().filter(X.materialActive).length > 0;
    return X.ui.card('盤點紀錄', X.ui.table(cols, rows, { empty: '還沒有盤點紀錄，按「開始新的盤點」建立。' }) +
      '<p class="small" style="margin:8px 0 0">差異項目數＝實盤合計和帳面合計不一樣的包材數。盤點紀錄都可以刪除；已確認的盤點刪除前會再確認一次。</p>',
      '<button type="button" class="btn primary" data-act="st-new" style="min-height:42px"' + (canNew ? '' : ' disabled title="請先建立包材資料"') + '>開始新的盤點</button>');
  }

  function stKpis(rec) {
    var k = stocktakeStats(rec), t = ST_STATUS[rec.status] || ST_STATUS.draft;
    return X.ui.kpis([
      { label: '盤點日期', value: rec.date || '—', tone: 'info', sub: t[0] },
      { label: '已填', value: k.done + ' / ' + k.total + ' 項', tone: k.total && k.done === k.total ? 'ok' : 'warn' },
      { label: '有差異', value: k.diff + ' 項', tone: k.diff ? 'warn' : 'ok' },
      { label: '差異超過 ' + diffPctText(), value: k.big + ' 項', tone: k.big ? 'bad' : 'ok' }
    ]);
  }
  function diffHtml(c) {
    if (!c.done) return muted(c.partial ? '未填完' : '—');
    if (c.diff === 0) return X.ui.tag('相符', 'ok');
    var pct = c.book ? Math.round(c.diff / Math.abs(c.book) * 1000) / 10 : null;
    return '<b style="color:' + (c.big ? 'var(--bad)' : 'var(--text-2)') + '">' + (c.diff > 0 ? '+' : '') + esc(fmt(c.diff, 2)) + '</b>' +
      (pct !== null ? '<div class="small" style="margin:2px 0 0">' + esc((pct > 0 ? '+' : '') + pct + '%') + '</div>' : '');
  }
  function countInput(field, it, label, ro) {
    return '<input type="number" min="0" step="any" inputmode="decimal" data-count="' + field + '" value="' + (filled(it[field]) ? esc(it[field]) : '') + '" aria-label="' + esc(label) + '"' + (ro ? ' disabled' : '') + ' style="min-height:40px">';
  }

  function stDetailHtml(rec) {
    var ro = rec.status === 'confirmed';
    var items = Array.isArray(rec.items) ? rec.items.filter(isObj) : [];
    var shown = items.filter(function (it) {
      var c = itemCheck(it);
      if (stv.filter === 'todo') return !c.done;
      if (stv.filter === 'diff') return c.done && c.diff !== 0;
      if (stv.filter === 'big') return c.big;
      return true;
    });
    var html = '<div class="toolbar"><button type="button" class="btn gray" data-act="st-back" style="min-height:42px">‹ 返回列表</button></div>';
    html += X.ui.banner('info', esc('確認後的盤點數之後會成為新的庫存起算點（後續階段串接）。'));
    html += '<div data-box="kpis">' + stKpis(rec) + '</div>';

    var meta = '建立者：' + (rec.by || '—') + (rec.note ? '｜備註：' + rec.note : '') +
      (ro ? '｜' + (rec.confirmedBy || '—') + ' 於 ' + X.fmtTime(rec.confirmedAt) + ' 確認' : '');
    var tip = ro ? '這次盤點已確認，數字不能再修改；如果不需要了可以刪除。'
      : '輸入實際數到的數量，離開欄位就自動儲存。沒有的請填 0，兩欄都要填才能確認。帳面數是建立這份盤點時的庫存。';
    var filterBar = '<div class="toolbar" style="align-items:center">' +
      '<select data-act="st-filter" aria-label="篩選" style="min-height:40px;border:1px solid var(--line-strong);border-radius:8px;padding:6px 10px;font:inherit">' +
      stFilters().map(function (f) { return '<option value="' + f[0] + '"' + (stv.filter === f[0] ? ' selected' : '') + '>' + esc(f[1]) + '</option>'; }).join('') + '</select>' +
      '<input type="search" data-act="st-search" placeholder="搜尋包材名稱或編號" value="' + esc(stv.q) + '" aria-label="搜尋包材" style="flex:1;min-width:150px;min-height:40px;border:1px solid var(--line-strong);border-radius:8px;padding:6px 10px;font:inherit;box-sizing:border-box">' +
      '</div>';
    var cols = [
      { label: '包材', render: function (it) { return wrapText(X.materialLabel(it.materialId)); } },
      { label: '帳面未折盒', num: true, render: function (it) { return esc(fmt(it.bookUnfolded, 2)); } },
      { label: '實盤未折盒', num: true, render: function (it) { return countInput('countUnfolded', it, X.materialLabel(it.materialId) + ' 實盤未折盒', ro); } },
      { label: '帳面已折盒', num: true, render: function (it) { return esc(fmt(it.bookFolded, 2)); } },
      { label: '實盤已折盒', num: true, render: function (it) { return countInput('countFolded', it, X.materialLabel(it.materialId) + ' 實盤已折盒', ro); } },
      { label: '差異', num: true, render: function (it) { return '<span data-diff="1">' + diffHtml(itemCheck(it)) + '</span>'; } }
    ];
    var table = tableX(cols, shown, {
      empty: items.length ? '沒有符合篩選條件的包材' : '這份盤點沒有包材',
      rowAttrs: function (it) {
        return ' data-mid="' + esc(it.materialId) + '" data-key="' + esc(X.materialLabel(it.materialId).toLowerCase()) + '"' +
          (itemCheck(it).big ? ' style="background:var(--bad-soft)"' : '');
      }
    });
    var foot = ro ? '<div class="toolbar" style="margin:14px 0 0"><button type="button" class="btn red" data-act="st-del" data-id="' + esc(rec.id) + '" style="min-height:48px">刪除這次盤點</button></div>' : '<div class="toolbar" style="margin:14px 0 0">' +
      '<button type="button" class="btn green" data-act="st-confirm" style="min-height:48px;min-width:150px;justify-content:center;font-weight:800">確認盤點</button>' +
      '<button type="button" class="btn red" data-act="st-del" data-id="' + esc(rec.id) + '" style="min-height:48px">刪除這份草稿</button></div>';
    html += X.ui.card('盤點明細', '<p class="small" style="margin:0 0 6px">' + esc(meta) + '</p>' +
      '<p class="small" style="margin:0 0 10px">' + esc(tip) + ' 差異＝實盤合計－帳面合計，超過帳面合計 ' + esc(diffPctText()) + ' 的列會標紅。</p>' +
      filterBar + '<p class="small" data-box="nohit" style="margin:0 0 8px;display:none">找不到符合的包材。</p>' + table + foot,
      ro ? '<button type="button" class="btn gray"' + LATER + '>設為庫存起算點</button>' : '<button type="button" class="btn gray"' + LATER + '>列印盤點單</button>');
    return html;
  }

  // 搜尋只隱藏列，不重畫（輸入框不會失去焦點）
  function applySearch(el) {
    var q = String(stv.q || '').trim().toLowerCase(), shown = 0;
    var rows = q$$(el, 'tr[data-key]');
    rows.forEach(function (tr) {
      var hit = !q || String(tr.dataset.key || '').indexOf(q) >= 0;
      tr.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    var n = q$(el, '[data-box="nohit"]');
    if (n) n.style.display = rows.length && !shown ? '' : 'none';
  }

  function newStocktake() {
    if (!X.materials().filter(X.materialActive).length) return;
    var drafts = list('stocktakes').filter(function (s) { return s.status !== 'confirmed'; });
    if (drafts.length && !confirm('目前已經有 ' + drafts.length + ' 份盤點中的草稿（' + drafts.map(function (s) { return s.date || '未填日期'; }).join('、') + '）。\n還要再開一份新的嗎？')) return;
    X.ui.dialog('開始新的盤點', [
      { name: 'date', label: '盤點日期', type: 'date', value: X.today(), required: true },
      { name: 'note', label: '備註', placeholder: '例：月底盤點、倉庫 A 區', full: true }
    ], function (v) {
      if (!isDate(v.date)) { alert('請選擇盤點日期。'); return false; }
      var rec = {
        id: X.uid('stk'), date: v.date, status: 'draft', by: X.userName(), confirmedBy: '', confirmedAt: null,
        note: String(v.note || '').slice(0, 100), items: buildStocktakeItems(X.materials().filter(X.materialActive), X.materialStock)
      };
      stv.openId = rec.id; stv.filter = 'all'; stv.q = '';
      if (pushRecord('stocktakes', rec)) X.toast('已建立盤點，帳面數取自目前庫存');
      else stv.openId = '';
    }, '開始盤點');
  }

  function deleteStocktake(id) {
    var arr = X.ensure('stocktakes');
    var i = arr.findIndex(function (s) { return isObj(s) && sameId(s.id, id); });
    if (i < 0) return;
    var rec = arr[i], k = stocktakeStats(rec), confirmed = rec.status === 'confirmed';
    var msg = confirmed
      ? '這份 ' + (rec.date || '') + ' 的盤點已經確認' + (rec.confirmedBy ? '（' + rec.confirmedBy + ' 確認）' : '') + '。\n確定要刪除嗎？刪除後所有同事都會看不到，無法復原。'
      : '確定要刪除 ' + (rec.date || '') + ' 的盤點草稿嗎？' + (k.done ? '\n已填的 ' + k.done + ' 項會一起刪除。' : '');
    if (!confirm(msg)) return;
    arr.splice(i, 1);
    if (sameId(stv.openId, id)) stv.openId = '';
    if (X.save()) X.toast(confirmed ? '已刪除盤點紀錄' : '已刪除盤點草稿');
  }

  // change 即存（silent，不重畫），只更新這一列的差異、底色和上方指標
  function saveCount(el, t) {
    var rec = findStocktake(X.ensure('stocktakes'), stv.openId);
    if (!rec || rec.status === 'confirmed' || !Array.isArray(rec.items)) { renderStocktake(el); return; }
    var field = t.dataset.count;
    if (field !== 'countUnfolded' && field !== 'countFolded') return;
    var tr = t.closest('tr');
    var mid = tr && tr.dataset.mid;
    var it = rec.items.find(function (x) { return isObj(x) && sameId(x.materialId, mid); });
    if (!it) return;
    var raw = String(t.value).trim(), v = null;
    if (raw !== '') {
      v = Number(raw);
      if (!isFinite(v) || v < 0) { alert('請輸入 0 以上的數字。'); t.value = filled(it[field]) ? String(it[field]) : ''; return; }
      v = round2(v);
    }
    it[field] = v;
    if (!X.save({ silent: true })) return;
    t.value = v == null ? '' : String(v);
    var c = itemCheck(it);
    var d = q$(tr, '[data-diff]');
    if (d) d.innerHTML = diffHtml(c);
    tr.style.background = c.big ? 'var(--bad-soft)' : '';
    var box = q$(el, '[data-box="kpis"]');
    if (box) box.innerHTML = stKpis(rec);
  }

  function confirmStocktake(el) {
    var rec = findStocktake(X.ensure('stocktakes'), stv.openId);
    if (!rec || rec.status === 'confirmed') return;
    var k = stocktakeStats(rec);
    if (!k.total) { alert('這份盤點沒有任何包材，無法確認。'); return; }
    if (k.done < k.total) {
      alert('還有 ' + (k.total - k.done) + ' 項沒填完。\n未折盒和已折盒的實盤數都要填（沒有就填 0）才能確認。');
      stv.filter = 'todo'; stv.q = '';
      renderStocktake(el);
      return;
    }
    if (!confirm('確認後這份盤點就不能再修改。\n有差異 ' + k.diff + ' 項，其中超過 ' + diffPctText() + ' 的有 ' + k.big + ' 項。\n確定要確認嗎？')) return;
    rec.status = 'confirmed';
    rec.confirmedBy = X.userName();
    rec.confirmedAt = Date.now();
    stv.filter = 'all';
    if (X.save()) X.toast('盤點已確認');
  }

  // =====================================================================
  // 頁面三：裝盒回報（xPacking）
  // =====================================================================
  // date：'' 代表今天；rows：輸入列 [{ key, productId, boxes }]（輸入框原始值，頁面被整頁重畫時用來還原）
  var pk = { date: '', note: '', rows: [], seq: 0 };
  var PK_START_ROWS = 3;

  var PK_BATCH = {
    unit: '個禮盒',
    count: function (shown) {
      var b = shown.reduce(function (s, r) { return s + num(r.boxes); }, 0);
      return shown.length + ' 個禮盒、共 ' + fmt(b) + ' 盒';
    },
    item: function (r) { return nameOfProduct(r.productId) + ' ' + fmt(r.boxes) + ' 盒'; },
    line: function (r) { return esc(X.productLabel(r.productId)) + ' <b>' + esc(fmt(r.boxes)) + ' 盒</b>'; }
  };

  function pkBlank() { pk.seq += 1; return { key: 'r' + pk.seq, productId: '', boxes: '' }; }
  function pkReset() { pk.rows = []; for (var i = 0; i < PK_START_ROWS; i++) pk.rows.push(pkBlank()); }

  function giftGroups() {
    var all = sortGifts(X.products());
    return {
      all: all,
      listed: all.filter(function (p) { return p.isListedCurrent === true; }),
      other: all.filter(function (p) { return p.isListedCurrent !== true; })
    };
  }
  function findGift(G, id) { return id === '' ? null : (G.all.find(function (p) { return sameId(p.id, id); }) || null); }
  function giftSelectHtml(G, selected) {
    var opt = function (p) {
      return '<option value="' + esc(p.id) + '"' + (selected !== '' && sameId(p.id, selected) ? ' selected' : '') + '>' + esc(X.productLabel(p)) + '</option>';
    };
    var body = G.listed.length
      ? '<optgroup label="本期上架">' + G.listed.map(opt).join('') + '</optgroup>' +
        (G.other.length ? '<optgroup label="其他禮盒">' + G.other.map(opt).join('') + '</optgroup>' : '')
      : G.other.map(opt).join('');
    return '<select data-pk="product" aria-label="禮盒"><option value="">請選擇禮盒</option>' + body + '</select>';
  }
  function pkRowHtml(r, i, G) {
    return '<div class="x-pk-row' + (r.productId !== '' ? ' x-pk-row-on' : '') + '" data-row="' + esc(r.key) + '">' +
      '<span class="x-pk-no">' + (i + 1) + '</span>' +
      giftSelectHtml(G, r.productId) +
      '<label class="x-pk-boxes"><input type="number" data-pk="boxes" inputmode="numeric" min="1" step="1" placeholder="盒數" aria-label="盒數" value="' + esc(r.boxes) + '"><span>盒</span></label>' +
      '<button type="button" class="x-pk-del" data-act="pk-del" aria-label="刪除這列" title="刪除這列">×</button></div>';
  }
  // 輸入列以畫面為準（新增、刪除列都直接改畫面）
  function readPkRows(el) {
    return q$$(el, '[data-row]').map(function (row) {
      var s = q$(row, '[data-pk="product"]'), b = q$(row, '[data-pk="boxes"]');
      return { key: row.dataset.row, productId: s ? String(s.value || '') : '', boxes: b ? String(b.value || '') : '' };
    });
  }

  function renderPacking(el) {
    var G = giftGroups();
    var sig = G.all.map(function (p) { return [p.id, p.code, p.name, p.isListedCurrent === true ? 1 : 0].join('\u0001'); }).join('\u0002');
    // 禮盒清單沒變：只更新試算與紀錄區，已選的禮盒、填好的盒數完全不動
    if (G.all.length && el._xpkSig === sig && q$(el, '[data-box="pk-rows"]')) { bindPacking(el); refreshPacking(el); return; }
    el._xpkSig = sig;
    if (!pk.rows.length) pkReset();
    pk.rows.forEach(function (r) { if (r.productId !== '' && !findGift(G, r.productId)) r.productId = ''; });
    var d = effDate(pk.date);
    var html = intro('一次填好這次裝的所有禮盒：每列選一個禮盒、填盒數，不夠就按「＋ 新增一列」。下方會即時換算要用掉的包材和單條，確認沒問題再按「全部送出」。');
    if (!G.all.length) {
      html += X.ui.card('這次裝盒', X.ui.empty('還沒有禮盒資料，請先到「禮盒資料」建立禮盒。'));
    } else {
      html += '<div class="panel x-card x-pk-panel">' +
        '<div class="x-card-head"><h2>這次裝盒</h2></div>' +
        '<div class="x-pk-top">' +
        '<div class="x-field"><span>裝盒日期<span class="x-pk-datetag" data-box="pk-datetag"></span></span>' +
        '<input type="date" data-pk="date" aria-label="裝盒日期" value="' + esc(d) + '"></div>' +
        '<div class="x-field"><span>備註（選填，會套用到這次送出的每一筆）</span>' +
        '<input type="text" data-pk="note" maxlength="100" placeholder="例：早班、2 號線" aria-label="備註" value="' + esc(pk.note) + '"></div>' +
        '</div>' +
        '<div class="x-pk-headrow"><span></span><span>禮盒' + (G.listed.length ? '（本期上架的排在最前面）' : '') + '</span><span>盒數</span><span></span></div>' +
        '<div class="x-pk-rows" data-box="pk-rows">' + pk.rows.map(function (r, i) { return pkRowHtml(r, i, G); }).join('') + '</div>' +
        '<button type="button" class="btn gray x-pk-add" data-act="pk-add">＋ 新增一列</button>' +
        '<div class="x-pk-preview" data-box="pk-preview"></div>' +
        '<div class="x-pk-bar"><span class="x-pk-count" data-box="pk-count" aria-live="polite"></span>' +
        '<button type="button" class="btn primary x-pk-submit" data-act="pk-submit">全部送出</button></div>' +
        '</div>';
    }
    html += '<div data-box="pk-records"></div>';
    el.innerHTML = html;
    bindPacking(el);
    refreshPacking(el);
  }

  function bindPacking(el) {
    el.onclick = function (e) {
      var a = actOf(e);
      if (!a || a.disabled) return;
      var act = a.dataset.act;
      if (act === 'pk-add') addPkRow(el);
      else if (act === 'pk-del') delPkRow(el, a.closest('[data-row]'));
      else if (act === 'pk-submit') submitPack(el);
      else if (act === 'pk-today') { var di = q$(el, '[data-pk="date"]'); if (di) di.value = X.today(); setPkDate(el, X.today()); }
      else if (act === 'void-batch') { voidBatch('packRecords', a.dataset.batch, '裝盒回報'); renderPkRecords(el); }
      else if (act === 'void-one') { voidOne('packRecords', a.dataset.id, '裝盒回報'); renderPkRecords(el); }
    };
    el.onchange = function (e) {
      var t = e.target;
      if (!t || !t.dataset) return;
      var f = t.dataset.pk;
      if (f === 'date') setPkDate(el, t.value);
      else if (f === 'note') pk.note = t.value;
      else if (f === 'product' || f === 'boxes') editPkRow(el, t);
    };
    el.oninput = function (e) {
      var t = e.target;
      if (!t || !t.dataset) return;
      if (t.dataset.pk === 'boxes') editPkRow(el, t);
      else if (t.dataset.pk === 'note') pk.note = t.value;
    };
  }

  function setPkDate(el, v) {
    if (!dateOk(v)) return;
    var next = keepDate(v);
    if (next === pk.date) return;
    pk.date = next;
    refreshPacking(el);
  }
  // 依目前日期更新：日期提示、試算、紀錄區（輸入列不重畫）
  function refreshPacking(el) {
    var d = effDate(pk.date);
    var di = q$(el, '[data-pk="date"]');
    if (di && di.value !== d && document.activeElement !== di) di.value = d;
    var tag = q$(el, '[data-box="pk-datetag"]');
    if (tag) tag.innerHTML = dateTagHtml(d, 'pk-today');
    if (q$(el, '[data-box="pk-rows"]')) pk.rows = readPkRows(el);
    updatePkPreview(el);
    renderPkRecords(el);
  }

  // 列的內容一改：記下來，只重畫「這次換算用量」與送出列的合計
  function editPkRow(el, t) {
    pk.rows = readPkRows(el);
    var row = t.closest('[data-row]'), s = row ? q$(row, '[data-pk="product"]') : null;
    if (row) row.classList.toggle('x-pk-row-on', !!(s && s.value));
    updatePkPreview(el);
  }
  // 新增一列：只在畫面最後加一列，不重畫既有的列
  function addPkRow(el) {
    var box = q$(el, '[data-box="pk-rows"]');
    if (!box) return;
    var r = pkBlank();
    box.insertAdjacentHTML('beforeend', pkRowHtml(r, q$$(box, '[data-row]').length, giftGroups()));
    pk.rows = readPkRows(el);
    var rows = q$$(box, '[data-row]');
    focusEl(q$(rows[rows.length - 1], '[data-pk="product"]'));
    updatePkPreview(el);
  }
  function delPkRow(el, row) {
    var box = q$(el, '[data-box="pk-rows"]');
    if (!box || !row) return;
    row.remove();
    if (!q$(box, '[data-row]')) box.insertAdjacentHTML('beforeend', pkRowHtml(pkBlank(), 0, giftGroups()));
    q$$(box, '[data-row]').forEach(function (r, i) { var n = q$(r, '.x-pk-no'); if (n) n.textContent = String(i + 1); });
    pk.rows = readPkRows(el);
    updatePkPreview(el);
  }

  function pkCheck() {
    var G = giftGroups();
    var res = collectPackRows(pk.rows, function (pid) { return !!findGift(G, pid); });
    res.G = G;
    res.total = res.items.reduce(function (s, it) { return s + it.boxes; }, 0);
    return res;
  }
  function updatePkPreview(el) {
    var box = q$(el, '[data-box="pk-preview"]'), cnt = q$(el, '[data-box="pk-count"]');
    if (!box && !cnt) return;
    var res = pkCheck();
    if (cnt) {
      cnt.innerHTML = (res.items.length ? '<b>' + res.items.length + '</b> 個禮盒、共 <b>' + esc(fmt(res.total)) + '</b> 盒' : '還沒有填好的列') +
        (res.errors.length ? '<span class="x-pk-err">，' + res.errors.length + ' 列沒填完</span>' : '');
    }
    if (!box) return;
    var html = '<h3>這次換算用量</h3>';
    if (res.errors.length) html += '<p class="x-pk-hint">還沒填完：' + esc(res.errors.map(function (e) { return e.short; }).join('、')) + '</p>';
    var merged = res.items.filter(function (it) { return it.rows.length > 1; });
    if (merged.length) {
      html += '<p class="x-pk-merge">' + esc(merged.map(function (it) {
        return nameOfProduct(it.productId) + ' 填在第 ' + it.rows.join('、') + ' 列，送出時會合併成一筆（共 ' + fmt(it.boxes) + ' 盒）';
      }).join('；')) + '</p>';
    }
    if (!res.items.length) {
      html += '<p class="small" style="margin:0">選好禮盒、填好盒數後，這裡會即時算出要用掉的包材和單條。</p>';
    } else {
      var u = packUsage(res.items, '', X.recipes(), X.components());
      html += usageWarn(u) + usageHtml(u, '選的禮盒都還沒有設定包材配方', '選的禮盒都沒有設定單條內容物', true) +
        '<p class="small" style="margin:8px 0 0">送出後，這些包材用量會從首頁包材庫存的「已折盒」扣掉。</p>';
    }
    box.innerHTML = html;
  }

  function usageWarn(u) {
    var w = '';
    if (u.noRecipe.length) w += X.ui.banner('warn', esc('這些禮盒還沒有設定包材配方，包材用量會少算：' + u.noRecipe.map(nameOfProduct).join('、')));
    if (u.noComponents.length) w += X.ui.banner('info', esc('這些禮盒沒有設定單條內容物，不會算到單條用量：' + u.noComponents.map(nameOfProduct).join('、')));
    return w;
  }
  // preview＝送出前的預覽：多一欄「送出後已折盒」（目前已折盒－這次用量），不夠時標紅
  function usageHtml(u, emptyMat, emptySgl, preview) {
    var order = materialOrder(orderedMaterials());
    var matRows = u.materials.slice().sort(function (a, b) { return orderOf(order, String(a.materialId)) - orderOf(order, String(b.materialId)); });
    var folded = function (r) { return num((X.materialStock(r.materialId) || {}).folded); };
    var cols = [
      { label: '包材', render: function (r) { return wrapText(X.materialLabel(r.materialId)); } },
      { label: '用量', num: true, render: function (r) {
        var m = X.materialById(r.materialId);
        return '<b>' + esc(fmt(r.qty, 2)) + '</b>' + (m && m.unit ? ' <span class="small">' + esc(m.unit) + '</span>' : '');
      } },
      { label: '目前已折盒', num: true, render: function (r) {
        var s = folded(r);
        return preview && s < r.qty ? '<b style="color:var(--bad)">' + esc(fmt(s, 2)) + '</b>' : esc(fmt(s, 2));
      } }
    ];
    if (preview) cols.push({ label: '送出後已折盒', num: true, render: function (r) {
      var after = round2(folded(r) - r.qty);
      return after < 0 ? '<b style="color:var(--bad)">' + esc(fmt(after, 2)) + '</b>' : esc(fmt(after, 2));
    } });
    return '<div class="x-cols"><div><h3 class="x-pk-sub">包材用量</h3>' +
      X.ui.table(cols, matRows, { empty: emptyMat }) +
      '</div><div><h3 class="x-pk-sub">單條用量</h3>' +
      X.ui.table([
        { label: '單條', render: function (r) { return wrapText(X.productLabel(r.productId)); } },
        { label: '數量', num: true, render: function (r) { return '<b>' + esc(fmt(r.qty, 2)) + '</b>'; } }
      ], u.singles, { empty: emptySgl }) +
      '</div></div>';
  }

  function renderPkRecords(el) {
    var box = q$(el, '[data-box="pk-records"]');
    if (!box) return;
    var all = list('packRecords'), d = effDate(pk.date);
    var open = openKeys(box), isToday = d === X.today(), stamp = dayStamp(d);
    var batches = groupBatches(dayRecords(all, d));
    var body = batches.length
      ? '<div class="x-pk-batches">' + batches.map(function (g) { return batchHtml('x-pk', g, open, PK_BATCH); }).join('') + '</div>' +
        '<p class="small" style="margin:10px 0 0">同一次送出的算一批。「撤銷這一批」會撤銷整批；按「看每一筆」可以單筆撤銷。撤銷的紀錄會保留並加上刪除線，不再換算。</p>'
      : X.ui.empty(isToday ? '今天還沒有裝盒回報' : '這一天沒有裝盒回報');
    var u = packUsage(all, d, X.recipes(), X.components());
    var byProduct = u.byProduct.slice().sort(function (a, b) { return b.boxes - a.boxes; });
    var totals = X.ui.table([
      { label: '禮盒', render: function (r) { return wrapText(X.productLabel(r.productId)); } },
      { label: '盒數', num: true, render: function (r) { return '<b>' + esc(fmt(r.boxes)) + '</b>'; } },
      { label: '回報筆數', num: true, render: function (r) { return esc(r.count); } }
    ], byProduct, { empty: '這一天還沒有裝盒回報' }) +
      (byProduct.length ? '<p class="small" style="margin:8px 0 0">合計 ' + byProduct.length + ' 種禮盒、' + esc(fmt(u.total)) + ' 盒（已撤銷的不算）。</p>' : '');
    var usage = '<p class="small" style="margin:0 0 10px">這些包材用量已經從首頁包材庫存的「已折盒」扣掉（用送出當時的禮盒配方換算）。已撤銷的紀錄不算。單條用量目前只做換算顯示。</p>' +
      usageWarn(u) + usageHtml(u, '這一天沒有裝盒，或禮盒還沒有設定包材配方', '這一天沒有裝盒，或禮盒沒有設定單條內容物');
    box.innerHTML = X.ui.card('這一天的紀錄', body, stamp) + X.ui.card('這一天各禮盒合計', totals, stamp) + X.ui.card('這一天換算用量', usage, stamp);
  }

  function submitPack(el) {
    var di = q$(el, '[data-pk="date"]');
    var date = di ? String(di.value || '') : effDate(pk.date);
    if (!dateOk(date)) { alert('請選擇正確的裝盒日期。'); focusEl(di); return; }
    pk.rows = readPkRows(el);
    var res = pkCheck();
    if (res.errors.length) {
      alert('還不能送出，請先修正：\n' + res.errors.map(function (e) { return e.msg; }).join('\n'));
      var row = q$$(el, '[data-row]')[res.errors[0].no - 1];
      focusEl(q$(row, res.errors[0].field === 'product' ? '[data-pk="product"]' : '[data-pk="boxes"]'));
      return;
    }
    if (!res.items.length) {
      alert('還沒有要送出的禮盒。\n請在任一列選好禮盒，再填上盒數。');
      focusEl(q$(el, '[data-pk="product"]'));
      return;
    }
    var noteEl = q$(el, '[data-pk="note"]');
    var note = String(noteEl ? noteEl.value : pk.note).trim().slice(0, 100);
    var names = res.items.map(function (it) { return nameOfProduct(it.productId) + ' ' + fmt(it.boxes) + ' 盒'; });
    var msg = slashDate(date) + ' 共 ' + res.items.length + ' 個禮盒、' + fmt(res.total) + ' 盒：' + names.slice(0, 8).join('、') +
      (names.length > 8 ? ' 等 ' + names.length + ' 個禮盒' : '');
    var merged = res.items.filter(function (it) { return it.rows.length > 1; });
    if (merged.length) {
      msg += '\n\n同一個禮盒填在好幾列，已合併成一筆：\n' + merged.map(function (it) {
        return nameOfProduct(it.productId) + '（第 ' + it.rows.join('、') + ' 列）→ ' + fmt(it.boxes) + ' 盒';
      }).join('\n');
    }
    if (date !== X.today()) msg += '\n\n注意：日期不是今天。';
    if (note) msg += '\n備註：' + note;
    var warnBoxes = (window.CMSRules && CMSRules.def('packWarnBoxes')) ? CMSRules.get('packWarnBoxes') : 10000; // 多打 0 的提醒門檻：見「計算規則」
    if (res.items.some(function (it) { return it.boxes >= warnBoxes; })) msg += '\n有禮盒一次在 ' + fmt(warnBoxes) + ' 盒以上，請確認沒有多打 0。';
    if (!confirm(msg + '\n\n確定送出嗎？')) return;

    var batchId = X.uid('pb'), at = Date.now(), by = X.userName();
    var ids = freshIds('pk', res.items.length, X.get('packRecords'));
    var recs = res.items.map(function (it, i) {
      var pid = findGift(res.G, it.productId).id;
      var rec = { id: ids[i], batchId: batchId, date: date, productId: pid, boxes: it.boxes, by: by, at: at, note: note, voided: false };
      // 存下送出當時每盒的包材用量（配方快照）：之後刪除禮盒或改配方，已送出的用量不會跟著變
      // 還沒設包材配方就不存，之後補設配方時仍會依配方扣
      var mats = X.recipes().filter(function (r) { return isObj(r) && sameId(r.productId, pid); })
        .map(function (r) { return { materialId: r.materialId, qty: round2(num(r.qty)) }; });
      if (mats.length) rec.materials = mats;
      return rec;
    });
    if (!pushRecords('packRecords', recs)) return;
    // 送出成功：重設為 3 列空白、清空備註，紀錄區切到這次的日期
    pk.date = keepDate(date);
    pk.note = '';
    if (noteEl) noteEl.value = '';
    pkReset();
    var box = q$(el, '[data-box="pk-rows"]');
    if (box) box.innerHTML = pk.rows.map(function (r, i) { return pkRowHtml(r, i, res.G); }).join('');
    refreshPacking(el);
    X.toast('已登記 ' + recs.length + ' 個禮盒，共 ' + fmt(res.total) + ' 盒' + (date !== X.today() ? '（' + shortDate(date) + '）' : ''));
  }

  // =====================================================================
  // 註冊頁面
  // =====================================================================
  X.registerPage({
    id: 'xQuickFold', group: 'daily', order: 10, stage: 'ready', admin: true,
    title: '折盒', sub: '物管：折盒、折盒NG，只能登記今天，當天可修改',
    icon: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 7.5v7M8.5 11h7"/><path d="M10.5 18h3"/>',
    render: function (el) { renderQuickFold(el); }
  });
  X.registerPage({
    id: 'xQuickStock', group: 'daily', order: 11, stage: 'ready', admin: true,
    title: '進貨與使用', sub: '倉管：進貨、使用、使用NG，只能登記今天，當天可修改',
    icon: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M9 8h6M9 11.5h6M9 15h4"/>',
    render: function (el) { renderQuickStock(el); }
  });
  X.registerPage({
    id: 'xStocktake', group: 'daily', order: 20, stage: 'beta',
    title: '盤點', sub: '帳面數與實際盤點數比對',
    icon: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="m8.5 11.5 2 2 4-4"/><path d="M9 17h6"/>',
    render: function (el) { renderStocktake(el); }
  });
  // 裝盒回報頁（xPacking）2026-10-15 取消，不再註冊；程式保留在上面「頁面三」
})(window.CMSX);

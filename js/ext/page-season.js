/*
 * 檔期與業績（開發員 A）
 *  - xSeasons   檔期設定（ready）
 *  - xSalesDash 業績儀表板（只顯示在首頁的「業績儀表板」分頁，不在選單上）
 * 讀寫的資料集：seasons
 * 業績預估改用原本首頁的業績預估表（page-legacy-forecast.js）
 * 只讀：codeMap、deptMap，以及原系統的 products、materials、recipes、components、orderHistory
 */
(function (X) {
  'use strict';

  // ================= 共用 =================
  var esc = X.esc;
  var KIND = { newyear: '過年', midautumn: '中秋', other: '其他' };
  var KIND_TONE = { newyear: 'bad', midautumn: 'warn', other: 'muted' };
  var STATUS = { planning: '規劃中', active: '進行中', closed: '已結束' };
  var STATUS_TONE = { planning: 'info', active: 'ok', closed: 'muted' };
  var LATER = ' disabled title="後續階段開放"';
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var DASH = '<span class="small">—</span>';
  // 寬表格在手機上橫向捲動時，第一欄（品項）固定在左邊
  var STICKY = 'position:sticky;left:0;z-index:1;background:var(--surface);';
  var STICKY_FOOT = 'position:sticky;left:0;z-index:1;background:var(--surface-2);';

  function intro(text) { return '<p class="small" style="margin:0 0 14px">' + esc(text) + '</p>'; }
  function isSingle(p) { return String((p && p.category) || '').trim() === '單條'; }
  function byCode(a, b) {
    return String(a.code || '').localeCompare(String(b.code || ''), 'zh-TW', { numeric: true, sensitivity: 'base' }) ||
      String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW');
  }
  function normCode(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, '').toUpperCase(); }
  function pct(part, whole) { return whole > 0 ? (Math.round(part / whole * 1000) / 10) + '%' : '—'; }
  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function goPage(id) { X.goPage(id); }
  function actOf(e) { return (e.target && e.target.closest) ? e.target.closest('[data-act]') : null; }
  function nonRevSet() { var o = {}; X.NON_REVENUE_DEPTS.forEach(function (k) { o[k] = true; }); return o; }
  function kindTag(k) { return X.ui.tag(KIND[k] || '其他', KIND_TONE[k] || 'muted'); }
  function statusTag(s) { return X.ui.tag(STATUS[s] || '規劃中', STATUS_TONE[s] || 'muted'); }
  function seasonById(id) {
    if (!id) return null;
    return X.get('seasons').find(function (s) { return s && s.id === id; }) || null;
  }

  // 進行中的置頂，其餘依開始日排序（新的在上；沒填開始日的放最後）
  function sortSeasons(list) {
    return list.filter(Boolean).slice().sort(function (a, b) {
      var aa = a.status === 'active' ? 0 : 1, bb = b.status === 'active' ? 0 : 1;
      if (aa !== bb) return aa - bb;
      return String(b.startDate || '').localeCompare(String(a.startDate || '')) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW');
    });
  }
  // 距離節日：正數＝還有幾天，0＝今天，負數＝已過幾天，null＝沒填
  function daysToHoliday(s) { return DATE_RE.test((s && s.holidayDate) || '') ? X.daysBetween(X.today(), s.holidayDate) : null; }
  function holidayText(s) {
    var d = daysToHoliday(s);
    if (d === null) return '';
    if (d > 0) return '距離節日還有 ' + d + ' 天';
    if (d === 0) return '今天就是節日';
    return '節日已過 ' + (-d) + ' 天';
  }
  function holidayHtml(s) {
    var d = daysToHoliday(s);
    if (d === null) return DASH;
    var warnDays = window.CMSRules ? CMSRules.get('holidayWarnDays') : 30; // 幾天內標黃色：見「計算規則」
    if (d > 0) return X.ui.tag('還有 ' + d + ' 天', d <= warnDays && s.status !== 'closed' ? 'warn' : 'muted');
    if (d === 0) return X.ui.tag('就是今天', 'bad');
    return '<span class="small">已過 ' + (-d) + ' 天</span>';
  }
  function rangeHtml(s) {
    if (!s.startDate && !s.endDate) return DASH;
    var txt = esc(s.startDate || '未定') + ' ～ ' + esc(s.endDate || '未定');
    if (DATE_RE.test(s.startDate || '') && DATE_RE.test(s.endDate || '')) txt += '<div class="small">共 ' + (X.daysBetween(s.startDate, s.endDate) + 1) + ' 天</div>';
    return txt;
  }

  // ================= (1) 檔期設定 =================
  function guessKind() { var m = new Date().getMonth() + 1; return (m >= 3 && m <= 9) ? 'midautumn' : 'newyear'; }

  // 檢查表單內容；回傳錯誤訊息，沒問題回傳空字串
  function checkSeason(v, selfId, list) {
    var name = String(v.name || '').trim();
    if (!name) return '請填寫檔期名稱。';
    var keys = ['holidayDate', 'startDate', 'endDate'];
    for (var i = 0; i < keys.length; i++) {
      if (v[keys[i]] && !DATE_RE.test(v[keys[i]])) return '日期格式不正確，請用日曆選擇。';
    }
    if (v.startDate && v.endDate && v.endDate < v.startDate) return '結束日不可早於開始日。';
    if (v.compareSeasonId && selfId && v.compareSeasonId === selfId) return '比較用檔期不能選自己。';
    var dup = (list || []).some(function (s) { return s && s.id !== selfId && String(s.name || '').trim() === name; });
    if (dup) return '已經有同名的檔期「' + name + '」，請換一個名稱。';
    return '';
  }
  // 同時只能有一個進行中：把其他進行中的改回規劃中，回傳被改的名稱
  function demoteOthers(list, keepId) {
    var names = [];
    list.forEach(function (s) { if (s && s.id !== keepId && s.status === 'active') { s.status = 'planning'; names.push(s.name); } });
    return names;
  }
  // 新增或修改檔期（只改記憶體，呼叫端再 X.save()）
  function applySeason(v, editId) {
    var list = X.ensure('seasons');
    var err = checkSeason(v, editId, list);
    if (err) return { error: err };
    var data = {
      name: String(v.name || '').trim(),
      kind: KIND[v.kind] ? v.kind : 'other',
      holidayDate: v.holidayDate || '', startDate: v.startDate || '', endDate: v.endDate || '',
      status: STATUS[v.status] ? v.status : 'planning',
      compareSeasonId: v.compareSeasonId || '',
      note: String(v.note || '').trim()
    };
    var rec;
    if (editId) {
      rec = list.find(function (s) { return s && s.id === editId; });
      if (!rec) return { error: '找不到這個檔期，可能已被其他人刪除。' };
      Object.assign(rec, data);
    } else {
      rec = Object.assign({ id: X.uid('sea'), createdAt: Date.now(), by: X.userName() }, data);
      list.push(rec);
    }
    return { rec: rec, demoted: rec.status === 'active' ? demoteOthers(list, rec.id) : [] };
  }
  function deleteSeason(id) {
    var list = X.ensure('seasons');
    var i = list.findIndex(function (s) { return s && s.id === id; });
    if (i < 0) return false;
    list.splice(i, 1);
    list.forEach(function (s) { if (s && s.compareSeasonId === id) s.compareSeasonId = ''; });
    return true;
  }

  function seasonFields(s) {
    var others = sortSeasons(X.get('seasons')).filter(function (x) { return !s || x.id !== s.id; });
    return [
      { name: 'name', label: '檔期名稱', required: true, value: s ? s.name : '', placeholder: '例：2027 過年' },
      { name: 'kind', label: '種類', type: 'select', value: s ? s.kind : guessKind(), options: Object.keys(KIND).map(function (k) { return { value: k, label: KIND[k] }; }) },
      { name: 'holidayDate', label: '節日日期', type: 'date', value: s ? s.holidayDate : '' },
      { name: 'status', label: '狀態', type: 'select', value: s ? s.status : 'planning', options: Object.keys(STATUS).map(function (k) { return { value: k, label: STATUS[k] + (k === 'active' ? '（同時只能一個）' : '') }; }) },
      { name: 'startDate', label: '開始日', type: 'date', value: s ? s.startDate : '' },
      { name: 'endDate', label: '結束日', type: 'date', value: s ? s.endDate : '' },
      { name: 'compareSeasonId', label: '比較用檔期（通常是去年同檔期）', type: 'select', full: true, value: s ? s.compareSeasonId : '', options: X.ui.options(others, 'id', function (x) { return x.name; }, '（不比較）') },
      { name: 'note', label: '備註', type: 'textarea', full: true, value: s ? s.note : '' }
    ];
  }
  function openSeasonDialog(s) {
    X.ui.dialog(s ? '編輯檔期' : '新增檔期', seasonFields(s), function (v) {
      var r = applySeason(v, s ? s.id : '');
      if (r.error) { alert(r.error); return false; }
      X.save();
      X.toast(r.demoted.length ? '已儲存；「' + r.demoted.join('、') + '」改回規劃中' : '已儲存檔期');
    }, s ? '儲存' : '新增');
  }

  function renderSeasons(el) {
    var list = sortSeasons(X.get('seasons'));
    var active = list.find(function (s) { return s.status === 'active'; });
    var cnt = { planning: 0, active: 0, closed: 0 };
    list.forEach(function (s) { if (cnt[s.status] != null) cnt[s.status]++; });
    var nameOf = {};
    list.forEach(function (s) { nameOf[s.id] = s.name; });

    var html = intro('設定每個檔期的日期與狀態。設為「進行中」的檔期，會是其他頁面預設顯示的檔期。');
    html += X.ui.kpis([
      { label: '進行中的檔期', value: active ? active.name : '沒有', tone: active ? 'ok' : 'warn', sub: active ? holidayText(active) : '請把正在準備的檔期設為進行中' },
      { label: '規劃中', value: cnt.planning + ' 個', tone: 'info' },
      { label: '已結束', value: cnt.closed + ' 個', tone: 'muted' }
    ]);
    if (list.length && !active) html += X.ui.banner('warn', '目前沒有「進行中」的檔期。開檔前請把要進行的檔期「設為進行中」。');

    var cols = [
      { label: '檔期', render: function (s) { return '<strong>' + esc(s.name) + '</strong>' + (s.note ? '<div class="small">' + esc(s.note) + '</div>' : ''); } },
      { label: '種類', render: function (s) { return kindTag(s.kind); } },
      { label: '期間', render: rangeHtml },
      { label: '節日', render: function (s) { return s.holidayDate ? esc(s.holidayDate) + '<div style="margin-top:3px">' + holidayHtml(s) + '</div>' : DASH; } },
      { label: '狀態', render: function (s) { return statusTag(s.status); } },
      { label: '比較用檔期', render: function (s) { return s.compareSeasonId ? esc(nameOf[s.compareSeasonId] || '（已刪除）') : DASH; } },
      {
        label: '操作', render: function (s) {
          var id = esc(s.id), bs = ' style="min-height:36px"'; // 手機上按鈕不要太小
          return '<div class="x-row-actions" style="flex-wrap:wrap;min-width:130px">' +
            '<button type="button" class="btn gray" data-act="edit" data-id="' + id + '"' + bs + '>編輯</button>' +
            (s.status !== 'active' ? '<button type="button" class="btn green" data-act="activate" data-id="' + id + '"' + bs + '>設為進行中</button>' : '') +
            (s.status !== 'closed' ? '<button type="button" class="btn gray" data-act="close" data-id="' + id + '"' + bs + '>結束檔期</button>' : '') +
            '<button type="button" class="btn red" data-act="del" data-id="' + id + '"' + bs + '>刪除</button></div>';
        }
      }
    ];
    html += X.ui.card('檔期列表', X.ui.table(cols, list, { empty: '還沒有任何檔期，按「新增檔期」開始建立。' }),
      '<button type="button" class="btn primary" data-act="add">＋ 新增檔期</button>');
    el.innerHTML = html;

    el.onchange = null;
    el.oninput = null;
    el.onclick = function (e) {
      var b = actOf(e);
      if (!b) return;
      var act = b.dataset.act;
      if (act === 'add') { openSeasonDialog(null); return; }
      var all = X.ensure('seasons');
      var s = all.find(function (x) { return x && x.id === b.dataset.id; });
      if (!s) return;
      if (act === 'edit') {
        openSeasonDialog(s);
      } else if (act === 'activate') {
        var cur = all.find(function (x) { return x && x.status === 'active' && x.id !== s.id; });
        if (cur && !confirm('目前進行中的是「' + cur.name + '」。\n要改成「' + s.name + '」嗎？原本的會改回規劃中。')) return;
        demoteOthers(all, s.id);
        s.status = 'active';
        X.save();
        X.toast('「' + s.name + '」已設為進行中');
      } else if (act === 'close') {
        if (!confirm('確定要結束檔期「' + s.name + '」嗎？')) return;
        s.status = 'closed';
        X.save();
        X.toast('「' + s.name + '」已結束');
      } else if (act === 'del') {
        if (!confirm('確定要刪除檔期「' + s.name + '」嗎？')) return;
        deleteSeason(s.id);
        X.save();
        X.toast('已刪除檔期');
      }
    };
  }

  X.registerPage({
    id: 'xSeasons', group: 'season', order: 10, title: '檔期設定', sub: '每個檔期的日期與狀態', stage: 'ready',
    icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M10 13.5v5M10 13.5h4.5l-1 1.3 1 1.3H10"/>',
    render: function (el) { renderSeasons(el); },
    _fn: { checkSeason: checkSeason, applySeason: applySeason, deleteSeason: deleteSeason, sortSeasons: sortSeasons, daysToHoliday: daysToHoliday }
  });

  // ================= (3) 業績儀表板 =================
  // 今年和去年同一個檔期（或全年）比較：訂單數量與金額，可以看全公司或單一部門。
  // 金額＝數量 × 目前的售價（訂單資料沒有金額）：禮盒用「禮盒資料」的售價、單條用「單條資料」的售價（CMSX.productPrice，
  // 禮盒沒填售價時是否改用內建備用售價見「計算規則」）。去年的金額也用目前的售價計算。
  // 部門對照設成「不計算」的訂單不算進數量與金額。
  var sd = { kind: '', year: '', dept: 'all' };
  var SD_KINDS = [['midautumn', '中秋'], ['newyear', '過年'], ['year', '全年（1～12 月）']];

  // 對照表（只讀）：品號 → 對照、禮盒；接單部門／通路 → 部門
  function salesCtx() {
    var ctx = { code: Object.create(null), byId: Object.create(null), byCode: Object.create(null), od: Object.create(null), ch: Object.create(null) };
    X.products().forEach(function (p) {
      if (!p) return;
      ctx.byId[String(p.id)] = p;
      var c = normCode(p.code);
      if (c && !ctx.byCode[c]) ctx.byCode[c] = p;
    });
    // 同一品號有多筆對照時取第一筆（與「對照設定」頁相同）
    X.get('codeMap').forEach(function (m) { var c = normCode(m && m.orderCode); if (c && !ctx.code[c]) ctx.code[c] = m; });
    X.get('deptMap').forEach(function (m) {
      // 與「對照設定」頁相同：field + value 唯一、重複時取第一筆；空白的值也可以設定對照
      if (!m || !String(m.dept || '').trim()) return;
      var v = String(m.value == null ? '' : m.value).trim();
      var box = m.field === 'orderDepartment' ? ctx.od : (m.field === 'channel' ? ctx.ch : null);
      if (box && !(v in box)) box[v] = m.dept;
    });
    return ctx;
  }

  // 每筆訂單整理成：{ kind, sy（檔期年份）, y（日期年份）, date, p, code, name, q, price, dk（部門）, raw（未對照時的原始文字）, no }
  // 品號設為「不計算」的略過（只計筆數）
  function classifyOrders(rows, ctx) {
    var deptOk = Object.create(null);
    X.DEPTS.forEach(function (d) { deptOk[d.key] = true; });
    deptOk.none = true;
    var list = [], ignored = 0, priceOf = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r) continue;
      var date = String(r.date || ''), y = date.slice(0, 4);
      if (!/^\d{4}$/.test(y)) continue;
      var code = normCode(r.productCode);
      var cm = code ? ctx.code[code] : null;
      if (cm && cm.kind === 'ignore') { ignored++; continue; }
      // 有手動對照就用手動對照；對到已刪除的品項算「未對照」，沒有手動對照才比對系統品號
      var manualId = cm && cm.productId != null ? String(cm.productId).trim() : '';
      var p = manualId ? (ctx.byId[manualId] || null) : ((code ? ctx.byCode[code] : null) || null);
      var price = 0;
      if (p) {
        var pk = String(p.id);
        if (!(pk in priceOf)) priceOf[pk] = X.num(X.productPrice(p));
        price = priceOf[pk];
      }
      var kind = X.orderSeasonKind(r);
      var sy = (kind === 'newyear' || kind === 'midautumn') && window.CMSRules ? CMSRules.seasonYear(date, kind) : y;
      var od = String(r.orderDepartment || '').trim(), ch = String(r.channel || '').trim();
      // 預設先看接單部門、再看通路（順序見「計算規則」）；兩者都對不到時，才用「空白」的對照
      var dk = window.CMSRules ? CMSRules.resolveDept({ orderDepartment: od, channel: ch }, { orderDepartment: ctx.od, channel: ctx.ch })
        : ((od && ctx.od[od]) || (ch && ctx.ch[ch]) || (!od && ctx.od['']) || (!ch && ctx.ch['']) || '');
      var raw = '';
      if (!deptOk[dk]) { dk = 'unmatched'; raw = ch || od || '（空白）'; }
      list.push({
        kind: kind, sy: sy, y: y, date: date.slice(0, 10), p: p, q: X.num(r.qty), price: price, dk: dk, raw: raw,
        code: p ? (p.code || '') : String(r.productCode || '').trim(), name: p ? (p.name || '') : String(r.name || '').trim(),
        no: String(r.orderNo || r.sourceOrderNo || '').trim() || ('#' + i)
      });
    }
    return { list: list, ignored: ignored };
  }

  function inPeriod(o, kind, year) { return kind === 'year' ? o.y === year : (o.kind === kind && o.sy === year); }
  function yearsOf(list, kind) {
    var seen = Object.create(null);
    list.forEach(function (o) { if (kind === 'year') seen[o.y] = true; else if (o.kind === kind) seen[o.sy] = true; });
    return Object.keys(seen).sort().reverse();
  }

  // 「計算規則」開啟時（預設），公關贈、執行長的訂單金額不算營收
  function nonRevenue() { return (!window.CMSRules || CMSRules.get('salesExcludeNonRevenue')) ? nonRevSet() : {}; }
  // 彙總一段期間：dept＝'all'（全公司）或部門代號／'unmatched'；「不計算」部門不算進合計
  function sumPeriod(list, kind, year, dept) {
    var s = { qty: 0, amt: 0, nonRevAmt: 0, singleQty: 0, unmatchedQty: 0, unpricedQty: 0, noneQty: 0, orderCount: 0, orders: Object.create(null),
      byDept: Object.create(null), items: Object.create(null), unCh: Object.create(null), minDate: '', maxDate: '' };
    var nonRev = nonRevenue();
    list.forEach(function (o) {
      if (!inPeriod(o, kind, year)) return;
      if (o.dk === 'none') { s.noneQty += o.q; return; }
      if (dept !== 'all' && o.dk !== dept) return;
      var amt = nonRev[o.dk] ? 0 : o.q * o.price;
      if (nonRev[o.dk]) s.nonRevAmt += o.q * o.price;
      s.qty += o.q; s.amt += amt;
      if (!o.p) s.unmatchedQty += o.q; else if (isSingle(o.p)) s.singleQty += o.q;
      if (o.p && !(o.price > 0)) s.unpricedQty += o.q; // 有對到品項、但沒有售價（品號未對照的另外算 unmatchedQty）
      if (!s.orders[o.no]) { s.orders[o.no] = true; s.orderCount++; }
      if (!s.minDate || o.date < s.minDate) s.minDate = o.date;
      if (!s.maxDate || o.date > s.maxDate) s.maxDate = o.date;
      var g = s.byDept[o.dk] || (s.byDept[o.dk] = { qty: 0, amt: 0 });
      g.qty += o.q; g.amt += amt;
      if (o.dk === 'unmatched') s.unCh[o.raw] = (s.unCh[o.raw] || 0) + o.q;
      var ik = o.p ? 'p:' + o.p.id : 'c:' + (o.code || o.name || '（空白）');
      var it = s.items[ik] || (s.items[ik] = { key: ik, p: o.p, code: o.code, name: o.name, price: o.price, qty: 0, amt: 0 });
      it.qty += o.q; it.amt += amt;
    });
    return s;
  }

  function money(v) { return '$' + X.fmt(Math.round(X.num(v))); }
  function shortRange(s) {
    if (!s.minDate) return '沒有訂單';
    var f = function (d) { return d.slice(5).replace('-', '/'); };
    return s.minDate.slice(0, 4) + ' 年 ' + f(s.minDate) + '～' + f(s.maxDate);
  }
  // 成長：今年比去年；去年是 0 時，今年有就顯示「新增」
  function growth(cur, prev) {
    if (!(prev > 0)) return cur > 0 ? X.ui.tag('新增', 'info') : DASH;
    var g = Math.round((cur - prev) / prev * 1000) / 10;
    var color = g > 0 ? 'var(--ok)' : (g < 0 ? 'var(--bad)' : 'var(--text-2)');
    return '<b style="color:' + color + '">' + (g > 0 ? '+' : '') + g + '%</b>';
  }
  function growthText(cur, prev) {
    if (!(prev > 0)) return cur > 0 ? '去年沒有，今年新增' : '';
    var g = Math.round((cur - prev) / prev * 1000) / 10;
    return '比去年 ' + (g > 0 ? '+' : '') + g + '%';
  }
  function periodLabel(kind, year) { return year + ' ' + (kind === 'year' ? '全年' : (KIND[kind] || '')); }

  function renderSalesDash(el) {
    var rows = X.orders();
    var html = intro('比較今年和去年同一個檔期的訂單數量與金額，可以看全公司或單一部門（不顯示客戶資料）。金額＝數量 × 目前的售價。');
    el.onchange = null;
    el.oninput = null;
    el.onclick = null;
    if (!rows.length) { el.innerHTML = html + X.ui.empty('還沒有過去訂單資料。'); return; }

    var t0 = now();
    var c = classifyOrders(rows, salesCtx());
    var list = c.list;
    // 預設檔期：進行中檔期的種類；沒有就選有資料的第一種
    if (!sd.kind) {
      var act = X.activeSeason();
      sd.kind = act && (act.kind === 'newyear' || act.kind === 'midautumn') && yearsOf(list, act.kind).length ? act.kind
        : (SD_KINDS.map(function (k) { return k[0]; }).find(function (k) { return yearsOf(list, k).length; }) || 'year');
    }
    var years = yearsOf(list, sd.kind);
    if (years.indexOf(sd.year) < 0) sd.year = years[0] || '';
    var deptOpts = [{ key: 'all', label: '全公司' }].concat(X.DEPTS.map(function (d) { return { key: d.key, label: d.label }; }), [{ key: 'unmatched', label: '未對照的訂單' }]);
    if (!deptOpts.some(function (d) { return d.key === sd.dept; })) sd.dept = 'all';
    var lastYear = sd.year ? String(Number(sd.year) - 1) : '';
    var cur = sumPeriod(list, sd.kind, sd.year, sd.dept);
    var prev = sumPeriod(list, sd.kind, lastYear, sd.dept);
    var ms = Math.round(now() - t0);
    var deptName = (deptOpts.find(function (d) { return d.key === sd.dept; }) || {}).label;

    var sel = function (act, opts, value, label, width) {
      return '<label class="x-field" style="flex:1 1 ' + (width || 150) + 'px;max-width:260px"><span>' + esc(label) + '</span><select data-act="' + act + '">' +
        opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === value ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
    };
    html += '<div class="x-actions" style="margin-bottom:8px;align-items:flex-end">' +
      sel('kind', SD_KINDS, sd.kind, '比較檔期') +
      sel('year', years.length ? years.map(function (y) { return [y, y + ' 年 vs ' + (Number(y) - 1) + ' 年']; }) : [['', '沒有資料']], sd.year, '年份') +
      sel('dept', deptOpts.map(function (d) { return [d.key, d.label]; }), sd.dept, '部門') + '</div>';
    html += '<p class="small" style="margin:0 0 12px">' +
      esc((sd.kind === 'year' ? '全年＝訂單日期的年份。' : (window.CMSRules ? CMSRules.seasonRuleText() : '過年＝1～2 月訂單、中秋＝8～10 月訂單') + '（可在「計算規則」修改）。') +
        '今年（' + periodLabel(sd.kind, sd.year) + '）：' + shortRange(cur) + '；去年（' + periodLabel(sd.kind, lastYear) + '）：' + shortRange(prev) + '。') +
      (prev.minDate && cur.minDate && (prev.minDate.slice(5) !== cur.minDate.slice(5) || prev.maxDate.slice(5) !== cur.maxDate.slice(5)) ? ' <b>兩年的訂單日期範圍不一樣，比較時請留意。</b>' : '') + '</p>';

    html += X.ui.kpis([
      { label: deptName + '｜訂單數量', value: X.fmt(cur.qty), tone: 'info', sub: '去年 ' + X.fmt(prev.qty) + (growthText(cur.qty, prev.qty) ? '，' + growthText(cur.qty, prev.qty) : '') + (cur.singleQty ? '；含單條 ' + X.fmt(cur.singleQty) + ' 條' : '') },
      { label: deptName + '｜金額', value: money(cur.amt), tone: 'ok', sub: '去年 ' + money(prev.amt) + (growthText(cur.amt, prev.amt) ? '，' + growthText(cur.amt, prev.amt) : '') +
        (cur.nonRevAmt ? '；公關贈、執行長 ' + money(cur.nonRevAmt) + ' 不算營收' : '') },
      { label: '訂單筆數（不重複單號）', value: X.fmt(cur.orderCount), tone: 'muted', sub: '去年 ' + X.fmt(prev.orderCount) },
      { label: '沒有售價的數量', value: X.fmt(cur.unpricedQty), tone: (cur.unpricedQty || cur.unmatchedQty) ? 'warn' : 'ok',
        sub: [cur.unpricedQty ? '這些沒算到金額，請到禮盒／單條資料填售價' : '',
          cur.unmatchedQty ? '另有品號未對照的 ' + X.fmt(cur.unmatchedQty) + ' 也沒算到金額，請到「對照設定」對照品號' : ''].filter(Boolean).join('；') || '全部都有售價' }
    ]);

    // 依部門（全公司時才顯示）
    if (sd.dept === 'all') {
      var nr = nonRevenue();
      var deptRows = X.DEPTS.map(function (d) { return { label: d.label, a: cur.byDept[d.key], b: prev.byDept[d.key], nonRev: !!nr[d.key] }; });
      if (cur.byDept.unmatched || prev.byDept.unmatched) deptRows.push({ label: '未對照', tone: 'warn', a: cur.byDept.unmatched, b: prev.byDept.unmatched });
      deptRows.push({ label: '合計', total: true, a: { qty: cur.qty, amt: cur.amt }, b: { qty: prev.qty, amt: prev.amt } });
      var q = function (g) { return g ? g.qty : 0; }, m = function (g) { return g ? g.amt : 0; };
      var bold = function (x, v) { return x.total ? '<strong>' + v + '</strong>' : v; };
      html += X.ui.card('依部門（' + periodLabel(sd.kind, sd.year) + ' vs ' + periodLabel(sd.kind, lastYear) + '）', X.ui.table([
        { label: '部門', render: function (x) { return x.total ? '<strong>合計</strong>' : (x.tone ? X.ui.tag(x.label, x.tone) : esc(x.label)); } },
        { label: '今年數量', num: true, render: function (x) { return bold(x, X.fmt(q(x.a))); } },
        { label: '去年數量', num: true, render: function (x) { return bold(x, X.fmt(q(x.b))); } },
        { label: '數量成長', num: true, render: function (x) { return growth(q(x.a), q(x.b)); } },
        { label: '今年金額', num: true, render: function (x) { return x.nonRev ? X.ui.tag('不算營收', 'muted') : bold(x, money(m(x.a))); } },
        { label: '去年金額', num: true, render: function (x) { return x.nonRev ? X.ui.tag('不算營收', 'muted') : bold(x, money(m(x.b))); } },
        { label: '金額成長', num: true, render: function (x) { return x.nonRev ? DASH : growth(m(x.a), m(x.b)); } }
      ], deptRows) +
        '<p class="small" style="margin:10px 0 0">' + (window.CMSRules && CMSRules.get('deptPriority') === 'channel' ? '先用「通路」對照，對不到再用「接單部門」' : '先用「接單部門」對照，對不到再用「通路」') +
        '；兩者都沒有設定對照的歸到「未對照」。部門對照設成「不計算」的訂單不算進合計' + (cur.noneQty ? '（今年數量 ' + X.fmt(cur.noneQty) + '）' : '') + '。' +
        (Object.keys(nr).length ? '公關贈、執行長的數量照算，金額不算營收（可在「計算規則」修改）。' : '') + '對照在「對照設定」頁修改。</p>');
    }

    // 依品項（今年金額排序，前 N 名，見「計算規則」）
    var topN = window.CMSRules ? CMSRules.get('salesTopN') : 15;
    var keys = Object.create(null);
    Object.keys(cur.items).concat(Object.keys(prev.items)).forEach(function (k) { keys[k] = true; });
    var items = Object.keys(keys).map(function (k) {
      var a = cur.items[k], b = prev.items[k], base = a || b;
      return { p: base.p, code: base.code, name: base.name, price: base.price, qa: a ? a.qty : 0, qb: b ? b.qty : 0, ma: a ? a.amt : 0, mb: b ? b.amt : 0 };
    }).sort(function (x, y) { return (y.ma - x.ma) || (y.qa - x.qa) || (y.qb - x.qb); });
    var shown = items.slice(0, topN);
    shown.forEach(function (x, i) { x.rank = i + 1; });
    html += X.ui.card('依品項（今年金額前 ' + topN + ' 名）', X.ui.table([
      { label: '#', num: true, render: function (x) { return String(x.rank); } },
      { label: '品號', render: function (x) { return x.code ? esc(x.code) : DASH; } },
      { label: '名稱', render: function (x) { return esc(x.name || '（沒有名稱）'); } },
      { label: '類別', render: function (x) { return !x.p ? X.ui.tag('未對照', 'warn') : (isSingle(x.p) ? X.ui.tag('單條', 'muted') : X.ui.tag('禮盒', 'info')); } },
      { label: '售價', num: true, render: function (x) { return !x.p ? DASH : (x.price > 0 ? money(x.price) : X.ui.tag('沒有售價', 'warn')); } },
      { label: '今年數量', num: true, render: function (x) { return X.fmt(x.qa); } },
      { label: '去年數量', num: true, render: function (x) { return X.fmt(x.qb); } },
      { label: '成長', num: true, render: function (x) { return growth(x.qa, x.qb); } },
      { label: '今年金額', num: true, render: function (x) { return money(x.ma); } },
      { label: '去年金額', num: true, render: function (x) { return money(x.mb); } }
    ], shown, { empty: '這兩年都沒有訂單' }) +
      (items.length > topN ? '<p class="small" style="margin:10px 0 0">另外還有 ' + (items.length - topN) + ' 個品項未列出（顯示幾名可在「計算規則」修改）。</p>' : '') +
      '<p class="small" style="margin:6px 0 0">品號先看「對照設定」的品號對照，沒有設定的再直接比對禮盒／單條資料的品號（不分大小寫、忽略空白）。售價用目前「禮盒資料」「單條資料」填的售價；禮盒沒填售價時，是否改用內建備用售價見「計算規則」。</p>');

    // 沒有售價的品項
    var unpriced = items.filter(function (x) { return x.p && !(x.price > 0) && (x.qa || x.qb); });
    if (unpriced.length) {
      html += X.ui.card('沒有售價的品項（金額沒算到）', X.ui.table([
        { label: '品號', render: function (x) { return x.code ? esc(x.code) : DASH; } },
        { label: '名稱', render: function (x) { return esc(x.name); } },
        { label: '類別', render: function (x) { return isSingle(x.p) ? X.ui.tag('單條', 'muted') : X.ui.tag('禮盒', 'info'); } },
        { label: '今年數量', num: true, render: function (x) { return X.fmt(x.qa); } },
        { label: '去年數量', num: true, render: function (x) { return X.fmt(x.qb); } }
      ], unpriced) + '<p class="small" style="margin:10px 0 0">禮盒到「禮盒資料」、單條到「單條資料」填售價後，這裡的金額就會更新。</p>');
    }

    var unCh = Object.keys(cur.unCh).sort(function (a, b) { return cur.unCh[b] - cur.unCh[a]; });
    if (sd.dept === 'all' && unCh.length) {
      var chRows = unCh.slice(0, 10).map(function (k) { return { name: k, qty: cur.unCh[k] }; });
      html += X.ui.card('還沒對照部門的通路（今年，前 10 名）', X.ui.table([
        { label: '訂單上的通路／接單部門', render: function (x) { return esc(x.name); } },
        { label: '數量', num: true, render: function (x) { return X.fmt(x.qty); } }
      ], chRows) + (unCh.length > 10 ? '<p class="small" style="margin:10px 0 0">另外還有 ' + (unCh.length - 10) + ' 個未列出。請到「對照設定」的通路、接單部門分頁設定。</p>' : ''));
    }

    html += X.ui.card('預估 vs 實際', X.ui.empty('之後會把「業績預估」填的預估和這裡的實際訂單放在一起，依部門、品項比較達成率。'),
      '<button type="button" class="btn gray"' + LATER + '>比較預估與實際</button>');
    html += '<p class="small" style="margin:4px 0 0">共 ' + X.fmt(rows.length) + ' 筆訂單明細' + (c.ignored ? '（品號設為「不計算」的 ' + X.fmt(c.ignored) + ' 筆不算）' : '') + '，計算 ' + ms + ' 毫秒。</p>';
    el.innerHTML = html;

    el.onchange = function (e) {
      var t = e.target;
      if (!t || !t.dataset) return;
      if (t.dataset.act === 'kind') { sd.kind = t.value; sd.year = ''; renderSalesDash(el); }
      else if (t.dataset.act === 'year') { sd.year = t.value; renderSalesDash(el); }
      else if (t.dataset.act === 'dept') { sd.dept = t.value; renderSalesDash(el); }
    };
  }

  X.registerPage({
    id: 'xSalesDash', group: 'season', order: 30, hidden: true, title: '業績儀表板', sub: '今年和去年同檔期的訂單數量與金額比較', stage: 'ready',
    icon: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5a9 9 0 0 1 5.5 5.5H15z"/>',
    render: function (el) { renderSalesDash(el); },
    _fn: { classifyOrders: classifyOrders, salesCtx: salesCtx, sumPeriod: sumPeriod, yearsOf: yearsOf, state: sd }
  });
})(window.CMSX);

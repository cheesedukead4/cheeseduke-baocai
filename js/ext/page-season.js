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
    if (d > 0) return X.ui.tag('還有 ' + d + ' 天', d <= 30 && s.status !== 'closed' ? 'warn' : 'muted');
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
  var sd = { key: '' };

  // 每筆訂單的「年份|檔期種類」，以及有哪些組合可選（新的在上，同一年中秋在前）
  function orderKeys(rows) {
    var keys = new Array(rows.length), seen = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], y = String((r && r.date) || '').slice(0, 4);
      keys[i] = '';
      if (!/^\d{4}$/.test(y)) continue;
      var k = X.orderSeasonKind(r);
      if (k !== 'newyear' && k !== 'midautumn') continue;
      keys[i] = y + '|' + k;
      seen[keys[i]] = true;
    }
    var options = Object.keys(seen).sort(function (a, b) {
      var ya = a.slice(0, 4), yb = b.slice(0, 4);
      if (ya !== yb) return yb.localeCompare(ya);
      return (a.slice(5) === 'midautumn' ? 0 : 1) - (b.slice(5) === 'midautumn' ? 0 : 1);
    });
    return { keys: keys, options: options };
  }
  function optionLabel(k) { return k === 'all' ? '全部（所有月份）' : k.slice(0, 4) + ' ' + (KIND[k.slice(5)] || ''); }

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

  // 彙總（不讀取 customer 欄位）
  function computeSales(rows, keys, sel, ctx) {
    var deptOk = Object.create(null);
    X.DEPTS.forEach(function (d) { deptOk[d.key] = true; });
    deptOk.none = true;
    var res = { lines: 0, qty: 0, giftQty: 0, singleQty: 0, unmatchedQty: 0, ignoredLines: 0, orderCount: 0, dept: Object.create(null), items: Object.create(null), unCh: Object.create(null) };
    var orderSet = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
      if (sel !== 'all' && keys[i] !== sel) continue;
      var r = rows[i];
      if (!r) continue;
      var code = normCode(r.productCode);
      var cm = code ? ctx.code[code] : null;
      if (cm && cm.kind === 'ignore') { res.ignoredLines++; continue; }
      var q = X.num(r.qty);
      // 有手動對照就用手動對照；對到已刪除的品項算「未對照」（與「對照設定」「開檔檢查」相同），沒有手動對照才比對系統品號
      var manualId = cm && cm.productId != null ? String(cm.productId).trim() : '';
      var p = manualId ? (ctx.byId[manualId] || null) : ((code ? ctx.byCode[code] : null) || null);
      res.lines++;
      res.qty += q;
      var no = String(r.orderNo || r.sourceOrderNo || '').trim() || ('#' + i);
      if (!orderSet[no]) { orderSet[no] = true; res.orderCount++; }
      if (!p) res.unmatchedQty += q; else if (isSingle(p)) res.singleQty += q; else res.giftQty += q;

      var od = String(r.orderDepartment || '').trim(), ch = String(r.channel || '').trim();
      // 先看有寫的接單部門、再看有寫的通路；兩者都對不到時，才用「空白」的對照
      var dk = (od && ctx.od[od]) || (ch && ctx.ch[ch]) || (!od && ctx.od['']) || (!ch && ctx.ch['']) || '';
      if (!deptOk[dk]) {
        dk = 'unmatched';
        var raw = ch || od || '（空白）';
        res.unCh[raw] = (res.unCh[raw] || 0) + q;
      }
      var g = res.dept[dk] || (res.dept[dk] = { qty: 0, lines: 0, orderCount: 0, orders: Object.create(null) });
      g.qty += q;
      g.lines++;
      if (!g.orders[no]) { g.orders[no] = true; g.orderCount++; }

      var ik = p ? 'p:' + p.id : 'c:' + (code || String(r.name || '').trim() || '（空白）');
      var it = res.items[ik] || (res.items[ik] = {
        qty: 0, p: p,
        code: p ? (p.code || '') : String(r.productCode || '').trim(),
        name: p ? (p.name || '') : String(r.name || '').trim()
      });
      it.qty += q;
    }
    return res;
  }

  function renderSalesDash(el) {
    var rows = X.orders();
    var html = intro('彙總過去訂單的盒數，可依檔期查看各部門與各品項的數量（不顯示客戶資料）。');
    el.onchange = null;
    el.oninput = null;
    el.onclick = null;
    if (!rows.length) { el.innerHTML = html + X.ui.empty('還沒有過去訂單資料。'); return; }

    var t0 = now();
    var ok = orderKeys(rows);
    if (sd.key !== 'all' && ok.options.indexOf(sd.key) < 0) sd.key = ok.options[0] || 'all';
    var res = computeSales(rows, ok.keys, sd.key, salesCtx());
    var ms = Math.round(now() - t0);
    var unCh = Object.keys(res.unCh).sort(function (a, b) { return res.unCh[b] - res.unCh[a]; });

    html += '<div class="x-actions" style="margin-bottom:12px;align-items:flex-end">' +
      '<label class="x-field" style="flex:1 1 200px;max-width:280px"><span>檔期</span><select data-act="pick">' +
      ['all'].concat(ok.options).map(function (k) { return '<option value="' + esc(k) + '"' + (k === sd.key ? ' selected' : '') + '>' + esc(optionLabel(k)) + '</option>'; }).join('') +
      '</select></label><span class="small" style="padding-bottom:10px">過年＝1～2 月訂單、中秋＝8～10 月訂單（沿用原系統規則）</span></div>';

    html += X.ui.kpis([
      { label: '訂單筆數', value: X.fmt(res.orderCount), tone: 'info', sub: '不重複單號；明細 ' + X.fmt(res.lines) + ' 筆' },
      { label: '總盒數', value: X.fmt(res.qty), tone: 'ok', sub: res.ignoredLines ? '已略過「不計算」品號 ' + X.fmt(res.ignoredLines) + ' 筆' : '' },
      { label: '對到禮盒的比例', value: pct(res.giftQty, res.qty), tone: 'muted', sub: '單條 ' + X.fmt(res.singleQty) + ' 盒、未對照 ' + X.fmt(res.unmatchedQty) + ' 盒' },
      { label: '未對照的通路數', value: X.fmt(unCh.length), tone: unCh.length ? 'warn' : 'ok', sub: unCh.length ? '請到「對照設定」的通路、接單部門分頁設定' : '全部都已對照' }
    ]);

    // 依部門
    var deptRows = X.DEPTS.map(function (d) { return { label: d.label, g: res.dept[d.key] }; });
    if (res.dept.none) deptRows.push({ label: '不計算', g: res.dept.none, tone: 'muted' });
    if (res.dept.unmatched) deptRows.push({ label: '未對照', g: res.dept.unmatched, tone: 'warn' });
    deptRows.push({ label: '合計', total: true, g: { qty: res.qty, orderCount: res.orderCount } });
    var deptCols = [
      { label: '部門', render: function (x) { return x.total ? '<strong>合計</strong>' : (x.tone ? X.ui.tag(x.label, x.tone) : esc(x.label)); } },
      { label: '盒數', num: true, render: function (x) { var v = x.g ? X.fmt(x.g.qty) : '0'; return x.total ? '<strong>' + v + '</strong>' : v; } },
      { label: '佔比', num: true, render: function (x) { return x.total ? '' : pct(x.g ? x.g.qty : 0, res.qty); } },
      { label: '訂單數', num: true, render: function (x) { return x.g ? X.fmt(x.g.orderCount) : '0'; } }
    ];
    var deptCard = X.ui.card('依部門', X.ui.table(deptCols, deptRows) +
      '<p class="small" style="margin:10px 0 0">先用「接單部門」對照，對不到再用「通路」；兩者都沒有設定對照的歸到「未對照」。對照在「對照設定」頁修改。</p>');

    // 依品項前 15 名
    var items = Object.keys(res.items).map(function (k) { return res.items[k]; })
      .sort(function (a, b) { return b.qty - a.qty; }).slice(0, 15);
    items.forEach(function (x, i) { x.rank = i + 1; });
    var itemCols = [
      { label: '#', num: true, render: function (x) { return String(x.rank); } },
      { label: '品號', render: function (x) { return x.code ? esc(x.code) : DASH; } },
      { label: '名稱', render: function (x) { return esc(x.name || '（沒有名稱）'); } },
      { label: '類別', render: function (x) { return !x.p ? X.ui.tag('未對照', 'warn') : (isSingle(x.p) ? X.ui.tag('單條', 'muted') : X.ui.tag('禮盒', 'info')); } },
      { label: '盒數', num: true, render: function (x) { return X.fmt(x.qty); } },
      { label: '佔比', num: true, render: function (x) { return pct(x.qty, res.qty); } }
    ];
    var itemCard = X.ui.card('依品項（前 15 名）', X.ui.table(itemCols, items, { empty: '這個檔期沒有訂單' }) +
      '<p class="small" style="margin:10px 0 0">品號先看「對照設定」的品號對照，沒有設定的再直接比對禮盒／單條資料的品號（不分大小寫、忽略空白）。</p>');
    html += '<div class="x-cols">' + deptCard + itemCard + '</div>';

    if (unCh.length) {
      var chRows = unCh.slice(0, 10).map(function (k) { return { name: k, qty: res.unCh[k] }; });
      html += X.ui.card('還沒對照部門的通路（前 10 名）', X.ui.table([
        { label: '訂單上的通路／接單部門', render: function (x) { return esc(x.name); } },
        { label: '盒數', num: true, render: function (x) { return X.fmt(x.qty); } }
      ], chRows) + (unCh.length > 10 ? '<p class="small" style="margin:10px 0 0">另外還有 ' + (unCh.length - 10) + ' 個未列出。</p>' : ''));
    }

    html += X.ui.card('預估 vs 實際', X.ui.empty('之後會把「業績預估」填的預估和這裡的實際訂單放在一起，依部門、品項比較達成率。'),
      '<button type="button" class="btn gray"' + LATER + '>比較預估與實際</button>');
    html += '<p class="small" style="margin:4px 0 0">共 ' + X.fmt(rows.length) + ' 筆訂單明細，計算 ' + ms + ' 毫秒。</p>';
    el.innerHTML = html;

    el.onchange = function (e) {
      var t = e.target;
      if (t && t.dataset && t.dataset.act === 'pick') { sd.key = t.value || 'all'; renderSalesDash(el); }
    };
  }

  X.registerPage({
    id: 'xSalesDash', group: 'season', order: 30, hidden: true, title: '業績儀表板', sub: '過去訂單的檔期、部門、品項彙總', stage: 'skeleton',
    icon: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5a9 9 0 0 1 5.5 5.5H15z"/>',
    render: function (el) { renderSalesDash(el); },
    _fn: { orderKeys: orderKeys, salesCtx: salesCtx, computeSales: computeSales, state: sd }
  });
})(window.CMSX);

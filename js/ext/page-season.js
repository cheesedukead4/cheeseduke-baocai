/*
 * 檔期與業績（開發員 A）
 *  - xSeasons   檔期設定（2026-10-17 曾移除，2026-10-20 重新開放並加上每個檔期的品項清單與配方，見 season-items.js）
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
    var rec, wasActive = false;
    if (editId) {
      rec = list.find(function (s) { return s && s.id === editId; });
      if (!rec) return { error: '找不到這個檔期，可能已被其他人刪除。' };
      wasActive = rec.status === 'active';
      Object.assign(rec, data);
    } else {
      rec = Object.assign({ id: X.uid('sea'), createdAt: Date.now(), by: X.userName() }, data);
      list.push(rec);
    }
    // 改成進行中：把原本進行中檔期的上架清單與配方存起來，換成這個檔期的（見 season-items.js）
    if (rec.status === 'active' && !wasActive && X.seasonItems) {
      X.seasonItems.activate(rec, list.find(function (x) { return x && x.id !== rec.id && x.status === 'active'; }) || null);
    }
    return { rec: rec, demoted: rec.status === 'active' ? demoteOthers(list, rec.id) : [] };
  }
  function deleteSeason(id) {
    var list = X.ensure('seasons');
    var i = list.findIndex(function (s) { return s && s.id === id; });
    if (i < 0) return false;
    list.splice(i, 1);
    list.forEach(function (s) { if (s && s.compareSeasonId === id) s.compareSeasonId = ''; });
    if (X.get('seasonRecipes')[id]) delete X.ensure('seasonRecipes')[id];
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
    var SI = X.seasonItems, pend = SI ? SI.pendingSeed() : [];
    if (pend.length) {
      html += X.ui.banner('info', '過去訂單裡有 ' + pend.length + ' 個檔期還沒建立檔期資料或品項清單（' + pend.map(function (p) { return p.g.sy + (KIND[p.g.kind] || ''); }).join('、') + '）。' +
        '<div style="margin-top:8px"><button type="button" class="btn primary" data-act="seed">依過去訂單建立檔期與品項清單</button></div>' +
        '<div class="small" style="margin-top:6px">節日日期、期間、品項清單都來自訂單與內建的節日表（過年填除夕），建立後可以再修改；配方先沿用目前的配方，再逐檔期調整。</div>');
    }

    var SM = ' style="min-height:30px;padding:2px 9px;font-size:12px"'; // 小按鈕，列表不要太大
    var cols = [
      { label: '檔期', render: function (s) {
        return '<strong' + (s.note ? ' title="' + esc(s.note) + '"' : '') + '>' + esc(s.name) + '</strong> ' + kindTag(s.kind) + ' ' + statusTag(s.status);
      } },
      { label: '期間／節日／比較', render: function (s) {
        var range = (s.startDate || s.endDate) ? esc(s.startDate || '未定') + '～' + esc(String(s.endDate || '未定').slice(DATE_RE.test(s.endDate || '') && String(s.endDate).slice(0, 4) === String(s.startDate || '').slice(0, 4) ? 5 : 0)) : '';
        var hol = s.holidayDate ? '節日 ' + esc(s.holidayDate) + ' ' + holidayHtml(s) : '';
        var cmp = s.compareSeasonId ? '比較：' + esc(nameOf[s.compareSeasonId] || '（已刪除）') : '';
        return '<div class="small">' + (range || DASH) + '</div>' + (hol ? '<div class="small" style="margin-top:2px">' + hol + '</div>' : '') + (cmp ? '<div class="small" style="margin-top:2px">' + cmp + '</div>' : '');
      } },
      { label: '品項／配方', render: function (s) {
        if (!SI) return DASH;
        var m = SI.summary(s);
        return ((m.gifts + m.singles) ? '禮盒 ' + m.gifts + '、單條 ' + m.singles : X.ui.tag('清單未設定', 'warn')) +
          '<div class="small" style="margin-top:2px">' + (m.hasRecipes ? m.recipeProducts + ' 個禮盒有配方' : X.ui.tag('沒有自己的配方', 'warn')) + '</div>';
      } },
      { label: '操作', render: function (s) {
        var id = esc(s.id);
        return '<div style="display:flex;flex-wrap:wrap;gap:4px;min-width:150px;max-width:230px">' +
          (SI ? '<button type="button" class="btn primary" data-act="items" data-id="' + id + '"' + SM + '>品項</button>' +
            '<button type="button" class="btn primary" data-act="recipes" data-id="' + id + '"' + SM + '>配方</button>' : '') +
          '<button type="button" class="btn gray" data-act="edit" data-id="' + id + '"' + SM + '>編輯</button>' +
          (s.status !== 'active' ? '<button type="button" class="btn green" data-act="activate" data-id="' + id + '"' + SM + '>設為進行中</button>' : '') +
          (s.status !== 'closed' ? '<button type="button" class="btn gray" data-act="close" data-id="' + id + '"' + SM + '>結束</button>' : '') +
          '<button type="button" class="btn red" data-act="del" data-id="' + id + '"' + SM + '>刪除</button></div>';
      } }
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
      if (act === 'seed') {
        var r = X.seasonItems.seed();
        X.toast(r.made.length || r.filled.length ? '已建立：' + r.made.concat(r.filled).join('、') : '沒有需要建立的');
        return;
      }
      var all = X.ensure('seasons');
      var s = all.find(function (x) { return x && x.id === b.dataset.id; });
      if (!s) return;
      if (act === 'edit') {
        openSeasonDialog(s);
      } else if (act === 'items') {
        SI.openItemsDialog(s, function () { renderSeasons(el); });
      } else if (act === 'recipes') {
        SI.openRecipeDialog(s, function () { renderSeasons(el); });
      } else if (act === 'activate') {
        var cur = all.find(function (x) { return x && x.status === 'active' && x.id !== s.id; });
        if (!confirm((cur ? '目前進行中的是「' + cur.name + '」，改成「' + s.name + '」後它會改回規劃中。\n' : '') +
          '設為進行中後，首頁的「本期上架」和包材配方會換成「' + s.name + '」自己的品項清單與配方（原本進行中檔期的會先存起來）。\n確定嗎？')) return;
        if (SI) SI.activate(s, cur || null);
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
    id: 'xSeasons', group: 'season', order: 10, title: '檔期設定', sub: '每個檔期的日期、品項清單與配方', stage: 'ready',
    icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M10 13.5v5M10 13.5h4.5l-1 1.3 1 1.3H10"/>',
    render: function (el) { renderSeasons(el); },
    _fn: { checkSeason: checkSeason, applySeason: applySeason, deleteSeason: deleteSeason, sortSeasons: sortSeasons, daysToHoliday: daysToHoliday }
  });

  // ================= (3) 業績儀表板 =================
  // 今年和去年同一個檔期（或全年）比較：訂單數量與金額，可以看全公司或單一部門。
  // 金額＝數量 × 目前的售價（訂單資料沒有金額）：禮盒用「禮盒資料」的售價、單條用「單條資料」的售價（CMSX.productPrice，
  // 禮盒沒填售價時是否改用內建備用售價見「計算規則」）。去年的金額也用目前的售價計算。
  // 部門對照設成「不計算」的訂單不算進數量與金額。
  var sd = { kind: '', year: '', dept: 'all', metric: 'amt', group: 'all', sel: '', cmp: 'auto', span: '4' };
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

  // ================= 業績波動圖（依週）=================
  // 三條線：實際（所選檔期／年份的訂單）、預估（「業績預估」頁各日期填的盒數）、去年（去年同檔期，往後對齊 52 週）。
  // 可切換「金額」「禮盒數」；金額＝數量 × 目前售價（公關贈、執行長不算營收）；禮盒數不含單條與品號未對照的訂單。
  var DAY = 86400000;
  var C_ACT = '#2f5bd3', C_EST = '#c2691a', C_PREV = '#2a9d8f'; // 已用調色盤驗證工具檢查過：色盲分得開、對比足夠
  function dateMs(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; }
  function weekOf(ms) { return ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY; } // 這一週的星期一
  function md(ms) { var d = new Date(ms); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); }

  // ---- 檔期與禮盒規格 ----
  // 檔期（過年、中秋）的節日日期來自 db.seasons；有兩個檔期的節日日期時，圖是「依檔期」對齊：以「節日所在的那一週」為 0，
  // 往前是節前第 N 週、往後是節後第 N 週。找不到檔期資料時退回「同一週」（去年往後挪 52 週）。
  function seasonYearOf(s) { return s && DATE_RE.test(s.holidayDate || '') ? String(s.holidayDate).slice(0, 4) : ''; }
  function findSeason(kind, year) {
    return X.get('seasons').find(function (s) { return s && s.kind === kind && seasonYearOf(s) === String(year); }) || null;
  }
  // 比較用檔期：檔期資料裡設定的「比較用檔期」，沒設定就找去年同種類的檔期
  function compareSeasonOf(sel, kind, year) {
    var c = sel && sel.compareSeasonId ? X.get('seasons').find(function (s) { return s && s.id === sel.compareSeasonId; }) : null;
    return c || findSeason(kind, String(Number(year) - 1));
  }
  // 禮盒規格：只拿 5 入費雪、8 入費雪、蛋捲 10 入比較（每個檔期的品項不一樣，規格才好比）
  var GROUPS = [['all', '全部商品'], ['all3', '三類合計'], ['box5', '5入費雪'], ['box8', '8入費雪'], ['egg10', '蛋捲10入']];
  function groupName(key) { return (GROUPS.find(function (g) { return g[0] === key; }) || GROUPS[1])[1]; }
  function giftGroup(p) {
    if (!p || isSingle(p)) return '';
    var name = String(p.name || ''), m = /(\d+)\s*入/.exec(name), n = m ? Number(m[1]) : 0;
    if (/蛋捲/.test(name) && (n === 10 || /5\+\S*5/.test(name))) return 'egg10';
    if (/費/.test(name) && !/蛋捲/.test(name)) { if (n === 5) return 'box5'; if (n === 8) return 'box8'; }
    return '';
  }
  function inGroup(p, group) { var g = giftGroup(p); return !!g && (group === 'all3' || group === g); }

  // 訂單依週彙總：回傳 { 週的代號: 數值 }；keyFn(日期毫秒) 決定這筆訂單放在哪一週
  function weeklyOrders(list, kind, year, dept, metric, group, keyFn) {
    var out = Object.create(null), nonRev = nonRevenue();
    list.forEach(function (o) {
      if (!inPeriod(o, kind, year) || o.dk === 'none') return;
      if (dept !== 'all' && o.dk !== dept) return;
      var t = dateMs(o.date);
      if (t == null) return;
      var v;
      if (metric === 'amt') v = (group !== 'all' && !inGroup(o.p, group)) ? 0 : (nonRev[o.dk] ? 0 : o.q * o.price);
      else v = inGroup(o.p, group === 'all' ? 'all3' : group) ? o.q : 0;
      var w = keyFn(t);
      out[w] = (out[w] || 0) + v;
    });
    return out;
  }
  // 預估依週彙總：「業績預估」每個禮盒有 4 個日期，每個日期各部門的預估盒數；放進該日期所在的那一週
  function forecastSeasonOk(ds, kind, year) {
    var k = X.orderSeasonKind({ date: ds });
    var sy = (k === 'newyear' || k === 'midautumn') && window.CMSRules ? CMSRules.seasonYear(ds, k) : String(ds).slice(0, 4);
    return kind === 'year' ? String(ds).slice(0, 4) === year : (k === kind && String(sy) === String(year));
  }
  function forecastRows() { var f = X.db() && X.db().salesForecastV5; return (f && f.rows && typeof f.rows === 'object') ? f.rows : {}; }
  function forecastYears(kind) {
    var seen = Object.create(null), rows = forecastRows();
    Object.keys(rows).forEach(function (code) {
      var r = rows[code];
      (r && r.dates || []).forEach(function (ds, n) {
        if (dateMs(ds) == null) return;
        var k = X.orderSeasonKind({ date: ds });
        if (kind === 'year') seen[String(ds).slice(0, 4)] = true;
        else if (k === kind) seen[String(window.CMSRules ? CMSRules.seasonYear(ds, k) : ds.slice(0, 4))] = true;
      });
    });
    return Object.keys(seen);
  }
  function weeklyForecast(ctx, kind, year, dept, metric, group, keyFn) {
    var out = Object.create(null), rows = forecastRows(), nonRev = nonRevenue(), anyEst = false;
    if (dept === 'unmatched') return { map: out, any: false };
    Object.keys(rows).forEach(function (code) {
      var r = rows[code];
      if (!r || !r.lines) return;
      var p = ctx.byCode[normCode(code)] || ctx.byId[String(code)] || null;
      if (metric === 'qty' ? !inGroup(p, group === 'all' ? 'all3' : group) : (group !== 'all' && !inGroup(p, group))) return;
      var price = 0;
      if (metric === 'amt') price = p ? X.num(typeof sfUnitPrice === 'function' ? sfUnitPrice(p) : X.productPrice(p)) : X.num(r.price);
      (r.dates || []).forEach(function (ds, n) {
        var t = dateMs(ds);
        if (t == null || !r.lines[n] || !forecastSeasonOk(ds, kind, year)) return;
        var sum = 0;
        Object.keys(r.lines[n]).forEach(function (dk) {
          if (dept !== 'all' && dk !== dept) return;
          var est = X.num((r.lines[n][dk] || {}).est);
          if (est > 0) anyEst = true;
          sum += metric === 'amt' ? (nonRev[dk] ? 0 : est * price) : est;
        });
        var w = keyFn(t);
        out[w] = (out[w] || 0) + sum;
      });
    });
    return { map: out, any: anyEst };
  }

  function axisFmt(v, metric) {
    if (metric === 'amt' && v >= 10000) return (Math.round(v / 1000) / 10) + ' 萬';
    return X.fmt(v);
  }
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function valText(v, metric) { return v == null ? '—' : (metric === 'amt' ? money(v) : X.fmt(v) + ' 盒'); }

  // 整理成每週一筆：weeks 是週的代號（依檔期對齊時是「節日週＝0」的週數，否則是星期一的毫秒）；沒有資料的線整條是 null
  function buildWeekly(list, ctx, selC, cmpC, dept, metric, group, span) {
    var kind = selC.kind, year = selC.year, selS = selC.season, cmpS = cmpC ? cmpC.season : null;
    var hSel = selS ? dateMs(selS.holidayDate) : null, hCmp = cmpS ? dateMs(cmpS.holidayDate) : null;
    var byHoliday = hSel != null && (!cmpC || hCmp != null); // 沒有比較檔期時，只要所選檔期有節日日期就依節日週對齊
    var prevKind = cmpC ? cmpC.kind : kind, prevYear = cmpC ? cmpC.year : '';
    var shift = cmpC ? Math.round((Date.UTC(Number(year), 0, 1) - Date.UTC(Number(prevYear), 0, 1)) / DAY / 7) * 7 : 0;
    var cmpIsLast = !!cmpC && cmpC.kind === kind && Number(cmpC.year) === Number(year) - 1;
    var keySel, keyPrev, startSel, startPrev;
    if (byHoliday) {
      var aSel = weekOf(hSel), aCmp = hCmp != null ? weekOf(hCmp) : aSel;
      keySel = function (t) { return Math.floor((weekOf(t) - aSel) / (7 * DAY)); };
      keyPrev = function (t) { return Math.floor((weekOf(t) - aCmp) / (7 * DAY)); };
      startSel = function (k) { return aSel + k * 7 * DAY; };
      startPrev = function (k) { return aCmp + k * 7 * DAY; };
    } else {
      keySel = weekOf;
      keyPrev = function (t) { return weekOf(t + shift * DAY); };
      startSel = function (k) { return k; };
      startPrev = function (k) { return k - shift * DAY; };
    }
    var a = weeklyOrders(list, kind, year, dept, metric, group, keySel);
    var b = cmpC ? weeklyOrders(list, prevKind, prevYear, dept, metric, group, keyPrev) : Object.create(null);
    var f = weeklyForecast(ctx, kind, year, dept, metric, group, keySel);
    var keysOf = function (m) { return Object.keys(m).map(Number); };
    var ka = keysOf(a), kb = keysOf(b), kf = f.any ? keysOf(f.map) : [];
    var all = ka.concat(kb, kf);
    if (!all.length) return null;
    var min = Math.min.apply(null, all), max = Math.max.apply(null, all), weeks = [];
    var stepK = byHoliday ? 1 : 7 * DAY;
    for (var t = min; t <= max && weeks.length < 120; t += stepK) weeks.push(t);
    var nowWk = weekOf(dateMs(X.today()));
    var lo = function (k) { return k.length ? Math.min.apply(null, k) : null; }, hi = function (k) { return k.length ? Math.max.apply(null, k) : null; };
    var fLo = lo(kf), fHi = hi(kf), bLo = lo(kb), bHi = hi(kb);
    // 週期：四週（依檔期對齊時＝節前 3 週～節日週；否則是資料的最後四週），或全部週
    var spanNote = '';
    if (span === '4') {
      var w4 = byHoliday ? weeks.filter(function (k) { return k >= -3 && k <= 0; }) : weeks.slice(-4);
      var inW = function (m, kk) { return kk.some(function (k) { return w4.indexOf(k) >= 0; }); };
      if (w4.length && (inW(a, ka) || inW(b, kb) || inW(f.map, kf))) weeks = w4;
      else spanNote = '這四週沒有資料，已顯示全部的週';
    }
    var pick = function (fn) { return weeks.map(fn); };
    var actArr = pick(function (k) { return ka.length && startSel(k) <= nowWk ? (a[k] || 0) : null; });
    var estArr = pick(function (k) { return fLo != null && k >= fLo && k <= fHi ? (f.map[k] || 0) : null; });
    var prevArr = pick(function (k) { return bLo != null && k >= bLo && k <= bHi ? (b[k] || 0) : null; });
    var any = function (arr) { return arr.some(function (v) { return v != null; }); };
    return {
      weeks: weeks, year: year, lastYear: prevYear, byHoliday: byHoliday, selName: selC.name, cmpName: cmpC ? cmpC.name : '', prevLabel: cmpIsLast ? '去年' : '比較檔期',
      span4: span === '4' && !spanNote, spanNote: spanNote,
      hasAct: any(actArr), hasEst: f.any && any(estArr), hasPrev: any(prevArr),
      // 週的標示：依檔期對齊時用「節前 N 週／節日週／節後 N 週」，否則用星期一的日期
      label: function (k) { return byHoliday ? (k === 0 ? '節日週' : (k < 0 ? '節前 ' + (-k) + ' 週' : '節後 ' + k + ' 週')) : md(k); },
      rangeSel: function (k) { var s = startSel(k); return md(s) + '～' + md(s + 6 * DAY); },
      rangePrev: function (k) { var s = startPrev(k); return md(s) + '～' + md(s + 6 * DAY); },
      // 實際：還沒到的週不畫；預估只畫第一個到最後一個有預估的週；去年畫去年有訂單的範圍
      act: actArr, est: estArr, prev: prevArr
    };
  }

  // 折線圖（SVG）：一條實際（實線）、一條預估（虛線）、一條去年；線尾直接標名稱；滑過每一週顯示數值
  function chartSvg(m, metric) {
    var W = 760, H = 224, L = 58, R = 74, T = 12, B = 40, n = m.weeks.length;
    var series = [
      { key: 'act', name: '實際', color: C_ACT, dash: '' },
      { key: 'est', name: '預估', color: C_EST, dash: '7 5' },
      { key: 'prev', name: m.prevLabel === '去年' ? '去年' : '比較', color: C_PREV, dash: '' }
    ].filter(function (s) { return m['has' + s.key.charAt(0).toUpperCase() + s.key.slice(1)]; });
    var maxV = 0;
    series.forEach(function (s) { m[s.key].forEach(function (v) { if (v != null && v > maxV) maxV = v; }); });
    var top = niceMax(maxV), iw = W - L - R, ih = H - T - B;
    var x = function (i) { return L + (n === 1 ? iw / 2 : iw * i / (n - 1)); };
    var y = function (v) { return T + ih - ih * v / top; };
    var g = '';
    for (var k = 0; k <= 4; k++) {
      var gv = top * k / 4, gy = y(gv);
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '" stroke="var(--line)" stroke-width="1"/>' +
        '<text x="' + (L - 8) + '" y="' + (gy + 4) + '" text-anchor="end" font-size="11" fill="var(--text-3)">' + esc(axisFmt(gv, metric)) + '</text>';
    }
    var step = Math.max(1, Math.ceil(n / (m.byHoliday ? 8 : 10))), xl = '';
    m.weeks.forEach(function (t, i) {
      if (i % step === 0) xl += '<text x="' + x(i) + '" y="' + (H - B + 18) + '" text-anchor="middle" font-size="11" fill="' + (m.byHoliday && t === 0 ? 'var(--text)' : 'var(--text-3)') + '"' + (m.byHoliday && t === 0 ? ' font-weight="700"' : '') + '>' + esc(m.label(t)) + '</text>';
    });
    xl += '<text x="' + L + '" y="' + (H - 6) + '" font-size="10" fill="var(--text-3)">' + (m.byHoliday ? '橫軸：離節日幾週（節日週＝節日當天所在的那一週，週一～週日）' : '橫軸：每週一～週日，標的是星期一的日期') + '</text>';
    // 節日週的標線（依檔期對齊時）
    var holi = '';
    if (m.byHoliday) { var hi0 = m.weeks.indexOf(0); if (hi0 >= 0) holi = '<line x1="' + x(hi0) + '" x2="' + x(hi0) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--line-strong)" stroke-width="1.5"/>'; }
    var lines = '', labels = '', ends = [];
    series.forEach(function (s) {
      var d = '', pen = false, last = -1;
      m[s.key].forEach(function (v, i) {
        if (v == null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' ';
        pen = true; last = i;
      });
      lines += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"' + (s.dash ? ' stroke-dasharray="' + s.dash + '"' : '') + '/>';
      m[s.key].forEach(function (v, i) {
        if (v == null) return;
        lines += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="3.5" fill="' + s.color + '" stroke="var(--surface)" stroke-width="2"/>';
      });
      if (last >= 0) ends.push({ name: s.name, x: x(last) + 9, y: y(m[s.key][last]) + 4 });
    });
    // 線尾的名稱：幾條線結束在同一個位置時，上下錯開，不要疊在一起
    ends.sort(function (p, q) { return p.y - q.y; });
    ends.forEach(function (e, i) {
      for (var j = 0; j < i; j++) if (Math.abs(ends[j].x - e.x) < 60 && e.y - ends[j].y < 15) e.y = ends[j].y + 15;
      labels += '<text x="' + e.x + '" y="' + e.y + '" font-size="12" font-weight="700" fill="var(--text)">' + e.name + '</text>';
    });
    return { svg: '<svg data-chart viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="每週實際、預估與去年的' + (metric === 'amt' ? '金額' : '禮盒數') + '波動圖，下方有表格版" style="display:block;width:100%;height:auto;max-width:100%;stroke:none;touch-action:pan-y">' +
      g + xl + holi + '<line data-guide x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--text-3)" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>' + lines + labels + '</svg>',
      geom: { W: W, L: L, R: R, n: n, iw: iw }, series: series };
  }

  function renderChartCard(m, metric, deptName, group) {
    var gName = groupName(metric === 'qty' && group === 'all' ? 'all3' : group);
    if (!m) return X.ui.card('每週波動', X.ui.empty('這個檔期、這個部門沒有訂單，也沒有預估資料可以畫。'));
    var c = chartSvg(m, metric);
    var leg = c.series.map(function (s) {
      var t = s.key === 'prev' ? m.prevLabel + (m.cmpName ? '（' + m.cmpName + (m.byHoliday ? '，對齊節日週' : '，同一週對齊') + '）' : '')
        : s.key === 'act' ? '實際（' + (m.selName || m.year) + '）' : '預估（業績預估頁）';
      return '<span style="display:inline-flex;align-items:center;gap:6px;margin-right:14px"><svg width="26" height="10" aria-hidden="true" style="width:26px;height:10px"><line x1="0" x2="26" y1="5" y2="5" stroke="' + s.color + '" stroke-width="2.5"' + (s.dash ? ' stroke-dasharray="7 5"' : '') + '/></svg>' + esc(t) + '</span>';
    }).join('');
    var miss = [];
    if (!m.hasAct) miss.push('這個檔期還沒有訂單，沒有「實際」線');
    if (!m.hasEst) miss.push('「業績預估」頁這個檔期還沒填預估（或預估日期不在這個檔期' + (group !== 'all' ? '、或填的禮盒不是 ' + gName : '') + '），沒有「預估」線');
    if (!m.hasPrev) miss.push('比較檔期沒有訂單' + (group !== 'all' ? '（或沒有 ' + gName + '）' : '') + '，沒有比較線');
    if (m.spanNote) miss.push(m.spanNote);
    if (!m.byHoliday && m.cmpName) miss.push('這個檔期或比較檔期還沒有節日日期，所以先用「同一週」對齊');
    var tbl = X.ui.table([
      { label: m.byHoliday ? '週（離節日）' : '週（星期一）', render: function (r) { return esc(m.label(r.t)); } },
      { label: '今年日期', render: function (r) { return '<span class="small">' + esc(m.rangeSel(r.t)) + '</span>'; } },
      { label: '實際', num: true, render: function (r) { return r.act == null ? DASH : esc(valText(r.act, metric)); } },
      { label: '預估', num: true, render: function (r) { return r.est == null ? DASH : esc(valText(r.est, metric)); } },
      { label: m.prevLabel + '日期', render: function (r) { return r.prev == null ? DASH : '<span class="small">' + esc(m.rangePrev(r.t)) + '</span>'; } },
      { label: m.prevLabel + '同週', num: true, render: function (r) { return r.prev == null ? DASH : esc(valText(r.prev, metric)); } },
      { label: '實際比' + m.prevLabel, num: true, render: function (r) { return r.act == null || r.prev == null ? DASH : growth(r.act, r.prev); } }
    ], m.weeks.map(function (t, i) { return { t: t, act: m.act[i], est: m.est[i], prev: m.prev[i] }; }), { empty: '沒有資料' });
    return X.ui.card(deptName + '｜每週' + (metric === 'amt' ? '金額' : '禮盒數') + '（' + gName + '）',
      '<div style="margin-bottom:6px;font-size:12.5px">' + leg + '</div>' +
      '<div data-chartbox style="position:relative;max-width:720px">' + c.svg + '<div data-tip role="status" style="display:none;position:absolute;pointer-events:none;background:var(--surface);border:1px solid var(--line-strong);border-radius:8px;box-shadow:var(--shadow);padding:8px 10px;font-size:12px;line-height:1.7;white-space:nowrap;z-index:2"></div></div>' +
      (miss.length ? '<p class="small" style="margin:6px 0 0;color:var(--warn)">' + esc(miss.join('；')) + '。</p>' : '') +
      '<details style="margin-top:8px"><summary style="cursor:pointer;font-weight:700">看表格版與說明</summary><div style="margin-top:8px">' + tbl +
      '<p class="small" style="margin:10px 0 0">' +
        (m.byHoliday ? '依檔期對齊：以各檔期節日（「檔期設定」的節日日期）所在的那一週為「節日週」，兩個檔期都從這一週往前、往後數，節日日期不同也能同週比較。' : '') +
        '實際＝訂單日期落在那一週的數量或金額；預估＝「業績預估」頁各禮盒、各日期填的預估盒數，放在該日期所在的那一週，只畫第一個到最後一個有填預估的週。' +
        '金額＝數量 × 目前售價，公關贈、執行長的金額不算營收；禮盒規格只算 5 入費雪、8 入費雪、蛋捲 10 入（依品名判斷）；選「全部商品」看金額時含單條與其他規格；「禮盒數」不含單條與品號還沒對照的訂單。還沒到的週不畫實際。</p></div></details>');
  }

  // 滑過（或手指按住）某一週：顯示那一週三條線的數字
  function bindChart(el, m, metric) {
    var box = el.querySelector('[data-chartbox]'), svg = box && box.querySelector('svg[data-chart]');
    if (!svg || !m) return;
    var tip = box.querySelector('[data-tip]'), guide = svg.querySelector('[data-guide]');
    var vb = svg.viewBox.baseVal, L = 58, R = 74, n = m.weeks.length;
    function show(ev) {
      var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * vb.width / r.width;
      var iw = vb.width - L - R, i = n === 1 ? 0 : Math.round((px - L) / iw * (n - 1));
      if (i < 0 || i > n - 1) { hide(); return; }
      var gx = L + (n === 1 ? iw / 2 : iw * i / (n - 1));
      guide.setAttribute('x1', gx); guide.setAttribute('x2', gx); guide.style.display = '';
      var row = function (name, color, v, range) { return v == null ? '' : '<div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + color + ';margin-right:6px"></span>' + name + '：<b>' + esc(valText(v, metric)) + '</b>' + (range ? ' <span style="color:var(--text-3)">' + esc(range) + '</span>' : '') + '</div>'; };
      var wk = m.weeks[i];
      tip.innerHTML = '<div style="font-weight:700">' + esc(m.label(wk)) + '</div>' + row('實際', C_ACT, m.act[i], m.rangeSel(wk)) + row('預估', C_EST, m.est[i], m.rangeSel(wk)) + row(m.prevLabel + '同週', C_PREV, m.prev[i], m.rangePrev(wk));
      tip.style.display = 'block';
      var bx = box.getBoundingClientRect(), left = (gx / vb.width) * r.width + (r.left - bx.left) + 12;
      if (left + tip.offsetWidth > box.clientWidth) left -= tip.offsetWidth + 24;
      tip.style.left = Math.max(0, left) + 'px'; tip.style.top = '8px';
    }
    function hide() { guide.style.display = 'none'; tip.style.display = 'none'; }
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);
  }

  // 可以選的檔期（按鈕）：檔期設定裡的過年、中秋（新的在前）＋ 有訂單但還沒有檔期資料的 ＋ 各年全年
  function seasonChoices(list) {
    var out = [], seen = Object.create(null);
    X.get('seasons').forEach(function (s) {
      if (!s || (s.kind !== 'newyear' && s.kind !== 'midautumn')) return;
      var y = seasonYearOf(s);
      if (!y || seen[s.kind + '|' + y]) return;
      seen[s.kind + '|' + y] = true;
      out.push({ id: s.id, name: s.name, kind: s.kind, year: y, season: s, t: dateMs(s.holidayDate) });
    });
    ['newyear', 'midautumn'].forEach(function (kind) {
      yearsOf(list, kind).forEach(function (y) {
        if (!seen[kind + '|' + y]) out.push({ id: kind + '-' + y, name: y + KIND[kind], kind: kind, year: y, season: null, t: Date.UTC(Number(y), kind === 'newyear' ? 1 : 8, 15) });
      });
    });
    out.sort(function (a, b) { return b.t - a.t; });
    yearsOf(list, 'year').forEach(function (y) { out.push({ id: 'year-' + y, name: y + ' 全年', kind: 'year', year: y, season: null, t: 0 }); });
    return out;
  }

  function renderSalesDash(el) {
    var rows = X.orders();
    var html = intro('用按鈕選檔期、比較的檔期、部門、金額或禮盒數與禮盒規格，下面的波動圖看每週的實際、預估與比較檔期（不顯示客戶資料）；圖下方的表格是整個檔期的合計比較。');
    el.onchange = null;
    el.oninput = null;
    el.onclick = null;
    if (!rows.length) { el.innerHTML = html + X.ui.empty('還沒有過去訂單資料。'); return; }

    var t0 = now();
    var c = classifyOrders(rows, salesCtx());
    var list = c.list;
    var choices = seasonChoices(list);
    var hasData = function (ch) { return yearsOf(list, ch.kind).indexOf(ch.year) >= 0 || forecastYears(ch.kind).indexOf(ch.year) >= 0; };
    var selC = choices.find(function (ch) { return ch.id === sd.sel; }) || choices.find(hasData) || choices[0] || null;
    if (!selC) { el.innerHTML = html + X.ui.empty('還沒有檔期，也沒有可以分檔期的訂單。請到「檔期設定」建立檔期。'); return; }
    sd.sel = selC.id; sd.kind = selC.kind; sd.year = selC.year;
    var cmpC = null;
    if (sd.cmp && sd.cmp !== 'auto' && sd.cmp !== 'none') cmpC = choices.find(function (ch) { return ch.id === sd.cmp && ch.id !== selC.id; }) || null;
    if (!cmpC && sd.cmp !== 'none') { // 自動：檔期資料裡的「比較用檔期」，沒有就找去年同種類的檔期
      var cid = selC.season && selC.season.compareSeasonId;
      cmpC = (cid && choices.find(function (ch) { return ch.id === cid; })) ||
        choices.find(function (ch) { return ch.kind === selC.kind && Number(ch.year) === Number(selC.year) - 1; }) || null;
    }
    var deptOpts = [{ key: 'all', label: '全公司' }].concat(X.DEPTS.map(function (d) { return { key: d.key, label: d.label }; }), [{ key: 'unmatched', label: '未對照' }]);
    if (!deptOpts.some(function (d) { return d.key === sd.dept; })) sd.dept = 'all';
    if (sd.metric === 'qty' && sd.group === 'all') sd.group = 'all3';
    var lastYear = cmpC ? cmpC.year : '', cmpKind = cmpC ? cmpC.kind : sd.kind;
    var cur = sumPeriod(list, sd.kind, sd.year, sd.dept);
    var prev = cmpC ? sumPeriod(list, cmpC.kind, cmpC.year, sd.dept) : sumPeriod(list, 'year', '0000', sd.dept);
    var ms = Math.round(now() - t0);
    var deptName = (deptOpts.find(function (d) { return d.key === sd.dept; }) || {}).label;

    // 用按鈕選：檔期、比較檔期、部門、金額／禮盒數、禮盒規格
    var chip = function (act, id, label, on) {
      return '<button type="button" class="btn ' + (on ? 'primary' : 'gray') + '" data-act="' + act + '" data-v="' + esc(id) + '" aria-pressed="' + (on ? 'true' : 'false') + '" style="min-height:30px;padding:3px 11px;font-size:12.5px">' + esc(label) + '</button>';
    };
    var row = function (label, chips) {
      return '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px"><span class="small" style="min-width:60px;font-weight:700">' + label + '</span>' + chips + '</div>';
    };
    html += row('檔期', choices.map(function (ch) { return chip('sel', ch.id, ch.name, ch.id === selC.id); }).join(''));
    html += row('比較', chip('cmp', 'auto', '自動', sd.cmp !== 'none' && (!sd.cmp || sd.cmp === 'auto' || !choices.some(function (ch) { return ch.id === sd.cmp && ch.id !== selC.id; }))) +
      choices.filter(function (ch) { return ch.id !== selC.id; }).map(function (ch) { return chip('cmp', ch.id, ch.name, sd.cmp === ch.id); }).join('') +
      chip('cmp', 'none', '不比較', sd.cmp === 'none') +
      '<span class="small">' + (cmpC ? '目前比較：' + esc(cmpC.name) : '目前沒有比較檔期') + '</span>');
    html += row('週期', chip('span', '4', '四週（節前 3 週～節日週）', sd.span !== 'all') + chip('span', 'all', '全部週', sd.span === 'all'));
    html += row('部門', deptOpts.map(function (d) { return chip('dept', d.key, d.label, d.key === sd.dept); }).join(''));
    html += row('看', chip('metric', 'amt', '金額', sd.metric === 'amt') + chip('metric', 'qty', '禮盒數', sd.metric === 'qty') +
      '<span class="small" style="margin:0 2px 0 8px;font-weight:700">規格</span>' +
      GROUPS.filter(function (g) { return !(sd.metric === 'qty' && g[0] === 'all'); }).map(function (g) { return chip('group', g[0], g[1], g[0] === sd.group); }).join(''));
    html += '<p class="small" style="margin:0 0 10px">' +
      esc('今年（' + periodLabel(sd.kind, sd.year) + '）：' + shortRange(cur) + (cmpC ? '；比較（' + periodLabel(cmpKind, lastYear) + '）：' + shortRange(prev) : '') + '。') +
      (cmpC && prev.minDate && cur.minDate && (prev.minDate.slice(5) !== cur.minDate.slice(5) || prev.maxDate.slice(5) !== cur.maxDate.slice(5)) ? ' <b>兩個檔期的訂單日期範圍不一樣，比較時請留意。</b>' : '') + '</p>';

    var weekly = buildWeekly(list, salesCtx(), selC, cmpC, sd.dept, sd.metric, sd.group, sd.span);
    html += renderChartCard(weekly, sd.metric, deptName, sd.group);

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
      html += X.ui.card('依部門（' + periodLabel(sd.kind, sd.year) + ' vs ' + periodLabel(cmpKind, lastYear) + '）', X.ui.table([
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

    html += '<p class="small" style="margin:4px 0 0">共 ' + X.fmt(rows.length) + ' 筆訂單明細' + (c.ignored ? '（品號設為「不計算」的 ' + X.fmt(c.ignored) + ' 筆不算）' : '') + '，計算 ' + ms + ' 毫秒。</p>';
    el.innerHTML = html;
    bindChart(el, weekly, sd.metric);

    el.onclick = function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b || !b.dataset.act) return;
      var a = b.dataset.act, v = b.dataset.v;
      if (a === 'sel') { sd.sel = v; sd.cmp = 'auto'; }
      else if (a === 'cmp') sd.cmp = v;
      else if (a === 'dept') sd.dept = v;
      else if (a === 'group') sd.group = v;
      else if (a === 'span') sd.span = v;
      else if (a === 'metric') { sd.metric = v; if (v === 'qty' && sd.group === 'all') sd.group = 'all3'; else if (v === 'amt' && sd.group === 'all3') sd.group = 'all'; }
      else return;
      renderSalesDash(el);
    };
  }

  X.salesTools = { classifyOrders: classifyOrders, salesCtx: salesCtx, inPeriod: inPeriod };
  X.registerPage({
    id: 'xSalesDash', group: 'season', order: 30, hidden: true, title: '業績儀表板', sub: '今年和去年同檔期的訂單數量與金額比較', stage: 'ready',
    icon: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5a9 9 0 0 1 5.5 5.5H15z"/>',
    render: function (el) { renderSalesDash(el); },
    _fn: { classifyOrders: classifyOrders, salesCtx: salesCtx, sumPeriod: sumPeriod, yearsOf: yearsOf, state: sd }
  });
})(window.CMSX);

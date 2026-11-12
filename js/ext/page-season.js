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
    if (X.get('seasonForecasts')[id]) delete X.ensure('seasonForecasts')[id];
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

    var SM = ' style="min-height:30px;padding:2px 9px;font-size:14.5px"'; // 小按鈕，列表不要太大
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
        if (s.status === 'active' && SI) SI.snapshotForecast(s); // 結束進行中的檔期：把目前的業績預估存給這個檔期
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
  var sd = { kind: '', year: '', dept: 'all', metric: 'amt', group: 'all', sel: '', cmp: 'auto', span: 'season', cum: 'cum', unit: 'box', sgroup: 'all' };
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

  // 訂單上記的實際金額（欄位 amount；也認「金額」「小計」「subtotal」「total」）：有數字就回傳數字，沒有（空白、不是數字）回 null
  function actualAmount(r) {
    var v = r.amount != null && r.amount !== '' ? r.amount : (r['金額'] != null && r['金額'] !== '' ? r['金額'] : (r.subtotal != null && r.subtotal !== '' ? r.subtotal : r.total));
    if (v == null || v === '') return null;
    var n = Number(String(v).replace(/[,，\s]/g, ''));
    return isFinite(n) ? n : null;
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
        kind: kind, sy: sy, y: y, date: date.slice(0, 10), p: p, q: X.num(r.qty), price: price, amt: actualAmount(r), dk: dk, raw: raw,
        code: p ? (p.code || '') : String(r.productCode || '').trim(), name: p ? (p.name || '') : String(r.name || '').trim(),
        no: String(r.orderNo || r.sourceOrderNo || '').trim() || ('#' + i)
      });
    }
    return { list: list, ignored: ignored };
  }

  // 檔期範圍：有節日日期的檔期（檔期設定）＝節日前 N 天（含節日當天，預設 60 天＝約 2 個月，「計算規則」可改）的訂單日期；
  // 沒有節日日期的檔期還是依月份規則（過年 1～2 月、中秋 8～10 月）。全年不變。
  var SW_CACHE = null;
  function seasonWindowDays() { var v = window.CMSRules ? Number(CMSRules.get('seasonWindowDays')) : 60; return v > 0 ? v : 60; }
  function seasonWeeks() { return Math.max(1, Math.ceil(seasonWindowDays() / 7)); }
  function seasonWindow(kind, year) {
    SW_CACHE = SW_CACHE || Object.create(null);
    var k = kind + '|' + year;
    if (k in SW_CACHE) return SW_CACHE[k];
    var s0 = findSeason(kind, year), h = s0 && DATE_RE.test(s0.holidayDate || '') ? dateMs(s0.holidayDate) : null;
    return (SW_CACHE[k] = h == null ? null : [h - (seasonWindowDays() - 1) * DAY, h]);
  }
  function inPeriod(o, kind, year) {
    if (kind === 'year') return o.y === year;
    var w = seasonWindow(kind, year);
    if (w) { var t = dateMs(o.date); return t != null && t >= w[0] && t <= w[1]; }
    return o.kind === kind && o.sy === year;
  }
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
  var C_ACT = '#2f5bd3', C_EST = '#c2691a', C_PREV = '#2a9d8f', C_BUY = '#7b4bb3', C_BAD = '#c0392b', C_ORD = '#1b8a5a'; // 已用調色盤驗證工具檢查過：色盲分得開、對比足夠
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
    // 5 入、8 入費雪：名稱有「費」，或是綜合款（名稱有「+」，例如「鳳+新口味8入」、「鳳+草+乳酪+巧8入」，名稱沒寫「費」也算）；蛋捲、咖啡不算
    if (!/蛋捲|咖啡/.test(name) && (/費/.test(name) || /\+/.test(name))) { if (n === 5) return 'box5'; if (n === 8) return 'box8'; }
    return '';
  }
  function inGroup(p, group) { var g = giftGroup(p); return !!g && (group === 'all3' || group === g); }

  // ---- 單條（條）檢視：禮盒依「禮盒資料」的單條內容物換算成單條（1 盒 CO-43＝5 條鳳費），單賣的單條直接算 ----
  // 沒有單條內容物、但名稱和某個單條一樣的禮盒，當成 1 盒＝1 條（「計算規則」可關閉，同「換算成單條」頁）
  var CONV = null;
  function convMap() {
    var byId = {}, byName = {}, comps = {}, nm = function (v) { return String(v == null ? '' : v).trim().replace(/\s+/g, '').toUpperCase(); };
    X.products().forEach(function (p) { if (!p) return; byId[String(p.id)] = p; if (isSingle(p)) { var n = nm(p.name); if (n && !byName[n]) byName[n] = p; } });
    X.components().forEach(function (c) {
      var sg = c && byId[String(c.componentProductId)];
      if (sg) (comps[String(c.productId)] = comps[String(c.productId)] || []).push({ single: sg, qty: X.num(c.qty) });
    });
    var sameOk = !window.CMSRules || CMSRules.get('singlesSameName');
    return function (p) {
      if (!p) return null;
      if (isSingle(p)) return [{ single: p, qty: 1 }];
      var l = comps[String(p.id)];
      if (l && l.length) return l;
      var sg = sameOk ? byName[nm(p.name)] : null;
      return sg ? [{ single: sg, qty: 1 }] : null;
    };
  }
  function conv() { return CONV || (CONV = convMap()); }
  function singleMatch(group, sg) { return group === 'all' || String(sg.id) === String(group); }
  // 這個檔期「採購叫貨」記的叫貨量（已叫貨＋已到貨；進行中檔期也算沒記檔期的舊紀錄）：{ 品項 id: 數量 }；禮盒是盒，舊的單條紀錄是條
  function orderedByProduct(selC) {
    var sid = selC.season && selC.season.id, act = !!(selC.season && selC.season.status === 'active'), out = Object.create(null);
    X.get('purchaseOrders').forEach(function (o) {
      if (!o || !(X.num(o.qty) > 0)) return;
      if (o.seasonId ? o.seasonId !== sid : !act) return;
      var id = String(o.productId || o.singleId), p = X.productById(id), q = X.num(o.qty);
      // 新紀錄（unit＝條）禮盒的數量是條：換回盒（÷ 每盒條數），這裡的禮盒一律以盒計；單條與舊的禮盒紀錄（盒）不變
      if (p && !isSingle(p) && o.unit === '條') { var ps0 = conv()(p), per0 = ps0 ? ps0.reduce(function (t, pt) { return t + pt.qty; }, 0) : 0; if (per0 > 0) q = q / per0; }
      out[id] = (out[id] || 0) + q;
    });
    return out;
  }
  // 圖上「已叫貨」線的總量：盒＝叫貨的禮盒盒數（依規格篩選）；條＝叫貨的禮盒依單條內容物換算（再加舊的單條紀錄）
  function orderedTotal(selC, metric, group) {
    var ordP = orderedByProduct(selC), t = 0;
    Object.keys(ordP).forEach(function (pid) {
      var p = X.productById(pid);
      if (!p) return;
      if (metric === 'single') {
        var ps = conv()(p);
        if (ps) ps.forEach(function (pt) { if (singleMatch(group, pt.single)) t += ordP[pid] * pt.qty; });
      } else if (!isSingle(p) && inGroup(p, group === 'all' ? 'all3' : group)) t += ordP[pid];
    });
    return t;
  }
  function unitLabel(metric) { return metric === 'amt' ? '金額' : (metric === 'single' ? '單條數' : '禮盒數'); }
  function singleGroupName(group) { if (group === 'all') return '全部單條'; var p = X.productById(group); return p ? ((p.code ? p.code + ' ' : '') + p.name) : '單條'; }

  // 訂單依週彙總：回傳 { 週的代號: 數值 }；keyFn(日期毫秒) 決定這筆訂單放在哪一週
  function weeklyOrders(list, kind, year, dept, metric, group, keyFn) {
    var out = Object.create(null), nonRev = nonRevenue();
    list.forEach(function (o) {
      if (!inPeriod(o, kind, year) || o.dk === 'none') return;
      if (dept !== 'all' && o.dk !== dept) return;
      var t = dateMs(o.date);
      if (t == null) return;
      var v;
      if (metric === 'single') {
        var ps = conv()(o.p); v = 0;
        if (ps) ps.forEach(function (pt) { if (singleMatch(group, pt.single)) v += o.q * pt.qty; });
      } else if (metric === 'amt') v = (group !== 'all' && !inGroup(o.p, group)) ? 0 : (nonRev[o.dk] ? 0 : o.q * o.price);
      else v = inGroup(o.p, group === 'all' ? 'all3' : group) ? o.q : 0;
      var w = keyFn(t);
      out[w] = (out[w] || 0) + v;
    });
    return out;
  }
  // ---- 業績預估（從今年開始，每個檔期各存一份）----
  // 預估仍在「業績預估」頁照品項填（每個禮盒 5 個日期（週）× 各部門的預估盒數）；這裡把整份加總成 5 入／8 入／蛋捲 10 入。
  // 進行中檔期的預估＝業績預估頁正在編輯的那份（db.salesForecastV5）；檔期結束、或換成別的進行中檔期時，
  // 目前的預估會存進 db.seasonForecasts[檔期id]（見 season-items.js），之後選到那個檔期就用存下來的那份。過去的預估沒存，所以沒有。
  // 進貨量＝業績預估盒數 × 這個比例（預設 70%，「計算規則」可改）；實際販售超過進貨量就要追量進貨
  // 費雪（預設 70%）和蛋捲（預設 100%，預估多少就下單多少）的進貨比例不同，都可以在「計算規則」改
  function purchaseRatio() { var v = window.CMSRules ? Number(CMSRules.get('purchaseRatio')) : 70; return (v > 0 ? v : 70) / 100; }
  function purchaseRatioEgg() { var v = window.CMSRules ? Number(CMSRules.get('purchaseRatioEgg')) : 100; return (v > 0 ? v : 100) / 100; }
  function isEggGift(p) { return !!p && /蛋捲/.test(String(p.name || '')); } // 名稱有「蛋捲」的禮盒、單條
  function giftRatio(p) { return isEggGift(p) ? purchaseRatioEgg() : purchaseRatio(); }
  function ratioText() { var a = Math.round(purchaseRatio() * 100), b = Math.round(purchaseRatioEgg() * 100); return a === b ? a + '%' : '費雪 ' + a + '%、蛋捲 ' + b + '%'; }
  function buyOf(p, est) { return Math.ceil(est * giftRatio(p) - 1e-9); } // 這個禮盒要進（叫）幾盒
  function forecastOf(ch) {
    if (!ch || !ch.season) return null;
    var f = ch.season.status === 'active' ? (X.db() && X.db().salesForecastV5) : ((X.get('seasonForecasts')[ch.season.id] || {}).forecast);
    return f && f.rows && typeof f.rows === 'object' ? f : null;
  }
  // 預估資料的各品項列（業績預估頁：禮盒與單條，各品項 5 個日期（週）× 各部門的預估量）
  function forecastRows(fo) { return (fo && fo.rows) || {}; }
  function forecastHasData(fo) { return forecastTotal({ byCode: Object.create(null), byId: Object.create(null) }, fo, 'all', 'qty', 'all').any; }
  // 預估總量（整個檔期）：每個禮盒所有日期、所選部門的預估盒數加總；金額＝盒數 × 售價 × 折扣成數（禮盒資料依部門分門市／官網／執行長／通路；沒填＝原價）
  function forecastTotal(ctx, fo, dept, metric, group, keyFn) {
    var rows = forecastRows(fo), nonRev = nonRevenue(), any = false, total = 0, buy = 0, byWeek = Object.create(null), undated = 0;
    if (dept === 'unmatched') return { total: 0, any: false };
    Object.keys(rows).forEach(function (code) {
      var r = rows[code];
      if (!r || !r.lines) return;
      var p = ctx.byCode[normCode(code)] || ctx.byId[String(code)] || null;
      var mult = 1;
      if (metric === 'single') {
        var ps = p && conv()(p); mult = 0;
        if (ps) ps.forEach(function (pt) { if (singleMatch(group, pt.single)) mult += pt.qty; });
        if (!(mult > 0)) return;
      } else if (ctx.byId && Object.keys(ctx.byId).length) {
        if (metric === 'qty' ? !inGroup(p, group === 'all' ? 'all3' : group) : (group !== 'all' && !inGroup(p, group))) return;
      }
      var price = 0;
      if (metric === 'amt') price = p ? X.num(typeof sfUnitPrice === 'function' ? sfUnitPrice(p) : X.productPrice(p)) : X.num(r.price);
      var rowSum = 0;
      Object.keys(r.lines).forEach(function (n) {
        var line = r.lines[n];
        if (!line) return;
        Object.keys(line).forEach(function (dk0) {
          var dk = dk0 === 'grandduchy' ? 'channel' : dk0; // 大公國已併入通路（舊的預估存檔還有大公國的數字）
          if (dept !== 'all' && dk !== dept) return;
          var est = X.num((line[dk0] || {}).est);
          if (est > 0) any = true;
          rowSum += est;
          var vv = metric === 'amt' ? (nonRev[dk] ? 0 : est * price * (p && typeof sfDiscountFactor === 'function' ? sfDiscountFactor(p, dk) : 1)) : est * mult;
          total += vv;
          if (keyFn) { // 有填日期的預估量放進那個日期所在的週；沒填日期的另外算（照週別比例分）
            var dtm = r.dates && r.dates[n] ? dateMs(r.dates[n]) : null;
            if (dtm != null) { var wk = keyFn(dtm); byWeek[wk] = (byWeek[wk] || 0) + vv; } else undated += vv;
          }
        });
      });
      if (metric !== 'amt' && p) buy += buyOf(p, rowSum) * mult;
    });
    return { total: total, any: any, buy: buy, byWeek: byWeek, undated: undated };
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
  function valText(v, metric) { return v == null ? '—' : (metric === 'amt' ? money(v) : X.fmt(v) + (metric === 'single' ? ' 條' : ' 盒')); }

  // 整理成每週一筆：weeks 是週的代號（依檔期對齊時是「節日週＝0」的週數，否則是星期一的毫秒）；沒有資料的線整條是 null
  function buildWeekly(list, ctx, selC, cmpC, dept, metric, group, span, cum) {
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
    // 預估量：整個檔期的預估總量，照週別比例分到檔期的每一週（預設 60 天＝節前 8 週～節日週）
    // 比例＝這個檔期自己設定的（forecastWeights），沒設定就照比較檔期同樣那幾週的實際進單比例，比較檔期沒資料就平均分
    var NW = seasonWeeks(), KS = [];
    for (var q0 = -(NW - 1); q0 <= 0; q0++) KS.push(q0);
    var fo = forecastOf(selC);
    var ft = fo ? forecastTotal(ctx, fo, dept, metric, group, keySel) : { total: 0, any: false };
    var wts = null, wtsCustom = false;
    if (byHoliday) {
      var cw0 = selC.season && selC.season.forecastWeights, cw = null;
      if (Array.isArray(cw0)) { // 舊的存檔只有 4 週（節前 3 週～節日週）：放在最後四週，前面的週比例 0
        if (cw0.length === NW) cw = cw0;
        else if (cw0.length === 4) cw = NW >= 4 ? new Array(NW - 4).fill(0).concat(cw0) : cw0.slice(4 - NW);
      }
      if (cw && cw.some(function (x) { return Number(x) > 0; })) {
        var cs = cw.reduce(function (t0, x) { return t0 + (Number(x) || 0); }, 0);
        wts = cw.map(function (x) { return (Number(x) || 0) / cs; }); wtsCustom = true;
      } else {
        var shape = cmpC ? weeklyOrders(list, prevKind, prevYear, 'all', 'qty', 'all3', keyPrev) : {};
        var sv = KS.map(function (k) { return shape[k] || 0; }), st = sv.reduce(function (t0, x) { return t0 + x; }, 0);
        wts = st > 0 ? sv.map(function (x) { return x / st; }) : KS.map(function () { return 1 / NW; });
      }
    }
    var f = { map: Object.create(null), any: false };
    // 預估量放進每一週：有填日期的（業績預估每個品項 5 個日期）放進那個日期所在的週；沒填日期的照週別比例分到檔期的每一週
    if (ft.any) {
      var dated = ft.byWeek || {};
      Object.keys(dated).forEach(function (k) { f.map[k] = (f.map[k] || 0) + dated[k]; f.any = true; });
      if (ft.undated > 0 && wts) { KS.forEach(function (k, i) { f.map[k] = (f.map[k] || 0) + ft.undated * wts[i]; }); f.any = true; }
    }
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
    // 週期：檔期（依檔期對齊時＝節前 N 週～節日週，60 天是節前 8 週～節日週；否則是資料的最後 N 週），或全部週
    var spanNote = '';
    if (span !== 'all') {
      var w4 = byHoliday ? weeks.filter(function (k) { return k >= KS[0] && k <= 0; }) : weeks.slice(-NW);
      var inW = function (m, kk) { return kk.some(function (k) { return w4.indexOf(k) >= 0; }); };
      if (w4.length && (inW(a, ka) || inW(b, kb) || inW(f.map, kf))) weeks = w4;
      else spanNote = '這段檔期期間沒有資料，已顯示全部的週';
    }
    var pick = function (fn) { return weeks.map(fn); };
    var actArr = pick(function (k) { return ka.length && startSel(k) <= nowWk ? (a[k] || 0) : null; });
    var estArr = pick(function (k) { return fLo != null && k >= fLo && k <= fHi ? (f.map[k] || 0) : null; });
    var prevArr = pick(function (k) { return bLo != null && k >= bLo && k <= bHi ? (b[k] || 0) : null; });
    var any = function (arr) { return arr.some(function (v) { return v != null; }); };
    var sumOf = function (arr) { return arr.reduce(function (t0, v) { return t0 + (v || 0); }, 0); };
    var actSum = sumOf(actArr), estSum = sumOf(estArr), prevSum = sumOf(prevArr);
    var runTotal = function (arr) { var run = 0; return arr.map(function (v) { if (v == null) return null; run += v; return run; }); };
    if (cum) { actArr = runTotal(actArr); estArr = runTotal(estArr); prevArr = runTotal(prevArr); }
    // 進貨量線：預估總量 × 進貨比例（只在「禮盒數」的「累計」圖畫，是一條水平線）；實際累計第一次碰到它的那一週標紅色
    // 「單條數」檢視還有一條「已叫貨」線：採購叫貨記的叫貨條數；有叫貨紀錄時，販售超過已叫貨條數就要追量
    var isQty = metric === 'qty' || metric === 'single';
    var ratioTxt = ratioText(), buyTotal = (isQty && ft.any) ? ft.buy : 0;
    var ordTotal = isQty ? orderedTotal(selC, metric, group) : 0;
    var thr = ordTotal > 0 ? ordTotal : buyTotal;
    var buyArr = (cum && thr > 0) ? pick(function () { return thr; }) : pick(function () { return null; });
    var crossIdx = -1;
    if (any(buyArr)) for (var ci = 0; ci < actArr.length; ci++) if (actArr[ci] != null && actArr[ci] >= thr) { crossIdx = ci; break; }
    return {
      buy: buyArr, hasBuy: any(buyArr), buyTotal: buyTotal, ratioText: ratioTxt, crossIdx: crossIdx, buyNeedCum: isQty && thr > 0 && !cum,
      ord: [], hasOrd: false, ordTotal: ordTotal, thrTotal: thr, thrIsOrd: ordTotal > 0, unit: metric === 'single' ? '條' : '盒',
      cum: !!cum, actSum: actSum, estSum: estSum, prevSum: prevSum, estTotal: ft.total, weights: wts, weightsCustom: wtsCustom, estNoHoliday: ft.any && !byHoliday && !f.any,

      weeks: weeks, year: year, lastYear: prevYear, byHoliday: byHoliday, selName: selC.name, cmpName: cmpC ? cmpC.name : '', prevLabel: cmpIsLast ? '去年' : '比較檔期',
      spanSeason: span !== 'all' && !spanNote, spanNote: spanNote,
      selIsActive: !!(selC.season && selC.season.status === 'active'), activeId: (X.activeSeason() || {}).id || '', activeName: (X.activeSeason() || {}).name || '',
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
      { key: 'prev', name: m.prevLabel === '去年' ? '去年' : '比較', color: C_PREV, dash: '' },
      { key: 'buy', name: m.thrIsOrd ? '已叫貨' : '進貨量', color: m.thrIsOrd ? C_ORD : C_BUY, dash: m.thrIsOrd ? '9 4' : '2 5', noDots: true }
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
        '<text x="' + (L - 8) + '" y="' + (gy + 4) + '" text-anchor="end" font-size="13" fill="var(--text-3)">' + esc(axisFmt(gv, metric)) + '</text>';
    }
    var step = Math.max(1, Math.ceil(n / (m.byHoliday ? 8 : 10))), xl = '';
    m.weeks.forEach(function (t, i) {
      if (i % step === 0) xl += '<text x="' + x(i) + '" y="' + (H - B + 18) + '" text-anchor="middle" font-size="13" fill="' + (m.byHoliday && t === 0 ? 'var(--text)' : 'var(--text-3)') + '"' + (m.byHoliday && t === 0 ? ' font-weight="700"' : '') + '>' + esc(m.label(t)) + '</text>';
    });
    xl += '<text x="' + L + '" y="' + (H - 6) + '" font-size="12" fill="var(--text-3)">' + (m.byHoliday ? '橫軸：離節日幾週（節日週＝節日當天所在的那一週，週一～週日）' : '橫軸：每週一～週日，標的是星期一的日期') + '</text>';
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
      if (!s.noDots) m[s.key].forEach(function (v, i) {
        if (v == null) return;
        lines += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="3.5" fill="' + s.color + '" stroke="var(--surface)" stroke-width="2"/>';
      });
      if (last >= 0) ends.push({ name: s.name, x: x(last) + 9, y: y(m[s.key][last]) + 4 });
    });
    // 實際累計超過進貨量的那一週：紅色圈起來，標「要追量」
    if (m.crossIdx >= 0 && m.act[m.crossIdx] != null) {
      var cx = x(m.crossIdx), cy = y(m.act[m.crossIdx]);
      lines += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="9" fill="none" stroke="' + C_BAD + '" stroke-width="3"/>' +
        '<text x="' + (cx - 13).toFixed(1) + '" y="' + Math.max(T + 12, cy - 12).toFixed(1) + '" text-anchor="end" font-size="14" font-weight="800" fill="' + C_BAD + '">要追量</text>';
    }
    // 線尾的名稱：幾條線結束在同一個位置時，上下錯開，不要疊在一起
    ends.sort(function (p, q) { return p.y - q.y; });
    ends.forEach(function (e, i) {
      for (var j = 0; j < i; j++) if (Math.abs(ends[j].x - e.x) < 60 && e.y - ends[j].y < 15) e.y = ends[j].y + 15;
      labels += '<text x="' + e.x + '" y="' + e.y + '" font-size="14" font-weight="700" fill="var(--text)">' + e.name + '</text>';
    });
    return { svg: '<svg data-chart viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="每週實際、預估、進貨量與去年的' + unitLabel(metric) + '波動圖，下方有表格版" style="display:block;width:100%;height:auto;max-width:100%;stroke:none;touch-action:pan-y">' +
      g + xl + holi + '<line data-guide x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--text-3)" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>' + lines + labels + '</svg>',
      geom: { W: W, L: L, R: R, n: n, iw: iw }, series: series };
  }

  function renderChartCard(m, metric, deptName, group, actions) {
    var gName = metric === 'single' ? singleGroupName(group) : groupName(metric === 'qty' && group === 'all' ? 'all3' : group);
    if (!m) return X.ui.card('每週波動', X.ui.empty('這個檔期、這個部門沒有訂單，也沒有預估資料可以畫。'));
    var c = chartSvg(m, metric);
    var leg = c.series.map(function (s) {
      var t = s.key === 'prev' ? m.prevLabel + (m.cmpName ? '（' + m.cmpName + (m.byHoliday ? '，對齊節日週' : '，同一週對齊') + '）' : '')
        : s.key === 'act' ? '今年實際進單（' + (m.selName || m.year) + '）' : s.key === 'buy' ? (m.thrIsOrd ? '已叫貨（採購叫貨紀錄，共 ' + X.fmt(m.ordTotal) + ' ' + m.unit + '）' : '進貨量（預估 × ' + m.ratioText + ' ＝ ' + X.fmt(m.buyTotal) + ' ' + m.unit + '）') : '預估量（' + (m.selName || m.year) + '）';
      return '<span style="display:inline-flex;align-items:center;gap:6px;margin-right:14px"><svg width="26" height="10" aria-hidden="true" style="width:26px;height:10px"><line x1="0" x2="26" y1="5" y2="5" stroke="' + s.color + '" stroke-width="2.5"' + (s.dash ? ' stroke-dasharray="' + s.dash + '"' : '') + '/></svg>' + esc(t) + '</span>';
    }).join('');
    var miss = [];
    if (!m.hasAct) miss.push('這個檔期還沒有訂單，沒有「實際」線');
    if (m.estNoHoliday) miss.push('這個檔期還沒有節日日期，預估量分不到每一週，請到「檔期設定」填節日日期');
    else if (!m.hasEst) {
      if (!m.selIsActive) miss.push('「' + m.selName + '」不是進行中的檔期，沒有存到預估量（預估從今年開始存，只有進行中的檔期，或結束時存過預估的檔期才有預估線）');
      else miss.push('業績預估頁還沒有預估量：所選條件（' + gName + '、' + deptName + '）裡填的預估盒數都是 0，所以沒有「預估」線' + (m.estTotal === 0 ? '' : ''));
    }
    if (!m.hasPrev) miss.push('比較檔期沒有訂單' + (group !== 'all' ? '（或沒有 ' + gName + '）' : '') + '，沒有比較線');
    if (m.spanNote) miss.push(m.spanNote);
    if (!m.byHoliday && m.cmpName) miss.push('這個檔期或比較檔期還沒有節日日期，所以先用「同一週」對齊');
    var tbl = X.ui.table([
      { label: m.byHoliday ? '週（離節日）' : '週（星期一）', render: function (r) { return esc(m.label(r.t)); } },
      { label: '今年日期', render: function (r) { return '<span class="small">' + esc(m.rangeSel(r.t)) + '</span>'; } },
      { label: '實際', num: true, render: function (r) { return r.act == null ? DASH : esc(valText(r.act, metric)); } },
      { label: '預估量', num: true, render: function (r) { return r.est == null ? DASH : esc(valText(r.est, metric)); } },
      { label: m.prevLabel + '日期', render: function (r) { return r.prev == null ? DASH : '<span class="small">' + esc(m.rangePrev(r.t)) + '</span>'; } },
      { label: m.prevLabel + '同週', num: true, render: function (r) { return r.prev == null ? DASH : esc(valText(r.prev, metric)); } },
      { label: '實際比' + m.prevLabel, num: true, render: function (r) { return r.act == null || r.prev == null ? DASH : growth(r.act, r.prev); } }
    ], m.weeks.map(function (t, i) { return { t: t, act: m.act[i], est: m.est[i], prev: m.prev[i] }; }), { empty: '沒有資料' });
    var hint = '';
    if (!m.hasEst && !m.estNoHoliday) {
      hint = !m.selIsActive && m.activeId
        ? '<button type="button" class="btn primary" data-act="sel" data-v="' + esc(m.activeId) + '" style="min-height:30px;padding:3px 11px;font-size:15px;margin-top:6px">改看進行中的檔期（' + esc(m.activeName) + '）</button>'
        : '<button type="button" class="btn gray" data-go="xSalesForecast" style="min-height:30px;padding:3px 11px;font-size:15px;margin-top:6px">到「業績預估」頁填預估量</button>';
    }
    var rate = m.hasEst && m.estSum > 0 ? '　達成率 <b>' + (Math.round(m.actSum / m.estSum * 1000) / 10) + '%</b>' : '';
    var vsPrev = m.hasPrev && m.prevSum > 0 ? '　比' + esc(m.prevLabel) + ' <b>' + (m.actSum >= m.prevSum ? '+' : '') + (Math.round((m.actSum - m.prevSum) / m.prevSum * 1000) / 10) + '%</b>' : '';
    var sumLine = '<div class="small" style="margin-top:6px"><b>合計（圖上顯示的週）</b>　實際 ' + esc(valText(m.actSum, metric)) +
      (m.hasEst ? '　預估 ' + esc(valText(m.estSum, metric)) : '') + (m.hasPrev ? '　' + esc(m.prevLabel) + ' ' + esc(valText(m.prevSum, metric)) : '') + rate + vsPrev + '</div>';
    var buyLine = '';
    if (m.hasBuy) {
      var what = m.thrIsOrd ? (m.unit === '條' ? '已叫貨條數' : '已叫貨盒數') : '進貨量', how = m.thrIsOrd ? '（採購叫貨紀錄）' : '（預估的 ' + m.ratioText + '）';
      buyLine = '<p class="small" style="margin:8px 0 0' + (m.crossIdx >= 0 ? ';color:var(--bad);font-weight:700' : '') + '">' + (m.crossIdx >= 0
        ? esc('要追量進貨：實際累計 ' + X.fmt(m.actSum) + ' ' + m.unit + '，已超過' + what + ' ' + X.fmt(m.thrTotal) + ' ' + m.unit + how + '，圖上紅圈是第一次超過的那一週（' + m.label(m.weeks[m.crossIdx]) + '）。')
        : esc('實際累計 ' + X.fmt(m.actSum) + ' ' + m.unit + '，還在' + what + ' ' + X.fmt(m.thrTotal) + ' ' + m.unit + how + '以內，還可以賣 ' + X.fmt(m.thrTotal - m.actSum) + ' ' + m.unit + '。')) + '</p>';
    } else if (m.buyNeedCum) buyLine = '<p class="small" style="margin:6px 0 0">進貨量線只在「累計」顯示，請按上方「顯示」的「累計」。</p>';
    var wEdit = '';
    if (m.byHoliday && m.weights) {
      var wl = m.weights.map(function (x, i) { var n = m.weights.length - 1 - i; return n === 0 ? '節日週' : '節前 ' + n + ' 週'; });
      wEdit = '<div style="margin-top:12px"><b>預估的週別比例</b> <span class="small">（' + (m.weightsCustom ? '你設定的' : '預設：照比較檔期同樣那幾週的實際進單比例；比較檔期沒資料就平均') + '）</span><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px">' +
        wl.map(function (t, i) { return '<label class="small">' + t + ' <input data-w="' + i + '" type="number" min="0" step="0.1" value="' + (Math.round(m.weights[i] * 1000) / 10) + '" style="width:70px;padding:5px;border:1px solid var(--line-strong);border-radius:8px;font:inherit"> %</label>'; }).join('') +
        '<button type="button" class="btn primary" data-act="wsave" style="min-height:30px;padding:3px 11px;font-size:15px">儲存比例</button>' +
        (m.weightsCustom ? '<button type="button" class="btn gray" data-act="wreset" style="min-height:30px;padding:3px 11px;font-size:15px">改回照比較檔期</button>' : '') +
        '</div><div class="small" style="margin-top:4px">這些比例加起來不用剛好是 100，系統會自動換算；預估總量乘上比例，就是每週的預估量。</div></div>';
    }
    return X.ui.card(deptName + '｜' + (m.cum ? '累計' : '每週') + unitLabel(metric) + '（' + gName + '）',
      '<div style="margin-bottom:6px;font-size:15px">' + leg + '</div>' +
      '<div data-chartbox style="position:relative;max-width:720px">' + c.svg + '<div data-tip role="status" style="display:none;position:absolute;pointer-events:none;background:var(--surface);border:1px solid var(--line-strong);border-radius:8px;box-shadow:var(--shadow);padding:8px 10px;font-size:14.5px;line-height:1.7;white-space:nowrap;z-index:2"></div></div>' +
      sumLine + buyLine +
      (miss.length ? '<p class="small" style="margin:6px 0 0;color:var(--warn)">' + esc(miss.join('；')) + '。</p>' : '') + hint +
      '<details style="margin-top:8px"><summary style="cursor:pointer;font-weight:700">看表格版、預估比例與說明</summary><div style="margin-top:8px">' + tbl + wEdit +
      '<p class="small" style="margin:10px 0 0">' +
        (m.byHoliday ? '依檔期對齊：以各檔期節日（「檔期設定」的節日日期）所在的那一週為「節日週」，兩個檔期都從這一週往前、往後數，節日日期不同也能同週比較。' : '') +
        '今年實際進單＝所選檔期的訂單，依訂單日期放進所在的那一週；比較檔期＝比較檔期的實際進單；預估量＝「業績預估」頁照品項填的預估盒數（所有日期加總，再依 5 入／8 入／蛋捲 10 入、部門篩選），依上面的週別比例分到節前 3 週～節日週。累計＝從第一週起逐週加總。' +
        '金額＝數量 × 目前售價，公關贈、執行長的金額不算營收；禮盒規格只算 5 入費雪、8 入費雪、蛋捲 10 入（依品名判斷）；選「全部商品」看金額時含單條與其他規格；「禮盒數」不含單條與品號還沒對照的訂單。還沒到的週不畫實際。</p></div></details>', actions);
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
      tip.innerHTML = '<div style="font-weight:700">' + esc(m.label(wk)) + '</div>' + row('實際', C_ACT, m.act[i], m.rangeSel(wk)) + row('預估', C_EST, m.est[i], m.rangeSel(wk)) + row(m.thrIsOrd ? '已叫貨' : '進貨量', m.thrIsOrd ? C_ORD : C_BUY, m.buy && m.buy[i], '') + row(m.prevLabel + '同週', C_PREV, m.prev[i], m.rangePrev(wk));
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

  // ================= 進貨管理 =================
  // 進貨量＝業績預估盒數 × 進貨比例（預設 70%）。每個禮盒比較「這個檔期已販售的盒數」和進貨量：
  // 已販售 ≥ 進貨量＝要追量進貨（over）；有預估但還沒賣到＝正常（ok）；沒有預估但有賣＝沒有預估（nofc）。
  function purchasePlanFor(list, selC, ctx, group) {
    var res = { ratioText: ratioText(), hasForecast: false, rows: [], reason: '' };
    var fo = forecastOf(selC), est = Object.create(null);
    if (!fo) res.reason = selC.season && selC.season.status !== 'active' ? '「' + selC.name + '」不是進行中的檔期，沒有存到業績預估，只能看已叫貨與已販售。' : '「' + selC.name + '」還沒有業績預估，只能看已叫貨與已販售。';
    else Object.keys(fo.rows || {}).forEach(function (code) {
      var r = fo.rows[code];
      if (!r || !r.lines) return;
      var p = ctx.byCode[normCode(code)] || ctx.byId[String(code)] || null;
      if (!p || isSingle(p)) return;
      var sum = 0;
      Object.keys(r.lines).forEach(function (n) { var line = r.lines[n] || {}; Object.keys(line).forEach(function (k) { sum += X.num((line[k] || {}).est); }); });
      est[String(p.id)] = (est[String(p.id)] || 0) + sum;
    });
    var cur = sumPeriod(list, selC.kind, selC.year, 'all'), sold = Object.create(null), ordP = orderedByProduct(selC), ord = Object.create(null);
    Object.keys(cur.items).forEach(function (k) { var it = cur.items[k]; if (it.p && !isSingle(it.p)) sold[String(it.p.id)] = (sold[String(it.p.id)] || 0) + it.qty; });
    Object.keys(ordP).forEach(function (id) { var p = ctx.byId[id]; if (p && !isSingle(p)) ord[id] = ordP[id]; });
    var ids = Object.create(null);
    Object.keys(est).concat(Object.keys(sold), Object.keys(ord)).forEach(function (id) { ids[id] = true; });
    Object.keys(ids).forEach(function (id) {
      var p = ctx.byId[id];
      if (!p) return;
      if (group && group !== 'all' && group !== 'all3' && !inGroup(p, group)) return;
      var e = est[id] || 0, s0 = sold[id] || 0, o = ord[id] || 0;
      if (!(e > 0) && !(s0 > 0) && !(o > 0)) return;
      var buy = e > 0 ? buyOf(p, e) : 0, base = o > 0 ? o : buy;
      if (e > 0) res.hasForecast = true;
      res.rows.push({ id: id, label: (p.code ? p.code + ' ' : '') + (p.name || ''), line: isEggGift(p) ? '蛋捲' : '費雪', est: e, buy: buy, ordered: o, sold: s0, base: base, baseIsOrd: o > 0,
        pct: e > 0 ? s0 / e : null, left: base - s0, status: base > 0 ? (s0 >= base ? 'over' : 'ok') : 'nofc' });
    });
    var rank = { over: 0, ok: 1, nofc: 2 };
    res.rows.sort(function (a, b) { return (rank[a.status] - rank[b.status]) || ((b.base > 0 ? b.sold / b.base : 0) - (a.base > 0 ? a.sold / a.base : 0)) || (b.sold - a.sold); });
    return res;
  }
  // 開檔檢查／首頁提醒用：進行中檔期的進貨管理
  X.purchasePlan = function () {
    SW_CACHE = null; CONV = null;
    var ctx = salesCtx(), c = classifyOrders(typeof X.salesOrders === 'function' ? X.salesOrders() : X.orders(), ctx);
    var act = seasonChoices(c.list).find(function (ch) { return ch.season && ch.season.status === 'active'; });
    if (!act) return { ratioText: ratioText(), hasForecast: false, rows: [], reason: '目前沒有進行中的檔期，無法算進貨量。' };
    return purchasePlanFor(c.list, act, ctx, 'all');
  };
  // 給「採購叫貨」頁用：費雪、蛋捲的進貨比例規則與規格
  X.giftRatio = giftRatio; X.giftRatioText = ratioText; X.buyBoxes = buyOf; X.isEggGift = isEggGift; X.giftGroupKey = giftGroup;

  function renderPurchaseCard(plan, selC) {
    var go = '<button type="button" class="btn gray" data-go="xCalcRules" style="min-height:30px;padding:3px 11px;font-size:15px">調整進貨比例（目前 ' + plan.ratioText + '）</button>';
    if (!plan.rows.length) return X.ui.card('進貨管理（' + esc(selC.name) + '）', X.ui.empty(plan.reason || '沒有資料。') + '<p class="small" style="margin:8px 0 0">進貨量＝業績預估盒數 × 進貨比例（' + plan.ratioText + '），請先到「業績預估」頁填預估。</p>', go);
    var tag = function (r) { return r.status === 'over' ? X.ui.tag('要追量進貨', 'bad') : (r.status === 'nofc' ? X.ui.tag('沒有進貨基準', 'muted') : X.ui.tag('正常', 'ok')); };
    var tbl = X.ui.table([
      { label: '禮盒', render: function (r) { return esc(r.label) + ' <span class="small">' + r.line + '</span>'; } },
      { label: '業績預估（盒）', num: true, render: function (r) { return r.est > 0 ? X.fmt(r.est) : DASH; } },
      { label: '進貨量（預估×比例，盒）', num: true, render: function (r) { return r.est > 0 ? X.fmt(r.buy) : DASH; } },
      { label: '已叫貨（盒）', num: true, render: function (r) { return r.ordered > 0 ? '<b>' + X.fmt(r.ordered) + '</b>' : DASH; } },
      { label: '已販售（盒）', num: true, render: function (r) { return X.fmt(r.sold); } },
      { label: '還可販售（盒）', num: true, render: function (r) { return r.base > 0 ? (r.left >= 0 ? X.fmt(r.left) : '<b style="color:var(--bad)">超過 ' + X.fmt(-r.left) + '</b>') : DASH; } },
      { label: '判斷基準', render: function (r) { return r.base > 0 ? '<span class="small">' + (r.baseIsOrd ? '已叫貨' : '進貨量') + '</span>' : DASH; } },
      { label: '狀態', render: tag }
    ], plan.rows);
    return X.ui.card('進貨管理（' + esc(selC.name) + '）', '<div>' + tbl + '</div>' +
      '<p class="small" style="margin:10px 0 0">進貨量＝「業績預估」頁各部門、各日期預估盒數加總 × 進貨比例（' + plan.ratioText + '，每個禮盒各自無條件進位）；廠商以禮盒進貨，所以已叫貨是「採購叫貨」頁記的叫貨量（禮盒換回盒）（已叫貨＋已到貨）；已販售＝這個檔期的實際訂單（只算禮盒，不含單條與品號未對照的訂單）。有叫貨紀錄就用已叫貨盒數當基準，沒有就用進貨量；已販售 ≥ 基準就標「要追量進貨」，首頁上方的提醒列也會顯示。</p>', go);
  }

  // 給「採購叫貨」用：進行中檔期的業績預估，每個品項（禮盒、單條）的預估量（所有部門、所有日期加總）
  X.forecastBoxes = function () {
    var fo = X.db() && X.db().salesForecastV5, ctx = salesCtx(), out = { byId: Object.create(null), dates: Object.create(null), ranges: Object.create(null), name: (fo && fo.campaignName) || '', any: false };
    if (!fo || !fo.rows) return out;
    Object.keys(fo.rows).forEach(function (code) {
      var r = fo.rows[code];
      if (!r || !r.lines) return;
      var p = ctx.byCode[normCode(code)] || ctx.byId[String(code)] || null;
      if (!p) return;
      var sum = 0, ds = [], rgs = [];
      Object.keys(r.lines).forEach(function (n) {
        var line = r.lines[n] || {}, ls = 0;
        Object.keys(line).forEach(function (k) { ls += X.num((line[k] || {}).est); });
        sum += ls;
        var d = r.dates && r.dates[n];
        if (ls > 0 && d && ds.indexOf(d) < 0) {
          ds.push(d); // 這個品項有填預估的日期（業績預估頁每一週的區間起）
          var e = (r.ends && r.ends[n]) || '', t = dateMs(d);
          if (!e && t != null) { var t2 = new Date(t + 6 * DAY); e = t2.getUTCFullYear() + '-' + String(t2.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t2.getUTCDate()).padStart(2, '0'); }
          rgs.push({ start: d, end: e, est: ls });
        }
      });
      if (sum > 0) { var id = String(p.id); out.byId[id] = (out.byId[id] || 0) + sum; out.dates[id] = (out.dates[id] || []).concat(ds).sort(); out.ranges[id] = (out.ranges[id] || []).concat(rgs).sort(function (a, b) { return a.start < b.start ? -1 : (a.start > b.start ? 1 : 0); }); out.any = true; }
    });
    return out;
  };

  // 業績預估頁「小計」的「實際」：訂單（過去訂單匯入＋入口網站訂單）裡品號相同、訂單日期落在每一週區間（起 ≤ 日期 ≤ 迄，迄那天也算）的數量合計，整個公司、不分門市
  // 回傳 { 業績預估的品號（列的 key）: [第 1～5 週的數量] }；品號對應沿用「對照設定」，部門對照設成「不計算」的訂單不算
  var FA_CACHE = { key: '', list: null };
  // 先判別日期、再判別品號，才加總：
  //   ① 日期：每個訂單的日期要落在某個品項某一週的區間（起 ≤ 日期 ≤ 迄，迄那天也算）
  //   ② 品號：訂單的品號要對得到這個品項（沿用「對照設定」），對不到的另外列在「沒算進去」
  function faCompute() {
    var fo = X.db() && X.db().salesForecastV5, det = { sums: {}, rows: {}, unmatched: {}, inWindow: 0, total: 0, matched: 0, lo: null, hi: null };
    if (!fo || !fo.rows) return det;
    var key = [X.orders().length, X.get('portalOrders').length, (X.get('hqStock') || {}).salesAt || 0, X.get('codeMap').length, X.get('deptMap').length, X.products().length].join('|');
    if (FA_CACHE.key !== key || !FA_CACHE.list) {
      FA_CACHE.list = classifyOrders(typeof X.salesOrders === 'function' ? X.salesOrders() : X.orders(), salesCtx()).list;
      FA_CACHE.key = key;
    }
    var ctx = salesCtx(), byPid = Object.create(null), lo = Infinity, hi = -Infinity;
    Object.keys(fo.rows).forEach(function (code) {
      var r = fo.rows[code], p = ctx.byCode[normCode(code)] || ctx.byId[String(code)] || null;
      if (!r || !p) return;
      var ranges = [];
      for (var n = 0; n < 8; n++) {
        var st = r.dates && r.dates[n] ? dateMs(r.dates[n]) : null, en = r.ends && r.ends[n] ? dateMs(r.ends[n]) + DAY : (st != null ? st + 7 * DAY : null); // 「迄」含當天，所以內部算到迄的隔天零點
        ranges.push(st != null && en != null ? [st, en] : null);
        if (st != null && en != null) { if (st < lo) lo = st; if (en > hi) hi = en; }
      }
      det.sums[code] = [0, 0, 0, 0, 0, 0, 0, 0];
      det.rows[code] = { p: p, weeks: [[], [], [], [], [], [], [], []] };
      (byPid[String(p.id)] = byPid[String(p.id)] || []).push({ code: code, ranges: ranges });
    });
    det.lo = lo === Infinity ? null : lo; det.hi = hi === -Infinity ? null : hi;
    FA_CACHE.list.forEach(function (o) {
      if (o.dk === 'none') return;
      det.total++;
      var t = dateMs(o.date);
      if (t == null || det.lo == null || t < det.lo || t >= det.hi) return; // ① 日期不在任何區間
      det.inWindow++;
      var tg = o.p ? byPid[String(o.p.id)] : null;
      if (!tg) { // ② 品號對不到業績預估的品項
        var uk = o.p ? 'p:' + o.p.id : 'c:' + (o.code || o.name || '');
        var u = det.unmatched[uk] || (det.unmatched[uk] = { code: o.code || '', name: o.name || '', reason: o.p ? '業績預估沒有這個品項（本期沒上架或沒填）' : '品號沒有對照到禮盒或單條（到「對照設定」對照）', n: 0, qty: 0 });
        u.n++; u.qty += o.q;
        return;
      }
      var hit = false;
      tg.forEach(function (g) {
        for (var n = 0; n < 8; n++) {
          var rg = g.ranges[n];
          if (rg && t >= rg[0] && t < rg[1]) { det.sums[g.code][n] += o.q; det.rows[g.code].weeks[n].push({ date: o.date, no: o.no, qty: o.q, code: o.code }); hit = true; }
        }
      });
      if (hit) det.matched++;
    });
    return det;
  }
  // 業績預估頁小計「實際」用：{ 品號（列的 key）: [第 1～8 週的數量] }
  X.forecastActuals = function () { return faCompute().sums; };
  // 業績預估頁的「實際判別明細」：先判別日期、再判別品號的過程與沒算進去的訂單
  X.forecastActualDetailHtml = function () {
    var d = faCompute(), codes = Object.keys(d.rows);
    if (!codes.length) return '';
    var md2 = function (ms) { var t = new Date(ms); return (t.getUTCMonth() + 1) + '/' + (t.getUTCDate()); };
    var rowsTbl = codes.map(function (c) { var r = d.rows[c], tot = d.sums[c].reduce(function (a, v) { return a + v; }, 0); return { c: c, p: r.p, w: d.sums[c], tot: tot }; })
      .filter(function (r) { return r.tot > 0; });
    var un = Object.keys(d.unmatched).map(function (k) { return d.unmatched[k]; }).sort(function (a, b) { return b.qty - a.qty; });
    var heads = [0, 1, 2, 3, 4, 5, 6, 7].map(function (n) { return '第 ' + (n + 1) + ' 週'; });
    var cols = [{ label: '品號', render: function (r) { return esc(r.p.code || r.c); } }, { label: '品名', render: function (r) { return esc(r.p.name || ''); } }]
      .concat(heads.map(function (h, n) { return { label: h, num: true, render: function (r) { return r.w[n] ? X.fmt(r.w[n]) : '<span class="small">—</span>'; } }; }))
      .concat([{ label: '實際合計', num: true, render: function (r) { return '<b>' + X.fmt(r.tot) + '</b>'; } }]);
    var span = d.lo != null ? md2(d.lo) + '～' + md2(d.hi) : '（還沒有日期區間）';
    var html = '<p class="small" style="margin:8px 0">實際＝<b>先判別日期、再判別品號</b>，兩關都過才加進小計：<br>' +
      '① <b>判別日期</b>：訂單日期要落在品項某一週的區間（起 ≤ 日期 ≤ 迄，迄那天也算）。所有區間涵蓋 ' + esc(span) + '，目前有 <b>' + X.fmt(d.inWindow) + '</b> 筆訂單明細的日期落在這段時間內（共 ' + X.fmt(d.total) + ' 筆，其餘日期不在區間內，不算）。<br>' +
      '② <b>判別品號</b>：區間內的訂單，品號要對得到「業績預估」的品項（品號先看「對照設定」，沒有對照再直接比對品號）。<b>' + X.fmt(d.matched) + '</b> 筆對得到，已加進小計；<b>' + X.fmt(un.reduce(function (a, u) { return a + u.n; }, 0)) + '</b> 筆對不到，列在下面，沒有算進去。整個公司加總，不分門市。</p>' +
      '<p style="margin:10px 0 4px"><b>已加進小計的實際（依品項、週）</b></p>' + X.ui.table(cols, rowsTbl, { empty: '區間內還沒有對得到品號的訂單' }) +
      '<p style="margin:14px 0 4px"><b>日期在區間內、但品號沒對到（沒有算進去）</b></p>' +
      X.ui.table([{ label: '訂單上的品號', render: function (u) { return esc(u.code || '（空白）'); } }, { label: '品名', render: function (u) { return esc(u.name); } }, { label: '筆數', num: true, render: function (u) { return X.fmt(u.n); } }, { label: '數量', num: true, render: function (u) { return X.fmt(u.qty); } }, { label: '原因', render: function (u) { return '<span class="small">' + esc(u.reason) + '</span>'; } }], un.slice(0, 60), { empty: '區間內的訂單品號都對得到' });
    return '<details style="margin:10px 0"><summary style="cursor:pointer;font-weight:700;padding:6px 0">「實際」是怎麼算出來的：先判別日期、再判別品號（看明細）</summary>' + html + '</details>';
  };

  // 去年業績（業績預估頁「去年業績」那一列）：過去訂單紀錄裡，去年同檔期（進行中檔期的去年同種類檔期，範圍同儀表板）的訂單，
  // 依「接單部門」（對照設定，大公國併入通路）歸到業績預估的 7 個部門，逐部門加總：
  //   金額＝訂單上記的實際金額（amount）；這筆訂單沒有金額時，才退回「數量 × 目前售價 × 該部門折扣成數」（要有對得到品號的品項）
  //   有實際金額的訂單，品號對不到品項也照算（金額不需要品項）
  // → { found, amounts: { 部門: 金額 }, qty: { 部門: 數量 }, label, ordersN, actualN（用實際金額的筆數）, estN（退回用售價估的筆數）, unmatchedN, unmatchedQty }
  X.lastYearByDept = function () {
    SW_CACHE = null;
    var act = X.activeSeason(), depts = ['dongqiao', 'a11', 'jingzhan', 'web', 'channel', 'pr', 'ceo'];
    var res = { found: false, amounts: {}, qty: {}, label: '', ordersN: 0, actualN: 0, estN: 0, unmatchedN: 0, unmatchedQty: 0, reason: '' };
    depts.forEach(function (k) { res.amounts[k] = 0; res.qty[k] = 0; });
    if (!act || (act.kind !== 'newyear' && act.kind !== 'midautumn')) { res.reason = '目前沒有進行中的過年或中秋檔期，算不出去年同檔期。'; return res; }
    var y = seasonYearOf(act);
    if (!y) { res.reason = '進行中的檔期還沒有填節日日期，算不出去年同檔期。'; return res; }
    var ly = String(Number(y) - 1), ctx = salesCtx(), list = classifyOrders(X.orders(), ctx).list;
    var w = seasonWindow(act.kind, ly), ls = findSeason(act.kind, ly), fixedW = null;
    // 過年檔期（2026-11-12 起）：去年業績固定算「前年 12 月 1 日～去年 2 月底」的訂單（整個過年檔期），不再用節日前 60 天
    if (act.kind === 'newyear') fixedW = [Date.UTC(Number(ly) - 1, 11, 1), Date.UTC(Number(ly), 2, 0)];
    res.label = fixedW ? ((ls ? ls.name : ly + KIND[act.kind]) + '（' + new Date(fixedW[0]).toISOString().slice(0, 10) + '～' + new Date(fixedW[1]).toISOString().slice(0, 10) + '）')
      : (ls ? ls.name : ly + KIND[act.kind]) + (w ? '（' + new Date(w[0]).toISOString().slice(0, 10) + '～' + new Date(w[1]).toISOString().slice(0, 10) + '）' : '（依檔期月份規則）');
    res.unmatchedList = {};
    var noDept = function (o, why) { // 分不到部門的訂單，依接單部門／通路文字彙整（名稱、筆數、數量、金額）
      var nm = o.dk === 'unmatched' ? o.raw : (why || '（沒有對照到部門）'), u = res.unmatchedList[nm] || (res.unmatchedList[nm] = { name: nm, n: 0, qty: 0, amt: 0 });
      u.n++; u.qty += o.q; u.amt += (o.amt != null ? o.amt : 0);
    };
    list.forEach(function (o) {
      if (o.dk === 'none') return;
      if (fixedW) { var tt = dateMs(o.date); if (tt == null || tt < fixedW[0] || tt > fixedW[1]) return; } else if (!inPeriod(o, act.kind, ly)) return;
      res.ordersN++;
      var d = o.dk === 'grandduchy' ? 'channel' : o.dk;
      if (depts.indexOf(d) < 0) { res.unmatchedN++; res.unmatchedQty += o.q; noDept(o); return; } // 接單部門對不到
      if (o.amt != null) { res.amounts[d] += o.amt; res.qty[d] += o.q; res.actualN++; return; } // 訂單上有實際金額
      if (!o.p) { res.unmatchedN++; res.unmatchedQty += o.q; return; } // 沒有金額、品號又對不到品項，沒辦法估
      res.estN++;
      var price = X.num(typeof sfUnitPrice === 'function' ? sfUnitPrice(o.p) : X.productPrice(o.p)), f = typeof sfDiscountFactor === 'function' ? sfDiscountFactor(o.p, d) : 1;
      res.amounts[d] += o.q * price * f; res.qty[d] += o.q;
    });
    depts.forEach(function (k) { res.amounts[k] = Math.round(res.amounts[k]); });
    res.found = res.ordersN > 0;
    if (!res.found) res.reason = '過去訂單紀錄裡找不到去年同檔期（' + res.label + '）的訂單。';
    return res;
  };

  // 單條檢視的進貨管理：每個單條比較「業績預估換算的進貨量（預估盒數 × 進貨比例 × 配方條數）」、採購叫貨記的已叫貨條數、這個檔期已販售的條數
  // 有叫貨紀錄就拿已叫貨條數當基準，沒有就用進貨量；已販售 ≥ 基準＝要追量進貨
  function purchasePlanSingles(list, selC, ctx, sgroup) {
    var parts = conv(), res = { ratioText: ratioText(), hasForecast: false, rows: [], reason: '' }, fo = forecastOf(selC), rowsAll = null;
    var estFull = Object.create(null), buy = Object.create(null), sold = Object.create(null), ord = Object.create(null), prod = Object.create(null);
    if (!fo) res.reason = selC.season && selC.season.status !== 'active' ? '「' + selC.name + '」不是進行中的檔期，沒有存到業績預估，只能看已叫貨與已販售。' : '「' + selC.name + '」還沒有業績預估，只能看已叫貨與已販售。';
    else Object.keys(rowsAll = forecastRows(fo)).forEach(function (code) {
      var r = rowsAll[code];
      if (!r || !r.lines) return;
      var p = ctx.byCode[normCode(code)] || ctx.byId[String(code)] || null, ps = p ? parts(p) : null;
      if (!ps) return;
      var sum = 0;
      Object.keys(r.lines).forEach(function (n) { var line = r.lines[n] || {}; Object.keys(line).forEach(function (k) { sum += X.num((line[k] || {}).est); }); });
      if (!(sum > 0)) return;
      var boxes = buyOf(p, sum);
      ps.forEach(function (pt) {
        var k = String(pt.single.id);
        prod[k] = pt.single; estFull[k] = (estFull[k] || 0) + sum * pt.qty; buy[k] = (buy[k] || 0) + boxes * pt.qty; res.hasForecast = true;
      });
    });
    var cur = sumPeriod(list, selC.kind, selC.year, 'all');
    Object.keys(cur.items).forEach(function (k) {
      var it = cur.items[k], ps = it.p ? parts(it.p) : null;
      if (!ps) return;
      ps.forEach(function (pt) { var id = String(pt.single.id); prod[id] = pt.single; sold[id] = (sold[id] || 0) + it.qty * pt.qty; });
    });
    var ordP = orderedByProduct(selC);
    Object.keys(ordP).forEach(function (pid) {
      var p = ctx.byId[pid], ps = p ? parts(p) : null;
      if (!ps) return;
      ps.forEach(function (pt) { var id = String(pt.single.id); prod[id] = pt.single; ord[id] = (ord[id] || 0) + ordP[pid] * pt.qty; });
    });
    Object.keys(prod).forEach(function (id) {
      if (sgroup && sgroup !== 'all' && id !== String(sgroup)) return;
      var e = estFull[id] || 0, b = buy[id] || 0, o = ord[id] || 0, s0 = sold[id] || 0, base = o > 0 ? o : b;
      if (!(e > 0) && !(o > 0) && !(s0 > 0)) return;
      res.rows.push({ id: id, label: (prod[id].code ? prod[id].code + ' ' : '') + prod[id].name, est: e, buy: b, ordered: o, sold: s0, base: base, baseIsOrd: o > 0, left: base - s0,
        status: base > 0 ? (s0 >= base ? 'over' : 'ok') : 'nofc' });
    });
    var rank = { over: 0, ok: 1, nofc: 2 };
    res.rows.sort(function (a, b) { return (rank[a.status] - rank[b.status]) || ((b.base > 0 ? b.sold / b.base : 0) - (a.base > 0 ? a.sold / a.base : 0)) || (b.sold - a.sold); });
    return res;
  }
  function renderPurchaseSinglesCard(plan, selC) {
    var pctText = plan.ratioText;
    var go = '<button type="button" class="btn gray" data-go="xPurchase" style="min-height:30px;padding:3px 11px;font-size:15px">到「採購叫貨」</button>';
    if (!plan.rows.length) return X.ui.card('進貨管理（單條，' + esc(selC.name) + '）', X.ui.empty(plan.reason || '沒有資料。') + '<p class="small" style="margin:8px 0 0">進貨條數來自「採購叫貨」頁的叫貨紀錄與業績預估換算。</p>', go);
    var over = plan.rows.filter(function (r) { return r.status === 'over'; });
    var banner = over.length
      ? X.ui.banner('bad', '<b>' + over.length + ' 種單條要追量進貨：</b>' + over.slice(0, 6).map(function (r) { return esc(r.label); }).join('、') + (over.length > 6 ? '…' : '') + '（實際販售已超過' + (over.every(function (r) { return r.baseIsOrd; }) ? '已叫貨條數' : '進貨條數') + '）。')
      : X.ui.banner('ok', '目前所有單條的販售都還在進貨條數以內，不用追量。');
    var tag = function (r) { return r.status === 'over' ? X.ui.tag('要追量進貨', 'bad') : (r.status === 'nofc' ? X.ui.tag('沒有進貨基準', 'muted') : X.ui.tag('正常', 'ok')); };
    var tbl = X.ui.table([
      { label: '單條', render: function (r) { return esc(r.label); } },
      { label: '預估換算（條）', num: true, render: function (r) { return r.est > 0 ? X.fmt(r.est) : DASH; } },
      { label: '進貨量（預估×' + pctText + '，條）', num: true, render: function (r) { return r.buy > 0 ? X.fmt(r.buy) : DASH; } },
      { label: '已叫貨（條）', num: true, render: function (r) { return r.ordered > 0 ? '<b>' + X.fmt(r.ordered) + '</b>' : DASH; } },
      { label: '已販售（條）', num: true, render: function (r) { return X.fmt(r.sold); } },
      { label: '還可販售（條）', num: true, render: function (r) { return r.base > 0 ? (r.left >= 0 ? X.fmt(r.left) : '<b style="color:var(--bad)">超過 ' + X.fmt(-r.left) + '</b>') : DASH; } },
      { label: '判斷基準', render: function (r) { return r.base > 0 ? '<span class="small">' + (r.baseIsOrd ? '已叫貨' : '進貨量') + '</span>' : DASH; } },
      { label: '狀態', render: tag }
    ], plan.rows);
    return X.ui.card('進貨管理（單條，' + esc(selC.name) + '）', '<div>' + tbl + '</div>' +
      '<p class="small" style="margin:10px 0 0">已叫貨＝「採購叫貨」頁這個檔期叫的禮盒依單條內容物換算成條（已叫貨＋已到貨）；進貨量＝業績預估盒數 × 進貨比例（' + pctText + '）依單條內容物換算（禮盒 1 盒＝配方裡的條數）；已販售＝這個檔期的實際訂單換算成條（單賣的單條直接算）。有叫貨紀錄就用已叫貨條數當基準，沒有就用進貨量；已販售 ≥ 基準就標「要追量進貨」。</p>', go);
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

  // 目前只拿得到今年全公司的銷售金額，沒辦法分部門：先只看全公司的「禮盒數」，金額和部門的畫面先關掉（改成 true 就會回來）
  var SHOW_AMT = false, SHOW_DEPT = false;

  function renderSalesDash(el) {
    var rows = typeof X.salesOrders === 'function' ? X.salesOrders() : X.orders();
    var html = intro('選檔期、單位與規格，看全公司每週的實際、預估、去年同檔期與進貨量；賣超過進貨量會標紅，提醒追量進貨（不顯示客戶資料，金額與各部門先不顯示）。');
    // 實際銷售的資料來源與上次同步時間；入口網站的訂單要用書籤手動同步
    var syncInfo = X.get('hqStock'), pOrders = X.get('portalOrders');
    html += '<div class="small" style="margin:0 0 10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">實際銷售＝過去訂單匯入 ＋ 入口網站訂單（預訂交貨日）：' +
      (pOrders.length ? '入口網站 ' + X.fmt(pOrders.length) + ' 筆，上次同步 ' + esc(X.fmtTime(syncInfo.salesAt)) : '<b style="color:var(--warn)">還沒同步過入口網站的訂單</b>') +
      '<button type="button" class="btn ' + (pOrders.length ? 'gray' : 'primary') + '" data-go="xHqStock" style="min-height:30px;padding:3px 11px;font-size:15px">' + (pOrders.length ? '再同步一次（書籤）' : '怎麼同步（書籤）') + '</button></div>';
    el.onchange = null;
    el.oninput = null;
    el.onclick = null;
    CONV = null;
    SW_CACHE = null;
    if (!rows.length) { el.innerHTML = html + X.ui.empty('還沒有過去訂單資料。'); return; }

    var t0 = now();
    var c = classifyOrders(rows, salesCtx());
    var list = c.list;
    var choices = seasonChoices(list);
    var hasData = function (ch) { return yearsOf(list, ch.kind).indexOf(ch.year) >= 0 || forecastHasData(forecastOf(ch)); };
    var selC = choices.find(function (ch) { return ch.id === sd.sel; }) || choices.find(hasData) || choices[0] || null;
    if (!selC) { el.innerHTML = html + X.ui.empty('還沒有檔期，也沒有可以分檔期的訂單。請到「檔期設定」建立檔期。'); return; }
    sd.sel = selC.id; sd.kind = selC.kind; sd.year = selC.year;
    // 檔期比較只比「去年同種類的檔期」（過年比去年過年、中秋比去年中秋、全年比去年全年），或選「不比較」
    var cmpC = null;
    if (sd.cmp !== 'none') cmpC = choices.find(function (ch) { return ch.kind === selC.kind && Number(ch.year) === Number(selC.year) - 1; }) || null;
    var deptOpts = [{ key: 'all', label: '全公司' }].concat(X.DEPTS.map(function (d) { return { key: d.key, label: d.label }; }), [{ key: 'unmatched', label: '未對照' }]);
    if (!deptOpts.some(function (d) { return d.key === sd.dept; })) sd.dept = 'all';
    if (!SHOW_DEPT) sd.dept = 'all';
    if (!SHOW_AMT) sd.metric = 'qty';
    if (sd.metric === 'qty' && sd.group === 'all') sd.group = 'all3';
    var lastYear = cmpC ? cmpC.year : '', cmpKind = cmpC ? cmpC.kind : sd.kind;
    var cur = sumPeriod(list, sd.kind, sd.year, sd.dept);
    var prev = cmpC ? sumPeriod(list, cmpC.kind, cmpC.year, sd.dept) : sumPeriod(list, 'year', '0000', sd.dept);
    var ms = Math.round(now() - t0);
    var deptName = (deptOpts.find(function (d) { return d.key === sd.dept; }) || {}).label;
    var unitSingle = sd.unit === 'single', mtr = unitSingle ? 'single' : sd.metric, gsel = unitSingle ? sd.sgroup : sd.group;
    // 這個檔期需要的品項＝檔期品項清單 ＋ 業績預估有填的 ＋ 這個檔期有賣的；只因為去年有賣的品項不列出來
    var needG = Object.create(null), needS = Object.create(null), ctxN = salesCtx();
    var addNeed = function (p) {
      if (!p) return;
      if (isSingle(p)) needS[String(p.id)] = true;
      else { needG[String(p.id)] = true; (conv()(p) || []).forEach(function (pt) { needS[String(pt.single.id)] = true; }); }
    };
    if (selC.season && X.seasonItems) X.seasonItems.itemsOf(selC.season).forEach(function (id) { addNeed(X.productById(id)); });
    Object.keys(cur.items).forEach(function (k) { var it = cur.items[k]; if (it.p && it.qty > 0) addNeed(it.p); });
    var foN = forecastOf(selC);
    if (foN) Object.keys(foN.rows || {}).forEach(function (code) {
      var r = foN.rows[code];
      if (!r || !r.lines) return;
      var sum = 0;
      Object.keys(r.lines).forEach(function (n) { var line = r.lines[n] || {}; Object.keys(line).forEach(function (k) { sum += X.num((line[k] || {}).est); }); });
      if (sum > 0) addNeed(ctxN.byCode[normCode(code)] || ctxN.byId[String(code)] || null);
    });
    // 單條檢視的單條按鈕：配方裡用到的單條、單賣的單條
    var singleChoices = [];
    if (unitSingle) {
      var seenS = Object.create(null);
      X.singles().forEach(function (sp) { if (sp && needS[String(sp.id)] && !seenS[sp.id]) { seenS[sp.id] = true; singleChoices.push(sp); } });
      singleChoices.sort(function (a, b) { return String(a.code || '').localeCompare(String(b.code || ''), 'zh-TW', { numeric: true }); });
      if (sd.sgroup !== 'all' && !seenS[sd.sgroup]) { sd.sgroup = 'all'; gsel = 'all'; }
    }

    // 用按鈕選：檔期、比較檔期、部門、金額／禮盒數、禮盒規格
    var chip = function (act, id, label, on) {
      return '<button type="button" class="btn ' + (on ? 'primary' : 'gray') + '" data-act="' + act + '" data-v="' + esc(id) + '" aria-pressed="' + (on ? 'true' : 'false') + '" style="min-height:30px;padding:3px 11px;font-size:15px">' + esc(label) + '</button>';
    };
    var row = function (label, chips) {
      return '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px"><span class="small" style="min-width:60px;font-weight:700">' + label + '</span>' + chips + '</div>';
    };
    html += row('檔期', choices.map(function (ch) { return chip('sel', ch.id, ch.name, ch.id === selC.id); }).join(''));
    if (SHOW_DEPT) html += row('部門', deptOpts.map(function (d) { return chip('dept', d.key, d.label, d.key === sd.dept); }).join(''));
    html += row('單位', chip('unit', 'box', '禮盒（盒）', !unitSingle) + chip('unit', 'single', '單條（條）', unitSingle) +
      '<span class="small">' + (unitSingle ? '禮盒依單條內容物換算成條，單賣的單條直接算' : '') + '</span>');
    if (unitSingle) html += row('單條', chip('sgroup', 'all', '全部單條', sd.sgroup === 'all') + singleChoices.map(function (sp) { return chip('sgroup', sp.id, (sp.code ? sp.code + ' ' : '') + sp.name, String(sp.id) === String(sd.sgroup)); }).join(''));
    else html += row(SHOW_AMT ? '看' : '規格', (SHOW_AMT ? chip('metric', 'amt', '金額', sd.metric === 'amt') + chip('metric', 'qty', '禮盒數', sd.metric === 'qty') +
      '<span class="small" style="margin:0 2px 0 8px;font-weight:700">規格</span>' : '') +
      GROUPS.filter(function (g) { return !(sd.metric === 'qty' && g[0] === 'all'); }).map(function (g) { return chip('group', g[0], g[1], g[0] === sd.group); }).join(''));
    html += '<p class="small" style="margin:0 0 10px">' +
      esc('今年（' + periodLabel(sd.kind, sd.year) + '）：' + shortRange(cur) + (cmpC ? '；比較（' + periodLabel(cmpKind, lastYear) + '）：' + shortRange(prev) : '') + '。') +
      (cmpC && prev.minDate && cur.minDate && (prev.minDate.slice(5) !== cur.minDate.slice(5) || prev.maxDate.slice(5) !== cur.maxDate.slice(5)) ? ' <b>兩個檔期的訂單日期範圍不一樣，比較時請留意。</b>' : '') + '</p>';

    var weekly = buildWeekly(list, salesCtx(), selC, cmpC, sd.dept, mtr, gsel, sd.span, sd.cum !== 'week');
    var plan = unitSingle ? purchasePlanSingles(list, selC, salesCtx(), sd.sgroup) : purchasePlanFor(list, selC, salesCtx(), sd.group);

    // 一眼區：要追量的橫幅＋四張卡片（實際累計、預估達成率、可賣餘量、去年同期）
    var uTxt = unitSingle ? '條' : '盒', over = plan.rows.filter(function (r) { return r.status === 'over'; });
    html += over.length
      ? X.ui.banner('bad', '<b>' + over.length + (unitSingle ? ' 種單條' : ' 個禮盒') + '要追量進貨：</b>' + over.slice(0, 6).map(function (r) { return esc(r.label); }).join('、') + (over.length > 6 ? '…' : '') + '（實際販售已超過' + (unitSingle && over.every(function (r) { return r.baseIsOrd; }) ? '已叫貨條數' : '進貨量') + '）。')
      : (plan.rows.length && (plan.hasForecast || unitSingle) ? X.ui.banner('ok', '目前所有' + (unitSingle ? '單條' : '禮盒') + '的販售都還在進貨量以內，不用追量。') : '');
    if (weekly) {
      // 卡片用「整個檔期到今天」的合計（檔期範圍同圖），單位和規格篩選跟圖一致
      var one = function () { return 0; };
      var actAll = weeklyOrders(list, selC.kind, selC.year, sd.dept, mtr, gsel, one)[0] || 0;
      var prevAll = cmpC ? (weeklyOrders(list, cmpC.kind, cmpC.year, sd.dept, mtr, gsel, one)[0] || 0) : 0;
      var thrV = weekly.thrTotal, left = thrV - actAll, estAll = weekly.estTotal || 0;
      html += X.ui.kpis([
        { label: '實際累計', value: X.fmt(actAll) + ' ' + uTxt, tone: 'info', sub: selC.name + ' 到今天的合計' },
        { label: '預估達成率', value: estAll > 0 ? (Math.round(actAll / estAll * 1000) / 10) + '%' : '—', tone: estAll > 0 ? (actAll >= estAll ? 'ok' : 'info') : 'muted', sub: estAll > 0 ? '業績預估 ' + X.fmt(estAll) + ' ' + uTxt : '還沒有預估（到「業績預估」填）' },
        { label: weekly.thrIsOrd ? '已叫貨還可賣' : '進貨量還可賣', value: thrV > 0 ? (left >= 0 ? X.fmt(left) + ' ' + uTxt : '超過 ' + X.fmt(-left) + ' ' + uTxt) : '—', tone: thrV > 0 ? (left < 0 ? 'bad' : 'ok') : 'muted',
          sub: thrV > 0 ? (weekly.thrIsOrd ? '已叫貨 ' : '進貨量（預估 × ' + weekly.ratioText + '） ') + X.fmt(thrV) + ' ' + uTxt : '沒有預估也沒有叫貨紀錄' },
        { label: '去年同檔期', value: cmpC && prevAll > 0 ? X.fmt(prevAll) + ' ' + uTxt : '—', tone: 'muted', sub: cmpC ? (prevAll > 0 ? cmpC.name + '整檔' + (growthText(actAll, prevAll) ? '，今年' + growthText(actAll, prevAll) : '') : '去年沒有資料') : '不比較' }
      ]);
    }
    var actions = '<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end">' +
      chip('cum', 'cum', '累計', sd.cum !== 'week') + chip('cum', 'week', '每週', sd.cum === 'week') +
      chip('span', 'season', '檔期 ' + seasonWindowDays() + ' 天', sd.span !== 'all') + chip('span', 'all', '全部週', sd.span === 'all') +
      chip('cmp', 'auto', '含去年', sd.cmp !== 'none') + chip('cmp', 'none', '不含去年', sd.cmp === 'none') + '</div>';
    html += renderChartCard(weekly, mtr, deptName, gsel, actions);
    html += unitSingle ? renderPurchaseSinglesCard(plan, selC) : renderPurchaseCard(plan, selC);
    var detailStart = html.length; // 後面的訂單統計與品項比較表收進摺疊區

    // 單條檢視：今年、去年各賣了幾條（全部單條合計與各單條）
    var singlesFrom = function (sum) {
      var out = { total: 0, by: Object.create(null) }, parts = conv();
      Object.keys(sum.items).forEach(function (k) {
        var it = sum.items[k], ps = it.p ? parts(it.p) : null;
        if (!ps) return;
        ps.forEach(function (pt) { var id = String(pt.single.id), g = out.by[id] || (out.by[id] = { p: pt.single, qty: 0 }); g.qty += it.qty * pt.qty; out.total += it.qty * pt.qty; });
      });
      return out;
    };
    var sCur = unitSingle ? singlesFrom(cur) : null, sPrev = unitSingle ? singlesFrom(prev) : null;

    html += X.ui.kpis([
      sCur ? { label: deptName + '｜單條販售條數', value: X.fmt(sCur.total) + ' 條', tone: 'info', sub: '去年 ' + X.fmt(sPrev.total) + (growthText(sCur.total, sPrev.total) ? '，' + growthText(sCur.total, sPrev.total) : '') + '；禮盒依單條內容物換算，單賣的單條直接算' } :
      { label: deptName + '｜訂單數量', value: X.fmt(cur.qty), tone: 'info', sub: '去年 ' + X.fmt(prev.qty) + (growthText(cur.qty, prev.qty) ? '，' + growthText(cur.qty, prev.qty) : '') + (cur.singleQty ? '；含單條 ' + X.fmt(cur.singleQty) + ' 條' : '') },
      SHOW_AMT && { label: deptName + '｜金額', value: money(cur.amt), tone: 'ok', sub: '去年 ' + money(prev.amt) + (growthText(cur.amt, prev.amt) ? '，' + growthText(cur.amt, prev.amt) : '') +
        (cur.nonRevAmt ? '；公關贈、執行長 ' + money(cur.nonRevAmt) + ' 不算營收' : '') },
      { label: '訂單筆數（不重複單號）', value: X.fmt(cur.orderCount), tone: 'muted', sub: '去年 ' + X.fmt(prev.orderCount) },
      SHOW_AMT && { label: '沒有售價的數量', value: X.fmt(cur.unpricedQty), tone: (cur.unpricedQty || cur.unmatchedQty) ? 'warn' : 'ok',
        sub: [cur.unpricedQty ? '這些沒算到金額，請到禮盒／單條資料填售價' : '',
          cur.unmatchedQty ? '另有品號未對照的 ' + X.fmt(cur.unmatchedQty) + ' 也沒算到金額，請到「對照設定」對照品號' : ''].filter(Boolean).join('；') || '全部都有售價' }
    ].filter(Boolean));

    // 依部門（全公司時才顯示）
    if (SHOW_DEPT && sd.dept === 'all') {
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

    if (sCur) {
      var sKeys = Object.create(null);
      Object.keys(sCur.by).concat(Object.keys(sPrev.by)).forEach(function (k) { sKeys[k] = true; });
      var sRows = Object.keys(sKeys).filter(function (k) { return needS[k]; }).map(function (k) { var a = sCur.by[k], b = sPrev.by[k], base = a || b; return { p: base.p, qa: a ? a.qty : 0, qb: b ? b.qty : 0 }; })
        .sort(function (x, y) { return (y.qa - x.qa) || (y.qb - x.qb); });
      html += X.ui.card('依單條（今年條數排序）', X.ui.table([
        { label: '單條', render: function (x) { return esc((x.p.code ? x.p.code + ' ' : '') + x.p.name); } },
        { label: '今年（條）', num: true, render: function (x) { return X.fmt(x.qa); } },
        { label: '去年（條）', num: true, render: function (x) { return X.fmt(x.qb); } },
        { label: '成長', num: true, render: function (x) { return growth(x.qa, x.qb); } }
      ], sRows, { empty: '這兩年都沒有可以換算成單條的訂單' }) +
        '<p class="small" style="margin:10px 0 0">沒有單條內容物、名稱也對不到單條的禮盒，以及品號還沒對照的訂單，不會算進單條。到「禮盒資料」設定單條內容物。</p>');
    }

    // 依品項（今年金額排序，前 N 名，見「計算規則」）
    var topN = window.CMSRules ? CMSRules.get('salesTopN') : 15;
    var keys = Object.create(null);
    Object.keys(cur.items).concat(Object.keys(prev.items)).forEach(function (k) { keys[k] = true; });
    var items = Object.keys(keys).map(function (k) {
      var a = cur.items[k], b = prev.items[k], base = a || b;
      return { p: base.p, code: base.code, name: base.name, price: base.price, qa: a ? a.qty : 0, qb: b ? b.qty : 0, ma: a ? a.amt : 0, mb: b ? b.amt : 0 };
    }).filter(function (x) { return x.p ? (needG[String(x.p.id)] || needS[String(x.p.id)]) : x.qa > 0; }).sort(function (x, y) { return SHOW_AMT ? ((y.ma - x.ma) || (y.qa - x.qa) || (y.qb - x.qb)) : ((y.qa - x.qa) || (y.qb - x.qb)); });
    var shown = items.slice(0, topN);
    shown.forEach(function (x, i) { x.rank = i + 1; });
    if (!sCur) html += X.ui.card('依品項（今年' + (SHOW_AMT ? '金額' : '數量') + '前 ' + topN + ' 名）', X.ui.table([
      { label: '#', num: true, render: function (x) { return String(x.rank); } },
      { label: '品號', render: function (x) { return x.code ? esc(x.code) : DASH; } },
      { label: '名稱', render: function (x) { return esc(x.name || '（沒有名稱）'); } },
      { label: '類別', render: function (x) { return !x.p ? X.ui.tag('未對照', 'warn') : (isSingle(x.p) ? X.ui.tag('單條', 'muted') : X.ui.tag('禮盒', 'info')); } },
      SHOW_AMT && { label: '售價', num: true, render: function (x) { return !x.p ? DASH : (x.price > 0 ? money(x.price) : X.ui.tag('沒有售價', 'warn')); } },
      { label: '今年數量', num: true, render: function (x) { return X.fmt(x.qa); } },
      { label: '去年數量', num: true, render: function (x) { return X.fmt(x.qb); } },
      { label: '成長', num: true, render: function (x) { return growth(x.qa, x.qb); } },
      SHOW_AMT && { label: '今年金額', num: true, render: function (x) { return money(x.ma); } },
      SHOW_AMT && { label: '去年金額', num: true, render: function (x) { return money(x.mb); } }
    ].filter(Boolean), shown, { empty: '這兩年都沒有訂單' }) +
      (items.length > topN ? '<p class="small" style="margin:10px 0 0">另外還有 ' + (items.length - topN) + ' 個品項未列出（顯示幾名可在「計算規則」修改）。</p>' : '') +
      '<p class="small" style="margin:6px 0 0">品號先看「對照設定」的品號對照，沒有設定的再直接比對禮盒／單條資料的品號（不分大小寫、忽略空白）。' + (SHOW_AMT ? '售價用目前「禮盒資料」「單條資料」填的售價；禮盒沒填售價時，是否改用內建備用售價見「計算規則」。' : '') + '</p>');

    // 沒有售價的品項
    var unpriced = items.filter(function (x) { return x.p && !(x.price > 0) && (x.qa || x.qb); });
    if (SHOW_AMT && unpriced.length) {
      html += X.ui.card('沒有售價的品項（金額沒算到）', X.ui.table([
        { label: '品號', render: function (x) { return x.code ? esc(x.code) : DASH; } },
        { label: '名稱', render: function (x) { return esc(x.name); } },
        { label: '類別', render: function (x) { return isSingle(x.p) ? X.ui.tag('單條', 'muted') : X.ui.tag('禮盒', 'info'); } },
        { label: '今年數量', num: true, render: function (x) { return X.fmt(x.qa); } },
        { label: '去年數量', num: true, render: function (x) { return X.fmt(x.qb); } }
      ], unpriced) + '<p class="small" style="margin:10px 0 0">禮盒到「禮盒資料」、單條到「單條資料」填售價後，這裡的金額就會更新。</p>');
    }

    var unCh = Object.keys(cur.unCh).sort(function (a, b) { return cur.unCh[b] - cur.unCh[a]; });
    if (SHOW_DEPT && sd.dept === 'all' && unCh.length) {
      var chRows = unCh.slice(0, 10).map(function (k) { return { name: k, qty: cur.unCh[k] }; });
      html += X.ui.card('還沒對照部門的通路（今年，前 10 名）', X.ui.table([
        { label: '訂單上的通路／接單部門', render: function (x) { return esc(x.name); } },
        { label: '數量', num: true, render: function (x) { return X.fmt(x.qty); } }
      ], chRows) + (unCh.length > 10 ? '<p class="small" style="margin:10px 0 0">另外還有 ' + (unCh.length - 10) + ' 個未列出。請到「對照設定」的通路、接單部門分頁設定。</p>' : ''));
    }

    html = html.slice(0, detailStart) + '<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:700;font-size:16px;padding:6px 0">訂單統計與品項比較表（今年 vs 去年）</summary>' + html.slice(detailStart) + '</details>';
    html += '<p class="small" style="margin:4px 0 0">共 ' + X.fmt(rows.length) + ' 筆訂單明細' + (c.ignored ? '（品號設為「不計算」的 ' + X.fmt(c.ignored) + ' 筆不算）' : '') + '，計算 ' + ms + ' 毫秒。</p>';
    el.innerHTML = html;
    bindChart(el, weekly, mtr);

    el.onclick = function (e) {
      var go = e.target.closest ? e.target.closest('[data-go]') : null;
      if (go) { X.goPage(go.dataset.go); return; }
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b || !b.dataset.act) return;
      var a = b.dataset.act, v = b.dataset.v;
      if (a === 'sel') { sd.sel = v; sd.cmp = 'auto'; }
      else if (a === 'cmp') sd.cmp = v;
      else if (a === 'dept') sd.dept = v;
      else if (a === 'group') sd.group = v;
      else if (a === 'unit') sd.unit = v;
      else if (a === 'sgroup') sd.sgroup = v;
      else if (a === 'span') sd.span = v;
      else if (a === 'cum') sd.cum = v;
      else if (a === 'wsave' || a === 'wreset') {
        var rec = selC.season && X.ensure('seasons').find(function (x) { return x && x.id === selC.season.id; });
        if (!rec) return;
        if (a === 'wreset') delete rec.forecastWeights;
        else {
          var ws = Array.prototype.map.call(el.querySelectorAll('input[data-w]'), function (inp) { return Math.max(0, Number(inp.value) || 0); });
          if (!ws.some(function (x) { return x > 0; })) { X.toast('比例至少要有一個大於 0'); return; }
          rec.forecastWeights = ws;
        }
        X.save();
        X.toast(a === 'wreset' ? '預估的週別比例改回照比較檔期' : '已儲存預估的週別比例');
      }
      else if (a === 'metric') { sd.metric = v; if (v === 'qty' && sd.group === 'all') sd.group = 'all3'; else if (v === 'amt' && sd.group === 'all3') sd.group = 'all'; }
      else return;
      renderSalesDash(el);
    };
  }


  // ================= 首頁禮盒「銷售預估調整」的資料（2026-11-12）=================
  // 每個本期上架的禮盒：今年預估（業績預估合計）、今年已販售（檔期開始～今天）、去年同期（依檔期節日對齊：今天距節日幾天，去年就看距去年節日幾天的那一天）已販售與全期，
  // 用去年的「賣到這天的比例」推今年全期（建議預估＝今年已售 ÷ 去年同期已賣比例），並判斷今年比去年成長或衰退。
  // 今年新品（例如袋裝）去年沒有同品號的銷售：依序改用「去掉『袋』字的同名品項」、再不行用「同規格群組」去年的銷售節奏來推，畫面上標明用哪一種比對。
  // 已販售＝訂單日期（入口網站的訂單用預訂交貨日）在檔期開始～今天的數量，不含單條；沒有「不計算」的部門。
  var GA_MIN = 10; // 去年全期至少賣這麼多，才拿來當比對基準
  function gaOrders() {
    var key = [X.orders().length, X.get('portalOrders').length, (X.get('hqStock') || {}).salesAt || 0, X.get('codeMap').length, X.get('deptMap').length, X.products().length].join('|');
    if (FA_CACHE.key !== key || !FA_CACHE.list) {
      FA_CACHE.list = classifyOrders(typeof X.salesOrders === 'function' ? X.salesOrders() : X.orders(), salesCtx()).list;
      FA_CACHE.key = key;
    }
    return FA_CACHE.list;
  }
  function gaBaseName(p) { return String((p && p.name) || '').replace(/[（(]?\s*袋裝?\s*[)）]?/g, '').replace(/袋/g, '').replace(/\s+/g, '').toLowerCase(); }
  function gaWindow() { // { ok, reason, kind, year, H, w0, cut, shift, w0L, cutL, endL, label }
    var act = X.activeSeason(), res = { ok: false, reason: '' };
    if (!act || (act.kind !== 'newyear' && act.kind !== 'midautumn')) { res.reason = '目前沒有進行中的過年或中秋檔期。'; return res; }
    var y = seasonYearOf(act);
    if (!y) { res.reason = '進行中的檔期還沒有填節日日期（到「檔期設定」填）。'; return res; }
    var H = dateMs(act.holidayDate), W = seasonWindowDays(), today = dateMs(X.today());
    var cs = compareSeasonOf(act, act.kind, y), H0 = cs && DATE_RE.test(cs.holidayDate || '') ? dateMs(cs.holidayDate) : null;
    var shift = H0 != null ? H - H0 : 364 * DAY;
    var cut = Math.min(today, H), w0 = H - (W - 1) * DAY;
    return { ok: true, season: act, kind: act.kind, year: y, H: H, w0: w0, cut: cut, shift: shift, w0L: w0 - shift, cutL: cut - shift, endL: H - shift, aligned: H0 != null,
      label: H0 != null ? '去年同檔期（' + (cs.name || '') + '，節日 ' + cs.holidayDate + '）' : '去年同一週（找不到去年同檔期的節日日期，往前挪 52 週）' };
  }
  // 今年已販售（每個禮盒）：{ 禮盒 id: 數量 }，首頁禮盒表「已售／剩」用
  X.giftSoldMap = function () {
    var g = gaWindow(), out = Object.create(null);
    if (!g.ok) return out;
    gaOrders().forEach(function (o) {
      if (!o.p || o.dk === 'none' || isSingle(o.p)) return;
      var t = dateMs(o.date);
      if (t != null && t >= g.w0 && t <= g.cut) out[String(o.p.id)] = (out[String(o.p.id)] || 0) + o.q;
    });
    return out;
  };
  X.giftAdjustData = function () {
    SW_CACHE = null;
    var g = gaWindow(), res = { ok: g.ok, reason: g.reason, win: g, rows: [], total: null };
    if (!g.ok) return res;
    var sold = Object.create(null), lastTo = Object.create(null), lastFull = Object.create(null), orders = gaOrders();
    orders.forEach(function (o) {
      if (!o.p || o.dk === 'none' || isSingle(o.p)) return;
      var t = dateMs(o.date), id = String(o.p.id);
      if (t == null) return;
      if (t >= g.w0 && t <= g.cut) sold[id] = (sold[id] || 0) + o.q;
      if (t >= g.w0L && t <= g.endL) { lastFull[id] = (lastFull[id] || 0) + o.q; if (t <= g.cutL) lastTo[id] = (lastTo[id] || 0) + o.q; }
    });
    var gifts = X.products().filter(function (p) { return p && !isSingle(p); });
    var sum = function (list, m) { return list.reduce(function (t, p) { return t + (m[String(p.id)] || 0); }, 0); };
    var listed = gifts.filter(function (p) { return p.isListedCurrent === true; });
    var rows = listed.map(function (p) {
      var id = String(p.id), est = window.CMSStock ? CMSStock.giftForecastBase(p.id) : 0, C = sold[id] || 0;
      var own = lastFull[id] || 0, isNew = !(own > 0), basis = '', set = [p], A = 0, B = 0;
      if (own >= GA_MIN) { basis = 'same'; A = lastTo[id] || 0; B = own; }
      else {
        var bn = gaBaseName(p), byName = gifts.filter(function (q) { return gaBaseName(q) === bn; }), bB = sum(byName, lastFull);
        if (bB >= GA_MIN) { basis = 'name'; set = byName; A = sum(byName, lastTo); B = bB; }
        else {
          var gk = giftGroup(p), byGrp = gk ? gifts.filter(function (q) { return giftGroup(q) === gk; }) : [], gB = sum(byGrp, lastFull);
          if (gB >= GA_MIN) { basis = 'group'; set = byGrp; A = sum(byGrp, lastTo); B = gB; }
        }
      }
      var f = B > 0 ? A / B : null, setSold = basis === 'same' ? C : sum(set, sold);
      var growth = A > 0 ? setSold / A - 1 : null;
      var sug = (f != null && f > 0 && C > 0) ? Math.max(C, Math.round(C / f)) : null;
      var conf = f == null ? '' : ((A >= 30 && f >= 0.3) ? '高' : (A >= 10 && f >= 0.15 ? '中' : '低'));
      var trend = growth == null ? '無法比較' : (growth >= 0.1 ? '成長' : (growth <= -0.1 ? '衰退' : '持平'));
      var act = '';
      if (sug != null && est > 0) { var rt = sug / est; act = rt > 1.1 ? '建議上調' : (rt < 0.9 ? '建議下修' : '預估合理'); }
      else if (sug != null) act = '預估是 0，建議填預估';
      var why = '';
      if (basis) {
        var bt = { same: '同品號', name: '同名品項（去掉「袋」字）', group: '同規格群組' }[basis];
        why = bt + '去年同期已賣 ' + X.fmt(A) + '、全期 ' + X.fmt(B) + '（賣到這天約 ' + Math.round(f * 100) + '%）；今年' + (basis === 'same' ? '' : '同類合計') + '同期 ' + X.fmt(setSold) + (growth != null ? '（' + (growth >= 0 ? '+' : '') + Math.round(growth * 1000) / 10 + '%）' : '') +
          (sug != null ? '；照這個節奏全期約 ' + X.fmt(sug) + (est > 0 ? '，預估 ' + X.fmt(est) : '') : '；今年還沒有銷售，推不出全期');
      } else why = '去年沒有可比的銷售（今年新品，或去年全期不到 ' + GA_MIN + '），沒辦法判斷。';
      return { p: p, est: est, sold: C, remain: est - C, A: A, B: B, f: f, basis: basis, isNew: isNew, setSold: setSold, growth: growth, sug: sug, conf: conf, trend: trend, act: act, why: why, lastFull: own, lastTo: lastTo[id] || 0 };
    });
    rows.sort(function (a, b) { return (b.est - a.est) || byCode(a.p, b.p); });
    // 整體：只看「同品號」可比的禮盒，今年同期合計 vs 去年同期合計
    var cmp = rows.filter(function (r) { return r.basis === 'same'; }), cs = cmp.reduce(function (t, r) { return t + r.sold; }, 0), cl = cmp.reduce(function (t, r) { return t + r.A; }, 0);
    res.rows = rows;
    res.total = { est: rows.reduce(function (t, r) { return t + r.est; }, 0), sold: rows.reduce(function (t, r) { return t + r.sold; }, 0), cmpSold: cs, cmpLast: cl, cmpN: cmp.length, newN: rows.filter(function (r) { return r.isNew; }).length,
      growth: cl > 0 ? cs / cl - 1 : null, up: rows.filter(function (r) { return r.act === '建議上調'; }).length, down: rows.filter(function (r) { return r.act === '建議下修'; }).length };
    return res;
  };

  X.salesTools = { classifyOrders: classifyOrders, salesCtx: salesCtx, inPeriod: inPeriod };
  X.registerPage({
    id: 'xSalesDash', group: 'season', order: 30, hidden: true, title: '業績儀表板', sub: '今年和去年同檔期的訂單數量比較（全公司）', stage: 'ready',
    icon: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5a9 9 0 0 1 5.5 5.5H15z"/>',
    render: function (el) { renderSalesDash(el); },
    _fn: { classifyOrders: classifyOrders, salesCtx: salesCtx, sumPeriod: sumPeriod, yearsOf: yearsOf, state: sd }
  });
})(window.CMSX);

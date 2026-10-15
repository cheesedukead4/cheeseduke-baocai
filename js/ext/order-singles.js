/*
 * 過去訂單紀錄 →「換算成單條」分頁
 * 把過去訂單的禮盒依「禮盒資料」的單條內容物拆成單條（例：1 盒 CO-43 鳳費5入 = 5 條鳳費），
 * 單賣的單條直接計算，用來看各檔期、各部門實際賣了幾條，做為預估的依據。
 * 只讀資料、不修改原本的訂單。品號對照沿用「對照設定」（codeMap），部門對照沿用 deptMap。
 */
(function (X) {
  'use strict';
  if (!X) return;
  var esc = X.esc;
  var KIND = { newyear: '過年', midautumn: '中秋', other: '其他月份' };
  var KIND_ORDER = { newyear: 1, midautumn: 2, other: 3 };
  var state = { tab: 'detail', season: '' };

  function norm(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, '').toUpperCase(); }
  function isSingle(p) { return String((p && p.category) || '').trim() === '單條'; }
  function singleLabel(p) { return (p.code ? p.code + ' ' : '') + p.name; }

  // ---------- 換算規則 ----------
  function buildResolver() {
    var prods = X.products().filter(function (p) { return p && typeof p === 'object'; });
    var byId = {}, byCode = {}, singleByName = {}, comps = {};
    prods.forEach(function (p) {
      byId[String(p.id)] = p;
      var c = norm(p.code);
      if (c && !byCode[c]) byCode[c] = p;
      if (isSingle(p)) { var n = norm(p.name); if (n && !singleByName[n]) singleByName[n] = p; }
    });
    X.components().forEach(function (c) {
      if (!c || !byId[String(c.componentProductId)]) return;
      (comps[String(c.productId)] = comps[String(c.productId)] || []).push({ single: byId[String(c.componentProductId)], qty: X.num(c.qty) });
    });
    var cmap = {};
    X.get('codeMap').forEach(function (m) { if (m && m.orderCode != null) { var k = norm(m.orderCode); if (k && !cmap[k]) cmap[k] = m; } });

    return function resolve(r) {
      var code = norm(r.productCode), p = null, manual = cmap[code];
      if (manual) {
        if (manual.kind === 'ignore') return { type: 'ignore' };
        p = byId[String(manual.productId)];
        if (!p) return { type: 'unmapped' };
      } else {
        p = byCode[code];
        if (!p) return { type: 'unmapped' };
      }
      if (isSingle(p)) return { type: 'single', product: p, parts: [{ single: p, qty: 1 }] };
      var list = comps[String(p.id)];
      if (list && list.length) return { type: 'gift', product: p, parts: list };
      // 沒有單條內容物、但名稱和某個單條一樣（例如 CO-46 巧費）→ 當作那個單條（可在「計算規則」關閉）
      var same = (!window.CMSRules || CMSRules.get('singlesSameName')) ? singleByName[norm(p.name)] : null;
      if (same) return { type: 'asSingle', product: p, parts: [{ single: same, qty: 1 }] };
      return { type: 'noComp', product: p };
    };
  }

  function buildDeptResolver() {
    var map = { channel: {}, orderDepartment: {} };
    X.get('deptMap').forEach(function (m) {
      if (!m || !map[m.field] || !m.dept) return;
      var k = String(m.value == null ? '' : m.value).trim();
      if (!(k in map[m.field])) map[m.field][k] = m.dept;
    });
    return function (r) {
      var od = String(r.orderDepartment || '').trim(), ch = String(r.channel || '').trim();
      // 預設先看接單部門、再看通路（順序見「計算規則」）
      var d = window.CMSRules ? CMSRules.resolveDept({ orderDepartment: od, channel: ch }, map)
        : ((od && map.orderDepartment[od]) || (ch && map.channel[ch]) || (!od && map.orderDepartment[''] ) || (!ch && map.channel['']));
      if (d === 'none') return null;
      if (d) return X.deptLabel(d);
      return od || ch || '（空白）';
    };
  }

  function seasonKey(r) {
    var y = String(r.date || '').slice(0, 4);
    if (!/^\d{4}$/.test(y)) return '';
    var k = X.orderSeasonKind(r);
    if (window.CMSRules) y = CMSRules.seasonYear(r.date, k); // 過年檔期的 7～12 月預購算隔年
    return y + '|' + k;
  }
  function seasonLabel(k) { if (k === 'all') return '全部'; var a = k.split('|'); return a[0] + ' ' + (KIND[a[1]] || a[1]); }
  function sortSeasonKeys(keys) {
    return keys.sort(function (a, b) {
      var x = a.split('|'), y = b.split('|');
      return x[0] === y[0] ? (KIND_ORDER[x[1]] || 9) - (KIND_ORDER[y[1]] || 9) : (x[0] < y[0] ? -1 : 1);
    });
  }

  // ---------- 計算 ----------
  function compute() {
    var resolve = buildResolver(), deptOf = buildDeptResolver();
    var orders = X.orders();
    var seasons = {}, singles = {}, problems = { noComp: {}, unmapped: {} }, counts = { rows: 0, gift: 0, single: 0, asSingle: 0, noComp: 0, unmapped: 0, ignore: 0 };
    var cells = []; // 每筆訂單換算後的單條：{ season, dept, sid, qty, fromGift }
    for (var i = 0; i < orders.length; i++) {
      var r = orders[i];
      if (!r || typeof r !== 'object') continue;
      counts.rows++;
      var q = X.num(r.qty);
      var res = resolve(r);
      counts[res.type]++;
      if (res.type === 'ignore') continue;
      if (res.type === 'unmapped' || res.type === 'noComp') {
        var bag = problems[res.type], key = res.type === 'noComp' ? String(res.product.id) : norm(r.productCode) || '（空白）';
        if (!bag[key]) bag[key] = { code: res.product ? res.product.code : r.productCode, name: res.product ? res.product.name : r.name, rows: 0, qty: 0 };
        bag[key].rows++; bag[key].qty += q;
        continue;
      }
      var sk = seasonKey(r), dept = deptOf(r), d = String(r.date || '').slice(0, 10);
      if (sk) {
        var rg = seasons[sk] || (seasons[sk] = { min: d, max: d });
        if (d && d < rg.min) rg.min = d;
        if (d && d > rg.max) rg.max = d;
      }
      res.parts.forEach(function (part) {
        var sid = String(part.single.id);
        singles[sid] = part.single;
        cells.push({ season: sk, dept: dept, sid: sid, qty: q * part.qty, fromGift: res.type === 'gift' });
      });
    }
    return { counts: counts, cells: cells, singles: singles, seasonKeys: sortSeasonKeys(Object.keys(seasons)), ranges: seasons, problems: problems };
  }

  function sumBy(cells, season, fn) {
    var out = {};
    cells.forEach(function (c) {
      if (season !== 'all' && c.season !== season) return;
      fn(out, c);
    });
    return out;
  }

  // ---------- 畫面 ----------
  function renderSingles(box) {
    if (!X.db()) return;
    var t0 = Date.now(), data = compute();
    var keys = data.seasonKeys;
    if (!state.season || (state.season !== 'all' && keys.indexOf(state.season) < 0)) state.season = keys.length ? keys[keys.length - 1] : 'all';
    var sel = state.season;

    // 依單條
    var bySingle = sumBy(data.cells, sel, function (o, c) {
      var x = o[c.sid] || (o[c.sid] = { total: 0, gift: 0, direct: 0 });
      x.total += c.qty; if (c.fromGift) x.gift += c.qty; else x.direct += c.qty;
    });
    var grand = 0; Object.keys(bySingle).forEach(function (k) { grand += bySingle[k].total; });
    var singleRows = Object.keys(bySingle).map(function (sid) { return Object.assign({ sid: sid, single: data.singles[sid] }, bySingle[sid]); })
      .sort(function (a, b) { return b.total - a.total; });

    // 各檔期比較
    var bySeason = {};
    data.cells.forEach(function (c) { if (!c.season) return; var k = c.sid + '#' + c.season; bySeason[k] = (bySeason[k] || 0) + c.qty; });
    var allSids = Object.keys(data.singles).sort(function (a, b) {
      var ta = 0, tb = 0; keys.forEach(function (k) { ta += bySeason[a + '#' + k] || 0; tb += bySeason[b + '#' + k] || 0; }); return tb - ta;
    });

    // 依部門
    var byDept = sumBy(data.cells, sel, function (o, c) { var d = o[c.dept] || (o[c.dept] = { total: 0 }); d.total += c.qty; d[c.sid] = (d[c.sid] || 0) + c.qty; });
    var deptRows = Object.keys(byDept).map(function (d) { return Object.assign({ dept: d }, byDept[d]); }).sort(function (a, b) { return b.total - a.total; });
    var topSids = singleRows.map(function (r) { return r.sid; });

    var c = data.counts, converted = c.gift + c.single + c.asSingle;
    var html = '<p class="small" style="margin:0 0 12px">把禮盒依「禮盒資料」的單條內容物拆成單條（例：1 盒 鳳費5入 = 5 條鳳費），單賣的單條直接計算。只是換算顯示，不會修改原本的訂單。</p>';
    html += '<div class="toolbar" style="align-items:center"><label class="small" style="font-weight:700">檔期 ' +
      '<select data-act="season" style="min-height:40px;margin-left:6px;border:1px solid var(--line-strong);border-radius:8px;padding:6px 10px;font:inherit">' +
      keys.slice().reverse().concat(['all']).map(function (k) { return '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(seasonLabel(k)) + '</option>'; }).join('') +
      '</select></label><span class="small">' + esc(window.CMSRules ? CMSRules.seasonRuleText() : '過年＝1～2 月、中秋＝8～10 月') + '（可在「計算規則」修改）</span></div>';
    html += X.ui.kpis([
      { label: '換算後單條總數', value: X.fmt(grand) + ' 條', tone: 'info', sub: seasonLabel(sel) },
      { label: '可換算的訂單', value: c.rows ? Math.round(converted / c.rows * 1000) / 10 + '%' : '—', tone: (c.noComp + c.unmapped) ? 'warn' : 'ok', sub: X.fmt(converted) + ' / ' + X.fmt(c.rows) + ' 筆（全部檔期）' },
      { label: '無法換算', value: X.fmt(c.noComp + c.unmapped) + ' 筆', tone: (c.noComp + c.unmapped) ? 'bad' : 'ok', sub: '沒有單條內容物 ' + c.noComp + '、品號對不到 ' + c.unmapped }
    ]);

    html += X.ui.card('各單條條數（' + seasonLabel(sel) + '）', X.ui.table([
      { label: '單條', render: function (r) { return esc(singleLabel(r.single)); } },
      { label: '總條數', num: true, render: function (r) { return '<b>' + X.fmt(r.total) + '</b>'; } },
      { label: '來自禮盒', num: true, render: function (r) { return X.fmt(r.gift); } },
      { label: '單條直接賣', num: true, render: function (r) { return X.fmt(r.direct); } },
      { label: '佔比', num: true, render: function (r) { return grand ? Math.round(r.total / grand * 1000) / 10 + '%' : '—'; } }
    ], singleRows, { empty: '這個檔期沒有可以換算的訂單' }));

    var cmpCols = [{ label: '單條', render: function (sid) { return esc(singleLabel(data.singles[sid])); } }].concat(keys.map(function (k) {
      var rg = data.ranges[k], md = function (x) { return x ? x.slice(5).replace('-', '/') : ''; };
      return { label: seasonLabel(k) + (rg ? '（' + md(rg.min) + '～' + md(rg.max) + '）' : ''), num: true, render: function (sid) { var v = bySeason[sid + '#' + k] || 0; return v ? X.fmt(v) : '<span class="small">0</span>'; } };
    }));
    if (keys.length >= 2) {
      var last = keys[keys.length - 1], prevSame = null, lk = last.split('|')[1];
      for (var i = keys.length - 2; i >= 0; i--) { if (keys[i].split('|')[1] === lk) { prevSame = keys[i]; break; } }
      if (prevSame) cmpCols.push({ label: seasonLabel(last) + ' 比 ' + seasonLabel(prevSame), num: true, render: function (sid) {
        var a = bySeason[sid + '#' + last] || 0, b = bySeason[sid + '#' + prevSame] || 0;
        if (!b) return '<span class="small">—</span>';
        var p = Math.round((a - b) / b * 1000) / 10;
        return '<span style="color:' + (p >= 0 ? 'var(--ok)' : 'var(--bad)') + ';font-weight:700">' + (p >= 0 ? '+' : '') + p + '%</span>';
      } });
    }
    html += X.ui.card('各檔期比較（預估參考）', X.ui.table(cmpCols, allSids, { empty: '沒有資料' }) +
      '<p class="small" style="margin:10px 0 0">欄位標題括號內是該檔期實際有訂單資料的日期範圍；範圍明顯不完整的檔期（例如系統裡的訂單從 2025 年 10 月才開始），比較時請留意。可以拿去年同一個檔期的條數，乘上預期成長率，當作今年各口味的生產預估。</p>',
      '<button type="button" class="btn gray" data-act="csv">下載 CSV（Excel 可開）</button>');

    html += X.ui.card('依接單部門（' + seasonLabel(sel) + '）', X.ui.table([{ label: '部門', render: function (r) { return esc(r.dept); } }].concat(topSids.map(function (sid) {
      return { label: data.singles[sid].name, num: true, render: function (r) { return r[sid] ? X.fmt(r[sid]) : '<span class="small">0</span>'; } };
    })).concat([{ label: '合計', num: true, render: function (r) { return '<b>' + X.fmt(r.total) + '</b>'; } }]), deptRows, { empty: '沒有資料' }) +
      '<p class="small" style="margin:10px 0 0">' + (window.CMSRules && CMSRules.get('deptPriority') === 'channel' ? '部門先看「通路」' : '部門先看「接單部門」') +
      '；在「對照設定」把接單部門或通路對到 8 個部門後，這裡會合併顯示。</p>');

    var noComp = Object.keys(data.problems.noComp).map(function (k) { return data.problems.noComp[k]; });
    var unmapped = Object.keys(data.problems.unmapped).map(function (k) { return data.problems.unmapped[k]; });
    if (noComp.length || unmapped.length) {
      var probCols = [
        { label: '品號', render: function (x) { return esc(x.code || '（空白）'); } },
        { label: '品名', render: function (x) { return esc(x.name || ''); } },
        { label: '筆數', num: true, render: function (x) { return X.fmt(x.rows); } },
        { label: '盒數', num: true, render: function (x) { return X.fmt(x.qty); } }
      ];
      if (noComp.length) html += X.ui.card('沒有單條內容物的禮盒（無法換算）', X.ui.table(probCols, noComp) +
        '<p class="small" style="margin:10px 0 0">請到「禮盒資料」替這些禮盒加上單條內容物，或在「對照設定」把品號對到單條。</p>',
        '<button type="button" class="btn gray" data-act="go" data-page="products">前往禮盒資料</button>');
      if (unmapped.length) html += X.ui.card('品號對不到（無法換算）', X.ui.table(probCols, unmapped),
        '<button type="button" class="btn gray" data-act="go" data-page="xMapping">前往對照設定</button>');
    }
    if (c.asSingle) html += '<p class="small" style="margin:0 0 6px">有 ' + X.fmt(c.asSingle) + ' 筆訂單的禮盒沒有單條內容物，但名稱和單條一樣（例如「巧費」），已直接當作那個單條計算。</p>';
    html += '<p class="small" style="margin:0">共 ' + X.fmt(c.rows) + ' 筆訂單明細，計算 ' + (Date.now() - t0) + ' 毫秒。</p>';
    box.innerHTML = html;

    box.onchange = function (e) { if (e.target.dataset.act === 'season') { state.season = e.target.value; renderSingles(box); } };
    box.onclick = function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'go') X.goPage(b.dataset.page);
      if (b.dataset.act === 'csv') downloadCsv(keys, allSids, data.singles, bySeason);
    };
  }

  function downloadCsv(keys, sids, singles, bySeason) {
    var q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [['單條編號', '單條名稱'].concat(keys.map(seasonLabel)).map(q).join(',')];
    sids.forEach(function (sid) {
      var s = singles[sid];
      lines.push([s.code || '', s.name].concat(keys.map(function (k) { return bySeason[sid + '#' + k] || 0; })).map(q).join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '過去訂單換算單條_各檔期_' + X.today() + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---------- 掛到「過去訂單紀錄」頁 ----------
  function mount() {
    var sec = document.getElementById('orderHistory');
    if (!sec || document.getElementById('ohSinglesTabs')) return;
    var detail = sec.querySelector('.panel');
    var tabs = document.createElement('div');
    tabs.className = 'x-tabs';
    tabs.id = 'ohSinglesTabs';
    tabs.innerHTML = '<button type="button" class="active" data-tab="detail">訂單明細</button><button type="button" data-tab="singles">換算成單條</button>';
    var panel = document.createElement('div');
    panel.className = 'panel';
    panel.id = 'ohSinglesPanel';
    panel.style.display = 'none';
    panel.innerHTML = '<h2>換算成單條</h2><div id="ohSinglesBody"></div>';
    sec.insertBefore(tabs, sec.firstChild);
    sec.appendChild(panel);
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (!b) return;
      state.tab = b.dataset.tab;
      tabs.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); });
      if (detail) detail.style.display = state.tab === 'detail' ? '' : 'none';
      panel.style.display = state.tab === 'singles' ? '' : 'none';
      if (state.tab === 'singles') renderSingles(document.getElementById('ohSinglesBody'));
    });
  }
  function refreshIfOpen() {
    var sec = document.getElementById('orderHistory');
    if (state.tab === 'singles' && sec && sec.classList.contains('active')) {
      var a = document.activeElement, body = document.getElementById('ohSinglesBody');
      if (body && !(a && body.contains(a) && a.tagName === 'SELECT')) renderSingles(body);
    }
  }
  // 原系統重繪（含收到同事的雲端更新）後，分頁開著就一起更新
  window.addEventListener('load', function () {
    if (typeof window.render === 'function' && !window.render.__cmsxSingles) {
      var original = window.render;
      var wrapped = function () { var r = original.apply(this, arguments); try { refreshIfOpen(); } catch (e) {} return r; };
      wrapped.__cmsxSingles = true;
      wrapped.__cmsx = original.__cmsx;
      window.render = wrapped;
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
  X.orderSingles = { compute: compute, render: renderSingles };
})(window.CMSX);

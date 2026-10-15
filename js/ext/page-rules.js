/*
 * 計算規則頁（xCalcRules，系統設定，需管理員）
 *  - 上半部：可以調整的參數（定義在 js/calc-rules.js），存在 db.calcRules；只存和預設不同的值
 *  - 下半部：系統裡每個數字怎麼算（內容在 js/ext/calc-docs.js 的 CMS_CALC_DOCS）
 *  - 每次儲存都記到 db.calcRulesLog（誰、什麼時候、改了什麼）
 * 參數改完按「儲存」才生效；儲存前會列出所有修改再確認一次。
 */
(function (X, R) {
  'use strict';
  if (!X || !R) return;

  var esc = X.esc;
  var LOG_MAX = 300;     // 修改紀錄最多保留幾筆
  var LOG_SHOW = 30;     // 頁面上顯示最近幾筆
  var GROUP_TITLES = {
    orders: '檔期歸屬與過去訂單', stock: '庫存與水位', stocktake: '盤點', daily: '每日作業（快速輸入）',
    price: '售價', sales: '業績與部門', singles: '換算成單條', season: '檔期設定', checklist: '開檔檢查'
  };
  var GROUP_ORDER = ['orders', 'stock', 'stocktake', 'daily', 'price', 'sales', 'singles', 'season', 'checklist'];

  // 畫面狀態：draft＝還沒儲存的修改（key → 值）；open＝展開的說明項目
  var st = { draft: {}, q: '', area: 'all', onlyParams: false, open: {} };

  function docs() {
    var d = window.CMS_CALC_DOCS;
    return d && Array.isArray(d.items) ? d : { areas: [], items: [] };
  }
  function hasDraft(key) { return Object.prototype.hasOwnProperty.call(st.draft, key); }
  function cur(key) { return hasDraft(key) ? st.draft[key] : R.get(key); }

  // ---------- 值的文字 ----------
  function valueText(key, v) {
    var def = R.def(key);
    if (!def) return '';
    if (def.type === 'months') return R.monthsText(v);
    if (def.type === 'bool') return v ? '開啟' : '關閉';
    if (def.type === 'select') { var o = def.options.find(function (x) { return x.value === v; }); return o ? o.label : String(v); }
    if (def.type === 'number') {
      var n = Number(v);
      if (v === '' || v == null || !Number.isFinite(n)) return '（未填）';
      return X.fmt(n, 2) + (def.unit ? (def.unit === '%' ? '%' : ' ' + def.unit) : '');
    }
    if (def.type === 'levels') {
      var keys = Object.keys(v || {});
      if (!keys.length) return '全部照原本';
      return keys.map(function (k) {
        var c = R.CHECKS.find(function (x) { return x.key === k; });
        var o = R.LEVEL_OPTIONS.find(function (x) { return x.value === v[k]; });
        return (c ? c.title : k) + '：' + (o ? o.label : v[k]);
      }).join('、');
    }
    return String(v);
  }
  // 說明文字裡的 {{參數代號}} 換成目前的值（有還沒儲存的修改時顯示修改後的值）
  function fill(text) {
    return esc(text).replace(/\{\{(\w+)\}\}/g, function (all, k) {
      return R.def(k) ? '<span class="xr-val">' + esc(valueText(k, cur(k))) + '</span>' : all;
    });
  }
  // 依目前設定挑出要顯示的步驟：{ text, rule, is }，有 rule 時只在設定值等於 is 才顯示
  function stepShown(s) {
    if (typeof s === 'string') return true;
    if (!s || !s.rule || !R.def(s.rule)) return true;
    var v = cur(s.rule);
    return String(v) === String(s.is);
  }
  function stepText(s) { return typeof s === 'string' ? s : (s && s.text) || ''; }

  // ---------- 參數編輯 ----------
  function paramHtml(def) {
    var key = def.key, v = cur(key), changed = !R.same(v, R.get(key)), notDefault = !R.same(v, def.default);
    var input = '';
    if (def.type === 'months') {
      input = '<div class="xr-months" role="group" aria-label="' + esc(def.label) + '">' +
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (m) {
          var on = Array.isArray(v) && v.indexOf(m) >= 0;
          return '<label class="' + (on ? 'on' : '') + '"><input type="checkbox" data-rk="' + key + '" data-m="' + m + '"' + (on ? ' checked' : '') + '>' + m + ' 月</label>';
        }).join('') + '</div>';
    } else if (def.type === 'bool') {
      input = '<div class="xr-input"><select data-rk="' + key + '" aria-label="' + esc(def.label) + '">' +
        '<option value="1"' + (v ? ' selected' : '') + '>開啟</option><option value="0"' + (!v ? ' selected' : '') + '>關閉</option></select></div>';
    } else if (def.type === 'select') {
      input = '<div class="xr-input"><select data-rk="' + key + '" aria-label="' + esc(def.label) + '">' +
        def.options.map(function (o) { return '<option value="' + esc(o.value) + '"' + (o.value === v ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select></div>';
    } else if (def.type === 'number') {
      var bad = hasDraft(key) && R.normalize(def, v) === undefined;
      input = '<div class="xr-input"><input type="number" inputmode="decimal" data-rk="' + key + '" value="' + esc(v) + '" min="' + def.min + '" max="' + def.max + '" step="' + (def.step || 1) + '" aria-label="' + esc(def.label) + '">' +
        (def.unit ? '<span>' + esc(def.unit) + '</span>' : '') +
        (bad ? '<span class="xr-err">請填 ' + X.fmt(def.min, 2) + '～' + X.fmt(def.max, 2) + (def.integer ? ' 的整數' : '') + '</span>' : '') + '</div>';
    } else if (def.type === 'levels') {
      input = '<div class="tablewrap"><table class="x-table"><thead><tr><th>檢查項目</th><th>原本的燈號</th><th>設定</th></tr></thead><tbody>' +
        R.CHECKS.map(function (c) {
          var lv = (v && v[c.key]) || 'default';
          return '<tr><td>' + esc(c.title) + '</td><td class="small">' + esc(c.def) + '</td><td><select data-rk="' + key + '" data-ck="' + c.key + '" aria-label="' + esc(c.title) + '的燈號" style="min-height:38px;border:1px solid var(--line-strong);border-radius:8px;padding:4px 8px;font:inherit">' +
            R.LEVEL_OPTIONS.map(function (o) { return '<option value="' + o.value + '"' + (o.value === lv ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    return '<div class="xr-param' + (changed ? ' xr-changed' : '') + '" id="xr-p-' + key + '">' +
      '<div class="xr-param-head"><b>' + esc(def.label) + '</b><span>' +
      (changed ? X.ui.tag('已修改，還沒儲存', 'info') + ' ' : '') +
      (notDefault ? X.ui.tag('和預設不同', 'warn') + ' <button type="button" class="btn gray" data-act="reset" data-rk="' + key + '" style="min-height:32px;padding:4px 10px">恢復預設</button>' : X.ui.tag('預設', 'muted')) +
      '</span></div>' +
      '<div class="xr-help">' + esc(def.help) + (notDefault ? '<br>預設：' + esc(valueText(key, def.default)) : '') + '</div>' +
      (R.isInvalid(key) && !hasDraft(key) ? '<div class="xr-err" style="margin:0 0 8px">雲端上的設定和另一項衝突（例如兩人同時改了過年和中秋的月份，月份重複），目前暫時用預設值。請重新設定後按「儲存」。</div>' : '') +
      input +
      '<div class="xr-uses">影響：' + esc((def.uses || []).join('、')) + '</div></div>';
  }

  function paramsCard() {
    var html = '';
    GROUP_ORDER.forEach(function (g) {
      var defs = R.DEFS.filter(function (d) { return d.group === g; });
      if (!defs.length) return;
      html += '<div class="xr-group-title">' + esc(GROUP_TITLES[g] || g) + '</div>' + defs.map(paramHtml).join('');
    });
    var changedN = R.DEFS.filter(function (d) { return !R.isDefault(d.key); }).length;
    return X.ui.card('可以調整的參數', '<p class="small" style="margin:0 0 6px">改完按下方「儲存」才會生效，儲存後會同步給所有人。灰色「預設」表示和系統原本的做法一樣。</p>' + html,
      changedN ? '<button type="button" class="btn gray" data-act="reset-all" style="min-height:38px">全部恢復預設</button>' : '');
  }

  // ---------- 算法說明 ----------
  function entryText(it) {
    return [it.title, it.where].concat((it.steps || []).map(stepText), it.notes || []).join(' ').toLowerCase();
  }
  function entryHtml(it) {
    var steps = (it.steps || []).filter(stepShown);
    var params = (it.params || []).filter(function (k) { return R.def(k); });
    var open = !!st.open[it.id] || !!st.q;
    return '<details class="xr-entry" data-id="' + esc(it.id) + '"' + (open ? ' open' : '') + '><summary><b>' + esc(it.title) + '</b>' +
      (params.length ? X.ui.tag('可調整', 'info') : '') + (it.where ? '<span>' + esc(it.where) + '</span>' : '') + '</summary>' +
      '<div class="xr-body">' +
      (steps.length ? '<ol>' + steps.map(function (s) { return '<li>' + fill(stepText(s)) + '</li>'; }).join('') + '</ol>' : '') +
      (params.length ? '<div class="small" style="font-weight:700">用到的參數（按一下可修改）</div><div class="xr-chiprow">' + params.map(function (k) {
        return '<button type="button" class="xr-chip" data-act="goparam" data-rk="' + k + '">' + esc(R.def(k).label) + '：' + esc(valueText(k, cur(k))) + '</button>';
      }).join('') + '</div>' : '') +
      ((it.notes || []).length ? '<div class="xr-notes"><b>要注意</b><ul>' + it.notes.map(function (n) { return '<li>' + fill(n) + '</li>'; }).join('') + '</ul></div>' : '') +
      (it.code ? '<div class="xr-code">程式位置：' + esc(it.code) + '</div>' : '') +
      '</div></details>';
  }
  function docsCards() {
    var d = docs(), q = st.q.trim().toLowerCase();
    var items = d.items.filter(function (it) {
      if (st.area !== 'all' && it.area !== st.area) return false;
      if (st.onlyParams && !(it.params || []).some(function (k) { return R.def(k); })) return false;
      if (q && entryText(it).indexOf(q) < 0) return false;
      return true;
    });
    if (!d.items.length) return X.ui.card('各項數字怎麼算', X.ui.empty('說明內容還沒載入。'));
    if (!items.length) return X.ui.card('各項數字怎麼算', X.ui.empty('找不到符合的算法，換個關鍵字試試。'));
    return d.areas.map(function (a) {
      var list = items.filter(function (it) { return it.area === a.key; });
      if (!list.length) return '';
      return X.ui.card(a.title + '（' + list.length + ' 項）', (a.intro ? '<p class="small" style="margin:0 0 6px">' + esc(a.intro) + '</p>' : '') + list.map(entryHtml).join(''));
    }).join('');
  }

  // ---------- 修改紀錄 ----------
  function logCard() {
    var log = X.get('calcRulesLog').filter(function (x) { return x && typeof x === 'object'; })
      .slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); }).slice(0, LOG_SHOW);
    var cols = [
      { label: '時間', render: function (x) { return esc(X.fmtTime(x.at)); } },
      { label: '修改者', render: function (x) { return esc(x.by); } },
      { label: '參數', render: function (x) { return esc(x.label || x.key); } },
      { label: '原本', render: function (x) { return esc(x.from); } },
      { label: '改成', render: function (x) { return '<b>' + esc(x.to) + '</b>'; } }
    ];
    return X.ui.card('修改紀錄', X.ui.table(cols, log, { empty: '還沒有人修改過計算規則。' }) +
      '<p class="small" style="margin:8px 0 0">顯示最近 ' + LOG_SHOW + ' 筆。</p>');
  }

  // ---------- 畫面 ----------
  function render(el) {
    var d = docs();
    var draftN = Object.keys(st.draft).length;
    var changedN = R.DEFS.filter(function (x) { return !R.isDefault(x.key); }).length;
    var last = X.get('calcRulesLog').reduce(function (m, x) { return x && (x.at || 0) > ((m && m.at) || 0) ? x : m; }, null);
    var html = X.ui.banner('info', '這一頁說明系統裡每個數字怎麼算。上方的參數可以直接修改，按「儲存」後會同步給所有人；不確定時可以按「恢復預設」回到原本的做法。' +
      '如果要改的是算法本身（不只是參數），請告訴負責維護系統的人。');
    html += X.ui.kpis([
      { label: '算法說明', value: d.items.length + ' 項', tone: 'info' },
      { label: '可調整參數', value: R.DEFS.length + ' 個', tone: 'muted' },
      { label: '和預設不同', value: changedN + ' 個', tone: changedN ? 'warn' : 'ok', sub: last ? '最後修改：' + (last.by || '') + ' ' + X.fmtTime(last.at) : '都是系統原本的做法' }
    ]);
    html += paramsCard();
    if (draftN) {
      html += '<div class="xr-savebar"><b>有 ' + draftN + ' 個參數修改還沒儲存</b>' +
        '<button type="button" class="btn gray" data-act="discard" style="min-height:42px">放棄修改</button>' +
        '<button type="button" class="btn primary" data-act="save" style="min-height:42px;min-width:120px;justify-content:center;font-weight:800">儲存</button></div>';
    }
    html += '<div class="toolbar" style="align-items:center;margin:18px 0 10px">' +
      '<input type="search" data-act="q" value="' + esc(st.q) + '" placeholder="搜尋：例如 盤點、水位、售價、單條" aria-label="搜尋算法" style="flex:1;min-width:180px;min-height:42px;border:1px solid var(--line-strong);border-radius:8px;padding:6px 12px;font:inherit;box-sizing:border-box">' +
      '<select data-act="area" aria-label="分類" style="min-height:42px;border:1px solid var(--line-strong);border-radius:8px;padding:6px 10px;font:inherit">' +
      [{ key: 'all', title: '全部分類' }].concat(d.areas).map(function (a) { return '<option value="' + esc(a.key) + '"' + (a.key === st.area ? ' selected' : '') + '>' + esc(a.title) + '</option>'; }).join('') + '</select>' +
      '<label class="small" style="display:inline-flex;gap:6px;align-items:center;font-weight:700"><input type="checkbox" data-act="only"' + (st.onlyParams ? ' checked' : '') + '>只看有可調整參數的</label></div>';
    html += '<div data-box="docs">' + docsCards() + '</div>';
    html += logCard();
    el.innerHTML = html;
    bind(el);
  }

  function rerenderDocs(el) {
    var box = el.querySelector('[data-box="docs"]');
    if (box) box.innerHTML = docsCards();
  }

  function setDraft(key, v) {
    if (R.same(v, R.get(key))) delete st.draft[key]; else st.draft[key] = v;
  }

  function bind(el) {
    el.onclick = function (e) {
      var a = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!a) return;
      var act = a.dataset.act, key = a.dataset.rk;
      if (act === 'reset' && key) { setDraft(key, JSON.parse(JSON.stringify(R.def(key).default))); render(el); }
      else if (act === 'reset-all') {
        R.DEFS.forEach(function (d) { setDraft(d.key, JSON.parse(JSON.stringify(d.default))); });
        render(el);
      }
      else if (act === 'discard') { st.draft = {}; render(el); }
      else if (act === 'save') save(el);
      else if (act === 'goparam' && key) {
        var p = document.getElementById('xr-p-' + key);
        if (p) { p.scrollIntoView({ behavior: 'smooth', block: 'center' }); p.classList.add('xr-flash'); setTimeout(function () { p.classList.remove('xr-flash'); }, 1600); }
      }
    };
    el.onchange = function (e) {
      var t = e.target;
      if (!t || !t.dataset) return;
      var act = t.dataset.act;
      if (act === 'area') { st.area = t.value; rerenderDocs(el); return; }
      if (act === 'only') { st.onlyParams = t.checked; rerenderDocs(el); return; }
      var key = t.dataset.rk, def = key && R.def(key);
      if (!def) return;
      var v;
      if (def.type === 'months') {
        v = (cur(key) || []).slice();
        var m = Number(t.dataset.m), i = v.indexOf(m);
        if (t.checked && i < 0) v.push(m);
        if (!t.checked && i >= 0) v.splice(i, 1);
        v.sort(function (a, b) { return a - b; });
      } else if (def.type === 'bool') v = t.value === '1';
      else if (def.type === 'select') v = t.value;
      else if (def.type === 'number') { var n = t.value === '' ? '' : Number(t.value); v = (n === '' || !Number.isFinite(n)) ? t.value : n; }
      else if (def.type === 'levels') {
        v = JSON.parse(JSON.stringify(cur(key) || {}));
        if (t.value === 'default') delete v[t.dataset.ck]; else v[t.dataset.ck] = t.value;
        v = R.normalize(def, v) || {}; // 照檢查項目的順序重建，改回原樣時才會被認出「沒修改」
      }
      setDraft(key, v);
      render(el);
      var again = el.querySelector('[data-rk="' + key + '"]' + (t.dataset.m ? '[data-m="' + t.dataset.m + '"]' : '') + (t.dataset.ck ? '[data-ck="' + t.dataset.ck + '"]' : ''));
      if (again && again.focus) try { again.focus({ preventScroll: true }); } catch (err) {}
    };
    el.oninput = function (e) {
      var t = e.target;
      if (t && t.dataset && t.dataset.act === 'q') { st.q = t.value; rerenderDocs(el); }
    };
    // 記住哪些說明是展開的，重畫後維持（toggle 事件不會冒泡，要用捕捉；同一個容器只綁一次）
    if (!el.__xrToggle) {
      el.__xrToggle = true;
      el.addEventListener('toggle', function (e) {
        var dt = e.target;
        if (dt && dt.classList && dt.classList.contains('xr-entry') && !st.q) {
          if (dt.open) st.open[dt.dataset.id] = true; else delete st.open[dt.dataset.id];
        }
      }, true);
    }
  }

  // ---------- 儲存 ----------
  function save(el) {
    var keys = Object.keys(st.draft);
    if (!keys.length) return;
    // 雲端上和另一項衝突、暫時退回預設的值（例如兩人同時改過年、中秋月份），趁這次儲存一起清掉
    R.DEFS.forEach(function (d) {
      if (keys.indexOf(d.key) < 0 && R.isInvalid(d.key)) { st.draft[d.key] = R.get(d.key); keys.push(d.key); }
    });
    var errs = [], next = {};
    keys.forEach(function (k) {
      var def = R.def(k), v = R.normalize(def, st.draft[k]);
      if (v === undefined) {
        if (def.type === 'months') errs.push('「' + def.label + '」至少要勾一個月份。');
        else if (def.type === 'number') errs.push('「' + def.label + '」請填 ' + X.fmt(def.min, 2) + '～' + X.fmt(def.max, 2) + (def.integer ? ' 的整數' : '') + '。');
        else errs.push('「' + def.label + '」的設定不正確。');
      } else next[k] = v;
    });
    var ny = next.seasonMonthsNewYear || R.get('seasonMonthsNewYear');
    var ma = next.seasonMonthsMidAutumn || R.get('seasonMonthsMidAutumn');
    var both = ny.filter(function (m) { return ma.indexOf(m) >= 0; });
    if (both.length) errs.push('過年和中秋不能包含同一個月份（重複：' + both.join('、') + ' 月）。');
    if (errs.length) { alert('還不能儲存：\n' + errs.join('\n')); return; }

    // 先算好每一項的「原本」（寫入時過年、中秋會互相影響重複檢查，不能邊寫邊算）
    var fromText = {};
    keys.forEach(function (k) { fromText[k] = valueText(k, R.get(k)); });
    var lines = keys.map(function (k) { return '・' + R.def(k).label + '：' + fromText[k] + ' → ' + valueText(k, next[k]); });
    if (!confirm('要儲存這些修改嗎？\n\n' + lines.join('\n') + '\n\n儲存後會同步給所有人，相關頁面的數字會跟著改變。')) return;

    var rules, log;
    try { rules = X.ensure('calcRules'); log = X.ensure('calcRulesLog'); }
    catch (e) { alert('還不能儲存：' + e.message); return; }
    var at = Date.now(), by = X.userName();
    keys.forEach(function (k) {
      var def = R.def(k);
      // 只存和預設不同的值；改回預設就刪掉，之後預設值調整時也會跟著變
      if (R.same(next[k], def.default)) delete rules[k]; else rules[k] = next[k];
      if (fromText[k] !== valueText(k, next[k])) log.push({ id: X.uid('cr'), at: at, by: by, key: k, label: def.label, from: fromText[k], to: valueText(k, next[k]) });
    });
    if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
    st.draft = {};
    if (!X.save({ silent: true })) return;
    // 原系統的畫面（首頁、過去訂單、業績預估）也重畫，讓新的規則立刻生效
    try { if (typeof window.render === 'function') window.render(); } catch (e) { console.error(e); }
    render(el);
    X.toast('計算規則已儲存，會同步給所有人');
  }

  X.registerPage({
    id: 'xCalcRules', group: 'system', order: 5, stage: 'ready',
    title: '計算規則', sub: '所有數字怎麼算，以及可以調整的參數',
    icon: '<path d="M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 7h8"/><path d="M8 11h2M12 11h2M16 11h0"/><path d="M8 15h2M12 15h2"/><path d="M16 14v4"/>',
    render: render
  });
})(window.CMSX, window.CMSRules);

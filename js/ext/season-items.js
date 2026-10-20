/*
 * 檔期的品項清單與各檔期配方（CMSX.seasonItems）
 * ---------------------------------------------------------------
 * 每個檔期有自己的「品項清單」（這個檔期開了哪些禮盒、單條）和「配方」（同一個品號，過年和中秋的包材可以不同）。
 *
 * 資料：
 *   db.seasons[i].items       = [品項 id]        這個檔期的品項清單
 *   db.seasonRecipes[檔期id]  = [{ id, productId, materialId, qty }]   這個檔期的包材配方
 *
 * 「進行中」的檔期用的是原系統現有的資料，所以首頁、待裝盒、開檔檢查等原本的計算完全不用改：
 *   - 進行中檔期的品項清單 ＝ 禮盒資料／單條資料裡勾「本期上架」的品項（isListedCurrent）
 *   - 進行中檔期的配方     ＝ db.recipes
 * 把另一個檔期「設為進行中」時：先把目前的上架清單與配方存回原本進行中的檔期，
 * 再把新檔期的清單與配方放進 isListedCurrent 與 db.recipes。其他（非進行中）的檔期存的是自己的一份，在這裡編輯。
 */
(function (X, root) {
  'use strict';
  if (!X) return;

  var esc = X.esc;
  var KIND_NAME = { newyear: '過年', midautumn: '中秋' };
  // 節日日期（過年填除夕、中秋填中秋當天）：自動建立過去檔期時用，建立後可到檔期設定修改
  var HOLIDAYS = {
    newyear: { 2024: '2024-02-09', 2025: '2025-01-28', 2026: '2026-02-16', 2027: '2027-02-05', 2028: '2028-01-25', 2029: '2029-02-12', 2030: '2030-02-02' },
    midautumn: { 2024: '2024-09-17', 2025: '2025-10-06', 2026: '2026-09-25', 2027: '2027-09-15', 2028: '2028-10-03', 2029: '2029-09-22', 2030: '2030-09-12' }
  };

  function isSingle(p) { return String((p && p.category) || '').trim() === '單條'; }
  function byCode(a, b) {
    return String(a.code || '').localeCompare(String(b.code || ''), 'zh-TW', { numeric: true, sensitivity: 'base' }) ||
      String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW');
  }
  function activeSeason() { return X.get('seasons').find(function (s) { return s && s.status === 'active'; }) || null; }
  function isActive(s) { return !!s && s.status === 'active'; }
  function seasonById(id) { return X.get('seasons').find(function (s) { return s && s.id === id; }) || null; }
  function cloneRecipes(rows) {
    return (Array.isArray(rows) ? rows : []).filter(function (r) { return r && r.productId != null && r.materialId != null; })
      .map(function (r) { return { id: r.id || X.uid('srec'), productId: r.productId, materialId: r.materialId, qty: Number(r.qty) || 0 }; });
  }
  function rerenderLegacy() { try { if (typeof root.render === 'function') root.render(); } catch (e) {} }

  // ---------- 讀 ----------
  function listedIds() {
    return X.products().filter(function (p) { return p && p.isListedCurrent === true; }).map(function (p) { return String(p.id); });
  }
  function itemsOf(s) {
    if (!s) return [];
    return isActive(s) ? listedIds() : (Array.isArray(s.items) ? s.items.map(String) : []);
  }
  // 這個檔期的配方；還沒有自己的配方回傳 null
  function recipesOf(s) {
    if (!s) return null;
    if (isActive(s)) return cloneRecipes(X.recipes());
    var sr = X.get('seasonRecipes')[s.id];
    return Array.isArray(sr) && sr.length ? cloneRecipes(sr) : null;
  }

  // ---------- 寫 ----------
  function setFlags(ids) {
    var set = {};
    ids.forEach(function (id) { set[String(id)] = true; });
    X.products().forEach(function (p) { if (p) p.isListedCurrent = !!set[String(p.id)]; });
  }
  function saveItems(s, ids) {
    var list = X.ensure('seasons'), rec = list.find(function (x) { return x && x.id === s.id; });
    if (!rec) return false;
    ids = ids.map(String);
    rec.items = ids.slice();
    if (isActive(rec)) setFlags(ids); // 進行中：直接決定首頁上架哪些
    var ok = X.save();
    if (isActive(rec)) rerenderLegacy();
    return ok;
  }
  function saveRecipes(s, rows) {
    var list = X.get('seasons'), rec = list.find(function (x) { return x && x.id === s.id; });
    if (!rec) return false;
    var clean = cloneRecipes(rows), sr = X.ensure('seasonRecipes');
    sr[rec.id] = clean;
    if (isActive(rec)) { X.db().recipes = cloneRecipes(clean); rerenderLegacy(); }
    return X.save();
  }
  // 把 newS 設為進行中前呼叫（呼叫端再把 status 改成 active 並存檔）：交換上架清單與配方
  function activate(newS, oldS) {
    var d = X.db(), sr = X.ensure('seasonRecipes');
    if (!d) return;
    var all = X.ensure('seasons');
    var rn = all.find(function (x) { return x && x.id === newS.id; }) || newS;
    var ro = oldS ? (all.find(function (x) { return x && x.id === oldS.id; }) || oldS) : null;
    if (ro && ro.id !== rn.id) {
      ro.items = listedIds();
      sr[ro.id] = cloneRecipes(d.recipes);
    }
    if (Array.isArray(rn.items) && rn.items.length) setFlags(rn.items); else rn.items = listedIds();
    if (Array.isArray(sr[rn.id]) && sr[rn.id].length) d.recipes = cloneRecipes(sr[rn.id]); else sr[rn.id] = cloneRecipes(d.recipes);
    rerenderLegacy();
  }

  // ---------- 依過去訂單建立檔期與品項清單 ----------
  function orderGroups() {
    var T = X.salesTools;
    if (!T) return {};
    var c = T.classifyOrders(X.orders(), T.salesCtx()).list, g = {};
    c.forEach(function (o) {
      if (o.kind !== 'newyear' && o.kind !== 'midautumn') return;
      var key = o.kind + '|' + o.sy, e = g[key] || (g[key] = { kind: o.kind, sy: String(o.sy), min: o.date, max: o.date, ids: {}, qty: 0 });
      if (o.date < e.min) e.min = o.date;
      if (o.date > e.max) e.max = o.date;
      if (o.p && o.q > 0) e.ids[String(o.p.id)] = true;
      e.qty += o.q;
    });
    return g;
  }
  function findSeason(kind, year) {
    return X.get('seasons').find(function (s) { return s && s.kind === kind && String(s.holidayDate || '').slice(0, 4) === String(year); }) || null;
  }
  // 還缺檔期、或檔期還沒有品項清單的過去訂單群組
  function pendingSeed() {
    var g = orderGroups(), out = [];
    Object.keys(g).forEach(function (k) {
      var e = g[k], s = findSeason(e.kind, e.sy);
      if (!s) out.push({ g: e, why: '還沒有這個檔期' });
      else if (!isActive(s) && !(Array.isArray(s.items) && s.items.length) && Object.keys(e.ids).length) out.push({ g: e, why: '還沒有品項清單', season: s });
    });
    return out;
  }
  function seed() {
    var pend = pendingSeed(), list = X.ensure('seasons'), d = X.db(), sr = X.ensure('seasonRecipes'), made = [], filled = [], today = X.today();
    pend.forEach(function (p) {
      var e = p.g, s = p.season, ids = Object.keys(e.ids);
      if (!s) {
        var h = (HOLIDAYS[e.kind] || {})[e.sy] || '';
        s = { id: X.uid('sea'), createdAt: Date.now(), by: X.userName(), name: e.sy + (KIND_NAME[e.kind] || ''), kind: e.kind, holidayDate: h,
          startDate: e.min, endDate: e.max, status: (h && h < today) || e.max < today ? 'closed' : 'planning', compareSeasonId: '',
          note: '依過去訂單自動建立；過年的節日日期填除夕。品項清單來自這個檔期訂單賣過的品項，配方先沿用建立當時的配方。' };
        list.push(s);
        made.push(s.name);
      } else filled.push(s.name);
      s.items = ids;
      if (!(Array.isArray(sr[s.id]) && sr[s.id].length)) sr[s.id] = cloneRecipes(d.recipes);
    });
    // 進行中的檔期：還沒有清單就用目前上架的；比較用檔期沒設定的，找去年同種類
    var act = list.find(function (x) { return x && x.status === 'active'; });
    if (act) {
      if (!(Array.isArray(act.items) && act.items.length)) act.items = listedIds();
      if (!(Array.isArray(sr[act.id]) && sr[act.id].length)) sr[act.id] = cloneRecipes(d.recipes);
    }
    list.forEach(function (s) {
      if (!s || s.compareSeasonId || !DATE_OK(s.holidayDate)) return;
      var prev = findSeason(s.kind, Number(String(s.holidayDate).slice(0, 4)) - 1);
      if (prev && prev.id !== s.id) s.compareSeasonId = prev.id;
    });
    var ok = pend.length || act ? X.save() : true;
    return { ok: ok, made: made, filled: filled };
  }
  function DATE_OK(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }

  // ---------- 對話框 ----------
  function modal(html, onClick, onInput) {
    var mask = document.createElement('div');
    mask.className = 'cms-modal show x-dialog';
    mask.innerHTML = '<div class="cms-modal-box" style="width:min(760px,100%);max-height:92vh;overflow:auto">' + html + '</div>';
    document.body.appendChild(mask);
    mask.addEventListener('click', function (e) {
      if (e.target === mask) { mask.remove(); return; }
      var a = e.target.closest('[data-x]');
      if (a) onClick(a.dataset.x, a, mask, e);
    });
    if (onInput) { mask.addEventListener('input', function (e) { onInput(e, mask); }); mask.addEventListener('change', function (e) { onInput(e, mask); }); }
    return mask;
  }
  function otherSeasonOptions(s, withCount) {
    return X.get('seasons').filter(function (x) { return x && x.id !== s.id; }).map(function (x) {
      return '<option value="' + esc(x.id) + '">' + esc(x.name) + (withCount ? '（' + withCount(x) + '）' : '') + '</option>';
    }).join('');
  }

  // 品項清單
  function openItemsDialog(season, done) {
    var prods = X.products().filter(Boolean).slice().sort(byCode), set = {};
    itemsOf(season).forEach(function (id) { set[id] = true; });
    var gifts = prods.filter(function (p) { return !isSingle(p); }), singles = prods.filter(isSingle);
    function group(title, arr) {
      return '<div class="xu-group"><div class="xu-group-name">' + esc(title) + '（' + arr.length + '）</div><div class="xu-checks" style="max-height:34vh;overflow:auto">' +
        arr.map(function (p) {
          return '<label class="xu-check" data-q="' + esc((String(p.code || '') + ' ' + String(p.name || '')).toLowerCase()) + '"><input type="checkbox" data-id="' + esc(p.id) + '"' + (set[String(p.id)] ? ' checked' : '') + '> ' +
            esc(p.code || '') + ' ' + esc(p.name || '') + '</label>';
        }).join('') + '</div></div>';
    }
    var active = isActive(season);
    var html = '<div class="cms-modal-head"><h3>品項清單：' + esc(season.name) + '</h3></div>' +
      '<p class="small" style="margin:0 0 10px">勾選這個檔期開了哪些禮盒、單條。包含以前檔期用過的品項，找不到的品項請先到「禮盒資料」「單條資料」新增。' +
      (active ? '<b>這是進行中的檔期，儲存後首頁的「本期上架」會馬上跟著變。</b>' : '這個檔期不是進行中，儲存只會記下清單，等設為進行中才會換成首頁上架。') + '</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
      '<input data-f="q" placeholder="搜尋品號／品名" style="flex:1 1 180px;min-width:140px;padding:8px;border:1px solid var(--line-strong);border-radius:8px;font:inherit">' +
      '<button type="button" class="btn gray" data-x="all" style="min-height:34px;padding:4px 10px">全選目前顯示的</button>' +
      '<button type="button" class="btn gray" data-x="none" style="min-height:34px;padding:4px 10px">全部取消</button></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><span class="small">從其他檔期複製清單：</span>' +
      '<select data-f="src" style="padding:6px;border:1px solid var(--line-strong);border-radius:8px;font:inherit"><option value="">（選擇檔期）</option>' +
      otherSeasonOptions(season, function (x) { return itemsOf(x).length + ' 項'; }) + '</select>' +
      '<button type="button" class="btn gray" data-x="copy" style="min-height:34px;padding:4px 10px">複製（取代目前勾選）</button></div>' +
      '<div data-count class="small" style="margin-bottom:8px;font-weight:700"></div>' +
      group('禮盒', gifts) + group('單條', singles) +
      '<p class="small" data-err style="color:var(--bad);font-weight:700;min-height:20px;margin:8px 0 0"></p>' +
      '<div class="cms-modal-actions"><span class="spacer"></span><button type="button" class="btn gray" data-x="cancel">取消</button><button type="button" class="btn primary" data-x="save">儲存</button></div>';
    function count(mask) {
      var g = 0, s = 0;
      mask.querySelectorAll('input[data-id]:checked').forEach(function (c) { var p = prods.find(function (x) { return String(x.id) === c.dataset.id; }); if (p) { if (isSingle(p)) s++; else g++; } });
      mask.querySelector('[data-count]').textContent = '已選 ' + (g + s) + ' 項（禮盒 ' + g + '、單條 ' + s + '）';
    }
    var mask = modal(html, function (act, btn, m) {
      var boxes = m.querySelectorAll('input[data-id]');
      if (act === 'cancel') m.remove();
      else if (act === 'all') m.querySelectorAll('label[data-q]').forEach(function (l) { if (l.style.display !== 'none') l.querySelector('input').checked = true; });
      else if (act === 'none') boxes.forEach(function (c) { c.checked = false; });
      else if (act === 'copy') {
        var src = seasonById(m.querySelector('[data-f="src"]').value);
        if (!src) { m.querySelector('[data-err]').textContent = '請先選要複製的檔期。'; return; }
        var ids = {}; itemsOf(src).forEach(function (id) { ids[id] = true; });
        boxes.forEach(function (c) { c.checked = !!ids[c.dataset.id]; });
        m.querySelector('[data-err]').textContent = '';
      } else if (act === 'save') {
        var chosen = []; boxes.forEach(function (c) { if (c.checked) chosen.push(c.dataset.id); });
        if (!saveItems(season, chosen)) { m.querySelector('[data-err]').textContent = '儲存失敗，請再試一次。'; return; }
        m.remove(); X.toast('已儲存「' + season.name + '」的品項清單：' + chosen.length + ' 項'); if (done) done();
      }
      count(m);
    }, function (e, m) {
      if (e.target.dataset && e.target.dataset.f === 'q') {
        var q = e.target.value.trim().toLowerCase();
        m.querySelectorAll('label[data-q]').forEach(function (l) { l.style.display = !q || l.dataset.q.indexOf(q) >= 0 ? '' : 'none'; });
      } else count(m);
    });
    count(mask);
  }

  // 配方
  function openRecipeDialog(season, done) {
    var mats = X.materials().filter(Boolean).slice().sort(byCode);
    var inList = {}; itemsOf(season).forEach(function (id) { inList[id] = true; });
    var prods = X.products().filter(function (p) { return p && !isSingle(p); }).slice().sort(byCode);
    var shown = prods.filter(function (p) { return inList[String(p.id)]; });
    if (!shown.length) shown = prods;
    var rows = recipesOf(season), own = !!rows;
    if (!rows) rows = cloneRecipes(X.recipes());
    var pid = shown.length ? String(shown[0].id) : '';
    var active = isActive(season);
    function matOptions(sel) {
      return '<option value="">（選擇包材）</option>' + mats.map(function (m) { return '<option value="' + esc(m.id) + '"' + (String(m.id) === String(sel) ? ' selected' : '') + '>' + esc((m.code ? m.code + ' ' : '') + (m.name || '')) + '</option>'; }).join('');
    }
    function body() {
      var cnt = {}; rows.forEach(function (r) { cnt[String(r.productId)] = (cnt[String(r.productId)] || 0) + 1; });
      var sel = '<select data-f="pid" style="padding:8px;border:1px solid var(--line-strong);border-radius:8px;font:inherit;max-width:100%">' +
        shown.map(function (p) { return '<option value="' + esc(p.id) + '"' + (String(p.id) === pid ? ' selected' : '') + '>' + esc((p.code || '') + ' ' + (p.name || '') + (cnt[String(p.id)] ? '（' + cnt[String(p.id)] + ' 項包材）' : '（沒有配方）')) + '</option>'; }).join('') + '</select>';
      var mine = rows.map(function (r, i) { return { r: r, i: i }; }).filter(function (x) { return String(x.r.productId) === pid; });
      var trs = mine.map(function (x) {
        return '<tr><td><select data-f="mat" data-i="' + x.i + '" style="padding:6px;border:1px solid var(--line-strong);border-radius:8px;font:inherit;max-width:100%">' + matOptions(x.r.materialId) + '</select></td>' +
          '<td><input data-f="qty" data-i="' + x.i + '" type="number" min="0" step="any" value="' + esc(x.r.qty) + '" style="width:90px;padding:6px;border:1px solid var(--line-strong);border-radius:8px;font:inherit"></td>' +
          '<td><button type="button" class="btn red" data-x="del" data-i="' + x.i + '" style="min-height:32px;padding:2px 10px">刪除</button></td></tr>';
      }).join('');
      return '<div style="margin-bottom:10px">' + sel + '</div>' +
        '<table class="x-table" style="width:100%"><thead><tr><th>包材</th><th>每盒數量</th><th></th></tr></thead><tbody>' + (trs || '<tr><td colspan="3" class="small">這個禮盒在這個檔期還沒有配方，按下面「新增一項包材」。</td></tr>') + '</tbody></table>' +
        '<div style="margin-top:8px"><button type="button" class="btn gray" data-x="add" style="min-height:34px">＋ 新增一項包材</button></div>';
    }
    var html = '<div class="cms-modal-head"><h3>配方：' + esc(season.name) + '</h3></div>' +
      '<p class="small" style="margin:0 0 10px">同一個品號在不同檔期可以有不同的包材。' + (own ? '' : '<b>這個檔期還沒有自己的配方，下面先帶入目前的配方，儲存後才會成為這個檔期的配方。</b>') +
      (active ? '這是進行中的檔期，儲存後首頁的待裝盒等計算馬上會用這套配方。' : '這個檔期不是進行中，儲存只會記下配方，等設為進行中才會換成首頁使用的配方。') + '</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px"><span class="small">整套複製其他檔期的配方：</span>' +
      '<select data-f="src" style="padding:6px;border:1px solid var(--line-strong);border-radius:8px;font:inherit"><option value="">（選擇檔期）</option>' +
      X.get('seasons').filter(function (x) { return x && x.id !== season.id && recipesOf(x); }).map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="btn gray" data-x="copy" style="min-height:34px;padding:4px 10px">複製（取代這個檔期全部配方）</button></div>' +
      '<div data-body>' + body() + '</div>' +
      '<p class="small" data-err style="color:var(--bad);font-weight:700;min-height:20px;margin:8px 0 0"></p>' +
      '<div class="cms-modal-actions"><span class="spacer"></span><button type="button" class="btn gray" data-x="cancel">取消</button><button type="button" class="btn primary" data-x="save">儲存</button></div>';
    var mask = modal(html, function (act, btn, m) {
      var err = m.querySelector('[data-err]');
      err.textContent = '';
      if (act === 'cancel') m.remove();
      else if (act === 'add') { rows.push({ id: X.uid('srec'), productId: pid, materialId: '', qty: 1 }); m.querySelector('[data-body]').innerHTML = body(); }
      else if (act === 'del') { rows.splice(Number(btn.dataset.i), 1); m.querySelector('[data-body]').innerHTML = body(); }
      else if (act === 'copy') {
        var src = seasonById(m.querySelector('[data-f="src"]').value), r2 = src && recipesOf(src);
        if (!r2) { err.textContent = '請先選一個有配方的檔期。'; return; }
        if (!confirm('要把「' + src.name + '」的整套配方複製過來嗎？這個檔期目前編輯中的配方會被取代。')) return;
        rows = r2; m.querySelector('[data-body]').innerHTML = body();
      } else if (act === 'save') {
        var bad = rows.find(function (r) { return !r.materialId || !(Number(r.qty) >= 0) || r.qty === ''; });
        if (bad) { err.textContent = '有配方沒選包材，或數量不是數字，請檢查。'; return; }
        if (!saveRecipes(season, rows)) { err.textContent = '儲存失敗，請再試一次。'; return; }
        m.remove(); X.toast('已儲存「' + season.name + '」的配方'); if (done) done();
      }
    }, function (e, m) {
      var t = e.target, f = t.dataset && t.dataset.f;
      if (f === 'pid') { pid = t.value; m.querySelector('[data-body]').innerHTML = body(); }
      else if (f === 'mat') rows[Number(t.dataset.i)].materialId = t.value;
      else if (f === 'qty') rows[Number(t.dataset.i)].qty = t.value === '' ? '' : Number(t.value);
    });
    return mask;
  }

  // 給檔期列表顯示：{ gifts, singles, recipeProducts }
  function summary(s) {
    var ids = itemsOf(s), set = {}; ids.forEach(function (id) { set[id] = true; });
    var g = 0, si = 0;
    X.products().forEach(function (p) { if (p && set[String(p.id)]) { if (isSingle(p)) si++; else g++; } });
    var rec = recipesOf(s), prodSet = {};
    (rec || []).forEach(function (r) { prodSet[String(r.productId)] = true; });
    return { gifts: g, singles: si, recipeProducts: Object.keys(prodSet).length, hasRecipes: !!rec };
  }

  X.seasonItems = {
    itemsOf: itemsOf, recipesOf: recipesOf, saveItems: saveItems, saveRecipes: saveRecipes, activate: activate,
    pendingSeed: pendingSeed, seed: seed, openItemsDialog: openItemsDialog, openRecipeDialog: openRecipeDialog, summary: summary,
    _orderGroups: orderGroups, _HOLIDAYS: HOLIDAYS
  };
})(window.CMSX, window);

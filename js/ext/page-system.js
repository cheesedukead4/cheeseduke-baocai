/*
 * 開發員 E：開檔檢查、首頁提醒列、權限與自動化
 *  - xChecklist「開檔檢查」（season，ready）：全部即時計算、唯讀。檢查邏輯是純函式 computeChecks(X)，
 *    掛在 CMSX.checks，首頁提醒列也用同一份結果。
 *  - 首頁提醒列（不是新頁面）：插在原系統首頁上方（.home-sheet 裡、.home-switch 之前，id 防重複），
 *    包裝 window.renderDashboard，每次首頁重畫後更新；計算失敗不影響原首頁。
 *  - xSettings「權限與自動化」（system，skeleton）：資料集 appSettings（notify、sheetExport），
 *    另有權限分級規劃與資料集總覽。
 * 讀取的資料集：seasons、stocktakes、codeMap、deptMap、appSettings，以及原系統的業績預估 salesForecastV5；
 * 只寫入 appSettings（通知、試算表匯出），以及資料集總覽的「補上缺少的代號」（只改新功能資料集）。
 * 原系統資料（products、materials、recipes、components、initialStock、orderHistory）只讀不改。
 * 包材最低水位＝原系統「包材資料」的安全庫存 materials[].safety（也是首頁的「最低水位」），目前庫存用 X.materialStock()。
 */
(function (X) {
  'use strict';
  if (!X) return;

  var esc = X.esc;
  var LATER = ' disabled title="後續階段開放"';
  var EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
  var LIST_MAX = 50; // 檢查明細最多列幾項

  // =====================================================================
  // 共用小工具
  // =====================================================================
  function trim(v) { return String(v == null ? '' : v).trim(); }
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  // 品號比對：去掉空白、不分大小寫（與「對照設定」「業績儀表板」相同）
  function normCode(v) { return trim(v).replace(/\s+/g, '').toUpperCase(); }
  function intro(text) { return '<p class="small" style="margin:0 0 12px">' + esc(text) + '</p>'; }
  function actOf(e) { return (e.target && e.target.closest) ? e.target.closest('[data-act]') : null; }
  function navBtn(id) { try { return document.querySelector('#nav .navbtn[data-page="' + id + '"]'); } catch (e) { return null; } }
  function go(id) {
    if (!id) return;
    if (!X.goPage(id)) { X.toast('找不到這一頁'); return; }
    // 前往首頁時直接切到「包材庫存」表（最低水位就在那張表）；等原系統切頁與捲動結束後再切
    if (id === 'dashboard') setTimeout(showHomeMaterials, 30);
  }
  function showHomeMaterials() {
    try {
      var b = document.querySelector('#dashboard .home-switch-btn[data-home-tab="material"]');
      if (b && !b.classList.contains('active')) b.click();
    } catch (e) {}
  }

  // =====================================================================
  // 開檔檢查：純計算（不碰畫面）
  // =====================================================================
  // 每一項的設定：標題、處理的頁面（新頁面 id 或原系統 data-page）
  var CHECK_DEFS = [
    { key: 'season', title: '進行中的檔期', page: 'xSeasons', pageLabel: '檔期設定（頁面已移除）' },
    { key: 'price', title: '本期上架禮盒的售價', page: 'products', pageLabel: '禮盒資料' },
    { key: 'recipe', title: '本期上架禮盒的包材配方', page: 'products', pageLabel: '禮盒資料' },
    { key: 'component', title: '本期上架禮盒的單條內容物', page: 'products', pageLabel: '禮盒資料' },
    { key: 'safetyMissing', title: '包材最低水位未設定', page: 'materials', pageLabel: '包材資料' },
    { key: 'lowStock', title: '包材低於最低水位', page: 'dashboard', pageLabel: '首頁' },
    { key: 'stocktake', title: '盤點', page: 'xStocktake', pageLabel: '盤點' },
    { key: 'initialStock', title: '初始庫存', page: 'initialStock', pageLabel: '初始庫存' },
    { key: 'forecast', title: '業績預估是否已填', page: 'xSalesForecast', pageLabel: '業績預估' },
    { key: 'orderCode', title: '訂單品號對照', page: 'xMapping', pageLabel: '對照設定' },
    { key: 'orderDept', title: '通路／接單部門對照', page: 'xMapping', pageLabel: '對照設定' }
  ];
  // bad 紅燈｜warn 黃燈｜ok 通過｜skip 略過（前置條件不成立，無法檢查）
  var LEVEL_ORDER = { bad: 0, warn: 1, ok: 2, skip: 3 };
  var LEVEL_TAG = { bad: ['紅燈', 'bad'], warn: ['黃燈', 'warn'], ok: ['通過', 'ok'], skip: ['略過', 'muted'] };

  function listOf(arr, fn) {
    var out = arr.slice(0, LIST_MAX).map(fn);
    return { list: out, more: Math.max(0, arr.length - LIST_MAX) };
  }
  function pLabel(p) { return (trim(p.code) ? trim(p.code) + ' ' : '') + trim(p.name || '（未命名）'); }
  function mLabel(m) { return (trim(m.code) ? trim(m.code) + ' ' : '') + trim(m.name || '（未命名）'); }
  // 包材的最低水位＝原系統「包材資料」的安全庫存（首頁「最低水位」顯示的也是它）；不是大於 0 的數字就算沒設定
  function safetyOf(m) { var n = Number(m && m.safety); return Number.isFinite(n) && n > 0 ? n : 0; }
  function unitOf(m) { var u = trim(m && m.unit); return u ? ' ' + u : ''; }

  // 整理一次所有檢查要用的資料
  function buildContext(X) {
    var d = X.db() || {};
    var products = X.products().filter(isObj);
    var gifts = products.filter(function (p) { return trim(p.category) !== '單條' && p.isListedCurrent === true; });
    return {
      today: X.today(),
      products: products,
      gifts: gifts,
      materials: X.materials().filter(isObj),
      recipes: X.recipes().filter(isObj),
      components: X.components().filter(isObj),
      orders: X.orders(),
      initialStock: Array.isArray(d.initialStock) ? d.initialStock : [],
      seasons: X.get('seasons').filter(isObj),
      stocktakes: X.get('stocktakes').filter(isObj),
      salesForecast: (X.db() && X.db().salesForecastV5) || null,
      codeMap: X.get('codeMap').filter(isObj),
      deptMap: X.get('deptMap').filter(isObj)
    };
  }

  var RUN = {
    season: function (c) {
      var act = c.seasons.filter(function (s) { return s.status === 'active'; });
      if (!act.length) {
        var planning = c.seasons.filter(function (s) { return s.status === 'planning'; }).length;
        return {
          level: 'bad', count: 1, countText: '0 個', countSub: '進行中',
          desc: c.seasons.length
            ? '目前沒有進行中的檔期' + (planning ? '（有 ' + planning + ' 個規劃中）' : '') + '。請把這次要開的檔期改成「進行中」。'
            : '還沒有建立任何檔期，請先新增這次的檔期。',
          pill: '沒有進行中的檔期'
        };
      }
      if (act.length > 1) {
        var l = listOf(act, function (s) { return trim(s.name) || '（未命名）'; });
        return {
          level: 'warn', count: act.length, countText: act.length + ' 個', countSub: '進行中',
          desc: '同時有 ' + act.length + ' 個進行中的檔期，只能留一個。', list: l.list, more: l.more,
          pill: act.length + ' 個檔期同時進行中'
        };
      }
      var s = act[0];
      var dates = (s.startDate || s.endDate) ? '（' + (s.startDate || '未定') + '～' + (s.endDate || '未定') + '）' : '';
      return { level: 'ok', count: 0, countText: '1 個', countSub: '進行中', desc: '進行中：' + (trim(s.name) || '（未命名）') + dates };
    },

    price: function (c) {
      if (!c.gifts.length) {
        return {
          level: 'warn', count: 1, countText: '0 個', countSub: '本期上架',
          desc: '還沒有勾選任何「本期上架」的禮盒，請到禮盒資料勾選。', pill: '本期還沒有上架禮盒'
        };
      }
      var missing = c.gifts.filter(function (p) { return !(X.productPrice(p) > 0); });
      var l = listOf(missing, pLabel);
      return {
        level: missing.length ? 'warn' : 'ok', count: missing.length,
        countText: missing.length + ' 個', countSub: '共 ' + c.gifts.length + ' 個上架',
        desc: missing.length ? '這些禮盒沒有售價，業績預估的金額會算成 0。' : '本期上架的禮盒都有售價。',
        list: l.list, more: l.more, pill: '本期 ' + missing.length + ' 個禮盒沒有售價'
      };
    },

    recipe: function (c) {
      if (!c.gifts.length) return { level: 'skip', count: 0, countText: '—', desc: '還沒有本期上架的禮盒，無法檢查。' };
      var has = {};
      c.recipes.forEach(function (r) { if (X.num(r.qty) > 0) has[String(r.productId)] = true; });
      var missing = c.gifts.filter(function (p) { return !has[String(p.id)]; });
      var l = listOf(missing, pLabel);
      return {
        level: missing.length ? 'bad' : 'ok', count: missing.length,
        countText: missing.length + ' 個', countSub: '共 ' + c.gifts.length + ' 個上架',
        desc: missing.length ? '這些禮盒沒有包材配方，包材需求會少算。' : '本期上架的禮盒都有包材配方。',
        list: l.list, more: l.more, pill: '本期 ' + missing.length + ' 個禮盒沒有包材配方'
      };
    },

    component: function (c) {
      if (!c.gifts.length) return { level: 'skip', count: 0, countText: '—', desc: '還沒有本期上架的禮盒，無法檢查。' };
      var has = {};
      c.components.forEach(function (r) { if (X.num(r.qty) > 0) has[String(r.productId)] = true; });
      var missing = c.gifts.filter(function (p) { return !has[String(p.id)]; });
      var l = listOf(missing, pLabel);
      return {
        level: missing.length ? 'warn' : 'ok', count: missing.length,
        countText: missing.length + ' 個', countSub: '共 ' + c.gifts.length + ' 個上架',
        desc: missing.length ? '這些禮盒沒有設定單條內容物，單條需求會少算。' : '本期上架的禮盒都有單條內容物。',
        list: l.list, more: l.more, pill: '本期 ' + missing.length + ' 個禮盒沒有單條內容物'
      };
    },

    safetyMissing: function (c) {
      if (!c.materials.length) return { level: 'skip', count: 0, countText: '—', desc: '還沒有包材資料，無法檢查。' };
      var missing = c.materials.filter(function (m) { return !safetyOf(m); });
      var l = listOf(missing, mLabel);
      var what = '最低水位就是「包材資料」的安全庫存，也是首頁的最低水位。';
      return {
        level: missing.length ? 'warn' : 'ok', count: missing.length,
        countText: missing.length + ' 項', countSub: '共 ' + c.materials.length + ' 項包材',
        desc: missing.length
          ? '這些包材還沒設定最低水位，庫存變少時不會提醒。' + what + '請到「包材資料」按編輯，填入安全庫存。'
          : '每項包材都有設定最低水位。' + what,
        list: l.list, more: l.more, pill: missing.length + ' 項包材沒設最低水位'
      };
    },

    lowStock: function (c) {
      var withMin = c.materials.filter(function (m) { return safetyOf(m) > 0; });
      if (!withMin.length) {
        return {
          level: 'skip', count: 0, countText: '—',
          desc: c.materials.length ? '還沒有任何包材設定最低水位（「包材資料」的安全庫存），無法檢查。' : '還沒有包材資料，無法檢查。'
        };
      }
      // 「計算規則」可以改成用剩餘可用量（目前庫存－待裝盒，和首頁「水位狀態」一樣）來比，也可以設定剛好等於水位也算不足
      var R = window.CMSRules || null;
      var useRemain = !!(R && R.get('lowStockBasis') === 'remain');
      var eqLow = !!(R && R.get('safetyEqualIsLow'));
      var basis = useRemain ? '剩餘可用量' : '目前庫存';
      var low = [];
      withMin.forEach(function (m) {
        var min = safetyOf(m);
        var total = X.num((X.materialStock(m.id) || {}).total);
        if (useRemain) total -= X.num(R.materialDemand(m.id));
        if (R ? R.isLow(total, min) : total < min) low.push({ m: m, total: total, min: min });
      });
      low.sort(function (a, b) { return (a.total / a.min) - (b.total / b.min); });
      var l = listOf(low, function (x) {
        return mLabel(x.m) + '：' + basis + ' ' + X.fmt(x.total, 2) + unitOf(x.m) + '，最低水位 ' + X.fmt(x.min, 2) + unitOf(x.m);
      });
      return {
        level: low.length ? 'bad' : 'ok', count: low.length,
        countText: low.length + ' 項', countSub: '共 ' + withMin.length + ' 項有設水位',
        desc: low.length
          ? (useRemain
            ? '這些包材扣掉待裝盒後的剩餘可用量' + (eqLow ? '沒有高於' : '比') + '最低水位' + (eqLow ? '' : '少') + '（和首頁「水位狀態」同一套算法），請盡快補貨。'
            : '這些包材目前庫存（未折盒＋已折盒）' + (eqLow ? '沒有高於最低水位' : '比最低水位少') + '，請盡快補貨。首頁的「水位狀態」還會再扣掉待裝盒的數量，所以首頁標「不足」的可能更多。')
          : (useRemain ? '有設最低水位的包材，扣掉待裝盒後的剩餘可用量都在水位以上。' : '有設最低水位的包材，目前庫存都在水位以上。'),
        list: l.list, more: l.more, pill: low.length + ' 項包材低於最低水位'
      };
    },

    stocktake: function (c) {
      var done = c.stocktakes.filter(function (s) { return s.status === 'confirmed'; });
      if (!done.length) {
        var draft = c.stocktakes.filter(function (s) { return s.status !== 'confirmed'; });
        return {
          level: 'warn', count: 1, countText: '0 次', countSub: '已確認',
          desc: draft.length
            ? '有 ' + draft.length + ' 張盤點還沒按「確認」，確認後才算完成。'
            : '還沒有做過盤點。開檔前建議先盤點一次，確認實際庫存。',
          pill: '還沒完成過盤點'
        };
      }
      var last = done.slice().sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); })[0];
      var ago = last.date ? X.daysBetween(last.date, c.today) : null;
      // 「計算規則」設定了天數時，最近一次盤點太久以前就提醒（預設 0＝不看天數）
      var maxAge = window.CMSRules ? CMSRules.get('stocktakeMaxAgeDays') : 0;
      if (maxAge > 0 && ago != null && ago > maxAge) {
        return {
          level: 'warn', count: 1, countText: done.length + ' 次', countSub: '已確認',
          desc: '最近一次確認的盤點是 ' + last.date + '（' + ago + ' 天前），超過設定的 ' + maxAge + ' 天，建議重新盤點。',
          pill: '盤點已超過 ' + maxAge + ' 天'
        };
      }
      return {
        level: 'ok', count: 0, countText: done.length + ' 次', countSub: '已確認',
        desc: '最近一次：' + (last.date || '日期未填') + (ago != null && ago >= 0 ? '（' + (ago ? ago + ' 天前' : '今天') + '）' : '')
      };
    },

    initialStock: function (c) {
      var filled = c.initialStock.filter(function (x) {
        return isObj(x) && (X.num(x.total) || X.num(x.unfolded) || X.num(x.folded) || X.num(x.qty));
      });
      if (!filled.length) {
        return {
          level: 'bad', count: 1, countText: '0 項', countSub: '有數字',
          desc: c.initialStock.length ? '初始庫存每一項都是 0，庫存會從 0 開始算。' : '初始庫存還沒有輸入，庫存會從 0 開始算。',
          pill: '初始庫存是空的'
        };
      }
      return { level: 'ok', count: 0, countText: filled.length + ' 項', countSub: '有數字', desc: '已經輸入 ' + filled.length + ' 項初始庫存。' };
    },

    // 業績預估：原本首頁的業績預估表（db.salesForecastV5，各品項 4 個日期 × 各部門的預估盒數）
    forecast: function (c) {
      var sf = c.salesForecast;
      var rows = (sf && sf.rows && typeof sf.rows === 'object') ? sf.rows : {};
      var items = 0, qty = 0;
      Object.keys(rows).forEach(function (code) {
        var r = rows[code], sum = 0;
        var lines = (r && r.lines && typeof r.lines === 'object') ? r.lines : {};
        Object.keys(lines).forEach(function (n) {
          var byLoc = lines[n] || {};
          Object.keys(byLoc).forEach(function (loc) { sum += X.num(byLoc[loc] && byLoc[loc].est); });
        });
        if (sum > 0) { items++; qty += sum; }
      });
      var name = trim(sf && sf.campaignName) ? '「' + trim(sf.campaignName) + '」' : '業績預估';
      if (!items) {
        return {
          level: 'warn', count: 1, countText: '0 項', countSub: '已填預估',
          desc: name + '還沒有填任何預估盒數。', pill: '業績預估還沒填'
        };
      }
      return {
        level: 'ok', count: 0, countText: items + ' 項', countSub: '已填預估',
        desc: name + '已填 ' + items + ' 個品項，共 ' + X.fmt(qty) + ' 盒。'
      };
    },

    orderCode: function (c) {
      if (!c.orders.length) return { level: 'skip', count: 0, countText: '—', desc: '還沒有過去訂單，無法檢查。' };
      // 系統品號（原樣、大寫、去空白）與手動對照（訂單品號原樣、去空白）
      var byCode = {}, byNorm = {}, byId = {}, manual = {}, manualNorm = {};
      c.products.forEach(function (p) {
        byId[String(p.id)] = p;
        var code = trim(p.code);
        if (!code) return;
        if (!(code in byCode)) byCode[code] = p;
        var n = normCode(code);
        if (!(n in byNorm)) byNorm[n] = p;
      });
      c.codeMap.forEach(function (m) {
        var k = trim(m.orderCode);
        if (!k) return;
        if (!(k in manual)) manual[k] = m;
        var n = normCode(k);
        if (!(n in manualNorm)) manualNorm[n] = m;
      });
      function mapped(code) {
        var m = manual[code] || manualNorm[normCode(code)] || null;
        if (m && m.kind === 'ignore') return true;
        if (m && trim(m.productId) !== '') return !!byId[String(m.productId)]; // 對到已刪除的品項＝未對照
        return !!(byCode[code] || byNorm[normCode(code)]);
      }
      var stat = {}, codes = [];
      c.orders.forEach(function (r) {
        if (!r) return;
        var code = trim(r.productCode);
        if (!code) return;
        var s = stat[code];
        if (!s) { s = stat[code] = { code: code, n: 0, qty: 0 }; codes.push(s); }
        s.n++; s.qty += X.num(r.qty);
      });
      var un = codes.filter(function (s) { return !mapped(s.code); });
      un.sort(function (a, b) { return b.qty - a.qty || b.n - a.n; });
      var orderN = un.reduce(function (t, s) { return t + s.n; }, 0);
      var l = listOf(un, function (s) { return s.code + '（' + X.fmt(s.n) + ' 筆，' + X.fmt(s.qty) + ' 盒）'; });
      return {
        level: un.length ? 'warn' : 'ok', count: un.length,
        countText: un.length + ' 個', countSub: '共 ' + codes.length + ' 個品號',
        desc: un.length
          ? '這些品號對不到系統的禮盒或單條（共 ' + X.fmt(orderN) + ' 筆訂單），業績與「由去年帶入」會少算。'
          : '過去訂單的品號都對到了。',
        list: l.list, more: l.more, pill: un.length + ' 個訂單品號未對照'
      };
    },

    // 與「業績儀表板」同一套規則：先看接單部門，對不到再看通路；兩者都沒有對照的訂單才算未對照
    orderDept: function (c) {
      if (!c.orders.length) return { level: 'skip', count: 0, countText: '—', desc: '還沒有過去訂單，無法檢查。' };
      var ok = Object.create(null);
      X.DEPTS.forEach(function (d) { ok[d.key] = true; });
      ok.none = true;
      var odMap = Object.create(null), chMap = Object.create(null);
      c.deptMap.forEach(function (d) {
        if (!trim(d.dept)) return;
        var v = trim(d.value);
        var box = d.field === 'orderDepartment' ? odMap : (d.field === 'channel' ? chMap : null);
        if (box && !(v in box)) box[v] = d.dept; // field + value 重複時取第一筆（與對照設定頁相同）
      });
      // 品號設為「不計算」的訂單不算進業績，也不用對部門（與業績儀表板相同）
      var ign = Object.create(null), ignNorm = Object.create(null), first = Object.create(null), firstNorm = Object.create(null);
      c.codeMap.forEach(function (m) {
        var k = trim(m.orderCode), n = normCode(k);
        if (!k) return;
        if (!(k in first)) { first[k] = true; if (m.kind === 'ignore') ign[k] = true; }
        if (!(n in firstNorm)) { firstNorm[n] = true; if (m.kind === 'ignore') ignNorm[n] = true; }
      });
      var combos = Object.create(null), list = [], orderN = 0;
      c.orders.forEach(function (r) {
        if (!r) return;
        var code = trim(r.productCode);
        if (code && ((code in first) ? ign[code] : ignNorm[normCode(code)])) return;
        var od = trim(r.orderDepartment), ch = trim(r.channel);
        // 先看哪一個欄位見「計算規則」（預設先接單部門、再通路）
        var dk = window.CMSRules ? CMSRules.resolveDept({ orderDepartment: od, channel: ch }, { orderDepartment: odMap, channel: chMap })
          : ((od && odMap[od]) || (ch && chMap[ch]) || (!od && odMap['']) || (!ch && chMap['']) || '');
        if (ok[dk]) return;
        orderN++;
        var k = od + '\u0001' + ch;
        var s = combos[k];
        if (!s) { s = combos[k] = { od: od, ch: ch, n: 0 }; list.push(s); }
        s.n++;
      });
      list.sort(function (a, b) { return b.n - a.n; });
      var l = listOf(list, function (x) {
        return '接單部門「' + (x.od || '空白') + '」、通路「' + (x.ch || '空白') + '」（' + X.fmt(x.n) + ' 筆）';
      });
      return {
        level: list.length ? 'warn' : 'ok', count: list.length,
        countText: list.length + ' 種', countSub: X.fmt(orderN) + ' 筆訂單',
        desc: list.length
          ? '這些訂單的接單部門和通路都還沒設定對應的部門（共 ' + X.fmt(orderN) + ' 筆），部門業績會算到「未對照」。' +
            (window.CMSRules && CMSRules.get('deptPriority') === 'channel' ? '先看通路，對不到再看接單部門' : '先看接單部門，對不到再看通路') + '，設定其中一個就可以。'
          : '每筆訂單都能從接單部門或通路對到部門。',
        list: l.list, more: l.more, pill: list.length + ' 種通路／部門未對照'
      };
    }
  };

  // 回傳每一項：{ key, level, title, desc, count, countText, countSub, pill, page, pageLabel, list, more }
  function computeChecks(X) {
    var ctx = null, ctxErr = null;
    try { ctx = buildContext(X); } catch (e) { ctxErr = e; }
    return CHECK_DEFS.map(function (def) {
      var r;
      // 「計算規則」可以把某一項改成紅燈、黃燈或不檢查（預設照原本）
      var ov = window.CMSRules ? CMSRules.checkLevel(def.key) : 'default';
      try {
        if (ov === 'off') r = { level: 'skip', count: 0, countText: '—', desc: '已在「計算規則」設定為不檢查。' };
        else {
          if (ctxErr) throw ctxErr;
          r = RUN[def.key](ctx) || {};
          if ((ov === 'bad' || ov === 'warn') && (r.level === 'bad' || r.level === 'warn')) r.level = ov;
        }
      } catch (e) {
        r = { level: 'warn', count: 1, countText: '—', desc: '檢查時發生錯誤：' + (e && e.message ? e.message : e), pill: def.title + '檢查失敗' };
      }
      return {
        key: def.key, title: def.title, page: def.page, pageLabel: def.pageLabel,
        level: LEVEL_ORDER[r.level] != null ? r.level : 'warn',
        desc: r.desc || '', count: X.num(r.count), countText: r.countText || '—', countSub: r.countSub || '',
        pill: r.pill || def.title, list: Array.isArray(r.list) ? r.list : [], more: X.num(r.more)
      };
    });
  }
  function summarizeChecks(list) {
    var s = { bad: 0, warn: 0, ok: 0, skip: 0, total: 0 };
    (list || []).forEach(function (c) { s[c.level] = (s[c.level] || 0) + 1; s.total++; });
    return s;
  }
  function sortChecks(list) {
    return list.map(function (c, i) { return { c: c, i: i }; })
      .sort(function (a, b) { return (LEVEL_ORDER[a.c.level] - LEVEL_ORDER[b.c.level]) || (a.i - b.i); })
      .map(function (x) { return x.c; });
  }

  X.checks = computeChecks;

  // =====================================================================
  // 頁面一：開檔檢查（xChecklist）
  // =====================================================================
  function checkItemHtml(c) {
    var h = '<div style="min-width:200px"><b>' + esc(c.title) + '</b>' +
      '<div class="small" style="margin-top:2px">' + esc(c.desc) + '</div>';
    if (c.list.length) {
      h += '<details style="margin-top:6px"><summary class="small" style="cursor:pointer">查看明細（' + X.fmt(c.list.length + c.more) + ' 項）</summary>' +
        '<ul class="small" style="margin:6px 0 0;padding-left:18px;line-height:1.7">' +
        c.list.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') +
        (c.more ? '<li>…另有 ' + X.fmt(c.more) + ' 項</li>' : '') + '</ul></details>';
    }
    return h + '</div>';
  }
  function goBtnHtml(c) {
    var exists = !!navBtn(c.page);
    var strong = c.level === 'bad' || c.level === 'warn';
    return '<div class="x-row-actions"><button type="button" class="btn ' + (strong ? 'primary' : 'gray') + '" data-act="go" data-page="' + esc(c.page) + '"' +
      ' aria-label="前往' + esc(c.pageLabel) + '" title="' + (exists ? '前往「' + esc(c.pageLabel) + '」' : '找不到這一頁') + '"' + (exists ? '' : ' disabled') +
      ' style="min-height:40px;white-space:nowrap">前往</button></div>' +
      '<div class="small" style="text-align:right;margin-top:3px;white-space:nowrap">' + esc(c.pageLabel) + '</div>';
  }

  function renderChecklist(el) {
    var list = computeChecks(X);
    var sum = summarizeChecks(list);
    var html = intro('開檔前逐項確認檔期、禮盒、包材、庫存與訂單對照是否都設定好。數字即時計算，這頁不會修改任何資料。');
    html += X.ui.kpis([
      { label: '紅燈', value: sum.bad + ' 項', tone: sum.bad ? 'bad' : 'muted', sub: sum.bad ? '開檔前一定要處理' : '沒有紅燈' },
      { label: '黃燈', value: sum.warn + ' 項', tone: sum.warn ? 'warn' : 'muted', sub: sum.warn ? '建議處理' : '沒有黃燈' },
      { label: '通過', value: sum.ok + ' 項', tone: 'ok', sub: '共 ' + sum.total + ' 項' + (sum.skip ? '，' + sum.skip + ' 項略過' : '') }
    ]);
    if (!sum.bad && !sum.warn) html += X.ui.banner('ok', '開檔檢查全部通過，可以開檔了。');

    var cols = [
      { label: '燈號', render: function (c) { var t = LEVEL_TAG[c.level]; return X.ui.tag(t[0], t[1]); } },
      { label: '檢查項目', render: checkItemHtml },
      { label: '數量', num: true, render: function (c) {
        return '<b style="white-space:nowrap">' + esc(c.countText) + '</b>' + (c.countSub ? '<div class="small" style="white-space:nowrap">' + esc(c.countSub) + '</div>' : '');
      } },
      { label: '', render: goBtnHtml }
    ];
    html += X.ui.card('檢查項目', X.ui.table(cols, sortChecks(list)) +
      '<p class="small" style="margin:10px 0 0">「略過」表示還缺前面的設定，暫時無法檢查。首頁上方的提醒列也會列出紅燈和黃燈。</p>',
      '<button type="button" class="btn gray" data-act="refresh" style="min-height:40px">重新檢查</button>');
    el.innerHTML = html;

    el.onclick = function (e) {
      var a = actOf(e);
      if (!a || a.disabled) return;
      if (a.dataset.act === 'go') go(a.dataset.page);
      else if (a.dataset.act === 'refresh') { renderChecklist(el); X.toast('已重新檢查'); }
    };
    el.onchange = null;
    el.oninput = null;
  }

  X.registerPage({
    id: 'xChecklist', group: 'season', order: 5, stage: 'ready',
    title: '開檔檢查', sub: '開檔前確認設定都齊全',
    icon: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2.5h6v3H9z"/><path d="m9 13 2 2 4-4"/>',
    render: function (el) { renderChecklist(el); }
  });

  // =====================================================================
  // 首頁提醒列（原系統首頁上方的小膠囊）
  // =====================================================================
  var ALERT_ID = 'xHomeAlertbar';
  var ALERT_MAX = 6; // 手機上不要太長：最多顯示 6 個，其餘收在「還有 N 項」
  var DOT = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:10px;height:10px"><circle cx="12" cy="12" r="8" fill="currentColor" stroke="none"/></svg>';
  var OK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:15px;height:15px"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  var alertTimer = null;

  function alertBarHtml(list) {
    var issues = sortChecks(list).filter(function (c) { return c.level === 'bad' || c.level === 'warn'; });
    if (!issues.length) {
      return '<button type="button" class="x-ok" data-page="xChecklist" title="查看開檔檢查">' + OK_ICON + '開檔檢查全部通過</button>';
    }
    var shown = issues.slice(0, ALERT_MAX), rest = issues.length - shown.length;
    return shown.map(function (c) {
      return '<button type="button" class="x-' + c.level + '" data-page="' + esc(c.page) + '" title="' + esc(c.title + '：前往「' + c.pageLabel + '」') + '">' + DOT + esc(c.pill) + '</button>';
    }).join('') + '<button type="button" data-page="xChecklist" title="查看開檔檢查">' + (rest > 0 ? '還有 ' + rest + ' 項 ›' : '開檔檢查 ›') + '</button>';
  }

  function updateAlertBar() {
    alertTimer = null;
    try {
      if (!X.db()) return;
      var dash = document.getElementById('dashboard');
      if (!dash || !dash.classList.contains('active')) return; // 看不到首頁時不算；回到首頁時原系統會重畫首頁
      var bar = document.getElementById(ALERT_ID);
      if (!bar) {
        var sheet = dash.querySelector('.home-sheet');
        var sw = dash.querySelector('.home-switch');
        bar = document.createElement('div');
        bar.id = ALERT_ID;
        bar.className = 'x-alertbar';
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', '開檔檢查提醒');
        // 位置：.home-sheet 裡、.home-switch（包材庫存／單條…切換鈕）的前面
        if (sw && sw.parentNode) sw.parentNode.insertBefore(bar, sw);
        else if (sheet) sheet.insertBefore(bar, sheet.firstChild);
        else dash.insertBefore(bar, dash.firstChild);
        bar.onclick = function (e) {
          var b = e.target.closest ? e.target.closest('[data-page]') : null;
          if (b) go(b.dataset.page);
        };
      }
      bar.innerHTML = alertBarHtml(computeChecks(X));
    } catch (e) {
      try { console.warn('首頁提醒列更新失敗', e); } catch (x) {}
    }
  }
  function scheduleAlertBar() {
    if (alertTimer) return;
    alertTimer = setTimeout(updateAlertBar, 0); // 同一輪多次重畫只算一次
  }

  // app-shell 會在原系統載入後補發一次 load；那時 renderDashboard 才存在
  window.addEventListener('load', function () {
    try {
      var orig = window.renderDashboard;
      if (typeof orig === 'function' && !orig.__cmsxAlert) {
        var wrapped = function () {
          var r = orig.apply(this, arguments);
          try { scheduleAlertBar(); } catch (e) {}
          return r;
        };
        wrapped.__cmsxAlert = true;
        window.renderDashboard = wrapped;
      }
      scheduleAlertBar();
    } catch (e) {}
  });

  // =====================================================================
  // 頁面二：權限與自動化（xSettings）
  // =====================================================================
  // ---------- 純計算 ----------
  // 一行一個（也接受逗號、分號、空白分開）→ { list, bad: [{ line, text }] }
  function parseEmailLines(text) {
    var list = [], seen = {}, bad = [];
    String(text == null ? '' : text).split(/\r\n|\n|\r/).forEach(function (line, i) {
      line.split(/[\s,;，；、]+/).forEach(function (s) {
        s = s.trim();
        if (!s) return;
        if (!EMAIL_RE.test(s)) { bad.push({ line: i + 1, text: s }); return; }
        var k = s.toLowerCase();
        if (!seen[k]) { seen[k] = true; list.push(k); }
      });
    });
    return { list: list, bad: bad };
  }
  // 讀設定時補齊預設值（舊資料少了某些欄位也不會出錯）
  function normSettings(s) {
    s = isObj(s) ? s : {};
    var n = isObj(s.notify) ? s.notify : {}, x = isObj(s.sheetExport) ? s.sheetExport : {}, r = isObj(s.roles) ? s.roles : {};
    var arr = function (v) { return Array.isArray(v) ? v.filter(function (e) { return typeof e === 'string' && e; }) : []; };
    return {
      notify: { dailyAlert: n.dailyAlert === true, weeklyReport: n.weeklyReport === true, alertEmails: arr(n.alertEmails), reportEmails: arr(n.reportEmails), lineEnabled: n.lineEnabled === true },
      sheetExport: { enabled: x.enabled === true, viewerEmails: arr(x.viewerEmails) },
      roles: { note: typeof r.note === 'string' ? r.note : '' }
    };
  }
  // 陣列資料集的代號檢查：{ count, missing, dup, bad }
  function idStats(arr) {
    var seen = {}, out = { count: 0, missing: 0, dup: 0, bad: 0 };
    (Array.isArray(arr) ? arr : []).forEach(function (r) {
      out.count++;
      if (!isObj(r)) { out.bad++; return; }
      var id = r.id == null ? '' : String(r.id);
      if (!id) { out.missing++; return; }
      if (seen[id]) out.dup++; else seen[id] = true;
    });
    return out;
  }
  // 資料集筆數：array 長度、map 鍵數；object（單一設定）回傳 null
  function datasetCount(def, v) {
    if (def.type === 'array') return Array.isArray(v) ? v.length : 0;
    if (def.type === 'map') return isObj(v) ? Object.keys(v).length : 0;
    return null;
  }

  // 權限分級規劃：各頁 × 三種角色
  var ROLES = [
    { key: 'clerk', label: '店員碼', desc: '只能用「快速輸入」（進貨、折盒、使用、NG）和看首頁，其他頁面看不到。' },
    { key: 'manager', label: '主管碼', desc: '所有功能都能用，包含設定與匯入。' },
    { key: 'accountant', label: '會計碼', desc: '所有數字都能看但不能改，看不到客戶姓名等資料。' }
  ];
  var PERM = {
    full: ['可使用', 'ok'], fold: ['只能看首頁', 'info'], read: ['只能看', 'info'],
    readNoCustomer: ['只能看（不顯示客戶）', 'warn'], none: ['不能用', 'muted']
  };
  function permFor(pageId, role) {
    if (role === 'manager') return 'full';
    if (role === 'clerk') return pageId === 'xQuickEntry' ? 'full' : (pageId === 'dashboard' ? 'fold' : 'none');
    // 會計：只能看；有客戶資料的頁面隱藏客戶；只用來輸入或會帶出完整資料的頁面不開放
    if (pageId === 'orderHistory' || pageId === 'xOrderImport') return 'readNoCustomer';
    if (pageId === 'backup' || pageId === 'importcenter' || pageId === 'xQuickEntry') return 'none';
    return 'read';
  }
  var LEGACY_PAGES = [
    ['dashboard', '首頁'], ['materials', '包材資料'], ['singles', '單條資料'], ['products', '禮盒資料'],
    ['initialStock', '初始庫存'],
    ['importcenter', '資料匯入中心'], ['backup', '備份／還原'], ['orderHistory', '過去訂單紀錄']
  ];
  // 依選單順序列出所有頁面（找不到選單時用內建清單）
  function menuPages() {
    var out = [], seen = {};
    try {
      document.querySelectorAll('#nav .navbtn[data-page]').forEach(function (b) {
        var id = b.dataset.page;
        if (!id || seen[id]) return;
        seen[id] = true;
        var sp = b.querySelector('span');
        out.push({ id: id, title: trim(sp ? sp.textContent : id) });
      });
    } catch (e) {}
    if (!out.length) {
      LEGACY_PAGES.forEach(function (p) { out.push({ id: p[0], title: p[1] }); });
      Object.keys(X.pages || {}).forEach(function (id) { out.push({ id: id, title: X.pages[id].title || id }); });
    }
    return out;
  }

  // ---------- 畫面 ----------
  var TABS = [['roles', '人員權限'], ['notify', '通知'], ['sheet', '試算表匯出'], ['datasets', '資料集總覽']];
  var ss = { tab: 'roles' };
  var CLOUD_NOTE = '設定會保存並同步給所有人，但寄送功能要等雲端排程完成後才會啟用。';

  function rolesHtml(s) {
    // 人員與頁面權限已改在「人員與權限」頁設定（js/ext/page-users.js）；這裡只留說明與連結
    var html = X.ui.banner('info', '人員與每一頁的權限，已經改在「系統設定 → 人員與權限」設定（需要管理員登入）。');
    html += X.ui.card('怎麼設定', '<ol style="margin:0;padding-left:20px;line-height:1.9"><li>管理員登入後，到「人員與權限」新增人員，勾選這個人能用哪些頁面。</li><li>把系統產生的登入碼交給本人。</li><li>同事按選單左下角的「人員登入」，選自己的名字、輸入登入碼，選單就只會出現被開放的頁面。</li></ol>',
      '<button type="button" class="btn primary" data-act="go-users" style="min-height:40px">前往「人員與權限」</button>');
    if (s.roles.note) {
      html += X.ui.card('先前記錄的說明', '<p class="small" style="margin:0;white-space:pre-wrap">' + esc(s.roles.note) + '</p>');
    }
    return html;
  }

  function notifyHtml(s) {
    var n = s.notify;
    var html = X.ui.banner('info', esc(CLOUD_NOTE));
    html += '<div data-box="form">' + X.ui.card('Email 通知', X.ui.form([
      { name: 'dailyAlert', label: '每天寄出缺料提醒', type: 'checkbox', value: n.dailyAlert },
      { name: 'weeklyReport', label: '每週寄出業績週報', type: 'checkbox', value: n.weeklyReport },
      { name: 'alertEmails', label: '提醒 Email（一行一個）', type: 'textarea', rows: 4, value: n.alertEmails.join('\n'), placeholder: 'name@example.com' },
      { name: 'reportEmails', label: '週報 Email（一行一個）', type: 'textarea', rows: 4, value: n.reportEmails.join('\n'), placeholder: 'name@example.com' }
    ]), '<button type="button" class="btn gray"' + LATER + ' style="min-height:40px">寄一封測試信</button>') + '</div>';
    html += X.ui.card('LINE 通知',
      '<label class="x-check"><input type="checkbox" disabled title="後續階段開放"' + (n.lineEnabled ? ' checked' : '') + '> 同時用 LINE 通知</label>' +
      '<p class="small" style="margin:8px 0 0">LINE Notify 已經停止服務，之後要改用 LINE 官方帳號傳送，需要另外申請與串接，後續階段開放。</p>');
    html += '<div data-box="msg"></div>';
    html += '<div class="toolbar"><button type="button" class="btn primary" data-act="save-notify" style="min-height:44px;min-width:140px">儲存通知設定</button></div>';
    return html;
  }

  function sheetHtml(s) {
    var x = s.sheetExport;
    var html = X.ui.banner('info', esc('設定會保存並同步給所有人，但匯出功能要等雲端排程完成後才會啟用。'));
    html += '<div data-box="form">' + X.ui.card('匯出到 Google 試算表', X.ui.form([
      { name: 'enabled', label: '每天把庫存與需求匯出到試算表', type: 'checkbox', full: true, value: x.enabled },
      { name: 'viewerEmails', label: '可以檢視試算表的人（Email，一行一個）', type: 'textarea', rows: 4, full: true, value: x.viewerEmails.join('\n'), placeholder: 'name@example.com' }
    ]) + '<p class="small" style="margin:10px 0 0">匯出的內容只有加總數字，不會包含客戶資料。</p>',
      '<button type="button" class="btn gray"' + LATER + ' style="min-height:40px">立即匯出一次</button>' +
      '<button type="button" class="btn gray"' + LATER + ' style="min-height:40px">開啟試算表</button>') + '</div>';
    html += '<div data-box="msg"></div>';
    html += '<div class="toolbar"><button type="button" class="btn primary" data-act="save-sheet" style="min-height:44px;min-width:140px">儲存匯出設定</button></div>';
    return html;
  }

  var TYPE_LABEL = { array: '清單（array）', map: '對照表（map）', object: '單一設定（object）' };
  var LEGACY_DATA = [
    ['products', '禮盒與單條'], ['materials', '包材'], ['recipes', '包材配方'], ['components', '禮盒內含單條'],
    ['initialStock', '初始庫存'], ['foldingRecords', '舊折盒統計（已停用）'], ['orderHistory', '過去訂單']
  ];

  function datasetsHtml() {
    var defs = X.DATASETS || {};
    var rows = Object.keys(defs).map(function (k) {
      var d = defs[k], v = X.get(k);
      return { key: k, def: d, count: datasetCount(d, v), st: d.type === 'array' ? idStats(v) : null };
    });
    var fixable = rows.reduce(function (t, r) { return t + (r.st ? r.st.missing : 0); }, 0);
    var problems = rows.reduce(function (t, r) { return t + (r.st ? r.st.missing + r.st.dup + r.st.bad : 0); }, 0);
    var db = X.db() || {};

    var html = X.ui.kpis([
      { label: '新功能資料集', value: rows.length + ' 個', tone: 'info' },
      { label: '已有資料', value: rows.filter(function (r) { return r.count > 0; }).length + ' 個', sub: '不含單一設定' },
      { label: '代號問題', value: problems + ' 筆', tone: problems ? 'bad' : 'ok', sub: problems ? '缺少或重複的代號' : '每一筆都有唯一代號' }
    ]);
    var cols = [
      { label: '中文名稱', render: function (r) { return '<b style="white-space:nowrap">' + esc(r.def.label) + '</b>'; } },
      { label: '資料鍵', render: function (r) { return '<code>' + esc(r.key) + '</code>'; } },
      { label: '類型', render: function (r) { return '<span style="white-space:nowrap">' + esc(TYPE_LABEL[r.def.type] || r.def.type) + '</span>'; } },
      { label: '目前筆數', num: true, render: function (r) { return r.count == null ? '<span class="small">—</span>' : esc(X.fmt(r.count)); } },
      { label: '代號檢查', render: function (r) {
        if (!r.st) return '<span class="small">—</span>';
        var t = [];
        if (r.st.missing) t.push(X.ui.tag('缺代號 ' + r.st.missing, 'bad'));
        if (r.st.dup) t.push(X.ui.tag('重複 ' + r.st.dup, 'bad'));
        if (r.st.bad) t.push(X.ui.tag('壞掉 ' + r.st.bad, 'bad'));
        return t.length ? t.join(' ') : X.ui.tag('正常', 'ok');
      } },
      { label: '欄位說明', render: function (r) {
        var f = r.def.fields || {};
        var keys = Object.keys(f);
        return '<details><summary class="small" style="cursor:pointer;white-space:nowrap">' + keys.length + ' 個欄位</summary>' +
          '<div style="white-space:normal;min-width:240px;max-width:520px;margin-top:6px">' +
          keys.map(function (k) { return '<div class="small" style="margin:2px 0"><b>' + esc(k) + '</b>：' + esc(f[k]) + '</div>'; }).join('') +
          '</div></details>';
      } }
    ];
    html += X.ui.card('新功能資料集', X.ui.table(cols, rows) +
      '<p class="small" style="margin:10px 0 0">清單類每一筆都要有唯一代號（id），多人同時新增時才能自動合併。' +
      (problems && !fixable ? '重複或壞掉的筆數需要人工確認，系統不會自動處理。' : '') + '</p>',
      '<button type="button" class="btn gray" data-act="fix-ids" style="min-height:40px"' + (fixable ? '' : ' disabled title="沒有缺少代號的資料"') + '>補上缺少的代號' + (fixable ? '（' + fixable + ' 筆）' : '') + '</button>');

    html += X.ui.card('原系統資料（只讀）', X.ui.table([
      { label: '資料', render: function (r) { return '<b>' + esc(r[1]) + '</b>'; } },
      { label: '資料鍵', render: function (r) { return '<code>' + esc(r[0]) + '</code>'; } },
      { label: '目前筆數', num: true, render: function (r) { return esc(X.fmt(Array.isArray(db[r[0]]) ? db[r[0]].length : 0)); } }
    ], LEGACY_DATA) + '<p class="small" style="margin:10px 0 0">這些資料由原本的頁面維護，新功能只會讀取。</p>');
    return html;
  }

  function renderSettings(el) {
    var s = normSettings(X.get('appSettings'));
    if (!TABS.some(function (t) { return t[0] === ss.tab; })) ss.tab = 'roles';
    var html = intro('設定自動通知與試算表匯出，並查看系統所有資料集；人員權限在「人員與權限」頁。');
    html += '<div class="x-tabs" role="tablist">' + TABS.map(function (t) {
      var on = ss.tab === t[0];
      return '<button type="button" role="tab" aria-selected="' + (on ? 'true' : 'false') + '" data-act="tab" data-tab="' + t[0] + '"' + (on ? ' class="active"' : '') + '>' + esc(t[1]) + '</button>';
    }).join('') + '</div>';
    if (ss.tab === 'notify') html += notifyHtml(s);
    else if (ss.tab === 'sheet') html += sheetHtml(s);
    else if (ss.tab === 'datasets') html += datasetsHtml();
    else html += rolesHtml(s);
    el.innerHTML = html;

    el.onclick = function (e) {
      var a = actOf(e);
      if (!a || a.disabled) return;
      var act = a.dataset.act;
      if (act === 'tab') { if (a.dataset.tab !== ss.tab) { ss.tab = a.dataset.tab; renderSettings(el); } }
      else if (act === 'save-notify') saveNotify(el);
      else if (act === 'save-sheet') saveSheet(el);
      else if (act === 'fix-ids') fixIds();
      else if (act === 'go-users') X.goPage('xUsers');
    };
    el.onchange = null;
    el.oninput = null;
  }

  function showMsg(el, text) {
    var box = el.querySelector('[data-box="msg"]');
    if (box) box.innerHTML = X.ui.banner('bad', esc(text).replace(/\n/g, '<br>'));
    else alert(text);
  }
  function badText(label, bad) {
    return label + '有 ' + bad.length + ' 個格式不對：' + bad.slice(0, 5).map(function (b) { return '第 ' + b.line + ' 行「' + b.text + '」'; }).join('、') + (bad.length > 5 ? '…' : '');
  }

  function saveNotify(el) {
    var box = el.querySelector('[data-box="form"]');
    if (!box) return;
    var v = X.ui.read(box);
    var a = parseEmailLines(v.alertEmails), r = parseEmailLines(v.reportEmails);
    var errs = [];
    if (a.bad.length) errs.push(badText('提醒 Email ', a.bad));
    if (r.bad.length) errs.push(badText('週報 Email ', r.bad));
    if (v.dailyAlert && !a.list.length && !a.bad.length) errs.push('開啟每天缺料提醒時，請至少填一個提醒 Email。');
    if (v.weeklyReport && !r.list.length && !r.bad.length) errs.push('開啟每週業績週報時，請至少填一個週報 Email。');
    if (errs.length) { showMsg(el, errs.join('\n')); return; }
    var s = X.ensure('appSettings');
    var cur = isObj(s.notify) ? s.notify : {};
    s.notify = Object.assign({}, cur, {
      dailyAlert: !!v.dailyAlert, weeklyReport: !!v.weeklyReport,
      alertEmails: a.list, reportEmails: r.list,
      lineEnabled: cur.lineEnabled === true // LINE 開關目前不能改，保留原值
    });
    if (X.save()) X.toast('已儲存通知設定');
  }

  function saveSheet(el) {
    var box = el.querySelector('[data-box="form"]');
    if (!box) return;
    var v = X.ui.read(box);
    var w = parseEmailLines(v.viewerEmails);
    if (w.bad.length) { showMsg(el, badText('可檢視者 Email ', w.bad)); return; }
    var s = X.ensure('appSettings');
    var cur = isObj(s.sheetExport) ? s.sheetExport : {};
    s.sheetExport = Object.assign({}, cur, { enabled: !!v.enabled, viewerEmails: w.list });
    if (X.save()) X.toast(v.enabled && !w.list.length ? '已儲存（目前沒有指定可檢視的人）' : '已儲存匯出設定');
  }

  function fixIds() {
    var defs = X.DATASETS, n = 0;
    Object.keys(defs).forEach(function (k) { if (defs[k].type === 'array' && idStats(X.get(k)).missing) n++; });
    if (!n || !confirm('要幫缺少代號的資料補上新的代號嗎？（只會改新功能的資料集）')) return;
    var fixed = 0;
    Object.keys(defs).forEach(function (k) {
      if (defs[k].type !== 'array' || !idStats(X.get(k)).missing) return;
      X.ensure(k).forEach(function (r) {
        if (isObj(r) && (r.id == null || String(r.id) === '')) { r.id = X.uid('fix'); fixed++; }
      });
    });
    if (X.save()) X.toast('已補上 ' + fixed + ' 筆代號');
  }

  X.registerPage({
    id: 'xSettings', group: 'system', order: 10, stage: 'skeleton',
    title: '權限與自動化', sub: '通知、試算表匯出、資料集總覽',
    icon: '<path d="M12 3 5 6v5c0 4.5 3 8.4 7 10 4-1.6 7-5.5 7-10V6z"/><circle cx="12" cy="10" r="2.3"/><path d="M8.5 16.2c.8-1.5 2-2.3 3.5-2.3s2.7.8 3.5 2.3"/>',
    render: function (el) { renderSettings(el); }
  });

  // 給測試與其他頁面用的純函式
  X.systemCalc = {
    computeChecks: computeChecks, summarizeChecks: summarizeChecks, sortChecks: sortChecks, alertBarHtml: alertBarHtml,
    parseEmailLines: parseEmailLines, normSettings: normSettings, idStats: idStats, datasetCount: datasetCount, permFor: permFor
  };
})(window.CMSX);

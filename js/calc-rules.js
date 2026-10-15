/*
 * 計算規則：系統裡可以調整的參數
 * ---------------------------------------------------------------
 * 設定存在 db.calcRules（會同步給所有人）；沒設定或格式不對時一律用預設值。
 * 預設值必須和原本寫死在程式裡的數字完全一樣，沒改設定前所有數字都不會變。
 * 原系統（legacy-*.js）與新功能（js/ext）都透過 CMSRules.get(key) 讀取。
 * 「計算規則」頁（js/ext/page-rules.js）負責顯示與修改；說明文字在 js/ext/calc-docs.js。
 */
(function (root) {
  'use strict';

  var DATA_KEY = 'calcRules';

  // 開檔檢查的項目（key 與 page-system.js 的 CHECK_DEFS 相同），def＝原本發現問題時的燈號
  var CHECKS = [
    { key: 'season', title: '進行中的檔期', def: '沒有進行中的檔期：紅燈；同時有多個：黃燈' },
    { key: 'price', title: '本期上架禮盒的售價', def: '黃燈' },
    { key: 'recipe', title: '本期上架禮盒的包材配方', def: '紅燈' },
    { key: 'component', title: '本期上架禮盒的單條內容物', def: '黃燈' },
    { key: 'safetyMissing', title: '包材最低水位未設定', def: '黃燈' },
    { key: 'lowStock', title: '包材低於最低水位', def: '紅燈' },
    { key: 'stocktake', title: '盤點', def: '黃燈' },
    { key: 'initialStock', title: '初始庫存', def: '紅燈' },
    { key: 'forecast', title: '業績預估是否已填', def: '黃燈' },
    { key: 'orderCode', title: '訂單品號對照', def: '黃燈' },
    { key: 'orderDept', title: '通路／接單部門對照', def: '黃燈' }
  ];
  var LEVEL_OPTIONS = [
    { value: 'default', label: '照原本' }, { value: 'bad', label: '紅燈' },
    { value: 'warn', label: '黃燈' }, { value: 'off', label: '不檢查' }
  ];

  // 參數定義
  // type: months（月份多選）｜number｜bool｜select｜levels（開檔檢查燈號）
  var DEFS = [
    {
      key: 'seasonMonthsNewYear', group: 'orders', type: 'months', default: [1, 2],
      label: '過年檔期包含的月份',
      help: '訂單日期落在這些月份，就算「過年」檔期。如果勾了 7～12 月，這些月份的訂單會算進「隔年」的過年（例如 2026 年 12 月的預購算 2027 過年）。',
      uses: ['過去訂單紀錄的「過年」篩選', '首頁業績儀表板的檔期', '換算成單條的檔期與各檔期比較']
    },
    {
      key: 'seasonMonthsMidAutumn', group: 'orders', type: 'months', default: [8, 9, 10],
      label: '中秋檔期包含的月份',
      help: '訂單日期落在這些月份，就算「中秋」檔期。不能和過年的月份重複。',
      uses: ['過去訂單紀錄的「中秋」篩選', '首頁業績儀表板的檔期', '換算成單條的檔期與各檔期比較']
    },
    {
      key: 'safetyEqualIsLow', group: 'stock', type: 'bool', default: false,
      label: '剛好等於最低水位，也算「不足」',
      help: '關閉（原本的做法）：要比最低水位少才算不足。開啟：剛好等於也算不足。沒設最低水位（0）的包材不受影響。',
      uses: ['首頁包材庫存的「水位狀態」', '開檔檢查「包材低於最低水位」']
    },
    {
      key: 'lowStockBasis', group: 'checklist', type: 'select', default: 'stock',
      label: '開檔檢查判斷低水位時，用哪個數字和最低水位比',
      help: '首頁的「水位狀態」用的是剩餘可用量；開檔檢查原本用目前庫存，兩邊標「不足」的品項可能不一樣。',
      options: [
        { value: 'stock', label: '目前庫存（未折盒＋已折盒）' },
        { value: 'remain', label: '剩餘可用量（目前庫存－待裝盒，和首頁一樣）' }
      ],
      uses: ['開檔檢查「包材低於最低水位」']
    },
    {
      key: 'stocktakeDiffPct', group: 'stocktake', type: 'number', default: 5, min: 0, max: 100, step: 0.1, unit: '%',
      label: '盤點差異超過帳面合計的幾 % 要標紅',
      help: '差異＝實盤合計－帳面合計。差異的絕對值大於帳面合計的這個比例，就算「差異大」。只影響標紅和統計，不會改庫存。',
      uses: ['盤點明細的紅色標示與「差異超過 N%」統計', '盤點確認時的提醒']
    },
    {
      key: 'stocktakeMaxAgeDays', group: 'checklist', type: 'number', default: 0, min: 0, max: 3650, step: 1, integer: true, unit: '天',
      label: '最近一次盤點超過幾天，開檔檢查就提醒重新盤點',
      help: '填 0＝不看天數（原本的做法：做過一次盤點就算通過）。',
      uses: ['開檔檢查「盤點」']
    },
    {
      key: 'quickEntryWarnQty', group: 'daily', type: 'number', default: 100000, min: 1, max: 100000000, step: 1, integer: true,
      label: '快速輸入：單格數量達到多少，送出前提醒「是否多打 0」',
      help: '只會提醒，不會擋。',
      uses: ['快速輸入送出前的確認視窗']
    },
    {
      key: 'packWarnBoxes', group: 'daily', type: 'number', default: 10000, min: 1, max: 100000000, step: 1, integer: true, unit: '盒',
      label: '裝盒回報：單一禮盒盒數達到多少，送出前提醒「是否多打 0」',
      help: '只會提醒，不會擋。',
      uses: ['裝盒回報送出前的確認視窗']
    },
    {
      key: 'useBuiltinPrices', group: 'price', type: 'bool', default: true,
      label: '禮盒沒填售價時，改用系統內建的備用售價',
      help: '內建備用售價是寫在程式裡的 14 個品號價格（例如 CO-43 480 元）和 2026/10/08 匯入的 Excel 售價。開啟（原本的做法）時，「禮盒資料」把售價清空，還是會用舊價。關閉後只用「禮盒資料」填的售價，沒填就是 0，開檔檢查會列出沒有售價的禮盒，業績儀表板也會把它列在「沒有售價的品項」。',
      uses: ['業績預估的金額與預估業績總額', '首頁業績儀表板的金額與售價', '開檔檢查「本期上架禮盒的售價」']
    },
    {
      key: 'deptPriority', group: 'sales', type: 'select', default: 'orderDepartment',
      label: '訂單歸屬部門時，先看哪一個欄位',
      help: '訂單同時有「接單部門」和「通路」時，先用哪一個去找「對照設定」。先看的那個對不到，才看另一個；兩個都沒寫時，才用「空白」的對照。',
      options: [
        { value: 'orderDepartment', label: '先看接單部門，對不到再看通路' },
        { value: 'channel', label: '先看通路，對不到再看接單部門' }
      ],
      uses: ['首頁業績儀表板「依部門」', '換算成單條「依接單部門」', '開檔檢查「通路／接單部門對照」']
    },
    {
      key: 'salesExcludeNonRevenue', group: 'sales', type: 'bool', default: true,
      label: '公關贈、執行長的訂單不算進業績金額',
      help: '開啟（預設）：這兩個部門的訂單數量照算，但金額不算營收，不加進業績金額。關閉：金額也一起加總。',
      uses: ['首頁業績儀表板的金額（全公司、依部門、依品項）']
    },
    {
      key: 'singlesSameName', group: 'singles', type: 'bool', default: true,
      label: '禮盒沒設單條內容物、但名稱和某個單條一樣時，當成 1 盒＝1 條',
      help: '例如 CO-46「巧費」沒設內容物，但名稱和單條「巧費」一樣，就算 1 條巧費。關閉後這種禮盒會列在「無法換算」。',
      uses: ['換算成單條的所有數字']
    },
    {
      key: 'salesTopN', group: 'sales', type: 'number', default: 15, min: 1, max: 500, step: 1, integer: true, unit: '名',
      label: '業績儀表板「依品項」顯示前幾名',
      help: '只影響顯示幾列，不影響加總。',
      uses: ['首頁業績儀表板「依品項」']
    },
    {
      key: 'orderHistoryMaxRows', group: 'orders', type: 'number', default: 200, min: 10, max: 10000, step: 1, integer: true, unit: '筆',
      label: '過去訂單紀錄最多顯示幾筆',
      help: '只影響表格顯示幾筆，「共 N 筆」的統計不受影響。數字太大時手機會變慢。',
      uses: ['過去訂單紀錄的訂單明細表']
    },
    {
      key: 'holidayWarnDays', group: 'season', type: 'number', default: 30, min: 0, max: 365, step: 1, integer: true, unit: '天',
      label: '距離節日幾天內，檔期設定標黃色提醒',
      help: '只影響顏色。',
      uses: ['檔期設定的「節日」欄']
    },
    {
      key: 'checkLevels', group: 'checklist', type: 'levels', default: {},
      label: '開檔檢查各項目發現問題時的燈號',
      help: '「照原本」＝維持系統原本的燈號。改成「不檢查」的項目會顯示「略過」，也不會出現在首頁提醒列。',
      uses: ['開檔檢查頁', '首頁提醒列']
    }
  ];
  var BY_KEY = {};
  DEFS.forEach(function (d) { BY_KEY[d.key] = d; });

  // ---------- 讀取 ----------
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function stored() {
    try { var d = db; return d && isObj(d[DATA_KEY]) ? d[DATA_KEY] : {}; } // db＝原系統的全域資料，載入完成後才有
    catch (e) { return {}; }
  }
  function normMonths(v) {
    if (!Array.isArray(v)) return null;
    var out = [];
    v.forEach(function (m) { m = Number(m); if (Number.isInteger(m) && m >= 1 && m <= 12 && out.indexOf(m) < 0) out.push(m); });
    return out.length ? out.sort(function (a, b) { return a - b; }) : null;
  }
  // 把值整理成合法格式；不合法回傳 undefined
  function normalize(def, v) {
    if (v === undefined || v === null) return undefined;
    if (def.type === 'months') { var m = normMonths(v); return m || undefined; }
    if (def.type === 'bool') return typeof v === 'boolean' ? v : undefined;
    if (def.type === 'select') return def.options.some(function (o) { return o.value === v; }) ? v : undefined;
    if (def.type === 'number') {
      var n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
      if (!Number.isFinite(n) || n < def.min || n > def.max) return undefined;
      return def.integer ? Math.round(n) : n;
    }
    if (def.type === 'levels') {
      if (!isObj(v)) return undefined;
      var out = {};
      CHECKS.forEach(function (c) {
        var x = v[c.key];
        if (x === 'bad' || x === 'warn' || x === 'off') out[c.key] = x;
      });
      return out;
    }
    return undefined;
  }
  function get(key) {
    var def = BY_KEY[key];
    if (!def) throw new Error('未定義的計算規則：' + key);
    var v = normalize(def, stored()[key]);
    if (v === undefined) return clone(def.default);
    // 過年與中秋的月份不能重複；資料被改壞時兩個都退回預設
    if (def.type === 'months') {
      var other = key === 'seasonMonthsNewYear' ? 'seasonMonthsMidAutumn' : 'seasonMonthsNewYear';
      var ov = normalize(BY_KEY[other], stored()[other]) || BY_KEY[other].default;
      if (v.some(function (m) { return ov.indexOf(m) >= 0; })) return clone(def.default);
    }
    return v;
  }
  function all() { var o = {}; DEFS.forEach(function (d) { o[d.key] = get(d.key); }); return o; }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function isDefault(key) { return same(get(key), BY_KEY[key].default); }
  // 存放的值和實際生效的值不同（例如兩人同時改過年、中秋，合併後月份重複，只好退回預設）
  function isInvalid(key) {
    var raw = stored()[key];
    return raw !== undefined && !same(normalize(BY_KEY[key], raw), get(key));
  }
  function meta() { var m = stored()._meta; return isObj(m) ? m : null; }

  // ---------- 給各頁面用的共用判斷 ----------
  // 訂單月份屬於哪一種檔期：'newyear'｜'midautumn'｜''
  function seasonKindOfMonth(m) {
    m = Number(m);
    if (get('seasonMonthsNewYear').indexOf(m) >= 0) return 'newyear';
    if (get('seasonMonthsMidAutumn').indexOf(m) >= 0) return 'midautumn';
    return '';
  }
  function monthIn(kind, m) {
    m = Number(m);
    if (kind === 'newyear') return get('seasonMonthsNewYear').indexOf(m) >= 0;
    if (kind === 'midautumn') return get('seasonMonthsMidAutumn').indexOf(m) >= 0;
    return false;
  }
  // 檔期的年份：過年檔期裡 7～12 月的訂單算隔年的過年（預購）；其他一律用訂單日期的年份
  function seasonYear(dateStr, kind) {
    var mt = String(dateStr || '').match(/^(\d{4})-(\d{2})/);
    if (!mt) return String(dateStr || '').slice(0, 4);
    var y = Number(mt[1]), m = Number(mt[2]);
    if (kind === 'newyear' && m >= 7) y += 1;
    return String(y);
  }
  // 月份文字：[1,2] → 1～2 月；[8,9,10] → 8～10 月；[11,12,1,2] → 11 月～隔年 2 月
  function monthsText(list) {
    var set = normMonths(list) || [];
    if (!set.length) return '（沒有）';
    if (set.length === 12) return '全年';
    var has = function (m) { return set.indexOf(((m - 1 + 12) % 12) + 1) >= 0; };
    var starts = set.filter(function (m) { return !has(m - 1); });
    starts.sort(function (a, b) { return b - a; }); // 跨年的那一段（含 12 月）排前面
    var runs = starts.map(function (s) {
      var e = s; while (has(e + 1) && ((e % 12) + 1) !== s) e = (e % 12) + 1;
      if (e === s) return s + ' 月';
      return e < s ? s + ' 月～隔年 ' + e + ' 月' : s + '～' + e + ' 月';
    });
    // 沒有跨年時照月份順序
    if (!runs.some(function (r) { return r.indexOf('隔年') >= 0; })) runs.reverse();
    return runs.join('、');
  }
  function seasonRuleText() {
    return '過年＝' + monthsText(get('seasonMonthsNewYear')) + '訂單、中秋＝' + monthsText(get('seasonMonthsMidAutumn')) + '訂單';
  }
  // 是否低於最低水位：預設要比最低水位少才算；設定「剛好等於也算」時，只對有設水位（大於 0）的包材生效
  function isLow(value, min) {
    if (value < min) return true;
    return get('safetyEqualIsLow') && min > 0 && value === min;
  }
  // 包材的待裝盒（和首頁「待裝盒」同一套算法）：有新庫存算法時用 CMSStock.materialToPack（各禮盒還要再裝的盒數 × 配方），
  // 沒有才用舊算法（所有檔期需求 × 該禮盒的包材配方用量）
  function materialDemand(mid) {
    if (root.CMSStock && root.CMSStock.materialToPack) return root.CMSStock.materialToPack(mid);
    var d; try { d = db; } catch (e) { return 0; }
    if (!d) return 0;
    var recipes = Array.isArray(d.recipes) ? d.recipes : [];
    return (Array.isArray(d.campaigns) ? d.campaigns : []).reduce(function (sum, c) {
      var q = Number(c && c.qty) || 0;
      var per = recipes.filter(function (r) {
        return r && String(r.productId) === String(c && c.productId) && String(r.materialId) === String(mid);
      }).reduce(function (s, r) { return s + (Number(r.qty) || 0); }, 0);
      return sum + q * per;
    }, 0);
  }
  // 訂單歸屬部門時的欄位順序
  function deptOrder() {
    return get('deptPriority') === 'channel' ? ['channel', 'orderDepartment'] : ['orderDepartment', 'channel'];
  }
  // 依設定順序找部門：values＝{ orderDepartment, channel }（已去空白），maps＝{ orderDepartment: {值: 部門}, channel: {...} }
  function resolveDept(values, maps) {
    var order = deptOrder(), i, f;
    for (i = 0; i < order.length; i++) { f = order[i]; if (values[f] && maps[f][values[f]]) return maps[f][values[f]]; }
    for (i = 0; i < order.length; i++) { f = order[i]; if (!values[f] && maps[f]['']) return maps[f]['']; }
    return '';
  }
  function checkLevel(key) { var lv = get('checkLevels'); return lv[key] || 'default'; }

  root.CMSRules = {
    DATA_KEY: DATA_KEY, DEFS: DEFS, CHECKS: CHECKS, LEVEL_OPTIONS: LEVEL_OPTIONS, def: function (k) { return BY_KEY[k]; },
    get: get, all: all, isDefault: isDefault, isInvalid: isInvalid, normalize: normalize, same: same, meta: meta,
    seasonKindOfMonth: seasonKindOfMonth, monthIn: monthIn, seasonYear: seasonYear, monthsText: monthsText, seasonRuleText: seasonRuleText,
    isLow: isLow, materialDemand: materialDemand, deptOrder: deptOrder, resolveDept: resolveDept, checkLevel: checkLevel
  };
})(window);

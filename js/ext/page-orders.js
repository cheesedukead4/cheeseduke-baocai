/*
 * 訂單匯入、對照設定（開發員 B）
 * ---------------------------------------------------------------
 *  xOrderImport 訂單匯入（架構版）：1 選檔案 → 2 欄位對應 → 3 預覽 → 4 匯入。
 *               CSV 只在瀏覽器記憶體裡解析，不存檔；正式匯入（去重、寫入過去訂單、待確認）後續階段開放。
 *  xMapping     對照設定（測試中）：訂單品號 → 禮盒／單條（codeMap），通路／接單部門 → 部門（deptMap）。
 *
 * 使用的資料集：orderImports、pendingOrders（只讀）、codeMap、deptMap（讀寫）。
 * 原系統資料 products、orderHistory 只讀。畫面上不顯示客戶資料。
 */
(function (X) {
  'use strict';

  var LATER = ' disabled title="後續階段開放"';
  var IGNORE = '__ignore__';
  var IGNORE_LABEL = '不計算（不算進需求）';
  var SEP = '\u0001';

  // ================= 共用小工具 =================
  function trim(v) { return String(v == null ? '' : v).trim(); }
  // 全形英數符號轉半形（訂單檔常見全形數字、斜線）
  function toHalf(s) {
    return String(s == null ? '' : s)
      .replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/　/g, ' ');
  }
  function lower(s) { return toHalf(s).toLowerCase(); }
  function redraw(el, fn) {
    try { fn(el); } catch (e) {
      if (typeof console !== 'undefined') console.error(e);
      el.innerHTML = X.ui.banner('bad', '這一頁顯示時發生錯誤：' + X.esc(e.message));
    }
  }
  function gotoPage(id) { X.goPage(id); }
  function isSingle(p) { return trim(p && p.category) === '單條'; }
  function isObj(x) { return !!x && typeof x === 'object'; } // 雲端合併後若有壞掉的筆數，略過不顯示

  // ================= 品號、部門對照（兩頁共用的判斷） =================
  // 品號索引：手動對照（codeMap，以 orderCode 為唯一，重複時取第一筆）＋系統品號（products.code）
  // 品號比對用：去掉所有空白、不分大小寫（與「業績儀表板」相同）
  function normCode(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, '').toUpperCase(); }
  function buildCodeIndex() {
    var manual = new Map(), manualNorm = new Map(), byCode = new Map(), byUpper = new Map(), byNorm = new Map(), byId = new Map();
    X.get('codeMap').forEach(function (m) {
      var k = trim(m && m.orderCode);
      if (k && !manual.has(k)) manual.set(k, m);
      var n = normCode(k);
      if (n && !manualNorm.has(n)) manualNorm.set(n, m);
    });
    X.products().forEach(function (p) {
      if (!p) return;
      byId.set(String(p.id), p);
      var c = trim(p.code);
      if (!c) return;
      if (!byCode.has(c)) byCode.set(c, p);
      var u = c.toUpperCase();
      if (!byUpper.has(u)) byUpper.set(u, p);
      var n = normCode(c);
      if (!byNorm.has(n)) byNorm.set(n, p);
    });
    return { manual: manual, manualNorm: manualNorm, byCode: byCode, byUpper: byUpper, byNorm: byNorm, byId: byId };
  }
  // 回傳 { state: 'manual'|'ignore'|'auto'|'broken'|'none', product, entry, auto }
  function resolveCode(code, idx) {
    code = trim(code);
    var auto = code ? (idx.byCode.get(code) || idx.byUpper.get(code.toUpperCase()) || idx.byNorm.get(normCode(code)) || null) : null;
    var m = code ? (idx.manual.get(code) || idx.manualNorm.get(normCode(code)) || null) : null;
    if (m && m.kind === 'ignore') return { state: 'ignore', entry: m, auto: auto };
    if (m && trim(m.productId) !== '') {
      var p = idx.byId.get(String(m.productId));
      return p ? { state: 'manual', product: p, entry: m, auto: auto } : { state: 'broken', entry: m, auto: auto };
    }
    return auto ? { state: 'auto', product: auto, auto: auto } : { state: 'none', auto: null };
  }
  function isUnmapped(state) { return state === 'none' || state === 'broken'; }
  var CODE_STATE = {
    manual: { label: '已設定對照', tone: 'ok' },
    ignore: { label: '不計算', tone: 'muted' },
    auto: { label: '自動對到', tone: 'info' },
    broken: { label: '對照的品項已刪除', tone: 'bad' },
    none: { label: '未對照', tone: 'bad' }
  };

  // 部門索引：deptMap 以 field + value 為唯一（重複時取第一筆）
  function buildDeptIndex() {
    var m = new Map();
    X.get('deptMap').forEach(function (d) {
      if (!d || !trim(d.dept)) return;
      var k = d.field + SEP + trim(d.value);
      if (!m.has(k)) m.set(k, d);
    });
    return m;
  }
  // 依文字猜部門（只當建議，不自動存）
  var DEPT_HINTS = [['官網', 'web'], ['東橋', 'dongqiao'], ['永康', 'dongqiao'], ['a11', 'a11'], ['京站', 'jingzhan'],
    ['大公國', 'grandduchy'], ['公關', 'pr'], ['執行長', 'ceo']];
  function suggestDept(value) {
    var v = lower(trim(value));
    if (!v) return '';
    var exact = X.DEPTS.find(function (d) { return d.label.toLowerCase() === v; });
    if (exact) return exact.key;
    for (var i = 0; i < DEPT_HINTS.length; i++) if (v.indexOf(DEPT_HINTS[i][0]) >= 0) return DEPT_HINTS[i][1];
    return '';
  }

  // =====================================================================
  // (1) 訂單匯入（架構版）
  // =====================================================================
  var SOURCES = [{ value: 'erp', label: 'ERP' }, { value: 'pos', label: 'POS' }, { value: 'web', label: '官網' }, { value: 'other', label: '其他' }];
  function sourceLabel(v) { var s = SOURCES.find(function (x) { return x.value === v; }); return s ? s.label : (v || '—'); }

  // 系統欄位與自動對應用的標題關鍵字（已轉小寫、去空白；越前面越優先）
  var FIELDS = [
    { key: 'date', label: '日期', need: 'required', guess: ['訂單日期', '單據日期', '銷貨日期', '交易日期', '出貨日期', '下單日期', '日期', 'orderdate', 'date'] },
    { key: 'orderNo', label: '單號', need: 'suggest', guess: ['訂單編號', '訂單號碼', '訂單單號', '單據號碼', '單據編號', '銷貨單號', '單號', '訂單號', 'orderno', 'ordernumber', 'orderid'] },
    { key: 'sourceOrderNo', label: '來源單號', need: 'optional', guess: ['來源單號', '來源訂單編號', '來源訂單', '原始單號', '平台單號', '平台訂單編號', '外部單號', '參考單號', 'sourceorderno'] },
    { key: 'productCode', label: '品號', need: 'required', guess: ['品號', '商品編號', '產品編號', '商品代號', '產品代號', '料號', '貨號', '品項編號', '商品貨號', 'sku', 'productcode', 'itemcode', 'itemno'] },
    { key: 'name', label: '品名', need: 'optional', guess: ['品名', '商品名稱', '產品名稱', '品項名稱', '品項', '商品', '名稱', 'productname', 'itemname', 'name'] },
    { key: 'qty', label: '數量', need: 'required', guess: ['數量', '訂購數量', '銷售數量', '銷貨數量', '出貨數量', '盒數', '件數', 'qty', 'quantity'] },
    { key: 'channel', label: '通路', need: 'optional', guess: ['銷售通路', '通路', '通路名稱', '平台', '渠道', 'channel'] },
    { key: 'orderDepartment', label: '接單部門', need: 'optional', guess: ['接單部門', '接單單位', '業務部門', '部門', '門市', '店別', 'department', 'dept'] },
    { key: 'amount', label: '金額', need: 'optional', guess: ['金額', '銷售金額', '含稅金額', '總金額', '小計', '合計', '未稅金額', 'amount', 'total', 'subtotal'] },
    { key: 'status', label: '訂單狀態', need: 'optional', guess: ['訂單狀態', '單據狀態', '狀態', 'status'] },
    { key: 'customer', label: '客戶', need: 'optional', guess: ['客戶名稱', '客戶', '訂購人', '購買人', '收件人', '會員名稱', '會員', 'customer', 'buyer'], private: true }
  ];
  var REQUIRED = FIELDS.filter(function (f) { return f.need === 'required'; });
  var NEED_TAG = { required: ['必填', 'warn'], suggest: ['建議', 'info'], optional: ['選填', 'muted'] };
  var CHECK_TONE = { ok: 'ok', pending: 'warn', bad: 'bad', skip: 'muted' };
  var CANCEL_RE = /取消|作廢|退貨|退單|cancel/i;
  var MAX_FILE = 30 * 1024 * 1024;
  var PREVIEW_ROWS = 20;

  function blankImport(source) {
    return { source: source || 'erp', fileName: '', size: 0, encoding: '', delimiter: ',', table: null, headerRow: 0, detectedHeader: 0, mapping: {}, error: '', loading: false };
  }
  var imp = blankImport();   // 只在記憶體，不存檔
  var loadSeq = 0;

  // ---------- 標題對應 ----------
  function normHeader(h) { return lower(h).replace(/[\s_\-*:：()（）[\]【】]/g, ''); }
  function headerScore(f, h) {
    var n = normHeader(h);
    if (!n) return 0;
    var best = 0;
    f.guess.forEach(function (g, i) {
      var s = 0;
      if (n === g) s = 1000 - i;
      else if (n.indexOf(g) >= 0) s = 500 + g.length * 10 - i;
      if (s > best) best = s;
    });
    return best;
  }
  // 全部「系統欄位 × 檔案欄位」打分數，由高到低分配，每個檔案欄位只用一次
  function guessMapping(headers) {
    var pairs = [], map = {}, used = {};
    FIELDS.forEach(function (f) {
      map[f.key] = null;
      headers.forEach(function (h, ci) { var s = headerScore(f, h); if (s > 0) pairs.push({ k: f.key, ci: ci, s: s }); });
    });
    pairs.sort(function (a, b) { return b.s - a.s || a.ci - b.ci; });
    pairs.forEach(function (p) {
      if (map[p.k] == null && !used[p.ci]) { map[p.k] = p.ci; used[p.ci] = true; }
    });
    return map;
  }
  // 報表常在標題列上面多幾行說明：前 10 列中，最像標題的那一列
  function detectHeaderRow(table) {
    var best = 0, bestScore = 0;
    for (var r = 0; r < Math.min(10, table.length); r++) {
      var sc = 0;
      (table[r] || []).forEach(function (h) { if (FIELDS.some(function (f) { return headerScore(f, h) > 0; })) sc++; });
      if (sc > bestScore) { bestScore = sc; best = r; }
    }
    return bestScore >= 2 ? best : 0;
  }

  // ---------- 檔案讀取與 CSV 解析 ----------
  function decodeBuffer(buf) {
    var bytes = new Uint8Array(buf);
    if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B) throw new Error('這是 Excel（.xlsx）檔，請先在 Excel 用「另存新檔 → CSV」存成 CSV 再選。');
    if (bytes.length >= 4 && bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) throw new Error('這是舊版 Excel（.xls）檔，請先另存成 CSV 再選。');
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'UTF-16' };
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'UTF-16' };
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
    } catch (e) {
      // 繁中版 Excel 直接存的 CSV 多半是 Big5
      try { return { text: new TextDecoder('big5').decode(bytes), encoding: 'Big5（繁中 Excel）' }; }
      catch (e2) { return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'UTF-8（部分文字可能是亂碼）' }; }
    }
  }
  function detectDelimiter(text) {
    var lines = text.slice(0, 20000).split(/\r\n|\n|\r/).filter(function (l) { return l.trim() !== ''; }).slice(0, 5);
    var cands = [',', '\t', ';'], score = { ',': 0, '\t': 0, ';': 0 };
    lines.forEach(function (l) {
      var s = l.replace(/"[^"]*"/g, '');
      cands.forEach(function (c) { score[c] += s.split(c).length - 1; });
    });
    var best = ',';
    cands.forEach(function (c) { if (score[c] > score[best]) best = c; });
    return best;
  }
  // 支援引號（含 "" 跳脫、引號內換行）的簡單解析；略過整列空白
  function parseDelimited(text, delim) {
    var rows = [], row = [], cell = '', q = false, n = text.length;
    var keep = function () { if (row.some(function (x) { return String(x).trim() !== ''; })) rows.push(row); };
    for (var i = 0; i < n; i++) {
      var c = text.charAt(i);
      if (q) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false;
        } else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\r' || c === '\n') {
        if (c === '\r' && text.charAt(i + 1) === '\n') i++;
        row.push(cell); cell = ''; keep(); row = [];
      } else cell += c;
    }
    row.push(cell); keep();
    return rows;
  }
  // Excel 為了保留前導 0 常匯出成 ="00123"（引號被解析掉後會剩 =00123）
  function cleanCell(v) {
    var s = String(v == null ? '' : v).trim();
    var m = s.match(/^="(.*)"$/) || s.match(/^=([\w\-.]+)$/);
    return m ? m[1].trim() : s;
  }
  function parseText(text) {
    text = String(text || '').replace(/^﻿/, '');
    var delim = detectDelimiter(text);
    var rows = (delim === ',' && typeof csvParse === 'function') ? csvParse(text) : parseDelimited(text, delim);
    rows = rows.map(function (r) { return r.map(cleanCell); }).filter(function (r) { return r.some(function (c) { return c !== ''; }); });
    return { table: rows, delimiter: delim };
  }

  // ---------- 欄位值整理 ----------
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  // 支援 2025-01-05、2025/1/5、20250105、民國 114/01/05、1140105、01/05/2025、含時間
  function normDate(v) {
    var s = toHalf(trim(v)).replace(/[年月]/g, '/').replace(/日/g, '');
    if (!s) return '';
    var y, mo, d, m;
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\D|$)/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = s.match(/^(\d{3})(\d{2})(\d{2})(?:\D|$)/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = s.match(/^(\d{2,4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:\D|$)/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D|$)/))) { y = +m[3]; mo = +m[1]; d = +m[2]; }
    else return '';
    if (y < 100) y += 2000; // 兩位數西元年 25/01/05
    else if (y < 1000) y += 1911; // 民國年
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
    return y + '-' + pad2(mo) + '-' + pad2(d);
  }
  // 回傳數字；空白回傳 null；看不懂回傳 NaN
  function normNum(v) {
    var s = toHalf(trim(v)).replace(/NT\$?|\$|元|,|\s/gi, '');
    if (s === '') return null;
    var neg = /^\(.*\)$/.test(s);
    if (neg) s = s.slice(1, -1);
    var n = Number(s);
    if (!isFinite(n) || s === '') return NaN;
    return neg ? -n : n;
  }

  function colCount() {
    var n = 0;
    imp.table.slice(imp.headerRow, imp.headerRow + 1 + PREVIEW_ROWS * 5).forEach(function (r) { if (r.length > n) n = r.length; });
    return n;
  }
  function headersOf() {
    var h = imp.table[imp.headerRow] || [], out = [];
    for (var i = 0, n = colCount(); i < n; i++) out.push(trim(h[i]));
    return out;
  }
  function dataRows() { return imp.table ? imp.table.slice(imp.headerRow + 1) : []; }
  function rowValues(row) {
    var o = {};
    FIELDS.forEach(function (f) {
      var ci = imp.mapping[f.key];
      o[f.key] = ci == null ? '' : trim(row[ci]);
    });
    return o;
  }
  // 檢查一列：ok 可匯入｜pending 品號未對照（會進待確認）｜bad 格式有問題｜skip 已取消
  function checkRow(v, idx) {
    var bad = [];
    var d = normDate(v.date), q = normNum(v.qty);
    if (!v.date) bad.push('缺日期'); else if (!d) bad.push('日期看不懂');
    if (!v.productCode) bad.push('缺品號');
    if (q === null) bad.push('缺數量'); else if (isNaN(q)) bad.push('數量不是數字'); else if (q === 0) bad.push('數量是 0');
    if (bad.length) return { kind: 'bad', text: bad.join('、'), date: d, qty: q };
    if (v.status && CANCEL_RE.test(v.status)) return { kind: 'skip', text: '已取消', date: d, qty: q };
    var r = resolveCode(v.productCode, idx);
    if (isUnmapped(r.state)) return { kind: 'pending', text: '品號未對照', date: d, qty: q };
    return { kind: 'ok', text: r.state === 'ignore' ? '可匯入（不計算）' : '可匯入', date: d, qty: q };
  }
  function analyze(idx) {
    var res = { total: 0, ok: 0, pending: 0, bad: 0, skip: 0, codes: new Set(), preview: [] };
    dataRows().forEach(function (row, i) {
      var v = rowValues(row), c = checkRow(v, idx);
      res.total++;
      res[c.kind]++;
      if (c.kind === 'pending') res.codes.add(v.productCode);
      if (i < PREVIEW_ROWS) res.preview.push({ n: i + 1, v: v, c: c });
    });
    return res;
  }
  function missingRequired() { return REQUIRED.filter(function (f) { return imp.mapping[f.key] == null; }); }

  function loadFile(file, el) {
    if (!file) return;
    var source = imp.source;
    if (typeof FileReader === 'undefined' || typeof TextDecoder === 'undefined') {
      imp = blankImport(source);
      imp.error = '這個瀏覽器不能讀取檔案，請改用新版 Chrome、Edge 或 Safari。';
      redraw(el, renderImport);
      return;
    }
    if (file.size > MAX_FILE) {
      imp = blankImport(source);
      imp.error = '檔案太大（超過 30 MB），請分成幾個檔案再匯入。';
      redraw(el, renderImport);
      return;
    }
    var seq = ++loadSeq;
    imp = blankImport(source);
    imp.loading = true;
    imp.fileName = file.name || '';
    imp.size = file.size || 0;
    redraw(el, renderImport);
    var reader = new FileReader();
    reader.onerror = function () {
      if (seq !== loadSeq) return;
      imp.loading = false;
      imp.error = '無法讀取這個檔案。';
      redraw(el, renderImport);
    };
    reader.onload = function () {
      if (seq !== loadSeq) return; // 已經改選別的檔案
      imp.loading = false;
      try {
        var dec = decodeBuffer(reader.result);
        var p = parseText(dec.text);
        if (!p.table.length) throw new Error('檔案裡沒有資料。');
        imp.table = p.table;
        imp.encoding = dec.encoding;
        imp.delimiter = p.delimiter;
        imp.headerRow = imp.detectedHeader = detectHeaderRow(p.table);
        imp.mapping = guessMapping(headersOf());
      } catch (e) {
        imp.table = null;
        imp.error = (e && e.message) || '看不懂這個檔案的格式。';
      }
      redraw(el, renderImport);
    };
    reader.readAsArrayBuffer(file);
  }

  // ---------- 畫面 ----------
  function stepTag(text, tone) { return X.ui.tag(text, tone); }

  function step1Html(has) {
    var fields = [{ name: 'source', label: '訂單來源', type: 'select', options: SOURCES, value: imp.source }];
    if (has) {
      var opts = [];
      for (var r = 0; r < Math.min(10, imp.table.length); r++) {
        opts.push({ value: r, label: '第 ' + (r + 1) + ' 列' + (r === imp.detectedHeader ? '（自動判斷）' : '') });
      }
      fields.push({ name: 'headerRow', label: '欄位標題在第幾列', type: 'select', options: opts, value: imp.headerRow });
    }
    var h = X.ui.form(fields);
    h += '<div class="toolbar" style="margin-top:12px">' +
      '<label class="btn primary">' + (has ? '改選其他檔案' : '選擇 CSV 檔') +
      '<input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" data-act="file" hidden></label>' +
      (has || imp.error ? '<button type="button" class="btn gray" data-act="reset">清除</button>' : '') +
      '</div>';
    if (imp.loading) h += X.ui.banner('info', '讀取中：' + X.esc(imp.fileName));
    if (imp.error) h += X.ui.banner('bad', X.esc(imp.error));
    if (has) {
      var delimName = { ',': '逗號', '\t': 'Tab', ';': '分號' }[imp.delimiter] || imp.delimiter;
      h += '<p class="small">檔名：' + X.esc(imp.fileName) + '｜文字編碼：' + X.esc(imp.encoding) + '｜分隔：' + X.esc(delimName) +
        '｜標題下面有 ' + X.esc(X.fmt(dataRows().length)) + ' 列資料</p>';
    }
    h += '<p class="small">檔案只在這台裝置讀取，匯入前不會上傳也不會存檔。Excel 檔請先「另存新檔 → CSV」。</p>';
    return h;
  }

  function step2Html(has, headers, missing) {
    if (!has) return X.ui.empty('先在第 1 步選擇檔案。');
    var rows = dataRows().slice(0, PREVIEW_ROWS);
    var cols = [
      { label: '系統欄位', render: function (f) { var t = NEED_TAG[f.need]; return '<b>' + X.esc(f.label) + '</b> ' + X.ui.tag(t[0], t[1]); } },
      {
        label: '對應到檔案的哪一欄', render: function (f) {
          var cur = imp.mapping[f.key];
          return '<select data-act="map" data-key="' + X.esc(f.key) + '" aria-label="' + X.esc(f.label) + ' 對應的檔案欄位" style="min-width:160px">' +
            '<option value="">（不匯入）</option>' +
            headers.map(function (hd, i) {
              return '<option value="' + i + '"' + (cur === i ? ' selected' : '') + '>' + X.esc(hd || ('第 ' + (i + 1) + ' 欄（沒有標題）')) + '</option>';
            }).join('') + '</select>';
        }
      },
      {
        label: '檔案裡的第一筆', render: function (f) {
          var ci = imp.mapping[f.key];
          if (ci == null) return '<span class="small">—</span>';
          if (f.private) return '<span class="small">（不顯示客戶資料）</span>';
          for (var i = 0; i < rows.length; i++) { var v = trim(rows[i][ci]); if (v) return X.esc(v.length > 40 ? v.slice(0, 40) + '…' : v); }
          return '<span class="small">（前 20 列都是空的）</span>';
        }
      }
    ];
    var h = missing.length ? X.ui.banner('warn', '還沒對應必填欄位：' + X.esc(missing.map(function (f) { return f.label; }).join('、'))) : '';
    h += X.ui.table(cols, FIELDS);
    h += '<div class="toolbar" style="margin-top:12px">' +
      '<button type="button" class="btn gray" data-act="guess">重新自動對應</button>' +
      '<button type="button" class="btn gray"' + LATER + '>記住這組對應（下次自動套用）</button></div>';
    h += '<p class="small">系統依檔案的欄位標題自動猜，猜錯的直接改。客戶可以不對應；有對應也不會顯示內容。</p>';
    return h;
  }

  function previewCell(f, p) {
    var v = p.v[f.key];
    if (f.key === 'date') return p.c.date ? X.esc(p.c.date) : '<span style="color:var(--bad)">' + X.esc(v || '（空白）') + '</span>';
    if (f.key === 'qty') return (p.c.qty == null || isNaN(p.c.qty)) ? '<span style="color:var(--bad)">' + X.esc(v || '（空白）') + '</span>' : X.esc(X.fmt(p.c.qty, 2));
    if (f.key === 'amount') { var a = normNum(v); return (a == null || isNaN(a)) ? X.esc(v) : X.esc(X.fmt(a, 2)); }
    return X.esc(v.length > 40 ? v.slice(0, 40) + '…' : v);
  }

  function step3Html(has, missing, an) {
    if (!has) return X.ui.empty('選好檔案、對好欄位後，這裡會顯示前 20 列。');
    if (missing.length) return X.ui.empty('請先在第 2 步對應：' + missing.map(function (f) { return f.label; }).join('、'));
    if (!an || !an.total) return X.ui.empty('標題列下面沒有資料，請確認第 1 步的「欄位標題在第幾列」。');
    var h = X.ui.kpis([
      { label: '資料筆數', value: X.fmt(an.total) },
      { label: '可以匯入', value: X.fmt(an.ok), tone: 'ok' },
      { label: '品號未對照', value: X.fmt(an.pending), tone: an.pending ? 'warn' : 'muted', sub: an.codes.size ? an.codes.size + ' 個品號，會先放進待確認' : '' },
      { label: '格式有問題', value: X.fmt(an.bad), tone: an.bad ? 'bad' : 'muted', sub: an.skip ? '另有 ' + X.fmt(an.skip) + ' 筆已取消' : '' }
    ]);
    var shown = FIELDS.filter(function (f) { return !f.private && imp.mapping[f.key] != null; });
    var cols = [{ label: '#', num: true, render: function (p) { return String(p.n); } }]
      .concat(shown.map(function (f) {
        return { label: f.label, num: f.key === 'qty' || f.key === 'amount', render: function (p) { return previewCell(f, p); } };
      }))
      .concat([{ label: '檢查', render: function (p) { return X.ui.tag(p.c.text, CHECK_TONE[p.c.kind]); } }]);
    h += X.ui.table(cols, an.preview);
    if (an.total > PREVIEW_ROWS) h += '<p class="small">只顯示前 ' + PREVIEW_ROWS + ' 列；上面的數字是整個檔案的統計。</p>';
    if (an.pending) h += '<div class="toolbar" style="margin-top:10px"><button type="button" class="btn gray" data-act="goto" data-page="xMapping">去「對照設定」補品號</button></div>';
    h += '<p class="small">這裡只檢查格式和品號對照；重複的訂單會在正式匯入時比對。</p>';
    return h;
  }

  function step4Html(ready, an) {
    var h = '';
    if (ready && an && an.total) {
      h += '<p>準備匯入 <b>' + X.esc(X.fmt(an.ok + an.pending)) + '</b> 筆（' + X.esc(sourceLabel(imp.source)) + '・' + X.esc(imp.fileName) + '）。' +
        (an.pending ? '其中 ' + X.esc(X.fmt(an.pending)) + ' 筆品號未對照，會先放進「待確認訂單」。' : '') +
        (an.bad ? '格式有問題的 ' + X.esc(X.fmt(an.bad)) + ' 筆不會匯入。' : '') +
        (an.skip ? '已取消的 ' + X.esc(X.fmt(an.skip)) + ' 筆會略過。' : '') + '</p>';
    } else {
      h += '<p class="small">完成前 3 步後，就可以在這裡匯入。</p>';
    }
    h += '<div class="toolbar"><button type="button" class="btn primary"' + LATER + '>開始匯入</button></div>';
    h += '<p class="small">後續階段：匯入時會先比對重複的訂單並略過，新的訂單寫進「過去訂單紀錄」，結果記在下方的匯入紀錄。</p>';
    return h;
  }

  function importLogHtml() {
    var list = X.get('orderImports').filter(isObj).sort(function (a, b) { return X.num(b.at) - X.num(a.at); });
    var shown = list.slice(0, 50);
    var cols = [
      { label: '時間', render: function (r) { return X.esc(X.fmtTime(r.at)); } },
      { label: '來源', render: function (r) { return X.esc(sourceLabel(r.source)); } },
      { key: 'fileName', label: '檔名' },
      { label: '檔案筆數', num: true, render: function (r) { return X.esc(X.fmt(r.rows)); } },
      { label: '新增', num: true, render: function (r) { return X.esc(X.fmt(r.added)); } },
      { label: '重複略過', num: true, render: function (r) { return X.esc(X.fmt(r.duplicates)); } },
      { label: '待確認', num: true, render: function (r) { return X.esc(X.fmt(r.pending)); } },
      { key: 'by', label: '匯入者' },
      { key: 'note', label: '備註' }
    ];
    return X.ui.table(cols, shown, { empty: '還沒有匯入紀錄。第 4 步「開始匯入」開放後，每次匯入都會記在這裡。' }) +
      (list.length > shown.length ? '<p class="small">只顯示最近 ' + shown.length + ' 次，共 ' + X.esc(X.fmt(list.length)) + ' 次。</p>' : '');
  }

  // pendingOrders.raw 可能用系統欄位名或原始標題當鍵，兩種都找
  function rawPick(raw, key) {
    if (!raw || typeof raw !== 'object') return '';
    if (raw[key] != null && trim(raw[key]) !== '') return trim(raw[key]);
    var f = FIELDS.find(function (x) { return x.key === key; });
    if (!f) return '';
    var best = '', bestScore = 0;
    Object.keys(raw).forEach(function (k) {
      var s = headerScore(f, k);
      if (s > bestScore) { bestScore = s; best = trim(raw[k]); }
    });
    return best;
  }

  function pendingHtml() {
    var list = X.get('pendingOrders').filter(isObj).sort(function (a, b) { return X.num(b.createdAt) - X.num(a.createdAt); });
    var shown = list.slice(0, 200);
    var files = new Map();
    X.get('orderImports').forEach(function (r) { if (r && r.id != null) files.set(String(r.id), r); });
    var cols = [
      { label: '建立時間', render: function (r) { return X.esc(X.fmtTime(r.createdAt)); } },
      { label: '來自匯入', render: function (r) { var f = files.get(String(r.importId)); return f ? X.esc(f.fileName || sourceLabel(f.source)) : '<span class="small">—</span>'; } },
      { label: '品號', render: function (r) { return X.esc(rawPick(r.raw, 'productCode')) || '<span class="small">（空白）</span>'; } },
      { label: '數量', num: true, render: function (r) { var q = normNum(rawPick(r.raw, 'qty')); return q == null || isNaN(q) ? X.esc(rawPick(r.raw, 'qty')) : X.esc(X.fmt(q, 2)); } },
      { label: '原因', render: function (r) { return X.ui.tag(r.reason || '未註明', 'warn'); } },
      { label: '', render: function () { return '<div class="x-row-actions"><button type="button" class="btn gray"' + LATER + '>處理</button></div>'; } }
    ];
    return '<p class="small">匯入時品號對不到、或資料需要人看過的訂單會放在這裡，處理後才會算進過去訂單。</p>' +
      X.ui.table(cols, shown, { empty: '目前沒有待確認的訂單。' }) +
      (list.length > shown.length ? '<p class="small">只顯示最新 ' + shown.length + ' 筆，共 ' + X.esc(X.fmt(list.length)) + ' 筆。</p>' : '');
  }

  function renderImport(el) {
    var idx = buildCodeIndex();
    var has = !!(imp.table && imp.table.length);
    var headers = has ? headersOf() : [];
    var missing = has ? missingRequired() : REQUIRED;
    var ready = has && !missing.length && dataRows().length > 0;
    var an = ready ? analyze(idx) : null;
    var pendingCount = X.get('pendingOrders').length;

    var tag1 = imp.loading ? stepTag('讀取中', 'info') : has ? stepTag('已選檔', 'ok') : stepTag('尚未選檔', 'muted');
    var tag2 = !has ? stepTag('等待中', 'muted') : missing.length ? stepTag('缺 ' + missing.length + ' 個必填', 'bad') : stepTag('已完成', 'ok');
    var tag3 = !ready ? stepTag('等待中', 'muted') : stepTag(X.fmt(an.total) + ' 列', 'info');
    var tag4 = stepTag('後續開放', 'warn');

    var h = '<p class="small">把 ERP、POS、官網匯出的訂單檔（CSV）讀進系統：選檔、對好欄位、看過預覽，再匯入。</p>';
    h += X.ui.card('1 選檔案', step1Html(has), tag1);
    h += X.ui.card('2 欄位對應', step2Html(has, headers, missing), tag2);
    h += X.ui.card('3 預覽', step3Html(has, missing, an), tag3);
    h += X.ui.card('4 匯入', step4Html(ready, an), tag4);
    h += X.ui.card('匯入紀錄', importLogHtml());
    h += X.ui.card('待確認訂單', pendingHtml(),
      (pendingCount ? X.ui.tag(X.fmt(pendingCount) + ' 筆', 'warn') : '') +
      '<button type="button" class="btn gray"' + LATER + '>依最新對照重新比對</button>');
    el.innerHTML = h;

    el.onclick = function (e) {
      var a = e.target.closest('[data-act]');
      if (!a || a.disabled) return;
      var act = a.dataset.act;
      if (act === 'reset') { loadSeq++; imp = blankImport(imp.source); redraw(el, renderImport); }
      else if (act === 'guess') { if (imp.table) { imp.mapping = guessMapping(headersOf()); redraw(el, renderImport); } }
      else if (act === 'goto') gotoPage(a.dataset.page);
    };
    el.onchange = function (e) {
      var t = e.target;
      if (t.dataset.act === 'file') { loadFile(t.files && t.files[0], el); return; }
      if (t.dataset.act === 'map') { imp.mapping[t.dataset.key] = t.value === '' ? null : Number(t.value); redraw(el, renderImport); return; }
      if (t.dataset.field === 'source') { imp.source = t.value; redraw(el, renderImport); return; }
      if (t.dataset.field === 'headerRow' && imp.table) {
        imp.headerRow = Math.max(0, Number(t.value) || 0);
        imp.mapping = guessMapping(headersOf());
        redraw(el, renderImport);
      }
    };
    el.oninput = null;
  }

  X.registerPage({
    id: 'xOrderImport', group: 'data', order: 5, title: '訂單匯入', sub: '把 ERP、POS、官網的訂單匯出檔匯進系統', stage: 'skeleton',
    icon: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 11v7M9 15l3 3 3-3"/>',
    render: function (el) { renderImport(el); }
  });

  // =====================================================================
  // (2) 對照設定（測試中）
  // =====================================================================
  var TABS = [{ key: 'code', label: '品號對照' }, { key: 'channel', label: '通路對照' }, { key: 'orderDepartment', label: '接單部門對照' }];
  var DEPT_FIELD_LABEL = { channel: '通路', orderDepartment: '接單部門' };
  var mapState = { tab: 'code', only: false, q: '' };
  var codeRows = [], deptRows = [], lastStats = null, codeOptsHtml = '';

  // 過去訂單統計（約 9,000 筆，一次掃完）
  function computeStats() {
    var codes = new Map(), ch = new Map(), od = new Map(), total = 0, blankCode = 0;
    function addVal(map, v, q) {
      var s = map.get(v);
      if (!s) { s = { value: v, count: 0, qty: 0 }; map.set(v, s); }
      s.count++; s.qty += q;
    }
    X.orders().forEach(function (r) {
      if (!r) return;
      total++;
      var q = X.num(r.qty), c = trim(r.productCode);
      if (c) {
        var s = codes.get(c);
        if (!s) { s = { code: c, count: 0, qty: 0, names: new Map() }; codes.set(c, s); }
        s.count++; s.qty += q;
        var nm = trim(r.name);
        if (nm) s.names.set(nm, (s.names.get(nm) || 0) + 1);
      } else blankCode++;
      addVal(ch, trim(r.channel), q);
      addVal(od, trim(r.orderDepartment), q);
    });
    return { total: total, blankCode: blankCode, codes: codes, channel: ch, orderDepartment: od };
  }

  function buildCodeRows(st) {
    var rows = [];
    st.codes.forEach(function (s) {
      var name = '', best = 0;
      s.names.forEach(function (n, k) { if (n > best) { best = n; name = k; } });
      rows.push({ code: s.code, name: name, nameKinds: s.names.size, count: s.count, qty: s.qty });
    });
    // 已設定對照、但過去訂單裡沒有的品號（例如之後匯入用的）也列出來，才能修改
    var seen = new Set(rows.map(function (r) { return normCode(r.code); }));
    X.get('codeMap').forEach(function (m) {
      var k = trim(m && m.orderCode), n = normCode(k);
      if (k && !seen.has(n)) { seen.add(n); rows.push({ code: k, name: '', nameKinds: 0, count: 0, qty: 0 }); }
    });
    rows.sort(function (a, b) { return b.qty - a.qty || b.count - a.count || a.code.localeCompare(b.code); });
    rows.forEach(function (r, i) { r.i = i; });
    return rows;
  }

  function buildDeptRows(st, field) {
    var rows = [], seen = new Set();
    st[field].forEach(function (s) { rows.push({ value: s.value, count: s.count, qty: s.qty }); seen.add(s.value); });
    X.get('deptMap').forEach(function (d) {
      if (!d || d.field !== field) return;
      var v = trim(d.value);
      if (!seen.has(v)) { seen.add(v); rows.push({ value: v, count: 0, qty: 0 }); }
    });
    rows.sort(function (a, b) { return b.count - a.count || a.value.localeCompare(b.value); });
    rows.forEach(function (r, i) { r.i = i; });
    return rows;
  }

  // 下拉選單：禮盒（本期上架／未上架）、單條、不計算。選項只在使用者點開時才放進去（品號上百列時畫面才不會慢）
  function productOptionsHtml() {
    var on = [], off = [], singles = [];
    X.products().forEach(function (p) {
      if (!p) return;
      if (isSingle(p)) singles.push(p); else if (p.isListedCurrent === true) on.push(p); else off.push(p);
    });
    var byCode = function (a, b) { return String(a.code || '').localeCompare(String(b.code || '')) || String(a.name || '').localeCompare(String(b.name || '')); };
    var grp = function (label, list) {
      if (!list.length) return '';
      return '<optgroup label="' + X.esc(label) + '">' + list.sort(byCode).map(function (p) {
        return '<option value="' + X.esc(p.id) + '">' + X.esc(X.productLabel(p)) + '</option>';
      }).join('') + '</optgroup>';
    };
    return grp('禮盒（本期上架）', on) + grp('禮盒（本期未上架）', off) + grp('單條', singles) +
      '<optgroup label="其他"><option value="' + IGNORE + '">' + X.esc(IGNORE_LABEL) + '</option></optgroup>';
  }
  function codePlaceholder(res) {
    if (res.auto) return '自動對到：' + X.productLabel(res.auto);
    return res.state === 'broken' ? '（原品項已刪除，請重選）' : '（未對照，請選擇）';
  }
  function codeSelectHtml(r, res) {
    var ph = codePlaceholder(res), cur = '', curLabel = ph;
    if (res.state === 'manual') { cur = String(res.product.id); curLabel = X.productLabel(res.product); }
    else if (res.state === 'ignore') { cur = IGNORE; curLabel = IGNORE_LABEL; }
    else if (res.state === 'broken') { cur = String(res.entry.productId); curLabel = '（已刪除的品項）'; }
    return '<select data-act="code" data-i="' + r.i + '" data-ph="' + X.esc(ph) + '" aria-label="品號 ' + X.esc(r.code) + ' 對到的品項" style="min-width:180px;max-width:280px">' +
      '<option value="' + X.esc(cur) + '" selected>' + X.esc(curLabel) + '</option></select>';
  }
  function fillCodeSelect(t) {
    var sel = t && t.closest ? t.closest('select[data-act="code"]') : null;
    if (!sel || sel.dataset.full === '1') return;
    var cur = sel.value, curText = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text : '';
    sel.innerHTML = '<option value="">' + X.esc(sel.dataset.ph || '（未對照，請選擇）') + '</option>' + codeOptsHtml;
    sel.value = cur;
    if (sel.value !== cur) {
      // 目前的值不在清單裡（例如對到的品項已刪除）：保留這個選項，改選空白時才會觸發清除
      if (cur !== '') {
        var o = document.createElement('option');
        o.value = cur;
        o.textContent = curText;
        sel.insertBefore(o, sel.firstChild ? sel.firstChild.nextSibling : null);
      }
      sel.value = cur;
    }
    sel.dataset.full = '1';
  }
  function codeSearchText(r, res) { return lower(r.code + ' ' + r.name + ' ' + (res.product ? X.productLabel(res.product) : '')); }
  function codeStatusInner(res) {
    var meta = CODE_STATE[res.state];
    var h = X.ui.tag(meta.label, meta.tone);
    if (res.state === 'auto') h += '<div class="small">' + X.esc(X.productLabel(res.product)) + '</div>';
    if (res.state === 'broken') h += '<div class="small">原本對到的品項已刪除，請重選</div>';
    return h;
  }
  function codeStatusHtml(r, res) {
    return '<span data-rowkey="' + r.i + '" data-search="' + X.esc(codeSearchText(r, res)) + '" data-un="' + (isUnmapped(res.state) ? 1 : 0) + '">' + codeStatusInner(res) + '</span>';
  }
  function codeKpisHtml(idx) {
    var auto = 0, manual = 0, un = 0, unQty = 0;
    codeRows.forEach(function (r) {
      var s = resolveCode(r.code, idx).state;
      if (s === 'auto') auto++;
      else if (s === 'manual' || s === 'ignore') manual++;
      else { un++; unQty += r.qty; }
    });
    return X.ui.kpis([
      { label: '品號總數', value: X.fmt(codeRows.length), sub: '來自 ' + X.fmt(lastStats ? lastStats.total : 0) + ' 筆過去訂單' },
      { label: '自動對到', value: X.fmt(auto), tone: 'info', sub: '品號和系統一樣' },
      { label: '手動對照', value: X.fmt(manual), tone: 'ok', sub: '含設為不計算' },
      { label: '未對照', value: X.fmt(un), tone: un ? 'bad' : 'ok', sub: un ? X.fmt(unQty) + ' 盒還沒對到' : '全部都對好了' }
    ]);
  }

  function deptOptions(cur) {
    var opts = [{ value: '', label: '（未設定）' }]
      .concat(X.DEPTS.map(function (d) { return { value: d.key, label: d.label }; }))
      .concat([{ value: 'none', label: '不計算' }]);
    if (cur && !opts.some(function (o) { return o.value === cur; })) opts.push({ value: cur, label: cur + '（未知代號）' });
    return opts.map(function (o) { return '<option value="' + X.esc(o.value) + '"' + (o.value === cur ? ' selected' : '') + '>' + X.esc(o.label) + '</option>'; }).join('');
  }
  function deptValueLabel(v) { return v === '' ? '（空白）' : v; }
  function deptStatusInner(d, value) {
    if (d) return d.dept === 'none' ? X.ui.tag('不計算', 'muted') : X.ui.tag('已設定', 'ok');
    var s = suggestDept(value);
    return X.ui.tag('未設定', 'bad') + (s ? '<div class="small">建議：' + X.esc(X.deptLabel(s)) + '</div>' : '');
  }
  function deptStatusHtml(r, d) {
    return '<span data-rowkey="' + r.i + '" data-search="' + X.esc(lower(r.value + ' ' + (d ? X.deptLabel(d.dept) : ''))) + '" data-un="' + (d ? 0 : 1) + '">' + deptStatusInner(d, r.value) + '</span>';
  }
  function deptKpisHtml(field, dIdx) {
    var set = 0, none = 0, un = 0, unCount = 0;
    deptRows.forEach(function (r) {
      var d = dIdx.get(field + SEP + r.value);
      if (!d) { un++; unCount += r.count; } else if (d.dept === 'none') none++; else set++;
    });
    return X.ui.kpis([
      { label: DEPT_FIELD_LABEL[field] + '種類', value: X.fmt(deptRows.length), sub: '訂單上不重複的寫法' },
      { label: '已設定部門', value: X.fmt(set), tone: 'ok' },
      { label: '設為不計算', value: X.fmt(none) },
      { label: '未設定', value: X.fmt(un), tone: un ? 'bad' : 'ok', sub: un ? X.fmt(unCount) + ' 筆訂單' : '全部都設好了' }
    ]);
  }
  function suggestTodo(field, dIdx) {
    return deptRows.filter(function (r) { return !dIdx.get(field + SEP + r.value) && suggestDept(r.value); });
  }

  function toolbarHtml(placeholder, onlyLabel, extra) {
    return '<div class="toolbar">' +
      '<input type="search" data-act="q" value="' + X.esc(mapState.q) + '" placeholder="' + X.esc(placeholder) + '" aria-label="' + X.esc(placeholder) + '" style="flex:1 1 200px;min-width:0">' +
      '<button type="button" class="btn ' + (mapState.only ? 'primary' : 'gray') + '" data-act="only" aria-pressed="' + (mapState.only ? 'true' : 'false') + '">' + X.esc(onlyLabel) + '</button>' +
      (extra || '') +
      '<span class="small" data-box="count" style="align-self:center"></span></div>';
  }
  var NO_MATCH = '<div data-box="nomatch" hidden>' + X.ui.empty('沒有符合的項目') + '</div>';

  function codeTabHtml(st) {
    var idx = buildCodeIndex();
    codeOptsHtml = productOptionsHtml();
    codeRows = buildCodeRows(st);
    var body = '<p class="small">品號和系統一樣的會自動對到；不一樣或要改的，從下拉選單選。選「不計算」的品號不會算進需求。改完馬上存檔並同步。</p>';
    if (!X.products().length) body += X.ui.banner('warn', '系統裡還沒有禮盒或單條資料，請先到「禮盒資料」「單條資料」建立。');
    if (!codeRows.length) {
      body += X.ui.empty('還沒有過去訂單。請先到「過去訂單紀錄」或「資料匯入中心」匯入，這裡就會列出所有品號。');
    } else {
      var cols = [
        { label: '訂單品號', render: function (r) { return '<b>' + X.esc(r.code) + '</b>'; } },
        { label: '訂單上最常見的品名', render: function (r) { return (r.name ? X.esc(r.name) : '<span class="small">—</span>') + (r.nameKinds > 1 ? '<div class="small">共 ' + r.nameKinds + ' 種寫法</div>' : ''); } },
        { label: '筆數', num: true, render: function (r) { return X.esc(X.fmt(r.count)); } },
        { label: '總盒數', num: true, render: function (r) { return X.esc(X.fmt(r.qty)); } },
        { label: '對到系統的禮盒／單條', render: function (r) { return codeSelectHtml(r, r.res); } },
        { label: '狀態', render: function (r) { return codeStatusHtml(r, r.res); } }
      ];
      codeRows.forEach(function (r) { r.res = resolveCode(r.code, idx); });
      body += toolbarHtml('搜尋品號或品名', '只看未對照') + X.ui.table(cols, codeRows) + NO_MATCH;
      if (st.blankCode) body += '<p class="small">另有 ' + X.esc(X.fmt(st.blankCode)) + ' 筆過去訂單沒有品號，無法對照。</p>';
    }
    return '<div data-box="kpis">' + codeKpisHtml(idx) + '</div>' + X.ui.card('品號對照', body);
  }

  function deptTabHtml(st, field) {
    var dIdx = buildDeptIndex();
    deptRows = buildDeptRows(st, field);
    var label = DEPT_FIELD_LABEL[field];
    var body = '<p class="small">' + (field === 'channel'
      ? '訂單上的通路要算到哪個部門；選「不計算」的不會算進部門數字。'
      : '訂單上的接單部門對到系統的哪個部門；選「不計算」的不會算進部門數字。') + '改完馬上存檔並同步。' +
      '算部門業績時，先看接單部門，對不到再看通路，所以同一筆訂單只要設定其中一個就可以。</p>';
    if (!deptRows.length) {
      body += X.ui.empty('還沒有過去訂單。匯入訂單後，這裡會列出所有' + label + '。');
    } else {
      var todo = suggestTodo(field, dIdx).length;
      var cols = [
        { label: '訂單上的' + label, render: function (r) { return r.value === '' ? '<span class="small">（空白）</span>' : '<b>' + X.esc(r.value) + '</b>'; } },
        { label: '筆數', num: true, render: function (r) { return X.esc(X.fmt(r.count)); } },
        { label: '總盒數', num: true, render: function (r) { return X.esc(X.fmt(r.qty)); } },
        {
          label: '對應部門', render: function (r) {
            var d = dIdx.get(field + SEP + r.value);
            return '<select data-act="dept" data-i="' + r.i + '" aria-label="' + X.esc(label + ' ' + deptValueLabel(r.value)) + ' 對應的部門" style="min-width:120px">' + deptOptions(d ? d.dept : '') + '</select>';
          }
        },
        { label: '狀態', render: function (r) { return deptStatusHtml(r, dIdx.get(field + SEP + r.value)); } }
      ];
      var extra = '<button type="button" class="btn gray" data-act="suggest"' + (todo ? '' : ' disabled title="沒有可以套用的建議"') + '>套用建議' + (todo ? '（' + todo + ' 項）' : '') + '</button>';
      body += toolbarHtml('搜尋' + label, '只看未設定', extra) + X.ui.table(cols, deptRows) + NO_MATCH;
    }
    return '<div data-box="kpis">' + deptKpisHtml(field, dIdx) + '</div>' + X.ui.card(label + '對照', body);
  }

  // 搜尋與「只看未對照」直接切換列的顯示，不重畫（輸入框不會失去焦點）
  function applyFilter(el) {
    var q = lower(trim(mapState.q)), only = mapState.only, shown = 0, total = 0;
    el.querySelectorAll('[data-rowkey]').forEach(function (s) {
      total++;
      var ok = (!q || (s.dataset.search || '').indexOf(q) >= 0) && (!only || s.dataset.un === '1');
      var tr = s.closest('tr');
      if (tr) tr.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    var c = el.querySelector('[data-box="count"]');
    if (c) c.textContent = (q || only) ? '顯示 ' + X.fmt(shown) + '／' + X.fmt(total) + ' 項' : '共 ' + X.fmt(total) + ' 項';
    var nm = el.querySelector('[data-box="nomatch"]');
    if (nm) nm.hidden = !(total && !shown);
  }

  function setKpis(el, html) { var k = el.querySelector('[data-box="kpis"]'); if (k) k.innerHTML = html; }

  function onCodeChange(el, sel) {
    var row = codeRows[Number(sel.dataset.i)];
    if (!row) return;
    var v = sel.value, list = X.ensure('codeMap'), hits = [], j;
    var rowNorm = normCode(row.code);
    // 同一品號（不分大小寫、忽略空白）的對照一起更新，只留一筆
    list.forEach(function (m, i) { if (m && normCode(m.orderCode) === rowNorm) hits.push(i); });
    if (v === '') {
      for (j = hits.length - 1; j >= 0; j--) list.splice(hits[j], 1); // 清除手動對照，回到自動判斷
    } else {
      var p = v === IGNORE ? null : X.productById(v);
      if (v !== IGNORE && !p) { X.toast('找不到這個品項，請重新整理後再試'); return; }
      var data = p ? { productId: p.id, kind: isSingle(p) ? 'single' : 'gift' } : { productId: '', kind: 'ignore' };
      if (hits.length) {
        Object.assign(list[hits[0]], data);
        for (j = hits.length - 1; j >= 1; j--) list.splice(hits[j], 1); // 同一品號只留一筆
      } else {
        list.push({ id: X.uid('cm'), orderCode: row.code, productId: data.productId, kind: data.kind, note: '' });
      }
    }
    X.save({ silent: true });
    var idx = buildCodeIndex();
    row.res = resolveCode(row.code, idx);
    var span = el.querySelector('[data-rowkey="' + row.i + '"]');
    if (span) {
      span.innerHTML = codeStatusInner(row.res);
      span.dataset.un = isUnmapped(row.res.state) ? '1' : '0';
      span.dataset.search = codeSearchText(row, row.res);
    }
    setKpis(el, codeKpisHtml(idx));
  }

  function onDeptChange(el, sel) {
    var field = mapState.tab, row = deptRows[Number(sel.dataset.i)];
    if (!row || !DEPT_FIELD_LABEL[field]) return;
    var v = sel.value, list = X.ensure('deptMap'), hits = [], j;
    list.forEach(function (d, i) { if (d && d.field === field && trim(d.value) === row.value) hits.push(i); });
    if (v === '') {
      for (j = hits.length - 1; j >= 0; j--) list.splice(hits[j], 1);
    } else if (hits.length) {
      list[hits[0]].dept = v;
      for (j = hits.length - 1; j >= 1; j--) list.splice(hits[j], 1);
    } else {
      list.push({ id: X.uid('dm'), field: field, value: row.value, dept: v });
    }
    X.save({ silent: true });
    var dIdx = buildDeptIndex(), d = dIdx.get(field + SEP + row.value);
    var span = el.querySelector('[data-rowkey="' + row.i + '"]');
    if (span) {
      span.innerHTML = deptStatusInner(d, row.value);
      span.dataset.un = d ? '0' : '1';
      span.dataset.search = lower(row.value + ' ' + (d ? X.deptLabel(d.dept) : ''));
    }
    setKpis(el, deptKpisHtml(field, dIdx));
    var btn = el.querySelector('[data-act="suggest"]');
    if (btn) {
      var todo = suggestTodo(field, dIdx).length;
      btn.disabled = !todo;
      btn.title = todo ? '' : '沒有可以套用的建議';
      btn.textContent = '套用建議' + (todo ? '（' + todo + ' 項）' : '');
    }
  }

  function applySuggestions(el) {
    var field = mapState.tab;
    if (!DEPT_FIELD_LABEL[field]) return;
    var todo = suggestTodo(field, buildDeptIndex());
    if (!todo.length) return;
    if (!confirm('把 ' + todo.length + ' 項' + DEPT_FIELD_LABEL[field] + '設成建議的部門？之後還是可以逐項修改。')) return;
    var list = X.ensure('deptMap');
    todo.forEach(function (r) { list.push({ id: X.uid('dm'), field: field, value: r.value, dept: suggestDept(r.value) }); });
    X.save({ silent: true });
    X.toast('已套用 ' + todo.length + ' 項建議');
    redraw(el, renderMapping);
  }

  function renderMapping(el) {
    var st = computeStats();
    lastStats = st;
    if (!TABS.some(function (t) { return t.key === mapState.tab; })) mapState.tab = 'code';
    var h = '<p class="small">把訂單上的品號、通路、接單部門，對到系統裡的禮盒／單條和部門；之後算需求和業績會用到。</p>';
    h += '<div class="x-tabs" role="tablist">' + TABS.map(function (t) {
      var on = t.key === mapState.tab;
      return '<button type="button" role="tab" aria-selected="' + on + '" data-act="tab" data-tab="' + t.key + '"' + (on ? ' class="active"' : '') + '>' + X.esc(t.label) + '</button>';
    }).join('') + '</div>';
    h += mapState.tab === 'code' ? codeTabHtml(st) : deptTabHtml(st, mapState.tab);
    el.innerHTML = h;
    applyFilter(el);

    el.onclick = function (e) {
      var a = e.target.closest('[data-act]');
      if (!a || a.disabled) return;
      var act = a.dataset.act;
      if (act === 'tab') {
        if (a.dataset.tab === mapState.tab) return;
        mapState.tab = a.dataset.tab;
        mapState.q = '';
        redraw(el, renderMapping);
      } else if (act === 'only') {
        mapState.only = !mapState.only;
        a.className = 'btn ' + (mapState.only ? 'primary' : 'gray');
        a.setAttribute('aria-pressed', mapState.only ? 'true' : 'false');
        applyFilter(el);
      } else if (act === 'suggest') applySuggestions(el);
    };
    el.onchange = function (e) {
      var t = e.target;
      if (t.dataset.act === 'code') onCodeChange(el, t);
      else if (t.dataset.act === 'dept') onDeptChange(el, t);
    };
    el.oninput = function (e) {
      if (e.target.dataset.act === 'q') { mapState.q = e.target.value; applyFilter(el); }
    };
    // 品號下拉選單在點開（或用鍵盤移到）時才放入全部選項
    el.onpointerdown = function (e) { fillCodeSelect(e.target); };
    if (!el.__xmapFocus) {
      el.__xmapFocus = true;
      el.addEventListener('focusin', function (e) { fillCodeSelect(e.target); });
    }
  }

  X.registerPage({
    id: 'xMapping', group: 'data', order: 10, title: '對照設定', sub: '訂單品號、通路、接單部門對到系統的禮盒與部門', stage: 'beta',
    icon: '<path d="M4 8h14M14 4l4 4-4 4"/><path d="M20 16H6M10 12l-4 4 4 4"/>',
    render: function (el) { renderMapping(el); }
  });
})(window.CMSX);

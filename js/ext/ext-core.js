/*
 * 新功能架構（CMSX）：資料集定義、頁面註冊、共用工具
 * ---------------------------------------------------------------
 * 所有新頁面都用 CMSX.registerPage() 註冊；資料都存在原系統的 db 物件裡，
 * 每個資料集是 db 的一個第一層欄位，雲端同步層會分開上傳、多人修改時自動合併。
 *
 * 規則（新頁面都必須遵守）：
 *  1. 陣列資料集裡的每一筆都要有唯一 id（用 CMSX.uid()），多人同時新增才能自動合併。
 *  2. 只能透過 CMSX.ensure(key) 取得可修改的資料，改完呼叫 CMSX.save()。
 *  3. 不可修改原系統的資料（materials、products、recipes、orderHistory…），只能讀。
 *  4. 頁面 render 每次重畫整個內容；事件用委派（container.onclick / onchange）綁定。
 *  5. 所有文字用繁體中文；使用者輸入的文字一律經過 CMSX.esc() 再放進 HTML。
 */
(function (root) {
  'use strict';

  var KEY = 'campaign_material_system_v1';

  // ---------- 部門（與「業績預估」相同的 8 個部門代號） ----------
  var DEPTS = [
    { key: 'dongqiao', label: '東橋' }, { key: 'a11', label: 'A11' }, { key: 'jingzhan', label: '京站' },
    { key: 'web', label: '官網' }, { key: 'channel', label: '通路' }, { key: 'pr', label: '公關贈' },
    { key: 'ceo', label: '執行長' }, { key: 'grandduchy', label: '大公國' }
  ];
  // 公關贈、執行長：不算營收，但算進包材與單條需求
  var NON_REVENUE_DEPTS = ['pr', 'ceo'];

  // ---------- 資料集定義 ----------
  // type: 'array'（每筆有 id）或 'map'（以 id 為鍵的物件）或 'object'（單一設定物件）
  var DATASETS = {
    seasons: {
      label: '檔期設定', type: 'array',
      fields: {
        id: '唯一代號', name: '檔期名稱，例：2027 過年', kind: "'newyear' 過年｜'midautumn' 中秋｜'other' 其他",
        holidayDate: '節日日期 YYYY-MM-DD（用來對齊「節前第幾天」）', startDate: '檔期開始 YYYY-MM-DD', endDate: '檔期結束 YYYY-MM-DD',
        status: "'planning' 規劃中｜'active' 進行中（同時只能有一個）｜'closed' 已結束", compareSeasonId: '比較用的去年同檔期 id（可空）',
        note: '備註', createdAt: '建立時間（毫秒）', by: '建立者'
      }
    },
    codeMap: {
      label: '訂單品號對照', type: 'array',
      fields: { id: '唯一代號', orderCode: '訂單上的品號（唯一）', productId: '對應的禮盒／單條 id（db.products[].id）', kind: "'gift' 禮盒｜'single' 單條｜'ignore' 不計算", note: '備註' }
    },
    deptMap: {
      label: '通路／部門對照', type: 'array',
      fields: { id: '唯一代號', field: "'channel' 通路｜'orderDepartment' 接單部門", value: '訂單上的原始文字', dept: '對應的部門代號（DEPTS），或 none 不計算' }
    },
    orderImports: {
      label: '訂單匯入紀錄', type: 'array',
      fields: { id: '唯一代號', at: '匯入時間（毫秒）', by: '匯入者', fileName: '檔名', source: "'erp'｜'pos'｜'web'｜'other'", rows: '檔案筆數', added: '新增筆數', duplicates: '重複略過筆數', pending: '待確認筆數', note: '備註' }
    },
    pendingOrders: {
      label: '待確認訂單', type: 'array',
      fields: { id: '唯一代號', importId: '來自哪次匯入', raw: '原始欄位物件', reason: '無法匯入的原因', createdAt: '建立時間（毫秒）' }
    },
    movements: {
      label: '包材快速異動', type: 'array',
      fields: {
        id: '唯一代號', at: '輸入時間（毫秒）', by: '輸入者', date: '作業日期 YYYY-MM-DD', materialId: '包材 id',
        type: "'in' 進貨｜'fold' 折盒｜'use' 使用｜'foldNg' 折盒NG｜'useNg' 使用NG", qty: '數量（正數）', note: '備註', voided: '是否已撤銷 true/false',
        batchId: '同一次送出的批次代號（同一批共用）'
      }
    },
    stocktakes: {
      label: '盤點紀錄', type: 'array',
      fields: {
        id: '唯一代號', date: '盤點日期 YYYY-MM-DD', status: "'draft' 盤點中｜'confirmed' 已確認", by: '建立者', confirmedBy: '確認者', confirmedAt: '確認時間（毫秒）', note: '備註',
        items: '[{ id, materialId, bookUnfolded, bookFolded, countUnfolded, countFolded }]：帳面數與實盤數（未折盒／已折盒）；id＝包材 id 字串（多人同時盤點才能逐項合併）'
      }
    },
    packRecords: {
      label: '裝盒回報（2026-10-15 取消，舊紀錄保留、不再扣庫存）', type: 'array',
      fields: {
        id: '唯一代號', date: '裝盒日期 YYYY-MM-DD', productId: '禮盒 id', boxes: '裝了幾盒', by: '回報者', at: '回報時間（毫秒）', note: '備註', voided: '是否已撤銷 true/false',
        batchId: '同一次送出的批次代號（同一批共用）', materials: '[{ materialId, qty }] 送出當時每盒的包材用量（配方快照；庫存優先用它扣）'
      }
    },
    users: {
      label: '人員與權限', type: 'array',
      fields: {
        id: '唯一代號', name: '姓名', active: '是否啟用 true/false', pages: '可以使用的頁面代號的清單，例如 materials、xQuickEntry（首頁人人可看）',
        salt: '登入碼加密用的隨機值', hash: '登入碼加密後的結果（PBKDF2-SHA256，不存明碼）', iter: '加密次數',
        createdAt: '建立時間（毫秒）', createdBy: '建立者', updatedAt: '最後修改時間（毫秒）', updatedBy: '最後修改者'
      }
    },
    hqStock: {
      label: '總表現貨', type: 'object',
      fields: {
        date: '總表日期 YYYY-MM-DD', updatedAt: '同步時間（毫秒）', updatedBy: '同步的人', source: '資料來源說明',
        items: '{ 品號: 現貨數量 }，來自入口網站總表的「剩餘庫存 → 現貨」（見 js/ext/page-hqstock.js）'
      }
    },
    calcRules: {
      label: '計算規則', type: 'object',
      fields: {
        '（參數代號）': '各參數的設定值；有哪些參數、預設值與合法範圍見 js/calc-rules.js 的 DEFS，沒設定的一律用預設值',
        _meta: '{ by: 最後修改者, at: 最後修改時間（毫秒） }'
      }
    },
    calcRulesLog: {
      label: '計算規則修改紀錄', type: 'array',
      fields: { id: '唯一代號', at: '修改時間（毫秒）', by: '修改者', key: '參數代號', label: '參數名稱', from: '原本的值（文字）', to: '改成的值（文字）' }
    },
    appSettings: {
      label: '系統設定', type: 'object',
      fields: {
        notify: '{ dailyAlert: bool, weeklyReport: bool, alertEmails: [Email], reportEmails: [Email], lineEnabled: bool }',
        sheetExport: '{ enabled: bool, viewerEmails: [Email] }', roles: '{ note: 權限分級的規劃說明 }'
      }
    }
  };

  function defaultFor(key) {
    var t = DATASETS[key] && DATASETS[key].type;
    if (key === 'appSettings') {
      return { notify: { dailyAlert: false, weeklyReport: false, alertEmails: [], reportEmails: [], lineEnabled: false }, sheetExport: { enabled: false, viewerEmails: [] }, roles: {} };
    }
    return t === 'array' ? [] : {};
  }
  function validType(key, v) {
    var t = DATASETS[key] && DATASETS[key].type;
    if (t === 'array') return Array.isArray(v);
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  // ---------- 存取 ----------
  function getDb() { try { return db; } catch (e) { return null; } } // 原系統的全域變數，載入完成後才有
  function get(key) {
    var d = getDb();
    if (d && validType(key, d[key])) return d[key];
    return defaultFor(key);
  }
  function ensure(key) {
    if (!DATASETS[key]) throw new Error('未定義的資料集：' + key);
    var d = getDb();
    if (!d) throw new Error('系統還沒載入完成');
    if (!validType(key, d[key])) d[key] = defaultFor(key);
    return d[key];
  }
  function save(opts) {
    var d = getDb();
    if (!d) return false;
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch (e) {
      alert('儲存失敗：' + e.message);
      return false;
    }
    if (!(opts && opts.silent)) renderActive();
    return true;
  }

  // ---------- 工具 ----------
  function uid(prefix) { return (prefix || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { var n = Number(v); return Number.isFinite(n) ? n : 0; }
  function fmt(n, digits) { return num(n).toLocaleString('zh-TW', { maximumFractionDigits: digits == null ? 0 : digits }); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fmtTime(ms) { if (!ms) return ''; var d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
  function userName() {
    try { var p = root.CMSAccess && CMSAccess.name(); if (p) return p; } catch (e) {} // 有人員登入時，紀錄的輸入者用登入的人
    try { var c = root.CMSCloud && CMSCloud.getConfig(); return (c && c.name) || '本機使用者'; } catch (e) { return '本機使用者'; }
  }
  function isAdmin() { return document.body.classList.contains('admin-mode'); }
  function toast(t) { if (root.cmsToast) root.cmsToast(t); }
  function deptLabel(k) { var d = DEPTS.find(function (x) { return x.key === k; }); return d ? d.label : (k === 'none' ? '不計算' : (k || '')); }

  // 原系統資料（唯讀）
  function products() { return (getDb() && getDb().products) || []; }
  function gifts() { return products().filter(function (p) { return String(p.category || '').trim() !== '單條'; }); }
  function singles() { return products().filter(function (p) { return String(p.category || '').trim() === '單條'; }); }
  function materials() { return (getDb() && getDb().materials) || []; }
  function recipes() { return (getDb() && getDb().recipes) || []; }
  function components() { return (getDb() && getDb().components) || []; }
  function orders() { var d = getDb(); return (d && Array.isArray(d.orderHistory)) ? d.orderHistory : []; }
  function productById(id) { return products().find(function (p) { return String(p.id) === String(id); }); }
  function materialById(id) { return materials().find(function (m) { return String(m.id) === String(id); }); }
  function productLabel(p) { if (typeof p !== 'object') p = productById(p); return p ? ((p.code ? p.code + ' ' : '') + p.name) : '（已刪除）'; }
  function materialLabel(m) { if (typeof m !== 'object') m = materialById(m); return m ? ((m.code ? m.code + ' ' : '') + m.name) : '（已刪除）'; }
  function productPrice(p) { try { if (typeof sfUnitPrice === 'function') return num(sfUnitPrice(p)); } catch (e) {} return num(p && p.price); }
  // 包材目前庫存（與首頁同一套算法）：{ total, unfolded, folded }
  function materialStock(id) {
    try { if (typeof materialLiveInventory === 'function') return materialLiveInventory(id); } catch (e) {}
    return { total: 0, unfolded: 0, folded: 0 };
  }
  // 訂單屬於哪一種檔期（沿用原系統 orderMatchesSeason：過年 1–2 月、中秋 8–10 月）
  function orderSeasonKind(r) {
    try {
      if (typeof orderMatchesSeason === 'function') {
        if (orderMatchesSeason(r, 'newyear')) return 'newyear';
        if (orderMatchesSeason(r, 'midautumn')) return 'midautumn';
      }
    } catch (e) {}
    return 'other';
  }
  function activeSeason() { return get('seasons').find(function (s) { return s.status === 'active'; }) || null; }

  // ---------- 畫面元件 ----------
  var ui = {
    // cols: [{ key, label, num, render(row) }]
    table: function (cols, rows, opts) {
      opts = opts || {};
      if (!rows.length) return ui.empty(opts.empty || '目前沒有資料');
      return '<div class="tablewrap"><table class="x-table"><thead><tr>' +
        cols.map(function (c) { return '<th' + (c.num ? ' class="num"' : '') + '>' + esc(c.label) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr>' + cols.map(function (c) {
            var v = c.render ? c.render(r) : esc(r[c.key]);
            return '<td' + (c.num ? ' class="num"' : '') + '>' + (v == null ? '' : v) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
    },
    empty: function (text, actionHtml) { return '<div class="x-empty">' + esc(text) + (actionHtml ? '<div class="x-empty-act">' + actionHtml + '</div>' : '') + '</div>'; },
    banner: function (tone, html) { return '<div class="x-banner x-' + (tone || 'info') + '">' + html + '</div>'; },
    tag: function (text, tone) { return '<span class="x-tag x-' + (tone || 'muted') + '">' + esc(text) + '</span>'; },
    card: function (title, bodyHtml, actionsHtml) {
      return '<div class="panel x-card"><div class="x-card-head"><h2>' + esc(title) + '</h2>' + (actionsHtml ? '<div class="x-actions">' + actionsHtml + '</div>' : '') + '</div>' + bodyHtml + '</div>';
    },
    kpis: function (items) { // [{ label, value, tone, sub }]
      return '<div class="x-kpis">' + items.map(function (k) {
        return '<div class="x-kpi x-' + (k.tone || 'muted') + '"><span>' + esc(k.label) + '</span><strong>' + esc(k.value) + '</strong>' + (k.sub ? '<small>' + esc(k.sub) + '</small>' : '') + '</div>';
      }).join('') + '</div>';
    },
    // 表單欄位：{ name, label, type: text|number|date|select|textarea|checkbox|email, options: [{value,label}], value, placeholder, required, step, min, full }
    field: function (f) {
      var id = 'xf_' + f.name + '_' + Math.random().toString(36).slice(2, 6);
      var attrs = ' id="' + id + '" data-field="' + esc(f.name) + '"' + (f.required ? ' required' : '') + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '');
      var input;
      if (f.type === 'select') {
        input = '<select' + attrs + '>' + (f.options || []).map(function (o) {
          return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(f.value == null ? '' : f.value) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
        }).join('') + '</select>';
      } else if (f.type === 'textarea') {
        input = '<textarea' + attrs + ' rows="' + (f.rows || 2) + '">' + esc(f.value) + '</textarea>';
      } else if (f.type === 'checkbox') {
        return '<label class="x-check' + (f.full ? ' x-full' : '') + '"><input type="checkbox"' + attrs + (f.value ? ' checked' : '') + '> ' + esc(f.label) + '</label>';
      } else {
        input = '<input type="' + (f.type || 'text') + '"' + attrs + ' value="' + esc(f.value) + '"' + (f.step != null ? ' step="' + f.step + '"' : '') + (f.min != null ? ' min="' + f.min + '"' : '') + '>';
      }
      return '<label class="x-field' + (f.full ? ' x-full' : '') + '" for="' + id + '"><span>' + esc(f.label) + (f.required ? ' <i>*</i>' : '') + '</span>' + input + '</label>';
    },
    form: function (fields) { return '<div class="x-form">' + fields.map(ui.field).join('') + '</div>'; },
    // 讀取容器內所有 data-field 的值；number 欄位轉成數字，checkbox 轉成 true/false
    read: function (container) {
      var out = {};
      container.querySelectorAll('[data-field]').forEach(function (el) {
        var k = el.dataset.field;
        if (el.type === 'checkbox') out[k] = el.checked;
        else if (el.type === 'number') out[k] = el.value === '' ? null : num(el.value);
        else out[k] = el.value.trim();
      });
      return out;
    },
    options: function (list, valueKey, labelFn, emptyLabel) {
      var opts = emptyLabel != null ? [{ value: '', label: emptyLabel }] : [];
      return opts.concat(list.map(function (x) { return { value: x[valueKey || 'id'], label: labelFn ? labelFn(x) : x.name }; }));
    },
    // 簡易對話框：fields 同 ui.field；onSave(values) 回傳 false 表示不要關閉
    dialog: function (title, fields, onSave, saveLabel) {
      var mask = document.createElement('div');
      mask.className = 'cms-modal show x-dialog';
      mask.innerHTML = '<div class="cms-modal-box"><div class="cms-modal-head"><h3>' + esc(title) + '</h3></div>' + ui.form(fields) +
        '<div class="cms-modal-actions"><span class="spacer"></span><button type="button" class="btn gray" data-x="cancel">取消</button><button type="button" class="btn primary" data-x="ok">' + esc(saveLabel || '儲存') + '</button></div></div>';
      document.body.appendChild(mask);
      var close = function () { mask.remove(); };
      mask.addEventListener('click', function (e) {
        var a = e.target.closest('[data-x]');
        if (e.target === mask || (a && a.dataset.x === 'cancel')) close();
        else if (a && a.dataset.x === 'ok') {
          var missing = Array.prototype.filter.call(mask.querySelectorAll('[required]'), function (el) { return !String(el.value).trim(); });
          if (missing.length) { missing[0].focus(); return; }
          if (onSave(ui.read(mask)) !== false) close();
        }
      });
      var first = mask.querySelector('[data-field]');
      if (first) setTimeout(function () { first.focus(); }, 30);
      return mask;
    }
  };

  // ---------- 頁面註冊 ----------
  var GROUPS = [
    { key: 'home' }, { key: 'daily', label: '每日作業', after: 'home' },
    { key: 'master' }, { key: 'plan' }, { key: 'season', label: '檔期與業績', after: 'plan' },
    { key: 'data' }, { key: 'system', label: '系統設定', after: 'data' }
  ];
  var STAGE_TEXT = {
    skeleton: '架構版：這一頁的資料欄位和版面已經建好，計算與串接會在後續階段完成。',
    beta: '測試中：資料可以輸入並同步給所有人，但還沒有影響庫存與補貨計算。'
  };
  var pages = {};

  function groupEl(key) {
    var nav = document.getElementById('nav');
    var el = nav.querySelector('.nav-group[data-group="' + key + '"]');
    if (el) return el;
    var def = GROUPS.find(function (g) { return g.key === key; });
    if (!def) throw new Error('未定義的選單群組：' + key);
    var label = document.createElement('div');
    label.className = 'nav-label';
    label.dataset.groupLabel = key;
    label.innerHTML = esc(def.label) + '<i class="lock-hint">需管理員</i>';
    el = document.createElement('div');
    el.className = 'nav-group';
    el.dataset.group = key;
    var after = def.after ? groupEl(def.after) : null;
    if (after) { after.after(label); label.after(el); } else { nav.appendChild(label); nav.appendChild(el); }
    return el;
  }

  function registerPage(def) {
    if (!def || !def.id || pages[def.id]) throw new Error('頁面代號重複或缺少：' + (def && def.id));
    def.admin = def.admin !== false;
    def.stage = def.stage || 'skeleton';
    pages[def.id] = def;
    // hidden：只提供畫面給其他地方使用（例如首頁分頁），不出現在選單、也不建立獨立頁面
    if (def.hidden) return;
    var btn = document.createElement('button');
    btn.className = 'navbtn' + (def.admin ? ' admin-nav' : '');
    btn.dataset.page = def.id;
    btn.dataset.ext = '1';
    btn.innerHTML = '<svg viewBox="0 0 24 24">' + (def.icon || '<circle cx="12" cy="12" r="8"/>') + '</svg><span>' + esc(def.title) + '</span>' +
      (def.stage !== 'ready' ? '<em class="x-stage-dot" title="' + (def.stage === 'beta' ? '測試中' : '架構版') + '"></em>' : '');
    var group = groupEl(def.group || 'system');
    var siblings = Array.prototype.filter.call(group.querySelectorAll('.navbtn[data-ext]'), function (b) { return (pages[b.dataset.page].order || 0) > (def.order || 0); });
    if (siblings.length) group.insertBefore(btn, siblings[0]); else group.appendChild(btn);

    var section = document.createElement('section');
    section.id = def.id;
    section.className = 'page x-page';
    section.innerHTML = (STAGE_TEXT[def.stage] ? ui.banner(def.stage === 'beta' ? 'warn' : 'info', esc(STAGE_TEXT[def.stage])) : '') + '<div class="x-body"></div>';
    var main = document.querySelector('.app-content main') || document.querySelector('main');
    main.appendChild(section);
  }

  // 切換到某一頁（新頁面或原系統頁面的 data-page 代號）；未登入管理員時原系統會自動要求登入
  function goPage(id) {
    var b = document.querySelector('#nav .navbtn[data-page="' + id + '"]');
    if (b) b.click();
    return !!b;
  }

  function pageInfo(id) { var p = pages[id]; return p ? [p.title, p.sub || ''] : null; }

  var rendering = false;
  function renderActive() {
    if (rendering) return;
    var sec = document.querySelector('.page.x-page.active');
    if (!sec || !pages[sec.id] || !getDb()) return;
    rendering = true;
    try { pages[sec.id].render(sec.querySelector('.x-body'), api); }
    catch (e) { console.error('頁面顯示錯誤：' + sec.id, e); sec.querySelector('.x-body').innerHTML = ui.banner('bad', '這一頁顯示時發生錯誤：' + esc(e.message)); }
    finally { rendering = false; }
  }

  // 切換頁面後重畫；原系統的 render() 執行後（包含收到同事的雲端更新）也重畫目前的新頁面
  document.addEventListener('click', function (e) {
    if (e.target.closest('#nav .navbtn[data-page]')) setTimeout(renderActive, 0);
  });
  // 外框按 Escape 只會拿掉 .cms-modal 的 show；新功能的對話框（.x-dialog）直接移除，避免藏在畫面裡越積越多
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    setTimeout(function () { document.querySelectorAll('.x-dialog').forEach(function (m) { m.remove(); }); }, 0);
  });
  root.addEventListener('load', function () {
    if (typeof root.render === 'function' && !root.render.__cmsx) {
      var original = root.render;
      var wrapped = function () { var r = original.apply(this, arguments); try { renderActive(); } catch (e) {} return r; };
      wrapped.__cmsx = true;
      root.render = wrapped;
    }
  });

  var api = {
    KEY: KEY, DEPTS: DEPTS, NON_REVENUE_DEPTS: NON_REVENUE_DEPTS, DATASETS: DATASETS,
    get: get, ensure: ensure, save: save, db: getDb,
    uid: uid, esc: esc, num: num, fmt: fmt, today: today, fmtTime: fmtTime, daysBetween: daysBetween,
    userName: userName, isAdmin: isAdmin, toast: toast, deptLabel: deptLabel,
    products: products, gifts: gifts, singles: singles, materials: materials, recipes: recipes, components: components, orders: orders,
    productById: productById, materialById: materialById, productLabel: productLabel, materialLabel: materialLabel, productPrice: productPrice,
    materialStock: materialStock, orderSeasonKind: orderSeasonKind, activeSeason: activeSeason,
    ui: ui, registerPage: registerPage, pageInfo: pageInfo, goPage: goPage, renderActive: renderActive, pages: pages
  };
  root.CMSX = api;
})(window);

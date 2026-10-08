/*
 * 雲端同步層
 * 原系統把全部資料以 JSON 存在 localStorage[KEY]。這裡攔截該 KEY 的讀寫：
 *  - 資料改存 IndexedDB（不受 localStorage 5MB 限制，可離線使用）
 *  - 依資料第一層欄位（materials、products、orderHistory…）分別上傳到 Google Apps Script 後端
 *  - 多人同時修改時，以「共同基準 + 雙方修改」自動合併；同一欄位被改成不同值才詢問
 * 原系統程式碼完全不需要知道雲端的存在。
 */
(function () {
  'use strict';

  var APP_KEY = 'campaign_material_system_v1';
  var CFG_KEY = 'cms_cloud_config';
  var IDB_NAME = 'cms-app-data';
  var STORE = 'kv';
  var POLL_MS = 30000;
  var PUSH_DELAY_MS = 1200;

  var LABELS = {
    materials: '包材資料', products: '禮盒資料', recipes: '禮盒配方', components: '單條資料',
    campaigns: '檔期需求', stock: '庫存異動', initialStock: '初始庫存', homeOrder: '首頁排序',
    foldingRecords: '每日折盒統計', foldingArchive: '折盒封存紀錄', salesForecastV5: '業績預估',
    orderHistory: '過去訂單紀錄'
  };

  var nativeGet = Storage.prototype.getItem;
  var nativeSet = Storage.prototype.setItem;
  var nativeRemove = Storage.prototype.removeItem;

  // ---------- 狀態 ----------
  var parts = Object.create(null);   // 欄位 -> JSON 字串（目前本機值）
  var bases = Object.create(null);   // 欄位 -> 上次與雲端一致時的 JSON 字串（僅本機有未上傳修改時保存）
  var vers = Object.create(null);    // 欄位 -> 雲端版本號
  var dirty = new Set();             // 尚未上傳的欄位
  var hasData = false;
  var appRunning = false;
  var pushing = false, pulling = false;
  var pushTimer = null, retryDelay = 4000;
  var status = { state: 'local', detail: '', lastSync: 0 };
  var listeners = [];
  var idb = null;
  var pendingRender = false;
  var blocked = Object.create(null); // 雲端拒絕儲存的欄位 -> 錯誤訊息（再次修改或按「儲存並同步」才重試）
  var serverErrors = 0;

  function lsRef() { try { return window.localStorage; } catch (e) { return null; } }
  function isAppKey(store, k) { return k === APP_KEY && store === lsRef(); }
  function label(k) { return LABELS[k] || k; }

  // ---------- 設定 ----------
  function getConfig() {
    try {
      var c = JSON.parse(nativeGet.call(localStorage, CFG_KEY) || 'null');
      if (c && c.url && c.token) return c;
    } catch (e) {}
    var preset = window.CMS_CLOUD_PRESET || {};
    var token = null;
    try { token = nativeGet.call(localStorage, CFG_KEY + '_token'); } catch (e) {}
    if (preset.url && token) return { url: preset.url, token: token, name: '' };
    return null;
  }

  // ---------- IndexedDB ----------
  function idbOpen() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) return resolve(null);
      var req;
      try { req = indexedDB.open(IDB_NAME, 1); } catch (e) { return resolve(null); }
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
  }
  function idbAll() {
    return new Promise(function (resolve) {
      if (!idb) return resolve({});
      var out = {};
      var tx = idb.transaction(STORE, 'readonly');
      var cur = tx.objectStore(STORE).openCursor();
      cur.onsuccess = function () {
        var c = cur.result;
        if (c) { out[c.key] = c.value; c.continue(); } else resolve(out);
      };
      cur.onerror = function () { resolve(out); };
    });
  }
  function idbWrite(puts, dels) {
    if (!idb) return;
    try {
      var tx = idb.transaction(STORE, 'readwrite');
      var st = tx.objectStore(STORE);
      Object.keys(puts || {}).forEach(function (k) { st.put(puts[k], k); });
      (dels || []).forEach(function (k) { st.delete(k); });
    } catch (e) { console.warn('本機快取寫入失敗', e); }
  }
  function metaRecord() {
    var cfg = getConfig();
    return { vers: Object.assign({}, vers), dirty: Array.from(dirty), cloud: cfg ? cfg.url : '', rebase: !!window.__cmsCloudRebase };
  }
  function saveMeta() { idbWrite({ meta: metaRecord() }); }

  // ---------- 組合 / 拆解 ----------
  function assemble() {
    return '{' + Object.keys(parts).map(function (k) { return JSON.stringify(k) + ':' + parts[k]; }).join(',') + '}';
  }

  // 接收原系統寫入的整份資料，找出有變動的欄位
  function ingest(str) {
    var obj;
    try { obj = JSON.parse(str); } catch (e) { console.warn('資料格式錯誤，未儲存', e); return; }
    if (!obj || typeof obj !== 'object') return;
    var next = Object.create(null);
    Object.keys(obj).forEach(function (k) {
      var s = JSON.stringify(obj[k]);
      if (s !== undefined) next[k] = s;
    });
    var puts = {}, dels = [], changed = false;
    function markDirty(k) {
      if (!dirty.has(k)) {
        bases[k] = (k in parts) ? parts[k] : null;
        puts['b:' + k] = bases[k];
        dirty.add(k);
      }
      changed = true;
    }
    Object.keys(next).forEach(function (k) {
      if (parts[k] !== next[k]) { markDirty(k); delete blocked[k]; parts[k] = next[k]; puts['p:' + k] = next[k]; }
    });
    Object.keys(parts).forEach(function (k) {
      if (!(k in next)) { markDirty(k); delete parts[k]; dels.push('p:' + k); }
    });
    hasData = true;
    if (!changed) return;
    // 保持欄位順序與原系統一致
    var ordered = Object.create(null);
    Object.keys(next).forEach(function (k) { ordered[k] = next[k]; });
    parts = ordered;
    puts.meta = metaRecord();
    idbWrite(puts, dels);
    if (getConfig()) { setStatus('pending'); schedulePush(); }
  }

  // ---------- 攔截 localStorage ----------
  Storage.prototype.getItem = function (k) {
    if (isAppKey(this, k)) return hasData ? assemble() : null;
    return nativeGet.call(this, k);
  };
  Storage.prototype.setItem = function (k, v) {
    if (isAppKey(this, k)) { ingest(String(v)); return; }
    return nativeSet.call(this, k, v);
  };
  Storage.prototype.removeItem = function (k) {
    if (isAppKey(this, k)) { ingest('{}'); return; }
    return nativeRemove.call(this, k);
  };

  // ---------- 三方合併 ----------
  function same(a, b) { return a === b || JSON.stringify(a) === JSON.stringify(b); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function idArray(a) {
    if (!Array.isArray(a)) return false;
    var seen = new Set();
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (!isObj(x) || x.id === undefined || x.id === null || x.id === '') return false;
      var id = String(x.id);
      if (seen.has(id)) return false;
      seen.add(id);
    }
    return true;
  }
  // 回傳 { v: 合併結果, conflicts: [路徑...] }；衝突欄位依 prefer（'local' | 'remote'）取值
  function merge3(b, l, r, prefer, path) {
    path = path || '';
    if (same(l, r)) return { v: l, conflicts: [] };
    if (b !== undefined && same(b, l)) return { v: r, conflicts: [] };
    if (b !== undefined && same(b, r)) return { v: l, conflicts: [] };
    var conflicts = [];
    function mergeEntry(bv, hasB, lv, hasL, rv, hasR, p) {
      if (hasL && hasR) { var m = merge3(hasB ? bv : undefined, lv, rv, prefer, p); conflicts = conflicts.concat(m.conflicts); return { keep: true, v: m.v }; }
      if (hasL) { // 雲端沒有
        if (!hasB) return { keep: true, v: lv };          // 本機新增
        if (same(bv, lv)) return { keep: false };          // 雲端已刪除
        conflicts.push(p); return prefer === 'remote' ? { keep: false } : { keep: true, v: lv };
      }
      if (hasR) { // 本機沒有
        if (!hasB) return { keep: true, v: rv };          // 雲端新增
        if (same(bv, rv)) return { keep: false };          // 本機已刪除
        conflicts.push(p); return prefer === 'remote' ? { keep: true, v: rv } : { keep: false };
      }
      return { keep: false };
    }
    if (isObj(l) && isObj(r)) {
      var bo = isObj(b) ? b : {};
      var out = {};
      var keys = Object.keys(l).concat(Object.keys(r).filter(function (k) { return !(k in l); }));
      keys.forEach(function (k) {
        var e = mergeEntry(bo[k], k in bo, l[k], k in l, r[k], k in r, path + '.' + k);
        if (e.keep) out[k] = e.v;
      });
      return { v: out, conflicts: conflicts };
    }
    if (idArray(l) && idArray(r) && (b === undefined || idArray(b))) {
      var mapOf = function (a) { var m = new Map(); (a || []).forEach(function (x) { m.set(String(x.id), x); }); return m; };
      var bm = mapOf(b), lm = mapOf(l), rm = mapOf(r);
      var order = r.map(function (x) { return String(x.id); });
      // 本機新增的項目插回本機原本的相對位置
      l.forEach(function (x, i) {
        var id = String(x.id);
        if (rm.has(id)) return;
        var prev = i > 0 ? String(l[i - 1].id) : null;
        var at = prev === null ? 0 : order.indexOf(prev) + 1;
        if (prev !== null && at === 0) at = order.length;
        order.splice(at, 0, id);
      });
      var res = [];
      order.forEach(function (id) {
        var e = mergeEntry(bm.get(id), bm.has(id), lm.get(id), lm.has(id), rm.get(id), rm.has(id), path + '[' + id + ']');
        if (e.keep) res.push(e.v);
      });
      return { v: res, conflicts: conflicts };
    }
    return { v: prefer === 'remote' ? r : l, conflicts: [path || '(整筆)'] };
  }

  // ---------- 網路 ----------
  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('連線逾時')); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) {
        clearTimeout(t);
        reject(e instanceof TypeError ? new Error(navigator.onLine === false ? '目前沒有網路' : '無法連線到雲端（網路不穩，或雲端網址／部署設定有誤）') : e);
      });
    });
  }
  function apiGet(cfg, params, ms) {
    var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    var url = cfg.url + (cfg.url.indexOf('?') < 0 ? '?' : '&') + 'token=' + encodeURIComponent(cfg.token) + '&' + q + '&_=' + Date.now();
    return withTimeout(fetch(url, { method: 'GET', redirect: 'follow', cache: 'no-store' }), ms || 30000)
      .then(readJson)
      .then(checkResp);
  }
  function apiPost(cfg, body, ms) {
    body.token = cfg.token;
    return withTimeout(fetch(cfg.url, {
      method: 'POST', redirect: 'follow', cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }), ms || 120000)
      .then(readJson)
      .then(checkResp);
  }
  function readJson(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json().catch(function () {
      var e = new Error('雲端回應的不是資料（請確認網址結尾是 /exec，且部署的「誰可以存取」是「所有人」）');
      e.code = 'bad_response';
      throw e;
    });
  }
  function checkResp(j) {
    if (!j || !j.ok) {
      var code = j && j.error;
      var msg = code === 'unauthorized' ? '團隊通行碼錯誤'
        : code === 'busy' ? '雲端忙碌中，稍後自動重試'
        : code === 'server' ? '雲端發生錯誤：' + (j.message || '')
        : (code || '雲端回應錯誤');
      var err = new Error(msg);
      err.code = code;
      throw err;
    }
    return j;
  }
  function isHardError(e) { return e.code === 'unauthorized' || e.code === 'server' || e.code === 'bad_response'; }
  function fetchKeys(cfg, keys) {
    // 分批避免網址過長
    var batches = [], cur = [];
    keys.forEach(function (k) { cur.push(k); if (cur.join(',').length > 1500) { batches.push(cur); cur = []; } });
    if (cur.length) batches.push(cur);
    var data = {};
    return batches.reduce(function (p, b) {
      return p.then(function () {
        return apiGet(cfg, { action: 'get', keys: b.join(',') }, 120000).then(function (j) { Object.assign(data, j.data || {}); });
      });
    }, Promise.resolve()).then(function () { return data; });
  }

  // ---------- 下載 ----------
  var unresolved = null; // { keys:[], conflicts:{key:[paths]}, remote:{key:{v,value}} }

  function pull(opts) {
    opts = opts || {};
    var cfg = getConfig();
    if (!cfg || pulling || pushing) return Promise.resolve(false);
    pulling = true;
    var rec = false;
    if (opts.initial) setStatus('syncing', '正在讀取雲端資料…');
    return apiGet(cfg, { action: 'meta' }, opts.initial ? 15000 : 20000).then(function (j) {
      var meta = j.meta || {};
      var remoteKeys = Object.keys(meta).filter(function (k) { return !meta[k].deleted; });
      var cloudEmpty = remoteKeys.length === 0;
      rec = !!window.__cmsCloudRebase;
      if (rec) {
        // 旗標要等整個下載成功才清除（見下方），中途失敗或重新整理後會重做一次
        // 剛切換到新的雲端：雲端是空的就把本機資料上傳；否則以雲端為準
        Object.keys(vers).forEach(function (k) { delete vers[k]; });
        if (cloudEmpty) {
          Object.keys(parts).forEach(function (k) { bases[k] = null; dirty.add(k); });
        } else {
          dirty.clear(); Object.keys(bases).forEach(function (k) { delete bases[k]; });
        }
      }
      // 雲端遺失了本機記錄過的欄位（例如後端被重設）：版本歸零並重新上傳本機資料
      Object.keys(vers).forEach(function (k) {
        if (!(k in meta) && vers[k]) {
          vers[k] = 0;
          if (k in parts && !dirty.has(k)) { bases[k] = null; dirty.add(k); }
        }
      });
      var toFetch = [], deletedRemote = [];
      remoteKeys.forEach(function (k) { if ((vers[k] | 0) !== (meta[k].v | 0)) toFetch.push(k); });
      Object.keys(meta).forEach(function (k) {
        if (meta[k].deleted && (vers[k] | 0) !== (meta[k].v | 0)) deletedRemote.push(k);
      });
      if (cloudEmpty && hasData && !rec) {
        // 全新的雲端：上傳本機現有資料
        Object.keys(parts).forEach(function (k) { if ((vers[k] | 0) === 0 && !dirty.has(k)) { bases[k] = null; dirty.add(k); } });
      }
      if (!toFetch.length && !deletedRemote.length) return { changed: [] };
      return (toFetch.length ? fetchKeys(cfg, toFetch) : Promise.resolve({})).then(function (data) {
        deletedRemote.forEach(function (k) { data[k] = { v: meta[k].v, value: null }; });
        flushLegacy();
        return applyRemote(data);
      });
    }).then(function (res) {
      pulling = false;
      if (rec) { window.__cmsCloudRebase = false; saveMeta(); }
      status.lastSync = Date.now();
      if (unresolved) setStatus('conflict');
      else if (dirty.size) { setStatus('pending'); schedulePush(0); }
      else setStatus('synced');
      if (res && res.changed && res.changed.length && appRunning) refreshApp(res.changed, res.merged);
      return true;
    }).catch(function (e) {
      pulling = false;
      setStatus(isHardError(e) ? 'error' : 'offline', e.message);
      return false;
    });
  }

  // 套用雲端資料；本機也改過的欄位做三方合併
  function applyRemote(data) {
    var puts = {}, dels = [], changed = [], merged = [], conflicts = {};
    Object.keys(data).forEach(function (k) {
      var d = data[k];
      var remoteStr = d.value;
      if (d.missing) { // 雲端檔案遺失：用這台裝置的資料重建
        vers[k] = d.v;
        if (k in parts && !dirty.has(k)) { bases[k] = null; puts['b:' + k] = null; dirty.add(k); }
        return;
      }
      if (dirty.has(k) && bases[k] == null && !(vers[k] | 0) && remoteStr != null) {
        // 這台裝置從未和雲端同步過這個欄位（例如第一次開啟時寫入的內建範例資料）：以雲端為準，不合併
        dirty.delete(k); delete bases[k]; dels.push('b:' + k);
        if (parts[k] !== remoteStr) { parts[k] = remoteStr; puts['p:' + k] = remoteStr; changed.push(k); }
        vers[k] = d.v;
        return;
      }
      if (dirty.has(k)) {
        var b = bases[k], l = k in parts ? parts[k] : null;
        if (remoteStr === l) { // 內容其實一樣
          vers[k] = d.v; dirty.delete(k); delete bases[k]; dels.push('b:' + k); return;
        }
        var bv = b == null ? undefined : JSON.parse(b);
        var lv = l == null ? undefined : JSON.parse(l);
        var rv = remoteStr == null ? undefined : JSON.parse(remoteStr);
        if (lv === undefined || rv === undefined) {
          conflicts[k] = ['(整筆被刪除)'];
          unresolvedRemote(k, d);
          return;
        }
        var m = merge3(bv, lv, rv, 'local');
        if (m.conflicts.length) { conflicts[k] = m.conflicts; unresolvedRemote(k, d); return; }
        var s = JSON.stringify(m.v);
        parts[k] = s; puts['p:' + k] = s;
        // 合併後的結果以新的雲端版本為基準，仍需上傳
        bases[k] = remoteStr; puts['b:' + k] = remoteStr;
        vers[k] = d.v;
        changed.push(k); merged.push(k);
      } else {
        if (remoteStr == null) { if (k in parts) { delete parts[k]; dels.push('p:' + k); changed.push(k); } }
        else if (parts[k] !== remoteStr) { parts[k] = remoteStr; puts['p:' + k] = remoteStr; changed.push(k); }
        vers[k] = d.v;
      }
    });
    if (Object.keys(data).length) hasData = hasData || Object.keys(parts).length > 0;
    if (Object.keys(conflicts).length) {
      unresolved = unresolved || { conflicts: {}, remote: {} };
      Object.assign(unresolved.conflicts, conflicts);
    }
    puts.meta = metaRecord();
    idbWrite(puts, dels);
    return { changed: changed, merged: merged };
  }
  function unresolvedRemote(k, d) {
    unresolved = unresolved || { conflicts: {}, remote: {} };
    unresolved.remote[k] = d;
  }

  // 使用者選擇衝突處理方式
  function resolveConflicts(choice) {
    if (!unresolved) return;
    flushLegacy();
    var u = unresolved; unresolved = null;
    var puts = {}, dels = [], changed = [];
    Object.keys(u.remote).forEach(function (k) {
      var d = u.remote[k];
      if (choice === 'remote') {
        if (d.value == null) { delete parts[k]; dels.push('p:' + k); } else { parts[k] = d.value; puts['p:' + k] = d.value; }
        dirty.delete(k); delete bases[k]; dels.push('b:' + k);
      } else {
        var l = k in parts ? parts[k] : null;
        if (l != null && d.value != null) {
          var m = merge3(bases[k] == null ? undefined : JSON.parse(bases[k]), JSON.parse(l), JSON.parse(d.value), 'local');
          parts[k] = JSON.stringify(m.v); puts['p:' + k] = parts[k];
        }
        bases[k] = d.value; puts['b:' + k] = d.value; dirty.add(k);
      }
      vers[k] = d.v;
      changed.push(k);
    });
    puts.meta = metaRecord();
    idbWrite(puts, dels);
    if (appRunning) refreshApp(changed, choice === 'local' ? changed : []);
    if (dirty.size) { setStatus('pending'); schedulePush(0); } else setStatus('synced');
  }

  // ---------- 上傳 ----------
  function schedulePush(delay) {
    if (!getConfig()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, delay == null ? PUSH_DELAY_MS : delay);
  }
  function push() {
    var cfg = getConfig();
    if (!cfg || !dirty.size || unresolved || window.__cmsCloudRebase) return Promise.resolve();
    if (pushing || pulling) { schedulePush(800); return Promise.resolve(); }
    var keys = Array.from(dirty).filter(function (k) { return !blocked[k]; }), sent = {}, changes = {};
    if (!keys.length) { setStatus('error', blockedMsg()); return Promise.resolve(); }
    pushing = true;
    setStatus('syncing', '上傳中…');
    keys.forEach(function (k) {
      sent[k] = k in parts ? parts[k] : null;
      changes[k] = { base: vers[k] | 0, value: sent[k] };
    });
    return apiPost(cfg, { action: 'put', changes: changes, by: cfg.name || '' }).then(function (j) {
      pushing = false; retryDelay = 4000; serverErrors = 0;
      var puts = {}, dels = [];
      Object.keys(j.applied || {}).forEach(function (k) {
        vers[k] = j.applied[k];
        var now = k in parts ? parts[k] : null;
        if (now === sent[k]) { dirty.delete(k); delete bases[k]; dels.push('b:' + k); }
        else { bases[k] = sent[k]; puts['b:' + k] = sent[k]; } // 上傳期間又有修改
      });
      Object.keys(j.rejected || {}).forEach(function (k) {
        // 欄位名稱雲端不接受（例如匯入了含中文欄位名稱的 JSON）：只留在本機，不再重送
        dirty.delete(k); delete bases[k]; dels.push('b:' + k);
        console.warn('雲端不接受的資料欄位，只保留在本機：' + k);
      });
      Object.keys(j.failed || {}).forEach(function (k) { blocked[k] = j.failed[k]; });
      puts.meta = metaRecord();
      idbWrite(puts, dels);
      status.lastSync = Date.now();
      var conflictKeys = Object.keys(j.conflicts || {});
      if (conflictKeys.length) {
        // 有人搶先更新：下載後自動合併再上傳
        return pull();
      }
      var progressed = Object.keys(j.applied || {}).length > 0;
      var sendable = Array.from(dirty).some(function (k) { return !blocked[k]; });
      if (sendable) schedulePush(progressed ? 300 : retryDelay);
      else if (dirty.size) setStatus('error', blockedMsg());
      else setStatus('synced');
    }).catch(function (e) {
      pushing = false;
      if (e.code === 'unauthorized' || e.code === 'bad_response') { setStatus('error', e.message); return; }
      if (e.code === 'server' && ++serverErrors >= 5) { setStatus('error', e.message + '（已停止自動重試，請通知管理者）'); return; }
      setStatus(e.code === 'server' ? 'error' : 'offline', e.message);
      schedulePush(retryDelay); retryDelay = Math.min(retryDelay * 2, 60000);
    });
  }
  function blockedMsg() {
    var k = Object.keys(blocked)[0];
    return k ? '雲端無法儲存「' + label(k) + '」：' + blocked[k] : '';
  }
  // 原系統有些輸入（每日折盒統計、業績預估）延遲 5 秒才寫入；套用雲端資料前先收進同步層，避免被覆蓋
  function flushLegacy() {
    if (!appRunning) return;
    try { if (typeof db === 'object' && db) ingest(JSON.stringify(db)); } catch (e) {}
  }

  // ---------- 將雲端更新套用到正在執行的系統 ----------
  function refreshApp(keys, merged) {
    var d;
    try { d = db; } catch (e) { return; } // 原系統的全域變數
    keys.forEach(function (k) {
      if (k in parts) d[k] = JSON.parse(parts[k]); else delete d[k];
    });
    emit('remote-change', { keys: keys, merged: merged || [] });
    rerender();
  }
  function userBusy() {
    var a = document.activeElement;
    if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return true;
    return !!document.querySelector('.edit-modal-mask.show,.data-edit-mask.show,#adminModal.show,.cms-modal.show');
  }
  function rerender() {
    if (userBusy()) { pendingRender = true; return; }
    pendingRender = false;
    ['render', 'renderDashboard', 'renderInitialStock', 'renderFoldingRecords', 'renderSalesForecast', 'renderOrderHistory'].forEach(function (fn) {
      try { if (typeof window[fn] === 'function') window[fn](); } catch (e) { console.warn('重新繪製失敗：' + fn, e); }
    });
  }
  document.addEventListener('focusout', function () { if (pendingRender) setTimeout(function () { if (pendingRender) rerender(); }, 300); });

  // ---------- 狀態通知 ----------
  function setStatus(state, detail) {
    status.state = state; status.detail = detail || '';
    emit('status', status);
  }
  function emit(type, payload) { listeners.forEach(function (fn) { try { fn(type, payload); } catch (e) {} }); }

  // ---------- 啟動 ----------
  var ready = idbOpen().then(function (db_) {
    idb = db_;
    return idbAll();
  }).then(function (all) {
    var meta = all.meta || {};
    var cfg = getConfig();
    Object.keys(all).forEach(function (k) {
      if (k.indexOf('p:') === 0) parts[k.slice(2)] = all[k];
      else if (k.indexOf('b:') === 0) bases[k.slice(2)] = all[k];
    });
    hasData = Object.keys(parts).length > 0;
    Object.assign(vers, meta.vers || {});
    (meta.dirty || []).forEach(function (k) { dirty.add(k); });
    if (meta.rebase || (cfg && meta.cloud && meta.cloud !== cfg.url)) window.__cmsCloudRebase = true;
    if (!hasData) {
      // 同網址先前使用過舊版（純 localStorage）：搬進來
      try {
        var old = nativeGet.call(localStorage, APP_KEY);
        if (old) { ingest(old); nativeRemove.call(localStorage, APP_KEY); }
      } catch (e) {}
    }
    if (!cfg) { setStatus('local'); return; }
    if (navigator.onLine === false) { setStatus('offline', '目前離線，使用本機資料'); return; }
    return pull({ initial: true });
  }).catch(function (e) { console.error('同步層啟動失敗', e); });

  setInterval(function () {
    if (document.visibilityState === 'visible' && getConfig() && !pushing && navigator.onLine !== false) pull();
  }, POLL_MS);
  window.addEventListener('online', function () { if (getConfig()) { pull(); schedulePush(0); } });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && getConfig()) pull(); });
  // 未上傳的修改已存在本機 IndexedDB，下次開啟會自動補傳，所以關閉頁面時不需要阻擋
  window.addEventListener('pagehide', function () { if (getConfig() && dirty.size) push(); });

  // ---------- 對外介面 ----------
  window.CMSCloud = {
    ready: ready,
    labels: LABELS,
    label: label,
    getConfig: getConfig,
    status: function () { return Object.assign({ dirty: dirty.size, conflicts: unresolved ? unresolved.conflicts : null }, status); },
    on: function (fn) { listeners.push(fn); },
    appStarted: function () { appRunning = true; if (unresolved) setStatus('conflict'); },
    syncNow: function () {
      blocked = Object.create(null); serverErrors = 0;
      return pull().then(function (ok) { return push().then(function () { return ok; }); });
    },
    resolveConflicts: resolveConflicts,
    test: function (cfg) { return apiGet(cfg, { action: 'meta' }, 15000); },
    saveConfig: function (cfg) {
      if (cfg) {
        var prev = getConfig();
        nativeSet.call(localStorage, CFG_KEY, JSON.stringify({ url: cfg.url.trim(), token: cfg.token.trim(), name: (cfg.name || '').trim() }));
        if (!prev || prev.url !== cfg.url.trim()) window.__cmsCloudRebase = true;
      } else {
        nativeRemove.call(localStorage, CFG_KEY);
      }
      saveMeta();
    },
    _merge3: merge3
  };
})();

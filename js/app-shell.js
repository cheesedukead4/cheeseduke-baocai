/* App 外框：載入流程、側邊選單、頁面標題、同步狀態、雲端設定 */
(function () {
  'use strict';

  var LEGACY_SCRIPTS = ['js/legacy-1.js', 'js/legacy-2.js', 'js/legacy-3.js', 'js/legacy-4.js'];
  var PAGE_KEY = 'cms_current_page';
  var PAGES = {
    dashboard: ['首頁', '庫存、需求與可用量總覽'],
    materials: ['包材資料', '管理包裝材料、分類與安全庫存'],
    singles: ['單條資料', '可作為禮盒內容物的單條產品'],
    products: ['禮盒資料', '禮盒品項、售價、上架狀態與配方'],
    campaigns: ['檔期需求', '依檔期建立各禮盒需求數量'],
    initialStock: ['初始庫存', '各包材未折盒／已折盒數量'],
    replenish: ['缺料／建議補貨', '依檔期需求 × 配方自動展開'],
    importcenter: ['資料匯入中心', '從 CSV／JSON 或線上來源匯入'],
    backup: ['備份／還原', '匯出、匯入與搬移資料'],
    orderHistory: ['過去訂單紀錄', '歷年訂單查詢與篩選']
  };
  var STATE_TEXT = {
    local: '本機模式', synced: '已同步', syncing: '同步中…', pending: '等待上傳',
    offline: '離線', error: '連線失敗', conflict: '需要處理'
  };

  var $ = function (id) { return document.getElementById(id); };
  var loadEvent = new Promise(function (r) {
    if (document.readyState === 'complete') r(); else window.addEventListener('load', r, { once: true });
  });

  // ---------- 提示訊息 ----------
  function toast(msg, action, ms) {
    var region = $('toastRegion');
    if (!region) return;
    var el = document.createElement('div');
    el.className = 'toast';
    var span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    if (action) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = action.label;
      b.onclick = function () { el.remove(); action.run(); };
      el.appendChild(b);
    }
    region.appendChild(el);
    setTimeout(function () { el.remove(); }, ms || 5000);
  }
  window.cmsToast = toast;

  // ---------- 新版通知 ----------
  // 網站更新後，一直開著的裝置不會自己換成新版：畫面切回前景時（以及每 30 分鐘）檢查有沒有新版，
  // 新版裝好後提示重新整理。不自動重新整理，避免填到一半的內容不見。
  (function watchUpdate() {
    if (!('serviceWorker' in navigator)) return;
    var hadController = !!navigator.serviceWorker.controller, prompted = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; } // 第一次裝好離線快取，不是新版
      if (prompted) return;
      prompted = true;
      toast('App 有新版本了，請按「重新整理」換成新版後再繼續使用。', { label: '重新整理', run: function () { location.reload(); } }, 600000);
    });
    function check() { navigator.serviceWorker.getRegistration().then(function (r) { if (r) r.update(); }).catch(function () {}); }
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60 * 1000);
  })();

  // ---------- 頁面標題與選單 ----------
  function currentPage() {
    var a = document.querySelector('#nav .navbtn.active');
    return a ? a.dataset.page : 'dashboard';
  }
  function updateTitle(page) {
    var info = PAGES[page] || (window.CMSX && CMSX.pageInfo(page)) || [page, ''];
    $('appPageTitle').textContent = info[0];
    $('appPageSub').textContent = info[1];
    document.title = (page === 'dashboard' ? '' : info[0] + '｜') + '檔期包材管理系統';
  }
  function closeNav() { document.body.classList.remove('nav-open'); }

  function bindShell() {
    $('menuBtn').addEventListener('click', function () { document.body.classList.toggle('nav-open'); });
    $('sidebarScrim').addEventListener('click', closeNav);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      closeNav();
      document.querySelectorAll('.cms-modal.show').forEach(function (m) { if (m.id !== 'conflictModal') m.classList.remove('show'); });
    });
    // 原系統的 nav 切換結束後更新標題（用 setTimeout 讓原本的點擊處理先執行）
    $('nav').addEventListener('click', function (e) {
      var b = e.target.closest('.navbtn[data-page]');
      if (!b) return;
      setTimeout(function () {
        var p = currentPage();
        updateTitle(p);
        try { sessionStorage.setItem(PAGE_KEY, p); } catch (x) {}
        if (b.classList.contains('active')) { closeNav(); window.scrollTo(0, 0); }
      }, 0);
    });
    // 其他程式（例如登出）切換頁面時也同步標題
    new MutationObserver(function () { updateTitle(currentPage()); })
      .observe($('nav'), { subtree: true, attributes: true, attributeFilter: ['class'] });

    document.querySelectorAll('.cms-modal [data-close]').forEach(function (b) {
      b.addEventListener('click', function () { b.closest('.cms-modal').classList.remove('show'); });
    });
    document.querySelectorAll('.cms-modal').forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m && m.id !== 'conflictModal') m.classList.remove('show'); });
    });
  }

  // ---------- 同步狀態 ----------
  function relTime(t) {
    if (!t) return '尚未同步';
    var s = Math.round((Date.now() - t) / 1000);
    if (s < 10) return '剛剛';
    if (s < 60) return s + ' 秒前';
    if (s < 3600) return Math.round(s / 60) + ' 分鐘前';
    return new Date(t).toLocaleString('zh-TW', { hour12: false });
  }
  function renderStatus() {
    var st = CMSCloud.status();
    var chip = $('syncChip');
    chip.dataset.state = st.state;
    $('syncChipText').textContent = STATE_TEXT[st.state] || st.state;
    chip.title = st.detail || '雲端同步設定';
    var box = $('cloudStatusBox');
    if (box) {
      var cfg = CMSCloud.getConfig();
      var lines = {
        local: ['尚未啟用雲端', '資料只存在這台裝置。填入下方設定即可與同事共用。'],
        synced: ['已與雲端同步', '上次同步：' + relTime(st.lastSync)],
        syncing: ['同步中…', st.detail || ''],
        pending: ['有修改等待上傳', '共 ' + st.dirty + ' 類資料'],
        offline: ['目前無法連線', (st.detail ? st.detail + '。' : '') + '修改會先存在這台裝置，恢復連線後自動上傳。'],
        error: ['連線失敗', st.detail || (window.CMSAuth && CMSAuth.enabled ? '請確認網路，或重新登入' : '請確認網址與通行碼')],
        conflict: ['有同時修改需要處理', '請選擇要保留的版本']
      }[st.state] || [st.state, ''];
      box.innerHTML = '';
      var b = document.createElement('b'); b.textContent = lines[0];
      var s = document.createElement('span'); s.textContent = lines[1];
      box.appendChild(b); box.appendChild(s);
      if (cfg && cfg.name) { var n = document.createElement('span'); n.textContent = '使用者：' + cfg.name; box.appendChild(n); }
      if (window.CMSAuth && CMSAuth.enabled && CMSAuth.email()) {
        var ab = $('cloudAuthBox');
        if (ab) { ab.innerHTML = ''; var l1 = document.createElement('div'); l1.innerHTML = '登入帳號：<b></b>'; l1.querySelector('b').textContent = CMSAuth.email(); var l2 = document.createElement('div'); l2.textContent = CMSAuth.isAdmin() ? '身分：管理員（全部頁面）' : '身分：人員（只能用被開放的頁面）'; ab.appendChild(l1); ab.appendChild(l2); }
      }
    }
    if (st.state === 'conflict' && st.conflicts) showConflicts(st.conflicts);
  }

  function showConflicts(conflicts) {
    var list = $('conflictList');
    list.innerHTML = '';
    Object.keys(conflicts).forEach(function (k) {
      var li = document.createElement('li');
      li.textContent = CMSCloud.label(k) + ' ';
      var sm = document.createElement('small');
      var n = conflicts[k].length;
      sm.textContent = n > 1 ? '（' + n + ' 個欄位）' : '';
      li.appendChild(sm);
      list.appendChild(li);
    });
    $('conflictModal').classList.add('show');
  }

  function bindCloud() {
    $('syncChip').addEventListener('click', openCloudModal);
    $('conflictLocalBtn').onclick = function () { $('conflictModal').classList.remove('show'); CMSCloud.resolveConflicts('local'); toast('已保留你的修改並上傳'); };
    $('conflictRemoteBtn').onclick = function () { $('conflictModal').classList.remove('show'); CMSCloud.resolveConflicts('remote'); toast('已改用雲端版本'); };

    var msg = $('cloudTestMsg');
    function readForm() {
      return { url: $('cloudUrl').value.trim(), token: $('cloudToken').value.trim(), name: $('cloudName').value.trim() };
    }
    function validate(c) {
      c.url = c.url.replace(/[?#].*$/, '').replace(/\/+$/, '');
      if (/\/dev$/.test(c.url)) { setMsg('這是「測試部署作業」的 /dev 網址，同事無法使用。請改用結尾是 /exec 的網址', 'err'); return false; }
      if (!/^https:\/\/script\.google\.com\/(macros|a\/macros\/[^\/]+)\/s\/[A-Za-z0-9_-]+\/exec$/.test(c.url)) { setMsg('網址格式不對：請貼上 https://script.google.com/macros/s/…/exec（結尾必須是 /exec）', 'err'); return false; }
      if (!c.token) { setMsg('請輸入團隊通行碼', 'err'); return false; }
      return true;
    }
    function setMsg(t, cls) { msg.textContent = t; msg.className = 'field-msg ' + (cls || ''); }

    $('cloudTestBtn').onclick = function () {
      var c = readForm();
      if (!validate(c)) return;
      setMsg('連線中…');
      CMSCloud.test(c).then(function (j) {
        var n = Object.keys(j.meta || {}).filter(function (k) { return !j.meta[k].deleted; }).length;
        setMsg(n ? '連線成功，雲端已有 ' + n + ' 類資料。' : '連線成功，雲端目前是空的（儲存後會上傳這台裝置的資料）。', 'ok');
      }).catch(function (e) { setMsg('連線失敗：' + e.message, 'err'); });
    };
    $('cloudSaveBtn').onclick = function () {
      var c = readForm();
      if (!validate(c)) return;
      setMsg('連線中…');
      CMSCloud.test(c).then(function (j) {
        var prev = CMSCloud.getConfig();
        var remoteHas = Object.keys(j.meta || {}).some(function (k) { return !j.meta[k].deleted; });
        CMSCloud.saveConfig(c);
        $('cloudModal').classList.remove('show');
        if (!prev || prev.url !== c.url) {
          // 切換雲端：雲端有資料就以雲端為準並重新載入
          toast(remoteHas ? '已連線，正在載入雲端資料…' : '已連線，正在上傳這台裝置的資料…');
          CMSCloud.syncNow().then(function (ok) {
            if (!ok) { toast('雲端資料還沒下載完成，連線穩定後會自動繼續。完成前請先不要修改資料。', null, 9000); return; }
            if (remoteHas) location.reload();
          });
        } else {
          toast('設定已更新');
          CMSCloud.syncNow();
        }
      }).catch(function (e) { setMsg('無法儲存：' + e.message, 'err'); });
    };
    $('cloudSyncBtn').onclick = function () { $('cloudModal').classList.remove('show'); CMSCloud.syncNow().then(function (ok) { toast(ok ? '已同步' : '同步沒有成功，稍後會自動重試'); }); };
    $('cloudLogoutBtn').onclick = function () { $('cloudModal').classList.remove('show'); CMSAuth.logout(); };
    $('cloudDisableBtn').onclick = function () {
      if (!CMSCloud.getConfig()) { $('cloudModal').classList.remove('show'); return; }
      if (!confirm('停用後這台裝置不再與同事同步（資料仍保留在本機）。確定停用？')) return;
      CMSCloud.saveConfig(null);
      $('cloudModal').classList.remove('show');
      renderStatus();
      toast('已停用雲端同步');
    };
  }
  function openCloudModal() {
    if (window.CMSAuth && CMSAuth.enabled) { // Google 登入模式：只顯示帳號、立即同步與登出
      var m = $('cloudModal');
      m.classList.add('auth-mode');
      $('cloudAuthBox').style.display = '';
      $('cloudSyncBtn').style.display = ''; $('cloudLogoutBtn').style.display = '';
      renderStatus();
      m.classList.add('show');
      return;
    }
    var cfg = CMSCloud.getConfig() || {};
    var preset = window.CMS_CLOUD_PRESET || {};
    $('cloudUrl').value = cfg.url || preset.url || '';
    $('cloudToken').value = cfg.token || '';
    $('cloudName').value = cfg.name || '';
    $('cloudTestMsg').textContent = '';
    renderStatus();
    $('cloudModal').classList.add('show');
    setTimeout(function () { ($('cloudUrl').value ? $('cloudToken') : $('cloudUrl')).focus(); }, 50);
  }

  // ---------- 載入原系統程式 ----------
  function loadScript(src) {
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = function () { console.error('無法載入 ' + src); resolve(); };
      document.body.appendChild(s);
    });
  }
  function startLegacy() {
    return LEGACY_SCRIPTS.reduce(function (p, src) { return p.then(function () { return loadScript(src); }); }, Promise.resolve())
      .then(function () {
        // 原程式原本在頁面載入時執行的初始化，以相同順序補觸發
        document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
        window.dispatchEvent(new Event('load'));
      });
  }
  function restorePage() {
    var p = null;
    try { p = sessionStorage.getItem(PAGE_KEY); } catch (e) {}
    if (p && p !== 'dashboard' && (PAGES[p] || (window.CMSX && CMSX.pageInfo(p)))) {
      var b = document.querySelector('#nav .navbtn[data-page="' + p + '"]');
      var needsAdmin = b && b.classList.contains('admin-nav') && !document.body.classList.contains('admin-mode') && !(window.CMSAccess && CMSAccess.canOpen(p));
      if (b && !needsAdmin) b.click();
    }
    updateTitle(currentPage());
  }

  // ---------- 啟動 ----------
  document.addEventListener('DOMContentLoaded', function () {
    bindShell();
    bindCloud();
    CMSCloud.on(function (type, payload) {
      if (type === 'status') renderStatus();
      if (type === 'remote-change') {
        var names = payload.keys.map(CMSCloud.label).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 3).join('、');
        toast((payload.merged.length ? '已合併同事的修改：' : '同事更新了：') + names);
      }
    });
    renderStatus();
    setInterval(function () { if ($('cloudModal').classList.contains('show')) renderStatus(); }, 5000);

    var slow = setTimeout(function () { $('appSplashMsg').textContent = '正在從雲端下載資料，第一次可能需要較久…'; }, 2500);
    Promise.all([CMSCloud.ready, loadEvent]).then(startLegacy).then(function () {
      clearTimeout(slow);
      restorePage();
      CMSCloud.appStarted();
      renderStatus();
      if (window.CMSHqStock) CMSHqStock.applyPending(); // 從入口網站書籤帶來的現貨資料（見 ext/page-hqstock.js）
      // 申請持久儲存，降低瀏覽器自動清除本機資料（含尚未上傳的修改）的機會
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
      var sp = $('appSplash');
      sp.classList.add('hide');
      setTimeout(function () { sp.remove(); }, 300);
      var st = CMSCloud.status();
      if (st.state === 'local' && !sessionStorage.getItem('cms_local_hint')) {
        sessionStorage.setItem('cms_local_hint', '1');
        toast('目前為本機模式，資料不會與同事共用', { label: '設定雲端', run: openCloudModal }, 9000);
      } else if (st.state === 'offline') {
        toast('目前無法連到雲端，先使用這台裝置上的資料');
      }
    });
  }, { once: true });
})();

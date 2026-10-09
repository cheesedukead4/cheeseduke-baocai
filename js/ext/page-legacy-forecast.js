/*
 * 檔期與業績 → 業績預估
 * 沿用原本首頁的「業績預估」表（原系統功能與資料 db.salesForecastV5，完全不變），只是從首頁搬到這一頁。
 * 第一次打開這頁時，把原本的表格搬進來，並拿掉 home-table-panel，讓它不再受首頁分頁切換影響。
 */
(function (X) {
  'use strict';
  if (!X) return;

  function legacyPanel() { return document.querySelector('[data-home-panel="salesForecast"]'); }

  X.registerPage({
    id: 'xSalesForecast',
    group: 'season',
    order: 20,
    title: '業績預估',
    sub: '各部門、各品項的預估業績（原本首頁的業績預估）',
    stage: 'ready',
    icon: '<path d="M4 19h16"/><path d="M6 15l4-4 3 3 5-6"/><path d="M15 8h3v3"/>',
    render: function (el) {
      var p = legacyPanel();
      if (!p) { el.innerHTML = X.ui.empty('找不到業績預估表，請重新整理頁面'); return; }
      if (p.parentNode !== el) {
        p.classList.remove('home-table-panel');
        p.classList.add('active');
        el.innerHTML = '';
        el.appendChild(p);
      }
      // 正在輸入預估數字時不重畫，避免手機上輸入框失焦
      var a = document.activeElement;
      if (a && p.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
      try {
        if (typeof renderSalesForecast === 'function') renderSalesForecast();
      } catch (e) {
        console.error('業績預估顯示錯誤', e);
      }
    }
  });
})(window.CMSX);

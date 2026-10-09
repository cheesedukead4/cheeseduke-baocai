/*
 * 首頁的「業績儀表板」分頁：直接沿用「業績儀表板」頁（xSalesDash）的畫面，顯示在首頁分頁裡。
 * 只在分頁打開時計算；原系統首頁重畫（包含收到同事的雲端更新）時，分頁開著就一起更新。
 */
(function (X) {
  'use strict';
  if (!X) return;

  function renderHomeDash() {
    var box = document.getElementById('homeSalesDash');
    var page = X.pages && X.pages.xSalesDash;
    if (!box || !page || !X.db()) return;
    var panel = box.closest('.home-table-panel');
    if (!panel || !panel.classList.contains('active')) return;
    try {
      page.render(box, X);
    } catch (e) {
      console.error('首頁業績儀表板顯示錯誤', e);
      box.innerHTML = X.ui.banner('bad', '業績儀表板顯示時發生錯誤：' + X.esc(e.message));
    }
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('.home-switch-btn[data-home-tab="salesDash"]')) setTimeout(renderHomeDash, 0);
  });

  window.addEventListener('load', function () {
    if (typeof window.renderDashboard === 'function' && !window.renderDashboard.__cmsxHomeDash) {
      var original = window.renderDashboard;
      var wrapped = function () {
        var r = original.apply(this, arguments);
        try { renderHomeDash(); } catch (e) {}
        return r;
      };
      wrapped.__cmsxHomeDash = true;
      window.renderDashboard = wrapped;
    }
  });

  X.renderHomeDash = renderHomeDash;
})(window.CMSX);

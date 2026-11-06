/*
 * 所有頁面的區塊都可以折疊
 * ---------------------------------------------------------------
 * 每個頁面裡的區塊（卡片）：點標題列就收合／展開（標題前面有 ▾／▸），每一頁最上面有「全部折疊／全部展開」。
 * 折疊的狀態會記住（只存在這台裝置，依「頁面＋區塊標題」記）；頁面重畫（重新整理資料、換頁再回來）也會維持。
 * 只做畫面：用 CSS 隱藏標題以外的內容，不動任何資料、不影響計算與輸入。
 */
(function (root) {
  'use strict';
  var KEY = 'cms_collapsed_v1', set = {};
  try { set = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { set = {}; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(set)); } catch (e) {} }

  var CARD_SEL = '.x-card, .panel, .sheet-block, .forecast-product-block';
  var HEAD_SEL = ':scope > .x-card-head, :scope > h2, :scope > h3, :scope > .sheet-caption';

  function pageOf(el) { var s = el.closest ? el.closest('section.page') : null; return s ? (s.id || '') : ''; }
  function headOf(card) {
    try {
      if (card.classList.contains('forecast-product-block')) return card.querySelector('th.sf-product-name'); // 業績預估每個品項的表：標題在表頭左上角
      return card.querySelector(HEAD_SEL);
    } catch (e) { return null; }
  }
  function setCollapsed(card, on) {
    card.classList.toggle('x-collapsed', on);
    var h = card.querySelector('.x-cx-head');
    if (h) h.setAttribute('aria-expanded', on ? 'false' : 'true');
  }

  function decorate() {
    var main = document.querySelector('main') || document.body;
    var seen = {};
    main.querySelectorAll(CARD_SEL).forEach(function (card) {
      if (card.dataset.cx) return;
      if (card.closest('.cms-modal, .x-dialog')) return;
      if (!card.classList.contains('forecast-product-block') && card.querySelector('.forecast-product-block')) return; // 外層容器（例如業績預估整頁）不折疊，只折疊裡面的各個區塊
      var head = headOf(card);
      if (!head) return;
      // 記狀態用的標題：只取標題本身，去掉括號裡的內容和數字（日期、筆數會變，不能影響記住的狀態）
      var tEl = head.matches('h2, h3') ? head : (head.querySelector('h2, h3') || head);
      var raw = (tEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (!raw) return;
      var text = raw.replace(/[（(][^）)]*[）)]/g, '').replace(/[0-9０-９/.:：]+/g, '').trim().slice(0, 40) || raw.slice(0, 40);
      var page = pageOf(card);
      if (!page) return;
      var key = page + '|' + text;
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] > 1) key += '#' + seen[key];
      card.dataset.cx = key;
      head.classList.add('x-cx-head');
      head.setAttribute('role', 'button');
      head.setAttribute('tabindex', '0');
      head.setAttribute('title', '點一下折疊／展開');
      // 小箭頭放在標題文字前面（x-card-head 是左右對齊的版面，所以放進標題裡面）
      var t = head.matches('h2, h3') ? head : (head.querySelector('h2, h3') || head);
      var chev = document.createElement('span');
      chev.className = 'x-cx-chev';
      chev.setAttribute('aria-hidden', 'true');
      chev.textContent = '▾';
      t.insertBefore(chev, t.firstChild);
      setCollapsed(card, !!set[key]);
    });
    // 每一頁最上面：全部折疊／全部展開（頁面裡有 2 個以上區塊才放）
    main.querySelectorAll('section.page').forEach(function (sec) {
      var n = sec.querySelectorAll('[data-cx]').length, bar = sec.querySelector(':scope > .x-cx-bar');
      if (n < 2) { if (bar) bar.remove(); return; }
      if (bar) return;
      bar = document.createElement('div');
      bar.className = 'x-cx-bar';
      bar.innerHTML = '<button type="button" class="btn gray" data-cx-all="open" style="min-height:30px;padding:3px 10px;font-size:14px">▾ 全部展開</button>' +
        '<button type="button" class="btn gray" data-cx-all="close" style="min-height:30px;padding:3px 10px;font-size:14px">▸ 全部折疊</button>';
      sec.insertBefore(bar, sec.firstChild);
    });
  }

  function toggle(card) {
    var on = !card.classList.contains('x-collapsed');
    setCollapsed(card, on);
    var key = card.dataset.cx;
    if (on) set[key] = 1; else delete set[key];
    save();
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var all = t.closest('[data-cx-all]');
    if (all) {
      var sec = all.closest('section.page'), on = all.dataset.cxAll === 'close';
      if (sec) sec.querySelectorAll('[data-cx]').forEach(function (c) { if (on && c.querySelector('[data-cx]')) return; setCollapsed(c, on); if (on) set[c.dataset.cx] = 1; else delete set[c.dataset.cx]; });
      save();
      return;
    }
    var head = t.closest('.x-cx-head'), card = head && head.closest('[data-cx]');
    if (!head || !card) return;
    // 標題列裡的按鈕、連結、輸入框照常使用，不當成折疊
    if (t.closest('button, a, input, select, textarea, label') && !t.closest('.x-cx-chev')) return;
    toggle(card);
  });
  document.addEventListener('keydown', function (e) {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target || !e.target.classList || !e.target.classList.contains('x-cx-head')) return;
    e.preventDefault();
    var c2 = e.target.closest('[data-cx]');
    if (c2) toggle(c2);
  });

  var timer = 0;
  function schedule() { clearTimeout(timer); timer = setTimeout(function () { try { decorate(); } catch (e) { if (root.console) console.warn('折疊功能', e); } }, 60); }
  function start() {
    var main = document.querySelector('main') || document.body;
    new MutationObserver(schedule).observe(main, { childList: true, subtree: true });
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  root.CMSCollapse = { decorate: decorate };
})(window);

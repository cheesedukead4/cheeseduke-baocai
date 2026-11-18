/*
 * 首頁「禮盒品項」底下：銷售預估調整（2026-11-12）
 * ---------------------------------------------------------------
 * 把每個本期上架的禮盒：今年預估、今年已販售、去年同期已販售與全期、成長或衰退、建議預估放在一起比對，
 * 讓人決定要不要調整預估；調整後預估填在這裡，會帶回首頁禮盒表的「銷售預估」（有調整的標 ✎），包裝需求跟著算。
 * 業績預估頁（業績預估、業績異動）本身不會被改。
 *
 * 首頁「銷售預估」自動計算（2026-11-18）：進單量（已販售＋進單未交）、預估量（業績預估）、去年同一區間販售成效，算法見 page-season.js 的說明；
 *   可在這裡切回「業績預估原數字」（db.giftForecastMode＝'plan'），或對單一禮盒手動填「調整後預估」（優先）。
 * 「智慧判斷」是用規則自動算的（不是外部 AI 服務）：
 *   建議預估＝今年已販售 ÷ 去年同期「賣到這天」的比例（去年同期已賣 ÷ 去年全期）
 *   成長／衰退＝今年同期已販售 vs 去年同期已販售，±10% 以內算持平
 *   今年新品（例如袋裝）去年沒有同品號的銷售時，依序用「去掉『袋』字的同名品項」、「同規格群組」去年的銷售節奏來推
 * 資料：db.giftAdjust［{ id, seasonId, productId, qty, note, by, at }］（見 ext-core.js），所有人看到的一樣。
 * 計算在 page-season.js 的 X.giftAdjustData。
 */
(function (X) {
  'use strict';
  if (!X) return;
  var esc = X.esc;

  function fmt(n) { return X.fmt(n); }
  function pctText(g) { return g == null ? '—' : (g >= 0 ? '+' : '') + (Math.round(g * 1000) / 10) + '%'; }
  function seasonId() { var a = X.activeSeason(); return a ? String(a.id || '') : ''; }
  function adjOf(pid) { return window.CMSStock && CMSStock.giftAdjustOf ? CMSStock.giftAdjustOf(pid) : null; }

  function saveAdjust(pid, qty, note) {
    var list = X.ensure('giftAdjust'), sid = seasonId();
    var i = -1;
    list.forEach(function (a, k) { if (a && String(a.productId) === String(pid) && String(a.seasonId || '') === sid) i = k; });
    if (qty == null) { if (i >= 0) list.splice(i, 1); }
    else if (i >= 0) { list[i].qty = qty; if (note != null) list[i].note = note; list[i].by = X.userName(); list[i].at = Date.now(); }
    else list.push({ id: X.uid('ga'), seasonId: sid, productId: String(pid), qty: qty, note: note || '', by: X.userName(), at: Date.now() });
    X.save();
    if (typeof renderDashboard === 'function') renderDashboard(); // 帶回首頁禮盒表（銷售預估、包裝需求）
  }

  var TAG = { '成長': 'ok', '衰退': 'bad', '持平': 'muted', '無法比較': 'muted' };
  var ACT = { '建議上調': 'warn', '建議下修': 'info', '預估合理': 'ok' };

  window.renderGiftAdjust = function () {
    var box = document.getElementById('home-gift-adjust');
    if (!box || !X.get) return;
    var d;
    try { d = X.giftAdjustData(); } catch (e) { console.warn(e); box.innerHTML = ''; return; }
    var head = '<h3 style="margin:0 0 6px">銷售預估調整：已販售、去年同期、建議預估</h3>';
    if (!d.ok) { box.innerHTML = '<div class="x-card" style="padding:12px 14px">' + head + '<p class="small" style="margin:0">' + esc(d.reason) + '</p></div>'; return; }
    var w = d.win, t = d.total, fmtD = function (ms) { var x = new Date(ms); return x.getUTCFullYear() + '/' + (x.getUTCMonth() + 1) + '/' + x.getUTCDate(); };
    var trend = t.growth == null ? '還沒有可比的品項' : (t.growth >= 0.1 ? '成長' : (t.growth <= -0.1 ? '衰退' : '持平'));
    var summary = '<p style="margin:0 0 6px"><b>整體判斷：</b>' + (t.growth == null ? '去年同期沒有同品號可以比，沒辦法判斷成長或衰退。'
      : '同品號 ' + t.cmpN + ' 款，今年到 ' + fmtD(w.cut) + ' 已賣 <b>' + fmt(t.cmpSold) + '</b> 盒，去年同期 <b>' + fmt(t.cmpLast) + '</b> 盒，<b style="color:var(--' + (trend === '成長' ? 'ok' : (trend === '衰退' ? 'bad' : 'text-2')) + ')">' + trend + ' ' + pctText(t.growth) + '</b>。')
      + (t.up || t.down ? '　建議上調 ' + t.up + ' 款、建議下修 ' + t.down + ' 款。' : '') + (t.newN ? '　今年新品（去年沒有同品號）' + t.newN + ' 款，用同名或同規格去年的節奏推。' : '') + '</p>';
    var autoOn = !(X.db() && X.db().giftForecastMode === 'plan');
    var modeBar = '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 8px"><b class="small">首頁「銷售預估」用</b>' +
      '<button type="button" class="btn ' + (autoOn ? 'primary' : 'gray') + '" data-ga-mode="auto" aria-pressed="' + autoOn + '" style="min-height:30px;padding:3px 11px;font-size:15px">自動計算（進單量＋預估量＋去年同期）</button>' +
      '<button type="button" class="btn ' + (!autoOn ? 'primary' : 'gray') + '" data-ga-mode="plan" aria-pressed="' + (!autoOn) + '" style="min-height:30px;padding:3px 11px;font-size:15px">業績預估原數字</button></div>' +
      '<p class="small" style="margin:0 0 10px">自動計算：<b>計算後預估＝max( 已售＋進單未交，w × 照去年節奏推的全期 ＋ (1−w) × 業績預估 )</b>。w 是「去年同期已賣到全期的幾成」（去年資料夠多才採用，不夠就 w＝0，等於用業績預估）；全期至少會有已進單的量。算出來會帶回首頁禮盒表的「銷售預估」（標 ≈），包裝需求跟著算；手動填的「調整後預估」優先。</p>';
    var info = '<p class="small" style="margin:0 0 10px">今年已販售＝' + fmtD(w.w0) + ' ～ ' + fmtD(w.cut) + ' 的訂單（不含單條）；去年同期＝' + esc(w.label) + ' 的 ' + fmtD(w.w0L) + ' ～ ' + fmtD(w.cutL) + '（同樣是離節日的天數）；去年全期到 ' + fmtD(w.endL) + '。'
      + '「智慧判斷」是用規則自動算的：建議預估＝今年已販售 ÷ 去年同期賣到這天的比例，結果只是參考，要不要調整由你決定；在最右邊填「調整後預估」就會帶回上面禮盒表的銷售預估（業績預估頁不會動）。</p>';
    var cols = [
      { label: '禮盒', render: function (r) { return '<span style="white-space:normal;min-width:120px;display:inline-block"><b>' + esc((r.p.code ? r.p.code + ' ' : '') + (r.p.name || '')) + '</b>' + (r.isNew ? ' ' + X.ui.tag('今年新品', 'info') : '') + '</span>'; } },
      { label: '今年預估', num: true, render: function (r) { return fmt(r.est); } },
      { label: '已販售', num: true, render: function (r) { return r.sold ? fmt(r.sold) : '—'; } },
      { label: '進單未交', num: true, render: function (r) { return r.booked ? fmt(r.booked) : '—'; } },
      { label: '預估剩餘', num: true, render: function (r) { return r.est > 0 || r.sold ? '<span style="color:var(--' + (r.remain < 0 ? 'bad' : 'text') + ')">' + fmt(r.remain) + '</span>' : '—'; } },
      { label: '去年同期已賣', num: true, render: function (r) { return r.basis ? fmt(r.A) + (r.basis === 'same' ? '' : '<div class="small">' + (r.basis === 'name' ? '同名合計' : '同規格合計') + '</div>') : '—'; } },
      { label: '去年全期', num: true, render: function (r) { return r.basis ? fmt(r.B) : '—'; } },
      { label: '成長／衰退', render: function (r) { return X.ui.tag(r.trend + (r.growth != null ? ' ' + pctText(r.growth) : ''), TAG[r.trend] || 'muted'); } },
      { label: '建議預估', num: true, render: function (r) { return r.sug == null ? '<span class="small">—</span>' : '<b>' + fmt(r.sug) + '</b>' + (r.conf ? '<div class="small">可信度 ' + r.conf + '</div>' : ''); } },
      { label: '計算後預估（自動）', num: true, render: function (r) { return '<b>' + fmt(r.calc) + '</b>' + (r.w > 0 ? '<div class="small">節奏權重 ' + Math.round(r.w * 100) + '%</div>' : '<div class="small">' + (r.floor > r.est ? '以進單量為底' : '依預估量') + '</div>'); } },
      { label: '智慧判斷', render: function (r) { return '<span style="white-space:normal;display:inline-block;min-width:180px">' + (r.act ? X.ui.tag(r.act, ACT[r.act] || 'muted') + '<br>' : '') + '<span class="small">' + esc(r.why) + '</span></span>'; } },
      { label: '調整後預估', num: true, render: function (r) {
        var a = adjOf(r.p.id);
        return '<span style="white-space:nowrap"><input type="number" min="0" step="1" inputmode="numeric" data-ga="' + esc(r.p.id) + '" value="' + (a ? esc(a.qty) : '') + '" placeholder="' + esc(r.calc) + '" aria-label="' + esc((r.p.name || '') + ' 調整後預估') + '" style="width:84px;text-align:right">' +
          (r.sug != null ? ' <button type="button" class="btn gray" data-ga-use="' + esc(r.p.id) + '" title="填入「建議預估」（照去年節奏推的全期）" style="min-height:28px;padding:1px 8px;font-size:13px">採用建議</button>' : '') +
          (a ? ' <button type="button" class="btn gray" data-ga-clear="' + esc(r.p.id) + '" style="min-height:28px;padding:1px 8px;font-size:13px">還原</button>' : '') + '</span>';
      } }
    ];
    var rows = d.rows;
    box.innerHTML = '<div class="x-card" style="padding:12px 14px">' + head + modeBar + summary + info +
      (rows.length ? X.ui.table(cols, rows, {}) : '<p class="small">還沒有本期上架的禮盒。</p>') +
      '<p class="small" style="margin:8px 0 0">調整後預估：填的是整個檔期的盒數；清空或按「還原」就回到業績預估頁的數字。調整會讓首頁禮盒表的「銷售預估」、「包裝需求」，以及用包裝需求算的包材「待裝盒」一起跟著變（標 ✎）。有選「預購單、銷售預估」時間區間時，禮盒表那一欄仍用業績預估的原數字。</p></div>';
    box.onchange = function (e) {
      var el = e.target;
      if (!el || !el.dataset || el.dataset.ga == null) return;
      var v = String(el.value).trim();
      if (v === '') { saveAdjust(el.dataset.ga, null); return; }
      var n = Number(v);
      if (!(n >= 0) || !isFinite(n)) { X.toast('請填 0 以上的數字'); return; }
      saveAdjust(el.dataset.ga, Math.round(n));
    };
    box.onclick = function (e) {
      var mb = e.target.closest ? e.target.closest('[data-ga-mode]') : null;
      if (mb) {
        var dbm = X.db();
        if (mb.dataset.gaMode === 'plan') dbm.giftForecastMode = 'plan'; else delete dbm.giftForecastMode;
        X.save();
        X.toast(mb.dataset.gaMode === 'plan' ? '首頁銷售預估改用業績預估原數字' : '首頁銷售預估改用自動計算');
        if (typeof renderDashboard === 'function') renderDashboard();
        return;
      }
      var b = e.target.closest ? e.target.closest('[data-ga-use],[data-ga-clear]') : null;
      if (!b) return;
      if (b.dataset.gaClear != null) { saveAdjust(b.dataset.gaClear, null); return; }
      var r = rows.find(function (x) { return String(x.p.id) === String(b.dataset.gaUse); });
      if (r && r.sug != null) saveAdjust(r.p.id, r.sug);
    };
  };
})(window.CMSX);

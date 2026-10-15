/*
 * 庫存與禮盒數量的算法（2026-10-14 起）
 * ---------------------------------------------------------------
 * 包材庫存改用「初始庫存＋快速輸入＋裝盒回報」計算（首頁的每日折盒統計已取消，不再算進庫存）：
 *   未折盒＝初始庫存（未折盒）＋快速輸入（進貨）－快速輸入（折盒）－快速輸入（折盒NG）
 *   已折盒＝初始庫存（已折盒）＋快速輸入（折盒）－快速輸入（使用NG）－裝盒回報換算的包材用量
 *   總庫存＝未折盒＋已折盒
 * 已撤銷的快速輸入、裝盒回報不算；裝盒用量＝盒數 × 送出當時的包材配方用量（紀錄裡的 materials 快照；舊紀錄沒有快照才用目前配方）。
 * 停用前的舊「每日折盒統計」累計也併進起點（正式資料停用時都是 0，只是保險，避免切換時庫存跳動）。
 * 首頁「包材庫存」、盤點的帳面數、開檔檢查的低水位、裝盒回報的「已折盒」都用這裡的數字
 * （原系統 materialLiveInventory 與新功能 CMSX.materialStock 都改呼叫 CMSStock.material）。
 *
 * 禮盒（首頁「禮盒品項」）：
 *   包裝需求＝現貨＋待進貨－預購單（預扣單）－銷售預估
 *   現貨：資料來源還沒決定（待串接），先當 0、畫面顯示「—」
 *   待進貨：先當 0
 *   預購單：暫時用「檔期需求」頁的盒數；之後改由進單資料帶入
 *   銷售預估：「業績預估」頁這個禮盒所有日期、所有部門的預估盒數合計
 * 包材「已裝盒」＝各禮盒現貨 × 配方用量的合計（現貨還沒串接，先顯示「—」）
 * 包材「待裝盒」＝各禮盒還要再裝的盒數（包裝需求為負數時的絕對值）× 配方用量的合計（2026-10-15 起，取代原本的檔期需求 × 配方）
 */
(function (root) {
  'use strict';

  function getDb() { try { return db; } catch (e) { return null; } } // 原系統的全域資料，載入完成後才有
  function num(v) { var n = Number(v); return Number.isFinite(n) ? n : 0; }
  function round2(v) { return Math.round(num(v) * 100) / 100; }
  function same(a, b) { return String(a) === String(b); }
  function arr(d, k) { return d && Array.isArray(d[k]) ? d[k] : []; }

  // 包材的初始庫存（同一包材有多筆時取第一筆；和原系統相同）
  function initialOf(d, mid) {
    return arr(d, 'initialStock').find(function (x) { return x && same(x.itemId, mid) && (!x.itemType || x.itemType === 'material'); }) || {};
  }

  // 一筆裝盒回報每盒用掉多少這個包材：優先用送出當時存下的配方快照（materials），
  // 之後刪除禮盒或改配方，已送出的用量不會跟著變；舊紀錄沒有快照才用目前的配方
  function perBoxFor(p, mid, perNow) {
    if (Array.isArray(p.materials) && p.materials.length) {
      return p.materials.reduce(function (s, m) { return m && same(m.materialId, mid) ? round2(s + num(m.qty)) : s; }, 0);
    }
    return perNow[String(p.productId)] || 0;
  }
  // 裝盒回報換算的包材用量：每筆（未撤銷、盒數大於 0）盒數 × 每盒用量
  function packUsage(d, mid) {
    var per = Object.create(null);
    arr(d, 'recipes').forEach(function (r) {
      if (!r || !same(r.materialId, mid)) return;
      var k = String(r.productId);
      per[k] = round2((per[k] || 0) + num(r.qty));
    });
    var total = 0;
    arr(d, 'packRecords').forEach(function (p) {
      if (!p || p.voided || !(num(p.boxes) > 0)) return;
      var q = perBoxFor(p, mid, per);
      if (q) total = round2(total + num(p.boxes) * q);
    });
    return total;
  }

  // 舊「每日折盒統計」（2026-10-14 停用、不再新增）的累計，併進起點，避免切換算法時庫存跳動；
  // 算法同舊版 foldingTotalsForMaterial。還沒更新的舊版裝置晚寫進來的折盒資料也會算到。
  function legacyFolding(d, mid) {
    var t = { unfolded: 0, folded: 0 };
    arr(d, 'foldingArchive').concat(arr(d, 'foldingRecords')).forEach(function (r) {
      if (!r || !same(r.materialId || r.itemId || '', mid)) return;
      t.unfolded = round2(t.unfolded + num(r.incoming) - num(r.folded) - num(r.ng));
      t.folded = round2(t.folded + num(r.folded) - num(r.usage) - num(r.otherNg));
    });
    return t;
  }

  // 包材目前庫存：{ total, unfolded, folded, parts }（parts 是各來源的合計，給說明與檢查用）
  function material(mid) {
    var d = getDb();
    var parts = { initUnfolded: 0, initFolded: 0, legacyUnfolded: 0, legacyFolded: 0, in: 0, fold: 0, foldNg: 0, useNg: 0, use: 0, pack: 0 };
    if (!d) return { total: 0, unfolded: 0, folded: 0, parts: parts };
    var init = initialOf(d, mid);
    parts.initUnfolded = num(init.unfolded);
    parts.initFolded = num(init.folded);
    var lf = legacyFolding(d, mid);
    parts.legacyUnfolded = lf.unfolded;
    parts.legacyFolded = lf.folded;
    arr(d, 'movements').forEach(function (m) {
      if (!m || m.voided || !same(m.materialId, mid)) return;
      var q = Math.max(0, num(m.qty));
      if (m.type in parts) parts[m.type] = round2(parts[m.type] + q);
    });
    parts.pack = packUsage(d, mid);
    // 快速輸入的「使用」不算進庫存（裝盒用掉的包材由裝盒回報換算），parts.use 只是統計
    var unfolded = round2(parts.initUnfolded + parts.legacyUnfolded + parts.in - parts.fold - parts.foldNg);
    var folded = round2(parts.initFolded + parts.legacyFolded + parts.fold - parts.useNg - parts.pack);
    return { total: round2(unfolded + folded), unfolded: unfolded, folded: folded, parts: parts };
  }

  // ---------- 禮盒 ----------
  function productById(d, pid) { return arr(d, 'products').find(function (p) { return p && same(p.id, pid); }) || null; }

  // 現貨：資料來源還沒決定，回傳 null（畫面顯示「—」、公式當 0）
  function giftStock(pid) { return null; }
  // 待進貨：先當 0
  function giftIncoming(pid) { return 0; }
  // 預購單（預扣單）：暫時用「檔期需求」頁這個禮盒的盒數合計
  function giftPreorder(pid) {
    var d = getDb();
    return round2(arr(d, 'campaigns').filter(function (c) { return c && same(c.productId, pid); })
      .reduce(function (s, c) { return s + num(c.qty); }, 0));
  }
  // 銷售預估：「業績預估」頁這個禮盒所有日期、所有部門的預估盒數合計
  // 找資料的方式和業績預估頁相同：品號，沒有品號用禮盒 id
  function giftForecast(pid) {
    var d = getDb(), p = productById(d, pid);
    var rows = d && d.salesForecastV5 && d.salesForecastV5.rows;
    if (!rows || !p) return 0;
    var key = String(p.code || p.id || ''), code = String(p.code || '').trim();
    var row = (key && rows[key]) || (code && rows[code]) || null;
    if (!row || !row.lines) return 0;
    var total = 0;
    Object.keys(row.lines).forEach(function (i) {
      var line = row.lines[i] || {};
      Object.keys(line).forEach(function (dept) { total += num(line[dept] && line[dept].est); });
    });
    return round2(total);
  }
  // 包裝需求＝現貨＋待進貨－預購單－銷售預估（負數＝還不夠，要再裝這麼多盒）
  function giftPackNeed(pid) {
    return round2(num(giftStock(pid)) + giftIncoming(pid) - giftPreorder(pid) - giftForecast(pid));
  }
  // 包材已裝盒＝各禮盒現貨 × 配方用量；現貨還沒串接時回傳 null
  function materialPacked(mid) {
    var d = getDb(), any = false, total = 0;
    arr(d, 'recipes').forEach(function (r) {
      if (!r || !same(r.materialId, mid)) return;
      var s = giftStock(r.productId);
      if (s == null) return;
      any = true;
      total += num(s) * num(r.qty);
    });
    return any ? round2(total) : null;
  }
  // 包材待裝盒＝各禮盒「還要再裝的盒數」× 配方裡這個包材的用量，全部加總
  // 還要再裝的盒數＝包裝需求是負數時的絕對值（包裝需求 0 以上＝不用再裝）；所有非單條的禮盒都算，和舊版檔期需求一樣不看本期上架
  // （已裝好的盒數要等禮盒「現貨」串接後才會從包裝需求扣掉）
  function materialToPack(mid) {
    var d = getDb(), per = Object.create(null), total = 0;
    arr(d, 'recipes').forEach(function (r) {
      if (!r || !same(r.materialId, mid)) return;
      var k = String(r.productId);
      per[k] = round2((per[k] || 0) + num(r.qty));
    });
    Object.keys(per).forEach(function (pid) {
      var p = productById(d, pid);
      if (!p || String(p.category || '').trim() === '單條') return;
      var toPack = Math.max(0, -giftPackNeed(pid));
      if (toPack) total = round2(total + toPack * per[pid]);
    });
    return total;
  }

  root.CMSStock = {
    material: material, packUsage: function (mid) { return packUsage(getDb(), mid); },
    giftStock: giftStock, giftIncoming: giftIncoming, giftPreorder: giftPreorder, giftForecast: giftForecast,
    giftPackNeed: giftPackNeed, materialPacked: materialPacked, materialToPack: materialToPack
  };
})(window);

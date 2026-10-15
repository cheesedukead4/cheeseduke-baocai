(function(){
 function bindTabs(){
   const buttons=[...document.querySelectorAll('.navbtn')];
   const pages=[...document.querySelectorAll('.page')];
   buttons.forEach(btn=>{
     btn.onclick=function(){
       const target=this.dataset.page;
       buttons.forEach(x=>x.classList.remove('active'));
       pages.forEach(x=>x.classList.remove('active'));
       this.classList.add('active');
       const page=document.getElementById(target);
       if(page)page.classList.add('active');
       try{ if(typeof render==='function') render(); }catch(e){ console.error(e); }
     };
   });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindTabs);
 else bindTabs();
})();

document.addEventListener('click',function(e){
 const b=e.target.closest('.navbtn[data-page]');
 if(b&&b.dataset.page==='dashboard'){
   setTimeout(renderDashboard,0);
 }
});


window.addEventListener('load',function(){
 try{renderDashboard();}catch(e){console.error(e)}
});


window.addEventListener('load',function(){
 try{
   syncTodayFoldingRows();
   scheduleFoldingMidnight();
 }catch(e){console.error(e);}
});

document.addEventListener('click',function(e){
 const el=e.target.closest('[onclick*="initialStock"],[data-page="initialStock"]');
 if(el)setTimeout(()=>{try{renderInitialStock();}catch(err){console.error(err);}},0);
});


const ADMIN_PASSWORD='1234';
function adminIsLoggedIn(){ return sessionStorage.getItem('campaign_admin_logged_in')==='1'; }
function adminApply(){
 const ok=adminIsLoggedIn();
 document.body.classList.toggle('admin-mode',ok);
 const a=document.getElementById('adminLoginBtn');
 const b=document.getElementById('adminLogoutBtn');
 if(a)a.style.display=ok?'none':'inline-flex';
 if(b)b.style.display=ok?'inline-flex':'none';

 const oh=document.getElementById('orderHistoryNavBtn');
 if(oh)oh.style.display=ok?'inline-flex':'none';
}
function adminLogin(){
 const m=document.getElementById('adminModal');
 const p=document.getElementById('adminPassword');
 const e=document.getElementById('adminError');
 if(e)e.textContent='';
 if(p)p.value='';
 if(m)m.classList.add('show');
 setTimeout(()=>p&&p.focus(),50);
}
function adminClose(){
 const m=document.getElementById('adminModal');
 if(m)m.classList.remove('show');
}
function adminSubmit(){
 const p=document.getElementById('adminPassword');
 const e=document.getElementById('adminError');
 if(p && p.value===ADMIN_PASSWORD){
   sessionStorage.setItem('campaign_admin_logged_in','1');
   adminClose(); adminApply();
 }else{
   if(e)e.textContent='密碼錯誤';
   if(p){p.select();p.focus();}
 }
}
function adminLogout(){
 sessionStorage.removeItem('campaign_admin_logged_in');
 adminApply();
 // 登出後回首頁
 const homeBtn=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='首頁');
 if(homeBtn)homeBtn.click();
}
document.addEventListener('DOMContentLoaded',adminApply);



document.addEventListener('click',function(ev){
 const b=ev.target.closest('.admin-nav');
 if(b && !adminIsLoggedIn()){
   ev.preventDefault(); ev.stopImmediatePropagation(); adminLogin();
 }
},true);



function ensureOrderHistory(){
 if(!Array.isArray(db.orderHistory)) db.orderHistory=[];
 ensurePreloadedOrderHistory();

 ensureJan2026OrderHistory();

 ensureAllHistoricalCOOrders();
 ensureHistoricalGiftProducts();
}
function showOrderHistoryPage(){
 if(!adminIsLoggedIn()){ adminLogin(); return; }

 // 隱藏系統內所有主要內容頁
 document.querySelectorAll('main > section, .page, [id^="page-"]').forEach(el=>{
   if(el.id!=='page-orderHistory') el.style.display='none';
 });

 const p=document.getElementById('page-orderHistory');
 if(!p)return;

 p.hidden=false;
 p.classList.add('active-order-history');
 p.style.display='block';
 p.style.visibility='visible';
 p.style.opacity='1';

 refreshHistChannelOptions();
 renderOrderHistory();
 window.scrollTo(0,0);
}
function clearOrderHistoryForm(){
 ['histDate','histOrderNo','histName','histCustomer','histChannel','histQty','histNote'].forEach(id=>{
   const el=document.getElementById(id); if(el)el.value='';
 });
 delete window.__editingOrderHistoryId;
}
function saveOrderHistory(){
 if(!adminIsLoggedIn()){ adminLogin(); return; }
 ensureOrderHistory();
 const rec={
   id:window.__editingOrderHistoryId || ('OH'+Date.now()),
   date:(document.getElementById('histDate')||{}).value||'',
   orderNo:(document.getElementById('histOrderNo')||{}).value||'',
   name:(document.getElementById('histName')||{}).value||'',
   customer:(document.getElementById('histCustomer')||{}).value||'',
   channel:(document.getElementById('histChannel')||{}).value||'',
   qty:Number((document.getElementById('histQty')||{}).value)||0,
   note:(document.getElementById('histNote')||{}).value||''
 };
 if(!rec.date && !rec.orderNo && !rec.name){ alert('請至少填寫日期、編號或名稱'); return; }
 const i=db.orderHistory.findIndex(x=>String(x.id)===String(rec.id));
 if(i>=0)db.orderHistory[i]=rec; else db.orderHistory.push(rec);
 localStorage.setItem(KEY,JSON.stringify(db));
 clearOrderHistoryForm();
 renderOrderHistory();
}
function editOrderHistory(id){
 ensureOrderHistory();
 const r=db.orderHistory.find(x=>String(x.id)===String(id)); if(!r)return;
 window.__editingOrderHistoryId=r.id;
 document.getElementById('histDate').value=r.date||'';
 document.getElementById('histOrderNo').value=r.orderNo||'';
 document.getElementById('histName').value=r.name||'';
 document.getElementById('histCustomer').value=r.customer||'';
 refreshHistChannelOptions(r.channel||'');
 document.getElementById('histChannel').value=r.channel||'';
 document.getElementById('histQty').value=Number(r.qty)||0;
 document.getElementById('histNote').value=r.note||'';
}
function deleteOrderHistory(id){
 if(!adminIsLoggedIn())return;
 if(!confirm('確定刪除此筆過去訂單紀錄？'))return;
 ensureOrderHistory();
 db.orderHistory=db.orderHistory.filter(x=>String(x.id)!==String(id));
 localStorage.setItem(KEY,JSON.stringify(db));
 renderOrderHistory();
}
function escHist(v){
 return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function renderOrderHistory(){
 ensureOrderHistory();
 applyOrderDepartments();
 const body=document.getElementById('orderHistoryBody'); if(!body)return;
 const q=((document.getElementById('orderHistorySearch')||{}).value||'').trim().toLowerCase();
 let rows=[...db.orderHistory].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
 rows=rows.filter(r=>orderMatchesSeason(r,orderHistorySeason));
 if(orderHistoryYear!=='all'){
   // 選「過年」時，過年檔期裡 7～12 月的預購訂單算隔年（見「計算規則」的過年月份）
   if(orderHistorySeason==='newyear'&&window.CMSRules) rows=rows.filter(r=>CMSRules.seasonYear(r.date,'newyear')===orderHistoryYear);
   else rows=rows.filter(r=>String(r.date||'').startsWith(orderHistoryYear+'-'));
 }
 
 const fDate=((document.getElementById('histFilterDate')||{}).value||'').trim();
 const fOrder=((document.getElementById('histFilterOrderNo')||{}).value||'').trim();
 const fProduct=((document.getElementById('histFilterProduct')||{}).value||'').trim();
 const fCustomer=((document.getElementById('histFilterCustomer')||{}).value||'').trim();
 const fChannel=((document.getElementById('histFilterChannel')||{}).value||'').trim();
 const fDept=((document.getElementById('histFilterDepartment')||{}).value||'').trim();
 const fOrgDept=((document.getElementById('histFilterOrgDepartment')||{}).value||'').trim();

 // 下拉選單的 value 直接與原始資料比對，避免中文/英數轉換造成篩不到
 if(fDate) rows=rows.filter(r=>String(r.date||'').trim()===fDate);
 if(fOrder) rows=rows.filter(r=>String(r.orderNo||'').trim()===fOrder);
 if(fProduct) rows=rows.filter(r=>`${String(r.productCode||'').trim()}｜${String(r.name||'').trim()}`===fProduct);
 if(fCustomer) rows=rows.filter(r=>String(r.customer||'').trim()===fCustomer);
 if(fChannel) rows=rows.filter(r=>String(r.channel||'').trim()===fChannel);
 if(fDept==='__BLANK_ORDER_DEPT__') rows=rows.filter(r=>!String(r.orderDepartment??'').trim());
 else if(fDept) rows=rows.filter(r=>String(r.orderDepartment||'').trim()===fDept);
 if(fOrgDept) rows=rows.filter(r=>String(r.department||'').trim()===fOrgDept);

if(q){
   rows=rows.filter(r=>[
     r.date,r.orderNo,r.sourceOrderNo,r.productCode,r.name,r.customer,r.channel,r.orderDepartment,r.department
   ].some(v=>String(v||'').toLowerCase().includes(q)));
 }
 const maxRows=window.CMSRules?CMSRules.get('orderHistoryMaxRows'):200; // 最多顯示幾筆：見「計算規則」
 const count=document.getElementById('orderHistoryCount');
 if(count){
   const seasonName=orderHistorySeason==='newyear'?'過年':orderHistorySeason==='midautumn'?'中秋':'全部檔期';
   const yearName=orderHistoryYear==='all'?'全部年份':orderHistoryYear+'年';
   count.textContent=`${yearName}・${seasonName}｜共 ${rows.length.toLocaleString()} 筆｜目前顯示前 ${Math.min(rows.length,maxRows)} 筆`;
 }
 const visible=rows.slice(0,maxRows);
 body.innerHTML=visible.length?visible.map(r=>`<tr>
   <td>${escHist(r.date)}</td><td>${escHist(r.orderNo)}</td><td>${escHist(r.sourceOrderNo||'')}</td>
   <td>${escHist(r.productCode||'')}</td><td>${escHist(r.name)}</td><td>${escHist(r.customer)}</td>
   <td>${escHist(r.channel||'')}</td><td>${Number(r.qty)||0}</td><td>${escHist(r.orderDepartment||'')}</td><td>${escHist(r.department||'')}</td>
   
 </tr>`).join(''):'<tr><td colspan="10" style="text-align:center">查無訂單紀錄</td></tr>';
}



const PRELOADED_ORDER_HISTORY=[]; // 已移除：訂單個資不放在網站檔案中
function ensurePreloadedOrderHistory(){
 if(!PRELOADED_ORDER_HISTORY.length){ if(!Array.isArray(db.orderHistory)) db.orderHistory=[]; return; }
 if(!Array.isArray(db.orderHistory)) db.orderHistory=[];
 if(!db.orderHistoryImportVersion){
   db.orderHistory=PRELOADED_ORDER_HISTORY;
   db.orderHistoryImportVersion='2026-10-07-import-1';
   localStorage.setItem(KEY,JSON.stringify(db));
 }
}



document.addEventListener('click',function(e){
 const b=e.target.closest('.navbtn[data-page="orderHistory"]');
 if(b){
   setTimeout(function(){
     ensureOrderHistory();
     refreshOrderYearOptions();
     applyOrderDepartments();
     refreshOrderFilterChannelOptions();
     renderOrderHistory();
   },0);
 }
});



let orderHistorySeason='all';
let orderHistoryYear='all';

function setOrderYear(year){
 orderHistoryYear=year||'all';
 renderOrderHistory();
}

function setOrderSeason(season,btn){
 orderHistorySeason=season;
 document.querySelectorAll('.order-season-btn').forEach(b=>b.classList.remove('active'));
 if(btn)btn.classList.add('active');
 renderOrderHistory();
}

function orderMatchesSeason(r,season){
 if(season==='all')return true;
 const d=String(r.date||'');
 const m=Number((d.match(/^\d{4}-(\d{2})/)||[])[1]||0);

 // 過年、中秋各包含哪些月份：見「計算規則」（預設過年 1、2 月，中秋 8、9、10 月）
 if(season==='newyear') return window.CMSRules ? CMSRules.monthIn('newyear',m) : (m===1 || m===2);
 if(season==='midautumn') return window.CMSRules ? CMSRules.monthIn('midautumn',m) : (m===8 || m===9 || m===10);

 return true;
}



function refreshOrderYearOptions(){
 const sel=document.getElementById('orderHistoryYear');
 if(!sel || !Array.isArray(db.orderHistory))return;
 // 過年檔期的 7～12 月預購算隔年的過年（見「計算規則」），所以也要列出那個隔年，選「過年」時才選得到
 const years=[...new Set(db.orderHistory.flatMap(r=>{
   const ys=[String(r.date||'').slice(0,4)];
   if(window.CMSRules&&orderMatchesSeason(r,'newyear'))ys.push(CMSRules.seasonYear(r.date,'newyear'));
   return ys;
 }).filter(y=>/^\d{4}$/.test(y)))].sort().reverse();
 const current=orderHistoryYear;
 sel.innerHTML='<option value="all">全部年份</option>'+years.map(y=>`<option value="${y}">${y}年</option>`).join('');
 sel.value=years.includes(current)?current:'all';
 if(!years.includes(current))orderHistoryYear='all';
}


const PRELOADED_ORDER_HISTORY_JAN2026=[]; // 已移除：訂單個資不放在網站檔案中
function ensureJan2026OrderHistory(){
 if(!PRELOADED_ORDER_HISTORY_JAN2026.length){ if(!Array.isArray(db.orderHistory)) db.orderHistory=[]; return; }
 if(!Array.isArray(db.orderHistory)) db.orderHistory=[];
 if(!db.orderHistoryImportJan2026){
  const keys=new Set(db.orderHistory.map(r=>[r.date,r.orderNo,r.productCode,r.name,r.customer,r.qty].join('|')));
  PRELOADED_ORDER_HISTORY_JAN2026.forEach(r=>{
   const k=[r.date,r.orderNo,r.productCode,r.name,r.customer,r.qty].join('|');
   if(!keys.has(k)){db.orderHistory.push(r);keys.add(k);}
  });
  db.orderHistoryImportJan2026='2026-01-v1';
  try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){console.warn('2026-01訂單已載入記憶體，但localStorage空間不足',e);}
 }
}


function refreshHistChannelOptions(selectedValue=''){
 const sel=document.getElementById('histChannel');
 if(!sel)return;
 ensureOrderHistory();
 const preferred=[
   '直營-官網','直營-客服','直營-永康東橋店','百貨-台北京站百貨',
   '團主','七畝田','黑貓探險隊','砥家有限公司','樂比比','總公司'
 ];
 const existing=(db.orderHistory||[]).map(r=>String(r.channel||'').trim()).filter(Boolean);
 const channels=[...new Set([...preferred,...existing])].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
 sel.innerHTML='<option value="">請選擇通路</option>'+channels.map(c=>
   `<option value="${escHist(c)}">${escHist(c)}</option>`
 ).join('');
 if(selectedValue && !channels.includes(selectedValue)){
   sel.insertAdjacentHTML('beforeend',`<option value="${escHist(selectedValue)}">${escHist(selectedValue)}</option>`);
 }
 sel.value=selectedValue||'';
}



function refreshOrderFilterChannelOptions(){
 ensureOrderHistory();
 const rows=db.orderHistory||[];
 const fill=(id,items,label)=>{
   const sel=document.getElementById(id); if(!sel)return;
   const current=sel.value||'';
   if(id==='histFilterDepartment')sel.dataset.previousFilter=current;
   const vals=[...new Set(items.map(v=>String(v||'').trim()).filter(Boolean))]
     .sort((a,b)=>a.localeCompare(b,'zh-Hant',{numeric:true}));
   sel.innerHTML='';
   const first=document.createElement('option');
   first.value=''; first.textContent=label; sel.appendChild(first);
   vals.forEach(v=>{
     const op=document.createElement('option');
     op.value=v; op.textContent=v; sel.appendChild(op);
   });
   if(vals.includes(current))sel.value=current;
 };
 fill('histFilterDate',rows.map(r=>r.date),'全部日期');
 fill('histFilterOrderNo',rows.map(r=>r.orderNo),'全部訂單／檔期編號');
 fill('histFilterProduct',rows.map(r=>`${String(r.productCode||'').trim()}｜${String(r.name||'').trim()}`),'全部品號／品名');
 fill('histFilterCustomer',rows.map(r=>r.customer),'全部客戶');
 fill('histFilterChannel',rows.map(r=>r.channel),'全部通路');
 fill('histFilterDepartment',rows.map(r=>r.orderDepartment),'全部接單部門');
 const departmentSelect=document.getElementById('histFilterDepartment');
 if(departmentSelect){
   const previous=departmentSelect.dataset.previousFilter||'';
   if(rows.some(r=>!String(r.orderDepartment??'').trim())){
     const blankOption=document.createElement('option');
     blankOption.value='__BLANK_ORDER_DEPT__';
     blankOption.textContent='（空白／未填寫）';
     departmentSelect.appendChild(blankOption);
   }
   if(previous==='__BLANK_ORDER_DEPT__')departmentSelect.value=previous;
   departmentSelect.onchange=()=>{departmentSelect.dataset.previousFilter=departmentSelect.value;renderOrderHistory();};
 }
 fill('histFilterOrgDepartment',rows.map(r=>r.department),'全部部門');
}
function clearOrderHistoryFilters(){
 ['histFilterDate','histFilterOrderNo','histFilterProduct','histFilterCustomer','orderHistorySearch'].forEach(id=>{
   const el=document.getElementById(id); if(el)el.value='';
 });
 const ch=document.getElementById('histFilterChannel'); if(ch)ch.value='';
 const dep=document.getElementById('histFilterDepartment'); if(dep){dep.value='';dep.dataset.previousFilter='';}
 const org=document.getElementById('histFilterOrgDepartment'); if(org)org.value='';
 orderHistoryYear='all';
 orderHistorySeason='all';
 const ys=document.getElementById('orderHistoryYear'); if(ys)ys.value='all';
 document.querySelectorAll('.order-season-btn').forEach(b=>b.classList.toggle('active',b.dataset.season==='all'));
 renderOrderHistory();
}



const PRELOADED_ALL_CO_ORDER_HISTORY=[]; // 已移除：訂單個資不放在網站檔案中
const HISTORICAL_GIFT_PRODUCTS=[{"code":"CO-24","name":"黑松露費雪"},{"code":"CO-46","name":"可可黑鑽費雪"},{"code":"CO-60","name":"綜合咖啡費雪禮盒 (8入)"},{"code":"CO-62","name":"黃金萬兩可可黑礸費雪禮盒(5入)"},{"code":"CO-63","name":"綜合費雪-鳳+草+乳酪+巧(4入)"},{"code":"CO-64","name":"綜合費雪-鳳+草+乳酪+巧(8入)"},{"code":"CO-65","name":"綜合費雪-鳳+草+巧+松露(4入)"},{"code":"CO-66","name":"綜合費雪-鳳+草+巧+松露(8入)"},{"code":"CO-68","name":"綜合費雪-鳳+巧(8入)"},{"code":"CO-69","name":"黑松露墨金費雪禮盒(5入)"},{"code":"CO-72","name":"黃金萬兩陽光柑桔費雪禮盒(5入)"},{"code":"CO-74","name":"綜合費雪禮盒-可可+柑桔(8入)"},{"code":"CO-75","name":"綜合費雪禮盒-可+柑+鳳+草(4入)"},{"code":"CO-76","name":"綜合費雪禮盒-可+柑+鳳+草(8入)"},{"code":"CO-77","name":"綜合費雪禮盒-可可+草莓(8入)"},{"code":"CO-78","name":"綜合費雪禮盒-鳳+可+草(8入)"},{"code":"CO-79","name":"綜合費雪禮盒-鳳+可+草(4入)"},{"code":"CO-81","name":"綜費-鳳+草+乳酪+巧+松露(5入)"},{"code":"CO-97","name":"綜合費雪-鳳+草+可+乳酪(16入)"},{"code":"CO-98","name":"綜合費雪-鳳+草+可+乳酪+桔(5入)"}];

function ensureAllHistoricalCOOrders(){
 if(!PRELOADED_ALL_CO_ORDER_HISTORY.length){ if(!Array.isArray(db.orderHistory)) db.orderHistory=[]; return; }
 if(!Array.isArray(db.orderHistory)) db.orderHistory=[];
 if(!db.orderHistoryAllCOVersion){
   const keys=new Set(db.orderHistory.map(r=>[
     r.date,r.orderNo,r.sourceOrderNo,r.productCode,r.name,r.customer,r.channel,r.qty,r.note
   ].join('|')));
   PRELOADED_ALL_CO_ORDER_HISTORY.forEach(r=>{
     const k=[r.date,r.orderNo,r.sourceOrderNo,r.productCode,r.name,r.customer,r.channel,r.qty,r.note].join('|');
     if(!keys.has(k)){db.orderHistory.push(r);keys.add(k);}
   });
   db.orderHistoryAllCOVersion='ALL-CO-2026-10-07';
   try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){console.warn('歷史訂單儲存空間不足',e);}
 }
}

function ensureHistoricalGiftProducts(){
 if(!Array.isArray(db.products)) db.products=[];
 if(db.historicalGiftsOnce==='v1')return; // 只在第一次搬資料時補回，之後刪掉的歷史禮盒不會再出現
 let changed=false;
 HISTORICAL_GIFT_PRODUCTS.forEach(p=>{
   if(!db.products.some(x=>String(x.code||'').trim()===p.code)){
     db.products.push({id:'histgift_'+p.code.replace(/[^A-Za-z0-9]/g,'_'),code:p.code,name:p.name,category:'禮盒'});
     changed=true;
   }
 });
 db.historicalGiftsOnce='v1';
 try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){console.warn('禮盒資料儲存空間不足',e);}
}










let salesForecastSaveTimer=null;


































const SF_LOCATIONS=['dongqiao','a11','jingzhan','web','channel','pr','ceo','grandduchy'];
const SF_LABELS={dongqiao:'東橋',a11:'A11',jingzhan:'京站',web:'官網',channel:'通路',pr:'公關贈',ceo:'執行長',grandduchy:'大公國'};
function ensureSalesForecast(){if(!db.salesForecastV5)db.salesForecastV5={campaignName:'',lastYear:{},rows:{}};SF_LOCATIONS.forEach(k=>{if(db.salesForecastV5.lastYear[k]==null)db.salesForecastV5.lastYear[k]=0;});}
function getForecastProducts(){return (db.products||[]).filter(p=>String(p.category||'').trim()!=='單條' && p.isListedCurrent===true);}
function sfRow(code){ensureSalesForecast();if(!db.salesForecastV5.rows[code])db.salesForecastV5.rows[code]={price:0,dates:['','','',''],lines:{}};const r=db.salesForecastV5.rows[code];if(!Array.isArray(r.dates))r.dates=['','','',''];if(!r.lines)r.lines={};if(r.price==null)r.price=0;if(!r.amounts)r.amounts={};SF_LOCATIONS.forEach(k=>{if(!r.amounts[k])r.amounts[k]={est:null,act:null};});for(let n=0;n<4;n++){if(!r.lines[n])r.lines[n]={};SF_LOCATIONS.forEach(k=>{if(!r.lines[n][k])r.lines[n][k]={est:0,act:0};});}return r;}
function renderSalesForecast(){ensureSalesForecast();const d=db.salesForecastV5,cn=document.getElementById('forecast-campaign-name');if(cn)cn.value=d.campaignName||'';document.querySelectorAll('.sf-lastyear').forEach(e=>e.value=(Number(d.lastYear[e.dataset.sfLast])||0)||'');const body=document.getElementById('salesForecastBody');if(!body)return;body.innerHTML=getForecastProducts().map(p=>{const code=String(p.code||p.id||''),r=sfRow(code),key=code.replace(/[^A-Za-z0-9]/g,'_');const heads=SF_LOCATIONS.map(k=>`<th colspan="2">${SF_LABELS[k]}</th>`).join('');const subs=SF_LOCATIONS.map(()=>'<th>預估</th><th>實際</th>').join('');const rows=[0,1,2,3].map(n=>`<tr><td class="sf-date"><input type="date" aria-label="日期 ${n+1}" value="${escHist(r.dates[n]||'')}" data-sf-code="${code}" data-sf-date-index="${n}" onchange="updateSalesForecastDate(this)"></td>${SF_LOCATIONS.map(k=>{const x=r.lines[n][k];return `<td class="sf-est"><input type="number" min="0" value="${Number(x.est)||''}" data-sf-code="${code}" data-sf-date="${n}" data-sf-loc="${k}" data-sf-kind="est" oninput="updateSalesForecastCell(this)"></td><td class="sf-act"><input type="number" min="0" value="${Number(x.act)||''}" data-sf-code="${code}" data-sf-date="${n}" data-sf-loc="${k}" data-sf-kind="act" oninput="updateSalesForecastCell(this)"></td>`}).join('')}<td id="sf-row-${key}-${n}"></td></tr>`).join('');const totals=SF_LOCATIONS.map(k=>`<td id="sf-${key}-${k}-est-total"></td><td id="sf-${key}-${k}-act-total"></td>`).join('');const amounts=SF_LOCATIONS.map(k=>`<td class="sf-est sf-calculated" id="sf-${key}-${k}-est-amount"></td><td class="sf-act sf-calculated" id="sf-${key}-${k}-act-amount"></td>`).join('');return `<div class="forecast-product-block"><table class="sheet-table forecast-product-table"><colgroup><col style="width:12%"><col style="width:5.25%"><col style="width:5.25%"><col style="width:5.25%"><col style="width:5.25%"><col style="width:5.25%"><col style="width:5.25%"><col style="width:5.25%"><col style="width:5.25%"><col style="width:5.25%"><col style="width:5.25%"><col style="width:5.25%"><col style="width:5.25%"><col style="width:5.25%"><col style="width:5.25%"><col style="width:5.25%"><col style="width:5.25%"><col style="width:4%"></colgroup><thead><tr><th class="sf-product-name">${escHist(code)} ${escHist(p.name||'')}</th>${heads}<th rowspan="2">小計</th></tr><tr><th>日期</th>${subs}</tr></thead><tbody>${rows}<tr class="sf-total-row"><th>總計</th>${totals}<th id="sf-${key}-grandqty"></th></tr><tr class="sf-amount-row"><th>金額</th>${amounts}<th id="sf-${key}-grandamount"></th></tr></tbody></table></div>`;}).join('');recalcSalesForecast();refreshSalesForecastProductOptions();filterSalesForecastProducts();}
function updateSalesForecastAmount(el){const r=sfRow(el.dataset.sfCode);r.amounts[el.dataset.sfAmountLoc][el.dataset.sfAmountKind]=Number(el.value)||0;recalcSalesForecast();scheduleSalesForecastSave();}
function updateSalesForecastPrice(el){sfRow(el.dataset.sfCode).price=Number(el.value)||0;recalcSalesForecast();scheduleSalesForecastSave();}
function updateSalesForecastDate(el){sfRow(el.dataset.sfCode).dates[Number(el.dataset.sfDateIndex)]=el.value||'';scheduleSalesForecastSave();}
function updateSalesForecastCell(el){const r=sfRow(el.dataset.sfCode),n=Number(el.dataset.sfDate);r.lines[n][el.dataset.sfLoc][el.dataset.sfKind]=Number(el.value)||0;recalcSalesForecast();scheduleSalesForecastSave();}
function updateSalesForecastLastYear(el){ensureSalesForecast();db.salesForecastV5.lastYear[el.dataset.sfLast]=Number(el.value)||0;recalcSalesForecast();scheduleSalesForecastSave();}

function sfUnitPrice(product){
 const direct=Number(product?.price);
 if(Number.isFinite(direct)&&direct>0)return direct;
 // 「計算規則」關掉內建備用售價時，只用禮盒資料填的售價
 if(window.CMSRules&&!CMSRules.get('useBuiltinPrices'))return 0;
 const code=String(product?.code||'').trim();
 if(typeof EXCEL_GIFT_IMPORT_20261008!=='undefined'){
   const excel=EXCEL_GIFT_IMPORT_20261008.find(x=>x.code===code);
   const v=Number(excel?.price);
   if(Number.isFinite(v)&&v>0)return v;
 }
 const known={'CO-43':480,'CO-42':690,'CO-67':690,'CO-80':480,'CO-83':480,'CO-84':690,'CO-89':690,'CO-99':690,'CO-A2':780,'CO-A3':780,'CO-A4':780,'CO-A5':350,'CO-A6':690,'CO-A7':690};
 return known[code]||0;
}
function recalcSalesForecast(){
 ensureSalesForecast();const summary={};SF_LOCATIONS.forEach(k=>summary[k]=0);
 getForecastProducts().forEach(p=>{
  const code=String(p.code||p.id||''),r=sfRow(code),key=code.replace(/[^A-Za-z0-9]/g,'_'),price=sfUnitPrice(p);
  let grandQty=0,grandAmount=0;
  SF_LOCATIONS.forEach(k=>{
   let te=0,ta=0;
   for(let n=0;n<4;n++){te+=Number(r.lines[n][k].est)||0;ta+=Number(r.lines[n][k].act)||0;}
   const amount=te*price,actualAmount=ta*price;
   summary[k]+=amount;grandQty+=te;grandAmount+=amount;
   const ids=[[`sf-${key}-${k}-est-total`,te],[`sf-${key}-${k}-act-total`,ta],[`sf-${key}-${k}-est-amount`,amount],[`sf-${key}-${k}-act-amount`,actualAmount]];
   ids.forEach(([id,v])=>{const el=document.getElementById(id);if(el)el.textContent=v? v.toLocaleString():'';});
  });
  for(let n=0;n<4;n++){
   let q=0;SF_LOCATIONS.forEach(k=>q+=Number(r.lines[n][k].est)||0);
   const el=document.getElementById(`sf-row-${key}-${n}`);if(el)el.textContent=q.toLocaleString();
  }
  const gq=document.getElementById(`sf-${key}-grandqty`),ga=document.getElementById(`sf-${key}-grandamount`);
  if(gq)gq.textContent=grandQty?grandQty.toLocaleString():'';if(ga)ga.textContent=grandAmount?grandAmount.toLocaleString():'';
 });
 let all=0;SF_LOCATIONS.forEach(k=>{all+=summary[k];const e=document.getElementById(`sf-summary-${k}`);if(e)e.textContent=summary[k]?summary[k].toLocaleString():'';});
 const st=document.getElementById('sf-summary-total');if(st)st.textContent=all?all.toLocaleString():'';
 let ly=0;SF_LOCATIONS.forEach(k=>ly+=Number(db.salesForecastV5.lastYear[k])||0);
 const lyt=document.getElementById('sf-lastyear-total');if(lyt)lyt.textContent=ly?ly.toLocaleString():'';
}
function saveSalesForecastDebounced(){ensureSalesForecast();db.salesForecastV5.campaignName=document.getElementById('forecast-campaign-name')?.value||'';scheduleSalesForecastSave();}
function scheduleSalesForecastSave(){clearTimeout(salesForecastSaveTimer);salesForecastSaveTimer=setTimeout(()=>{try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){console.warn(e)}},5000);}

function refreshSalesForecastProductOptions(){
 const select=document.getElementById('forecast-product-search');
 if(!select)return;
 const previous=select.value;
 const products=getForecastProducts();
 select.replaceChildren(new Option('全部品項',''));
 products.forEach(p=>{
  const code=String(p.code||p.id||'');
  select.add(new Option(`${code} ${p.name||''}`,code));
 });
 select.value=products.some(p=>String(p.code||p.id||'')===previous)?previous:'';
}
function filterSalesForecastProducts(){
 const selected=document.getElementById('forecast-product-search')?.value||'';
 const blocks=document.querySelectorAll('#salesForecastBody .forecast-product-block');
 let visible=0;
 blocks.forEach((block,index)=>{
  const product=getForecastProducts()[index];
  const match=!selected||String(product?.code||product?.id||'')===selected;
  block.style.display=match?'':'none';
  if(match)visible++;
 });
 const count=document.getElementById('forecast-search-count');
 if(count)count.textContent=selected?`符合 ${visible} 個品項`:'';
}

const ORDER_DEPARTMENT_LOOKUP={}; // 已移除：訂單個資不放在網站檔案中
function applyOrderDepartments(){
 if(!Array.isArray(db.orderHistory))return;
 db.orderHistory.forEach(r=>{
  const k=[r.date||'',r.orderNo||'',r.sourceOrderNo||'',r.productCode||''].join('|');
  if(ORDER_DEPARTMENT_LOOKUP[k])r.orderDepartment=ORDER_DEPARTMENT_LOOKUP[k];
  if(ORIGINAL_DEPARTMENT_LOOKUP[k])r.department=ORIGINAL_DEPARTMENT_LOOKUP[k];
 });
}

const ORIGINAL_DEPARTMENT_LOOKUP={}; // 已移除：訂單個資不放在網站檔案中


const EXCEL_GIFT_IMPORT_20261008=[{"id":"dbprod6","code":"CO-43","name":"鳳費5入","price":480,"listed":false,"formula":[{"type":"單條內容物","item":"鳳費","qty":5},{"type":"包材","item":"金鑽盒","qty":1},{"type":"包材","item":"金鑽蓋","qty":1}]},{"id":"dbprod7","code":"CO-83","name":"草費5入","price":480,"listed":false,"formula":[{"type":"單條內容物","item":"草費","qty":5},{"type":"包材","item":"金鑽盒","qty":1},{"type":"包材","item":"金鑽蓋","qty":1}]},{"id":"dbprod8","code":"CO-80","name":"乳酪費5入","price":480,"listed":false,"formula":[{"type":"單條內容物","item":"乳酪費","qty":5},{"type":"包材","item":"金鑽盒","qty":1},{"type":"包材","item":"金鑽蓋","qty":1}]},{"id":"dbprod9","code":"CO-42","name":"鳳費8入","price":690,"listed":false,"formula":[{"type":"單條內容物","item":"鳳費","qty":8},{"type":"包材","item":"袖套盒","qty":1},{"type":"包材","item":"袖套","qty":1}]},{"id":"dbprod10","code":"CO-67","name":"草費+乳酪費8入","price":690,"listed":false,"formula":[{"type":"單條內容物","item":"草費","qty":4},{"type":"單條內容物","item":"乳酪費","qty":4},{"type":"包材","item":"袖套盒","qty":1},{"type":"包材","item":"袖套","qty":1}]},{"id":"dbprod11","code":"CO-84","name":"草費8入","price":690,"listed":false,"formula":[{"type":"單條內容物","item":"草費","qty":8},{"type":"包材","item":"袖套盒","qty":1},{"type":"包材","item":"袖套","qty":1}]},{"id":"dbprod12","code":"CO-89","name":"鳳費+草費8入","price":690,"listed":false,"formula":[{"type":"單條內容物","item":"鳳費","qty":4},{"type":"單條內容物","item":"草費","qty":4},{"type":"包材","item":"袖套盒","qty":1},{"type":"包材","item":"袖套","qty":1}]},{"id":"dbprod13","code":"CO-73","name":"柑費8入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"柑費","qty":8},{"type":"包材","item":"袖套盒","qty":1},{"type":"包材","item":"袖套","qty":1}]},{"id":"dbprod14","code":"CO-99","name":"鳳費+乳酪費8入","price":690,"listed":false,"formula":[{"type":"單條內容物","item":"鳳費","qty":4},{"type":"單條內容物","item":"乳酪費","qty":4},{"type":"包材","item":"袖套盒","qty":1},{"type":"包材","item":"袖套","qty":1}]},{"id":"dbprod16","code":"CO-A6","name":"乳酪費8入","price":690,"listed":false,"formula":[{"type":"單條內容物","item":"乳酪費","qty":8},{"type":"包材","item":"袖套盒","qty":1},{"type":"包材","item":"袖套","qty":1}]},{"id":"dbprod17","code":"CO-A2","name":"乳酪蛋捲10入","price":780,"listed":false,"formula":[{"type":"單條內容物","item":"乳酪蛋捲","qty":10},{"type":"包材","item":"濃蛋捲盒","qty":1},{"type":"包材","item":"濃蛋捲袖套","qty":1}]},{"id":"dbprod18","code":"CO-A3","name":"花生蛋捲10入","price":780,"listed":false,"formula":[{"type":"單條內容物","item":"花生蛋捲","qty":10},{"type":"包材","item":"濃蛋捲盒","qty":1},{"type":"包材","item":"濃蛋捲袖套","qty":1}]},{"id":"dbprod19","code":"CO-A4","name":"蛋捲乳5+花5","price":780,"listed":false,"formula":[{"type":"單條內容物","item":"乳酪蛋捲","qty":5},{"type":"單條內容物","item":"花生蛋捲","qty":5},{"type":"包材","item":"濃蛋捲盒","qty":1},{"type":"包材","item":"濃蛋捲袖套","qty":1}]},{"id":"dbprod20","code":"CO-A5","name":"鳳+乳+草費3入","price":350,"listed":false,"formula":[{"type":"單條內容物","item":"鳳費","qty":1},{"type":"單條內容物","item":"乳酪費","qty":1},{"type":"單條內容物","item":"草費","qty":1}]},{"id":"dbprod21","code":"CO-A7","name":"鳳費+乳費4入","price":690,"listed":false,"formula":[{"type":"單條內容物","item":"鳳費","qty":2},{"type":"單條內容物","item":"乳酪費","qty":2}]},{"id":"histgift_CO_24","code":"CO-24","name":"松露費","price":null,"listed":false,"formula":[]},{"id":"histgift_CO_46","code":"CO-46","name":"巧費","price":null,"listed":false,"formula":[]},{"id":"histgift_CO_60","code":"CO-60","name":"綜合咖啡8入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"巧費","qty":1},{"type":"單條內容物","item":"柑費","qty":1},{"type":"單條內容物","item":"鳳費","qty":1},{"type":"單條內容物","item":"草費","qty":1},{"type":"單條內容物","item":"(包)益生菌咖","qty":4}]},{"id":"histgift_CO_62","code":"CO-62","name":"巧費5入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"巧費","qty":5}]},{"id":"histgift_CO_63","code":"CO-63","name":"鳳+草+乳酪+巧4入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"鳳費","qty":1},{"type":"單條內容物","item":"草費","qty":1},{"type":"單條內容物","item":"乳酪費","qty":1},{"type":"單條內容物","item":"巧費","qty":1}]},{"id":"histgift_CO_64","code":"CO-64","name":"鳳+草+乳酪+巧8入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"鳳費","qty":2},{"type":"單條內容物","item":"草費","qty":2},{"type":"單條內容物","item":"乳酪費","qty":2},{"type":"單條內容物","item":"巧費","qty":2}]},{"id":"histgift_CO_65","code":"CO-65","name":"鳳+草+巧+松露4入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"鳳費","qty":1},{"type":"單條內容物","item":"草費","qty":1},{"type":"單條內容物","item":"巧費","qty":1},{"type":"單條內容物","item":"松露費","qty":1}]},{"id":"histgift_CO_66","code":"CO-66","name":"鳳+草+巧+松露8入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"鳳費","qty":2},{"type":"單條內容物","item":"草費","qty":2},{"type":"單條內容物","item":"巧費","qty":2},{"type":"單條內容物","item":"松露費","qty":2}]},{"id":"histgift_CO_68","code":"CO-68","name":"鳳費+巧費8入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"鳳費","qty":4},{"type":"單條內容物","item":"巧費","qty":4}]},{"id":"histgift_CO_69","code":"CO-69","name":"松露費5入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"松露費","qty":5}]},{"id":"histgift_CO_72","code":"CO-72","name":"柑費5入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"柑費","qty":5}]},{"id":"histgift_CO_74","code":"CO-74","name":"巧+柑費8入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"巧費","qty":4},{"type":"單條內容物","item":"柑費","qty":4}]},{"id":"histgift_CO_75","code":"CO-75","name":"巧+柑+鳳+草4入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"巧費","qty":1},{"type":"單條內容物","item":"柑費","qty":1},{"type":"單條內容物","item":"鳳費","qty":1},{"type":"單條內容物","item":"草費","qty":1}]},{"id":"histgift_CO_76","code":"CO-76","name":"巧+柑+鳳+草8入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"巧費","qty":2},{"type":"單條內容物","item":"柑費","qty":2},{"type":"單條內容物","item":"鳳費","qty":2},{"type":"單條內容物","item":"草費","qty":2}]},{"id":"histgift_CO_77","code":"CO-77","name":"巧+草費8入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"巧費","qty":4},{"type":"單條內容物","item":"草費","qty":4}]},{"id":"histgift_CO_78","code":"CO-78","name":"鳳+可+草8入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"巧費","qty":2},{"type":"單條內容物","item":"鳳費","qty":4},{"type":"單條內容物","item":"草費","qty":2}]},{"id":"histgift_CO_79","code":"CO-79","name":"鳳+可+草4入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"巧費","qty":1},{"type":"單條內容物","item":"鳳費","qty":2},{"type":"單條內容物","item":"草費","qty":1}]},{"id":"histgift_CO_81","code":"CO-81","name":"鳳+草+乳酪+巧+松露5入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"鳳費","qty":1},{"type":"單條內容物","item":"草費","qty":1},{"type":"單條內容物","item":"乳酪費","qty":1},{"type":"單條內容物","item":"巧費","qty":1},{"type":"單條內容物","item":"松露費","qty":1}]},{"id":"histgift_CO_97","code":"CO-97","name":"鳳+草+可+酪16入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"鳳費","qty":4},{"type":"單條內容物","item":"草費","qty":4},{"type":"單條內容物","item":"巧費","qty":4},{"type":"單條內容物","item":"乳酪費","qty":4}]},{"id":"histgift_CO_98","code":"CO-98","name":"鳳+草+可+酪+桔5入","price":null,"listed":false,"formula":[{"type":"單條內容物","item":"鳳費","qty":1},{"type":"單條內容物","item":"草費","qty":1},{"type":"單條內容物","item":"巧費","qty":1},{"type":"單條內容物","item":"乳酪費","qty":1},{"type":"單條內容物","item":"柑費","qty":1}]}];
function importUpdatedGiftExcelOnce(){
 const version='20261008-v3-components-fixed';
 if(db.giftExcelImportVersion===version)return;
 if(!Array.isArray(db.products))db.products=[];
 if(!Array.isArray(db.components))db.components=[];
 if(!Array.isArray(db.recipes))db.recipes=[];
 if(!Array.isArray(db.materials))db.materials=[];
 const warnings=[];
 const normalize=v=>String(v==null?'':v).trim().replace(/\s+/g,'').toLowerCase();
 const wantedSingles=new Set();
 EXCEL_GIFT_IMPORT_20261008.forEach(item=>(item.formula||[]).forEach(f=>{
   if(f.type!=='包材' && f.item)wantedSingles.add(String(f.item).trim());
 }));
 wantedSingles.forEach(name=>{
   const found=db.products.some(p=>p.category==='單條'&&normalize(p.name)===normalize(name));
   if(!found){
     const safeId='xl_single_'+Array.from(name).map(ch=>ch.codePointAt(0).toString(16)).join('_');
     db.products.push({id:safeId,code:'',name,category:'單條'});
   }
 });
 EXCEL_GIFT_IMPORT_20261008.forEach(item=>{
   let p=db.products.find(x=>x.id===item.id&&x.category!=='單條');
   if(!p)p=db.products.find(x=>x.category==='禮盒'&&normalize(x.code)===normalize(item.code));
   if(!p){warnings.push(item.code+'：找不到原有禮盒');return;}
   Object.assign(p,{code:item.code,name:item.name,category:'禮盒',price:item.price==null||item.price===''?null:Number(item.price),isListedCurrent:item.listed===true});
   db.components=db.components.filter(c=>c.productId!==p.id);
   // Excel 更新單條內容物；現有包材配方在此保留，由包材回填清單核對補足。
   (item.formula||[]).forEach((f,i)=>{
     const qty=Number(f.qty);
     if(!Number.isFinite(qty)||qty<=0){warnings.push(item.code+'／'+f.item+'：數量無效');return;}
     const isMaterial=f.type==='包材';
     const target=isMaterial
       ?db.materials.find(m=>normalize(m.name)===normalize(f.item)||normalize(m.code)===normalize(f.item))
       :db.products.find(x=>x.category==='單條'&&(normalize(x.name)===normalize(f.item)||normalize(x.code)===normalize(f.item)));
     if(!target){warnings.push(item.code+'／'+f.item+'：找不到配方品項');return;}
     if(isMaterial)db.recipes.push({id:'xlrec3_'+p.id+'_'+i,productId:p.id,materialId:target.id,qty});
     else db.components.push({id:'xlcomp3_'+p.id+'_'+i,productId:p.id,componentProductId:target.id,qty});
   });
 });
 db.giftExcelImportWarnings=warnings;
 db.giftExcelImportVersion=version;
 try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){
   console.error('Excel 匯入資料儲存失敗',e);
   alert('禮盒資料已載入，但本機儲存空間不足。請先匯出 JSON 備份，避免資料遺失。');
 }
}


function inlineGiftOptions(kind,selected){
 const items=kind==='material'?(db.materials||[]):(db.products||[]).filter(p=>p.category==='單條');
 return '<option value="">請選擇品項</option>'+items.map(p=>`<option value="${p.id}" ${String(p.id)===String(selected)?'selected':''}>${escapeInlineGiftText((p.code?p.code+' ':'')+p.name)}</option>`).join('');
}
function escapeInlineGiftText(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function createInlineGiftFormulaRow(pid,type='product',item='',qty=''){
 const tr=document.createElement('div');tr.className='inline-gift-one';
 tr.innerHTML=`<select class="igr-kind" onchange="changeInlineGiftKind(this)"><option value="product" ${type==='product'?'selected':''}>單條內容物</option><option value="material" ${type==='material'?'selected':''}>包材</option></select><select class="igr-item">${inlineGiftOptions(type,item)}</select><input class="igr-qty" type="number" min="0.01" step="0.01" placeholder="數量" value="${escapeInlineGiftText(qty)}"><button type="button" onclick="this.closest('.inline-gift-one').remove();refreshInlineGiftLimit('${pid}')">移除</button>`;
 return tr;
}
function changeInlineGiftKind(el){const row=el.closest('.inline-gift-one');row.querySelector('.igr-item').innerHTML=inlineGiftOptions(el.value,'');}
function refreshInlineGiftLimit(pid){const row=document.getElementById('inline-gift-'+pid);if(!row)return;const count=row.querySelectorAll('.inline-gift-one').length;const btn=row.querySelector('.inline-add-btn');if(btn)btn.disabled=count>=8;const label=row.querySelector('.inline-recipe-count');if(label)label.textContent=`${count}/8 項`;}
function appendInlineGiftRecipe(pid){const panel=document.getElementById('inline-gift-'+pid),list=panel?.querySelector('.inline-gift-items');if(!list||list.children.length>=8)return;list.appendChild(createInlineGiftFormulaRow(pid));refreshInlineGiftLimit(pid);}
function toggleInlineGiftRecipe(pid){
 const row=document.getElementById('inline-gift-'+pid);if(!row)return;
 if(row.style.display!=='none'){row.style.display='none';return;}
 document.querySelectorAll('.inline-gift-recipe-row').forEach(x=>x.style.display='none');
 const p=db.products.find(x=>String(x.id)===String(pid));if(!p)return;
 row.style.display='table-row';
 const wrap=row.querySelector('.inline-gift-recipe-wrap');
 wrap.innerHTML=`<div class="inline-recipe-header"><strong>${escapeInlineGiftText(p.code||'')} ${escapeInlineGiftText(p.name||'')}｜直接編輯配方</strong><span class="inline-recipe-count"></span></div><div class="inline-gift-items"></div><div class="inline-recipe-actions"><button type="button" class="inline-add-btn" onclick="appendInlineGiftRecipe('${pid}')">＋ 新增配方項目</button><button type="button" class="btn primary" onclick="saveInlineGiftRecipe('${pid}')">儲存配方</button><button type="button" onclick="toggleInlineGiftRecipe('${pid}')">取消</button></div>`;
 const list=wrap.querySelector('.inline-gift-items');
 const components=(db.components||[]).filter(x=>String(x.productId)===String(pid)).map(x=>['product',x.componentProductId,x.qty]);
 const materials=(db.recipes||[]).filter(x=>String(x.productId)===String(pid)).map(x=>['material',x.materialId,x.qty]);
 const entries=[...components,...materials].slice(0,8);
 if(!entries.length)entries.push(['product','','']);
 entries.forEach(v=>list.appendChild(createInlineGiftFormulaRow(pid,...v)));
 refreshInlineGiftLimit(pid);
}
function saveInlineGiftRecipe(pid){
 const row=document.getElementById('inline-gift-'+pid),items=[...row.querySelectorAll('.inline-gift-one')];
 const newComponents=[],newRecipes=[];
 for(const el of items){
   const kind=el.querySelector('.igr-kind').value,item=el.querySelector('.igr-item').value,raw=el.querySelector('.igr-qty').value.trim();
   if(!item&&!raw)continue;
   const qty=Number(raw);
   if(!item||!raw||!Number.isFinite(qty)||qty<=0){alert('請檢查每筆配方：品項必須選擇，數量必須大於 0。');return;}
   if(kind==='material')newRecipes.push({id:id(),productId:pid,materialId:item,qty});
   else newComponents.push({id:id(),productId:pid,componentProductId:item,qty});
 }
 if(newComponents.length+newRecipes.length>8){alert('每個禮盒最多 8 項配方');return;}
 db.components=[...(db.components||[]).filter(x=>String(x.productId)!==String(pid)),...newComponents];
 db.recipes=[...(db.recipes||[]).filter(x=>String(x.productId)!==String(pid)),...newRecipes];
 try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){alert('儲存空間不足，請先備份資料。');return;}
 render();renderDashboard();
}

function backfillGiftPricesOnce(){
 const version='20261008-gift-prices-v1';
 if(db.giftPriceBackfillVersion===version)return;
 const prices={"CO-43":480,"CO-42":690,"CO-67":690,"CO-80":480,"CO-83":480,"CO-84":690,"CO-89":690,"CO-99":690,"CO-A2":780,"CO-A3":780,"CO-A4":780,"CO-A5":350,"CO-A6":690,"CO-A7":690};
 let updated=0;
 (db.products||[]).forEach(p=>{
   const code=String(p.code||'').trim();
   if(p.category!=='單條' && Object.prototype.hasOwnProperty.call(prices,code)){
     p.price=prices[code]; updated++;
   }
 });
 db.giftPriceBackfillVersion=version;
 try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){console.warn('售價儲存失敗',e);}
}


function applyRequestedListedProductsOnce(){
 const version='20261008-22-listed-codes-v1';
 if(db.listedSelectionVersion===version)return;
 const selected=new Set(['CO-04','CO-38','CO-43','CO-42','CO-67','CO-80','CO-82','CO-83','CO-84','CO-89','CO-71','CO-73','CO-99','CO-99|YA-24','CO-A0','CO-A1','CO-A2','CO-A3','CO-A4','CO-A5','CO-A6','CO-A7']);
 const singleCodes={'乳酪費':'CO-04','鳳費':'CO-38','草費':'CO-82','柑費':'CO-71','乳酪蛋捲':'CO-A0','花生蛋捲':'CO-A1'};
 (db.products||[]).forEach(p=>{
   if(p.category==='單條'&&singleCodes[p.name]&&!p.code)p.code=singleCodes[p.name];
   p.isListedCurrent=selected.has(String(p.code||'').trim());
 });
 // 客製腰封為獨立品號，不與一般 CO-99 合併；尚未指定的配方先保持空白。
 if(!db.products.some(p=>String(p.code||'').trim()==='CO-99|YA-24')){
   db.products.push({id:'listed_gift_CO99_YA24',code:'CO-99|YA-24',name:'鳳費+乳酪費8入|客製腰封',category:'禮盒',price:null,isListedCurrent:true});
 }
 db.listedSelectionVersion=version;
 try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){console.warn('本期上架設定儲存失敗',e);}
}



const RECOVERED_PACKAGING_RECIPES = {"CO-43":[{"name":"金鑽盒","qty":1.0},{"name":"金鑽蓋","qty":1.0}],"CO-83":[{"name":"金鑽盒","qty":1.0},{"name":"金鑽蓋","qty":1.0}],"CO-80":[{"name":"金鑽盒","qty":1.0},{"name":"金鑽蓋","qty":1.0}],"CO-42":[{"name":"袖套盒","qty":1.0},{"name":"袖套","qty":1.0}],"CO-67":[{"name":"袖套盒","qty":1.0},{"name":"袖套","qty":1.0}],"CO-84":[{"name":"袖套盒","qty":1.0},{"name":"袖套","qty":1.0}],"CO-89":[{"name":"袖套盒","qty":1.0},{"name":"袖套","qty":1.0}],"CO-73":[{"name":"袖套盒","qty":1.0},{"name":"袖套","qty":1.0}],"CO-99":[{"name":"袖套盒","qty":1.0},{"name":"袖套","qty":1.0}],"CO-A6":[{"name":"袖套盒","qty":1.0},{"name":"袖套","qty":1.0}],"CO-A2":[{"name":"濃蛋捲盒","qty":1.0},{"name":"濃蛋捲袖套","qty":1.0}],"CO-A3":[{"name":"濃蛋捲盒","qty":1.0},{"name":"濃蛋捲袖套","qty":1.0}],"CO-A4":[{"name":"濃蛋捲盒","qty":1.0},{"name":"濃蛋捲袖套","qty":1.0}],"CO-62":[{"name":"金鑽盒","qty":1.0}],"CO-64":[{"name":"袖套盒","qty":1.0},{"name":"袖套","qty":1.0}],"CO-66":[{"name":"袖套盒","qty":1.0},{"name":"袖套","qty":1.0}],"CO-68":[{"name":"袖套盒","qty":1.0},{"name":"袖套","qty":1.0}],"CO-69":[{"name":"金鑽盒","qty":1.0}],"CO-72":[{"name":"金鑽盒","qty":1.0}],"CO-74":[{"name":"袖套盒","qty":1.0},{"name":"袖套","qty":1.0}],"CO-76":[{"name":"袖套盒","qty":1.0},{"name":"袖套","qty":1.0}],"CO-77":[{"name":"袖套盒","qty":1.0},{"name":"袖套","qty":1.0}],"CO-78":[{"name":"袖套盒","qty":1.0},{"name":"袖套","qty":1.0}],"CO-81":[{"name":"金鑽盒","qty":1.0}],"CO-98":[{"name":"金鑽盒","qty":1.0}]};
function restoreMissingPackagingRecipesOnce(){
 if(db.packagingRecoveryOnce==='v1')return db.packagingRecoveryInfo||{added:0,created:0,unresolved:[],expected:0}; // 只在第一次搬資料時補回，之後保留使用者修改的配方
 if(!Array.isArray(db.recipes))db.recipes=[];
 if(!Array.isArray(db.materials))db.materials=[];
 if(!Array.isArray(db.products))db.products=[];
 const norm=v=>String(v??'').trim().replace(/\s+/g,'').toLowerCase();
 const legacy={"CO-43":"dbprod6","CO-83":"dbprod7","CO-80":"dbprod8","CO-42":"dbprod9","CO-67":"dbprod10","CO-84":"dbprod11","CO-89":"dbprod12","CO-73":"dbprod13","CO-99":"dbprod14","CO-A6":"dbprod16","CO-A2":"dbprod17","CO-A3":"dbprod18","CO-A4":"dbprod19"};
 const baseMaterials={"金鑽盒":"mat1","金鑽蓋":"mat2","袖套盒":"mat3","袖套":"mat4","濃蛋捲盒":"mat5","濃蛋捲袖套":"mat6"};
 let added=0,created=0; const unresolved=[];
 Object.entries(RECOVERED_PACKAGING_RECIPES).forEach(([code,parts])=>{
   let p=db.products.find(x=>x.category!=='單條'&&norm(x.code)===norm(code));
   if(!p&&legacy[code])p=db.products.find(x=>x.id===legacy[code]);
   if(!p){unresolved.push(code+' 找不到禮盒');return;}
   parts.forEach(part=>{
     let mat=db.materials.find(m=>norm(m.name)===norm(part.name)||norm(m.code)===norm(part.name));
     if(!mat){
       // Original built-in catalog had these six material IDs. Recreate if lost during localStorage migration.
       const originalId=baseMaterials[part.name];
       mat=db.materials.find(m=>m.id===originalId);
       if(!mat&&originalId){mat={id:originalId,code:'',name:part.name,category:'盒子',unit:'個',safety:0};db.materials.push(mat);created++;}
     }
     if(!mat){unresolved.push(code+' '+part.name+' 找不到包材');return;}
     const prior=db.recipes.find(r=>String(r.productId)===String(p.id)&&String(r.materialId)===String(mat.id));
     if(prior)return;
     db.recipes.push({id:'fixedpkg_'+p.id+'_'+mat.id,productId:p.id,materialId:mat.id,qty:Number(part.qty)});added++;
   });
 });
 db.packagingRecoveryInfo={added,created,unresolved,expected:Object.values(RECOVERED_PACKAGING_RECIPES).reduce((n,a)=>n+a.length,0)};
 db.packagingRecoveryOnce='v1';
 try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){console.warn('包材配方無法儲存到瀏覽器',e);}
 return db.packagingRecoveryInfo;
}

// 在所有預載資料與函式定義完成之後執行，確保上架與預估同步。
try {
 try{load();}catch(e){console.warn('舊版隱藏區塊略過',e);}
 ensureHistoricalGiftProducts();
  importUpdatedGiftExcelOnce();
  restoreMissingPackagingRecipesOnce();
 backfillGiftPricesOnce();
 applyRequestedListedProductsOnce();
 try{render();}catch(e){console.warn('舊版隱藏區塊略過',e);}
 try{renderDashboard();}catch(e){console.warn('首頁統計錯誤',e);}
} catch (e) { console.error('資料初始化失敗',e); }

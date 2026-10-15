const KEY='campaign_material_system_v1';
let db={"materials":[{"id":"mat1","code":"","name":"金鑽盒","category":"盒子","unit":"個","safety":0},{"id":"mat2","code":"","name":"金鑽蓋","category":"盒子","unit":"個","safety":0},{"id":"mat3","code":"","name":"袖套盒","category":"盒子","unit":"個","safety":0},{"id":"mat4","code":"","name":"袖套","category":"盒子","unit":"個","safety":0},{"id":"mat5","code":"","name":"濃蛋捲盒","category":"盒子","unit":"個","safety":0},{"id":"mat6","code":"","name":"濃蛋捲袖套","category":"盒子","unit":"個","safety":0}],"products":[{"id":"dbprod1","code":"","name":"乳酪費","category":"單條"},{"id":"dbprod2","code":"","name":"鳳費","category":"單條"},{"id":"dbprod3","code":"","name":"草費","category":"單條"},{"id":"dbprod4","code":"","name":"乳酪蛋捲","category":"單條"},{"id":"dbprod5","code":"","name":"花生蛋捲","category":"單條"},{"id":"dbprod6","code":"","name":"鳳費5入","category":"禮盒"},{"id":"dbprod7","code":"","name":"草費5入","category":"禮盒"},{"id":"dbprod8","code":"","name":"乳酪費5入","category":"禮盒"},{"id":"dbprod9","code":"","name":"鳳費8入","category":"禮盒"},{"id":"dbprod10","code":"","name":"草費+乳酪費8入","category":"禮盒"},{"id":"dbprod11","code":"","name":"草費8入","category":"禮盒"},{"id":"dbprod12","code":"","name":"鳳費+草費8入","category":"禮盒"},{"id":"dbprod13","code":"","name":"柑費8入","category":"禮盒"},{"id":"dbprod14","code":"","name":"鳳費+乳酪費8入","category":"禮盒"},{"id":"dbprod15","code":"","name":"鳳費+乳酪費8入|客製腰封","category":"禮盒"},{"id":"dbprod16","code":"","name":"乳酪費8入","category":"禮盒"},{"id":"dbprod17","code":"","name":"乳酪蛋捲10入","category":"禮盒"},{"id":"dbprod18","code":"","name":"花生蛋捲10入","category":"禮盒"},{"id":"dbprod19","code":"","name":"蛋捲乳5+花5","category":"禮盒"},{"id":"dbprod20","code":"","name":"鳳+乳+草費3入","category":"禮盒"},{"id":"dbprod21","code":"","name":"鳳費+乳費4入","category":"禮盒"}],"recipes":[{"id":"rec1","productId":"dbprod6","materialId":"mat1","qty":1.0},{"id":"rec2","productId":"dbprod6","materialId":"mat2","qty":1.0},{"id":"rec3","productId":"dbprod7","materialId":"mat1","qty":1.0},{"id":"rec4","productId":"dbprod7","materialId":"mat2","qty":1.0},{"id":"rec5","productId":"dbprod8","materialId":"mat1","qty":1.0},{"id":"rec6","productId":"dbprod8","materialId":"mat2","qty":1.0},{"id":"rec7","productId":"dbprod9","materialId":"mat3","qty":1.0},{"id":"rec8","productId":"dbprod9","materialId":"mat4","qty":1.0},{"id":"rec9","productId":"dbprod10","materialId":"mat3","qty":1.0},{"id":"rec10","productId":"dbprod10","materialId":"mat4","qty":1.0},{"id":"rec11","productId":"dbprod11","materialId":"mat3","qty":1.0},{"id":"rec12","productId":"dbprod11","materialId":"mat4","qty":1.0},{"id":"rec13","productId":"dbprod12","materialId":"mat3","qty":1.0},{"id":"rec14","productId":"dbprod12","materialId":"mat4","qty":1.0},{"id":"rec15","productId":"dbprod13","materialId":"mat3","qty":1.0},{"id":"rec16","productId":"dbprod13","materialId":"mat4","qty":1.0},{"id":"rec17","productId":"dbprod14","materialId":"mat3","qty":1.0},{"id":"rec18","productId":"dbprod14","materialId":"mat4","qty":1.0},{"id":"rec19","productId":"dbprod15","materialId":"mat3","qty":1.0},{"id":"rec20","productId":"dbprod16","materialId":"mat3","qty":1.0},{"id":"rec21","productId":"dbprod16","materialId":"mat4","qty":1.0},{"id":"rec22","productId":"dbprod17","materialId":"mat5","qty":1.0},{"id":"rec23","productId":"dbprod17","materialId":"mat6","qty":1.0},{"id":"rec24","productId":"dbprod18","materialId":"mat5","qty":1.0},{"id":"rec25","productId":"dbprod18","materialId":"mat6","qty":1.0},{"id":"rec26","productId":"dbprod19","materialId":"mat5","qty":1.0},{"id":"rec27","productId":"dbprod19","materialId":"mat6","qty":1.0}],"campaigns":[],"stock":[],"components":[{"id":"comp1","productId":"dbprod6","componentProductId":"dbprod2","qty":5.0},{"id":"comp2","productId":"dbprod7","componentProductId":"dbprod3","qty":5.0},{"id":"comp3","productId":"dbprod8","componentProductId":"dbprod1","qty":5.0},{"id":"comp4","productId":"dbprod9","componentProductId":"dbprod2","qty":8.0},{"id":"comp5","productId":"dbprod10","componentProductId":"dbprod1","qty":4.0},{"id":"comp6","productId":"dbprod10","componentProductId":"dbprod3","qty":4.0},{"id":"comp7","productId":"dbprod11","componentProductId":"dbprod3","qty":8.0},{"id":"comp8","productId":"dbprod12","componentProductId":"dbprod2","qty":4.0},{"id":"comp9","productId":"dbprod12","componentProductId":"dbprod3","qty":4.0},{"id":"comp10","productId":"dbprod14","componentProductId":"dbprod2","qty":4.0},{"id":"comp11","productId":"dbprod14","componentProductId":"dbprod1","qty":4.0},{"id":"comp12","productId":"dbprod15","componentProductId":"dbprod2","qty":4.0},{"id":"comp13","productId":"dbprod15","componentProductId":"dbprod1","qty":4.0},{"id":"comp14","productId":"dbprod16","componentProductId":"dbprod1","qty":8.0},{"id":"comp15","productId":"dbprod17","componentProductId":"dbprod4","qty":10.0},{"id":"comp16","productId":"dbprod18","componentProductId":"dbprod5","qty":10.0},{"id":"comp17","productId":"dbprod19","componentProductId":"dbprod4","qty":5.0},{"id":"comp18","productId":"dbprod19","componentProductId":"dbprod5","qty":5.0},{"id":"comp19","productId":"dbprod20","componentProductId":"dbprod2","qty":1.0},{"id":"comp20","productId":"dbprod20","componentProductId":"dbprod1","qty":1.0},{"id":"comp21","productId":"dbprod20","componentProductId":"dbprod3","qty":1.0},{"id":"comp22","productId":"dbprod21","componentProductId":"dbprod2","qty":2.0},{"id":"comp23","productId":"dbprod21","componentProductId":"dbprod1","qty":2.0}],
 homeOrder:{material:[],single:[],gift:[]}
};
let editMaterial=null,editProduct=null;
const id=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const n=v=>Number(v)||0;

let currentGenericEdit=null;
function openGenericEdit(kind,recordId){
 currentGenericEdit={kind,recordId};
 let title='',fields=[];
 if(kind==='single'||kind==='gift'){
   let x=db.products.find(x=>x.id===recordId);if(!x)return;
   title=kind==='single'?'編輯單條資料':'編輯禮盒資料';
   fields=[
    ['code',kind==='single'?'單條編號':'禮盒編號','text',x.code||''],
    ['name',kind==='single'?'單條名稱':'禮盒名稱','text',x.name||'']
   ];
 }else if(kind==='formulaProduct'){
   let x=(db.components||[]).find(x=>x.id===recordId);if(!x)return;
   title='編輯單條內容物配方';
   fields=[['productId','禮盒','selectGift',x.productId],['componentProductId','單條內容物','selectSingle',x.componentProductId],['qty','每份用量','number',x.qty]];
 }else if(kind==='formulaMaterial'){
   let x=(db.recipes||[]).find(x=>x.id===recordId);if(!x)return;
   title='編輯包材配方';
   fields=[['productId','禮盒','selectGift',x.productId],['materialId','包材','selectMaterial',x.materialId],['qty','每份用量','number',x.qty]];
 }else if(kind==='campaign'){
   let x=db.campaigns.find(x=>x.id===recordId);if(!x)return;
   title='編輯檔期需求';
   fields=[['name','檔期名稱','text',x.name],['date','日期','date',x.date||''],['productId','禮盒','selectGift',x.productId],['qty','需求數量','number',x.qty]];
 }else if(kind==='stock'){
   let x=db.stock.find(x=>x.id===recordId);if(!x)return;
   title='編輯庫存異動';
   fields=[['date','日期','date',x.date||''],['materialId','包材','selectMaterial',x.materialId],['type','類型','selectStockType',x.type],['qty','數量','number',x.qty]];
 }else return;
 genericEditTitle.textContent=title;
 genericEditFields.innerHTML=fields.map(f=>editFieldHTML(...f)).join('');
 genericEditMask.classList.add('show');
}
function editFieldHTML(key,label,type,value){
 let control='';
 if(type==='selectGift'){
   control=`<select data-key="${key}">${db.products.filter(x=>x.category!=='單條').map(x=>`<option value="${x.id}" ${x.id===value?'selected':''}>${x.name}</option>`).join('')}</select>`;
 }else if(type==='selectSingle'){
   control=`<select data-key="${key}">${db.products.filter(x=>x.category==='單條').map(x=>`<option value="${x.id}" ${x.id===value?'selected':''}>${x.name}</option>`).join('')}</select>`;
 }else if(type==='selectMaterial'){
   control=`<select data-key="${key}">${db.materials.map(x=>`<option value="${x.id}" ${x.id===value?'selected':''}>${x.name}</option>`).join('')}</select>`;
 }else if(type==='selectStockType'){
   control=`<select data-key="${key}"><option value="in" ${value==='in'?'selected':''}>進貨</option><option value="out" ${value==='out'?'selected':''}>領用／出庫</option><option value="adjust" ${value==='adjust'?'selected':''}>盤點調整</option></select>`;
 }else control=`<input data-key="${key}" type="${type}" ${type==='number'?'step="0.01"':''} value="${String(value??'').replace(/"/g,'&quot;')}">`;
 return `<label>${label}${control}</label>`;
}
function closeGenericEdit(){genericEditMask.classList.remove('show');currentGenericEdit=null}
function saveGenericEdit(){
 if(!currentGenericEdit)return;
 let vals={};genericEditFields.querySelectorAll('[data-key]').forEach(el=>vals[el.dataset.key]=el.type==='number'?n(el.value):el.value.trim());
 let {kind,recordId}=currentGenericEdit;
 if((kind==='single'||kind==='gift')&&!vals.name)return alert('名稱不可空白');
 if(kind==='single'||kind==='gift'){
   let x=db.products.find(x=>x.id===recordId);Object.assign(x,{code:vals.code,name:vals.name,category:kind==='single'?'單條':'禮盒'});
 }else if(kind==='formulaProduct'){
   let x=db.components.find(x=>x.id===recordId);Object.assign(x,{productId:vals.productId,componentProductId:vals.componentProductId,qty:vals.qty});
 }else if(kind==='formulaMaterial'){
   let x=db.recipes.find(x=>x.id===recordId);Object.assign(x,{productId:vals.productId,materialId:vals.materialId,qty:vals.qty});
 }else if(kind==='campaign'){
   let x=db.campaigns.find(x=>x.id===recordId);Object.assign(x,{name:vals.name,date:vals.date,productId:vals.productId,qty:vals.qty});
 }else if(kind==='stock'){
   let x=db.stock.find(x=>x.id===recordId);Object.assign(x,{date:vals.date,materialId:vals.materialId,type:vals.type,qty:vals.qty});
 }
 closeGenericEdit();persist();
}


function applyGiftCodeMigration(){
 if(db.giftCodeMigrationOnce==='v1')return; // 只在第一次搬資料時執行，之後保留使用者修改的編號
 const codeMap={"鳳費5入": "CO-43", "鳳費8入": "CO-42", "草費+乳酪費8入": "CO-67", "乳酪費5入": "CO-80", "草費5入": "CO-83", "草費8入": "CO-84", "鳳費+草費8入": "CO-89", "柑費8入": "CO-73", "鳳費+乳酪費8入": "CO-99", "乳酪蛋捲10入": "CO-A2", "花生蛋捲10入": "CO-A3", "蛋捲乳5+花5": "CO-A4", "鳳+乳+草費3入": "CO-A5", "乳酪費8入": "CO-A6", "鳳費+乳費4入": "CO-A7"};
 let changed=false;
 db.products.forEach(p=>{
   if(p.category!=='單條' && codeMap[p.name] && p.code!==codeMap[p.name]){
     p.code=codeMap[p.name]; changed=true;
   }
 });
 db.giftCodeMigrationOnce='v1';
 try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){}
}


function ensureInitialStock(){
 if(!Array.isArray(db.initialStock))db.initialStock=[];
 // 舊版 qty 自動轉為 total；保留相容性
 db.initialStock.forEach(x=>{
   if(x.total==null && x.qty!=null)x.total=Number(x.qty)||0;
   if(x.unfolded==null)x.unfolded=0;
   if(x.folded==null)x.folded=0;
 });
}
function initialRecord(itemId){
 ensureInitialStock();
 return db.initialStock.find(x=>String(x.itemType||'material')==='material'&&String(x.itemId)===String(itemId));
}
function initialQty(itemType,itemId){
 if(itemType!=='material')return 0;
 const x=initialRecord(itemId);
 return x?Number(x.total!=null?x.total:x.qty)||0:0;
}
function movementQty(itemType,itemId){
 return (db.stock||[]).reduce((sum,x)=>{
   const xt=x.itemType||'material', xid=x.itemId||x.materialId;
   if(xt!==itemType||String(xid)!==String(itemId))return sum;
   const q=Number(x.qty)||0;
   return sum+(x.type==='out'?-q:q);
 },0);
}
function currentItemStock(itemType,itemId){
 return initialQty(itemType,itemId)+movementQty(itemType,itemId);
}
function renderInitialStock(){
 ensureInitialStock();
 const body=document.getElementById('initialStockBody');
 if(!body)return;
 const mats=Array.isArray(db.materials)?db.materials:[];
 body.innerHTML=mats.length?mats.map(m=>{
   const x=initialRecord(m.id)||{};
   const unfolded=Number(x.unfolded)||0, folded=Number(x.folded)||0;
   return `<tr><td class="initial-name">${m.name||''}</td>
    <td class="initial-total" data-total-id="${m.id}">${unfolded+folded}</td>
    <td><input class="initial-num" type="number" min="0" step="1" data-id="${m.id}" data-field="unfolded" value="${unfolded}" oninput="updateInitialTotal('${m.id}')" disabled></td>
    <td><input class="initial-num" type="number" min="0" step="1" data-id="${m.id}" data-field="folded" value="${folded}" oninput="updateInitialTotal('${m.id}')" disabled></td></tr>`;
 }).join(''):'<tr><td colspan="4" class="empty">尚無包材資料，請先至「包材資料」新增品項</td></tr>';
 initialStockEditing=false;
 const eb=document.getElementById('initialEditBtn'),sb=document.getElementById('initialSaveBtn'),st=document.getElementById('initialLockStatus');
 if(eb)eb.style.display=mats.length?'inline-flex':'none';
 if(sb)sb.style.display='none';
 if(st)st.textContent=mats.length?'🔒 數字已鎖定':'';
}
let initialStockEditing=false;
function setInitialStockEdit(editing){
 const body=document.getElementById('initialStockBody');
 if(!body)return;
 if(!body.querySelector('.initial-num'))renderInitialStock();
 initialStockEditing=!!editing;
 document.querySelectorAll('#initialStockBody .initial-num').forEach(inp=>inp.disabled=!initialStockEditing);
 const eb=document.getElementById('initialEditBtn'),sb=document.getElementById('initialSaveBtn'),st=document.getElementById('initialLockStatus');
 if(eb)eb.style.display=initialStockEditing?'none':'inline-flex';
 if(sb)sb.style.display=initialStockEditing?'inline-flex':'none';
 if(st)st.textContent=initialStockEditing?'✏️ 編輯中':'🔒 數字已鎖定';
}
function updateInitialTotal(itemId){
 const inputs=[...document.querySelectorAll(`#initialStockBody .initial-num[data-id="${itemId}"]`)];
 let unfolded=0,folded=0;
 inputs.forEach(inp=>{
   if(inp.dataset.field==='unfolded')unfolded=Math.max(0,Number(inp.value)||0);
   if(inp.dataset.field==='folded')folded=Math.max(0,Number(inp.value)||0);
 });
 const cell=document.querySelector(`#initialStockBody [data-total-id="${itemId}"]`);
 if(cell)cell.textContent=unfolded+folded;
}
function saveAllInitialStock(){
 const inputs=[...document.querySelectorAll('#initialStockBody .initial-num')];
 if(!inputs.length){renderInitialStock();return;}
 const grouped={};
 inputs.forEach(inp=>{const id=String(inp.dataset.id),f=inp.dataset.field;if(!grouped[id])grouped[id]={itemType:'material',itemId:id,total:0,unfolded:0,folded:0,qty:0};grouped[id][f]=Math.max(0,Number(inp.value)||0);});
 Object.values(grouped).forEach(x=>{x.total=(Number(x.unfolded)||0)+(Number(x.folded)||0);x.qty=x.total;});
 db.initialStock=Object.values(grouped);
 try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){console.error(e);}
 renderInitialStock();
 try{renderDashboard();}catch(e){}
 const st=document.getElementById('initialLockStatus');if(st)st.textContent='✓ 已儲存並鎖定';
}

function load(){
 ensureInitialStock();
 try{
   let saved=JSON.parse(localStorage.getItem(KEY));
   if(saved&&!saved.components)saved.components=db.components||[];
   if(saved&&((saved.products||[]).length||(saved.materials||[]).length||(saved.campaigns||[]).length||(saved.stock||[]).length)){
     db=saved;
   }else{
     localStorage.setItem(KEY,JSON.stringify(db));
   }
 }catch(e){}
 ensureHomeOrder();
 applyGiftCodeMigration();
 render();
}
function persist(){localStorage.setItem(KEY,JSON.stringify(db));render()}
function del(arr,i){if(confirm('確定刪除這筆資料嗎？')){db[arr]=db[arr].filter(x=>x.id!==i);if(arr==='materials')db.recipes=db.recipes.filter(x=>x.materialId!==i);if(arr==='products'){db.recipes=db.recipes.filter(x=>x.productId!==i);db.campaigns=db.campaigns.filter(x=>x.productId!==i);db.components=(db.components||[]).filter(x=>x.productId!==i&&x.componentProductId!==i)}persist()}}

function saveMaterial(){let code=mCode.value.trim(),name=mName.value.trim();if(!name)return alert('請輸入包材名稱');if(editMaterial){let x=db.materials.find(x=>x.id===editMaterial);Object.assign(x,{code,name,category:mCategory.value,unit:mUnit.value.trim(),safety:n(mSafety.value)})}else db.materials.push({id:id(),code,name,category:mCategory.value,unit:mUnit.value.trim(),safety:n(mSafety.value)});clearMaterialForm();persist()}
function clearMaterialForm(){editMaterial=null;mCode.value=mName.value=mUnit.value='';mCategory.value='單條';mSafety.value=0}
function editMat(i){
 let x=db.materials.find(x=>x.id===i);if(!x)return;
 editMaterial=i;
 emCode.value=x.code||'';emName.value=x.name||'';emCategory.value=x.category||'單條';emUnit.value=x.unit||'';emSafety.value=x.safety||0;
 materialEditMask.classList.add('show');
}
function closeMaterialModal(){materialEditMask.classList.remove('show');editMaterial=null}
function saveMaterialModal(){
 if(!editMaterial)return;
 let x=db.materials.find(x=>x.id===editMaterial);if(!x)return;
 let name=emName.value.trim();if(!name)return alert('請輸入包材名稱');
 Object.assign(x,{code:emCode.value.trim(),name,category:emCategory.value,unit:emUnit.value.trim(),safety:n(emSafety.value)});
 materialEditMask.classList.remove('show');editMaterial=null;persist();
}

let editSingle=null;
function saveSingle(){
 let code=sgCode.value.trim(),name=sgName.value.trim();
 if(!name)return alert('請輸入單條名稱');
 if(editSingle){
   let x=db.products.find(x=>x.id===editSingle);
   if(x)Object.assign(x,{code,name,category:'單條'});
 }else db.products.push({id:id(),code,name,category:'單條'});
 clearSingleForm();persist();
}
function clearSingleForm(){editSingle=null;sgCode.value='';sgName.value=''}
function editSingleItem(i){openGenericEdit('single',i)}
function deleteSingleItem(i){
 if(!confirm('確定刪除這筆單條資料嗎？相關禮盒內容物配方也會一併刪除。'))return;
 db.products=db.products.filter(x=>x.id!==i);
 db.components=(db.components||[]).filter(x=>x.productId!==i&&x.componentProductId!==i);
 db.campaigns=db.campaigns.filter(x=>x.productId!==i);
 db.recipes=db.recipes.filter(x=>x.productId!==i);
 persist();
}



function togglePanel(panelId,btn){
 const panel=document.getElementById(panelId);if(!panel)return;
 panel.classList.toggle('collapsed');
 const closed=panel.classList.contains('collapsed');
 if(btn)btn.textContent=closed?'展開':'收合';
}
function expandPanel(panelId){
 const panel=document.getElementById(panelId);if(!panel)return;
 panel.classList.remove('collapsed');
 const btn=panel.querySelector('.collapse-btn');if(btn)btn.textContent='收合';
}

let editGiftWithFormula=null;

function updateGiftFormulaItem(row,selected){
 const t=document.getElementById('gfType'+row), el=document.getElementById('gfItem'+row);
 if(!t||!el)return;
 const data=t.value==='material'?db.materials:db.products.filter(x=>x.category==='單條');
 const keep=selected!==undefined?selected:el.value;
 el.innerHTML='<option value="">請選擇</option>'+data.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
 if(keep&&[...el.options].some(o=>o.value===keep))el.value=keep;
}
let giftVisibleFormulaRows=1;
function setGiftFormulaRowCount(count){
 giftVisibleFormulaRows=Math.max(1,Math.min(8,Number(count)||1));
 for(let i=1;i<=8;i++){
  const row=document.querySelector('[data-gift-formula-row="'+i+'"]');
  if(row)row.style.display=i<=giftVisibleFormulaRows?'':'none';
 }
 const add=document.getElementById('giftAddFormulaBtn');
 if(add)add.disabled=giftVisibleFormulaRows>=8;
 const countLabel=document.getElementById('giftFormulaCount');
 if(countLabel)countLabel.textContent='目前 '+giftVisibleFormulaRows+' 項（最多 8 項）';
}
function addGiftFormulaRow(){
 if(giftVisibleFormulaRows>=8)return;
 setGiftFormulaRowCount(giftVisibleFormulaRows+1);
 updateGiftFormulaItem(giftVisibleFormulaRows);
}
function initGiftFormulaRows(){
 for(let i=1;i<=8;i++)updateGiftFormulaItem(i);
 setGiftFormulaRowCount(giftVisibleFormulaRows);
}
function clearGiftWithFormula(){
 editGiftWithFormula=null;
 setGiftFormulaRowCount(1);
 pCode.value='';pName.value='';document.getElementById('pPrice').value=''; document.getElementById('giftCurrentListed').checked=false;
 for(let i=1;i<=8;i++){
   document.getElementById('gfType'+i).value='product';
   updateGiftFormulaItem(i,'');
   document.getElementById('gfQty'+i).value='';
 }
}
function collectGiftFormula(){
 const rows=[];
 for(let i=1;i<=8;i++){
   const type=document.getElementById('gfType'+i).value;
   const item=document.getElementById('gfItem'+i).value;
   const raw=document.getElementById('gfQty'+i).value;
   const qty=Number(raw);
   if(!item && raw!=='')throw new Error(`第 ${i} 組尚未選擇品項`);
   if(item && (!Number.isFinite(qty)||qty<=0))throw new Error(`第 ${i} 組請輸入大於 0 的數量`);
   if(item&&qty>0)rows.push({type,item,qty});
 }
 return rows;
}
function saveGiftWithFormula(){
 const code=pCode.value.trim(),name=pName.value.trim();
 if(!name)return alert('請輸入禮盒名稱');
 let rows;
 try{rows=collectGiftFormula()}catch(e){return alert(e.message)}
 if(!rows.length && !editGiftWithFormula)return alert('請至少建立一組禮盒配方');
 const priceRaw=document.getElementById('pPrice').value;
 const price=priceRaw===''?null:Number(priceRaw);
 if(price!==null && (!Number.isFinite(price)||price<0))return alert('售價請輸入有效的非負數');
 const isListedCurrent=document.getElementById('giftCurrentListed').checked;

 let pid=editGiftWithFormula;
 if(pid){
   const p=db.products.find(x=>x.id===pid);
   if(!p)return alert('找不到此禮盒資料');
   Object.assign(p,{code,name,category:'禮盒',price,isListedCurrent});
 }else{
   pid=id();
   db.products.push({id:pid,code,name,category:'禮盒',price,isListedCurrent});
 }
 db.components=(db.components||[]).filter(x=>x.productId!==pid);
 db.recipes=(db.recipes||[]).filter(x=>x.productId!==pid);
 rows.forEach(v=>{
   if(v.type==='material')db.recipes.push({id:id(),productId:pid,materialId:v.item,qty:v.qty});
   else db.components.push({id:id(),productId:pid,componentProductId:v.item,qty:v.qty});
 });
 localStorage.setItem(KEY,JSON.stringify(db));
 clearGiftWithFormula();
 render();
 alert(`「${name}」禮盒與配方已儲存，共 ${rows.length} 項配方`);
}
function editGiftFull(pid){
 expandPanel('giftEditorPanel');
 const p=db.products.find(x=>x.id===pid);if(!p)return;
 editGiftWithFormula=pid;
 pCode.value=p.code||'';pName.value=p.name||'';document.getElementById('pPrice').value=p.price??'';document.getElementById('giftCurrentListed').checked=(p.isListedCurrent===true);
 for(let i=1;i<=8;i++){
   document.getElementById('gfType'+i).value='product';
   updateGiftFormulaItem(i,'');
   document.getElementById('gfQty'+i).value='';
 }
 const rows=[
   ...(db.components||[]).filter(x=>x.productId===pid).map(x=>({type:'product',item:x.componentProductId,qty:x.qty})),
   ...(db.recipes||[]).filter(x=>x.productId===pid).map(x=>({type:'material',item:x.materialId,qty:x.qty}))
 ].slice(0,8);
 setGiftFormulaRowCount(Math.max(1,rows.length));
 rows.forEach((v,k)=>{
   const i=k+1;
   document.getElementById('gfType'+i).value=v.type;
   updateGiftFormulaItem(i,v.item);
   document.getElementById('gfQty'+i).value=v.qty;
 });
 pCode.scrollIntoView({behavior:'smooth',block:'center'});
}
function deleteGiftFull(pid){
 const p=db.products.find(x=>x.id===pid);
 if(!confirm(`確定刪除「${p?p.name:'此禮盒'}」及其全部配方嗎？`))return;
 db.products=db.products.filter(x=>x.id!==pid);
 db.components=(db.components||[]).filter(x=>x.productId!==pid);
 db.recipes=(db.recipes||[]).filter(x=>x.productId!==pid);
 db.campaigns=db.campaigns.filter(x=>x.productId!==pid);
 localStorage.setItem(KEY,JSON.stringify(db));
 render();
}

function saveProduct(){
 let code=pCode.value.trim(),name=pName.value.trim();
 if(!name)return alert('請輸入禮盒名稱');
 if(editProduct){
   let x=db.products.find(x=>x.id===editProduct);
   Object.assign(x,{code,name,category:'禮盒'});
 }else db.products.push({id:id(),code,name,category:'禮盒'});
 clearProductForm();persist()
}
function clearProductForm(){editProduct=null;pCode.value=pName.value='';pCategory.value='單條'}
function editProd(i){openGenericEdit('gift',i)}
function saveRecipe(){if(!rProduct.value||!rMaterial.value)return alert('請先建立產品及包材');let old=db.recipes.find(x=>x.productId===rProduct.value&&x.materialId===rMaterial.value);if(old)old.qty=n(rQty.value);else db.recipes.push({id:id(),productId:rProduct.value,materialId:rMaterial.value,qty:n(rQty.value)});persist()}

function saveComponent(){
 if(!cpParent.value||!cpChild.value)return alert('請選擇產品與內容物');
 if(cpParent.value===cpChild.value)return alert('產品與內容物不可相同');
 db.components=db.components||[];
 let old=db.components.find(x=>x.productId===cpParent.value&&x.componentProductId===cpChild.value);
 if(old)old.qty=n(cpQty.value);else db.components.push({id:id(),productId:cpParent.value,componentProductId:cpChild.value,qty:n(cpQty.value)});
 persist()
}
function componentDemand(pid){
 let total=0;
 (db.campaigns||[]).forEach(c=>{
   if(c.productId===pid) total+=c.qty;
   (db.components||[]).filter(x=>x.productId===c.productId&&x.componentProductId===pid).forEach(x=>total+=c.qty*x.qty);
 });
 return total;
}




function updateUnifiedItemOptions(row, selectedValue){
 const typeEl=document.getElementById('ufType'+row);
 const itemEl=document.getElementById('ufItem'+row);
 if(!typeEl||!itemEl)return;
 const data=typeEl.value==='material'
   ? db.materials
   : db.products.filter(x=>x.category==='單條');
 const keep=selectedValue!==undefined ? selectedValue : itemEl.value;
 itemEl.innerHTML='<option value="">請選擇</option>'+
   data.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
 if(keep && [...itemEl.options].some(o=>o.value===keep)) itemEl.value=keep;
}
function clearFormulaRows(){
 for(let i=1;i<=6;i++){
   const t=document.getElementById('ufType'+i);
   const q=document.getElementById('ufQty'+i);
   if(t)t.value='product';
   updateUnifiedItemOptions(i,'');
   if(q)q.value='';
 }
}
function loadFormulaEditor(){
 if(!document.getElementById('ufProduct'))return;
 clearFormulaRows();
 const pid=ufProduct.value;
 if(!pid)return;
 const existing=[
   ...(db.components||[]).filter(x=>x.productId===pid).map(x=>({type:'product',item:x.componentProductId,qty:x.qty})),
   ...(db.recipes||[]).filter(x=>x.productId===pid).map(x=>({type:'material',item:x.materialId,qty:x.qty}))
 ].slice(0,6);
 existing.forEach((v,idx)=>{
   const row=idx+1;
   document.getElementById('ufType'+row).value=v.type;
   updateUnifiedItemOptions(row,v.item);
   document.getElementById('ufQty'+row).value=v.qty;
 });
}

function saveUnifiedFormula(){
 const pid=ufProduct && ufProduct.value;
 if(!pid)return alert('請先選擇禮盒');

 const entries=[];
 for(let i=1;i<=6;i++){
   const typeEl=document.getElementById('ufType'+i);
   const itemEl=document.getElementById('ufItem'+i);
   const qtyEl=document.getElementById('ufQty'+i);
   if(!typeEl||!itemEl||!qtyEl)continue;
   const item=itemEl.value;
   const qty=Number(qtyEl.value);
   if(!item && qty>0)return alert(`第 ${i} 組尚未選擇品項`);
   if(item && (!Number.isFinite(qty)||qty<=0))return alert(`第 ${i} 組請輸入大於 0 的數量`);
   if(item&&qty>0)entries.push({type:typeEl.value,item,qty});
 }
 if(!entries.length)return alert('請至少填寫一組配方');

 db.components=(db.components||[]).filter(x=>x.productId!==pid);
 db.recipes=(db.recipes||[]).filter(x=>x.productId!==pid);

 entries.forEach(v=>{
   if(v.type==='material')
     db.recipes.push({id:id(),productId:pid,materialId:v.item,qty:v.qty});
   else
     db.components.push({id:id(),productId:pid,componentProductId:v.item,qty:v.qty});
 });

 localStorage.setItem(KEY,JSON.stringify(db));

 // Render lower list first; it now displays all saved gift formulas.
 try{render();}catch(err){console.error(err);}

 // Restore the edited gift after render rebuilt select options.
 if(window.ufProduct && [...ufProduct.options].some(o=>o.value===pid))ufProduct.value=pid;
 loadFormulaEditor();

 alert(`「${prodName(pid)}」配方已儲存，共 ${entries.length} 項`);
}

function selectGiftFormula(pid){
 if(!window.ufProduct)return;
 if([...ufProduct.options].some(o=>o.value===pid)){
   ufProduct.value=pid;
   loadFormulaEditor();
   ufProduct.scrollIntoView({behavior:'smooth',block:'start'});
 }
}

function deleteUnifiedFormula(type,fid){
 if(!confirm('確定刪除這筆配方嗎？'))return;
 if(type==='material')db.recipes=db.recipes.filter(x=>x.id!==fid);
 else db.components=(db.components||[]).filter(x=>x.id!==fid);
 localStorage.setItem(KEY,JSON.stringify(db));
 try{render();}catch(err){console.error(err);}
 loadFormulaEditor();
}

function saveCampaign(){if(!cName.value.trim()||!cProduct.value)return alert('請輸入檔期名稱並選擇產品');db.campaigns.push({id:id(),name:cName.value.trim(),date:cDate.value,productId:cProduct.value,qty:n(cQty.value)});persist()}

function updateStockItemOptions(selected){
 const type=document.getElementById('sItemType')?.value||'material';
 const el=document.getElementById('sMaterial');if(!el)return;
 const data=type==='single'?db.products.filter(x=>x.category==='單條'):db.materials;
 const keep=selected!==undefined?selected:el.value;
 el.innerHTML='<option value="">請選擇</option>'+data.map(x=>`<option value="${x.id}">${x.code?x.code+'｜':''}${x.name}</option>`).join('');
 if(keep&&[...el.options].some(o=>o.value===keep))el.value=keep;
}
function stockItemName(x){
 if((x.itemType||'material')==='single'){
   const p=db.products.find(v=>v.id===(x.itemId||x.materialId));
   return p?p.name:'';
 }
 return matName(x.itemId||x.materialId);
}

function saveStock(){
 const date=sDate.value||new Date().toISOString().slice(0,10);
 const itemType=sItemType.value;
 const itemId=sMaterial.value;
 const type=sType.value;
 const qty=Number(sQty.value);
 if(!itemId)return alert('請選擇品項');
 if(!Number.isFinite(qty)||qty<=0)return alert('請輸入正確數量');
 db.stock.push({id:id(),date,itemType,itemId,materialId:itemType==='material'?itemId:'',type,qty});
 persist();
 sQty.value='';
 render();
}
function matName(i){return db.materials.find(x=>x.id===i)?.name||'已刪除'}
function prodName(i){return db.products.find(x=>x.id===i)?.name||'已刪除'}
function stockOf(mid){return currentItemStock('material',mid)}
function demandOf(mid){let total=0;db.campaigns.forEach(c=>{db.recipes.filter(r=>r.productId===c.productId&&r.materialId===mid).forEach(r=>total+=c.qty*r.qty)});return total}
function opts(sel,data,label){let v=sel.value;sel.innerHTML='<option value="">請選擇</option>'+data.map(x=>`<option value="${x.id}">${x[label]}</option>`).join('');sel.value=v}

function goPage(page){
 const btn=document.querySelector(`.navbtn[data-page="${page}"]`);
 if(btn)btn.click();
}
function dashboardMaterialDemand(mid){
 return (db.campaigns||[]).reduce((sum,c)=>{
   const qty=Number(c.qty)||0;
   const direct=(db.recipes||[]).filter(r=>r.productId===c.productId&&r.materialId===mid)
     .reduce((s,r)=>s+(Number(r.qty)||0),0);
   return sum+direct*qty;
 },0);
}

function switchHomeTable(tab,btn){
 try{renderDashboard();}catch(e){console.warn('首頁刷新異常',e);}
 document.querySelectorAll('.home-table-panel').forEach(p=>p.classList.toggle('active',p.dataset.homePanel===tab));
 document.querySelectorAll('.home-switch-btn').forEach(b=>b.classList.toggle('active',b.dataset.homeTab===tab));

 if(tab==='salesForecast')renderSalesForecast();
}

function ensureHomeOrder(){
 if(!db.homeOrder||typeof db.homeOrder!=='object'){
   db.homeOrder={material:[],single:[],gift:[]};
 }
 ['material','single','gift'].forEach(k=>{
   if(!Array.isArray(db.homeOrder[k])) db.homeOrder[k]=[];
 });
}
function orderedHomeItems(type,items){
 ensureHomeOrder();
 const ids=items.map(x=>String(x.id));
 let order=db.homeOrder[type].map(String).filter(id=>ids.includes(id));
 ids.forEach(id=>{if(!order.includes(id))order.push(id);});
 db.homeOrder[type]=order;
 const map=new Map(items.map(x=>[String(x.id),x]));
 return order.map(id=>map.get(id)).filter(Boolean);
}
function dragHandle(type,id){
 return `<span class="drag-handle" data-drag-type="${type}" data-drag-id="${id}" title="按住拖曳調整順序">☰</span>`;
}
let homeDragState=null;

function saveHomeOrder(type, ids){
 ensureHomeOrder();
 db.homeOrder[type]=ids.map(String);

 // 直接寫入本系統原本使用的主資料 localStorage KEY
 try{
   localStorage.setItem(KEY,JSON.stringify(db));

   // 寫入後立即讀回驗證；若成功，保持讀回的排序
   const check=JSON.parse(localStorage.getItem(KEY)||'null');
   if(check && check.homeOrder && Array.isArray(check.homeOrder[type])){
     db.homeOrder[type]=check.homeOrder[type].map(String);
   }
   showHomeOrderSaved();
 }catch(e){
   console.error('首頁排序儲存失敗：',e);
 }
}

function bindHomeDrag(){
 const bodies=[
   {el:document.getElementById('homeMaterialBody'),type:'material'},
   {el:document.getElementById('homeSingleBody'),type:'single'},
   {el:document.getElementById('homeGiftBody'),type:'gift'}
 ];
 bodies.forEach(({el,type})=>{
   if(!el)return;
   const rows=[...el.querySelectorAll('tr')].filter(r=>r.querySelector('.drag-handle'));
   rows.forEach(row=>{
     const h=row.querySelector('.drag-handle');
     row.dataset.itemId=String(h.dataset.dragId);
     row.dataset.itemType=type;
     row.draggable=false;

     h.addEventListener('mousedown',()=>{
       row.draggable=true;
     });
     h.addEventListener('mouseup',()=>{
       if(!homeDragState)row.draggable=false;
     });

     row.addEventListener('dragstart',e=>{
       if(!row.draggable){e.preventDefault();return;}
       homeDragState={type,id:String(row.dataset.itemId),row};
       row.classList.add('dragging-row');
       if(e.dataTransfer){
         e.dataTransfer.effectAllowed='move';
         e.dataTransfer.setData('text/plain',String(row.dataset.itemId));
       }
     });

     row.addEventListener('dragover',e=>{
       if(!homeDragState||homeDragState.type!==type||homeDragState.row===row)return;
       e.preventDefault();
       if(e.dataTransfer)e.dataTransfer.dropEffect='move';
       const rect=row.getBoundingClientRect();
       const before=e.clientY < rect.top + rect.height/2;
       row.classList.toggle('drop-before',before);
       row.classList.toggle('drop-after',!before);
     });

     row.addEventListener('dragleave',()=>{
       row.classList.remove('drop-before','drop-after');
     });

     row.addEventListener('drop',e=>{
       if(!homeDragState||homeDragState.type!==type||homeDragState.row===row)return;
       e.preventDefault();
       const rect=row.getBoundingClientRect();
       const before=e.clientY < rect.top + rect.height/2;
       const dragged=homeDragState.row;
       if(before) el.insertBefore(dragged,row);
       else el.insertBefore(dragged,row.nextSibling);

       const ids=[...el.querySelectorAll('tr')]
         .map(r=>r.dataset.itemId)
         .filter(Boolean);
       saveHomeOrder(type,ids);
       cleanupHomeDrag();
       renderDashboard();
     });

     row.addEventListener('dragend',()=>{
       if(homeDragState&&homeDragState.type===type){
         // Even when the browser fires dragend without drop, preserve current DOM order.
         const ids=[...el.querySelectorAll('tr')].map(r=>r.dataset.itemId).filter(Boolean);
         saveHomeOrder(type,ids);
       }
       cleanupHomeDrag();
       row.draggable=false;
     });
   });
 });
}

function cleanupHomeDrag(){
 document.querySelectorAll('.dragging-row,.drop-before,.drop-after').forEach(x=>{
   x.classList.remove('dragging-row','drop-before','drop-after');
   x.draggable=false;
 });
 homeDragState=null;
}

function showHomeOrderSaved(){
 let el=document.getElementById('homeOrderSaved');
 if(!el){
   const sw=document.querySelector('.home-switch');
   if(!sw)return;
   el=document.createElement('span');
   el.id='homeOrderSaved';
   el.className='home-order-saved';
   sw.appendChild(el);
 }
 el.textContent='✓ 排序已儲存';
 clearTimeout(window.__homeOrderSavedTimer);
 window.__homeOrderSavedTimer=setTimeout(()=>{if(el)el.textContent='';},1500);
}

function localDateKey(d=new Date()){
 const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
 return `${y}-${m}-${day}`;
}
function ensureFoldingRecords(){
 if(!Array.isArray(db.foldingRecords))db.foldingRecords=[];
 if(!Array.isArray(db.foldingArchive))db.foldingArchive=[];
}
function saveMainDb(){
 try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){console.error('資料儲存失敗',e);}
}
function makeDailyFoldingRows(date){
 return (db.materials||[]).map(m=>({
   id:`FD_${date}_${m.id}`,date,materialId:String(m.id),
   category:m.category||'',incoming:0,usage:0,folded:0,ng:0,otherNg:0
 }));
}
function syncTodayFoldingRows(){
 if(window.CMSStock)return; // 2026-10-14 起首頁折盒統計已取消（改用快速輸入），不再每天建立折盒列
 ensureFoldingRecords();
 const today=localDateKey();

 // 將所有非今日的工作列移入封存區，只封存一次
 const old=db.foldingRecords.filter(r=>r.date!==today);
 if(old.length){
   const existing=new Set(db.foldingArchive.map(r=>String(r.id)));
   old.forEach(r=>{if(!existing.has(String(r.id)))db.foldingArchive.push({...r,archived:true});});
   db.foldingRecords=db.foldingRecords.filter(r=>r.date===today);
 }

 // 今天每個包材一定有一列；新增包材也會自動補入
 const todayIds=new Set(db.foldingRecords.filter(r=>r.date===today).map(r=>String(r.materialId)));
 (db.materials||[]).forEach(m=>{
   if(!todayIds.has(String(m.id))){
     db.foldingRecords.push({
       id:`FD_${today}_${m.id}`,date:today,materialId:String(m.id),
       category:m.category||'',incoming:0,usage:0,folded:0,ng:0,otherNg:0
     });
   }
 });
 saveMainDb();
}
let foldPendingSaveTimer=null;
let foldSaveCountdownTimer=null;
let foldSaveSeconds=0;

function updateDailyFolding(id,field,value){
 ensureFoldingRecords();

 const r=db.foldingRecords.find(x=>String(x.id)===String(id));
 if(!r)return;

 r[field]=Math.max(0,Number(value)||0);

 const tr=document.querySelectorAll('[data-fold-row]');
 for(const row of tr){
   if(String(row.getAttribute('data-fold-row'))===String(id)){
     const net=(Number(r.incoming)||0)-(Number(r.usage)||0)-(Number(r.ng)||0)-(Number(r.otherNg)||0);
     const netCell=row.querySelector('.fold-net');
     if(netCell)netCell.textContent=net;
     break;
   }
 }

 // 關鍵：每次輸入立即依該包材 materialId 重算首頁庫存
 refreshMaterialInventoryCells(r.materialId);

 // localStorage 仍維持停止輸入 5 秒後才儲存
 scheduleFoldingSave();
}

function scheduleFoldingSave(){
 clearTimeout(foldPendingSaveTimer);
 clearInterval(foldSaveCountdownTimer);

 foldSaveSeconds=5;
 updateFoldSaveNote();

 foldSaveCountdownTimer=setInterval(()=>{
   foldSaveSeconds--;
   updateFoldSaveNote();
   if(foldSaveSeconds<=0)clearInterval(foldSaveCountdownTimer);
 },1000);

 foldPendingSaveTimer=setTimeout(()=>{
   clearInterval(foldSaveCountdownTimer);
   saveMainDb();

   // 真正儲存後才同步重算首頁包材庫存
   try{refreshMaterialInventoryCells();}catch(e){console.error(e);}

   const note=document.getElementById('foldSaveNote');
   if(note)note.textContent='✓ 已儲存';
   setTimeout(()=>{
     const n=document.getElementById('foldSaveNote');
     if(n)n.textContent='修改後自動儲存';
   },1500);
 },5000);
}

function updateFoldSaveNote(){
 const note=document.getElementById('foldSaveNote');
 if(note)note.textContent='修改後自動儲存';
}
function renderFoldingRecords(){
 if(window.CMSStock)return; // 折盒統計已取消
 syncTodayFoldingRows();
 const today=localDateKey();
 const label=document.getElementById('foldTodayLabel');
 if(label)label.textContent=today;
 const body=document.getElementById('homeFoldingBody');
 if(!body)return;

 const order=(db.materials||[]).map(m=>String(m.id));
 const rows=db.foldingRecords.filter(r=>r.date===today).sort((a,b)=>order.indexOf(String(a.materialId))-order.indexOf(String(b.materialId)));
 body.innerHTML=rows.length?rows.map(r=>{
   const m=(db.materials||[]).find(x=>String(x.id)===String(r.materialId));
   const net=(Number(r.incoming)||0)-(Number(r.usage)||0)-(Number(r.ng)||0)-(Number(r.otherNg)||0);
   const inp=(field,val,cls='')=>`<input class="fold-num ${cls}" type="number" min="0" step="1" value="${Number(val)||0}" oninput="updateDailyFolding('${r.id}','${field}',this.value)">`;
   return `<tr data-fold-row="${r.id}">
    <td>${today}</td><td>${r.category||((m&&m.category)||'')}</td><td class="name-cell">${(m&&m.name)||''}</td>
    <td class="fold-in-cell">${inp('incoming',r.incoming)}</td>
    <td class="fold-use-cell">${inp('usage',r.usage)}</td>
    <td class="fold-folded-cell">${inp('folded',r.folded)}</td>
    <td class="fold-ng-cell">${inp('ng',r.ng)}</td>
    <td class="fold-other-cell">${inp('otherNg',r.otherNg)}</td>
    <td class="fold-net">${net}</td>
   </tr>`;
 }).join(''):'<tr><td colspan="9" class="empty">尚無包材資料</td></tr>';
 renderFoldingHistory();
}
function renderFoldingHistory(){
 ensureFoldingRecords();
 const sel=document.getElementById('foldHistoryDate');
 const body=document.getElementById('foldHistoryBody');
 if(!sel||!body)return;
 const dates=[...new Set(db.foldingArchive.map(r=>r.date).filter(Boolean))].sort().reverse();
 const current=sel.value;
 sel.innerHTML=dates.length?dates.map(d=>`<option value="${d}">${d}</option>`).join(''):'<option value="">尚無封存</option>';
 if(current&&dates.includes(current))sel.value=current;
 const date=sel.value;
 const order=(db.materials||[]).map(m=>String(m.id));
 const rows=db.foldingArchive.filter(r=>r.date===date).sort((a,b)=>order.indexOf(String(a.materialId))-order.indexOf(String(b.materialId)));
 body.innerHTML=rows.length?rows.map(r=>{
   const m=(db.materials||[]).find(x=>String(x.id)===String(r.materialId));
   const net=(Number(r.incoming)||0)-(Number(r.usage)||0)-(Number(r.ng)||0)-(Number(r.otherNg)||0);
   return `<tr>
    <td>${r.date||''}</td><td>${r.category||((m&&m.category)||'')}</td><td class="name-cell">${(m&&m.name)||''}</td>
    <td>${Number(r.incoming)||0}</td><td>${Number(r.usage)||0}</td><td>${Number(r.folded)||0}</td>
    <td>${Number(r.ng)||0}</td><td>${Number(r.otherNg)||0}</td><td>${net}</td>
   </tr>`;
 }).join(''):'<tr><td colspan="9" class="empty">尚無歷史封存紀錄</td></tr>';
}
function scheduleFoldingMidnight(){
 if(window.__foldMidnightTimer)clearTimeout(window.__foldMidnightTimer);
 const now=new Date(),next=new Date(now);
 next.setHours(24,0,1,0);
 window.__foldMidnightTimer=setTimeout(()=>{
   syncTodayFoldingRows();
   renderFoldingRecords();
   scheduleFoldingMidnight();
 },Math.max(1000,next-now));
}

function foldingTotalsForMaterial(materialId){
 const all=[
   ...(Array.isArray(db.foldingArchive)?db.foldingArchive:[]),
   ...(Array.isArray(db.foldingRecords)?db.foldingRecords:[])
 ];
 return all
   .filter(r=>String(r.materialId||r.itemId||'')===String(materialId))
   .reduce((a,r)=>{
     a.incoming += Number(r.incoming)||0;
     a.usage += Number(r.usage)||0;
     a.folded += Number(r.folded)||0;
     a.ng += Number(r.ng)||0;
     a.otherNg += Number(r.otherNg)||0;
     return a;
   },{incoming:0,usage:0,folded:0,ng:0,otherNg:0});
}
function materialLiveInventory(materialId){
 // 2026-10-14 起改用「初始庫存＋快速輸入＋裝盒回報」計算（見 js/stock-calc.js）；以下是舊的折盒統計算法，只在新算法沒載入時使用
 if(window.CMSStock)return CMSStock.material(materialId);
 const init=(Array.isArray(db.initialStock)?db.initialStock:[])
   .find(x=>String(x.itemId)===String(materialId) && (!x.itemType || x.itemType==='material')) || {};
 const baseUnfolded=Number(init.unfolded)||0;
 const baseFolded=Number(init.folded)||0;
 const f=foldingTotalsForMaterial(materialId);

 const unfolded=baseUnfolded + f.incoming - f.folded - f.ng;
 const folded=baseFolded + f.folded - f.usage - f.otherNg;
 const total=unfolded + folded;

 return {total,unfolded,folded};
}


function refreshMaterialInventoryCells(materialId){
 const mats=Array.isArray(db.materials)?db.materials:[];
 const targets=materialId==null?mats:mats.filter(m=>String(m.id)===String(materialId));

 function setByData(attr,id,value){
   document.querySelectorAll('['+attr+']').forEach(el=>{
     if(String(el.getAttribute(attr))===String(id)) el.textContent=value;
   });
 }

 targets.forEach(m=>{
   const live=materialLiveInventory(m.id);
   // 待裝盒：2026-10-15 起＝各禮盒還要再裝的盒數 × 配方（見 js/stock-calc.js materialToPack）；以下是舊算法（檔期需求 × 配方）
   const demand=window.CMSStock?CMSStock.materialToPack(m.id):(db.campaigns||[]).reduce((sum,c)=>{
     const q=Number(c.qty)||0;
     const per=(db.recipes||[]).filter(r=>
       String(r.productId)===String(c.productId) &&
       String(r.materialId)===String(m.id)
     ).reduce((s,r)=>s+(Number(r.qty)||0),0);
     return sum+q*per;
   },0);

   const remain=live.total-demand;
   const safety=Number(m.safety)||0;

   setByData('data-home-total-id',m.id,live.total);
   setByData('data-home-unfolded-id',m.id,live.unfolded);
   setByData('data-home-folded-id',m.id,live.folded);
   setByData('data-home-remain-id',m.id,remain);

   const low=window.CMSRules?CMSRules.isLow(remain,safety):remain<safety; // 水位判斷：見「計算規則」
   document.querySelectorAll('[data-home-status-id]').forEach(el=>{
     if(String(el.getAttribute('data-home-status-id'))===String(m.id)){
       el.textContent=low?'不足':'正常';
       el.className=`sheet-status ${low?'bad':'good'}`;
     }
   });
 });
}
function renderDashboard(){
 ensureHomeOrder();
 const matBody=document.getElementById('homeMaterialBody');
 const singleHome=document.getElementById('homeSingleBody');
 const giftHome=document.getElementById('homeGiftBody');
 if(!matBody||!singleHome||!giftHome)return;

 ensureHomeOrder();
 const materials=orderedHomeItems('material',Array.isArray(db.materials)?db.materials.slice():[]);
 const products=Array.isArray(db.products)?db.products.slice():[];
 const singles=orderedHomeItems('single',products.filter(p=>String(p.category||'').trim()==='單條'));
 const gifts=orderedHomeItems('gift',products.filter(p=>String(p.category||'').trim()!=='單條' && p.isListedCurrent===true));

 // 待裝盒：2026-10-15 起＝各禮盒還要再裝的盒數 × 配方（見 js/stock-calc.js materialToPack）；以下是舊算法（檔期需求 × 配方）
 const matDemand=(mid)=>window.CMSStock?CMSStock.materialToPack(mid):(db.campaigns||[]).reduce((sum,c)=>{
   const q=Number(c.qty)||0;
   const per=(db.recipes||[]).filter(r=>String(r.productId)===String(c.productId)&&String(r.materialId)===String(mid))
     .reduce((s,r)=>s+(Number(r.qty)||0),0);
   return sum+q*per;
 },0);

 matBody.innerHTML=materials.length?materials.map((m,i)=>{
   const live=materialLiveInventory(m.id);
   const stock=live.total, demand=matDemand(m.id), safety=Number(m.safety)||0;
   const remain=window.CMSStock?Math.round((stock-demand)*100)/100:stock-demand;
   const low=window.CMSRules?CMSRules.isLow(remain,safety):remain<safety; // 水位判斷：見「計算規則」
   const unfolded=live.unfolded;
   const folded=live.folded;
   // 已裝盒＝各禮盒現貨 × 配方用量（禮盒現貨還沒串接時顯示「—」）
   const packed=window.CMSStock?CMSStock.materialPacked(m.id):null;
   return `<tr><td class="sort-action-col">${dragHandle('material',m.id)}</td>
    <td class="code-col">${m.code||''}</td><td class="name-cell">${m.name||''}</td>
    <td data-home-total-id="${m.id}">${stock}</td><td class="linked-stock-cell" data-home-unfolded-id="${m.id}">${unfolded}</td><td class="linked-stock-cell" data-home-folded-id="${m.id}">${folded}</td><td class="${packed==null?'manual-cell':''}">${packed==null?'—':packed}</td>
    <td>${demand}</td><td data-home-remain-id="${m.id}" class="${remain<0?'neg':''}">${remain}</td><td>${safety}</td>
    <td><span data-home-status-id="${m.id}" class="sheet-status ${low?'bad':'good'}">${low?'不足':'正常'}</span></td></tr>`;
 }).join(''):'<tr><td colspan="11" class="empty">尚無包材資料</td></tr>';

 singleHome.innerHTML=singles.length?singles.map((p,i)=>{
   const demand=(db.campaigns||[]).reduce((sum,c)=>{
     const q=Number(c.qty)||0;
     const per=(db.components||[]).filter(x=>String(x.productId)===String(c.productId)&&String(x.componentProductId)===String(p.id))
       .reduce((s,x)=>s+(Number(x.qty)||0),0);
     return sum+q*per;
   },0);
   return `<tr><td class="sort-action-col">${dragHandle('single',p.id)}</td>
    <td class="code-col">${p.code||''}</td><td class="name-cell">${p.name||''}</td><td>${demand}</td>
    <td class="manual-cell">—</td><td class="manual-cell">—</td><td class="manual-cell">—</td>
    <td>${demand}</td><td class="manual-cell">—</td><td class="manual-cell">—</td></tr>`;
 }).join(''):'<tr><td colspan="9" class="empty">尚無單條資料</td></tr>';

 giftHome.innerHTML=gifts.length?gifts.map((p,i)=>{
   const preorder=(db.campaigns||[]).filter(c=>String(c.productId)===String(p.id)).reduce((s,c)=>s+(Number(c.qty)||0),0);
   if(window.CMSStock){
     // 包裝需求＝現貨＋待進貨－預購單－銷售預估（見 js/stock-calc.js）；負數＝還要再裝這麼多盒
     const stockG=CMSStock.giftStock(p.id), incoming=CMSStock.giftIncoming(p.id), fc=CMSStock.giftForecast(p.id), need=CMSStock.giftPackNeed(p.id);
     return `<tr><td class="sort-action-col">${dragHandle('gift',p.id)}</td>
    <td class="code-col">${p.code||''}</td><td class="name-cell">${p.name||''}</td>
    <td class="${stockG==null?'manual-cell':''}" title="${stockG==null?'現貨的資料來源還沒串接，先當 0':''}">${stockG==null?'—':stockG}</td><td>${incoming}</td><td>${CMSStock.giftPreorder(p.id)}</td>
    <td>${fc}</td><td class="manual-cell">—</td><td class="${need<0?'neg':''}">${need}</td><td class="manual-cell">—</td></tr>`;
   }
   return `<tr><td class="sort-action-col">${dragHandle('gift',p.id)}</td>
    <td class="code-col">${p.code||''}</td><td class="name-cell">${p.name||''}</td>
    <td class="manual-cell">—</td><td class="manual-cell">—</td><td>${preorder}</td>
    <td class="manual-cell">—</td><td class="manual-cell">—</td><td>${preorder}</td><td class="manual-cell">—</td></tr>`;
 }).join(''):'<tr><td colspan="9" class="empty">尚無禮盒資料</td></tr>';

 renderFoldingRecords();
 bindHomeDrag();
}

function render(){
 // 每次顯示禮盒列表前核對舊版包材配方，避免 localStorage 覆蓋造成空白。
 restoreMissingPackagingRecipesOnce();

 if(!editGiftWithFormula)document.getElementById('giftCurrentListed').checked=false;
 matBody.innerHTML=db.materials.length?db.materials.map(x=>`<tr><td>${x.code||''}</td><td>${x.name}</td><td>${x.category||'單條'}</td><td>${x.unit||''}</td><td class=num>${x.safety}</td><td><button onclick="editMat('${x.id}')">編輯</button> <button onclick="del('materials','${x.id}')">刪除</button></td></tr>`).join(''):'<tr><td colspan=6 class=empty>尚無包材資料</td></tr>';
 prodBody.innerHTML=db.products.length?db.products.map(x=>`<tr><td>${x.code||''}</td><td>${x.name}</td><td>${x.category||''}</td><td>${db.recipes.filter(r=>r.productId===x.id).length} 項</td><td><button onclick="openGenericEdit('gift','${x.id}')">編輯</button> <button onclick="del('products','${x.id}')">刪除</button></td></tr>`).join(''):'<tr><td colspan=5 class=empty>尚無產品資料</td></tr>';
 if(window.rProduct)opts(rProduct,db.products,'name');let giftProducts=db.products
 .filter(x=>(x.category||'禮盒')!=='單條')
 .sort((a,b)=>(a.code||'').localeCompare((b.code||''),'zh-TW',{numeric:true,sensitivity:'base'}));
 prodBody.innerHTML=giftProducts.length?giftProducts.map(x=>{
   let comps=(db.components||[]).filter(r=>r.productId===x.id);
   let mats=(db.recipes||[]).filter(r=>r.productId===x.id);
   let ctext=comps.length?comps.map(r=>`${prodName(r.componentProductId)} ×${r.qty}`).join('、'):'尚未設定';
   let mtext=mats.length?mats.map(r=>`${matName(r.materialId)} ×${r.qty}`).join('、'):'尚未設定';
   return `<tr><td>${x.code||''}</td><td><strong>${x.name}</strong></td><td><input class="gift-inline-price" type="number" min="0" step="1" aria-label="${x.name}售價" value="${x.price==null?'':Number(x.price)}" onchange="updateGiftListPrice('${x.id}',this)" placeholder="售價"></td><td><label class="gift-inline-listed"><input type="checkbox" ${x.isListedCurrent===true?'checked':''} onchange="updateGiftListPublished('${x.id}',this)"> 本期上架</label></td><td>${ctext}</td><td>${mtext}</td><td><button onclick="toggleInlineGiftRecipe('${x.id}')">配方編輯</button> <button onclick="deleteGiftFull('${x.id}')">刪除</button></td></tr><tr class="inline-gift-recipe-row" id="inline-gift-${x.id}" style="display:none"><td colspan="7"><div class="inline-gift-recipe-wrap"></div></td></tr>`;
 }).join(''):'<tr><td colspan="7" class="empty">尚無禮盒資料</td></tr>';
 let singleProducts=db.products.filter(x=>x.category==='單條');
 // 單條也有售價（業績儀表板算金額用）與本期上架，存法和禮盒一樣（updateGiftListPrice／updateGiftListPublished 依品項 id 存）
 singleBody.innerHTML=singleProducts.length?singleProducts.map(x=>`<tr><td>${x.code||''}</td><td>${x.name}</td><td><input class="gift-inline-price" type="number" min="0" step="1" aria-label="${x.name}售價" value="${x.price==null?'':Number(x.price)}" onchange="updateGiftListPrice('${x.id}',this)" placeholder="售價"></td><td><label class="gift-inline-listed"><input type="checkbox" ${x.isListedCurrent===true?'checked':''} onchange="updateGiftListPublished('${x.id}',this)"> 本期上架</label></td><td><button onclick="openGenericEdit('single','${x.id}')">編輯</button> <button onclick="deleteSingleItem('${x.id}')">刪除</button></td></tr>`).join(''):'<tr><td colspan=5 class=empty>尚無單條資料</td></tr>';
 initGiftFormulaRows();
 opts(cProduct,db.products.filter(x=>x.category!=='單條'),'name');if(window.rMaterial)opts(rMaterial,db.materials,'name');if(document.getElementById('sMaterial'))updateStockItemOptions();
(document.getElementById('recipeBody')||{innerHTML:''}).innerHTML=db.recipes.length?db.recipes.map(x=>`<tr><td>${prodName(x.productId)}</td><td>${matName(x.materialId)}</td><td class=num>${x.qty}</td><td><button onclick="del('recipes','${x.id}')">刪除</button></td></tr>`).join(''):'<tr><td colspan=4 class=empty>尚無配方</td></tr>';
 
 



campBody.innerHTML=db.campaigns.length?db.campaigns.map(x=>`<tr><td>${x.name}</td><td>${x.date||''}</td><td>${prodName(x.productId)}</td><td class=num>${x.qty}</td><td><button onclick="openGenericEdit('campaign','${x.id}')">編輯</button> <button onclick="del('campaigns','${x.id}')">刪除</button></td></tr>`).join(''):'<tr><td colspan=5 class=empty>尚無檔期需求</td></tr>';
 if(window.stockBody)stockBody.innerHTML=db.stock.length?db.stock.slice().reverse().map(x=>`<tr><td>${x.date}</td><td>${(x.itemType||'material')==='single'?'單條內容物':'包材'}</td><td>${stockItemName(x)}</td><td>${x.type}</td><td>${x.qty}</td><td><button onclick="openGenericEdit('${x.id}')">刪除</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty">尚無庫存異動紀錄</td></tr>';
 // Legacy statistics widgets were removed from this layout; skip when absent.
 if(document.getElementById('catSingle') && document.getElementById('categoryTables')){
 let reps=db.materials.map(x=>{let stock=stockOf(x.id),dem=demandOf(x.id),order=Math.max(dem+x.safety-stock,0);return{x,stock,dem,after:stock-dem,order}});
let cats=['單條','禮盒','盒子'];
let sums={};
cats.forEach(c=>sums[c]=reps.filter(z=>(z.x.category||'單條')===c).reduce((a,z)=>a+z.stock,0));
catSingle.textContent=sums['單條'];
catGift.textContent=sums['禮盒'];
catBox.textContent=sums['盒子'];
catShort.textContent=reps.filter(z=>cats.includes(z.x.category||'單條')&&z.order>0).length;
categoryTables.innerHTML=cats.map(c=>{
 let rr=reps.filter(z=>(z.x.category||'單條')===c);
 return `<div style="margin-top:18px"><h3>${c}</h3><div class="tablewrap"><table><thead><tr><th>品項</th><th class=num>目前庫存</th><th class=num>檔期需求</th><th class=num>需求後庫存</th><th class=num>建議補貨</th><th>狀態</th></tr></thead><tbody>${
 rr.length?rr.map(z=>`<tr class="${z.order>0?'dangerrow':'okrow'}"><td>${z.x.name}</td><td class=num>${z.stock}</td><td class=num>${z.dem}</td><td class=num>${z.after}</td><td class=num><b>${z.order}</b></td><td><span class="badge ${z.order>0?'bad':'good'}">${z.order>0?'需補貨':'足夠'}</span></td></tr>`).join(''):`<tr><td colspan=6 class=empty>尚無${c}資料</td></tr>`
 }</tbody></table></div></div>`;
}).join('');

 repBody2.innerHTML=reps.length?reps.map(z=>`<tr class="${z.order>0?'dangerrow':'okrow'}"><td>${z.x.name}</td><td class=num>${z.stock}</td><td class=num>${z.dem}</td><td class=num>${z.x.safety}</td><td class=num>${z.after}</td><td class=num><b>${z.order}</b></td><td><span class="badge ${z.order>0?'bad':'good'}">${z.order>0?'需補貨':'足夠'}</span></td></tr>`).join(''):'<tr><td colspan=7 class=empty>建立包材、產品配方及檔期需求後，系統會自動計算</td></tr>';
 dMat.textContent=db.materials.length;dProd.textContent=db.products.length;dCamp.textContent=new Set(db.campaigns.map(x=>x.name)).size;dShort.textContent=reps.filter(x=>x.order>0).length;
 let singles=db.products.filter(x=>x.category==='單條').map(x=>({x,qty:componentDemand(x.id)})).filter(z=>z.qty>0);
 singleDemandProduct.innerHTML=singles.length?`<div class="tablewrap"><table><thead><tr><th>單條品項</th><th class=num>展開需求量</th></tr></thead><tbody>${singles.map(z=>`<tr><td>${z.x.name}</td><td class=num><b>${z.qty}</b></td></tr>`).join('')}</tbody></table></div>`:'<div class=empty>建立檔期需求後，這裡會自動顯示禮盒展開後的單條需求</div>';

 let sh=reps.filter(x=>x.order>0);dashShort.innerHTML=sh.length?`<table><thead><tr><th>包材</th><th class=num>建議補貨</th></tr></thead><tbody>${sh.map(z=>`<tr><td>${z.x.name}</td><td class=num><b>${z.order}</b></td></tr>`).join('')}</tbody></table>`:'<div class=empty>目前沒有缺料資料</div>';


 }
 renderInitialStock();

 

 renderDashboard();
}
function exportData(){let blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='檔期包材管理系統_資料備份.json';a.click();URL.revokeObjectURL(a.href)}
function importData(el){let f=el.files[0];if(!f)return;let r=new FileReader();r.onload=()=>{try{db=JSON.parse(r.result);ensureHomeOrder();
persist();alert('匯入完成')}catch(e){alert('檔案格式錯誤')}};r.readAsText(f)}
function wipeAll(){if(confirm('確定清空全部資料？此動作無法復原，建議先匯出備份。')){db={materials:[],products:[],recipes:[],campaigns:[],stock:[]};persist()}}
/* 啟動程序移至所有預載常數完成定義之後，避免資料載入時序錯誤。 */

function updateGiftListPrice(pid, input){
 const p=db.products.find(x=>x.id===pid);if(!p)return;
 const raw=input.value.trim();const value=raw===''?null:Number(raw);
 if(value!==null&&(!Number.isFinite(value)||value<0)){
   alert('售價請輸入有效的非負數');input.value=p.price==null?'':p.price;return;
 }
 p.price=value;
 try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){alert('儲存失敗：'+e.message);return;}
 // 編輯表單正好顯示同一個禮盒時同步數值
 if(editGiftWithFormula===pid){const el=document.getElementById('pPrice');if(el)el.value=value??'';}
 if(typeof recalcSalesForecast==='function')recalcSalesForecast();
}
function updateGiftListPublished(pid, input){
 const p=db.products.find(x=>x.id===pid);if(!p)return;
 const previous=p.isListedCurrent===true;
 p.isListedCurrent=input.checked;
 try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){p.isListedCurrent=previous;input.checked=previous;alert('儲存失敗：'+e.message);return;}
 if(editGiftWithFormula===pid){const el=document.getElementById('giftCurrentListed');if(el)el.checked=input.checked;}
 // 即時刷新首頁禮盒表，不重新繪製後台表單
 renderDashboard();
 if(typeof renderSalesForecast==='function')renderSalesForecast();
}

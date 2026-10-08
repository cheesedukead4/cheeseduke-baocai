let externalRows=[], externalHeaders=[];

function csvParse(text){
  const rows=[]; let row=[],cell='',q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i],nxt=text[i+1];
    if(c==='"'){
      if(q&&nxt==='"'){cell+='"';i++} else q=!q;
    } else if(c===','&&!q){row.push(cell);cell=''}
    else if((c==='\n'||c==='\r')&&!q){
      if(c==='\r'&&nxt==='\n')i++;
      row.push(cell);cell='';
      if(row.some(x=>String(x).trim()!==''))rows.push(row);
      row=[];
    } else cell+=c;
  }
  row.push(cell); if(row.some(x=>String(x).trim()!==''))rows.push(row);
  return rows;
}
function normalizeExternal(raw){
  if(!raw||!raw.length){externalHeaders=[];externalRows=[];return}
  if(Array.isArray(raw[0]) && !Array.isArray(raw[0][0])){
    externalHeaders=raw[0].map((x,i)=>String(x||('欄位'+(i+1))).trim());
    externalRows=raw.slice(1).map(r=>Object.fromEntries(externalHeaders.map((h,i)=>[h,r[i]??''])));
  }else if(typeof raw[0]==='object'){
    externalHeaders=[...new Set(raw.flatMap(x=>Object.keys(x||{})))];
    externalRows=raw;
  }
  renderExternalPreview();buildMapping();
}
function readExternalFile(el){
  const f=el.files[0]; if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      if(f.name.toLowerCase().endsWith('.json')){
        const x=JSON.parse(r.result);
        let raw=Array.isArray(x)?x:(x.data&&Array.isArray(x.data)?x.data:[x]);
        normalizeExternal(raw);
      }else normalizeExternal(csvParse(r.result));
      extInfo.textContent=`${f.name}｜${externalRows.length} 筆資料｜${externalHeaders.length} 個欄位`;
    }catch(e){alert('無法讀取檔案：'+e.message)}
  }; r.readAsText(f,'utf-8');
}
function renderExternalPreview(){
  if(!externalRows.length){externalPreview.innerHTML='<div class="empty">尚無預覽資料</div>';return}
  const rows=externalRows.slice(0,20);
  externalPreview.innerHTML=`<table><thead><tr>${externalHeaders.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(r=>`<tr>${externalHeaders.map(h=>`<td>${escapeHtml(r[h]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table>
  <div class="small" style="padding:8px">預覽前 ${Math.min(20,externalRows.length)} 筆，共 ${externalRows.length} 筆。</div>`;
}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function targetFields(){
  const t=extTarget.value;
  if(t==='materials')return [['code','包材編號'],['name','包材名稱'],['category','分類'],['unit','單位'],['safety','安全庫存']];
  if(t==='products')return [['code','產品編號'],['name','產品名稱']];
  if(t==='campaigns')return [['name','檔期名稱'],['date','日期'],['product','產品名稱／編號'],['qty','需求數量']];
  return [['date','日期'],['material','包材名稱／編號'],['type','類型（進貨/出庫/調整）'],['qty','數量']];
}
function guessHeader(label,key){
  let tests={
    code:/編號|代碼|code/i,name:/名稱|品名|name/i,category:/分類|類別|category/i,unit:/單位|unit/i,safety:/安全|水位|safety/i,
    date:/日期|date/i,product:/產品|商品|product/i,material:/包材|材料|material/i,
    qty:/數量|需求|qty|quantity/i,type:/類型|異動|type/i
  };
  return externalHeaders.find(h=>tests[key]?.test(h))||'';
}
function buildMapping(){
  if(!externalHeaders.length){mappingArea.innerHTML='<div class="empty">載入檔案後即可設定欄位</div>';return}
  mappingArea.innerHTML=targetFields().map(([k,l])=>{
    let guess=guessHeader(l,k);
    return `<label><span>${l}</span><select id="map_${k}"><option value="">不匯入</option>${externalHeaders.map(h=>`<option ${h===guess?'selected':''}>${escapeHtml(h)}</option>`).join('')}</select></label>`
  }).join('');
}
function val(r,k){let el=document.getElementById('map_'+k);return el&&el.value?r[el.value]:''}
function commitExternalImport(){
  if(!externalRows.length)return alert('請先載入資料');
  const t=extTarget.value,mode=extMode.value;
  if(mode==='replace'&&!confirm('確定要取代此類別目前全部資料嗎？'))return;
  let incoming=[];
  if(t==='materials'){
    incoming=externalRows.map(r=>({id:id(),code:String(val(r,'code')||'').trim(),name:String(val(r,'name')||'').trim(),category:String(val(r,'category')||'單條').trim(),unit:String(val(r,'unit')||'').trim(),safety:n(val(r,'safety'))})).filter(x=>x.name);
  }else if(t==='products'){
    incoming=externalRows.map(r=>({id:id(),code:String(val(r,'code')||'').trim(),name:String(val(r,'name')||'').trim()})).filter(x=>x.name);
  }else if(t==='campaigns'){
    incoming=externalRows.map(r=>{
      let ref=String(val(r,'product')||'').trim();
      let p=db.products.find(x=>x.name===ref||x.code===ref);
      return {id:id(),name:String(val(r,'name')||'').trim(),date:String(val(r,'date')||'').trim(),productId:p?.id||'',qty:n(val(r,'qty'))}
    }).filter(x=>x.name&&x.productId);
  }else{
    incoming=externalRows.map(r=>{
      let ref=String(val(r,'material')||'').trim();
      let m=db.materials.find(x=>x.name===ref||x.code===ref);
      let raw=String(val(r,'type')||'').trim();
      let type=/進|in/i.test(raw)?'in':/出|領|out/i.test(raw)?'out':'adjust';
      return {id:id(),date:String(val(r,'date')||'').trim(),materialId:m?.id||'',type,qty:n(val(r,'qty'))}
    }).filter(x=>x.materialId);
  }
  if(!incoming.length)return alert('沒有可匯入資料。檔期/庫存資料需先建立可對應的產品或包材。');
  if(mode==='replace')db[t]=incoming;else db[t].push(...incoming);
  persist();alert(`已匯入 ${incoming.length} 筆資料`);
}
function clearExternalImport(){externalRows=[];externalHeaders=[];extInfo.textContent='尚未選擇檔案';externalPreview.innerHTML='<div class="empty">尚無預覽資料</div>';buildMapping();extFile.value=''}
async function fetchRemoteData(){
  const u=remoteUrl.value.trim();if(!u)return alert('請輸入網址');
  try{
    const res=await fetch(u);if(!res.ok)throw new Error('HTTP '+res.status);
    const text=await res.text();
    let ct=res.headers.get('content-type')||'';
    if(ct.includes('json')||u.toLowerCase().includes('.json')){
      let x=JSON.parse(text);normalizeExternal(Array.isArray(x)?x:(x.data&&Array.isArray(x.data)?x.data:[x]));
    }else normalizeExternal(csvParse(text));
    extInfo.textContent=`網址資料｜${externalRows.length} 筆｜${externalHeaders.length} 欄`;
  }catch(e){alert('無法從此網址拉取資料。可能是網站阻擋跨網域存取（CORS）。可先下載成 CSV/JSON 再匯入。')}
}

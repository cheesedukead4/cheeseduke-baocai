let deferredPwaPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault(); deferredPwaPrompt=e;
  const bar=document.getElementById('pwaInstallBar'); if(bar)bar.style.display='flex';
});
document.addEventListener('click',async e=>{
  if(e.target && e.target.id==='pwaInstallBtn' && deferredPwaPrompt){
    deferredPwaPrompt.prompt();
    await deferredPwaPrompt.userChoice;
    deferredPwaPrompt=null;
    document.getElementById('pwaInstallBar').style.display='none';
  }
});
window.addEventListener('appinstalled',()=>{const b=document.getElementById('pwaInstallBar');if(b)b.style.display='none'});
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));
}

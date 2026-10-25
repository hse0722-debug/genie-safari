(()=>{
window.addEventListener('GENIE_CALL_PAGE_FN',e=>{const d=e.detail||{};if(['loginID','loginPopup'].includes(d.fnName)&&typeof window[d.fnName]==='function')window[d.fnName](...(d.args||[]));});
if(location.hostname!=='www.genie.co.kr'||!/^\/download\//.test(location.pathname))return;
let accepted=false;
window.addEventListener('GENIE_INIT_DOWNLOAD',e=>{if(accepted||document.readyState!=='complete')return;const ids=String(e.detail?.ids||'');if(!/^(\d+\^)+$/.test(ids)||!window.itemContent||typeof window.fnDownSongAdd!=='function'||!['Y','E'].includes(window.DownAddYN))return;accepted=true;document.documentElement.setAttribute('data-genie-init-accepted','yes');if(!window.itemContent.downSongList)window.fnDownSongAdd(ids);});
setInterval(()=>{const ready=window.checkStart==='Y'&&Array.isArray(window.itemList)&&window.itemList.length>0&&window.DownAddYN!=='A';document.documentElement?.setAttribute('data-genie-download-ready',JSON.stringify(ready?window.itemList.map(x=>String(x.songid)):[]));},300);
})();
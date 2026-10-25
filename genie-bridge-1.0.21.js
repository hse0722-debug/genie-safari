(()=>{
window.addEventListener('GENIE_CALL_PAGE_FN',event=>{const d=event.detail||{};if(['loginID','loginPopup'].includes(d.fnName)&&typeof window[d.fnName]==='function')window[d.fnName](...(d.args||[]));});
function publishSession(){
 const raw=typeof window.iMemUno==='undefined'?'':String(window.iMemUno);
 const memberNo=/^\d+$/.test(raw)?raw:null;
 document.documentElement?.setAttribute('data-genie-session',JSON.stringify({memberNo}));
}
publishSession();setInterval(publishSession,400);
})();
// ==UserScript==
// @name 지니 Safari 페이지 연결
// @namespace genie-safari-bridge
// @version 1.0.16
// @updateURL https://hse0722-debug.github.io/genie-safari/genie-safari-bridge.user.js
// @downloadURL https://hse0722-debug.github.io/genie-safari/genie-safari-bridge.user.js
// @match https://*.genie.co.kr/*
// @run-at document-start
// @inject-into page
// @grant none
// ==/UserScript==
(()=>{
 // Do not intercept clicks or replace window.open: manual actions remain native.
 window.addEventListener('GENIE_CALL_PAGE_FN',e=>{
  const d=e.detail||{};
  if(['loginID','loginPopup'].includes(d.fnName)&&typeof window[d.fnName]==='function')window[d.fnName](...(d.args||[]));
 });
 if(location.hostname!=='www.genie.co.kr'||!/^\/download\//.test(location.pathname))return;
 let accepted=false;
 window.addEventListener('GENIE_INIT_DOWNLOAD',e=>{
  if(accepted||document.readyState!=='complete')return;
  const ids=String(e.detail?.ids||'');if(!/^(\d+\^)+$/.test(ids))return;
  if(!window.itemContent||typeof window.fnDownSongAdd!=='function')return;
  if(!['Y','E'].includes(window.DownAddYN))return;
  if(window.itemContent.downSongList){accepted=true;document.documentElement.setAttribute('data-genie-init-accepted','yes');return;}
  accepted=true;document.documentElement.setAttribute('data-genie-init-accepted','yes');
  try{window.fnDownSongAdd(ids);}catch(error){console.error('[지니 곡 정보 전달]',error);}
 });
 setInterval(()=>{
  const ready=window.checkStart==='Y'&&Array.isArray(window.itemList)&&window.itemList.length>0&&window.DownAddYN!=='A';
  document.documentElement?.setAttribute('data-genie-download-ready',JSON.stringify(ready?window.itemList.map(x=>String(x.songid)):[]));
 },300);
})();
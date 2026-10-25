// ==UserScript==
// @name 지니 Safari 페이지 연결
// @namespace genie-safari-bridge
// @version 2.0.0
// @match https://*.genie.co.kr/*
// @run-at document-start
// @inject-into page
// @grant none
// ==/UserScript==
const ROLE='bridge';

(async()=>{
const BASE='https://hse0722-debug.github.io/genie-safari/';
function report(error){if(window!==window.top)return;const show=()=>{if(!document.documentElement){setTimeout(show,50);return;}let box=document.getElementById('genie-loader-error-'+ROLE);if(!box){box=document.createElement('div');box.id='genie-loader-error-'+ROLE;document.documentElement.appendChild(box);}box.style.cssText='position:fixed;top:60px;left:10px;right:10px;z-index:2147483647;background:#fff;color:#b00020;border:2px solid #b00020;padding:12px;font-size:16px;';box.textContent='지니 최신 코드 로딩 실패 ('+ROLE+'): '+error.message+' · 새로고침해 주세요.';};show();}
async function read(file){const url=BASE+file+'?refresh='+Date.now()+'-'+Math.random();if(ROLE==='main')return await new Promise((resolve,reject)=>GM.xmlHttpRequest({method:'GET',url,timeout:15000,headers:{'Cache-Control':'no-cache'},onload:r=>r.status===200?resolve(r.responseText):reject(new Error('HTTP '+r.status)),onerror:()=>reject(new Error('네트워크 연결 실패')),ontimeout:()=>reject(new Error('서버 응답 시간 초과'))}));const response=await fetch(url,{cache:'no-store',credentials:'omit'});if(!response.ok)throw new Error('HTTP '+response.status);return response.text();}
try{
const manifest=JSON.parse(await read('release.json'));
const entry=manifest[ROLE];if(manifest.schema!==1||!entry||!/^genie-(main|bridge)-[0-9.]+\.js$/.test(entry.file)||!/^[a-f0-9]{64}$/.test(entry.sha256))throw new Error('배포 정보가 올바르지 않습니다');
const code=await read(entry.file);
const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code)))).map(x=>x.toString(16).padStart(2,'0')).join('');
if(digest!==entry.sha256)throw new Error('배포 파일 검증 실패');
const key='__genieRemote_'+ROLE;if(window[key])return;window[key]=manifest.version;
if(document.documentElement)document.documentElement.setAttribute('data-genie-remote-'+ROLE,manifest.version);
if(ROLE==='main')await new Function('GM','return '+code)(GM);else new Function(code)();
}catch(error){report(error);}
})();
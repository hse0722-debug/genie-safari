(async () => {
'use strict';
let remoteSettingsReady=false;
// Mount the launcher before Userscripts storage calls or page load completes.
let launcherTimer = setInterval(() => {
 if(window !== window.top || location.hostname === 'pay.genie.co.kr' || /\/(download|buy)\//i.test(location.pathname)) { clearInterval(launcherTimer); return; }
 if(!document.documentElement) return;
 if(document.getElementById('genie-open-btn')) { clearInterval(launcherTimer); return; }
 const button=document.createElement('button');
 button.id='genie-open-btn';
 button.textContent='🎵 도우미 열기';
 button.style.cssText='position:fixed!important;top:80px!important;right:12px!important;z-index:2147483647!important;display:block!important;padding:12px!important;background:#2980b9!important;color:white!important;border:0!important;border-radius:20px!important;font-size:14px!important;';
 button.onclick=async()=>{
  try {
   button.textContent='불러오는 중…';
   await createFloatingPanel();
   const panel=document.getElementById('genie-helper-dashboard');
   if(panel) panel.style.display='block';
   else alert('이 페이지에서는 리모컨을 표시하지 않습니다. 페이지가 로딩된 후 다시 눌러 주세요.');
  } catch(error) { genieShowError(error); }
  finally { button.textContent='🎵 도우미 열기'; }
 };
 document.documentElement.appendChild(button);
 clearInterval(launcherTimer);
},50);


const listeners = [];
const chrome = {
 storage: {
  local: {
   async get(keys) {
    const out = {};
    const names = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
    for (const name of names) out[name] = await GM.getValue(name, Array.isArray(keys) || typeof keys === 'string' ? undefined : keys[name]);
    return out;
   },
   async set(values) { for (const [key,value] of Object.entries(values)) await GM.setValue(key,value); for (const listener of listeners) Promise.resolve(listener()).catch(console.error); },
   async clear() { for (const key of await GM.listValues()) await GM.deleteValue(key); }
  },
  onChanged: { addListener(fn) { listeners.push(fn); } }
 },
 runtime: { async sendMessage() { return {status:'ok'}; }, onMessage: {addListener() {}} }
};
const fetch = (url, options) => String(url).startsWith('https://docs.google.com/')
 ? new Promise((resolve,reject) => GM.xmlHttpRequest({method:'GET',url:String(url),timeout:10000,onload:r => resolve({ok:r.status>=200&&r.status<300,status:r.status,text:async()=>r.responseText}),onerror:()=>reject(new Error('인증 서버 연결 실패')),ontimeout:()=>reject(new Error('인증 시간 초과'))}))
 : window.fetch(url,options);

const genieDownloadPage = location.hostname === 'www.genie.co.kr' && /^\/download\//i.test(location.pathname);

let promotionHandled=false;
setInterval(async()=>{
 if(promotionHandled||document.hidden||location.hostname!=='pay.genie.co.kr')return;
 const later=Array.from(document.querySelectorAll('a,button')).find(el=>/나중에\s*보기/.test(el.textContent||'')&&el.getClientRects().length);
 if(!later||!/시크릿\s*할인|12개월/.test(document.body?.innerText||''))return;
 promotionHandled=true;later.click();
},500);






function sessionIdentity(){try{return JSON.parse(document.documentElement.getAttribute('data-genie-session')||'null');}catch(_){return null;}}


function loginScreenState(){
 const visible=el=>!!el&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';
 const nodes=Array.from(document.querySelectorAll('button,a'));
 const loggedIn=nodes.some(el=>visible(el)&&(/getMyProductInfo/.test(el.getAttribute('onclick')||'')||el.classList.contains('btn-logout')));
 const loginLabel=nodes.some(el=>!el.closest('#genie-helper-dashboard')&&visible(el)&&/^로그인\s*(?:\/\s*회원가입)?$/.test((el.textContent||'').trim()));
 const form=visibleLoginInputs();
 return {loggedIn,loggedOut:!loggedIn&&(loginLabel||!!(form.id&&form.pw))};
}

function visibleLoginInputs(){
 const pick=selectors=>Array.from(document.querySelectorAll(selectors)).find(el=>el.getClientRects().length>0);
 return {id:pick('#gnb_uxd,#gnb_uxd_id,#uxd_id,input[name="gnb_uxd"]'),pw:pick('#gnb_uxx,#gnb_uxd_pw,#uxd_pw,input[name="gnb_uxx"]')};
}
async function beginConfirmedLogout(nextIndex){
 await GM.deleteValue('verifiedSession');await GM.deleteValue('loginSequence');
 sessionStorage.removeItem('genie-safari-login-pending');sessionStorage.removeItem('genie-login-submitted');
 await chrome.storage.local.set({step:'WAIT_LOGOUT',pendingAccountIndex:nextIndex,logoutRequestedAt:Date.now(),isRunning:true});
 await saveLog('로그아웃 요청 · 로그아웃 확인 전에는 다음 계정 로그인 금지','INFO');
 if(loginScreenState().loggedOut){await saveLog('이미 로그아웃 상태 · 로그인/회원가입 표시 확인','INFO');return;}
 location.href='https://www.genie.co.kr/auth/signOut?rfr='+encodeURIComponent('https://www.genie.co.kr/');
}
async function stopLoginFlow(message){await chrome.storage.local.set({isRunning:false});await saveLog(message+' · 작업 중단','ERROR');}
async function handleLoginSequence(data){
 const stage=data.step;
 if(!['WAIT_LOGOUT','LOGIN_FORM','WAIT_LOGIN','CHECK_OR_LOGIN','NEXT_ACCOUNT_LOGIN'].includes(stage))return false;
 if(stage==='CHECK_OR_LOGIN'||stage==='NEXT_ACCOUNT_LOGIN'){await beginConfirmedLogout(data.currentIndex||0);return true;}
 const snap=sessionIdentity();const fields=visibleLoginInputs();
 const loggedOut=loginScreenState().loggedOut;
 if(stage==='WAIT_LOGOUT'){
  if(!loggedOut){if(Date.now()-data.logoutRequestedAt>30000)await stopLoginFlow('로그아웃 상태를 확인하지 못했습니다');return true;}
  const next=data.pendingAccountIndex??data.currentIndex??0;
  await saveLog('로그아웃 상태 확인 완료','INFO');
  if(next>=data.accounts.length){await chrome.storage.local.set({currentIndex:next,isRunning:false,step:'IDLE',pendingAccountIndex:null});await saveLog('전체 계정 진행 종료 · 다운로드 결과는 사용자 확인 기록 참조','INFO');return true;}
  const nonce=Date.now()+':'+Math.random();
  await GM.setValue('loginSequence',{nonce,index:next,account:data.accounts[next].id,logoutConfirmedAt:Date.now(),submitted:false});
  await chrome.storage.local.set({currentIndex:next,step:'LOGIN_FORM',pendingAccountIndex:null,albumIndex:0,songIndex:0});
  location.href='https://www.genie.co.kr/member/popLogin?page_rfr='+encodeURIComponent('https://www.genie.co.kr/');return true;
 }
 const sequence=await GM.getValue('loginSequence',null);
 const account=data.accounts[data.currentIndex];
 if(!sequence||sequence.index!==data.currentIndex||sequence.account!==account.id){await stopLoginFlow('계정 로그인 순서 정보가 일치하지 않습니다');return true;}
 if(stage==='LOGIN_FORM'){
  if(!snap)return true;
  if(snap.memberNo&&!loginScreenState().loggedOut){await stopLoginFlow('새 로그인 제출 전에 로그인 세션이 나타났습니다');return true;}
  if(!fields.id||!fields.pw)return true;
  setInputValue(fields.id,account.id);setInputValue(fields.pw,account.pw);
  await GM.setValue('loginSequence',{...sequence,submitted:true,submittedAt:Date.now()});
  await chrome.storage.local.set({step:'WAIT_LOGIN'});
  await saveLog('로그아웃 확인 후 로그인 1회 제출: '+account.id,'INFO');
  const button=Array.from(document.querySelectorAll('input.btn-submit,input[type="submit"],button[type="submit"],.btn-login')).find(el=>el.getClientRects().length);
  if(button)button.click();else callPageFunction('loginID');return true;
 }
 if(stage==='WAIT_LOGIN'){
  if(!sequence.submitted){await stopLoginFlow('로그인 제출 기록이 없습니다');return true;}
  if(Date.now()-sequence.submittedAt>1500&&genieLoginPageError()){await stopLoginFlow('지니 로그인 응답에 오류 안내가 있습니다');return true;}
  if(snap?.memberNo&&!(fields.id&&fields.pw)){
   await GM.setValue('verifiedSession',{account:account.id,index:data.currentIndex,memberNo:snap.memberNo,method:'confirmed-logout-then-login',nonce:sequence.nonce});
   await chrome.storage.local.set({step:'ALBUM_LIKE',albumIndex:0,songIndex:0,waitRetry:0});
   await saveLog('로그아웃→로그인 상태 전환 확인 · 회원번호 '+snap.memberNo+' · 앨범으로 이동','INFO');
   location.replace(getNextStageUrl('ALBUM_LIKE',data).url);return true;
  }
  if(Date.now()-sequence.submittedAt>30000)await stopLoginFlow('로그인 성공 상태를 확인하지 못했습니다');
  return true;
 }
 return true;
}
async function verifyCurrentAccount(data){
 const verified=await GM.getValue('verifiedSession',null);const snap=sessionIdentity();const target=data.accounts?.[data.currentIndex]?.id;
 const ok=!!(verified&&verified.index===data.currentIndex&&verified.account===target&&verified.method==='confirmed-logout-then-login'&&snap?.memberNo===verified.memberNo);
 if(!ok)await stopLoginFlow('로그인 확인 이후 세션이 바뀌었거나 확인 정보가 없습니다');
 return ok;
}

async function stillCurrent(expected){
 if(document.hidden||!(await safariOwnsController()))return false;
 const d=await chrome.storage.local.get(['accounts','currentIndex','isRunning']);
 const snap=sessionIdentity();const verified=await GM.getValue('verifiedSession',null);
 return !!(d.isRunning&&d.accounts?.[d.currentIndex]?.id===expected&&verified?.account===expected&&verified.index===d.currentIndex&&snap?.memberNo===verified.memberNo);
}
async function requestUserNext(outcome){
 if(!['started','completed','failed'].includes(outcome))throw new Error('다운로드 결과를 먼저 선택해 주세요.');
 const d=await chrome.storage.local.get(['accounts','currentIndex','songIndex','step','isRunning']);
 const target=d.accounts?.[d.currentIndex]?.id;
 if(!d.isRunning||!['SONG_DOWNLOAD','PAY_POPUP_STEP1','WAIT_DOWNLOAD_STREAM'].includes(d.step))throw new Error('다운로드 대기 상태가 아닙니다.');
 const verified=await GM.getValue('verifiedSession',null);const snapshot=sessionIdentity();
 if(!verified||verified.account!==target||verified.index!==d.currentIndex||!snapshot?.memberNo||snapshot.memberNo!==verified.memberNo)throw new Error('실제 로그인 계정이 확인된 작업 계정과 다릅니다. 전환을 중단합니다.');
 await GM.setValue('safariControllerOwner',safariTabToken());sessionStorage.setItem('genie-navigation-owner',safariTabToken());sessionStorage.setItem('genie-safari-controller','yes');
 await GM.setValue('safariDownloadApproval',{account:d.currentIndex,accountId:target,memberNo:snapshot.memberNo,song:d.songIndex||0,outcome,due:Date.now()+3000});
 setTimeout(consumeDownloadApproval,3100);
}
async function recordUserDownload(request,data){
 const account=data.accounts[data.currentIndex].id;
 const outcomes=await GM.getValue('userDownloadOutcomes',{});
 const perAccount=outcomes[account]||{};perAccount[data.songs[request.song]]=request.outcome;outcomes[account]=perAccount;
 await GM.setValue('userDownloadOutcomes',outcomes);
 const values=data.songs.map(id=>perAccount[id]);
 const result=values.includes('failed')?'x':values.every(x=>x==='completed')?'o':values.includes(undefined)?'-':'시작확인';
 await updateStepResult(account,'down',result);
 await saveLog('사용자 다운로드 결과: '+({started:'시작 확인 (완료 미확인)',completed:'완료 확인',failed:'실패 확인'}[request.outcome])+' · 곡 '+data.songs[request.song],'INFO');
}

const documentControllerId=Date.now()+':'+Math.random();
function safariTabToken(){return documentControllerId;}

async function safariOwnsController(){
 const owner=await GM.getValue('safariControllerOwner',null);
 if(owner===safariTabToken())return true;
 if(document.hidden)return false;
 const previous=sessionStorage.getItem('genie-navigation-owner');
 if(owner&&owner!==previous)return false;
 await GM.setValue('safariControllerOwner',safariTabToken());sessionStorage.setItem('genie-navigation-owner',safariTabToken());sessionStorage.setItem('genie-navigation-owner',safariTabToken());return true;
}

let approvalBusy = false;
async function consumeDownloadApproval(){
 if(document.hidden||window!==window.top)return;
 if(!navigator.locks)return;
 return navigator.locks.request('genie-account-worker',{ifAvailable:true},async lock=>{if(lock)await consumeDownloadApprovalUnlocked();});
}
async function consumeDownloadApprovalUnlocked() {
 if(!remoteSettingsReady)return;
 if(approvalBusy || window !== window.top || sessionStorage.getItem('genie-safari-controller') !== 'yes') return;
 approvalBusy=true;
 try {
  if(!(await safariOwnsController())) return;
  const request=await GM.getValue('safariDownloadApproval',null);
  if(!request || Date.now()<request.due) return;
  const data=await chrome.storage.local.get(['isRunning','step','accounts','currentIndex','songs','songIndex']);
  if(!data.isRunning || data.currentIndex!==request.account || (data.songIndex||0)!==request.song || !['SONG_DOWNLOAD','PAY_POPUP_STEP1','WAIT_DOWNLOAD_STREAM'].includes(data.step)) {
   await GM.deleteValue('safariDownloadApproval'); return;
  }
  await GM.deleteValue('safariDownloadApproval');
  if(request.accountId!==data.accounts?.[data.currentIndex]?.id||!['started','completed','failed'].includes(request.outcome))return;
  const currentSnapshot=sessionIdentity();if(!currentSnapshot?.memberNo||currentSnapshot.memberNo!==request.memberNo)return;
  await recordUserDownload(request,data);
  const nextSong=(data.songIndex||0)+1;
  if(nextSong<(data.songs||[]).length){
   await chrome.storage.local.set({songIndex:nextSong,step:'SONG_LIKE',waitRetry:0});
   location.href=getUrl('song',data.songs[nextSong]);
  }else{
   await beginConfirmedLogout((data.currentIndex||0)+1);
  }
 }catch(error){console.error(error);}finally{approvalBusy=false;}
}
setInterval(consumeDownloadApproval,500);
window.addEventListener('message',e=>{if(e.origin==='https://www.genie.co.kr'&&e.data==='GENIE_APPROVAL_READY')consumeDownloadApproval();});
window.addEventListener('focus',consumeDownloadApproval);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)consumeDownloadApproval();});
if((genieDownloadPage || (location.hostname === 'pay.genie.co.kr' && !/시크릿/.test(document.body?.innerText||'')) || /^\/buy\//i.test(location.pathname)) && window===window.top){
 GM.getValue('safariPopupRequest',null).then(request=>{
  if(request && Date.now()-request.time<30000) return GM.setValue('safariPopupOpened',{token:request.token,time:Date.now()});
 }).catch(console.error);
 const mount=setInterval(()=>{
  if(!document.documentElement)return;
  clearInterval(mount);
  const box=document.createElement('div');
  box.style.cssText='position:fixed;bottom:calc(16px + env(safe-area-inset-bottom));right:12px;z-index:2147483647;background:#fff4d5;color:#111;padding:12px;border:2px solid #2980b9;border-radius:8px;max-width:300px;font:14px sans-serif;';
  const status=document.createElement('div');
  status.textContent='';
  const button=document.createElement('button');button.textContent='다음 계정 진행';button.style.cssText='margin-top:8px;padding:10px;';
  button.onclick=async()=>{
   button.disabled=true;
   try{
    const d=await chrome.storage.local.get(['isRunning','step','currentIndex','songIndex']);
    if(!d.isRunning||!['SONG_DOWNLOAD','PAY_POPUP_STEP1','WAIT_DOWNLOAD_STREAM'].includes(d.step)) {status.textContent='원래 탭이 다운로드 대기 상태가 아닙니다.';button.disabled=false;return;}
    await requestUserNext(resultChoice.value);
    let left=3;status.textContent='3초 후 다음 진행';
    const timer=setInterval(()=>{left--;status.textContent=left>0?left+'초 후 다음 진행':'다음 단계로 이동 중…';if(left<=0){clearInterval(timer);consumeDownloadApproval();try{window.opener?.postMessage('GENIE_APPROVAL_READY','https://www.genie.co.kr');window.opener?.focus();}catch(_){}}},1000);
   }catch(error){status.textContent='오류: '+error.message;button.disabled=false;}
  };
  const resultChoice=document.createElement('select');
  resultChoice.style.cssText='display:block;max-width:280px;padding:8px;';
  for(const [value,label] of [['','ダウンロード結果'],['started','다운로드 시작 확인'],['completed','다운로드 완료 확인'],['failed','다운로드 실패 확인']]){const option=document.createElement('option');option.value=value;option.textContent=label==='ダウンロード結果'?'다운로드 결과 선택':label;resultChoice.appendChild(option);}
  box.append(status,resultChoice,button);document.documentElement.appendChild(box);
 },50);
}


function genieLoginPageError() {
 const body=document.body?.cloneNode(true);
 if(!body)return false;
 body.querySelectorAll('#genie-helper-dashboard,#genie-open-btn,#genie-startup-error,script,style').forEach(el=>el.remove());
 return /일치하지 않습니다|다시 확인해주세요/.test(body.innerText || body.textContent || '');
}

function genieShowError(error) {
  if (window !== window.top) return;
  const render = () => {
    let box = document.getElementById('genie-startup-error');
    if (!box) { box = document.createElement('div'); box.id = 'genie-startup-error'; document.documentElement.appendChild(box); }
    box.style.cssText = 'position:fixed;top:15px;left:15px;max-width:90vw;padding:16px;background:#fff;color:#b00020;border:3px solid #b00020;z-index:2147483647;font-size:16px;white-space:pre-wrap;';
    box.textContent = '지니 Safari 1.0 실행 오류\n' + String(error && error.message || error);
  };
  render();
}
function extractId(input, paramName) {
  if (!input) return "";
  const str = input.trim();
  if (str.includes('genie.co.kr')) {
    try {
      const url = new URL(str.startsWith('http') ? str : 'https://' + str);
      return url.searchParams.get(paramName)?.replace(/[^0-9]/g, '') || "";
    } catch (e) {}
  }
  return str.replace(/[^0-9]/g, '');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

// 페이지 전역 함수(MAIN world) 호출 헬퍼
function callPageFunction(fnName, args = []) {
  window.dispatchEvent(new CustomEvent('GENIE_CALL_PAGE_FN', {
    detail: { fnName, args }
  }));
}

// URL 생성 공통 헬퍼
const getUrl = (t, id) =>
  `https://www.genie.co.kr/detail/${t === 'album' ? 'albumInfo?axnm=' : 'songInfo?xgnm='}${encodeURIComponent(id)}`;

// 다음 단계의 첫 번째 목적지 계산
function getNextStageUrl(nextStep, data) {
  if (nextStep === 'ALBUM_LIKE') {
    if (data.albums && data.albums.length > 0) {
      return { step: 'ALBUM_LIKE', url: getUrl('album', data.albums[0]) };
    }
    nextStep = 'SONG_LIKE';
  }
  if (nextStep === 'SONG_LIKE') {
    if (data.songs && data.songs.length > 0) {
      return { step: 'SONG_LIKE', url: getUrl('song', data.songs[0]) };
    }
    nextStep = 'NEXT_ACCOUNT_LOGIN';
  }
  return {
    step: 'NEXT_ACCOUNT_LOGIN',
    url: "https://www.genie.co.kr/member/logout?page_rfr=" + encodeURIComponent("https://www.genie.co.kr/")
  };
}

// 실시간 로그 및 상태 저장 함수
async function saveLog(text, type = 'INFO') {
  const now = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  const data = await chrome.storage.local.get({ logs: [], accounts: [], currentIndex: 0 });
  const accId = data.accounts[data.currentIndex]?.id || 'System';
  const verified=await GM.getValue('verifiedSession',null);const snapshot=sessionIdentity();
  const actual=verified&&snapshot?.memberNo===verified.memberNo?verified.account:'미확인';
  const entry = `[${now}] [${type}] [목표:${accId}] [로그인흐름확인:${actual}] ${text}`;
  const updatedLogs = [...(data.logs || []), entry];

  await chrome.storage.local.set({
    logs: updatedLogs,
    lastActionText: `${text} (${now})`
  });
}

// 단계별 결과(o, x) 기록 헬퍼 함수
async function updateStepResult(accId, key, val) {
  if (!accId) return;
  const data = await chrome.storage.local.get({ accountResults: {} });
  const results = data.accountResults || {};
  if (!results[accId]) results[accId] = { album: '-', song: '-', down: '-' };
  results[accId][key] = val;
  await chrome.storage.local.set({ accountResults: results });
}

// 로그인 상태 확인 헬퍼
function isUserLoggedIn() {
  const myInfoBtn = document.querySelector('button.btn[onclick*="getMyProductInfo"]');
  const logoutBtn = document.querySelector('a.btn-logout[onclick*="logout"], a.btn-logout');
  return Boolean(myInfoBtn || logoutBtn);
}

// =========================================================
// 구글시트 원격 비밀번호 검증 함수 (추가된 핵심 로직)
// =========================================================
async function verifyRemotePassword() {
  const SPREADSHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQbPI2-Jl21I-hHrIaPTaYIldo3-tJ-4Ml6aTiVZyc8q4az_ETGcOt2iY-E6suHUwbSbsIqXwtq3GGT/pub?output=csv";
  
  const passwordInput = document.getElementById('input-auth-pw');
  const inputPw = passwordInput ? passwordInput.value.trim() : "";

  if (!inputPw) {
    await saveLog("⚠️ 원격 인증 비밀번호를 입력해주세요.", "ERROR");
    alert("인증 비밀번호를 입력해주세요.");
    return false;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(SPREADSHEET_CSV_URL, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error("서버 응답이 올바르지 않습니다.");

    const csvText = await response.text();
    // 시트의 첫 번째 행, 첫 번째 열 값을 읽어옴
    const serverPw = csvText.split(/\r?\n/)[0].split(',')[0].replace(/["']/g, "").trim();

    if (inputPw === serverPw) {
      await saveLog("✅ 원격 비밀번호 인증 성공!", "SUCCESS");
      return true;
    } else {
      await saveLog("❌ 인증 비밀번호가 일치하지 않습니다.", "ERROR");
      alert("비밀번호가 올바르지 않습니다. 관리자에게 문의하세요.");
      return false;
    }
  } catch (err) {
    await saveLog(`❌ 원격 인증 서버 연결 실패: ${err.message}`, "ERROR");
    alert("인증 서버에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.");
    return false;
  }
}

// =========================================================
// 1. 플로팅 리모컨 대시보드 UI (결제/다운로드 팝업창 제외 처리)
// =========================================================
async function createFloatingPanel() {
  const url = window.location.href;
  
  if (window !== window.top || genieDownloadPage || location.hostname === 'pay.genie.co.kr' || /^\/buy\//i.test(location.pathname)) return;

  if (!document.body) {
    setTimeout(createFloatingPanel, 100);
    return;
  }

  try { Promise.resolve(chrome.runtime.sendMessage({ action: 'REGISTER_MAIN_TAB' })).catch(() => {}); } catch (error) { console.warn(error); }

  if (!document.getElementById('genie-open-btn')) {
    const openBtn = document.createElement('button');
    openBtn.id = 'genie-open-btn';
    openBtn.innerHTML = '🎵 도우미 열기';
    openBtn.style.cssText = `
      position: fixed; bottom: 15px; right: 15px; z-index: 2147483646;
      background: #2980b9; color: white; border: none; padding: 10px 15px;
      border-radius: 25px; font-weight: bold; font-size: 12px; cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-family: 'Malgun Gothic', sans-serif;
    `;
    openBtn.onclick = async () => {
      const dash = document.getElementById('genie-helper-dashboard');
      if (dash) {
        dash.style.display = 'block';
        await chrome.storage.local.set({ panelHidden: false });
      }
    };
    document.body.appendChild(openBtn);
  }

  if (document.getElementById('genie-helper-dashboard')) return;

  const posData = {};
  const panel = document.createElement('div');
  panel.id = 'genie-helper-dashboard';

  let posStyle = 'bottom: calc(16px + env(safe-area-inset-bottom)); right: 12px;';
  if (posData.panelPos && posData.panelPos.left && posData.panelPos.top) {
    posStyle = `left: ${posData.panelPos.left}; top: ${posData.panelPos.top};`;
  }
  const displayStyle = 'block';

  panel.style.cssText = `
    position: fixed; ${posStyle} display: ${displayStyle};
    width: 430px; max-width: calc(100vw - 24px); box-sizing: border-box; height: auto; max-height: 75vh; overflow-y: auto;
    background: #ffffff; color: #333333; border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.35); z-index: 2147483647;
    font-family: 'Malgun Gothic', sans-serif; border: 2px solid #2c3e50; text-align: left;
  `;

  panel.innerHTML = `
    <div id="dash-header" style="background:#2c3e50; color:white; padding:10px 14px; cursor:move; display:flex; justify-content:space-between; align-items:center; border-radius:7px 7px 0 0; user-select:none;">
      <span style="font-weight:bold; font-size:13px;">🎵 지니 다운 도우미 [포레스텔라음원총공팀 제작]</span>
      <button id="btn-close-dash" style="background:#e74c3c; color:white; border:none; padding:3px 8px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:11px;">숨기기 _</button>
    </div>

    <div style="padding: 12px;">
      <!-- 상단 상태 알림 및 시작/중단 버튼 -->
      <div style="background:#f8f9fa; padding:10px; border:1px solid #ddd; border-radius:6px; margin-bottom:10px;">
        <div style="margin-bottom:8px; font-size:11px; line-height:1.4;">
          <b>상태 알림:</b> <span id="dash-last-log" style="color:#d35400; font-weight:bold;">대기 중</span><br>
          <span id="dash-summary" style="color:#2980b9; font-weight:bold;">데이터 로드 중...</span>
        </div>
        <div style="display:flex; gap:6px;">
          <button id="btn-resume" style="flex:1; padding:8px; background:#2980b9; color:white; border:none; border-radius:4px; font-weight:bold; cursor:pointer; font-size:12px;">▶ 시작 (이어서 열기)</button>
          <button id="btn-stop" style="flex:1; padding:8px; background:#c0392b; color:white; border:none; border-radius:4px; font-weight:bold; cursor:pointer; font-size:12px;">⏸ 중단 · 위치저장</button>
        </div>
      </div>

      <!-- 원격 인증 비밀번호 입력 영역 (추가됨) -->
      <div style="margin-bottom:10px; border:1px solid #f39c12; border-radius:6px; padding:8px; background:#fef9e7;">
        <div style="font-size:11px; font-weight:bold; color:#d35400; margin-bottom:4px;">🔐 원격 인증 비밀번호(한 시간에 한 번)</div>
        <div style="display:flex; gap:4px; align-items:center;">
          <input type="password" id="input-auth-pw" placeholder="인증 비밀번호 입력" style="flex:1; padding:5px; border:1px solid #ccc; border-radius:4px; font-size:11px;">
        </div>
      </div>

      <!-- 계정 파일 버튼 및 SID 직접 입력 영역 -->
      <div style="margin-bottom:10px; border:1px solid #ddd; border-radius:6px; padding:8px; background:#fafafa;">
        <div style="display:flex; gap:4px; margin-bottom:6px;">
          <button id="btn-load-acc" style="flex:1; padding:6px 4px; background:#ecf0f1; border:1px solid #bdc3c7; border-radius:4px; cursor:pointer; font-weight:bold; font-size:11px;">📁 계정(.txt)</button>
          <input type="file" id="file-acc" accept=".txt" style="display:none;">
          <button id="btn-reset-all" style="padding:6px 8px; background:#95a5a6; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; font-size:11px;">초기화</button>
        </div>
        <!-- SID 직접 입력란 -->
        <div style="display:flex; gap:4px; align-items:center;">
          <input type="text" id="input-quick-alb" placeholder="앨범 SID (또는 URL)" style="flex:1; padding:5px; border:1px solid #ccc; border-radius:4px; font-size:11px;">
          <input type="text" id="input-quick-son" placeholder="음원 SID (또는 URL)" style="flex:1; padding:5px; border:1px solid #ccc; border-radius:4px; font-size:11px;">
          <button id="btn-apply-sid" style="padding:5px 8px; background:#27ae60; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; font-size:11px;">SID 적용</button>
        </div>
      </div>

      <!-- 계정별 진행 현황 테이블 -->
      <div id="dash-table-wrap" style="max-height: 150px; overflow-y: auto; border:1px solid #ddd; display:block; margin-bottom:10px;">
        <table style="width:100%; border-collapse:collapse; font-size:11px; text-align:center;">
          <thead style="position: sticky; top: 0; background:#ecf0f1; z-index:2;">
            <tr>
              <th style="padding:5px; border:1px solid #ddd;">아이디</th>
              <th style="padding:5px; border:1px solid #ddd;">순서</th>
              <th style="padding:5px; border:1px solid #ddd;">앨범 좋아요</th>
              <th style="padding:5px; border:1px solid #ddd;">곡 좋아요</th>
              <th style="padding:5px; border:1px solid #ddd;">다운</th>
            </tr>
          </thead>
          <tbody id="dash-table-body">
            <tr><td colspan="5" style="padding:10px;">계정 파일을 불러오세요.</td></tr>
          </tbody>
        </table>
      </div>

      <!-- 실시간 성공/에러 로그 뷰어 및 .txt 다운로드 -->
      <div style="border:1px solid #ddd; border-radius:6px; padding:8px; background:#f8f9fa;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
          <b style="font-size:11px; color:#2c3e50;">📋 실시간 성공 / 에러 로그</b>
          <div style="display:flex; gap:4px;">
            <button id="btn-down-log" style="background:#2980b9; color:white; border:none; padding:3px 8px; border-radius:3px; cursor:pointer; font-size:11px; font-weight:bold;">💾 로그 .txt 저장</button>
            <button id="btn-clear-log" style="background:#7f8c8d; color:white; border:none; padding:3px 6px; border-radius:3px; cursor:pointer; font-size:11px;">지우기</button>
          </div>
        </div>
        <div id="dash-log-box" style="height:100px; overflow-y:auto; background:#1e272e; color:#d2dae2; padding:6px; border-radius:4px; font-family:Consolas, monospace; font-size:11px; line-height:1.4; white-space:pre-wrap; word-break:break-all;">로그 대기 중...</div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  const close=document.createElement('button'); close.textContent='닫기 ✕'; close.style.cssText='position:sticky;top:0;z-index:30;padding:12px;background:white;color:black;'; close.onclick=()=>panel.style.display='none'; panel.prepend(close);
  const manual = document.createElement('div');
  manual.style.cssText = 'padding:12px;background:#fff4d5;font-size:14px;';
  manual.textContent = 'Safari판: 결제와 다운로드는 직접 진행하세요. 데스크탑 화면 요청이 필요할 수 있습니다. 0KB는 완료가 아닙니다. '; 
  const done = document.createElement('button');
  done.textContent = '파일 저장·재생 확인 → 다음 진행';
  done.style.cssText = 'display:block;margin-top:8px;padding:12px;width:100%;';
  done.textContent='다운로드 결과 기록 → 다음 진행';
  done.onclick=async()=>{try{const choice=prompt('직접 확인한 결과 번호를 입력하세요: 1 시작 / 2 완료 / 3 실패');if(choice===null)return;await requestUserNext({'1':'started','2':'completed','3':'failed'}[choice]);}catch(error){alert(error.message);}};
  manual.appendChild(done);
  panel.insertBefore(manual,panel.children[1] || null);

  const header = document.getElementById('dash-header');
  let isDragging = false, offsetX = 0, offsetY = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target.id === 'btn-close-dash') return;
    isDragging = true;
    const rect = panel.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    panel.style.bottom = 'auto';
    panel.style.right = 'auto';
    panel.style.left = rect.left + 'px';
    panel.style.top = rect.top + 'px';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panel.style.left = (e.clientX - offsetX) + 'px';
    panel.style.top = (e.clientY - offsetY) + 'px';
  });

  document.addEventListener('mouseup', async () => {
    if (isDragging) {
      isDragging = false;
      await chrome.storage.local.set({ panelPos: { left: panel.style.left, top: panel.style.top } });
    }
  });

  document.getElementById('btn-close-dash').onclick = async () => {
    panel.style.display = 'none';
    await chrome.storage.local.set({ panelHidden: true });
  };

  async function handleAccountFile(file) {
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    
    // 탭, 쉼표, 스페이스바 공백을 모두 구분자로 처리
    const result = lines.map(l => {
      const p = l.split(/[\t, ]+/);
      return { id: p[0]?.trim(), pw: p[1]?.trim() };
    }).filter(a => a.id && a.pw);

    await chrome.storage.local.set({ accounts: result, accountResults: {} });
    await saveLog(`📁 계정 데이터 ${result.length}개 로드 완료`, 'SUCCESS');
    updateDashboardUI();
  }

  document.getElementById('btn-load-acc').onclick = () => document.getElementById('file-acc').click();
  document.getElementById('file-acc').onchange = (e) => {
    handleAccountFile(e.target.files[0]);
    e.target.value = '';
  };

  document.getElementById('btn-apply-sid').onclick = async () => {
    const albVal = extractId(document.getElementById('input-quick-alb').value, 'axnm');
    const sonVal = extractId(document.getElementById('input-quick-son').value, 'xgnm');
    const updates = {};
    if (albVal) updates.albums = [albVal];
    if (sonVal) updates.songs = [sonVal];

    if (Object.keys(updates).length === 0) {
      await saveLog('⚠️ 적용할 앨범 또는 음원 SID를 입력해주세요.', 'ERROR');
      return;
    }
    await chrome.storage.local.set(updates);
    await saveLog(`✅ SID 직접 적용 완료 (앨범: ${albVal || '유지'}, 곡: ${sonVal || '유지'})`, 'SUCCESS');
    updateDashboardUI();
  };

  document.getElementById('btn-resume').onclick = async () => {
    if(!remoteSettingsReady){alert('GitHub 공통 SID를 불러오지 못했습니다. 새로고침해 주세요.');return;}
    await GM.setValue('safariControllerOwner',safariTabToken());sessionStorage.setItem('genie-navigation-owner',safariTabToken());
    sessionStorage.setItem('genie-safari-controller', 'yes');
    // [중요] 1시간(3600000ms) 이내 인증 기록 확인
    const { lastAuthTime } = await chrome.storage.local.get(['lastAuthTime']);
    const now = Date.now();
    
    if (!lastAuthTime || (now - lastAuthTime) > 3600000) {
      const isAuthorized = await verifyRemotePassword();
      if (!isAuthorized) return; // 인증 실패 시 작동 중단
      await chrome.storage.local.set({ lastAuthTime: now }); // 성공 시간 저장
    } else {
      await saveLog("✅ 원격 비밀번호 인증 자동 통과 (1시간 이내)", "SUCCESS");
    }

    const data = await chrome.storage.local.get(['accounts', 'step', 'currentIndex', 'albumIndex', 'songIndex', 'albums', 'songs']);
    if (!data.accounts || data.accounts.length === 0) {
      await saveLog('⚠️ 계정 파일을 먼저 등록해주세요!', 'ERROR');
      return;
    }
    if (!data.songs || data.songs.length === 0) {
      await saveLog('⚠️ 다운로드할 곡(음원 SID)을 먼저 입력해주세요!', 'ERROR');
      return;
    }

    try { Promise.resolve(chrome.runtime.sendMessage({ action: 'REGISTER_MAIN_TAB' })).catch(() => {}); } catch (error) { console.warn(error); }

    const index=(data.currentIndex||0)<data.accounts.length?(data.currentIndex||0):0;
    await chrome.storage.local.set({currentIndex:index,isRunning:true});
    await beginConfirmedLogout(index);
  };

  document.getElementById('btn-stop').onclick = async () => {
    await chrome.storage.local.set({ isRunning: false });
    await saveLog('⏸ 작업 중단됨 (현재 위치 저장 완료)', 'ERROR');
    updateDashboardUI();
  };

  let resetConfirm = false;
  const resetBtn = document.getElementById('btn-reset-all');
  resetBtn.onclick = async () => {
    if (!resetConfirm) {
      resetConfirm = true;
      resetBtn.textContent = '정말 초기화?';
      resetBtn.style.background = '#e74c3c';
      setTimeout(() => {
        resetConfirm = false;
        if (resetBtn) {
          resetBtn.textContent = '초기화';
          resetBtn.style.background = '#95a5a6';
        }
      }, 3000);
      return;
    }
    resetConfirm = false;
    resetBtn.textContent = '초기화';
    resetBtn.style.background = '#95a5a6';
    await chrome.storage.local.clear();
    updateDashboardUI();
  };

  document.getElementById('btn-down-log').onclick = async () => {
    const data = await chrome.storage.local.get({ logs: [] });
    if (!data.logs || data.logs.length === 0) {
      await saveLog('⚠️ 저장할 로그 내역이 없습니다.', 'ERROR');
      return;
    }
    const blob = new Blob([data.logs.join('\n')], { type: 'text/plain;charset=utf-8' });
    const urlObj = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const a = document.createElement('a');
    a.href = urlObj;
    a.download = `genie_download_log_${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(urlObj);
  };

  document.getElementById('btn-clear-log').onclick = async () => {
    await chrome.storage.local.set({ logs: [] });
    updateDashboardUI();
  };

  document.getElementById('dash-table-body').addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-idx]');
    if (!tr) return;
    const idx = parseInt(tr.getAttribute('data-idx'), 10);
    if (isNaN(idx)) return;
    await chrome.storage.local.set({
      currentIndex: idx,
      step: 'CHECK_OR_LOGIN',
      albumIndex: 0,
      songIndex: 0,
      isRunning: false,
      waitRetry: 0
    });
    await saveLog(`📌 ${idx + 1}번 계정(${tr.children[0]?.textContent})으로 시작 위치 변경됨`, 'INFO');
    updateDashboardUI();
  });

  updateDashboardUI();
}

function renderMark(val) {
  if (val === 'o') return "<b style='color:#27ae60;'>o</b>";
  if (val === 'x') return "<b style='color:#e74c3c;'>x</b>";
  return "<span style='color:#95a5a6;'>-</span>";
}

async function updateDashboardUI() {
  const tbody = document.getElementById('dash-table-body');
  const summary = document.getElementById('dash-summary');
  const lastLog = document.getElementById('dash-last-log');
  const logBox = document.getElementById('dash-log-box');
  const quickAlb = document.getElementById('input-quick-alb');
  const quickSon = document.getElementById('input-quick-son');
  if (!tbody) return;

  const data = await chrome.storage.local.get([
    'accounts', 'albums', 'songs', 'currentIndex', 'albumIndex', 'songIndex', 'isRunning', 'step', 'lastActionText', 'logs', 'accountResults'
  ]);
  const accs = data.accounts || [];
  const cIdx = data.currentIndex || 0;
  const albLen = (data.albums || []).length;
  const sonLen = (data.songs || []).length;
  const results = data.accountResults || {};

  if (quickAlb && document.activeElement !== quickAlb && data.albums?.[0]) quickAlb.value = data.albums[0];
  if (quickSon && document.activeElement !== quickSon && data.songs?.[0]) quickSon.value = data.songs[0];

  lastLog.textContent = data.lastActionText || '대기 중';
  summary.textContent = `전체 ${accs.length}계정 | 완료 ${Math.min(cIdx, accs.length)} · 진행 ${data.isRunning ? 1 : 0} (앨범:${albLen}개, 곡:${sonLen}개)`;

  const logs = data.logs || [];
  if (logBox) {
    if (logs.length === 0) {
      logBox.innerHTML = '<span style="color:#888;">기록된 로그가 없습니다.</span>';
    } else {
      logBox.innerHTML = logs.map(line => {
        let color = '#d2dae2';
        if (line.includes('[SUCCESS]')) color = '#0be881';
        else if (line.includes('[ERROR]')) color = '#ff5e57';
        return `<div style="color:${color};">${escapeHtml(line)}</div>`;
      }).join('');
      logBox.scrollTop = logBox.scrollHeight;
    }
  }

  if (accs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:10px;">계정 파일을 불러오세요.</td></tr>`;
    return;
  }

  let rowsHtml = '';
  accs.forEach((acc, i) => {
    const res = results[acc.id] || { album: '-', song: '-', down: '-' };
    let albMark = res.album || '-';
    let sonMark = res.song || '-';
    let downMark = res.down || '-';

    if (i < cIdx) {
      if (albMark === '-') albMark = 'x';
      if (sonMark === '-') sonMark = 'x';
      if (downMark === '-') downMark = 'x';
    }

    const bg = i === cIdx ? '#ebf5fb' : (i < cIdx ? '#f9f9f9' : '#ffffff');
    rowsHtml += `
      <tr data-idx="${i}" style="background:${bg}; border-bottom:1px solid #eee; cursor:pointer;" title="클릭하면 이 계정부터 시작합니다">
        <td style="padding:4px; border:1px solid #ddd; font-weight:bold;">${escapeHtml(acc.id)}</td>
        <td style="padding:4px; border:1px solid #ddd;">${i + 1}</td>
        <td style="padding:4px; border:1px solid #ddd;">${renderMark(albMark)}</td>
        <td style="padding:4px; border:1px solid #ddd;">${renderMark(sonMark)}</td>
        <td style="padding:4px; border:1px solid #ddd;">${renderMark(downMark)}</td>
      </tr>
    `;
  });
  tbody.innerHTML = rowsHtml;

  const activeRow = tbody.children[cIdx];
  if (activeRow) {
    activeRow.scrollIntoView({ block: 'nearest' });
  }
}

try { chrome.storage.onChanged.addListener(updateDashboardUI); } catch (error) { genieShowError(error); }

try { chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "SHOW_REMOTE") {
    createFloatingPanel();
    const panel = document.getElementById('genie-helper-dashboard');
    if (panel) {
      panel.style.display = 'block';
      chrome.storage.local.set({ panelHidden: false });
    }
  }
}); } catch (error) { genieShowError(error); }

// =========================================================
// 2. 자동화 진행 로직
// =========================================================
function setInputValue(el, val) {
  if (!el) return;
  el.focus();
  el.value = val;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function performLikeWithCheck(onComplete){
 const data=await chrome.storage.local.get(['accounts','currentIndex']);const expected=data.accounts?.[data.currentIndex]?.id;
 if(!(await stillCurrent(expected)))return;
 const count=document.querySelector('#emLikeCount');const button=(count&&count.closest('a, button'))||document.querySelector('a.btn-like');
 if(!button){await onComplete(false,'좋아요 버튼 없음');return;}
 const before=button.classList.contains('on')||button.classList.contains('active')||button.parentElement?.classList.contains('on');
 if(!before)button.click();
 await new Promise(resolve=>setTimeout(resolve,before?200:1200));
 if(!(await stillCurrent(expected)))return;
 const after=button.classList.contains('on')||button.classList.contains('active')||button.parentElement?.classList.contains('on');
 await onComplete(!!after,before?'이미 좋아요 상태 확인':after?'좋아요 상태 변경 확인':'클릭 후 좋아요 상태 미확인');
}

let isStepRunning = false;
async function processTask(){
 if(window!==window.top||document.hidden)return;
 if(!navigator.locks){genieShowError(new Error('이 Safari에서는 중복 방지 잠금을 사용할 수 없습니다. iOS 업데이트가 필요합니다.'));return;}
 return navigator.locks.request('genie-account-worker',{ifAvailable:true},async lock=>{if(lock)await processTaskUnlocked();});
}


function safariIsPaymentContext(){
 return location.hostname==='pay.genie.co.kr' || /^\/(download|buy)\//i.test(location.pathname) || !!document.querySelector('#btnPaySong,#btnDownLoad,#name-genie');
}

async function processTaskUnlocked() {
  if(!remoteSettingsReady)return;
  // Popup tabs inherit sessionStorage from their opener; they must never run
  // login/album routing. Their next-account button has its own handler.
  if(safariIsPaymentContext()) {
    sessionStorage.removeItem('genie-safari-login-pending');
    sessionStorage.removeItem('genie-login-submitted');
    return;
  }
  if(/^\/detail\/(albumInfo|songInfo)/i.test(location.pathname)){
    sessionStorage.removeItem('genie-safari-login-pending');
    sessionStorage.removeItem('genie-login-submitted');
  }
  if (window !== window.top || sessionStorage.getItem('genie-safari-controller') !== 'yes') return;
  if (!(await safariOwnsController())) return;
  if (isStepRunning) return;
  isStepRunning = true;

  try {
    createFloatingPanel();

    const data = await chrome.storage.local.get([
      'accounts', 'currentIndex', 'albums', 'songs', 'albumIndex', 'songIndex', 'isRunning', 'step', 'waitRetry','pendingAccountIndex','logoutRequestedAt'
    ]);
    if (!data.isRunning || !data.accounts || data.accounts.length === 0) {
      isStepRunning = false;
      return;
    }

    const { accounts, currentIndex, albums, songs, albumIndex, songIndex, step } = data;
    if (currentIndex >= accounts.length) {
      await chrome.storage.local.set({ isRunning: false, step: 'IDLE' });
      await saveLog('✅ 모든 계정 작업 완료!', 'SUCCESS');
      isStepRunning = false;
      return;
    }

    const currentAccount = accounts[currentIndex];
    const currentUrl = window.location.href;

    if(['SONG_LIKE','SONG_DOWNLOAD','WAIT_DOWNLOAD_STREAM','PAY_POPUP_STEP1'].includes(step))sessionStorage.removeItem('genie-safari-login-pending');
    if(await handleLoginSequence(data))return;
    if(['ALBUM_LIKE','SONG_LIKE','SONG_DOWNLOAD','PAY_POPUP_STEP1','WAIT_DOWNLOAD_STREAM'].includes(step)&&!(await verifyCurrentAccount(data)))return;
    // 앨범 좋아요 단계
    if (step === 'ALBUM_LIKE') {
      if (albums && albumIndex < albums.length) {
        if (!currentUrl.includes('/detail/albumInfo') || !currentUrl.includes(albums[albumIndex])) {
          window.location.href = getUrl('album', albums[albumIndex]);
          isStepRunning = false;
          return;
        }
        await performLikeWithCheck(async (ok, msg) => {
          if(!(await stillCurrent(currentAccount.id)))return;
          await updateStepResult(currentAccount.id, 'album', ok ? 'o' : 'x');
          const nextIdx = albumIndex + 1;
          await saveLog(`💿 앨범(${albums[albumIndex]}) ${msg}`, ok ? 'SUCCESS' : 'ERROR');
          if (nextIdx < albums.length) {
            await chrome.storage.local.set({ albumIndex: nextIdx });
            window.location.href = getUrl('album', albums[nextIdx]);
          } else {
            const next = getNextStageUrl('SONG_LIKE', data);
            await chrome.storage.local.set({ albumIndex: nextIdx, step: next.step });
            window.location.href = next.url;
          }
          isStepRunning = false;
        });
        return;
      } else {
        const next = getNextStageUrl('SONG_LIKE', data);
        await chrome.storage.local.set({ step: next.step });
        window.location.href = next.url;
        isStepRunning = false;
        return;
      }
    }

    // 곡 좋아요 및 다운로드 단계
    if (step === 'SONG_LIKE') {
      if (songs && songIndex < songs.length) {
        const currentSongSid = songs[songIndex];
        if (!currentUrl.includes('/detail/songInfo') || !currentUrl.includes(currentSongSid)) {
          window.location.href = getUrl('song', currentSongSid);
          isStepRunning = false;
          return;
        }

        performLikeWithCheck(async (ok, msg) => {
          await updateStepResult(currentAccount.id, 'song', ok ? 'o' : 'x');
          await saveLog(`🎵 음원(${currentSongSid}) ${msg}`, ok ? 'SUCCESS' : 'ERROR');
          await chrome.storage.local.set({ step: 'SONG_DOWNLOAD', waitRetry: 0 });

          await saveLog('다운로드 수동 대기: 지니 다운로드 메뉴·결제·Safari 다운로드 승인을 직접 진행한 뒤, 다운로드 창의 다음 계정 진행 버튼을 눌러 주세요.','INFO');
          isStepRunning = false;
        });
        return;
      } else {
        const next = getNextStageUrl('NEXT_ACCOUNT_LOGIN', data);
        await chrome.storage.local.set({ step: next.step });
        window.location.href = next.url;
        isStepRunning = false;
        return;
      }
    }

    if (['SONG_DOWNLOAD', 'PAY_POPUP_STEP1', 'WAIT_DOWNLOAD_STREAM'].includes(step)) {
      // Wait indefinitely for explicit file verification.
      isStepRunning = false;
      return;
    }

    if (step === 'NEXT_ACCOUNT_LOGIN') {
      const firstStage = getNextStageUrl('ALBUM_LIKE', data);
      await chrome.storage.local.set({
        step: firstStage.step,
        albumIndex: 0,
        songIndex: 0,
        waitRetry: 0
      });
      window.location.href = "https://www.genie.co.kr/member/popLogin?page_rfr=" + encodeURIComponent(firstStage.url);
      isStepRunning = false;
      return;
    }
  } catch (err) {
    await saveLog(`❌ 오류 발생: ${err.message}`, 'ERROR');
  } finally {
    isStepRunning = false;
  }
}


function validateSharedSidConfig(value){
 if(!value || value.schema!==1)throw new Error('SID 설정 형식이 잘못되었습니다');
 const albumSid=String(value.albumSid||'').trim(),songSid=String(value.songSid||'').trim();
 if(!/^\d+$/.test(albumSid)||!/^\d+$/.test(songSid))throw new Error('앨범 SID와 곡 SID는 숫자여야 합니다');
 return {albumSid,songSid};
}
async function applySharedSidConfig(){
 const raw=await new Promise((resolve,reject)=>GM.xmlHttpRequest({method:'GET',url:'https://hse0722-debug.github.io/genie-safari/sid-config.json?refresh='+Date.now()+'-'+Math.random(),timeout:12000,headers:{'Cache-Control':'no-cache'},onload:r=>r.status===200?resolve(r.responseText):reject(new Error('SID 설정 HTTP '+r.status)),onerror:()=>reject(new Error('SID 설정 연결 실패')),ontimeout:()=>reject(new Error('SID 설정 응답 시간 초과'))}));
 const settings=validateSharedSidConfig(JSON.parse(raw));
 const saved=await chrome.storage.local.get(['albums','songs']);
 const changed=JSON.stringify(saved.albums)!==JSON.stringify([settings.albumSid])||JSON.stringify(saved.songs)!==JSON.stringify([settings.songSid]);
 const updates={albums:[settings.albumSid],songs:[settings.songSid],sharedSidConfig:settings};
 if(changed)Object.assign(updates,{isRunning:false,step:'IDLE',currentIndex:0,albumIndex:0,songIndex:0,waitRetry:0,accountResults:{}});
 await chrome.storage.local.set(updates);
 if(changed){
  await GM.deleteValue('safariDownloadApproval');
  sessionStorage.removeItem('genie-safari-login-pending');
  sessionStorage.removeItem('genie-login-submitted');
  await saveLog('공통 SID 변경 적용: 앨범 '+settings.albumSid+' / 곡 '+settings.songSid+' · 진행 위치 초기화, 시작 버튼을 눌러 주세요.','INFO');
 }
 remoteSettingsReady=true;
}

try { await applySharedSidConfig(); } catch(error) {
 await chrome.storage.local.set({isRunning:false});
 genieShowError(error);
}
createFloatingPanel().catch(genieShowError);
setInterval(processTask, 1000);
})();

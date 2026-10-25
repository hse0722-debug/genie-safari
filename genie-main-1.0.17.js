(async () => {
'use strict';
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

// Restore the controller after an explicit post-login promotion redirect.
(async()=>{ if(location.hostname === 'www.genie.co.kr') {
 const resume=await GM.getValue('safariPromotionResume',null);
 const current=await chrome.storage.local.get(['isRunning','currentIndex']);
 if(resume && current.isRunning && resume.index===current.currentIndex && Date.now()-resume.time<120000) {
  await GM.deleteValue('safariPromotionResume');
  await GM.setValue('safariControllerOwner',safariTabToken());
  sessionStorage.setItem('genie-safari-controller','yes');
 }
}
})();
let promotionHandled=false;
setInterval(async()=>{
 if(promotionHandled || window!==window.top || location.hostname!=='pay.genie.co.kr') return;
 const later=Array.from(document.querySelectorAll('a,button,input[type="button"]')).find(el=>/나중에\s*보기/.test(el.textContent||el.value||'') && el.getClientRects().length);
 const body=document.body?.innerText||'';
 if(!later || !/시크릿\s*할인|12개월/.test(body))return;
 const state=await chrome.storage.local.get(['isRunning','accounts','currentIndex','albums']);
 if(!state.isRunning || !state.accounts?.[state.currentIndex] || !state.albums?.length)return;
 promotionHandled=true;
 try{
  await chrome.storage.local.set({step:'ALBUM_LIKE',albumIndex:0,songIndex:0,waitRetry:0});
  await GM.setValue('safariPromotionResume',{index:state.currentIndex,time:Date.now()});
  await saveLog('로그인 후 이용권 할인 안내를 건너뛰고 앨범으로 이동합니다.','INFO');
  later.click();
  setTimeout(()=>location.replace(getUrl('album',state.albums[0])),800);
 }catch(error){promotionHandled=false;console.error(error);}
},500);



// Supply the active song directly to the download page; do not depend on an
// opener tab that iOS may suspend. The page bridge validates its own readiness.
if(location.hostname==='www.genie.co.kr'&&/^\/download\//.test(location.pathname)){
 let initBusy=false;
 setInterval(async()=>{
  if(initBusy || document.documentElement.getAttribute('data-genie-init-accepted')==='yes')return;
  initBusy=true;
  try{
   const d=await chrome.storage.local.get(['isRunning','step','songs','songIndex']);
   if(!d.isRunning||!['SONG_DOWNLOAD','PAY_POPUP_STEP1','WAIT_DOWNLOAD_STREAM'].includes(d.step))return;
   const id=String(d.songs?.[d.songIndex||0]||'');if(!/^\d+$/.test(id))return;
   window.dispatchEvent(new CustomEvent('GENIE_INIT_DOWNLOAD',{detail:{ids:id+'^'}}));
  }catch(error){console.error(error);}finally{initBusy=false;}
 },700);
}

let safariPaymentBusy=false;
let safariPaymentContext=null;
const safariPaymentVisible=el=>!!el && el.getClientRects().length>0 && getComputedStyle(el).visibility!=='hidden' && !el.disabled;
async function safariPaymentTick(){
 if(safariPaymentBusy || location.hostname!=='www.genie.co.kr' || !/^\/download\//i.test(location.pathname)) return;
 safariPaymentBusy=true;
 try{
  const state=await chrome.storage.local.get(['isRunning','step','currentIndex','songIndex','accounts']);
  if(!state.isRunning || !['SONG_DOWNLOAD','PAY_POPUP_STEP1','WAIT_DOWNLOAD_STREAM'].includes(state.step))return;
  let readyIds=[];
  try{readyIds=JSON.parse(document.documentElement.getAttribute('data-genie-download-ready')||'[]');}catch(_){}
  const songData=await chrome.storage.local.get(['songs']);
  const expected=String(songData.songs?.[state.songIndex||0]||'');
  if(!expected || !readyIds.map(String).includes(expected))return;
  const context=String(state.currentIndex)+':'+String(state.songIndex||0);
  if(safariPaymentContext===null)safariPaymentContext=context;
  if(safariPaymentContext!==context)return; // Old popup must never purchase for a later account.
  const visible=selector=>Array.from(document.querySelectorAll(selector)).find(safariPaymentVisible);
  const once=async(el,key,message)=>{
   if(!el||el.dataset.genieSafariDone)return false;
   el.dataset.genieSafariDone=key;
   await saveLog(message+' (자동 클릭 시도)','INFO');
   el.click();return true;
  };
  // Native browser prompts and CAPTCHA are left for the user.
  const captcha=visible('input[name*="captcha" i],input[id*="captcha" i]');
  if(captcha && !captcha.value)return;
  const cash=visible('#name-genie');
  const finalPay=visible('a[onclick*="fnCashPay("]');
  if(finalPay){
   if(finalPay.dataset.genieSafariDone)return;
   for(const checkbox of [cash,visible('#name-agree'),visible('#name-payment')]){
    if(checkbox&&!checkbox.checked){checkbox.click();checkbox.dispatchEvent(new Event('change',{bubbles:true}));}
   }
   const checks=[cash,visible('#name-agree'),visible('#name-payment')].filter(Boolean);
   if(checks.some(el=>!el.checked))return;
   await chrome.storage.local.set({step:'WAIT_DOWNLOAD_STREAM',waitRetry:0});
   await once(finalPay,'pay','지니캐시·약관·결제 동의 확인 → 최종 결제하기');
   return;
  }
  const buy=visible('#btnPaySong');
  if(buy){await chrome.storage.local.set({step:'PAY_POPUP_STEP1',waitRetry:0});await once(buy,'buy','개별 곡 결제하기');return;}
  const option=visible('a[onclick*="fnDownloadOption("]');
  if(option){
   const oneClick=visible('#down_type_1');
   if(oneClick&&!oneClick.checked)oneClick.click();
   await once(option,'option','원클릭 다운로드 방식 선택');return;
  }
  const onlyConfirm=visible('a[onclick*="fnCheckOnlyDown("]');
  if(onlyConfirm){await once(onlyConfirm,'onlyConfirm','차감된 곡 다운로드 확인');return;}
  const download=visible('#btnDownLoad a[onclick*="fnCallDownLoad("]');
  if(download){await once(download,'download','결제 이후 다운로드 요청 → Safari 승인 대기');return;}
  const deducted=visible('#btnDownSong a[onclick*="fnCheckOnlyDownLayer("]');
  if(deducted){await once(deducted,'deducted','이미 차감된 곡 다운로드 진행');return;}
 }catch(error){console.error('[지니 Safari 결제]',error);}
 finally{safariPaymentBusy=false;}
}
setInterval(safariPaymentTick,700);


function safariTabToken(){let id=sessionStorage.getItem('genie-safari-tab-id');if(!id){id=Date.now()+':'+Math.random();sessionStorage.setItem('genie-safari-tab-id',id);}return id;}
async function safariOwnsController(){const owner=await GM.getValue('safariControllerOwner',null);return !owner||owner===safariTabToken();}

let approvalBusy = false;
async function consumeDownloadApproval() {
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
  await saveLog('사용자가 다운로드 승인을 확인했습니다. 3초 대기 후 다음 진행 (파일 완료는 미검증).','INFO');
  const nextSong=(data.songIndex||0)+1;
  if(nextSong<(data.songs||[]).length){
   await chrome.storage.local.set({songIndex:nextSong,step:'SONG_LIKE',waitRetry:0});
   location.href=getUrl('song',data.songs[nextSong]);
  }else{
   const next=(data.currentIndex||0)+1;
   await chrome.storage.local.set({currentIndex:next,albumIndex:0,songIndex:0,waitRetry:0,step:next>=data.accounts.length?'IDLE':'NEXT_ACCOUNT_LOGIN',isRunning:next<data.accounts.length});
   location.href='https://www.genie.co.kr/member/logout?page_rfr='+encodeURIComponent('https://www.genie.co.kr/');
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
    await GM.setValue('safariControllerOwner',safariTabToken());
    sessionStorage.setItem('genie-safari-controller','yes');
    await GM.setValue('safariDownloadApproval',{account:d.currentIndex,song:d.songIndex||0,due:Date.now()+3000});
    let left=3;status.textContent='3초 후 다음 진행';
    const timer=setInterval(()=>{left--;status.textContent=left>0?left+'초 후 다음 진행':'다음 단계로 이동 중…';if(left<=0){clearInterval(timer);consumeDownloadApproval();try{window.opener?.postMessage('GENIE_APPROVAL_READY','https://www.genie.co.kr');window.opener?.focus();}catch(_){}}},1000);
   }catch(error){status.textContent='오류: '+error.message;button.disabled=false;}
  };
  box.append(status,button);document.documentElement.appendChild(box);
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
  const entry = `[${now}] [${type}] (${accId}) ${text}`;
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
  done.onclick = async () => {
    done.disabled = true;
    try {
      const d = await chrome.storage.local.get(['isRunning','step','accounts','currentIndex','songs','songIndex']);
      if (sessionStorage.getItem('genie-safari-controller') !== 'yes') { alert('자동화를 시작했던 원래 탭에서 확인해 주세요.'); return; }
      if (!d.isRunning || !['SONG_DOWNLOAD','PAY_POPUP_STEP1','WAIT_DOWNLOAD_STREAM'].includes(d.step)) { alert('다운로드 대기 상태가 아닙니다.'); return; }
      if (!confirm('현재 계정의 파일이 0KB가 아니고 실제로 재생되는 것을 확인했나요?')) return;
      const account = d.accounts?.[d.currentIndex];
      if (!account) return;
      await updateStepResult(account.id,'down','o');
      await saveLog('사용자가 파일 저장 및 재생 완료를 확인했습니다.','SUCCESS');
      const nextSong = (d.songIndex || 0)+1;
      if(nextSong < (d.songs || []).length) {
        await chrome.storage.local.set({songIndex:nextSong,step:'SONG_LIKE',waitRetry:0});
        location.href=getUrl('song',d.songs[nextSong]);
      } else {
        const next = (d.currentIndex || 0)+1;
        await chrome.storage.local.set({currentIndex:next,albumIndex:0,songIndex:0,waitRetry:0,step:next>=d.accounts.length?'IDLE':'NEXT_ACCOUNT_LOGIN',isRunning:next<d.accounts.length});
        location.href='https://www.genie.co.kr/member/logout?page_rfr='+encodeURIComponent('https://www.genie.co.kr/');
      }
    } catch(error) { genieShowError(error); } finally { done.disabled=false; }
  };
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
    await GM.setValue('safariControllerOwner',safariTabToken());
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

    const step = (data.step && data.step !== 'IDLE') ? data.step : 'CHECK_OR_LOGIN';
    const cIdx = data.currentIndex || 0;
    const albIdx = data.albumIndex || 0;
    const sIdx = data.songIndex || 0;

    await chrome.storage.local.set({
      isRunning: true,
      step,
      currentIndex: cIdx,
      albumIndex: albIdx,
      songIndex: sIdx,
      waitRetry: 0
    });

    await saveLog(`▶ 자동화 작업 시작 (${cIdx + 1}번 계정: ${data.accounts[cIdx]?.id})`, 'INFO');

    const firstStage = getNextStageUrl('ALBUM_LIKE', data);
    let targetUrl = "https://www.genie.co.kr/member/popLogin?page_rfr=" + encodeURIComponent(firstStage.url);

    if (step === 'ALBUM_LIKE' && data.albums?.length) {
      targetUrl = getUrl('album', data.albums[albIdx] || data.albums[0]);
    } else if ((step === 'SONG_LIKE' || step === 'SONG_DOWNLOAD') && data.songs?.length) {
      targetUrl = getUrl('song', data.songs[sIdx] || data.songs[0]);
    }

    window.location.href = targetUrl;
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

function performLikeWithCheck(onComplete) {
  const countEl = document.querySelector('#emLikeCount');
  const likeBtn =
    (countEl && countEl.closest('a, button')) ||
    document.querySelector('a.btn-like') ||
    document.querySelector('a[onclick*="like"]');

  if (likeBtn) {
    const isAlreadyLiked =
      likeBtn.classList.contains('on') ||
      likeBtn.classList.contains('active') ||
      (likeBtn.parentElement && likeBtn.parentElement.classList.contains('on'));

    if (isAlreadyLiked) {
      // 딜레이 0.3초 증가
      setTimeout(() => onComplete(true, '이미 좋아요 상태(스킵)'), 700);
    } else {
      likeBtn.click();
      // 딜레이 0.3초 증가
      setTimeout(() => onComplete(true, '좋아요 클릭 성공'), 1200);
    }
  } else {
    // 딜레이 0.3초 증가
    setTimeout(() => onComplete(false, '좋아요 버튼 없음'), 700);
  }
}

let isStepRunning = false;

async function processTask() {
  if (window !== window.top || sessionStorage.getItem('genie-safari-controller') !== 'yes') return;
  if (!(await safariOwnsController())) return;
  if (isStepRunning) return;
  isStepRunning = true;

  try {
    createFloatingPanel();

    const data = await chrome.storage.local.get([
      'accounts', 'currentIndex', 'albums', 'songs', 'albumIndex', 'songIndex', 'isRunning', 'step', 'waitRetry'
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

    const pendingText=sessionStorage.getItem('genie-safari-login-pending');
    if(pendingText){
      let pending;try{pending=JSON.parse(pendingText);}catch(_){sessionStorage.removeItem('genie-safari-login-pending');}
      if(pending && pending.account===currentAccount.id){
        const visibleLogin=Array.from(document.querySelectorAll('input[type="password"]')).some(el=>el.offsetParent!==null);
        const blocked=/본인 인증을 완료|본인인증이 필요|인증번호를 입력|보안문자를 입력|비밀번호가 일치하지|아이디 또는 비밀번호/.test(document.body?.innerText||'');
        if(!visibleLogin&&!blocked&&(location.origin+location.pathname!==pending.page||isUserLoggedIn())){
          sessionStorage.removeItem('genie-safari-login-pending');
          sessionStorage.removeItem('genie-login-submitted');
          const next=getNextStageUrl('ALBUM_LIKE',{...data,albumIndex:0});
          await chrome.storage.local.set({step:next.step,albumIndex:0,songIndex:0,waitRetry:0});
          await saveLog('로그인 후 안내 화면을 건너뛰고 등록한 앨범으로 이동합니다.','INFO');
          location.replace(next.url);isStepRunning=false;return;
        }
      }else if(pending)sessionStorage.removeItem('genie-safari-login-pending');
    }
    // 비밀번호 변경 캠페인(myInfoPwdChangeMsg) 추가 
    if (currentUrl.includes('popLoginSuccess') || currentUrl.toLowerCase().includes('loginsuccess') || currentUrl.includes('myInfoPwdChangeMsg')) {
      const next = getNextStageUrl('ALBUM_LIKE', data);
      await chrome.storage.local.set({ step: next.step, waitRetry: 0 });
      window.location.replace(next.url);
      isStepRunning = false;
      return;
    }

    const idInput =
      document.querySelector('#gnb_uxd') ||
      document.querySelector('#gnb_uxd_id') ||
      document.querySelector('#uxd_id') ||
      document.querySelector('input[name="gnb_uxd"]');
    const pwInput =
      document.querySelector('#gnb_uxx') ||
      document.querySelector('#gnb_uxd_pw') ||
      document.querySelector('#uxd_pw') ||
      document.querySelector('input[name="gnb_uxx"]');

    if (currentUrl.includes('/member/popLogin') || currentUrl.includes('/member/login') || (idInput && pwInput && idInput.offsetParent !== null)) {
      const attemptText=sessionStorage.getItem('genie-login-submitted');
      let submitted;try{submitted=JSON.parse(attemptText||'null');}catch(_){}
      if (submitted?.account===currentAccount.id && Date.now()-submitted.time>=1500 && genieLoginPageError()) {
        sessionStorage.removeItem('genie-login-submitted');
        sessionStorage.removeItem('genie-safari-login-pending');
        await saveLog(`❌ ${currentAccount.id} - 로그인 응답 오류 확인 후 다음 계정`, 'ERROR');
        await updateStepResult(currentAccount.id, 'album', 'x');
        await updateStepResult(currentAccount.id, 'song', 'x');
        await updateStepResult(currentAccount.id, 'down', 'x');
        const nextStage = getNextStageUrl('ALBUM_LIKE', data);
        await chrome.storage.local.set({
          currentIndex: currentIndex + 1,
          step: 'CHECK_OR_LOGIN',
          albumIndex: 0,
          songIndex: 0
        });
        window.location.href = "https://www.genie.co.kr/member/popLogin?page_rfr=" + encodeURIComponent(nextStage.url);
        isStepRunning = false;
        return;
      }

      if (idInput && pwInput) {
        if(submitted?.account===currentAccount.id && Date.now()-submitted.time<8000){isStepRunning=false;return;}
        setInputValue(idInput, currentAccount.id);
        setInputValue(pwInput, currentAccount.pw);

        const nextStage = getNextStageUrl('ALBUM_LIKE', data);
        if (!step || step === 'CHECK_OR_LOGIN' || step === 'IDLE' || step === 'NEXT_ACCOUNT_LOGIN') {
          await chrome.storage.local.set({
            step: nextStage.step,
            albumIndex: 0,
            songIndex: 0,
            waitRetry: 0
          });
        }

        await saveLog(`🔑 로그인 시도 중 (${currentAccount.id})`, 'INFO');

        sessionStorage.setItem('genie-safari-login-pending',JSON.stringify({account:currentAccount.id,page:location.origin+location.pathname}));
        // 딜레이 0.3초 증가 (600 -> 900)
        setTimeout(() => {
          const loginBtn =
            document.querySelector('input.btn-submit[value="로그인"]') ||
            document.querySelector('input.btn-submit') ||
            document.querySelector('input[type="submit"]') ||
            document.querySelector('button[type="submit"]') ||
            document.querySelector('.btn-login');
          sessionStorage.setItem('genie-login-submitted',JSON.stringify({account:currentAccount.id,time:Date.now()}));
          if (loginBtn) loginBtn.click();
          else callPageFunction('loginID');
        }, 900);
        isStepRunning = false;
        return;
      }
    }

    if (window !== window.top) {
      isStepRunning = false;
      return;
    }

    if (step === 'CHECK_OR_LOGIN') {
      if (isUserLoggedIn()) {
        const next = getNextStageUrl('ALBUM_LIKE', data);
        await chrome.storage.local.set({ step: next.step, waitRetry: 0 });
        window.location.href = next.url;
        isStepRunning = false;
        return;
      }

      const genieLoginBtn = document.querySelector('a.btn-login[onclick*="loginPopup"]');
      const openLayerBtn = Array.from(document.querySelectorAll('button.btn, a.btn')).find(el =>
        el.textContent.includes('로그인/회원가입')
      );

      if (genieLoginBtn && genieLoginBtn.offsetParent !== null) {
        genieLoginBtn.click();
        callPageFunction('loginPopup');
      } else if (openLayerBtn) {
        openLayerBtn.click();
        // 딜레이 0.3초 증가 (400 -> 700)
        setTimeout(() => {
          const gBtn = document.querySelector('a.btn-login[onclick*="loginPopup"]');
          if (gBtn) gBtn.click();
          callPageFunction('loginPopup');
        }, 700);
      } else {
        const next = getNextStageUrl('ALBUM_LIKE', data);
        window.location.href = "https://www.genie.co.kr/member/popLogin?page_rfr=" + encodeURIComponent(next.url);
      }
      isStepRunning = false;
      return;
    }

    // 앨범 좋아요 단계
    if (step === 'ALBUM_LIKE') {
      if (albums && albumIndex < albums.length) {
        if (!currentUrl.includes('/detail/albumInfo') || !currentUrl.includes(albums[albumIndex])) {
          window.location.href = getUrl('album', albums[albumIndex]);
          isStepRunning = false;
          return;
        }
        performLikeWithCheck(async (ok, msg) => {
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

          const downloadBox = document.querySelector('.song-button-zone .toggle-button-box');
          const menuToggle = downloadBox?.querySelector('a.more');
          if(menuToggle){
            const menu=downloadBox.querySelector('.list');
            if(!menu || !menu.getClientRects().length || getComputedStyle(menu).display==='none'){
              menuToggle.click();
              await saveLog('다운로드 1단계: 메뉴 펼치기','INFO');
              await new Promise(resolve=>setTimeout(resolve,400));
            }
          }
          const downloadLink = downloadBox?.querySelector('.list a[onclick*="fnDownSong("]') || document.querySelector('a[onclick*="fnDownSong("]');
          if (downloadLink) {
            const token = Date.now() + ':' + currentAccount.id + ':' + currentSongSid;
            await GM.setValue('safariPopupRequest', {token,time:Date.now()});
            downloadLink.click();
            await saveLog('곡 다운로드 항목 클릭 → 결제 창 열기 시도','INFO');
            setTimeout(async()=>{
              const opened=await GM.getValue('safariPopupOpened',null);
              if(opened?.token===token) await saveLog('다운로드 창 열림 확인 · 결제 및 Safari 다운로드 승인을 진행해 주세요.','INFO');
              else await saveLog('다운로드 창이 아직 확인되지 않았습니다. Safari 새 창 차단 여부를 확인하고 곡 다운로드 버튼을 직접 눌러 주세요.','INFO');
            },5000);
          } else {
            await saveLog('곡 다운로드 항목을 찾지 못했습니다. 페이지의 다운로드 메뉴를 직접 눌러 주세요.','ERROR');
          }
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

createFloatingPanel().catch(genieShowError);
setInterval(processTask, 1000);
})();

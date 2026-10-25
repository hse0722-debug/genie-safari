(()=>{
// Login helpers only. Download, payment and native window.open are untouched.
window.addEventListener('GENIE_CALL_PAGE_FN',event=>{
 const d=event.detail||{};
 if(['loginID','loginPopup'].includes(d.fnName)&&typeof window[d.fnName]==='function')window[d.fnName](...(d.args||[]));
});
})();
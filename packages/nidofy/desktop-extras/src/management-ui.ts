/** Shared theme for authenticated management documents.
 * @returns Document-local theme and focus styles.
 */
export function managementUi(): string {
  return `<style data-management-theme>
:root{color-scheme:light dark;--bg:#f9fafb;--card:#fff;--fg:#0f1115;--muted:#61666b;--line:#d9dce0;--accent:#315fc4;--soft:#f1f3f5;--danger:#bd3030}
@media(prefers-color-scheme:dark){:root{--bg:#1b1b1c;--card:#242426;--fg:#f9fafb;--muted:#b9bec4;--line:#4a4b50;--accent:#91acff;--soft:#353638;--danger:#ff9e9e}}
html body{background:var(--bg);color:var(--fg)}body main,body section{color:var(--fg)}body header,body section,body dialog{background:var(--card);border-color:var(--line)}body .muted,body p,body small,body label,body summary{color:var(--muted)}body h1,body h2,body h3,body label{font-weight:500}body a{color:var(--accent)}body input,body select,body textarea,body button{background:var(--card);color:var(--fg);border-color:var(--line)}body pre,body #status,body .metric{background:var(--soft);color:var(--fg)}body th,body td{border-color:var(--line)}body button:focus-visible,body a:focus-visible,body input:focus-visible,body select:focus-visible,body textarea:focus-visible,body summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}body button.primary,body #save,body nav button.active,body nav button[aria-selected=true]{background:var(--fg);color:var(--card);border-color:var(--fg)}body dialog{color:var(--fg);border:.5px solid var(--line);border-radius:16px;max-width:min(440px,calc(100vw - 32px));padding:24px}dialog::backdrop{background:#0006}dialog footer{display:flex;gap:12px;justify-content:flex-end;margin-top:20px}.management-back{display:inline-block;margin-bottom:16px}body pre{max-height:320px;overflow:auto}body details{margin-block:12px}body [hidden]{display:none!important}
</style>`
}

/** Explicit default-cancel confirmation, shared by the management documents.
 * @param chinese - Whether the document uses Chinese.
 * @returns Script declaring a document-local async confirmation function.
 */
export function managementConfirm(chinese: boolean): string {
  const copy = chinese ? { title: '确认操作', cancel: '取消', confirm: '确认' } : { title: 'Confirm action', cancel: 'Cancel', confirm: 'Confirm' }
  return `const nidofyConfirm=(()=>{let pending=false;const copy=${JSON.stringify(copy)};return message=>{if(pending)return Promise.resolve(false);pending=true;return new Promise(resolve=>{const dialog=document.createElement('dialog'),title=document.createElement('h2'),text=document.createElement('p'),footer=document.createElement('footer'),cancel=document.createElement('button'),confirm=document.createElement('button');title.textContent=copy.title;text.textContent=message;cancel.textContent=copy.cancel;confirm.textContent=copy.confirm;cancel.autofocus=true;dialog.setAttribute('aria-label',copy.title);const finish=value=>{dialog.close();dialog.remove();pending=false;resolve(value)};cancel.onclick=()=>finish(false);confirm.onclick=()=>finish(true);dialog.oncancel=event=>{event.preventDefault();finish(false)};footer.append(cancel,confirm);dialog.append(title,text,footer);document.body.append(dialog);dialog.showModal();cancel.focus()})}})();`
}

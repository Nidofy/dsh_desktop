// Keep the failure UI independent of sprite, manifest and animation module initialization.
import('./pet-runtime.js').then(module=>module.start()).catch(async()=>{
 const box=document.createElement('section');box.setAttribute('role','alert');box.style.cssText='position:fixed;inset:8px;padding:16px;background:Canvas;color:CanvasText;border:1px solid GrayText;border-radius:12px;font:14px/1.5 system-ui;z-index:100';
 const text=document.createElement('p');text.textContent='桌宠资源未能加载，请重试。';const retry=document.createElement('button');retry.textContent='重新加载';retry.onclick=()=>location.reload();box.append(text,retry);document.body.replaceChildren(box);
 await window.nidofyPet.invoke('pet_action',{action:'hit-test',target:{interactive:true}}).catch(()=>{});
 await window.nidofyPet.invoke('pet_ready',{decoded:false,degraded:true}).catch(()=>{});
});

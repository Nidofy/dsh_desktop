'use strict';
let pendingEngineChange=false;
window.confirmEngineChange=label=>new Promise((resolve,reject)=>{
 if(pendingEngineChange){reject(Error('请先完成当前待应用操作'));return;}pendingEngineChange=true;
 const d=document.createElement('dialog');d.className='switch-dialog';
 const title=document.createElement('h2');title.textContent=label;
 const status=document.createElement('p');status.setAttribute('role','status');
 const note=document.createElement('p');note.textContent='当前引擎不支持冻结所有新任务。等待后请再次确认停止并应用；切换期间不要发送新任务。';
 const actions=document.createElement('div');actions.className='actions';let ticket=null,busy=false,timer,closed=false;
 const button=(text,click)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=click;actions.append(b);return b;};
 const finish=(value,error)=>{if(closed)return;closed=true;pendingEngineChange=false;clearInterval(timer);d.close();d.remove();error?reject(Error('已取消待应用操作')):resolve(value);};
 const check=async(action='status')=>{if(busy||closed)return;busy=true;apply.disabled=true;
  try{const v=await window.__TAURI__.core.invoke('engine_control',{action});if(closed)return;ticket=v.ticket;
   status.textContent=v.known?`运行 ${v.running} · 排队 ${v.queued} · 等待审批 ${v.waiting} · 工程操作 ${v.actions} · 验证任务 ${v.checks??0}`:'无法确认全部任务状态。';
   if(action==='cancel')status.textContent+=' 已请求取消，等待原生终止确认。';
   apply.textContent=v.known&&!v.running&&!v.queued&&!v.waiting&&!v.actions&&!v.checks?'确认停止并应用':'强制停止并应用';apply.disabled=false;
  }catch(e){status.textContent=String(e);ticket=null;}finally{busy=false;}
 };
 button('任务结束后应用',()=>{status.textContent='待应用，正在等待任务结束…';clearInterval(timer);timer=setInterval(()=>check(),1500);void check();});
 button('取消全部任务后检查',()=>check('cancel'));
 button('刷新状态',()=>check());
 const apply=button('强制停止并应用',()=>{if(ticket&&!busy)finish(ticket);});apply.disabled=true;
 button('取消待应用',()=>finish(null,true));d.oncancel=e=>{e.preventDefault();finish(null,true);};
 d.append(title,status,note,actions);document.body.append(d);d.showModal();void check();
});

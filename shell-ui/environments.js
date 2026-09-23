'use strict';
(()=>{const invoke=window.__TAURI__.core.invoke,$=id=>document.getElementById(id);let busy=false;
 async function run(action){if(busy)return;busy=true;try{
  if(action==='delete'&&!confirm('删除所选候选环境及其检查点？此操作不删除正式环境或工程文件。'))return;
  const result=await invoke('desktop_environments',{action,id:$('environment-select').value||null});
  if(action==='list'){$('environment-current').textContent=result.current==='stable'?'当前：正式环境':`当前：候选环境 ${result.current}`;$('environment-select').replaceChildren(...result.entries.map(e=>new Option(e.id,e.id)));if(result.current!=='stable'){$('environment-banner').hidden=false;$('environment-banner').textContent='候选环境 · 独立数据与凭据 · 默认空工程';}}
  else{$('environment-result').textContent=action==='checkpoint'?'检查点已保存，未挂载原工程路径。':action==='create'?`已创建 ${result.id}`:'操作完成';}
 }catch(e){$('environment-result').textContent=String(e);}finally{busy=false;}if(action==='create'||action==='delete')void run('list');}
 for(const action of ['list','create','launch','open','delete','checkpoint'])$('environment-'+action).onclick=()=>run(action);void run('list');
})();

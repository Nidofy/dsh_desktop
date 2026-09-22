window.__ModuleLoader__.load({id:'dsh-desktop-environment',factory:require=>{
const React=require('react'),h=React.createElement;
const css=`
[data-desktop-environment-space]>:last-child{margin-right:352px!important}
.denv-root{position:absolute;inset:0;pointer-events:none!important;color:var(--dsw-alias-label-primary);font:14px var(--dsw-font-family)}
.denv-root button,.denv-root input,.denv-root textarea,.denv-root select{font:inherit;color:inherit}
.denv-trigger{position:absolute;top:12px;pointer-events:auto;border:0;border-radius:9px;background:var(--dsw-alias-button-tool-bar-fill);width:34px;height:34px;display:grid;place-items:center;cursor:pointer}
.denv-header-trigger{border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);width:30px;height:30px;display:grid;place-items:center;cursor:pointer}.denv-header-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.denv-card{position:absolute;top:88px;width:320px;max-height:calc(100% - 108px);pointer-events:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:24px;background:var(--dsw-alias-bg-layer-2);padding:14px 12px;box-sizing:border-box;box-shadow:0 4px 16px #0001;overflow:auto}
.denv-card button,.denv-popup button{border:0;background:transparent;cursor:pointer}
.denv-card button:disabled,.denv-popup button:disabled{cursor:default;color:var(--dsw-alias-label-tertiary)}
.denv-section{display:flex;align-items:center;gap:8px;padding:6px 10px;color:var(--dsw-alias-label-secondary)}
.denv-section>button:first-child{flex:1;text-align:left;padding:4px 0;font-weight:500}
.denv-iconbutton{display:grid;place-items:center;width:28px;height:28px;border-radius:7px;padding:4px}
.denv-row{display:flex;align-items:center;gap:12px;min-height:40px;width:100%;text-align:left;padding:8px 10px;border-radius:10px;box-sizing:border-box}
.denv-row>span:nth-child(2){flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.denv-row:hover:not(:disabled),.denv-iconbutton:hover,.denv-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.denv-row svg,.denv-trigger svg,.denv-section svg{flex-shrink:0}
.denv-added{color:var(--dsw-alias-state-success-primary)}.denv-deleted{color:var(--dsw-alias-state-error-primary)}
.denv-rule{height:1px;background:var(--dsw-alias-border-l2);margin:12px 10px}
.denv-popup{position:absolute;pointer-events:auto;width:310px;max-height:calc(100% - 100px);overflow:auto;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:20px;background:var(--dsw-alias-bg-layer-2);padding:16px;box-shadow:0 12px 40px #0003}
.denv-popup h3{font-size:15px;margin:0 0 14px}.denv-popup p{font-size:13px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.denv-popup input,.denv-popup textarea,.denv-popup select{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:10px;margin-bottom:10px}.denv-popup pre{white-space:pre-wrap;word-break:break-word;font:12px monospace;max-height:300px;overflow:auto}
.denv-popup .denv-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary);border-radius:9px;padding:9px 13px;margin-top:8px}
.denv-actions{display:flex;justify-content:flex-end;gap:8px}.denv-message{padding:0 10px;font-size:12px;overflow-wrap:anywhere}.denv-small{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.denv-root button:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}
`;
const paths={panel:'M4 4h16v16H4z M14 4v16',changes:'M7 3h10v3h3v15H4V6h3z M9 12h6 M12 9v6',local:'M4 4h16v12H4z M2 20h20 M8 16v4 M16 16v4',branch:'M6 5v14 M6 8c0 4 12 1 12-5 M4 3h4v4H4z M4 17h4v4H4z M16 2h4v4h-4z',commit:'M2 12h6 M16 12h6 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',pull:'M6 5v14 M18 19V8q0-3-5-3 M11 3l-2 2 2 2',compare:'M7 3v18 M17 21V3 M3 7l4-4 4 4 M13 17l4 4 4-4',file:'M6 2h8l4 4v16H6z M14 2v5h4 M9 11h6 M9 15h6',plus:'M12 4v16 M4 12h16',chevron:'M6 9l6 6 6-6',arrow:'M6 18L18 6 M7 6h11v11',check:'M4 12l5 5L20 6',close:'M5 5l14 14 M19 5L5 19',refresh:'M20 7V3l-3 3a8 8 0 1 0 3 9 M20 3h-5'};
const Icon=({name,size=19})=>h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:paths[name]||paths.file}));
return {inject:['sessions','slots','remote','remote.settings'],apply(ctx){
 let enabled=false,settingsRevision=0,settingsReady=false;const listeners=new Set();
 let ui={header:false,open:false,wide:false};const uiListeners=new Set();
 const uiSubscribe=fn=>{uiListeners.add(fn);return()=>uiListeners.delete(fn);};
 const updateUi=patch=>{const next={...ui,...patch};if(Object.keys(next).every(key=>next[key]===ui[key]))return;ui=next;for(const fn of uiListeners)fn();};
 const publish=value=>{enabled=value;settingsReady=true;for(const fn of listeners)fn();};
 const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
 const refreshPreference=async()=>{try{const result=await ctx.remote.settings.describe();const item=result.ok&&result.value.namespaces.find(n=>n.ns==='desktop-environment');if(item){settingsRevision=item.revision;publish(item.value.enabled);}}catch{}};
 refreshPreference();
 function useEnabled(){return React.useSyncExternalStore(subscribe,()=>enabled);}
 function HeaderEntry(){const active=useEnabled(),state=React.useSyncExternalStore(uiSubscribe,()=>ui);React.useLayoutEffect(()=>{updateUi({header:true});return()=>updateUi({header:false});},[]);return active?h('button',{className:'denv-header-trigger',type:'button','aria-label':'环境信息','aria-expanded':state.open,disabled:!state.wide,title:state.wide?'环境信息':'放大窗口后打开环境信息',onClick:()=>window.dispatchEvent(new Event('desktop-environment-toggle'))},h(Icon,{name:'panel'})):null;}
 async function request(route,sessionId,body,signal){const response=await fetch('/desktop-diagnostics/api/desktop/'+route+(body?'':'?session='+encodeURIComponent(sessionId||'')),body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,sessionId}),signal}:{signal});const data=await response.json();if(!response.ok)throw Error(data.error||'读取失败，请刷新后重试');return data;}
 const navigate=(view,sessionId)=>request('open',sessionId,{view});
 function PluginCard(){const active=useEnabled(),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');return h('li',{style:{listStyle:'none',border:'1px solid var(--dsw-alias-border-l4)',borderRadius:16,padding:20}},h('h3',{style:{margin:'0 0 12px'}},'工作区环境'),h('p',null,'在工作区右上角按需查看变更、分支和来源。'),h('label',null,h('input',{type:'checkbox',checked:active,disabled:busy,onChange:async e=>{setBusy(true);setError('');try{const result=await ctx.remote.settings.update('desktop-environment',{enabled:e.target.checked},settingsRevision);if(!result.ok)throw Error('设置已改变，请重新打开后重试');settingsRevision=result.value.revision;publish(result.value.value.enabled);}catch(error){setError(error.message);}finally{setBusy(false);}}}),' 启用工作区环境插件'),h('p',{role:'status'},error));}
 function Environment({sessionId,onClose,right}){
  const [info,setInfo]=React.useState(null),[repo,setRepo]=React.useState(null),[message,setMessage]=React.useState(''),[expanded,setExpanded]=React.useState(true),[sources,setSources]=React.useState(false),[menu,setMenu]=React.useState(null),[search,setSearch]=React.useState(''),[branch,setBranch]=React.useState(''),[commit,setCommit]=React.useState(''),[remote,setRemote]=React.useState(''),[preview,setPreview]=React.useState(null),[busy,setBusy]=React.useState(false),[comparison,setComparison]=React.useState(null),[revision,setRevision]=React.useState(0);
  const root=React.useRef(null),popup=React.useRef(null),alive=React.useRef(true);
  React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  React.useEffect(()=>{setMenu(null);setPreview(null);setInfo(null);setRepo(null);setMessage('');},[sessionId]);
  React.useEffect(()=>{const abort=new AbortController();const load=async()=>{try{const value=await request('context',sessionId,null,abort.signal);if(abort.signal.aborted)return;setInfo(value);if(value.repository){try{const data=await request('repository',sessionId,null,abort.signal);if(!abort.signal.aborted){setRepo(data);setRemote(old=>data.remotes?.includes(old)?old:data.remotes?.[0]||'');}}catch{if(!abort.signal.aborted)setRepo(null);}}}catch(error){if(!abort.signal.aborted)setMessage(error.message);}};load();const timer=setInterval(()=>{if(!document.hidden)load();},30000);return()=>{abort.abort();clearInterval(timer);};},[sessionId,revision]);
  React.useEffect(()=>{const key=e=>{if(e.key==='Escape'){if(menu){setMenu(null);setPreview(null);}else onClose();}};const outside=e=>{if(menu&&!root.current?.contains(e.target)&&!popup.current?.contains(e.target)){setMenu(null);setPreview(null);}};window.addEventListener('keydown',key);document.addEventListener('pointerdown',outside);return()=>{window.removeEventListener('keydown',key);document.removeEventListener('pointerdown',outside);};},[menu,onClose]);
  const act=async fn=>{setBusy(true);setMessage('');try{await fn();}catch(error){if(alive.current)setMessage(error.message);}finally{if(alive.current)setBusy(false);}};
  const selectMenu=value=>{setMenu(old=>old===value?null:value);setPreview(null);setComparison(null);setSearch('');setMessage('');};
  const row=(icon,label,onClick,tail,disabled=false,title)=>h('button',{className:'denv-row',type:'button',onClick,disabled:busy||disabled,title},h(Icon,{name:icon}),h('span',null,label),tail);
  const propose=(action,extra={})=>act(async()=>setPreview(await request('preview',sessionId,{action,...extra})));
  const diff=repo?.diff;const files=info?.workspaceFiles||[];
  const sourceCount=files.length+(info?1:0);
  return h(React.Fragment,null,
   h('section',{ref:root,className:'denv-card',style:{right},'aria-label':'环境信息浮窗'},
    h('div',{className:'denv-section'},h('button',{type:'button','aria-expanded':expanded,onClick:()=>setExpanded(!expanded)},'环境信息',!expanded?h('span',{className:'denv-small'},' ›'):null),h('button',{className:'denv-iconbutton',type:'button','aria-label':'工作区工具',onClick:()=>selectMenu('tools')},h(Icon,{name:'plus'}))),
    expanded?h('div',null,
     row('changes','变更',()=>act(()=>navigate('changes',sessionId)),diff?h('span',null,h('span',{className:'denv-added'},'+'+diff.added),' ',h('span',{className:'denv-deleted'},'-'+diff.deleted)):h('span',{className:'denv-small'},info?.repository?.changedFiles!=null?info.repository.changedFiles+' 文件':'—'),!info?.repository,diff?'已跟踪文件的行数变化；未跟踪文件见变更列表':undefined),
     row('local','本地',()=>selectMenu('local'),h(Icon,{name:'chevron',size:16})),
     row('branch',repo?.branch||info?.repository?.branch||'未检测到仓库',()=>selectMenu('branches'),h(Icon,{name:'chevron',size:16}),!repo?.canWrite,info?.repository?.vcs==='hg'?'Hg 分支与变更通过变更页查看':undefined),
     row('commit','提交或推送',()=>selectMenu('commit'),null,!repo?.canWrite),
     row('pull','未关联 Pull Request',null,null,true),
     row('compare','比较分支',()=>selectMenu('compare'),h(Icon,{name:'arrow',size:16}),!repo?.head)
    ):null,
    h('div',{className:'denv-rule'}),
    h('div',{className:'denv-section'},h('button',{type:'button','aria-expanded':sources,onClick:()=>setSources(!sources)},'来源 · '+sourceCount+' '+(sources?'⌄':'›')),h('button',{type:'button',className:'denv-iconbutton','aria-label':'展开来源',onClick:()=>setSources(!sources)},h(Icon,{name:'plus'}))),
    sources?h('div',null,row('local',info?.configurationSource||'连接配置',()=>act(()=>navigate('settings',sessionId))),...files.map(name=>h('div',{key:name,className:'denv-row',title:info.workspace+'\\'+name},h(Icon,{name:'file'}),h('span',null,name)))):null,
    message?h('p',{className:'denv-message',role:'status'},message):null),
   menu?h('section',{ref:popup,className:'denv-popup',style:{right:right+336,top:menu==='branches'||menu==='compare'?150:80},role:'dialog','aria-label':{branches:'分支',compare:'比较分支',commit:'提交或推送',local:'本地环境',tools:'工作区工具'}[menu]},
    h('div',{className:'denv-section',style:{padding:0,marginBottom:10}},h('strong',{style:{flex:1}}, {branches:'分支',compare:'比较分支',commit:'提交或推送',local:'本地',tools:'工作区工具'}[menu]),h('button',{className:'denv-iconbutton','aria-label':'关闭菜单',onClick:()=>setMenu(null)},h(Icon,{name:'close',size:16}))),
    preview?h('div',null,h('p',null,preview.description),h('p',{className:'denv-small'},preview.workspace),h('div',{className:'denv-actions'},h('button',{onClick:()=>setPreview(null),disabled:busy},'返回'),h('button',{className:'denv-primary',disabled:busy,onClick:()=>act(async()=>{const result=await request('apply',sessionId,{token:preview.token});if(!alive.current)return;setPreview(null);setMenu(null);setMessage(result.description+'：完成');setRevision(value=>value+1);})},busy?'执行中…':'确认'))):
    menu==='branches'||menu==='compare'?h('div',null,
     h('input',{'aria-label':'搜索分支',placeholder:'搜索分支',value:search,onChange:e=>setSearch(e.target.value)}),
     h('div',{style:{maxHeight:240,overflow:'auto'}},...(repo?.branches||[]).filter(name=>name.toLowerCase().includes(search.toLowerCase())).map(name=>h('div',{key:name},row('branch',name,()=>menu==='branches'?propose('switch',{branch:name}):act(async()=>{const response=await fetch('/desktop-diagnostics/api/desktop/compare?session='+encodeURIComponent(sessionId)+'&branch='+encodeURIComponent(name));const value=await response.json();if(!response.ok)throw Error(value.error);setComparison(value);}),name===repo?.branch?h(Icon,{name:'check',size:16}):null,menu==='branches'&&name===repo?.branch)))),
     menu==='branches'?h('div',null,h('div',{className:'denv-rule'}),h('input',{'aria-label':'新分支名称',placeholder:'新分支名称',value:branch,onChange:e=>setBranch(e.target.value)}),row('plus','创建并检出新分支…',()=>propose('create',{branch}),null,!branch)):null,
     comparison?h('div',null,h('p',null,comparison.branch+' → '+repo.branch),h('pre',null,comparison.patch||'没有差异'),comparison.truncated?h('p',null,'差异较大，仅显示前 200 KB'):null):null
    ):menu==='commit'?h('div',null,h('label',null,'提交说明',h('textarea',{'aria-label':'提交说明',value:commit,onChange:e=>setCommit(e.target.value),rows:3})),h('button',{className:'denv-primary',disabled:busy||!commit.trim(),onClick:()=>propose('commit',{message:commit})},'提交已暂存更改'),h('div',{className:'denv-rule'}),h('label',null,'远程',h('select',{'aria-label':'远程',value:remote,onChange:e=>setRemote(e.target.value)},...(repo?.remotes||[]).map(name=>h('option',{key:name,value:name},name)))),h('button',{className:'denv-primary',disabled:busy||!remote,onClick:()=>propose('push',{remote})},'推送当前分支')):
    menu==='local'?h('div',null,h('p',null,info?.workspace||'未选择工程'),h('p',null,(info?.environment?.platform||'')+' · Node '+(info?.environment?.node||'')),h('p',null,'当前连接：'+(info?.connection||'—')),h('p',null,info?.api),...Object.entries(info?.environment?.variables||{}).map(([key,value])=>h('p',{key},key+': '+value)),row('local','连接与模型',()=>act(()=>navigate('settings',sessionId)))):
    h('div',null,...[['actions','构建与测试'],['artifacts','文件与产物'],['snapshots','文件快照'],['diagnostics','会话诊断'],['cache','缓存验证'],['recovery','任务状态'],['self-test','环境自检'],['compare','任务比较']].map(([view,label])=>h('div',{key:view},row('file',label,()=>act(()=>navigate(view,sessionId))))),row('refresh','刷新环境',()=>{setRevision(value=>value+1);setMenu(null);})),
    message?h('p',{role:'status'},message):null):null);
 }
 function Root({usePanelInfo}){
  const interfaceState=React.useSyncExternalStore(uiSubscribe,()=>ui);
  const active=useEnabled(),session=React.useSyncExternalStore(React.useCallback(fn=>ctx.sessions.list.subscribe(fn),[]),()=>ctx.sessions.list.getSnapshot()).current;
  const main=usePanelInfo?.(value=>value.activePanelId),[open,setOpen]=React.useState(false),[geometry,setGeometry]=React.useState({right:16,wide:false}),root=React.useRef(null);
  const visible=active&&!main;
  React.useEffect(()=>{updateUi({open:open&&visible,wide:geometry.wide});},[open,visible,geometry.wide,session]);
  React.useEffect(()=>{const toggle=()=>setOpen(value=>!value);window.addEventListener('desktop-environment-toggle',toggle);return()=>window.removeEventListener('desktop-environment-toggle',toggle);},[]);
  React.useLayoutEffect(()=>{
   const frame=root.current?.closest('[data-shell-overlay]')?.parentElement;
   const center=frame?.querySelector(':scope > [data-rightbar-col]')?.previousElementSibling;
   if(!frame||!center)return;
   const measure=()=>{const outer=frame.getBoundingClientRect(),rect=center.getBoundingClientRect();const wide=rect.width>=980&&outer.height>=560;setGeometry(old=>old.right===Math.max(16,outer.right-rect.right+16)&&old.wide===wide?old:{right:Math.max(16,outer.right-rect.right+16),wide});if(!wide)setOpen(false);};
   const observer=new ResizeObserver(measure);observer.observe(frame);observer.observe(center);measure();return()=>observer.disconnect();
  },[]);
  React.useLayoutEffect(()=>{const center=root.current?.closest('[data-shell-overlay]')?.parentElement?.querySelector(':scope > [data-rightbar-col]')?.previousElementSibling;const conversation=center?.querySelector('[data-phase]');if(!conversation)return;if(open&&visible&&geometry.wide)conversation.setAttribute('data-desktop-environment-space','');else conversation.removeAttribute('data-desktop-environment-space');return()=>conversation.removeAttribute('data-desktop-environment-space');},[open,visible,geometry.wide,session]);
  React.useEffect(()=>{if(!active)setOpen(false);},[active]);
  React.useEffect(()=>{window.addEventListener('focus',refreshPreference);return()=>window.removeEventListener('focus',refreshPreference);},[]);
  return h('div',{ref:root,className:'denv-root'},h('style',null,css),visible&&!interfaceState.header?h('button',{className:'denv-trigger',style:{right:geometry.right+44},type:'button','aria-label':'环境信息','aria-expanded':open,disabled:!geometry.wide,title:geometry.wide?'环境信息':'放大窗口后打开环境信息',onClick:()=>setOpen(value=>!value)},h(Icon,{name:'panel'})):null,
    visible&&open&&geometry.wide?h(Environment,{key:session||'empty',sessionId:session,right:geometry.right,onClose:()=>setOpen(false)}):null);
 }
 ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'desktop-environment-card',order:10},Root));
 ctx.slots.inject('conversation.session.header.utilities',()=>ctx.slots.register({name:'conversation.session.header.utilities',id:'desktop-environment-toggle',order:20},HeaderEntry));
 ctx.slots.inject('settings.plugin.item',()=>ctx.slots.register({name:'settings.plugin.item',key:'desktop-environment'},PluginCard));
}};
}});

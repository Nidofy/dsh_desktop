window.__ModuleLoader__.load({id:'dsh-desktop-client',factory:require=>{
const React=require?.('react');

function installWorkspaceUi(ctx) {
  const h=React.createElement;
  const style={padding:20,fontFamily:'var(--dsw-font-family)',color:'var(--dsw-alias-label-primary)',overflowWrap:'anywhere'};
  const buttonStyle={font:'inherit',padding:'8px 12px',border:'1px solid var(--dsw-alias-border-l2)',borderRadius:8,background:'var(--dsw-alias-bg-base)',color:'var(--dsw-alias-label-primary)',cursor:'pointer'};
  async function open(view,sessionId){
    const response=await fetch('/desktop-diagnostics/api/desktop/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({view,...(sessionId?{sessionId}:{})}),signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error('打开失败，请刷新后重试。');
  }
  function SettingsEntry(){const [error,setError]=React.useState('');return h('div',null,h('button',{type:'button',style:buttonStyle,onClick:()=>open('settings').catch(e=>setError(e.message))},'连接与模型'),error?h('span',{role:'status'},error):null);}
  function ManagedProvider({provider}){const [managed,setManaged]=React.useState(null);React.useEffect(()=>{let active=true;fetch('/desktop-diagnostics/api/desktop/context').then(r=>r.ok?r.json():{}).then(info=>{if(active)setManaged(info.managedProvider);}).catch(()=>{});return ()=>{active=false;};},[]);return provider?.provider===managed?h('div',{style:{marginTop:12}},h('p',null,'此提供方使用当前桌面连接。地址、协议、凭据和模型列表在连接设置中修改。'),h(SettingsEntry)):null;}
  function VisionCard(){
    const [form,setForm]=React.useState(null),[revision,setRevision]=React.useState(0),[key,setKey]=React.useState(''),[configured,setConfigured]=React.useState(false),[busy,setBusy]=React.useState(false),[message,setMessage]=React.useState('');
    const id=React.useId();
    React.useEffect(()=>{let alive=true;(async()=>{
      const result=await ctx.remote.settings.describe();
      if(!result.ok)throw Error();
      const item=result.value.namespaces.find(n=>n.ns==='desktop-vision');if(!item)throw Error();
      const credentials=await ctx.remote.credentials.describe([item.value.apiKeyEnv]);
      if(alive){setForm(item.value);setRevision(item.revision);setConfigured(credentials.ok&&credentials.value[item.value.apiKeyEnv]?.configured===true);}
    })().catch(error=>{if(alive)setMessage('无法读取识图设置，请重新打开设置。');});return()=>{alive=false;};},[]);
    const edit=(field,value)=>setForm(old=>({...old,[field]:value}));
    async function save(event){event.preventDefault();setBusy(true);setMessage('');try{
      // Settings revision is checked before a key replacement, so stale forms cannot rotate a credential.
      const result=await ctx.remote.settings.update('desktop-vision',{...form,maxTokens:Number(form.maxTokens),timeoutMs:Number(form.timeoutMs)},revision);
      if(!result.ok)throw Error('保存失败，配置可能已在其他窗口改变。请重新打开后再试。');
      setRevision(result.value.revision);setForm(result.value.value);
      if(key){const saved=await ctx.remote.credentials.set(form.apiKeyEnv,key);if(!saved.ok)throw Error('配置已保存，API Key 保存失败，请重试。');setKey('');setConfigured(true);}
      setMessage('已保存');
    }catch(error){setMessage(error.message);}finally{setBusy(false);}}
    const field=(name,label,type='text')=>h('label',{key:name,htmlFor:id+name,style:{display:'grid',gap:6}},label,h('input',{id:id+name,type,value:form[name],disabled:busy,style:buttonStyle,onChange:e=>edit(name,e.target.value)}));
    return h('li',{style:{listStyle:'none',border:'1px solid var(--dsw-alias-border-l4)',borderRadius:16,padding:16}},h('details',null,
      h('summary',{style:{cursor:'pointer',fontSize:15,fontWeight:600}},'识图'),
      h('p',{style:{color:'var(--dsw-alias-label-tertiary)'}},'通过独立模型分析截图和图片。图片与提问会发送到此服务。'),
      form?h('form',{onSubmit:save,style:{display:'grid',gap:14}},
        h('label',null,h('input',{type:'checkbox',checked:form.enabled,disabled:busy,onChange:e=>edit('enabled',e.target.checked)}),' 启用识图'),
        h('label',{htmlFor:id+'api'},'API 格式',h('select',{id:id+'api',value:form.api,disabled:busy,style:{...buttonStyle,width:'100%',marginTop:6},onChange:e=>edit('api',e.target.value)},h('option',{value:'openai-completions'},'OpenAI 兼容'),h('option',{value:'anthropic-messages'},'Anthropic 兼容'))),
        field('baseURL','Base URL（例如 https://gateway.example/v1）'),field('model','模型 ID'),
        h('label',{htmlFor:id+'key',style:{display:'grid',gap:6}},'API Key'+(configured?' · 已配置，留空保留':''),h('input',{id:id+'key',type:'password',autoComplete:'off',value:key,disabled:busy,style:buttonStyle,onChange:e=>setKey(e.target.value)})),
        field('maxTokens','最大输出 Token','number'),field('timeoutMs','超时（毫秒）','number'),
        h('button',{type:'submit',disabled:busy,style:buttonStyle},busy?'正在保存…':'保存')):null,
      h('p',{role:'status'},message)));
  }
  ctx.slots.inject('settings.action',()=>ctx.slots.register({name:'settings.action',id:'desktop-connections',order:10},SettingsEntry));
  ctx.slots.inject('settings.plugin.item',()=>ctx.slots.register({name:'settings.plugin.item',key:'desktop-vision'},VisionCard));
  ctx.slots.inject('settings.models.footer',()=>ctx.slots.register({name:'settings.models.footer',id:'desktop-connections',order:-10},SettingsEntry));
  ctx.slots.inject('settings.models.provider-card',()=>ctx.slots.register({name:'settings.models.provider-card',key:'llm-pi-ai'},ManagedProvider));
}
return ({

  inject:['uiWorkspace','sessions','conversation','slots','sidebarRight','sidebarRightTabs','remote','remote.settings','remote.credentials'],
  apply(ctx) {
    if(React && ctx.slots)installWorkspaceUi(ctx);
    const channel=new BroadcastChannel('dsh-desktop-navigation');
    let disposed=false,sequence=0;
    const open=async(data)=>{
      if(data?.type!=='open-session'||typeof data.requestId!=='string'||data.requestId.length>128||typeof data.sessionId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(data.sessionId))return;
      const current=++sequence;
      try {
        const response=await fetch('/desktop-diagnostics/api/recovery/session?id='+encodeURIComponent(data.sessionId));
        if(!response.ok)throw Error('Unavailable');
        if(disposed||current!==sequence)return;
        ctx.uiWorkspace.openSession(data.sessionId);
        await fetch('/desktop-diagnostics/api/recovery/focus',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
        if(!disposed)channel.postMessage({type:'opened',requestId:data.requestId});
      } catch {if(!disposed)channel.postMessage({type:'failed',requestId:data.requestId});}
    };
    const clientId=crypto.randomUUID();
    const post=(route,body)=>fetch('/desktop-diagnostics/api/changes/draft/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    const append=async(data)=>{
      if(data?.type!=='insert-diff'||typeof data.ticket!=='string'||!/^[a-f0-9-]{36}$/.test(data.ticket))return;
      const current=++sequence,deadline=Date.now()+10000;let claimed=false,status='REFUSED';
      try{
        const response=await post('claim',{ticket:data.ticket,clientId});if(!response.ok)return;
        const value=await response.json();claimed=true;
        if(disposed||current!==sequence||Date.now()>deadline)return;
        await ctx.sessions.refresh();
        if(disposed||current!==sequence||Date.now()>deadline)return;
        if(!ctx.sessions.list.getSnapshot().ids.includes(value.sessionId))return;
        const actx=ctx.sessions.scope(value.sessionId);if(!actx)return;
        const input=ctx.conversation.input.for(actx),state=input.state.getSnapshot();
        if(state.phase!=='plain'||ctx.conversation.blocks.storeFor(value.sessionId).getSnapshot())return;
        if(typeof value.text!=='string'||value.text.length>70000||state.draft.length+value.text.length>262144)return;
        // Native detect coordinates represent each reference chip by one U+FFFC.
        // Only append at the end; do not flatten chips or replace attachments.
        let end=state.draft.length;
        for(const chip of state.occurrences){if(!Number.isSafeInteger(chip.length)||chip.length<1)return;end-=chip.length-1;}
        if(end<0)return;
        const applied=actx.bail('slash/input-insert-text',{text:(state.draft?'\n\n':'')+value.text,span:{start:end,end,draftRev:state.draftRev}});
        if(applied!==true)return;
        status='APPENDED';
        ctx.uiWorkspace.openSession(value.sessionId);
        input.notify('info','已追加选中差异，尚未发送。请审阅后手动发送。');
        await fetch('/desktop-diagnostics/api/recovery/focus',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      }catch{}finally{if(claimed)try{await post('settle',{ticket:data.ticket,clientId,status});}catch{}}
    };
    channel.onmessage=({data})=>data?.type==='insert-diff'?append(data):open(data);
    const nativeOpen=event=>open({...event.detail,type:'open-session'});
    window.addEventListener('dsh-desktop-open-session',nativeOpen);
    ctx.effect(()=>()=>{disposed=true;channel.close();window.removeEventListener('dsh-desktop-open-session',nativeOpen);});
  }
});}});

export const recoveryHtml=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSHDesktop · 任务状态与恢复</title><link rel="stylesheet" href="/desktop-diagnostics/theme.css"><style>main{max-width:1100px;margin:auto;padding:28px}header,.actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}header{justify-content:space-between}section{padding:18px;margin:16px 0;border:1px solid var(--dsw-alias-border-l2);border-radius:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere}h2{font-size:18px}#notice{min-height:24px}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.fact{padding:8px 0}.fact small{display:block}button,a.button{padding:8px 12px;text-decoration:none}code{user-select:all}</style><script src="/desktop-diagnostics/theme.js" defer></script><script src="/desktop-diagnostics/recovery.js" defer></script></head><body><main><header><h1>任务状态与恢复</h1><div class="actions"><a class="button" href="/desktop-diagnostics">会话诊断</a><button id="refresh">刷新状态</button></div></header><p>查看工作区会话的运行状态。打开会话只定位主界面，不会自动发送「继续」、重复工具调用或恢复文件。</p><p>中断时间无法精确推断，下方显示最后确认记录的时间。待确认调用可能已产生副作用，请先检查工程再继续。</p><section><label><input id="notifications" type="checkbox" disabled> 后台任务系统提醒</label><p>完成、失败或等待你处理时提醒；DSH 在前台时抑制弹出。通知仅显示状态，不显示工程名、路径或内容。Windows 的勿扰模式和企业策略可能抑制提醒。</p><p id="notification-notice" role="status"></p></section><p id="notice" role="status"></p><div id="sessions"></div><div class="actions"><button id="previous">上一页</button><span id="page"></span><button id="next">下一页</button></div></main></body></html>`;
export const recoveryScript=String.raw`
'use strict';
const $=id=>document.getElementById(id),channel=new BroadcastChannel('dsh-desktop-navigation');
let offset=0,next=null,busy=false,pending;
const status={IDLE:'尚未开始',RUNNING:'进行中',COMPLETED:'已结束',CANCELLED:'已取消',BLOCKED:'等待处理',FAILED:'失败',LIMIT_REACHED:'达到输出限制',INTERRUPTED:'运行中断',UNKNOWN:'未知',WAITING_PERMISSION:'等待权限确认',WAITING_INPUT:'等待用户输入',UNCONFIRMED:'尚未确认',NO_MESSAGE:'未形成模型消息',PENDING:'待完成'};
const label=value=>status[value]??value;
function time(value){return Number.isFinite(value)?new Date(value).toLocaleString():'未知';}
function element(tag,text){const e=document.createElement(tag);e.textContent=text;return e;}
async function load(){
 if(busy)return;busy=true;$('refresh').disabled=true;$('notice').textContent='正在读取原生会话记录…';
 try {
  const response=await fetch('/desktop-diagnostics/api/recovery/list?offset='+offset);const data=await response.json();if(!response.ok)throw Error(data.error);
  next=data.nextOffset;$('previous').disabled=offset===0;$('next').disabled=next===null;$('page').textContent='第 '+(Math.floor(offset/20)+1)+' 页 · '+data.total+' 个会话';
  $('sessions').replaceChildren(...data.items.map(row=>{
    const section=document.createElement('section');section.append(element('h2',row.title||'会话 '+row.sessionId.slice(0,12)));
    section.append(element('p',row.workspace??'无工作区'),element('code',row.sessionId));
    const facts=element('div','');facts.className='facts';
    for(const [name,value] of [['任务状态',label(row.status)],['最后确认记录',time(row.updatedAt)],['最后模型输出',row.lastModel?label(row.lastModel.status):'无记录'],['最后工具结果',row.lastTool?row.lastTool.name+' · '+label(row.lastTool.status):'无记录']]){const fact=element('div','');fact.className='fact';fact.append(element('small',name),element('strong',value));facts.append(fact);}section.append(facts);
    if(row.error)section.append(element('p',row.error));
    if(row.coverage==='PARTIAL')section.append(element('p','并行调用超过摘要容量；请到原会话核对完整轨迹。'));
    if(row.caution)section.append(element('p',row.caution));
    if(row.unconfirmedTools?.length)section.append(element('pre',row.unconfirmedTools.map(t=>t.name+' · '+label(t.status)+' · '+time(t.time)).join('\n')));
    const actions=element('div','');actions.className='actions';const open=element('button','打开原会话');open.onclick=()=>{
      if(pending)clearTimeout(pending.timer);
      const requestId=crypto.randomUUID();pending={requestId,timer:setTimeout(()=>{if(pending?.requestId===requestId){$('notice').textContent='主界面尚未响应，请打开 DSH 主窗口后重试。';pending=null;}},8000)};
      $('notice').textContent='正在主界面定位会话…';channel.postMessage({type:'open-session',sessionId:row.sessionId,requestId});
    };actions.append(open);
    if(row.workspace){for(const [path,label] of [['actions','查看项目操作'],['changes','查看工作区变化'],['artifacts','查看交付文件']]){const link=element('a',label);link.className='button';link.href='/desktop-diagnostics/'+path+'?workspace='+encodeURIComponent(row.workspace)+(path==='artifacts'?'&session='+encodeURIComponent(row.sessionId):'');actions.append(link);}}section.append(actions);return section;
  }));$('notice').textContent=data.items.length?'状态已更新。打开会话后，请由你决定下一步操作。':'当前连接暂无会话。';
 }catch(error){$('notice').textContent=error.message??'读取失败';}
 finally{busy=false;$('refresh').disabled=false;}
}
channel.onmessage=({data})=>{if(!pending||data?.requestId!==pending.requestId||!['opened','failed'].includes(data.type))return;clearTimeout(pending.timer);pending=null;$('notice').textContent=data.type==='opened'?'已在主界面打开原会话，没有自动发送内容。':'原会话暂时无法打开，请刷新后重试。';};
async function notifications(){
 try{const r=await fetch('/desktop-diagnostics/api/recovery/notifications');if(!r.ok)throw Error();const value=await r.json();$('notifications').checked=value.enabled;$('notifications').disabled=false;$('notification-notice').textContent=value.warning||'偏好只作用于当前连接。';}catch{$('notification-notice').textContent='通知偏好暂时不可读取。';}
}
$('notifications').onchange=async()=>{
 const enabled=$('notifications').checked;$('notifications').disabled=true;
 try{const r=await fetch('/desktop-diagnostics/api/recovery/notifications',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled})});if(!r.ok)throw Error();$('notification-notice').textContent=enabled?'系统提醒已开启。':'系统提醒已关闭。';}catch{$('notifications').checked=!enabled;$('notification-notice').textContent='保存失败，通知偏好未改变。';}finally{$('notifications').disabled=false;}
};
notifications();
$('refresh').onclick=load;$('previous').onclick=()=>{if(!busy){offset=Math.max(0,offset-20);load();}};$('next').onclick=()=>{if(!busy&&next!==null){offset=next;load();}};
load();
`;

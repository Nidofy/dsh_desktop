// Private supervisor pipe. No network route, chat content, paths or credentials.
import {recoveryKey} from './task-recovery.mjs';
let provider=null;
export function installDesktopControl(ctx,actionsReady,auxiliary=[]){
 let actions=null;actionsReady.then(value=>{actions=value.manager;},()=>{});
 provider={snapshot(){
  const agents=ctx.get('agents')?.list();
  if(!Array.isArray(agents)||!actions||agents.length>1024)return {known:false};
  let running=0,queued=0,waiting=0;
  for(const agent of agents){
   if(!agent.inbox||!['idle','running'].includes(agent.status))return {known:false};
   running+=Number(agent.status==='running');
   queued+=agent.inbox.nextTurn.length+agent.inbox.nextStep.length;
   const state=ctx.get('sessionProjections')?.stateOf(agent.session,recoveryKey);
   waiting+=Number(agent.status==='running'&&!!state?.pendingApprovals?.length);
  }
  return {known:true,running,queued,waiting,actions:actions.jobs.size,checks:auxiliary.filter(r=>!!r.controller).length,admission:'unsupported'};
 },cancel(){
  // Public Agent cancellation, including inbox; never fabricate terminal events.
  for(const agent of ctx.get('agents')?.list()??[])agent.cancel({kind:'user'});
  for(const job of actions?.jobs.values()??[])job.controller.abort();
  for(const runner of auxiliary)if(runner.controller)runner.cancel(runner.current.id);
 }};
 ctx.effect(()=>()=>{provider=null;});
}
export async function desktopControl(line,write=value=>process.stdout.write(value)){
 let request;try{request=JSON.parse(line);if(!/^[a-f0-9]{32}$/.test(request.id)||!['status','cancel'].includes(request.action))return;}catch{return;}
 let result={known:false};
 try{if(request.action==='cancel')provider?.cancel();result=provider?.snapshot()??result;}catch{}
 write('dsh control: '+JSON.stringify({id:request.id,...result})+'\n');
}

export class ToolTelemetry {
  constructor(capture){this.capture=capture;this.rows=[];this.dropped=0;}
  clear(){this.rows=[];this.dropped=0;}
  suspend(){for(const row of this.rows)if(row.status==='running')row.status='observation-stopped';}
  event(session,event){
    const d=event.data, nested=event.type.startsWith('tool/ptc-'), start=['tool/call','tool/ptc-dispatch-start'].includes(event.type);
    if(!start&&!['tool/result','tool/ptc-dispatch'].includes(event.type))return;
    const sessionId=this.capture.id(session.header.id), block=d.message?.role==='tool'?d.message:d.message?.content?.[0];
    const rawId=nested?d.subCallId:start?d.callId:block?.toolCallId;
    if(!rawId)return;
    const id=this.capture.id(session.header.id+':'+rawId),time=Number.isFinite(event.time)?event.time:Date.now();
    if(start){
      let args;try{args=typeof d.arguments==='string'?d.arguments.length<65536?JSON.parse(d.arguments):null:d.arguments;}catch{}
      const parent=nested?this.rows.findLast(t=>t.id===this.capture.id(session.header.id+':'+d.parentCallId)):null;
      const row={id,session:sessionId,turn:d.turn??parent?.turn,step:d.step??parent?.step,name:String(d.name).slice(0,128),nested,
        parent:nested?this.capture.id(session.header.id+':'+d.parentCallId):null,startedAt:new Date(time).toISOString(),status:'running',
        timingSource:nested?'ptc-dispatch-start':'tool-call-to-result'};
      if(d.name==='read'&&typeof args?.file_path==='string')row.targetHash=this.capture.id(args.file_path);
      if(d.name==='skill'&&typeof args?.name==='string')row.skillHash=this.capture.id(args.name);
      this.rows.push(row);if(this.rows.length>2000){this.rows.shift();this.dropped++;}
    }else{const row=this.rows.findLast(t=>t.id===id&&t.status==='running');if(row){row.endedAt=new Date(time).toISOString();row.durationMs=Math.max(0,time-Date.parse(row.startedAt));row.status=(nested?d.isError:block?.isError)?'error':'completed';}}
  }
}

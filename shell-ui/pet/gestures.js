// No global listeners/hooks. Injectable clocks keep conflicts/cancellation deterministic.
export class Gestures {
 constructor(emit,{now=Date.now,schedule=setTimeout,cancel=clearTimeout,doubleMs=350,longMs=650,threshold=6}={}){Object.assign(this,{emit,now,schedule,cancel,doubleMs,longMs,threshold});this.active=null;this.pending=null;this.last=null;}
 down(p){if(this.active){this.reset();return;}if(!['mouse','touch','pen'].includes(p.type)||p.button!==0)return;this.active={...p,at:this.now(),drag:false,long:false};this.longTimer=this.schedule(()=>{if(this.active&&!this.active.drag){this.clearTap();this.active.long=true;this.emit('long',this.active);}},this.longMs);}
 move(p){const a=this.active;if(!a||a.id!==p.id)return;if(!a.drag&&Math.hypot(p.x-a.x,p.y-a.y)>=this.threshold){this.cancel(this.longTimer);this.clearTap();a.drag=true;this.emit('drag',{...p,dx:p.x-a.x});}}
 up(p){const a=this.active;if(!a||a.id!==p.id)return;this.cancel(this.longTimer);this.active=null;if(a.drag){this.emit('drag-end',p);return;}if(a.long)return;
  if(this.last&&this.now()-this.last.at<=this.doubleMs&&this.last.type===p.type&&Math.hypot(p.x-this.last.x,p.y-this.last.y)<=this.threshold*2){this.clearTap();this.emit('double',p);return;}
  this.clearTap();this.last={...p,at:this.now()};this.pending=this.schedule(()=>{this.pending=null;this.last=null;this.emit('tap',p);},this.doubleMs);
 }
 clearTap(){this.cancel(this.pending);this.pending=null;this.last=null;}
 reset(){this.cancel(this.longTimer);this.clearTap();const wasDrag=this.active?.drag;this.active=null;if(wasDrag)this.emit('drag-cancel');}
}
export class LookDirection {
 constructor(now=Date.now){this.now=now;this.index=null;this.at=-Infinity;}
 update(x,y){if(Math.hypot(x,y)<18){this.index=null;return {row:0,column:6};}const angle=(Math.atan2(x,-y)*180/Math.PI+360)%360;
  const distance=this.index===null?Infinity:Math.abs(((angle-this.index*22.5+540)%360)-180);
  if(distance>16&&this.now()-this.at>=80){this.index=Math.round(angle/22.5)%16;this.at=this.now();}
  return this.index===null?{row:0,column:6}:{row:9+Math.floor(this.index/8),column:this.index%8};
 }
 reset(){this.index=null;this.at=-Infinity;}
}

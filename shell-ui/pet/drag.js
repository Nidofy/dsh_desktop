// One in-flight native move plus the latest sample. End always follows all moves.
export class DragQueue {
 constructor(send,onError=()=>{},onEnd=()=>{}){this.send=send;this.onError=onError;this.onEnd=onEnd;this.running=false;this.latest=false;this.end=false;this.active=false;}
 prepare(anchor){if(this.active)return;this.anchor=anchor;this.active=true;this.latest=false;this.end=false;void this.run();}
 start(){this.prepare();this.latest=true;void this.run();}
 move(){if(this.active)this.latest=true;void this.run();}
 finish(){if(!this.active)return;this.end=true;void this.run();}
 async run(){if(this.running||!this.active)return;this.running=true;
  try{if(!this.started){await this.send('drag',this.anchor);this.started=true;}
   while(this.latest){this.latest=false;await this.send('drag-move');}
   if(this.end){await this.send('drag-end');this.active=false;this.started=false;this.onEnd();}
  }catch(error){this.active=false;this.started=false;this.latest=false;this.end=false;this.onError(error);}
  finally{this.running=false;if(this.active&&(this.latest||this.end))void this.run();}
 }
}

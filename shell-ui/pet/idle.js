export class IdleSchedule {
 constructor(now=Date.now,random=Math.random){this.now=now;this.random=random;this.next=0;}
 choose(variants,active){if(active){this.next=this.now()+15000;return null;}if(this.now()<this.next)return null;this.next=this.now()+15000+Math.floor(this.random()*15000);return variants.length?variants[Math.min(variants.length-1,Math.floor(this.random()*variants.length))]:'neutral';}
}
export function bubbleText(status,defaults,templates={}){const raw=templates[status]??defaults[status]??'';return String(raw).slice(0,160).replaceAll('{state}',defaults[status]??'');}
// Derived locally; elapsed time never decreases affinity or changes task state.
export function idleMood(settings,now){if(!settings.moodEnabled||!settings.lastInteractionMs)return 'normal';const age=Math.max(0,now-settings.lastInteractionMs);return age<120000?'happy':age>300000?'resting':'normal';}

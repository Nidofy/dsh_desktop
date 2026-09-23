import assert from 'node:assert/strict';
import {desktopHealth} from '../runtime-src/desktop-health.mjs';
const services=new Set(['llm','agents','sessionQuery','sessionProjections','shell','sandboxPolicy']);
const ctx={get:name=>services.has(name)?{}:undefined};
assert.equal(desktopHealth(ctx).coreReady,true);
assert.equal(desktopHealth(ctx,{actions:'unavailable'}).coreReady,true,'optional actions do not stop conversation');
for(const name of [...services]){services.delete(name);assert.equal(desktopHealth(ctx).coreReady,false,name);services.add(name);}
assert.equal(desktopHealth({get(){throw Error('private message');}}).coreReady,false);
assert(!JSON.stringify(desktopHealth({get(){throw Error('private message');}})).includes('private message'));
assert.equal(desktopHealth(ctx,{snapshotBridge:true}).capabilities.snapshotBridge,'connected');
console.log('PASS desktop health: explicit services, unavailable vs ready, optional degradation, no exception content');

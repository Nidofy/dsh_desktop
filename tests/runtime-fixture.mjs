import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export function isSourceRuntime(runtime){return JSON.parse(readFileSync(join(runtime,'dsh/node_modules/@deepseek-ai/dsh/package.json'),'utf8')).version==='0.1.7-alpha.2';}
export function sourceEnvironment(runtime,root,home){return isSourceRuntime(runtime)?{DSH_DESKTOP_ENVIRONMENT:root.split(/[\\/]/).at(-1),DSH_DESKTOP_ROOT:root,DSH_HOME:home}:{};}
export function fixtureBase(){return resolve(process.env.DSH_TEST_FIXTURE_ROOT??'.build');}
export function remapDesktopPatch(patch,runtime){
  const files={'desktop-observability':'desktop-observability.mjs','desktop-model-defaults':'model-defaults.mjs','desktop-client':'desktop-client/index.mjs','desktop-environment':'desktop-environment/index.mjs','desktop-vision':'desktop-vision.mjs'};
  for(const row of patch)for(const plugin of row.insert??[])if(files[plugin.id])plugin.name=pathToFileURL(join(runtime,files[plugin.id])).href;
  return patch;
}

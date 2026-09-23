import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {installHarnessSettings} from '../harness-settings.mjs';
const require=createRequire(new URL('../dsh/package.json',import.meta.url));
const {default:z}=await import(pathToFileURL(require.resolve('@deepseek-ai/schemastery')).href);
export const name='desktop-environment';
export const inject=['settings'];
const source=JSON.parse(readFileSync(new URL('../dsh/node_modules/@deepseek-ai/dsh/package.json',import.meta.url))).version==='0.1.7-alpha.2';
const enabled=z.boolean().default(true);
export const Config=z.object({enabled:source?enabled.volatile():enabled});
export function apply(ctx,config){installHarnessSettings(ctx,name,Config,config);}

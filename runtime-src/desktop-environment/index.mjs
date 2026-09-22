import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(new URL('../dsh/package.json',import.meta.url));
const {default:z}=await import(pathToFileURL(require.resolve('@deepseek-ai/schemastery')).href);
export const name='desktop-environment';
export const inject=['settings'];
export const Config=z.object({enabled:z.boolean().default(true)});
export function apply(ctx,config){ctx.settings.installSection(ctx,name,Config,config,{setSource:()=>{},onChange:()=>{}});}

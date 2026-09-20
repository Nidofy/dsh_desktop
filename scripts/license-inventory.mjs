import {readdirSync,readFileSync,writeFileSync,mkdirSync,cpSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
const stage=resolve(process.argv[2]); const modules=join(stage,'resources/dsh/node_modules');
const notices=join(stage,'licenses');mkdirSync(notices,{recursive:true});
cpSync(resolve('licenses/WebView2-Fixed-Version.html'),join(notices,'WebView2-Fixed-Version.html'));
const entries=[];
function visit(dir){for(const item of readdirSync(dir,{withFileTypes:true})){
 if(!item.isDirectory()||item.isSymbolicLink())continue;
 const p=join(dir,item.name);
 if(item.name.startsWith('@')){visit(p);continue;}
 if(!existsSync(join(p,'package.json')))continue;
 const pkg=JSON.parse(readFileSync(join(p,'package.json'),'utf8'));
 entries.push({name:pkg.name,version:pkg.version,license:pkg.license??'REVIEW REQUIRED'});
 const target=join(notices,`${pkg.name.replaceAll('/','_')}@${pkg.version}`);mkdirSync(target,{recursive:true});
 for(const f of readdirSync(p))if(/^(licen[sc]e|copying|notice|third.party)/i.test(f))cpSync(join(p,f),join(target,f),{recursive:true});
 if(existsSync(join(p,'node_modules')))visit(join(p,'node_modules'));
}}
visit(modules);entries.sort((a,b)=>a.name.localeCompare(b.name));
const rust=JSON.parse(readFileSync(resolve('.build/cargo-metadata.json'),'utf8').replace(/^\uFEFF/,''));
const rustEntries=[];
for(const pkg of rust.packages){if(!pkg.source)continue;const p=resolve(pkg.manifest_path,'..');const target=join(notices,`rust_${pkg.name}@${pkg.version}`);mkdirSync(target,{recursive:true});for(const f of readdirSync(p))if(/^(licen[sc]e|copying|notice|copyright)/i.test(f))cpSync(join(p,f),join(target,f),{recursive:true});rustEntries.push({name:pkg.name,version:pkg.version,license:pkg.license??'REVIEW REQUIRED',repository:pkg.repository});}
writeFileSync(join(stage,'rust-license-inventory.json'),JSON.stringify(rustEntries,null,2));
writeFileSync(join(stage,'THIRD_PARTY_NOTICES'),`Node: resources/runtime/LICENSE\nMicrosoft Edge WebView2 Fixed Version: licenses/WebView2-Fixed-Version.html\nWebView2 third-party notices: resources/webview2/show_third_party_software_licenses.bat and original browser tree\nDSH/npm and Rust package license texts: licenses/\nFull audit and redistribution caveats: docs/THIRD_PARTY_LICENSES.md\n\n${[...entries,...rustEntries].map(e=>`${e.name}@${e.version}: ${JSON.stringify(e.license)}`).join('\n')}\n`);
writeFileSync(join(stage,'npm-license-inventory.json'),JSON.stringify(entries,null,2));

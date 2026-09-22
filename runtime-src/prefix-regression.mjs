// Compare synthetic final HTTP request bodies. No provider tokenizer/cache claims.
// Callers own payload collection; reports contain counts/booleans only.
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const omit=(value,key)=>Object.fromEntries(Object.entries(value).filter(([k])=>k!==key));
function view(protocol,body){
  if(!['openai','anthropic'].includes(protocol)||!body||!Array.isArray(body.messages)||!body.messages.length)throw Error('Unsupported or empty wire request');
  const hints=[];
  const clean=(block,path)=>{
    if(!block||typeof block!=='object'||Array.isArray(block))return block;
    if(Object.hasOwn(block,'cache_control'))hints.push({path,value:block.cache_control});
    return omit(block,'cache_control');
  };
  const tools=(body.tools??[]).map((tool,i)=>clean(tool,`tools/${i}`));
  const system=protocol==='anthropic'?(Array.isArray(body.system)?body.system.map((b,i)=>clean(b,`system/${i}`)):body.system??null):[];
  const atoms=[];
  for(const [i,message] of body.messages.entries()){
    const base=clean(message,`messages/${i}`),content=Array.isArray(base.content)?base.content.map((b,j)=>clean(b,`messages/${i}/content/${j}`)):base.content;
    if(protocol==='openai'&&['system','developer'].includes(message.role)){system.push({...base,content});continue;}
    // Anthropic's text-string shorthand and a single text block carry the same
    // content. The adapter changes this representation to attach cache_control.
    // New blocks on the final message are appends, not replacement of old blocks.
    if(protocol==='anthropic'&&(Array.isArray(content)||typeof content==='string')){
      atoms.push(JSON.stringify({header:omit(base,'content')}));
      for(const block of typeof content==='string'?[{type:'text',text:content}]:content)atoms.push(JSON.stringify({block}));
    }else atoms.push(JSON.stringify({...base,content}));
  }
  return {model:body.model,tools,system,atoms,hints,route:{key:body.prompt_cache_key??null,retention:body.prompt_cache_retention??null},options:Object.fromEntries(Object.entries(body).filter(([k])=>!['model','messages','tools','system','prompt_cache_key','prompt_cache_retention'].includes(k)))};
}
export function compareWirePrefix(protocol,before,after){
  const a=view(protocol,before),b=view(protocol,after);let prefix=0;
  while(prefix<a.atoms.length&&prefix<b.atoms.length&&a.atoms[prefix]===b.atoms[prefix])prefix++;
  const changed=[];
  if(!same(a.model,b.model))changed.push('MODEL');
  if(!same(a.tools,b.tools))changed.push('TOOLS');
  if(!same(a.system,b.system))changed.push('SYSTEM');
  if(!same(a.route,b.route))changed.push('CACHE_ROUTE');
  if(prefix<a.atoms.length)changed.push('MESSAGES');
  return {changed,previousAtoms:a.atoms.length,currentAtoms:b.atoms.length,unchangedAtoms:prefix,
    appendOnly:prefix===a.atoms.length,identicalPrompt:changed.length===0&&a.atoms.length===b.atoms.length,
    cacheHintsChanged:!same(a.hints,b.hints),requestOptionsChanged:!same(a.options,b.options),
    comparisonUnit:protocol==='anthropic'?'message-header-and-content-block':'message',
    interpretation:'Local request structure only; not token-prefix length or provider cache effectiveness'};
}
export function assessWirePrefix(protocol,before,after,{expected='append',allowedBreaks=[]}={}){
  if(!['append','identical','break'].includes(expected)||allowedBreaks.some(v=>!['MODEL','TOOLS','SYSTEM','CACHE_ROUTE','MESSAGES'].includes(v)))throw Error('Invalid prefix expectation');
  const facts=compareWirePrefix(protocol,before,after);
  const unexpected=facts.changed.filter(change=>expected!=='break'||!allowedBreaks.includes(change));
  const pass=expected==='identical'?facts.identicalPrompt:expected==='append'?facts.appendOnly&&facts.changed.length===0:facts.changed.length>0&&unexpected.length===0;
  return {...facts,expected,allowedBreaks,unexpected,pass,classification:pass?expected==='break'?'EXPECTED_CACHE_BREAK':expected==='identical'?'EXPECTED_IDENTICAL':'EXPECTED_APPEND':'UNEXPECTED_PREFIX_REWRITE'};
}

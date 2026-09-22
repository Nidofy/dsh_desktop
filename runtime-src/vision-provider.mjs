// Independent image service: no chat history, filesystem paths or credentials in output.
export const imageByteLimit = 10 * 1024 * 1024;
export function validateVisionConfig(config) {
  if (!['openai-completions','anthropic-messages'].includes(config.api)) throw Error('请选择识图 API 格式');
  if (!config.enabled) return;
  let url;
  try { url = new URL(config.baseURL); } catch { throw Error('请输入有效的识图 Base URL'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('识图地址需为不含凭据、查询参数的 HTTP / HTTPS 地址');
  if (!config.model?.trim()) throw Error('请输入识图模型 ID');
  if (!Number.isInteger(config.maxTokens) || config.maxTokens < 1 || config.maxTokens > 32768) throw Error('输出上限需为 1–32768');
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 600000) throw Error('超时需为 1000–600000 毫秒');
}
export async function analyzeImage(config, {data,mediaType,question,apiKey,signal}) {
  validateVisionConfig(config);
  if (!config.enabled) throw Error('请在设置 → 插件 → 识图中启用并配置接口');
  if (!apiKey) throw Error('请在识图插件中保存 API Key');
  if (!data?.byteLength || data.byteLength > imageByteLimit) throw Error('图片大小需在 10 MB 以内');
  if (!['image/png','image/jpeg','image/webp','image/gif'].includes(mediaType)) throw Error('仅支持 PNG、JPEG、WebP 和 GIF 图片');
  if (typeof question !== 'string' || !question.trim() || question.length > 16000) throw Error('请输入不超过 16000 字符的识图问题');
  const anthropic = config.api === 'anthropic-messages';
  const endpoint = new URL(config.baseURL.replace(/\/+$/, '') + (anthropic ? '/messages' : '/chat/completions'));
  const encoded = Buffer.from(data).toString('base64');
  const image = anthropic ? {type:'image',source:{type:'base64',media_type:mediaType,data:encoded}} : {type:'image_url',image_url:{url:`data:${mediaType};base64,${encoded}`}};
  const body = {model:config.model,max_tokens:config.maxTokens,messages:[{role:'user',content:[image,{type:'text',text:question}]}]};
  const headers = {'content-type':'application/json',...(anthropic ? {'x-api-key':apiKey,'anthropic-version':'2023-06-01'} : {authorization:`Bearer ${apiKey}`})};
  const requestSignal = AbortSignal.any([...(signal ? [signal] : []),AbortSignal.timeout(config.timeoutMs)]);
  let response;
  try { response = await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body),signal:requestSignal,redirect:'error'}); }
  catch { throw Error(requestSignal.aborted ? '识图请求已取消或超时' : '无法连接识图服务，请检查地址和网络设置'); }
  if (!response.ok) { await response.body?.cancel(); throw Error(`识图服务返回 HTTP ${response.status}`); }
  let bytes = 0; const chunks = [];
  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 1024 * 1024) throw Error('SIZE');
      chunks.push(chunk);
    }
  } catch { throw Error(requestSignal.aborted ? '识图请求已取消或超时' : '识图响应过大或读取失败'); }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Error('识图服务未返回有效 JSON'); }
  const content = anthropic ? result.content : result.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(p=>p?.type === 'text' && typeof p.text === 'string').map(p=>p.text).join('\n') : '';
  if (!text.trim()) throw Error('识图服务未返回文字结果');
  if (text.length > 262144) throw Error('识图文字结果过长，请缩小问题范围');
  return {text,model:config.model};
}

// Request identity metadata only. Endpoint, credential reference and secrets
// must never be copied into an exported diagnostic record.
export function requestConfiguration(value){
  const id=v=>typeof v==='string'&&/^[a-f0-9]{24,64}$/.test(v)?v:null;
  return {api:typeof value?.api==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value.api)?value.api:null,
    connectionId:id(value?.connectionId),credentialId:id(value?.credentialId)};
}
export function reportConfiguration(baseline,records){
  const result={...baseline};
  if(!records.length||!records.some(row=>row.configuration))return result;
  for(const field of ['api','connectionId','credentialId']){
    const values=records.map(row=>row.configuration?.[field]);
    result[field]=values.every(value=>value&&value===values[0])?values[0]:null;
  }
  return result;
}

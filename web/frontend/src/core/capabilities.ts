export const capabilityIds=['library','darkroom','raw','watermark','semantic','faces','watercolor','titles','batchWatercolor','filePicker','directoryPicker'] as const;
export type CapabilityId=typeof capabilityIds[number];
export type CapabilityAction='semantic-settings'|'faces'|'watercolor'|'manual-paths'|'desktop'|'site-headers'|'reconnect-library';
export type CapabilityState='available'|'degraded'|'unavailable';
export const capabilityReasons=['ready','dependency_missing','model_loading','model_error','model_not_loaded','weights_not_loaded','weights_missing','cloud_not_checked','credential_error','credential_missing','relay_missing','picker_not_checked','picker_unavailable','runtime_unsupported','worker_missing','wasm_missing','raw_isolation_missing','decoder_not_checked','library_permission','source_permission_on_action','status_unavailable'] as const;
export type CapabilityReason=typeof capabilityReasons[number];
export type Capability={state:CapabilityState;reason:CapabilityReason;runnable:boolean;execution:'local'|'cloud'|'native';actions:CapabilityAction[];facts:Record<string,string|boolean>};
export type Capabilities={version:1;runtime:'native'|'browser';items:Record<CapabilityId,Capability>};
export function capability(state:CapabilityState,reason:CapabilityReason,runnable:boolean,actions:CapabilityAction[]=[],facts:Capability['facts']={},execution:Capability['execution']='local'):Capability{return {state,reason,runnable,execution,actions,facts};}
export function rendererCapabilities(facts:{worker:boolean;canvas:boolean;bitmap:boolean;wasm:boolean;isolated:boolean}){
  const engine=facts.worker&&facts.canvas&&facts.bitmap;
  const darkroom=capability(engine?'available':'unavailable',engine?'ready':'worker_missing',engine,[],{engine:engine?'detected':'missing'});
  const raw=capability(engine&&facts.wasm?'degraded':'unavailable',!engine?'worker_missing':!facts.wasm?'wasm_missing':!facts.isolated?'raw_isolation_missing':'decoder_not_checked',engine&&facts.wasm&&facts.isolated,
    engine&&facts.wasm&&!facts.isolated?['site-headers']:[],{engine:'libraw-wasm-1.6.0',isolation:facts.isolated,decoder:'not_loaded'});
  return {darkroom,raw};
}
export function validateCapabilities(value:unknown):Capabilities{
  const s=value as Capabilities;
  if(!s||s.version!==1||!['native','browser'].includes(s.runtime)||!s.items)throw new Error('Invalid capability status. Refresh or update the application.');
  const actionIds=['semantic-settings','faces','watercolor','manual-paths','desktop','site-headers','reconnect-library'];
  for(const id of capabilityIds){const c=s.items[id];if(!c||!['available','degraded','unavailable'].includes(c.state)||!capabilityReasons.includes(c.reason)||typeof c.runnable!=='boolean'||!['local','cloud','native'].includes(c.execution)||!Array.isArray(c.actions)||c.actions.some(a=>!actionIds.includes(a))||!c.facts||typeof c.facts!=='object'||Array.isArray(c.facts)||Object.values(c.facts).some(v=>!['string','boolean'].includes(typeof v)))throw new Error('Invalid capability status. Refresh or update the application.');}
  return s;
}
export function browserInferenceCapabilities(config:{key_configured:boolean;relay_configured:boolean}){
  const configured=config.key_configured&&config.relay_configured;
  const cloud=capability(configured?'degraded':'unavailable',!config.relay_configured?'relay_missing':!config.key_configured?'credential_missing':'cloud_not_checked',configured,['watercolor'],{connection:'not_checked',consent_required:true},'cloud');
  return {semantic:capability('unavailable','runtime_unsupported',false,['desktop']),faces:capability('unavailable','runtime_unsupported',false,['desktop']),
    watercolor:cloud,titles:{...cloud},batchWatercolor:capability('unavailable','runtime_unsupported',false,['desktop'])};
}

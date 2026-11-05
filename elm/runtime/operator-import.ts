import type { OwnerSnapshot, RequestContext } from './contracts';

export type SafeCheck = { readonly id: string; readonly status: 'pass' | 'fail' | 'skipped' | 'unknown' };
export type SafeCapability = { readonly name: 'mesh_peers_configured' | 'mesh_require_secured' | 'mesh_require_signed_frames' | 'mesh_cloak_configured' | 'cloak_account' | 'cloak_anon_rotation' | 'tls_configured' | 'ocsp_configured' | 'unknown-capability'; readonly configured: boolean };
export type SafeDiagnosticSummary = { readonly total: number; readonly passed: number; readonly failed: number; readonly skipped: number; readonly other: number; readonly truncated: boolean };
export type SafeObservationSummary = { readonly tcpActive: number | null; readonly establishedLinks: number | null; readonly peersUp: number | null; readonly peersTotal: number | null; readonly quorum: number | null; readonly components: number | null; readonly partitioned: number | null };
export type SafeServicePlan = { readonly manager: 'openrc' | 'systemd' | 'foreground' | 'unknown'; readonly argumentsBounded: boolean };
export type SafeNetworkAssessment = { readonly ircPort: number; readonly tlsEnabled: boolean; readonly tlsPort: number; readonly validation: 'static-passed' | 'pending' | 'unknown'; readonly hostnameSyntax: 'valid' | 'invalid' | 'unknown'; readonly addressSyntax: 'ipv4' | 'ipv6' | 'unknown'; readonly readiness: 'unknown' };
export type SafeMediaAssessment = { readonly enabled: 'yes' | 'no' | 'unknown'; readonly configured: null | { readonly enabled: boolean; readonly mediaPort: number; readonly nativeMediaPort: number; readonly stunPort: number; readonly websocketPort: number; readonly websocketMediaRelay: boolean; readonly existing: boolean }; readonly readiness: 'unknown'; readonly relay: 'unknown' };
export type SafeOperatorPlan =
  | { readonly kind: 'doctor-v1'; readonly schemaVersion: 1; readonly readiness: 'unknown'; readonly exporterBuild: string | null; readonly checks: readonly SafeCheck[]; readonly capabilities: readonly SafeCapability[]; readonly diagnostics: SafeDiagnosticSummary; readonly observations: SafeObservationSummary | null; readonly service: SafeServicePlan }
  | { readonly kind: 'setup-v4'; readonly schemaVersion: 4; readonly mode: 'preview' | 'review' | 'unsupported-mode'; readonly readiness: 'unknown'; readonly changesApplied: boolean; readonly profile: 'existing' | 'private' | 'community' | 'media' | null; readonly effectiveProfile: { readonly maxClients: number; readonly mediaEnabled: boolean } | null; readonly network: SafeNetworkAssessment | null; readonly media: SafeMediaAssessment | null; readonly service: SafeServicePlan };
export type OperatorImportStatus = 'ready' | 'invalid' | 'unsupported-schema' | 'too-large' | 'stale-owner' | 'unavailable';
export type OperatorImportResult = { readonly context: RequestContext; readonly status: OperatorImportStatus; readonly previewRef: string | null; readonly plan: SafeOperatorPlan | null };
type Preview = { readonly owner: OwnerSnapshot; readonly plan: SafeOperatorPlan };
const MAX_BYTES = 1024 * 1024;
const BUILD = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u;
const doctorChecks = new Set(['sqpoll_defer_taskrun','ktls_txrx','mesh_security','mesh_cloak','cloak_anon_cadence','ocsp_leaf_uri','mesh_capabilities','mesh_transport_security','s2s_handshake']);
const capabilities = new Set(['mesh_peers_configured','mesh_require_secured','mesh_require_signed_frames','mesh_cloak_configured','cloak_account','cloak_anon_rotation','tls_configured','ocsp_configured']);
const control = /[\u0000-\u001f\u007f]/u;
function sameOwner(a: OwnerSnapshot,b: OwnerSnapshot): boolean { return a.networkId===b.networkId&&a.accountId===b.accountId&&a.accountGeneration===b.accountGeneration&&a.connectionGeneration===b.connectionGeneration&&a.physicalRef===b.physicalRef&&a.ownerRef===b.ownerRef; }
function safeTree(root: unknown): boolean {
  const todo: Array<{v: unknown; depth: number}> = [{v:root,depth:0}]; let nodes=0;
  while(todo.length){const {v,depth}=todo.pop()!; if(++nodes>20000||depth>24)return false;
    if(typeof v==='string'){if(new TextEncoder().encode(v).length>8192||control.test(v))return false;}
    else if(Array.isArray(v)){if(v.length>2048)return false;for(const x of v)todo.push({v:x,depth:depth+1});}
    else if(v&&typeof v==='object'){for(const [key,x] of Object.entries(v as Record<string,unknown>)){if(new TextEncoder().encode(key).length>128||control.test(key))return false;todo.push({v:x,depth:depth+1});}}
    else if(typeof v==='number'&&!Number.isSafeInteger(v))return false;
  } return true;
}
function record(value: unknown): Record<string,unknown>|null { return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null; }
function int(v:unknown):number|null{return typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;}
function text(v:unknown):string|null{return typeof v==='string'?v:null;}
function service(v:unknown):SafeServicePlan {const r=record(v);const manager=text(r?.selected);const template=record(r?.template);return {manager:manager==='openrc'||manager==='systemd'||manager==='foreground'?manager:'unknown',argumentsBounded:Array.isArray(template?.start_argv)&&template!.start_argv.length<=32&&Array.isArray(template?.preflight_argv)&&template!.preflight_argv.length<=32};}
function hasOnlyKeys(root:Record<string,unknown>,keys:ReadonlySet<string>):boolean{return Object.keys(root).every((key)=>keys.has(key));}
const doctorRootKeys=new Set(['schema_version','mode','readiness','report_build_version','failed','checks','capabilities','diagnostics','observations','service_environment','service_plan']);
const setupRootKeys=new Set(['schema_version','mode','config','service','service_environment','service_explicit','service_plan','service_basis','validation','readiness','changes_applied','profile','purpose','enrollment','profile_values','effective_profile','existing_summary','profile_diff_baseline','profile_diff_basis','profile_diff','artifact','settings','media_assessment','network_assessment','provisioning','node_public_key','certificate_expires_unix','bootstrap_account','operator_privileges','authentication_mechanisms','tls_provenance','service_guidance','recovery','steps']);
function doctor(root:Record<string,unknown>):SafeOperatorPlan|null {
 if(!hasOnlyKeys(root,doctorRootKeys)||root.schema_version!==1||root.mode!=='preflight'||root.readiness!=='unknown'||typeof root.failed!=='boolean'||!Array.isArray(root.checks)||!Array.isArray(record(root.capabilities)?.entries))return null;
 const checks:SafeCheck[]=root.checks.slice(0,512).map((item)=>{const r=record(item);const id=text(r?.id);const raw=text(r?.status);return {id:id&&doctorChecks.has(id)?id:'unknown-check',status:raw==='pass'||raw==='fail'||raw==='skipped'?raw:'unknown'};});
 const cap=record(root.capabilities)!;const entries=cap.entries as unknown[];const safeCaps:SafeCapability[]=entries.slice(0,32).map((item)=>{const r=record(item);const name=text(r?.name);return {name:name&&capabilities.has(name)?name as SafeCapability['name']:'unknown-capability',configured:r?.configured===true};});
 const d=record(root.diagnostics);const n=(x:unknown)=>int(x)??0;
 const ob=record(root.observations); const obs=ob?{tcpActive:int(ob.tcp_active),establishedLinks:int(ob.established_links),peersUp:int(ob.peers_up),peersTotal:int(ob.peers_total),quorum:int(ob.quorum),components:int(ob.components),partitioned:int(ob.partitioned)}:null;
 const build=text(root.report_build_version);
 return {kind:'doctor-v1',schemaVersion:1,readiness:'unknown',exporterBuild:build&&BUILD.test(build)?build:null,checks,capabilities:safeCaps,diagnostics:{total:n(d?.total),passed:n(d?.passed),failed:n(d?.failed),skipped:n(d?.skipped),other:n(d?.other),truncated:d?.truncated===true},observations:obs,service:service(root.service_plan)};
}
function setup(root:Record<string,unknown>):SafeOperatorPlan|null {
 if(!hasOnlyKeys(root,setupRootKeys)||root.schema_version!==4||typeof root.changes_applied!=='boolean'||root.readiness!=='unknown')return null;
 const effective=record(root.effective_profile);const maxClients=int(effective?.max_clients);const mode=text(root.mode);const profile=text(root.profile);
 const network=record(root.network_assessment);const media=record(root.media_assessment);
 const port=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=65535?value:null;
 const networkPlan:SafeNetworkAssessment|null=network?(()=>{const irc=port(network.irc_port);const tls=port(network.tls_port);if(irc===null||tls===null||typeof network.tls_enabled!=='boolean')return null;
   const validationText=text(network.candidate_validation);const hostnameText=text(network.hostname_check);const addressText=text(network.address_check);
   return {ircPort:irc,tlsEnabled:network.tls_enabled,tlsPort:tls,validation:validationText==='configuration loader and static checks passed'?'static-passed':validationText==='candidate validation pending'?'pending':'unknown',hostnameSyntax:hostnameText==='DNS-label syntax valid; DNS not queried'?'valid':hostnameText==='not a DNS-label hostname; DNS not queried'?'invalid':'unknown',addressSyntax:addressText==='numeric IPv4 syntax valid'?'ipv4':addressText==='numeric IPv6 syntax valid'?'ipv6':'unknown',readiness:'unknown'};})():null;
 const mediaPlan:SafeMediaAssessment|null=media?(()=>{const configured=record(media.configured);let safeConfigured:SafeMediaAssessment['configured']=null;
   if(configured){const mp=port(configured.media_port),np=port(configured.native_media_port),sp=port(configured.stun_port),wp=port(configured.websocket_port);
     if(mp===null||np===null||sp===null||wp===null||typeof configured.enabled!=='boolean'||typeof configured.websocket_media_relay!=='boolean'||typeof configured.existing!=='boolean')return null;
     safeConfigured={enabled:configured.enabled,mediaPort:mp,nativeMediaPort:np,stunPort:sp,websocketPort:wp,websocketMediaRelay:configured.websocket_media_relay,existing:configured.existing};}
   const enabled=media.enabled==='yes'||media.enabled==='no'?media.enabled:'unknown';
   return {enabled,configured:safeConfigured,readiness:'unknown',relay:'unknown'};})():null;
 return {kind:'setup-v4',schemaVersion:4,mode:mode==='preview'||mode==='review'?mode:'unsupported-mode',readiness:'unknown',changesApplied:root.changes_applied,
 profile:profile==='existing'||profile==='private'||profile==='community'||profile==='media'?profile:null,
 effectiveProfile:maxClients!==null&&typeof effective?.media_enabled==='boolean'?{maxClients,mediaEnabled:effective.media_enabled}:null,
 network:networkPlan,media:mediaPlan,service:service(root.service_plan)};
}
export function createOperatorImport(deps:{ownerSnapshot:()=>OwnerSnapshot;isCurrent:(owner:OwnerSnapshot)=>boolean;readPrivateFile:(inputRef:symbol,context:RequestContext)=>Promise<Uint8Array|null>;emit:(event:{readonly context:RequestContext;readonly status:OperatorImportStatus;readonly previewRef:string|null})=>void}) {
 const previews=new Map<string,Preview>();let disposed=false;let generation=0;
 const active=(owner:OwnerSnapshot,token:number)=>!disposed&&generation===token&&sameOwner(owner,deps.ownerSnapshot())&&deps.isCurrent(owner);
 return {
  async preview(input:{context:RequestContext;inputRef:symbol}):Promise<OperatorImportResult>{const {context}=input;const owner=context.owner;const token=generation;if(!active(owner,token))return {context,status:'stale-owner',previewRef:null,plan:null};let bytes:Uint8Array|null=null;
   try{bytes=await deps.readPrivateFile(input.inputRef,context);if(!active(owner,token))return {context,status:'stale-owner',previewRef:null,plan:null};if(!bytes)return {context,status:'unavailable',previewRef:null,plan:null};if(bytes.byteLength>MAX_BYTES)return {context,status:'too-large',previewRef:null,plan:null};
    const json=new TextDecoder('utf-8',{fatal:true}).decode(bytes);const parsed:unknown=JSON.parse(json);if(!safeTree(parsed))return {context,status:'too-large',previewRef:null,plan:null};const root=record(parsed);if(!root)return {context,status:'invalid',previewRef:null,plan:null};
    const schema=root.schema_version;if(schema!==1&&schema!==4)return {context,status:'unsupported-schema',previewRef:null,plan:null};const plan=schema===1?doctor(root):setup(root);if(!plan)return {context,status:'invalid',previewRef:null,plan:null};if(!active(owner,token))return {context,status:'stale-owner',previewRef:null,plan:null};
    const previewRef=[...crypto.getRandomValues(new Uint8Array(24))].map(x=>x.toString(16).padStart(2,'0')).join('');previews.set(previewRef,{owner:Object.freeze({...owner}),plan});while(previews.size>32)previews.delete(previews.keys().next().value!);const result={context,status:'ready' as const,previewRef,plan};deps.emit({context,status:'ready',previewRef});return result;
   }catch{return {context,status:'invalid',previewRef:null,plan:null};}finally{bytes?.fill(0);}
  },
  getPreview(input:{context:RequestContext;previewRef:string}):SafeOperatorPlan|null{const p=previews.get(input.previewRef);return p&&active(input.context.owner,generation)&&sameOwner(p.owner,input.context.owner)?p.plan:null;},
  dismiss(input:{context:RequestContext;previewRef:string}):void{const p=previews.get(input.previewRef);if(p&&sameOwner(p.owner,input.context.owner))previews.delete(input.previewRef);},
  dispose():void{disposed=true;generation++;previews.clear();},
 };
}

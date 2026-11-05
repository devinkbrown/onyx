/** Source-bound IRC facts used by Elm's private policy providers.
 *
 * This collector is deliberately not a crypto trust provider. E2EEKEY LIST is
 * authenticated server data, but a directory row is not a human-approved pin.
 */
import {
  makeConversationId, makeRequestId, type AccountId, type ConversationId,
  canonicalTupleKey, type LocalPhysicalEpoch, type OwnerSnapshot, type PrivateIngressEvent, type RequestId, type SendAdmission, type Transport,
} from './contracts';
import { formatIRCLine, normalizeCase, parseIRCMessage, parseNamesPrefix, parsePREFIX } from '../../src/lib/irc/parser';
import { GroupDeviceDirectoryCollector, encodeGroupDeviceDirectoryEntry, deriveGroupDeviceId, type GroupDeviceDirectorySnapshot } from '../../src/lib/e2ee/groupDeviceDirectory';

const MAX_PENDING = 32;
const MAX_DIRECTORIES = 256;
const MAX_ROSTER = 1000;
const QUERY_TIMEOUT_MS = 10_000;
const ACCOUNT_RE = /^[A-Za-z0-9_.@-]{1,64}$/u;
const DEVICE_RE = /^[A-Za-z0-9_.-]{1,32}$/u;
const ROOM_RE = /^[^\s,\u0000-\u001f\u007f]{1,128}$/u;
const enc = new TextEncoder();

export type CaseMapping = 'ascii' | 'rfc1459' | 'strict-rfc1459';
export type FactContext = Readonly<{ owner: OwnerSnapshot }>;
export type IngressContext = Readonly<{ owner: OwnerSnapshot; physicalRef: string | null }>;
export type RoomMemberFact = Readonly<{ nick: string; modes: readonly string[]; accountId: AccountId | null }>;
export type RoomMembershipFacts = Readonly<{
  owner: OwnerSnapshot; target: string; canonicalTarget: string | null; scheme: CaseMapping | null;
  mappingGeneration: number; mappingRevision: string; membershipGeneration: number; joined: boolean; complete: boolean;
  canSend: boolean;
  memberCount: number; memberAccounts: readonly AccountId[]; members: readonly RoomMemberFact[];
  ownNick: string | null; ownModes: readonly string[]; hiddenOrAuditorium: boolean;
  sourceRevision: string | null;
}>;
export type RoomPolicyFacts = Readonly<{ canonicalTarget: string | null; scheme: CaseMapping | null; mappingRevision: string; joined: boolean; complete: boolean }>;
export type AuthenticatedPolicyFact = Readonly<{
  owner: OwnerSnapshot; target: string; policyGeneration: number;
  encryption: 'required' | 'optional' | 'off' | 'unknown'; complete: boolean;
  ephemeralSeconds: number | null; ephemeralKnown: boolean;
}>;
export type StructuralDirectoryFact = Readonly<{
  owner: OwnerSnapshot; accountId: AccountId; revision: string;
  provenance: 'authenticated-exact-server'; trusted: false;
  snapshot: GroupDeviceDirectorySnapshot;
}>;
export type FreshCreateFact = Readonly<{
  owner: OwnerSnapshot; operationRef: string; target: string; canonicalTarget: string;
  objectId: string; mappingGeneration: number; membershipGeneration: number;
  policyGeneration: number; founder: true; consumed: boolean;
}>;
export type AuthenticatedFactsOptions = Readonly<{
  ownerSnapshot: () => OwnerSnapshot;
  isCurrent: (owner: OwnerSnapshot) => boolean;
  transport: Transport;
  currentServerPrefix: () => string | null;
  currentNick?: () => string | null;
  metadataAvailable?: () => boolean;
  onInvalidation?: (event: { owner: OwnerSnapshot; target: string | null; reason: 'mapping-changed' | 'membership-changed' | 'policy-changed' | 'owner-retired' | 'snapshot-incomplete' | 'membership-incomplete' | 'policy-incomplete' | 'mode-incomplete' }) => void;
  onReadiness?: (event: { owner: OwnerSnapshot; target: string; membership: 'complete' | 'incomplete'; policy: AuthenticatedPolicyFact }) => void;
  now?: () => number;
}>;

type Member = { nick: string; modes: Set<string>; accountId: AccountId | null; accountObserved: boolean; whoisAttempted: boolean };
type Room = {
  target: string; canonical: string; joined: boolean; completeNames: boolean; namesGeneration: number;
  members: Map<string, Member>; ownNick: string | null; ownModes: Set<string>;
  hidden: boolean; propsComplete: boolean; props: Map<string, string>;
  modesComplete: boolean; channelModes: Set<string>; policyGeneration: number; membershipGeneration: number; sourceRevision: string | null;
};
type Pending = { id: string; owner: OwnerSnapshot; physical: LocalPhysicalEpoch | null; kind: 'names'|'prop'|'mode'|'whois'|'metadata'|'directory'|'publish'; target: string; account?: string; token?: string; timer: ReturnType<typeof setTimeout>; directory?: GroupDeviceDirectoryCollector; resolve?: (value: unknown) => void; rows: number; memberNick?: string; member?: Member; namesGeneration?: number; whoisUserSeen?: boolean; whoisAccountSeen?: boolean };
type CreateIntent = { ref: string; owner: OwnerSnapshot; target: string; canonical: string; label: string; admission: 'pending'|'unknown'|'admitted'|'blocked'; objectId: string | null; reserved: boolean };
type DirectPeer = { readonly owner: OwnerSnapshot; readonly nick: string; accountId: AccountId | null; complete: boolean; metadataComplete: boolean; designated: boolean; readonly revision: string };

function samePhysical(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.networkId === b.networkId && a.connectionGeneration === b.connectionGeneration && a.physicalRef !== null && a.physicalRef === b.physicalRef;
}
function randomRef(): string {
  const bytes = new Uint8Array(18); globalThis.crypto.getRandomValues(bytes);
  let raw = ''; for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');
}
function accountId(value: string): AccountId | null { return ACCOUNT_RE.test(value) ? value as AccountId : null; }
function validRoom(value: string): boolean { return enc.encode(value).byteLength <= 128 && ROOM_RE.test(value); }
function objectId(value: string): string | null { return /^0[0-9a-fA-F]{8}$/u.test(value) && !/^0{9}$/u.test(value) ? value.toLowerCase() : null; }

export function createAuthenticatedFacts(options: AuthenticatedFactsOptions) {
  const now = options.now ?? Date.now;
  let disposed = false;
  let mapping: CaseMapping | null = null;
  let mappingGeneration = 0;
  let prefixModes: Record<string,string> = Object.create(null) as Record<string,string>;
  let modePrefixes: Record<string,string> = Object.create(null) as Record<string,string>;
  let ownNick = options.currentNick?.() ?? null;
  const advertised = new Set<string>();
  let generation = 0;
  const rooms = new Map<string, Room>();
  const pending = new Map<string, Pending>();
  const directories = new Map<string, { fact: StructuralDirectoryFact; touched: number }>();
  const directoryFlights = new Map<string, Promise<StructuralDirectoryFact | null>>();
  const creates = new Map<string, CreateIntent>();
  const freshFacts = new Map<string, FreshCreateFact>();
  const directPeers = new Map<string,DirectPeer>();
  const directKey=(owner:OwnerSnapshot,target:string):string|null=>mapping&&validRoom(target)&&!target.startsWith('#')&&!target.startsWith('&')
    ?JSON.stringify([owner.networkId,owner.accountId,normalizeCase(target,mapping)]):null;
  const requestDmMetadata=(owner:OwnerSnapshot,target:string):void=>{
    if(!options.metadataAvailable?.()||[...pending.values()].some(item=>item.kind==='metadata'&&samePhysical(item.owner,owner)))return;
    const metadata=begin(owner,'metadata',target,{token:`dm:${normalizeCase(target,mapping??'ascii')}`});
    if(metadata&&send(owner,formatIRCLine('METADATA',target,'GET','ocean.dm-key','ocean.dm-keys')).kind!=='transport-admitted')clearPending(metadata);
  };
  const listeners = options.transport.onPrivateIngress((event) => {
    const {owner,payload}=event;
    if (disposed || !current(owner) || payload.owner.ownerRef!==owner.ownerRef) return;
    void ingest({ physicalContext: owner, line: payload.line, sourceKind:payload.sourceKind });
  });
  const current = (owner: OwnerSnapshot, physical = owner.physicalRef): boolean => !disposed
    && options.isCurrent(owner) && options.transport.isCurrent(owner)
    && owner.physicalRef !== null && owner.physicalRef === physical;
  const key = (owner: OwnerSnapshot, target: string): string | null => {
    if (!mapping || !validRoom(target)) return null;
    return JSON.stringify([owner.networkId, owner.accountId, normalizeCase(target, mapping)]);
  };
  const getRoom = (owner: OwnerSnapshot, target: string): Room | null => {
    const k = key(owner, target); if (!k) return null;
    let room = rooms.get(k);
    if (!room) {
      room = { target, canonical: normalizeCase(target, mapping!), joined: false, completeNames: false,
        namesGeneration: 0, members: new Map(), ownNick, ownModes: new Set(), hidden: false,
        propsComplete: false, props: new Map(), modesComplete: false, channelModes:new Set(), policyGeneration: 0,
        membershipGeneration: 0, sourceRevision: null };
      rooms.set(k, room);
    }
    return room;
  };
  const invalidate = (owner: OwnerSnapshot, room: Room | null, reason: Parameters<NonNullable<typeof options.onInvalidation>>[0]['reason']) => {
    if (room) {
      if (reason === 'membership-changed' || reason === 'snapshot-incomplete') { room.membershipGeneration++; room.completeNames = false; }
      if (reason === 'policy-changed' || reason === 'snapshot-incomplete') { room.policyGeneration++; room.propsComplete = false; }
    }
    options.onInvalidation?.({ owner, target: room?.target ?? null, reason });
  };
  const membershipChanged = (owner:OwnerSnapshot,room:Room):void => {
    invalidate(owner,room,'membership-changed');
    if(room.joined)refresh(owner,room);
  };
  const send = (owner: OwnerSnapshot, line: string): SendAdmission => {
    const wireLine = line.endsWith('\r\n') ? line.slice(0, -2) : line;
    if (!current(owner) || /[\r\n\u0000]/u.test(wireLine) || wireLine.length > 2048) return { kind: 'blocked', reason: 'owner-changed' };
    const requestId = makeRequestId(randomRef());
    if (!requestId) return { kind: 'blocked', reason: 'invalid-intent' };
    return options.transport.sendLine({ line: wireLine, owner, requestId });
  };
  const clearPending = (p: Pending, result: unknown = null) => {
    if (!pending.delete(p.id)) return;
    clearTimeout(p.timer); p.resolve?.(result);
  };
  const begin = (owner: OwnerSnapshot, kind: Pending['kind'], target: string, extra: Partial<Pending> = {}): Pending | null => {
    if (!current(owner) || pending.size >= MAX_PENDING) return null;
    const id = randomRef();
    const p: Pending = { id, owner, physical: owner.physicalRef, kind, target, rows: 0, timer: setTimeout(() => {
      if (!pending.has(id)) return;
      clearPending(p, null);
      if (kind === 'directory' && extra.account) directoryFlights.delete(JSON.stringify([owner.networkId,owner.accountId,extra.account]));
      const incomplete = (reason: 'membership-incomplete' | 'policy-incomplete' | 'mode-incomplete'): void => options.onInvalidation?.({ owner, target, reason });
      if (kind === 'whois') {
        incomplete('membership-incomplete');
        if (p.token?.startsWith('fallback:')) {
          continueFallbackWhois(owner);
        } else if (p.token && !p.token.startsWith('dm:')) {
          const room = getRoom(owner, target);
          if (room?.joined) finishRoomIfReady(owner, room);
        }
        return;
      }
      const room = target ? getRoom(owner, target) : null;
      if (room && kind === 'names') { room.completeNames = false; room.membershipGeneration++; incomplete('membership-incomplete'); }
      else if (room && kind === 'prop') { room.propsComplete = false; room.policyGeneration++; incomplete('policy-incomplete'); }
      else if (room && kind === 'mode') { room.modesComplete = false; incomplete('mode-incomplete'); }
    }, QUERY_TIMEOUT_MS), ...extra };
    pending.set(id, p); return p;
  };
  const findRoomPending = (owner: OwnerSnapshot, kind: Pending['kind'], target: string): Pending | undefined =>
    [...pending.values()].find(p => p.owner.ownerRef === owner.ownerRef && samePhysical(p.owner, owner) && p.kind === kind && normalizeCase(p.target, mapping ?? 'ascii') === normalizeCase(target, mapping ?? 'ascii'));
  const refresh = (owner: OwnerSnapshot, room: Room) => {
    if (!current(owner) || !room.joined) return;
    if (!findRoomPending(owner,'mode',room.target)) { const p=begin(owner,'mode',room.target); if (p) { const a=send(owner,formatIRCLine('MODE',room.target)); if(a.kind!=='transport-admitted') clearPending(p); } }
    if (!findRoomPending(owner,'prop',room.target)) { const p=begin(owner,'prop',room.target); if (p) { const a=send(owner,formatIRCLine('PROP',room.target)); if(a.kind!=='transport-admitted') clearPending(p); } }
    if (!findRoomPending(owner,'names',room.target)) { const p=begin(owner,'names',room.target); if (p) { room.completeNames=false; room.hidden=false; room.members.clear(); room.namesGeneration++; const a=send(owner,formatIRCLine('NAMES',room.target)); if(a.kind!=='transport-admitted') clearPending(p); } }
    if (advertised.has('WHOX') && !findRoomPending(owner,'whois',room.target)) {
      const token=String(Math.floor(Math.random()*1_000_000));
      const p=begin(owner,'whois',room.target,{token});
      if(p){const a=send(owner,formatIRCLine('WHO',room.target,`%tcnfa,${token}`));if(a.kind!=='transport-admitted')clearPending(p);}
    }
  };
  const finishRoomIfReady = (owner: OwnerSnapshot, room: Room) => {
    if (!current(owner) || !room.completeNames) return;
    const policy = policySnapshot(owner, room.target);
    options.onReadiness?.({ owner, target: room.target, membership: roomMembershipFacts(owner,room.target).complete ? 'complete' : 'incomplete', policy });
  };
  const issueFallbackWhois = (owner: OwnerSnapshot, room: Room): void => {
    if (advertised.has('WHOX') || !current(owner) || !room.completeNames) return;
    if ([...pending.values()].some(p=>p.kind==='whois'&&p.token?.startsWith('fallback:')&&samePhysical(p.owner,owner))) return;
    const next=[...room.members.values()].find(member=>!member.accountObserved&&!member.whoisAttempted);
    if(!next) { finishRoomIfReady(owner,room); return; }
    const p=begin(owner,'whois',room.target,{token:`fallback:${normalizeCase(next.nick,mapping??'ascii')}`,memberNick:next.nick,member:next,namesGeneration:room.namesGeneration,whoisUserSeen:false,whoisAccountSeen:false});
    if(!p)return;
    if(send(owner,formatIRCLine('WHOIS',next.nick)).kind!=='transport-admitted')clearPending(p);
    else next.whoisAttempted=true;
  };
  function continueFallbackWhois(owner: OwnerSnapshot): void {
    if(advertised.has('WHOX')||!current(owner)||[...pending.values()].some(p=>p.kind==='whois'&&p.token?.startsWith('fallback:')&&samePhysical(p.owner,owner)))return;
    for(const room of rooms.values())if(room.joined&&room.completeNames)issueFallbackWhois(owner,room);
  }

  function onRegistered(context: FactContext): void {
    if (!current(context.owner)) return;
    ownNick = options.currentNick?.() ?? ownNick;
    for (const room of rooms.values()) if (room.joined) refresh(context.owner, room);
  }
  function observeJoinedTarget(context: FactContext, target: string): void {
    if (!current(context.owner) || !validRoom(target) || !mapping) return;
    const room = getRoom(context.owner,target); if (!room) return;
    room.joined=true; room.completeNames=false; room.propsComplete=false; room.modesComplete=false;
    room.members.clear(); room.hidden=false; room.ownModes.clear(); room.membershipGeneration++; room.policyGeneration++;
    refresh(context.owner,room);
  }
  function policySnapshot(owner: OwnerSnapshot, target: string): AuthenticatedPolicyFact {
    const room=roomReference(owner,target);
    const value=room?.props.get('encryption-policy');
    const encryption=room?.propsComplete && value===undefined ? 'off'
      : room?.propsComplete && (value==='required'||value==='optional'||value==='off') ? value : 'unknown';
    const ephemeralRaw=room?.props.get('EPHEMERAL');
    const ephemeralNumber=ephemeralRaw===undefined?null:/^(?:0|[1-9][0-9]{0,6})$/u.test(ephemeralRaw)?Number(ephemeralRaw):NaN;
    const ephemeralKnown=!!room?.propsComplete&&(ephemeralRaw===undefined||(ephemeralNumber!==null&&(ephemeralNumber===0||Number.isInteger(ephemeralNumber)&&ephemeralNumber>=60&&ephemeralNumber<=2_592_000)));
    return Object.freeze({owner,target,policyGeneration:room?.policyGeneration ?? generation,encryption,complete:!!room?.propsComplete&&encryption!=='unknown',
      ephemeralSeconds:ephemeralKnown&&ephemeralNumber!==null?ephemeralNumber:null,ephemeralKnown});
  }
  function conversationKeyScheme(owner: OwnerSnapshot) {
    if (!current(owner) || !mapping) return null;
    return Object.freeze({name:mapping,revision:`irc-casemapping-v1:${mapping}`} as const);
  }
  function canonicalConversationKey(owner: OwnerSnapshot, target: string): ConversationId | null {
    if (!current(owner) || !mapping || !validRoom(target)) return null;
    return makeConversationId(canonicalTupleKey([String(owner.networkId),mapping,normalizeCase(target,mapping)]));
  }
  function mappingFence(owner: OwnerSnapshot): number | null { return current(owner) && mapping ? mappingGeneration : null; }
  function roomReference(owner:OwnerSnapshot,target:string):Room|null {
    const direct=key(owner,target);const byTarget=direct?rooms.get(direct):undefined;
    if(byTarget)return byTarget;
    if(!mapping)return null;
    for(const candidate of rooms.values())if(canonicalConversationKey(owner,candidate.target)===target)return candidate;
    return null;
  }
  function roomMembershipComplete(room:Room):boolean{
    if(!room.joined||!room.completeNames||!room.modesComplete||room.hidden||room.members.size>MAX_ROSTER)return false;
    for(const member of room.members.values())if(!member.accountObserved||member.accountId===null)return false;
    return true;
  }
  /** The identity/readiness subset of roomMembershipFacts, without copying the
   *  roster. The vault write path re-checks policy several times per row, so
   *  this must stay allocation-light on rooms with thousands of members. */
  function roomPolicyFacts(owner: OwnerSnapshot,target: string): RoomPolicyFacts {
    const room=roomReference(owner,target);
    if(!room||!current(owner))return {canonicalTarget:null,scheme:null,mappingRevision:mapping?`irc-casemapping-v1:${mapping}`:'',joined:false,complete:false};
    return {canonicalTarget:room.canonical,scheme:mapping,mappingRevision:`irc-casemapping-v1:${mapping}`,joined:room.joined,complete:roomMembershipComplete(room)};
  }
  function roomMembershipFacts(owner: OwnerSnapshot,target: string): RoomMembershipFacts {
    const room=roomReference(owner,target);
    if (!room || !current(owner)) return Object.freeze({owner,target,canonicalTarget:null,scheme:null,mappingGeneration,mappingRevision:mapping?`irc-casemapping-v1:${mapping}`:'',membershipGeneration:0,joined:false,complete:false,canSend:false,memberCount:0,memberAccounts:[],members:[],ownNick:null,ownModes:[],hiddenOrAuditorium:false,sourceRevision:null});
    const members=[...room.members.values()].slice(0,MAX_ROSTER).map(m=>Object.freeze({nick:m.nick,modes:[...m.modes],accountId:m.accountId}));
    const accounts=[...new Set(members.flatMap(m=>m.accountId?[m.accountId]:[]))].sort();
    const hasVoiceOrHigher=[...room.ownModes].some(mode=>Object.hasOwn(modePrefixes,mode))||room.ownModes.has('v');
    const canSend=room.joined&&room.modesComplete&&(!room.channelModes.has('m')||hasVoiceOrHigher);
    return Object.freeze({owner,target,canonicalTarget:room.canonical,scheme:mapping,mappingGeneration,mappingRevision:`irc-casemapping-v1:${mapping}`,membershipGeneration:room.membershipGeneration,joined:room.joined,canSend,
      complete:roomMembershipComplete(room),
      memberCount:members.length,memberAccounts:Object.freeze(accounts),members:Object.freeze(members),ownNick:room.ownNick,ownModes:Object.freeze([...room.ownModes]),hiddenOrAuditorium:room.hidden,sourceRevision:room.sourceRevision});
  }
  function resolvePeerAccount(owner: OwnerSnapshot,nick: string): AccountId|null {
    if(!current(owner)||!mapping) return null;
    const canonical=normalizeCase(nick,mapping);
    for(const room of rooms.values()) { const m=room.members.get(canonical); if(room.joined&&room.completeNames&&!room.hidden&&m?.accountId) return m.accountId; }
    return null;
  }
  function resolvePeerConversation(owner:OwnerSnapshot,conversationId:ConversationId):Readonly<{
    owner:OwnerSnapshot;conversationId:ConversationId;canonicalTarget:string;accountId:AccountId;
    mappingGeneration:number;routingRevision:string;source:'authenticated-server'
  }>|null {
    if(!current(owner)||!mapping)return null;
    for(const room of rooms.values()){
      if(!room.joined||!room.completeNames||room.hidden)continue;
      for(const member of room.members.values()){
        if(!member.accountId)continue;
        if(normalizeCase(member.nick,mapping)===normalizeCase(conversationId,mapping))return Object.freeze({owner,conversationId,canonicalTarget:member.nick,accountId:member.accountId,
          mappingGeneration,routingRevision:`${mappingGeneration}:${room.membershipGeneration}:${room.sourceRevision??''}`,source:'authenticated-server'});
      }
    }
    const routeKey=directKey(owner,conversationId);const direct=routeKey?directPeers.get(routeKey):undefined;
    if(direct&&direct.complete&&direct.accountId&&current(direct.owner))return Object.freeze({owner,conversationId,canonicalTarget:direct.nick,accountId:direct.accountId,
      mappingGeneration,routingRevision:direct.revision,source:'authenticated-server'});
    return null;
  }
  function observeDmTarget(input:{readonly context:FactContext;readonly target:string}):void{
    const {owner}=input.context;const target=input.target;
    if(!current(owner)||!mapping||!validRoom(target)||target.startsWith('#')||target.startsWith('&'))return;
    const scheme=mapping;
    const k=directKey(owner,target);if(!k)return;
    const existing=directPeers.get(k);if(existing?.complete){if(!existing.metadataComplete)requestDmMetadata(owner,target);return;}
    if([...pending.values()].some(item=>item.kind==='whois'&&item.token===`dm:${normalizeCase(target,scheme)}`&&samePhysical(item.owner,owner)))return;
    const p=begin(owner,'whois',target,{token:`dm:${normalizeCase(target,scheme)}`});if(!p)return;
    directPeers.set(k,{owner,nick:target,accountId:null,complete:false,metadataComplete:false,designated:false,revision:`${mappingGeneration}:pending:${p.id}`});
    if(send(owner,formatIRCLine('WHOIS',target)).kind!=='transport-admitted')clearPending(p);
  }
  function dmPolicySnapshot(owner:OwnerSnapshot,target:string):Readonly<{owner:OwnerSnapshot;target:string;complete:boolean;encrypted:boolean;accountId:AccountId|null;revision:string|null}>{
    const k=directKey(owner,target);const direct=k?directPeers.get(k):undefined;
    if(!direct||!direct.complete||!current(owner)||direct.owner.ownerRef!==owner.ownerRef)return Object.freeze({owner,target,complete:false,encrypted:false,accountId:null,revision:null});
    return Object.freeze({owner,target,complete:direct.metadataComplete,encrypted:direct.designated,accountId:direct.accountId,
      revision:direct.metadataComplete?`dm-policy-v1:${owner.networkId}:${mapping}:${direct.accountId??'guest'}:${direct.revision}:${direct.designated?'designated':'plain'}`:null});
  }
  async function authenticatedDirectory(owner: OwnerSnapshot, account: AccountId): Promise<StructuralDirectoryFact|null> {
    if(!current(owner)||!ACCOUNT_RE.test(account)) return null;
    const cacheKey=JSON.stringify([owner.networkId,owner.accountId,account]);
    const cached=directories.get(cacheKey); if(cached) { cached.touched=now(); return cached.fact; }
    const flight=directoryFlights.get(cacheKey); if(flight) return flight;
    if(pending.size>=MAX_PENDING) return null;
    const p=begin(owner,'directory',account,{account, directory:new GroupDeviceDirectoryCollector()});
    if(!p) return null;
    const promise=new Promise<StructuralDirectoryFact|null>(resolve=>{p.resolve=(value)=>resolve(value as StructuralDirectoryFact|null)});
    directoryFlights.set(cacheKey,promise);
    const admission=send(owner,formatIRCLine('E2EEKEY','LIST',account));
    if(admission.kind!=='transport-admitted') { clearPending(p,null); directoryFlights.delete(cacheKey); return null; }
    const result=await promise;
    if(!current(owner,p.physical)) return null;
    return result as StructuralDirectoryFact|null;
  }
  async function ensureRegisteredDevice(owner: OwnerSnapshot, deviceId: string, signerPublic: Uint8Array, wrapPublic: Uint8Array): Promise<boolean> {
    if(!current(owner)||!owner.accountId||!DEVICE_RE.test(deviceId)||signerPublic.byteLength!==32||wrapPublic.byteLength!==65) return false;
    const entry={signerPub:new Uint8Array(signerPublic),encryptionPub:new Uint8Array(wrapPublic)};
    try {
      const canonical=encodeGroupDeviceDirectoryEntry(entry); if(!canonical) return false;
      const derived=await deriveGroupDeviceId(entry); if(!current(owner)||derived!==deviceId) return false;
      const account=owner.accountId;
      const existing=await authenticatedDirectory(owner,account); if(!current(owner)) return false;
      const row=existing?.snapshot.devices.find(x=>x.deviceId===deviceId);
      if(row?.algorithm==='onyx-ogc1-v1'&&row.publicKey===canonical) return true;
      if([...pending.values()].some(item=>item.kind==='publish'&&samePhysical(item.owner,owner)))return false;
      const p=begin(owner,'publish',account,{account,token:deviceId}); if(!p) return false;
      const ackPromise=new Promise<boolean>(resolve=>{p.resolve=v=>resolve(v===true)});
      const admission=send(owner,formatIRCLine('E2EEKEY','ADD',deviceId,'onyx-ogc1-v1',canonical));
      if(admission.kind!=='transport-admitted') { clearPending(p); return false; }
      const ack=await ackPromise;
      if(!ack||!current(owner,p.physical)) return false;
      directories.delete(JSON.stringify([owner.networkId,owner.accountId,account]));
      const readback=await authenticatedDirectory(owner,account); if(!readback||!current(owner)) return false;
      const verified=readback.snapshot.devices.find(x=>x.deviceId===deviceId);
      return verified?.algorithm==='onyx-ogc1-v1'&&verified.publicKey===canonical;
    } finally { entry.signerPub.fill(0); entry.encryptionPub.fill(0); }
  }
  function noteCreateIntent(input: {context:FactContext;target:string;label?:string}): string|null {
    const owner=input.context.owner;
    if(!current(owner)||!mapping||!validRoom(input.target)||!input.label||input.label.length>64||/[\s\r\n]/u.test(input.label)) return null;
    const ref=randomRef(),canonical=normalizeCase(input.target,mapping);
    if([...creates.values()].some(existing=>existing.canonical===canonical&&existing.admission!=='blocked'))return null;
    creates.set(ref,{ref,owner,target:input.target,canonical,label:input.label,admission:'pending',objectId:null,reserved:false});
    return ref;
  }
  function observeCreateAdmission(operationRef:string, admission:SendAdmission): void {
    const op=creates.get(operationRef); if(!op||!current(op.owner)) return;
    op.admission=admission.kind==='transport-admitted'?'admitted':admission.kind==='unknown'?'unknown':'blocked';
    if(op.admission==='blocked') creates.delete(operationRef);
  }
  /**
   * Fresh-room genesis proof (fail closed). A genesis is only authorized for a
   * room this owner itself CREATEd (server object id bound) and only while the
   * current, complete snapshot proves: we are still joined, we hold founder
   * (+q, or +a), we are the only member, and encryption-policy is `required`.
   * Snapshot counters are deliberately NOT part of the binding: every routine
   * MODE/PROP/NAMES refresh bumps them, so binding to them made the proof
   * unusable on a real server. Any other member (JOIN or NAMES), a lost
   * founder mode, leaving the room, or a mapping change drops the fact for
   * good. A policy other than `required` keeps it unoffered (the founder sets
   * the policy after CREATE; no other member can have been present).
   */
  function dropFreshFacts(room:Room):void {
    for(const [ref,fact] of freshFacts) if(fact.canonicalTarget===room.canonical){freshFacts.delete(ref);creates.delete(ref);}
  }
  function freshCreateCondition(owner:OwnerSnapshot,fact:FreshCreateFact):'valid'|'pending'|'invalid' {
    if(!current(owner)||fact.owner.ownerRef!==owner.ownerRef||!mapping||mappingGeneration!==fact.mappingGeneration)return 'invalid';
    const room=roomReference(owner,fact.target);
    if(!room||room.canonical!==fact.canonicalTarget||!room.joined)return 'invalid';
    const own=room.ownNick??ownNick??options.currentNick?.()??null;
    if(!own)return 'pending';
    const ownKey=normalizeCase(own,mapping);
    if([...room.members.keys()].some(key=>key!==ownKey))return 'invalid';
    if(!room.completeNames||!room.modesComplete||!room.propsComplete||!roomMembershipComplete(room)||room.members.size!==1)return 'pending';
    // Onyx Server's IRCX founder mode is `Q`; `q`/`a` cover other PREFIX maps.
    if(!room.ownModes.has('Q')&&!room.ownModes.has('q')&&!room.ownModes.has('a'))return 'invalid';
    return room.props.get('encryption-policy')==='required'?'valid':'pending';
  }
  function freshCreateFact(owner:OwnerSnapshot,target:string):FreshCreateFact|null {
    if(!current(owner)||!mapping) return null;
    const canonical=normalizeCase(target,mapping);
    for(const [ref,fact] of freshFacts) if(fact.owner.ownerRef===owner.ownerRef&&fact.canonicalTarget===canonical&&!fact.consumed) {
      const condition=freshCreateCondition(owner,fact);
      if(condition==='invalid'){freshFacts.delete(ref);continue;}
      if(condition!=='valid')return null;
      const room=roomReference(owner,fact.target)!;
      return Object.freeze({...fact,membershipGeneration:room.membershipGeneration,policyGeneration:room.policyGeneration});
    }
    return null;
  }
  function reserveFreshCreateFact(owner:OwnerSnapshot,target:string):FreshCreateFact|null {
    const fact=freshCreateFact(owner,target); if(!fact||fact.consumed) return null;
    const stored=freshFacts.get(fact.operationRef); if(!stored) return null;
    freshFacts.set(fact.operationRef,Object.freeze({...stored,consumed:true}));
    return Object.freeze({...fact,consumed:true});
  }
  function validateFreshCreateFact(fact:FreshCreateFact):boolean {
    const stored=freshFacts.get(fact.operationRef);
    if(!stored||stored.consumed!==fact.consumed||!current(fact.owner)||mappingGeneration!==fact.mappingGeneration
      ||stored.objectId!==fact.objectId||stored.canonicalTarget!==fact.canonicalTarget)return false;
    const condition=freshCreateCondition(fact.owner,stored);
    if(condition==='invalid'){freshFacts.delete(fact.operationRef);return false;}
    return condition==='valid';
  }
  async function ingest(input:{physicalContext:OwnerSnapshot;line:string;sourceKind:PrivateIngressEvent['sourceKind']}):Promise<void> {
    const owner=input.physicalContext;
    if(!current(owner)||!samePhysical(owner,options.ownerSnapshot())||input.line.length>64*1024||/[\r\n\u0000]/u.test(input.line)) return;
    const msg=parseIRCMessage(input.line); if(!msg.command) return;
    const server=options.currentServerPrefix();
    const serverSource=!!server&&msg.prefix===server;
    if(input.sourceKind==='server'&&!serverSource)return;
    if(input.sourceKind==='user'&&(!msg.prefix||serverSource))return;
    if(input.sourceKind==='prefixless-protocol')return;
    const own=ownNick??options.currentNick?.()??null;
    if(msg.command==='001'&&serverSource) { ownNick=msg.params[0]??ownNick; return; }
    if(msg.command==='005'&&serverSource) {
      const previousJoined=[...rooms.values()].filter(room=>room.joined).map(room=>room.target);
      for(const token of msg.params) {
        const [name,value]=token.split('=',2);
        if(name==='WHOX') advertised.add('WHOX');
        if(name==='-WHOX') advertised.delete('WHOX');
        const nextMapping:CaseMapping|null=name==='CASEMAPPING'
          ? value==='ascii'||value==='rfc1459'||value==='strict-rfc1459'?value:null
          : name==='-CASEMAPPING'?null:mapping;
        if((name==='CASEMAPPING'||name==='-CASEMAPPING')&&nextMapping!==mapping) {
          mapping=nextMapping; mappingGeneration++; generation++; rooms.clear(); directPeers.clear(); freshFacts.clear(); creates.clear(); directoryFlights.clear();
          for(const p of pending.values()) clearPending(p,null);
          invalidate(owner,null,'mapping-changed');
          // A supported replacement mapping can re-request snapshots for the
          // same joined rooms. Removal/unknown values leave target identity
          // unproved until another explicit supported CASEMAPPING arrives.
          if(mapping!==null)for(const target of previousJoined){const room=getRoom(owner,target);if(room){room.joined=true;refresh(owner,room);}}
        } else if(name==='PREFIX'&&value) { const parsed=parsePREFIX(value); if(Object.keys(parsed.prefixToMode).length){prefixModes=parsed.prefixToMode;modePrefixes=parsed.modeToPrefix;} }
      }
      return;
    }
    if(!mapping) return;
    const scheme=mapping;
    if(msg.command==='NICK'&&msg.nick&&msg.params[0]) {
      directPeers.clear();
      const from=normalizeCase(msg.nick,scheme),to=msg.params[0];
      for(const room of rooms.values()) { const m=room.members.get(from); if(m){room.members.delete(from);m.nick=to;room.members.set(normalizeCase(to,scheme),m);membershipChanged(owner,room);} if(own&&from===normalizeCase(own,scheme)) room.ownNick=to; }
      if(own&&from===normalizeCase(own,scheme)) ownNick=to; return;
    }
    if(msg.command==='JOIN'&&msg.nick&&msg.params[0]) {
      const target=msg.params[0],room=getRoom(owner,target); if(!room)return;
      const n=normalizeCase(msg.nick,scheme);
      if(own&&n===normalizeCase(own,scheme)){ room.joined=true;room.completeNames=false;room.propsComplete=false;room.members.clear();room.membershipGeneration++;refresh(owner,room); }
      else if(msg.prefix&&serverSource===false){
        const taggedAccount=msg.tags.account;const resolvedAccount=taggedAccount==='*'?null:accountId(taggedAccount??'');
        room.members.set(n,{nick:msg.nick,modes:new Set(),accountId:resolvedAccount,accountObserved:taggedAccount==='*'||resolvedAccount!==null,whoisAttempted:false});membershipChanged(owner,room);
        dropFreshFacts(room);
      }
      return;
    }
    if(msg.command==='PART'&&msg.nick&&msg.params[0]) { const room=getRoom(owner,msg.params[0]); if(room){const self=own&&normalizeCase(msg.nick,scheme)===normalizeCase(own,scheme);room.members.delete(normalizeCase(msg.nick,scheme));if(self)room.joined=false;membershipChanged(owner,room);}return; }
    if(msg.command==='KICK'&&msg.params[0]&&msg.params[1]) { const room=getRoom(owner,msg.params[0]);if(room){const self=own&&normalizeCase(msg.params[1],scheme)===normalizeCase(own,scheme);room.members.delete(normalizeCase(msg.params[1],scheme));if(self)room.joined=false;membershipChanged(owner,room);}return; }
    if(msg.command==='QUIT'&&msg.nick) { directPeers.clear();for(const room of rooms.values()){if(room.members.delete(normalizeCase(msg.nick,scheme)))membershipChanged(owner,room);}return; }
    if(msg.command==='ACCOUNT'&&msg.nick&&msg.params[0]) {
      directPeers.clear();
      const raw=msg.params[0]!;const value=raw==='*'?null:accountId(raw);if(raw!=='*'&&!value)return;
      for(const room of rooms.values()){const m=room.members.get(normalizeCase(msg.nick,scheme));if(m){m.accountId=value;m.accountObserved=true;membershipChanged(owner,room);}}
      return;
    }
    if(msg.command==='MODE'&&msg.params[0]) {
      const room=getRoom(owner,msg.params[0]);
      if(room){
        room.modesComplete=false;
        const modeWord=msg.params.find(value=>/^[+-][A-Za-z]+$/u.test(value));
        const actor=msg.nick;
        if(modeWord){let adding=true;for(const mode of modeWord.slice(1)){if(mode==='+'){adding=true;continue;}if(mode==='-'){adding=false;continue;}if(Object.hasOwn(prefixModes,mode))continue;if(adding)room.channelModes.add(mode);else room.channelModes.delete(mode);}}
        const memberNick=msg.params.find((value,index)=>index>0&&room.members.has(normalizeCase(value,scheme)));
        if(modeWord&&memberNick){
          const member=room.members.get(normalizeCase(memberNick,scheme));
          if(member){let adding=true;for(const mode of modeWord.slice(1)){if(mode==='+'){adding=true;continue;}if(mode==='-'){adding=false;continue;}if(adding)member.modes.add(mode);else member.modes.delete(mode);if(member.nick===room.ownNick){if(adding)room.ownModes.add(mode);else room.ownModes.delete(mode);}}}
        }
        if(actor&&own&&normalizeCase(actor,scheme)===normalizeCase(own,scheme)) room.ownNick=actor;
        const old=findRoomPending(owner,'mode',room.target);if(old)clearPending(old);
        membershipChanged(owner,room);
      }
      return;
    }
    if(msg.command==='PROP'&&msg.params[0]) {
      const room=getRoom(owner,msg.params[0]);
      if(room){const name=msg.params[1],value=msg.params[2];if(name){if(value===undefined||value==='*')room.props.delete(name);else room.props.set(name,value);room.propsComplete=false;const old=findRoomPending(owner,'prop',room.target);if(old)clearPending(old);invalidate(owner,room,'policy-changed');refresh(owner,room);} }
      return;
    }
    if(!serverSource) return;
    if(msg.command==='324'&&msg.params[1]) {
      const room=getRoom(owner,msg.params[1]);if(!room)return;
      const p=findRoomPending(owner,'mode',room.target);if(!p)return;
      const modeWord=msg.params.find(value=>/^[+-][A-Za-z]+$/u.test(value));
      if(!modeWord)return;
      room.channelModes.clear();
      {let adding=true;for(const mode of modeWord.slice(1)){if(mode==='+'){adding=true;continue;}if(mode==='-'){adding=false;continue;}if(!Object.hasOwn(prefixModes,mode)&&adding)room.channelModes.add(mode);}}
      // Onyx Server letters: x = AUDITORIUM (NAMES visibility is rank-filtered),
      // h = HIDDEN. Keep the legacy s/A spellings so this only ever fails closed.
      room.hidden=/[xhsA]/u.test(modeWord.slice(1));
      room.modesComplete=true;room.sourceRevision=`mode:${owner.connectionGeneration}:${room.membershipGeneration}`;
      clearPending(p);finishRoomIfReady(owner,room);return;
    }
    if(msg.command==='818'&&msg.params[1]) {
      const room=getRoom(owner,msg.params[1]);if(!room)return;
      const prop=msg.params[2],value=msg.params[3];
      if(!findRoomPending(owner,'prop',room.target)){
        // Onyx Server answers the setter's own PROP write with 818/819 only (no
        // PROP broadcast to the setter). An unrequested 818 whose value differs
        // from the known snapshot is a policy change: invalidate and refresh.
        // Equal values (e.g. replies to the UI's own PROP queries) are ignored
        // so this can never loop.
        if(room.joined&&prop&&value!==undefined&&room.props.get(prop)!==value){
          room.props.set(prop,value);room.propsComplete=false;const old=findRoomPending(owner,'prop',room.target);if(old)clearPending(old);
          invalidate(owner,room,'policy-changed');refresh(owner,room);
        }
        return;
      }
      if(prop&&value!==undefined)room.props.set(prop,value);return;
    }
    if(msg.command==='819'&&msg.params[1]) {
      const room=getRoom(owner,msg.params[1]);if(!room)return;
      const p=findRoomPending(owner,'prop',room.target);if(!p)return;
      room.propsComplete=true;room.policyGeneration++;room.sourceRevision=`prop:${owner.connectionGeneration}:${room.policyGeneration}`;clearPending(p);finishRoomIfReady(owner,room);return;
    }
    if(msg.command==='353'&&msg.params.length>=4) {
      const target=msg.params[2]!,room=getRoom(owner,target);if(!room)return;
      const query=findRoomPending(owner,'names',target); if(!query)return;
      const names=msg.params.at(-1)??'';
      for(const token of names.split(/\s+/u).filter(Boolean)) {
        if(room.members.size>=MAX_ROSTER){room.hidden=true;room.completeNames=false;break;}
        const parsed=parseNamesPrefix(token,prefixModes); if(!parsed.nick||!validRoom(parsed.nick))continue;
        const canonical=normalizeCase(parsed.nick,scheme); const tagged=msg.tags.account;
        const resolvedAccount=tagged==='*'?null:accountId(tagged??'');
        room.members.set(canonical,{nick:parsed.nick,modes:parsed.modes,accountId:resolvedAccount,accountObserved:tagged==='*'||resolvedAccount!==null,whoisAttempted:false});
        if(own&&canonical===normalizeCase(own,scheme)) {room.ownNick=parsed.nick;room.ownModes=new Set(parsed.modes);}
      }
      query.rows++;return;
    }
    if(msg.command==='366'&&msg.params[1]) { const room=getRoom(owner,msg.params[1]);if(room){const p=findRoomPending(owner,'names',room.target);if(p){room.completeNames=!room.hidden;room.membershipGeneration++;room.sourceRevision=`names:${owner.connectionGeneration}:${room.membershipGeneration}`;clearPending(p);if(!advertised.has('WHOX'))issueFallbackWhois(owner,room);else finishRoomIfReady(owner,room);}}return; }
    if(msg.command==='354'&&msg.params.length>=6) {
      const token=msg.params[1]!,p=[...pending.values()].find(x=>x.kind==='whois'&&x.token===token&&samePhysical(x.owner,owner));if(!p)return;
      const target=msg.params[2]!,nick=msg.params[3]!,rawAccount=msg.params[5]!,account=rawAccount==='*'?null:accountId(rawAccount);
      if(normalizeCase(target,scheme)!==normalizeCase(p.target,scheme))return;
      const room=getRoom(owner,target);if(room){const member=room.members.get(normalizeCase(nick,scheme));if(member&&(account!==null||rawAccount==='*')){member.accountId=account;member.accountObserved=true;room.membershipGeneration++;}}
      return;
    }
    if(msg.command==='311'&&msg.params.length>=6) {
      const nick=msg.params[1]!;
      const p=[...pending.values()].find(x=>x.kind==='whois'&&x.memberNick!==undefined&&x.token?.startsWith('fallback:')
        && samePhysical(x.owner,owner)&&normalizeCase(x.memberNick,scheme)===normalizeCase(nick,scheme));
      if(p&&p.member&&p.namesGeneration===getRoom(owner,p.target)?.namesGeneration&&getRoom(owner,p.target)?.members.get(normalizeCase(nick,scheme))===p.member) p.whoisUserSeen=true;
      const dm=[...pending.values()].find(x=>x.kind==='whois'&&x.token===`dm:${normalizeCase(nick,scheme)}`&&samePhysical(x.owner,owner));
      if(dm)dm.whoisUserSeen=true;
      return;
    }
    if((msg.command==='315'||msg.command==='318')&&msg.params[1]) {
      const target=msg.params[1]!;
      const dmPending=msg.command==='318'?[...pending.values()].find(x=>x.kind==='whois'&&x.token===`dm:${normalizeCase(target,scheme)}`&&samePhysical(x.owner,owner)):undefined;
      if(dmPending){const k=directKey(owner,target);const direct=k?directPeers.get(k):undefined;
        const complete=!!direct&&dmPending.whoisUserSeen===true;
        if(direct){direct.complete=complete;directPeers.set(k!,{...direct,complete,revision:`${mappingGeneration}:whois:${dmPending.id}:${direct.accountId??'guest'}`});}
        clearPending(dmPending,true);
        if(direct&&complete)requestDmMetadata(owner,target);
        return;}
      const fallback=msg.command==='318'?[...pending.values()].find(x=>x.kind==='whois'&&x.token?.startsWith('fallback:')&&samePhysical(x.owner,owner)&&x.token.slice(9)===normalizeCase(target,scheme)):undefined;
      const whox=msg.command==='315'?[...pending.values()].find(x=>x.kind==='whois'&&x.token&&!x.token.startsWith('fallback:')&&samePhysical(x.owner,owner)&&normalizeCase(x.target,scheme)===normalizeCase(target,scheme)):undefined;
      const p=fallback??whox;if(p){const room=getRoom(owner,p.target);
        if(fallback&&room&&p.member&&p.whoisUserSeen===true&&p.whoisAccountSeen!==true
          &&p.namesGeneration===room.namesGeneration&&room.members.get(normalizeCase(p.memberNick??'',scheme))===p.member){p.member.accountId=null;p.member.accountObserved=true;}
        clearPending(p,true);if(room){if(fallback){finishRoomIfReady(owner,room);continueFallbackWhois(owner);}else finishRoomIfReady(owner,room);}}return;
    }
    if(msg.command==='401'&&msg.params[1]) {
      const nick=msg.params[1]!;
      const p=[...pending.values()].find(x=>x.kind==='whois'&&samePhysical(x.owner,owner)
        &&(x.token===`dm:${normalizeCase(nick,scheme)}`||x.token?.startsWith('fallback:')&&normalizeCase(x.memberNick??'',scheme)===normalizeCase(nick,scheme)));
      if(p){const room=p.token?.startsWith('fallback:')?getRoom(owner,p.target):null;clearPending(p,null);
        options.onInvalidation?.({owner,target:p.target,reason:'membership-incomplete'});
        if(room)continueFallbackWhois(owner);}
      return;
    }
    if(msg.command==='330'&&msg.params.length>=3) {
      const nick=msg.params[1]!,account=accountId(msg.params[2]!);
      const dmPending=[...pending.values()].find(x=>x.kind==='whois'&&x.token===`dm:${normalizeCase(nick,scheme)}`&&samePhysical(x.owner,owner));
      if(dmPending&&account){const k=directKey(owner,nick);const direct=k?directPeers.get(k):undefined;if(direct)directPeers.set(k!,{...direct,accountId:account});dmPending.whoisAccountSeen=true;return;}
      const pendingWhois=[...pending.values()].find(x=>x.kind==='whois'&&x.token?.startsWith('fallback:')&&samePhysical(x.owner,owner)&&x.token.slice(9)===normalizeCase(nick,scheme));
      if(!pendingWhois||!account||!pendingWhois.member||pendingWhois.namesGeneration!==getRoom(owner,pendingWhois.target)?.namesGeneration
        ||getRoom(owner,pendingWhois.target)?.members.get(normalizeCase(nick,scheme))!==pendingWhois.member)return;
      pendingWhois.member.accountId=account;pendingWhois.member.accountObserved=true;pendingWhois.whoisAccountSeen=true;
      for(const room of rooms.values()){const m=room.members.get(normalizeCase(nick,scheme));if(m){m.accountId=account;m.accountObserved=true;room.membershipGeneration++;}}
      return;
    }
    if(msg.command==='761'&&msg.params.length>=5){
      const target=msg.params[1]!,prop=msg.params[2]!,value=msg.params.at(-1)??'';
      const p=[...pending.values()].find(item=>item.kind==='metadata'&&item.token===`dm:${normalizeCase(target,scheme)}`&&samePhysical(item.owner,owner));
      const k=directKey(owner,target);const direct=k?directPeers.get(k):undefined;
      if(p&&direct&&['ocean.dm-key','ocean.dm-keys'].includes(prop)){
        const validKey=value.length>0&&enc.encode(value).byteLength<=4096&&!/[\u0000-\u001f\u007f]/u.test(value);
        if(validKey)directPeers.set(k!,{...direct,designated:true});
        p.rows++;
      }
      return;
    }
    if(msg.command==='766'&&msg.params.length>=3){
      const target=msg.params[1]!,p=[...pending.values()].find(item=>item.kind==='metadata'&&item.token===`dm:${normalizeCase(target,scheme)}`&&samePhysical(item.owner,owner));
      if(p&&['ocean.dm-key','ocean.dm-keys'].includes(msg.params[2]??''))p.rows++;
      return;
    }
    if(msg.command==='762'){
      const p=[...pending.values()].find(item=>item.kind==='metadata'&&samePhysical(item.owner,owner));
      if(p){const k=directKey(owner,p.target);const direct=k?directPeers.get(k):undefined;
        if(direct)directPeers.set(k!,{...direct,metadataComplete:true,revision:`${direct.revision}:metadata:${p.rows}`});clearPending(p,true);}
      return;
    }
    if(msg.command==='NOTICE'&&msg.params.length) {
      const body=msg.params.at(-1)??'';
      if(body.startsWith('E2EEKEY DEVICE ')||body.startsWith('E2EEKEY END ')) {
        const parsedAccount=/\baccount=([A-Za-z0-9_.@-]{1,64})\b/u.exec(body)?.[1];
        const p=[...pending.values()].find(x=>x.kind==='directory'&&x.account===parsedAccount&&x.directory);
        if(p){
          const accepted=p.directory!.accept(body); p.rows++;
          if(!accepted||p.directory!.isFailed){ clearPending(p,null); return; }
          if(body.startsWith('E2EEKEY END ')) {
            const snapshot=await p.directory!.complete();
            if(!current(owner,p.physical)){clearPending(p,null);return;}
            const fact=snapshot?Object.freeze({owner:p.owner,accountId:p.account as AccountId,revision:`directory:${p.owner.connectionGeneration}:${now()}`,provenance:'authenticated-exact-server' as const,trusted:false as const,snapshot}):null;
            if(fact){
              const cacheKey=JSON.stringify([owner.networkId,owner.accountId,p.account]);
              directories.set(cacheKey,{fact,touched:now()});
              while(directories.size>MAX_DIRECTORIES){let oldest:string|undefined;let touched=Infinity;for(const [k,v] of directories){if(v.touched<touched){oldest=k;touched=v.touched;}}if(!oldest)break;directories.delete(oldest);}
            }
            const cacheKey=JSON.stringify([owner.networkId,owner.accountId,p.account]);
            clearPending(p,fact);directoryFlights.delete(cacheKey);
          }
          return;
        }
      }
      if(body.startsWith('E2EEKEY ADDED ')) {
        const match=/^E2EEKEY ADDED id=([A-Za-z0-9_.-]{1,32}) alg=([A-Za-z0-9_.-]{1,64})$/u.exec(body);
        const p=[...pending.values()].find(x=>x.kind==='publish'&&samePhysical(x.owner,owner));
        if(p&&match&&p.account===owner.accountId&&p.token===match[1]&&match[2]==='onyx-ogc1-v1')clearPending(p,true);return;
      }
      return;
    }
    if(msg.command==='CREATE'&&msg.params.length>=2&&msg.prefix===server) {
      const target=msg.params[0]!,oid=objectId(msg.params[1]!);if(!oid)return;
      const canonical=normalizeCase(target,scheme);
      const label=msg.tags.label;
      const op=[...creates.values()].find(x=>x.canonical===canonical&&samePhysical(x.owner,owner)&&x.admission==='admitted'&&(label===undefined||label===x.label));
      if(!op)return;
      // The real server sends `CREATE <oid>` to the creator right after its
      // JOIN, before the MODE/PROP/NAMES snapshot this collector requests can
      // complete. Record a pending founder fact bound to the server object id;
      // freshCreateCondition() decides at every use whether it is still valid.
      const room=getRoom(owner,target);if(!room?.joined)return;
      const fact:FreshCreateFact=Object.freeze({owner,operationRef:op.ref,target,canonicalTarget:canonical,objectId:oid,mappingGeneration,membershipGeneration:room.membershipGeneration,policyGeneration:room.policyGeneration,founder:true,consumed:false});
      op.objectId=oid;freshFacts.set(op.ref,fact);return;
    }
    if(msg.command==='FAIL'&&msg.params.includes('E2EEKEY')) {
      const p=[...pending.values()].find(x=>x.kind==='publish'&&samePhysical(x.owner,owner));if(p)clearPending(p,false);
    }
  }

  function retire(_owner?:OwnerSnapshot):void {
    generation++; for(const p of pending.values())clearPending(p,null);pending.clear();directoryFlights.clear();rooms.clear();directories.clear();creates.clear();freshFacts.clear();
    if(!_owner){mapping=null;mappingGeneration++;directPeers.clear();}
  }
  function dispose():void { if(disposed)return;retire();disposed=true;listeners.dispose(); }
  return Object.freeze({ ingest, onRegistered, observeJoinedTarget, policySnapshot, canonicalConversationKey, conversationKeyScheme, mappingFence,
    roomMembershipFacts, roomPolicyFacts, resolvePeerAccount, resolvePeerConversation, observeDmTarget, dmPolicySnapshot, authenticatedDirectory, ensureRegisteredDevice, noteCreateIntent, observeCreateAdmission,
    freshCreateFact, reserveFreshCreateFact, validateFreshCreateFact, retire, dispose });
}


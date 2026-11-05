import { describe, expect, it, vi } from 'vitest';
import { createAuthenticatedFacts } from './authenticated-facts';
import { makeAccountGeneration, makeAccountId, makeConnectionGeneration, makeLocalPhysicalEpoch, makeNetworkId, makeOwnerRef, type OwnerSnapshot, type Transport } from './contracts';

function harness() {
  const owner: OwnerSnapshot = {
    networkId: makeNetworkId('custom:wss://facts.test/ws')!, accountId: makeAccountId('alice')!,
    accountGeneration: makeAccountGeneration(1)!, connectionGeneration: makeConnectionGeneration(1)!,
    physicalRef: makeLocalPhysicalEpoch('0123456789abcdef0123456789abcdef')!, ownerRef: makeOwnerRef('abcdefghijklmnopqrstuv')!,
  };
  const sent: string[] = [];
  const transport = {
    isCurrent: (candidate: OwnerSnapshot) => candidate.ownerRef === owner.ownerRef,
    ownerSnapshot: () => owner,
    sendLine: ({line}: {line:string}) => { sent.push(line); return {kind:'transport-admitted'} as const; },
    sendLineGroup: ({lines}: {lines:readonly string[]}) => { sent.push(...lines); return lines.map(() => ({kind:'transport-admitted'} as const)); },
    sendBinary: () => ({kind:'blocked',reason:'policy'} as const),
    onPrivateIngress: () => ({ dispose() {} }),
    onAuthenticatedServerEvent: () => ({dispose(){}}), onBinary: () => ({dispose(){}}), dispose() {},
  } as unknown as Transport;
  const invalidations: Array<{ readonly target: string | null; readonly reason: string }> = [];
  const service=createAuthenticatedFacts({ownerSnapshot:()=>owner,isCurrent:()=>true,transport,currentServerPrefix:()=> 'irc.facts.test',currentNick:()=> 'Alice',
    onInvalidation:event=>invalidations.push({target:event.target,reason:event.reason})});
  return {owner,sent,service,invalidations};
}

describe('authenticated facts collector', () => {
  it('room policy facts agree with the full membership snapshot without copying the roster', () => {
    const {owner,service}=harness();
    const same=(target:string)=>{const full=service.roomMembershipFacts(owner,target);const light=service.roomPolicyFacts(owner,target);
      expect(light).toEqual({canonicalTarget:full.canonicalTarget,scheme:full.scheme,mappingRevision:full.mappingRevision,joined:full.joined,complete:full.complete});};
    same('#room');
    void service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice CASEMAPPING=rfc1459 :supported'});
    same('#room');
    void service.ingest({physicalContext:owner,sourceKind:'user',line:':Alice!a@h JOIN #room'});
    same('#room');
    expect(service.roomPolicyFacts(owner,'#room').joined).toBe(true);
    void service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 353 Alice = #room :Alice Bob'});
    void service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 366 Alice #room :End'});
    same('#room');
    same('#ROOM');
    service.dispose();
  });
  it('accepts only exact-server mapping facts and keeps a monotonic mapping fence', () => {
    const {owner,service}=harness();
    void service.ingest({physicalContext:owner,sourceKind:'server',line:':evil.test 005 Alice CASEMAPPING=ascii :supported'});
    expect(service.conversationKeyScheme(owner)).toBeNull();
    void service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice CASEMAPPING=ascii :supported'});
    const first=service.mappingFence(owner);
    expect(service.conversationKeyScheme(owner)?.revision).toBe('irc-casemapping-v1:ascii');
    void service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice CASEMAPPING=rfc1459 :supported'});
    expect(service.mappingFence(owner)).toBeGreaterThan(first ?? -1);
    expect(service.canonicalConversationKey(owner,'#Room[]')).toBe(service.canonicalConversationKey(owner,'#room{}'));
    service.dispose();
  });

  it('revokes CASEMAPPING identity, room snapshots and pending requests when the token is removed', async () => {
    const {owner,sent,service,invalidations}=harness();
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice CASEMAPPING=rfc1459 :supported'});
    const oldFence=service.mappingFence(owner);
    service.observeJoinedTarget({owner},'#room');
    expect(sent).toEqual(['MODE #room','PROP #room','NAMES #room']);
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice -CASEMAPPING CASEMAPPING=ascii :supported'});
    expect(service.conversationKeyScheme(owner)?.name).toBe('ascii');
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice CASEMAPPING=rfc1459 -CASEMAPPING :supported'});

    expect(service.conversationKeyScheme(owner)).toBeNull();
    expect(service.mappingFence(owner)).toBeNull();
    expect(service.canonicalConversationKey(owner,'#room')).toBeNull();
    expect(service.policySnapshot(owner,'#room')).toMatchObject({encryption:'unknown',complete:false});
    expect(service.roomMembershipFacts(owner,'#room')).toMatchObject({joined:false,complete:false,canSend:false});
    expect(invalidations).toContainEqual({target:null,reason:'mapping-changed'});

    const requestsBeforeUnmappedJoin = sent.length;
    service.observeJoinedTarget({owner},'#room');
    expect(sent.slice(requestsBeforeUnmappedJoin)).toEqual([]);
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice CASEMAPPING=ascii :supported'});
    expect(service.conversationKeyScheme(owner)?.name).toBe('ascii');
    expect(service.mappingFence(owner)).toBeGreaterThan(oldFence ?? -1);
    service.dispose();
  });

  it('treats an unsupported CASEMAPPING replacement as unproven identity', async () => {
    const {owner,service}=harness();
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice CASEMAPPING=strict-rfc1459 :supported'});
    expect(service.conversationKeyScheme(owner)?.name).toBe('strict-rfc1459');
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice CASEMAPPING=unicode :supported'});
    expect(service.conversationKeyScheme(owner)).toBeNull();
    expect(service.mappingFence(owner)).toBeNull();
    expect(service.canonicalConversationKey(owner,'#room')).toBeNull();
    service.dispose();
  });

  it('requests bounded real snapshots after self JOIN and leaves missing policy/account facts unknown', async () => {
    const {owner,sent,service}=harness();
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice CASEMAPPING=rfc1459 PREFIX=(qaohv)~&@%+ :supported'});
    service.observeJoinedTarget({owner},'#room');
    expect(sent).toEqual(['MODE #room','PROP #room','NAMES #room']);
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 353 Alice = #room :@Alice bob'});
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 366 Alice #room :end'});
    expect(service.policySnapshot(owner,'#room').encryption).toBe('unknown');
    const facts=service.roomMembershipFacts(owner,'#room');
    expect(facts.complete).toBe(false);
    expect(facts.memberAccounts).toEqual([]);
    service.dispose();
  });

  it('treats Onyx Server auditorium (+x) and hidden (+h) rooms as rank-filtered rosters', async () => {
    for (const letter of ['x','h']) {
      const {owner,service}=harness();
      await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice CASEMAPPING=rfc1459 PREFIX=(qaohv)~&@%+ :supported'});
      service.observeJoinedTarget({owner},'#aud');
      await service.ingest({physicalContext:owner,sourceKind:'server',line:`:irc.facts.test 324 Alice #aud +nt${letter}`});
      await service.ingest({physicalContext:owner,sourceKind:'server',line:'@account=bob :irc.facts.test 353 Alice = #aud :@Alice Bob'});
      await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 366 Alice #aud :end'});
      const facts=service.roomMembershipFacts(owner,'#aud');
      expect(facts.hiddenOrAuditorium).toBe(true);
      expect(facts.complete).toBe(false);
      expect(service.roomPolicyFacts(owner,'#aud').complete).toBe(false);
      expect(service.resolvePeerAccount(owner,'Bob')).toBeNull();
      service.dispose();
    }
  });

  it('keeps moderated channel sending blocked until the current roster grants voice or higher', async () => {
    const {owner,service}=harness();
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice CASEMAPPING=rfc1459 PREFIX=(qaohv)~&@%+ :supported'});
    service.observeJoinedTarget({owner},'#moderated');
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 324 Alice #moderated +m'});
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 353 Alice = #moderated :Alice'});
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 366 Alice #moderated :end'});
    expect(service.roomMembershipFacts(owner,'#moderated').canSend).toBe(false);
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test MODE #moderated +v Alice'});
    expect(service.roomMembershipFacts(owner,'#moderated').canSend).toBe(false);
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 324 Alice #moderated +m'});
    expect(service.roomMembershipFacts(owner,'#moderated').canSend).toBe(true);
    service.dispose();
  });

  it('finishes fallback WHOIS for a proved guest without mistaking that guest for an encrypted member', async () => {
    const {owner,sent,service}=harness();
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice CASEMAPPING=rfc1459 PREFIX=(qaohv)~&@%+ :supported'});
    service.observeJoinedTarget({owner},'#guest-room');
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 324 Alice #guest-room +n'});
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 818 Alice #guest-room encryption-policy required'});
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 819 Alice #guest-room :end'});
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 353 Alice = #guest-room :guest'});
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 366 Alice #guest-room :end'});
    expect(sent.filter(line=>line==='WHOIS guest')).toHaveLength(1);
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 311 Alice guest user host * :Guest User'});
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 318 Alice guest :End of WHOIS'});
    expect(sent.filter(line=>line==='WHOIS guest')).toHaveLength(1);
    expect(service.policySnapshot(owner,'#guest-room')).toMatchObject({encryption:'required',complete:true});
    expect(service.roomMembershipFacts(owner,'#guest-room')).toMatchObject({canSend:true,complete:false,memberAccounts:[]});
    service.dispose();
  });

  it('keeps completed MODE and PROP facts when fallback WHOIS times out', async () => {
    vi.useFakeTimers();
    const {owner,sent,service}=harness();
    try {
      await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice CASEMAPPING=rfc1459 PREFIX=(qaohv)~&@%+ :supported'});
      service.observeJoinedTarget({owner},'#whois-timeout');
      await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 324 Alice #whois-timeout +n'});
      await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 818 Alice #whois-timeout encryption-policy required'});
      await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 819 Alice #whois-timeout :end'});
      await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 353 Alice = #whois-timeout :unresolved'});
      await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 366 Alice #whois-timeout :end'});
      expect(sent).toContain('WHOIS unresolved');
      await vi.advanceTimersByTimeAsync(10_001);
      expect(service.policySnapshot(owner,'#whois-timeout')).toMatchObject({encryption:'required',complete:true});
      expect(service.roomMembershipFacts(owner,'#whois-timeout')).toMatchObject({canSend:true,complete:false,memberAccounts:[]});
    } finally {
      service.dispose();
      vi.useRealTimers();
    }
  });

  it('rejects stale physical context and does not let a JOIN mint genesis', async () => {
    const {owner,sent,service}=harness();
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice CASEMAPPING=rfc1459 :supported'});
    const stale={...owner,physicalRef:makeLocalPhysicalEpoch('fedcba9876543210fedcba9876543210')!};
    await service.ingest({physicalContext:stale,sourceKind:'server',line:':irc.facts.test CREATE #room 01234567'});
    service.observeJoinedTarget({owner},'#room');
    expect(service.freshCreateFact(owner,'#room')).toBeNull();
    expect(sent).not.toContain('CREATE #room');
    service.dispose();
  });

  it('requires tracked CREATE admission and exact server 0+8hex object reply for a one-use genesis fact', async () => {
    const {owner,sent,service}=harness();
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice CASEMAPPING=rfc1459 PREFIX=(qaohv)~&@%+ WHOX :supported'});
    service.observeJoinedTarget({owner},'#genesis');
    const whoLine=sent.find(line=>line.startsWith('WHO #genesis '));
    const whoToken=whoLine?.match(/%tcnfa,([0-9]+)/u)?.[1];
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 324 Alice #genesis +n'});
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 818 Alice #genesis encryption-policy required'});
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 819 Alice #genesis :end'});
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 353 Alice = #genesis :~Alice'});
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 366 Alice #genesis :end'});
    if(whoToken) await service.ingest({physicalContext:owner,sourceKind:'server',line:`:irc.facts.test 354 Alice ${whoToken} #genesis Alice ~ alice`});
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 315 Alice #genesis :end'});
    const operation=service.noteCreateIntent({context:{owner},target:'#genesis',label:'create-1'});
    expect(operation).not.toBeNull();
    service.observeCreateAdmission(operation!,{kind:'transport-admitted'});
    await service.ingest({physicalContext:owner,sourceKind:'server',line:'@label=create-1 :irc.facts.test CREATE #genesis 0abcdef12'});
    const proof=service.freshCreateFact(owner,'#genesis');
    expect(proof?.objectId).toBe('0abcdef12');
    const reserved=service.reserveFreshCreateFact(owner,'#genesis');
    expect(reserved?.consumed).toBe(true);
    expect(service.reserveFreshCreateFact(owner,'#genesis')).toBeNull();
    expect(reserved&&service.validateFreshCreateFact(reserved)).toBe(true);
    service.dispose();
  });
  it('drops a peer\'s old binding on ACCOUNT, re-snapshots the room, and ignores non-members', async () => {
    const {owner,sent,service}=harness();
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice CASEMAPPING=rfc1459 PREFIX=(qaohv)~&@%+ :supported'});
    service.observeJoinedTarget({owner},'#room');
    const names=async (rows:ReadonlyArray<readonly [string,string]>)=>{
      for(const [nick,account] of rows)await service.ingest({physicalContext:owner,sourceKind:'server',line:`@account=${account} :irc.facts.test 353 Alice = #room :${nick}`});
      await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 366 Alice #room :end'});
    };
    await names([['@Alice','alice'],['Bob','bob'],['Carol','carol']]);
    const accounts=()=>Object.fromEntries(service.roomMembershipFacts(owner,'#room').members.map(member=>[member.nick,member.accountId]));
    expect(accounts()).toEqual({Alice:'alice',Bob:'bob',Carol:'carol'});
    expect(service.resolvePeerAccount(owner,'Bob')).toBe('bob');
    const namesQueries=()=>sent.filter(line=>line==='NAMES #room').length;

    // A non-member ACCOUNT (or a malformed one) changes nothing and asks nothing.
    const generation=service.roomMembershipFacts(owner,'#room').membershipGeneration;
    const queries=namesQueries();
    await service.ingest({physicalContext:owner,sourceKind:'user',line:':Dave!d@h ACCOUNT dave'});
    await service.ingest({physicalContext:owner,sourceKind:'user',line:':Bob!b@h ACCOUNT bad/account'});
    expect(accounts()).toEqual({Alice:'alice',Bob:'bob',Carol:'carol'});
    expect(service.roomMembershipFacts(owner,'#room').membershipGeneration).toBe(generation);
    expect(namesQueries()).toBe(queries);
    expect(service.resolvePeerAccount(owner,'Dave')).toBeNull();

    // A member ACCOUNT never leaves the old binding usable: the roster is
    // re-snapshotted from the server and stays incomplete until it answers.
    await service.ingest({physicalContext:owner,sourceKind:'user',line:':Bob!b@h ACCOUNT bob2'});
    expect(namesQueries()).toBe(queries+1);
    expect(service.resolvePeerAccount(owner,'Bob')).toBeNull();
    expect(service.roomMembershipFacts(owner,'#room').memberAccounts).not.toContain('bob');
    await names([['@Alice','alice'],['Bob','bob2'],['Carol','carol']]);
    expect(accounts()).toEqual({Alice:'alice',Bob:'bob2',Carol:'carol'});
    expect(service.resolvePeerAccount(owner,'Bob')).toBe('bob2');

    await service.ingest({physicalContext:owner,sourceKind:'user',line:':Carol!c@h ACCOUNT *'});
    expect(service.resolvePeerAccount(owner,'Carol')).toBeNull();
    expect(namesQueries()).toBe(queries+2);
    service.dispose();
  });

  it('keeps member and own account bindings across CHGHOST cloak changes', async () => {
    const {owner,sent,service}=harness();
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 005 Alice CASEMAPPING=rfc1459 PREFIX=(qaohv)~&@%+ :supported'});
    service.observeJoinedTarget({owner},'#room');
    await service.ingest({physicalContext:owner,sourceKind:'server',line:'@account=alice :irc.facts.test 353 Alice = #room :@Alice'});
    await service.ingest({physicalContext:owner,sourceKind:'server',line:'@account=bob :irc.facts.test 353 Alice = #room :+Bob'});
    await service.ingest({physicalContext:owner,sourceKind:'server',line:':irc.facts.test 366 Alice #room :end'});
    const before=service.roomMembershipFacts(owner,'#room');
    const sentBefore=sent.length;
    await service.ingest({physicalContext:owner,sourceKind:'user',line:':Bob!b@old.host CHGHOST b cloak/bob'});
    await service.ingest({physicalContext:owner,sourceKind:'user',line:':Alice!a@old.host CHGHOST a cloak/alice'});
    const after=service.roomMembershipFacts(owner,'#room');
    expect(after.members).toEqual(before.members);
    expect(after.memberAccounts).toEqual(['alice','bob']);
    expect(after.ownNick).toBe(before.ownNick);
    expect(after.ownModes).toEqual(before.ownModes);
    expect(service.resolvePeerAccount(owner,'Bob')).toBe('bob');
    expect(sent.slice(sentBefore)).toEqual([]);
    service.dispose();
  });
});

import { chromium } from '@playwright/test';
const base = 'http://localhost:3000';
function seed(acct) {
  const store = window.__onyx.store;
  const init = store.getInitialState();
  const users = new Map([['kain',{nick:'kain',modes:new Set(['q'])}]]);
  const channels = new Map([['#root',{name:'#root',topic:'t',topicSetBy:'kain',topicSetAt:null,modes:'+nt',users,unread:0,highlights:0,createdAt:null,messages:[]}]]);
  store.setState({...init, channels, activeView:{kind:'channel',channel:'#root'}, connectionStatus:'connected', ourNick:'kain', networkName:'IRCXNet',
    server: { id:'1', name:'IRCXNet', network:'IRCXNet', url:'wss://eshmaki.me:8080', icon:'', nick:'kain', account: acct, connected:true },
  }, true);
}
const b = await chromium.launch();
for (const acct of ['kain', null]) {
  const p = await (await b.newContext({colorScheme:'dark'})).newPage();
  await p.goto(`${base}/app`,{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>!!window.__onyx);
  await p.evaluate(seed, acct);
  await p.waitForTimeout(300);
  const txt = await p.locator('[data-testid="ribbon-account-chip"]').innerText().catch(()=>'(none)');
  const guest = await p.locator('[data-testid="ribbon-account-chip"]').getAttribute('data-guest').catch(()=>'?');
  console.log(`account=${JSON.stringify(acct)} -> chip="${txt.replace(/\n/g,' ')}" data-guest=${guest}`);
}
await b.close();

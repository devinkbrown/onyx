import { chromium } from '@playwright/test';
const base = 'http://localhost:3000';
function seed() {
  const store = window.__onyx.store;
  const init = store.getInitialState();
  const mk = (n,m=[])=>[n.toLowerCase(),{nick:n,modes:new Set(m)}];
  const users = new Map([mk('aurora',['q']),mk('vesper',['o']),mk('moss',['v']),mk('quartz'),mk('ember'),mk('slate')]);
  const channels = new Map([['#root',{name:'#root',topic:'t',topicSetBy:'aurora',topicSetAt:null,modes:'+nt',users,unread:0,highlights:0,createdAt:null,messages:[]}]]);
  store.setState({...init, channels, activeView:{kind:'channel',channel:'#root'}, connectionStatus:'connected', ourNick:'kain', networkName:'IRCXNet', showMemberList:true,
    server:{id:'1',name:'IRCXNet',network:'IRCXNet',url:'wss://eshmaki.me:8080',icon:'',nick:'kain',account:'kain',connected:true}}, true);
}
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1280,height:800}, colorScheme:'dark' });
const p = await ctx.newPage();
await p.goto(`${base}/app`,{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>!!window.__onyx);
await p.evaluate(seed);
await p.waitForTimeout(400);
// click a member row to open the card
const row = p.locator('.shell-member-row').first();
await row.click();
await p.waitForTimeout(400);
const panel = p.locator('.ruri-popover__panel:has(.shell-member-card)').first();
const box = await panel.boundingBox().catch(()=>null);
const vp = { w:1280, h:800 };
console.log('member-card panel box:', JSON.stringify(box));
console.log('viewport:', JSON.stringify(vp));
if (box) {
  console.log('left edge:', box.x, '| right edge:', box.x+box.width, '| off-left:', box.x<0, '| off-right:', box.x+box.width>vp.w);
}
await p.screenshot({ path:'/tmp/membercard.png' });
await b.close();

import { chromium } from '@playwright/test';
const base = 'http://localhost:3000';
function seed(bg) {
  const store = window.__onyx.store;
  const init = store.getInitialState();
  const users = new Map([['aurora',{nick:'aurora',modes:new Set(['q'])}],['vesper',{nick:'vesper',modes:new Set(['o'])}],['moss',{nick:'moss',modes:new Set(['v'])}]]);
  const t = (m)=>new Date(Date.now()-m*60000);
  const msg=(i,f,x,m)=>({id:'m'+i,from:f,text:x,time:t(m),type:'msg',target:'#bg'});
  const messages=[msg(1,'aurora','does the background read through now?',6),msg(2,'vesper','checking legibility of light text over the canvas',4),msg(3,'moss','the message body should still be crisp and readable',2)];
  const channels=new Map([['#bg',{name:'#bg',topic:'background legibility check',topicSetBy:'aurora',topicSetAt:null,modes:'+nt',users,unread:0,highlights:0,createdAt:null,messages}]]);
  store.setState({...init,channels,activeView:{kind:'channel',channel:'#bg'},connectionStatus:'connected',ourNick:'kain',networkName:'IRCXNet',showMemberList:true},true);
  store.getState().setBackground(bg);
}
const b=await chromium.launch();
for (const bg of (process.argv[2]??'aurora,lapis-gradient,kintsugi-veins').split(',')) {
  const ctx=await b.newContext({viewport:{width:1200,height:760},colorScheme:'dark'});
  const p=await ctx.newPage();
  await p.goto(`${base}/app`,{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>!!window.__onyx);
  await p.evaluate(seed,bg);
  await p.waitForTimeout(1200);
  await p.screenshot({path:`/tmp/bgv-${bg}.png`});
  console.log('shot',bg);
  await ctx.close();
}
await b.close();

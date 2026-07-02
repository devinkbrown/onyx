import { chromium } from '@playwright/test';
const url = process.argv[2] ?? 'wss://eshmaki.me:8080/';
const userArg = process.argv[3] ?? 'webchat'; // mimic web client USER arg
const b = await chromium.launch();
const p = await (await b.newContext({ ignoreHTTPSErrors: true })).newPage();
await p.goto('https://eshmaki.me/', { waitUntil: 'domcontentloaded' }).catch(()=>{});
const r = await p.evaluate(({ url, userArg }) => new Promise((res) => {
  const nick = 'idc' + Math.floor(Math.random()*99999);
  const out = { whois311: null, lines: [] };
  let done=false; const fin=()=>{ if(done)return; done=true; try{s.close()}catch{} res(out); };
  setTimeout(fin, 12000);
  const s = new WebSocket(url);
  s.onopen=()=>{ s.send('CAP LS 302\r\n'); s.send(`NICK ${nick}\r\n`); s.send(`USER ${userArg} 0 * :${nick} real\r\n`); };
  s.onmessage=(ev)=>{ for(const ln of String(ev.data).split(/\r?\n/)){ if(!ln)continue;
    const t=ln.split(' '); const cmd=t[0].startsWith(':')?t[1]:t[0];
    if(cmd==='CAP'&&ln.includes(' LS ')) s.send('CAP END\r\n');
    if(cmd==='PING') s.send('PONG '+ln.split('PING')[1].trim()+'\r\n');
    if(cmd==='001') s.send(`WHOIS ${nick}\r\n`);
    if(cmd==='311'){ out.whois311 = ln; fin(); } } };
  s.onerror=()=>fin();
}), { url, userArg });
console.log(`USER arg sent: "${userArg}"`);
console.log('311 reply:', r.whois311 || '(none)');
await b.close();

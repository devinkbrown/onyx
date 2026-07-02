import { chromium } from '@playwright/test';
const nodes = (process.argv[2] ?? 'wss://eshmaki.me:8080/,wss://ircx.us:8080/').split(',');
const b = await chromium.launch();
const p = await (await b.newContext({ ignoreHTTPSErrors: true })).newPage();
await p.goto('https://eshmaki.me/', { waitUntil: 'domcontentloaded' }).catch(()=>{});
async function probe(url) {
  return p.evaluate((url) => new Promise((res) => {
    const nick = 'luc' + Math.floor(Math.random()*99999);
    const out = { motd: [], lusers: [] };
    let done=false; const fin=()=>{ if(done)return; done=true; try{s.close()}catch{} res(out); };
    setTimeout(fin, 12000);
    const s = new WebSocket(url);
    s.onopen=()=>{ s.send('CAP LS 302\r\n'); s.send(`NICK ${nick}\r\n`); s.send(`USER ${nick} 0 * :probe\r\n`); };
    s.onmessage=(ev)=>{ for(const ln of String(ev.data).split(/\r?\n/)){ if(!ln)continue;
      const t=ln.split(' '); const cmd=t[0].startsWith(':')?t[1]:t[0];
      if(cmd==='CAP'&&ln.includes(' LS ')) s.send('CAP END\r\n');
      if(cmd==='PING') s.send('PONG '+ln.split('PING')[1].trim()+'\r\n');
      if(cmd==='372'||cmd==='375') { if(/user|online|mesh/i.test(ln)) out.motd.push(ln.replace(/^.*? :?-? ?/,'').trim()); }
      if(cmd==='001') s.send('LUSERS\r\n');
      if(cmd==='251'||cmd==='266') out.lusers.push(ln.replace(/^:[^ ]+ \d+ [^ ]+ :?/,'').trim());
      if(cmd==='376'||cmd==='422') {} } };
    s.onerror=()=>fin();
  }), url);
}
for (const url of nodes) {
  const r = await probe(url);
  console.log(`\n### ${url}`);
  console.log('MOTD user lines:', r.motd.filter(x=>/user|mesh|online/i.test(x)).join(' | ') || '(none)');
  console.log('LUSERS:', r.lusers.join(' | ') || '(none)');
}
await b.close();

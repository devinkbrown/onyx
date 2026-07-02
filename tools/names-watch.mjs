// Raw TLS IRC probe: joins #root and samples NAMES every 45s.
import tls from 'node:tls';
const nick = 'nwatch' + Math.floor(Math.random() * 9999);
const sock = tls.connect({ host: 'eshmaki.me', port: 6697, servername: 'eshmaki.me' });
let buf = '';
const names = new Set();
let collecting = false;
sock.on('secureConnect', () => {
  sock.write(`NICK ${nick}\r\nUSER probe 0 * :names watcher\r\n`);
});
sock.on('data', (d) => {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line.startsWith('PING')) { sock.write('PONG ' + line.slice(5) + '\r\n'); continue; }
    const p = line.split(' ');
    if (p[1] === '001') sock.write('JOIN #root\r\n');
    if (p[1] === '353') {
      if (!collecting) { names.clear(); collecting = true; }
      const trail = line.split(' :')[1] ?? '';
      for (const n of trail.split(' ')) if (n) names.add(n.replace(/^[*!.@+]+/, ''));
    }
    if (p[1] === '366') {
      collecting = false;
      console.log(`[${new Date().toISOString().slice(11, 19)}] NAMES #root → ${names.size}: ${[...names].join(' ')}`);
    }
  }
});
const timer = setInterval(() => sock.write('NAMES #root\r\n'), 45000);
setTimeout(() => { clearInterval(timer); sock.write('QUIT :done\r\n'); sock.end(); process.exit(0); }, 250000);
sock.on('error', (e) => { console.error('sock error', e.message); process.exit(1); });

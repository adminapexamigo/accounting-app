'use strict';
// Always-on helper (runs hidden, elevated, started at Windows logon by install.bat).
// The Desktop "Amigo Control.html" page talks to it on 127.0.0.1 to start/stop the app and the local domain.
const http = require('http'), net = require('net'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const WIN = process.platform === 'win32', DIR = __dirname, ROOT = path.join(DIR, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(DIR, 'launcher.json'), 'utf8'));
const DOMAIN = CFG.domain || 'amigo-enterprises.com', PORT = +process.env.LAUNCHER_PORT || CFG.port || 3500;
const HOSTS = process.env.HOSTS_FILE || (WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts') : '/etc/hosts');
const MARK = '# AMIGO-APP', LOGDIR = path.join(DIR, 'logs');
const HAS_TLS = fs.existsSync(path.join(ROOT, 'certs', 'amigo.pfx')) || fs.existsSync(path.join(ROOT, 'certs', 'key.pem'));
let child = null, info = null, busy = false, stopping = false;

function setHosts(on) { // add/remove our two lines in the hosts file; everything else is left untouched
  let t = ''; try { t = fs.readFileSync(HOSTS, 'utf8'); } catch {}
  const eol = t.includes('\r\n') ? '\r\n' : '\n', lines = t.split(/\r?\n/).filter(l => !l.includes(MARK));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (on) lines.push(`127.0.0.1 ${DOMAIN} ${MARK}`, `127.0.0.1 www.${DOMAIN} ${MARK}`);
  fs.writeFileSync(HOSTS, lines.join(eol) + eol);
  if (WIN) execFile('ipconfig', ['/flushdns'], () => {});
}
const free = p => new Promise(ok => { const s = net.createServer(); s.once('error', () => ok(false)); s.once('listening', () => s.close(() => ok(true))); s.listen(p, '0.0.0.0'); });
const waitPort = (port, ms, dead) => new Promise(ok => {
  const t0 = Date.now(), tick = () => {
    if (dead()) return ok(false);
    const c = net.connect(port, '127.0.0.1'); c.once('connect', () => { c.destroy(); ok(true); });
    c.once('error', () => { c.destroy(); Date.now() - t0 > ms ? ok(false) : setTimeout(tick, 300); });
  }; tick();
});
function status() {
  const url = child && info ? `${info.scheme}://${DOMAIN}${(info.scheme === 'https' && info.port === 443) || (info.scheme === 'http' && info.port === 80) ? '' : ':' + info.port}` : '';
  return { running: !!child, url, domain: DOMAIN, tls: HAS_TLS };
}
// Kill leftover copies of OUR server.js (e.g. after the helper was restarted while the app was running)
function killStrays() {
  return new Promise(res => {
    const target = path.join(ROOT, 'server.js'), done = () => setTimeout(res, 700);
    if (WIN) execFile('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*${target.replace(/'/g, "''")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { windowsHide: true }, done);
    else execFile('pkill', ['-f', target], done);
  });
}
async function start() {
  if (child) return status();
  await killStrays();
  const want = HAS_TLS ? [443, 8443] : [80, 3000];
  const port = +process.env.AMIGO_PORT || ((await free(want[0])) ? want[0] : want[1]);
  const redir = HAS_TLS && !process.env.AMIGO_PORT && (await free(80)) ? 80 : 0;
  setHosts(true);
  fs.mkdirSync(LOGDIR, { recursive: true });
  const out = fs.openSync(path.join(LOGDIR, 'server.log'), 'a');
  const env = { ...process.env, PORT: String(port), HOST: '0.0.0.0', LAUNCHER_PID: String(process.pid) }; if (redir) env.HTTP_REDIRECT_PORT = String(redir);
  let exited = false;
  child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', out, out] });
  child.on('exit', () => { exited = true; child = null; info = null; if (!stopping) { try { setHosts(false); } catch {} } });
  child.on('error', () => { exited = true; });
  await new Promise(r => setTimeout(r, 800)); // let a failing start (port in use) show itself before probing
  if (!(await waitPort(port, 15000, () => exited))) { await stop(); throw new Error(`Server did not start (port ${port} may be in use). See launcher\\logs\\server.log`); }
  info = { port, scheme: HAS_TLS ? 'https' : 'http' };
  return status();
}
async function stop() {
  stopping = true;
  try {
    const c = child;
    if (c) await new Promise(res => { c.once('exit', res); setTimeout(res, 5000); if (WIN) execFile('taskkill', ['/PID', String(c.pid), '/T', '/F'], () => {}); else c.kill('SIGTERM'); });
    setHosts(false);
  } finally { stopping = false; child = null; info = null; }
  return status();
}

http.createServer(async (req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-token, content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Private-Network': 'true' };
  const send = (c, o) => { res.writeHead(c, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) return send(403, { error: 'Bad host' }); // blocks DNS-rebinding
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const got = Buffer.from(String(req.headers['x-token'] || '')), want = Buffer.from(CFG.token);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return send(401, { error: 'Wrong token. Run launcher\\install.bat again to regenerate the Desktop page.' });
  const p = req.url.split('?')[0];
  try {
    if (p === '/status') return send(200, status());
    if (req.method === 'POST' && (p === '/start' || p === '/stop')) {
      if (busy) return send(409, { error: 'Another action is in progress' });
      busy = true; try { return send(200, p === '/start' ? await start() : await stop()); } finally { busy = false; }
    }
    send(404, { error: 'Not found' });
  } catch (e) { send(500, { error: e.message }); }
}).listen(PORT, '127.0.0.1', () => console.log(`Amigo launcher on 127.0.0.1:${PORT}`));

killStrays(); try { setHosts(false); } catch (e) { console.error('Could not clean hosts file:', e.message); } // clear leftovers after a crash / power loss
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop().finally(() => process.exit(0)));

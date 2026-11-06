'use strict';
// One-time setup (run through install.bat as Administrator).
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), { spawnSync } = require('child_process');
if (process.platform !== 'win32') { console.log('This installer is for Windows only.'); process.exit(1); }
const DIR = __dirname, ROOT = path.join(DIR, '..'), CERTS = path.join(ROOT, 'certs'), DOMAIN = 'amigo-enterprises.com';
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
function ps(script) {
  const f = path.join(os.tmpdir(), 'amigo-' + crypto.randomBytes(4).toString('hex') + '.ps1'); fs.writeFileSync(f, script);
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', f], { encoding: 'utf8' }); fs.unlinkSync(f);
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'PowerShell failed').trim()); return (r.stdout || '').trim();
}
const step = (n, t) => console.log(`\n[${n}/5] ${t}`);
try {
  step(1, 'Saving settings');
  const cf = path.join(DIR, 'launcher.json'); let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(cf, 'utf8')); } catch {}
  cfg = { domain: DOMAIN, port: cfg.port || 3500, token: cfg.token || crypto.randomBytes(24).toString('hex') };
  fs.writeFileSync(cf, JSON.stringify(cfg, null, 2));

  step(2, 'Creating a trusted HTTPS certificate for ' + DOMAIN + ' (needed for the camera / face login)');
  const pfx = path.join(CERTS, 'amigo.pfx'), cer = path.join(CERTS, 'amigo.cer');
  if (!fs.existsSync(pfx) || process.argv.includes('--force')) {
    fs.mkdirSync(CERTS, { recursive: true }); const pass = crypto.randomBytes(12).toString('hex');
    ps(`$ErrorActionPreference='Stop'
$sec = ConvertTo-SecureString ${q(pass)} -AsPlainText -Force
$c = New-SelfSignedCertificate -DnsName '${DOMAIN}','www.${DOMAIN}','localhost' -CertStoreLocation Cert:\\LocalMachine\\My -NotAfter (Get-Date).AddYears(5) -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -FriendlyName 'Amigo Enterprises local'
try { Export-PfxCertificate -Cert $c -FilePath ${q(pfx)} -Password $sec -CryptoAlgorithmOption AES256_SHA256 | Out-Null } catch { Export-PfxCertificate -Cert $c -FilePath ${q(pfx)} -Password $sec | Out-Null }
Export-Certificate -Cert $c -FilePath ${q(cer)} | Out-Null
Import-Certificate -FilePath ${q(cer)} -CertStoreLocation Cert:\\LocalMachine\\Root | Out-Null`);
    fs.writeFileSync(path.join(CERTS, 'pfx.pass'), pass);
  } else console.log('  certificate already exists, keeping it');

  step(3, 'Registering the background helper (starts hidden at every Windows logon)');
  const vbs = path.join(DIR, 'run-hidden.vbs');
  fs.writeFileSync(vbs, `CreateObject("WScript.Shell").Run """${process.execPath}"" ""${path.join(DIR, 'launcher.js')}""", 0, False\r\n`);
  ps(`$ErrorActionPreference='Stop'
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + ${q(vbs)} + '"')
$t = New-ScheduledTaskTrigger -AtLogOn -User $me
$p = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Highest
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'AmigoLauncher' -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null
Stop-ScheduledTask -TaskName 'AmigoLauncher' -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName 'AmigoLauncher'`);

  step(4, 'Creating the Desktop control page');
  const desk = ps("[Environment]::GetFolderPath('Desktop')"), out = path.join(desk, 'Amigo Control.html');
  fs.writeFileSync(out, fs.readFileSync(path.join(DIR, 'control.template.html'), 'utf8').replace(/__TOKEN__/g, cfg.token).replace(/__PORT__/g, cfg.port).replace(/__DOMAIN__/g, DOMAIN));
  console.log('  ' + out);

  step(5, 'Done');
  console.log(`\nOpen "Amigo Control.html" on your Desktop and press Start.\nThe app will be at https://${DOMAIN}\n`);
} catch (e) { console.error('\nSetup failed: ' + e.message); process.exit(1); }

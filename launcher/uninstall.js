'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), { spawnSync } = require('child_process');
if (process.platform !== 'win32') process.exit(1);
const f = path.join(os.tmpdir(), 'amigo-un-' + crypto.randomBytes(4).toString('hex') + '.ps1');
fs.writeFileSync(f, `Stop-ScheduledTask -TaskName 'AmigoLauncher' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'AmigoLauncher' -Confirm:$false -ErrorAction SilentlyContinue
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -and (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -match 'amigo|accounting-app|launcher' } | Stop-Process -Force -ErrorAction SilentlyContinue
$h = "$env:SystemRoot\\System32\\drivers\\etc\\hosts"
(Get-Content $h) | Where-Object { $_ -notmatch '# AMIGO-APP' } | Set-Content $h
Get-ChildItem Cert:\\LocalMachine\\Root, Cert:\\LocalMachine\\My | Where-Object { $_.FriendlyName -eq 'Amigo Enterprises local' } | Remove-Item -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Amigo Control.html') -ErrorAction SilentlyContinue
ipconfig /flushdns | Out-Null`);
const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', f], { stdio: 'inherit' }); fs.unlinkSync(f);
console.log(r.status === 0 ? '\nUninstalled: helper, hosts entries, certificate and Desktop page removed.' : '\nSomething failed, see messages above.');

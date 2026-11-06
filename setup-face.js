'use strict';
// One-time setup: downloads the face recognition library and models into public/ (needs internet, ~8 MB).
// Run once on the server PC:  node setup-face.js
const https = require('https'), fs = require('fs'), path = require('path');
const BASE = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api';
const FILES = [
  ['/dist/face-api.js', 'public/vendor/face-api.js'],
  ...['tiny_face_detector_model', 'face_landmark_68_model', 'face_recognition_model'].flatMap(n => [
    [`/model/${n}.json`, `public/models/${n}.json`], [`/model/${n}.bin`, `public/models/${n}.bin`]]),
];
function get(url, redirects = 5) {
  return new Promise((ok, no) => https.get(url, r => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirects) { r.resume(); return ok(get(new URL(r.headers.location, url).href, redirects - 1)); }
    if (r.statusCode !== 200) { r.resume(); return no(new Error(`HTTP ${r.statusCode} for ${url}`)); }
    const c = []; r.on('data', d => c.push(d)); r.on('end', () => ok(Buffer.concat(c)));
  }).on('error', no));
}
(async () => {
  for (const [u, f] of FILES) {
    const dest = path.join(__dirname, f); fs.mkdirSync(path.dirname(dest), { recursive: true });
    process.stdout.write(`Downloading ${f} ... `); fs.writeFileSync(dest, await get(BASE + u)); console.log('ok');
  }
  console.log('\nDone. Restart the app: node server.js');
})().catch(e => { console.error('\nFailed:', e.message, '\nCheck your internet connection and run it again.'); process.exit(1); });

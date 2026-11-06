# Startup Accounting App
Zero-dependency Node.js app. Data is stored in CSV files in `data/`.

## Daily use on Windows: Desktop Start / Stop page (recommended)
One-time setup (needs internet NOT required, needs Administrator once):
1. Install Node.js 18+ and unzip this folder somewhere permanent (e.g. C:\accounting-app). Do not move it afterwards; if you do, run install.bat again.
2. Double-click `launcher\install.bat` and allow the administrator prompt. It creates a trusted HTTPS certificate for amigo-enterprises.com, registers a tiny hidden helper that starts at every Windows logon, and puts **Amigo Control.html** on your Desktop.
Every day: open **Amigo Control.html** on the Desktop.
- **Start**: maps amigo-enterprises.com to this PC (hosts file), starts the server on HTTPS, then opens https://amigo-enterprises.com
- **Stop**: stops the server and removes the domain mapping. Nothing is left running except the idle helper (needed so Start works tomorrow).
- A browser page cannot run a .bat file by itself, so the helper does that job; the page only talks to it on 127.0.0.1 with a secret token.
- First Start: Windows Firewall may ask about Node.js. Allow Private networks.
- If you forget to stop and shut the PC down, the domain mapping is cleaned automatically at next logon.
- While running, this PC resolves amigo-enterprises.com to itself (the real website of that name, if any, is unreachable from this PC until you press Stop).
- Other PCs: they need the same hosts line (`<this-pc-ip> amigo-enterprises.com`) and must trust launcher\..\certs\amigo.cer. Camera/face login works only on https.
- Edge and Chrome trust the certificate automatically. Firefox does not (import certs\amigo.cer there).
- Start fails or the app opens on a strange port (8443 / 8453)? A leftover server from an earlier run may still be running. The helper now clears these automatically on Start. Manual fix (Command Prompt as Administrator): `netstat -ano | findstr ":443 :8443"`, then `taskkill /F /PID <number>` for each LISTENING line, then press Start again.
- After replacing launcher.js, restart the helper: `schtasks /end /tn AmigoLauncher` then `schtasks /run /tn AmigoLauncher` (or run launcher\install.bat again).
- Remove everything: `launcher\uninstall.bat`. Logs: launcher\logs\server.log.

## Run manually (without the Desktop page)
1. Install Node.js 18+ (https://nodejs.org), check with `node -v`
2. One time, with internet on: `node setup-face.js` (downloads the face recognition files into public/)
3. `node server.js`  then open http://localhost:3000
4. First login: `admin` / `Admin@123` -> click "Change password" immediately.
5. Admin > Company: fill company details, invoice prefix, terms, stamp image.
6. Admin > Users: add employees (contact number + profile photo are required).

## Authentication & Verification
- Admin: logs in with username and password only (no face verification, no OTP verification).
- Employees: after the password they pass ONE of two checks, their choice: the face check or an emailed code. Passing either one is enough (not both). If only one is possible for that person it is used directly.
- Existing employees without a photo cannot log in until the admin edits them and adds a photo.
- Email OTP (after the face check): the app emails a 6-digit code from the Gmail account set in "Email & alerts" to the employee's own email address. It is valid for 10 minutes, 5 wrong tries cancel the login, a new code can be requested every 30 seconds (max 4 per login). If an employee can use both methods, a "Verify it's you" box lets them choose.
- Every employee needs a profile photo (face check) or an email address (emailed code), ideally both so they can choose. Existing employees with neither cannot log in until the admin edits them (Users page).
- Email & alerts has two switches for employees (emailed code / face check). Keep at least one on; the app refuses to save with both off.
- If Gmail is not set up (or the App Password is wrong) employees can still use the face check; employees who only have an email on file cannot log in until it is fixed in Email & alerts.
- Stricter/looser matching: `FACE_THRESHOLD=0.45 node server.js` (default 0.5, lower = stricter).
- Limitation: there is no liveness check, so a good printed or on-screen photo of the person could fool it.

## Camera needs HTTPS on other PCs
Browsers only allow the camera on https:// or http://localhost. If employees open http://<pc-ip>:3000 the camera is blocked.
Fix A (recommended): create a certificate, the app switches to HTTPS automatically when certs/key.pem and certs/cert.pem exist:
  mkdir certs
  openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/key.pem -out certs/cert.pem -days 825 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:<this-pc-ip>"
  (openssl comes with Git for Windows: C:\Program Files\Git\usr\bin\openssl.exe). Employees open https://<this-pc-ip>:3000 and accept the one-time browser warning.
Fix B: on each employee PC open edge://flags/#unsafely-treat-insecure-origin-as-secure, add http://<this-pc-ip>:3000, enable, relaunch.

## Daily work update + email
- Employees: "Work update" tab. They write what they did (plus optional pending items and hours). On submit the app emails the details: employee, contact, date, first login time today, time submitted, time on duty, work done, pending.
- Subject format: `<Full name>_<dd-mm-yyyy> work update` (full name falls back to username). Set "Full name" when adding the employee.
- One update per employee per day. Admin can see all updates, resend a failed email, or delete one (tab "Work update").
- Daily alert: an orange banner shows until the update is submitted, and a popup appears at the reminder time (default 17:30), repeating every 30 min if snoozed. Logging out asks for confirmation if the update is missing. Alerts show only while the app is open in the browser.
- Email setup (admin > "Email & alerts"): Gmail address, a Gmail App Password (Google Account > Security > 2-Step Verification > App passwords), recipient address(es), reminder time. Use "Send test email" to check. The password is stored in data/mail.json (not shown again, not sent to the browser).
- If email is not configured or fails, the update is still saved and the status column says why; use "Resend email" after fixing.
- Admin > "Login log" lists every login time. Dates and times use the server PC's clock and time zone.

## Quotation, Proforma Invoice (PI), Purchase Order (PO)
- Tabs "Quotations", "Proforma invoices", "Purchase orders". Layouts follow the sample PDFs; the logo is `public/logo.png` (replace that file to change it).
- Company page > bottom section holds the details printed on them (address block, phone/email box, bank details, PAN, quotation header/terms/signature, default PO payment terms, number prefixes). They are pre-filled from the sample PDFs: check them once.
- Numbers are suggested automatically for the financial year (e.g. AEPI-26-27-011, AE/26-27/30) and can be edited when creating (e.g. to add a suffix like 010A). Duplicates are refused.
- PI/PO totals: base price = qty x rate (less Disc %, plus P&F if entered), then IGST or CGST+SGST on the total. Text such as "nil" in Disc or P&F is shown as typed and counts as 0.
- "Copy" duplicates a document as a new one. Only admin can edit or delete saved documents.
- Download PDF = print dialog > "Save as PDF". Download Word saves a .doc with the logo embedded.

## Admin password reset (login screen)
- Login screen > "Admin: forgot password?". Enter the admin username, a 6-digit code is emailed (styled HTML, from the Gmail set in Email & alerts) to the email saved on that admin user. The password changes ONLY if the code is correct: enter the code plus a new password (min 8 characters, typed twice).
- Only admin accounts can do this. Employees cannot reset themselves; the admin edits them on the Users page (set a new password). Other usernames or admins without an email get the same neutral message and no email, so nobody can probe which accounts exist.
- The code is valid for 10 minutes, works once, 5 wrong tries cancel it, a new code can be requested once a minute (max 4 per 30 minutes). After a reset the admin is signed out everywhere and a "password was changed" notice is emailed.
- Set up once: Users > admin > Edit > add the Email (and make sure Email & alerts is configured). The default admin has no email, so do this before you need it.
- A reset only changes the password: the usual login checks (face / emailed code) still apply afterwards.
- Locked out with no admin email and no way to get a code? Stop the app, open data/users.csv and delete the admin row (keep the header line), then start the app again. When no admin exists the app recreates `admin` / `Admin@123` and keeps all other users. Change that password straight away.

## E-mail design
- Login codes, daily work updates and the test email are sent as styled HTML emails with the Amigo logo in the header (company name comes from the Company page, logo is `public/logo.png`). A plain-text version is sent along for mail apps that cannot show HTML.
- The logo is embedded in the email itself (no web hosting needed). Some mail apps (e.g. Outlook) may ask to show images or list the logo as an attachment.
- Subject lines are unchanged: `<Full name>_<dd-mm-yyyy> work update` and `Your Accounts login code`.

## Other
- LAN access: allow Node through the firewall. Local only: HOST=127.0.0.1. Other port: PORT=8080.
- Backups: copy of data/ in backups/<date>/ on every start. Profile photos live in data/photos/.
- Invoice: Supports two types: In-State (Maharashtra) with 9% SGST + 9% CGST, and Out of State with 18% IGST. Selectable when creating/editing an invoice, auto-suggested based on client GSTIN. Download PDF = print dialog, choose "Save as PDF". Download Word saves a .doc. Only admin edits invoices.

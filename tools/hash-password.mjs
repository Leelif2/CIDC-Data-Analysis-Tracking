// Manage staff logins for Vercel. Run on your own computer (Node 18+):
//
//   node tools/hash-password.mjs                  add a staff member (or reset their password)
//   node tools/hash-password.mjs --list           show who has access
//   node tools/hash-password.mjs --copy [EMAIL..] copy the STAFF_ACCOUNTS value again (optionally only these staff)
//   node tools/hash-password.mjs --check EMAIL    test whether a password matches the saved account
//   node tools/hash-password.mjs --remove EMAIL   remove a staff member
//   node tools/hash-password.mjs --secret         print a new random SESSION_SECRET
//
// Passwords are typed hidden and never saved or sent anywhere; only PBKDF2 hashes are kept.
// The hashes are remembered in tools/staff-accounts.local.json on this computer only (not uploaded,
// not committed), because Vercel can't show a Secret value again after it is saved.
// After each change the full STAFF_ACCOUNTS value is copied to the clipboard for pasting into Vercel.
import { webcrypto as crypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ITERATIONS = 210000;
const STORE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'staff-accounts.local.json');
const b64url = bytes => Buffer.from(bytes).toString('base64url');
const args = process.argv.slice(2);

if (args.includes('--secret')) {
    console.log(b64url(crypto.getRandomValues(new Uint8Array(48))));
    process.exit(0);
}

function ask(question, { hidden = false } = {}) {
    if (hidden && process.stdin.isTTY) return askHidden(question);
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !hidden });
        rl.question(question, answer => { rl.close(); resolve(answer); });
    });
}

// 비밀번호 입력: 터미널을 raw 모드로 두고 글자를 직접 받아서, 타이핑·붙여넣기 모두 화면에 절대 표시하지 않음
// (입력 길이도 드러나지 않게 * 도 찍지 않음)
function askHidden(question) {
    return new Promise(resolve => {
        const stdin = process.stdin;
        process.stdout.write(question);
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');
        let value = '';
        let escape = false; // 화살표 키 같은 제어 시퀀스(ESC [ A 등)는 무시
        const onData = chunk => {
            for (const ch of chunk) {
                if (escape) { if (/[A-Za-z~]/.test(ch)) escape = false; continue; }
                if (ch === '\u001b') { escape = true; continue; }
                if (ch === '\r' || ch === '\n') {
                    stdin.removeListener('data', onData);
                    stdin.setRawMode(false);
                    stdin.pause();
                    process.stdout.write('\n');
                    resolve(value);
                    return;
                }
                if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); }  // Ctrl+C
                // Backspace: 마지막 글자와 * 하나 지우기
                if (ch === '\u007f' || ch === '\b') { if (value) { value = value.slice(0, -1); process.stdout.write('\b \b'); } continue; }
                // 글자마다 * 하나만 표시 (비밀번호 자체는 보이지 않지만 입력이 되고 있는지는 확인 가능)
                if (ch >= ' ') { value += ch; process.stdout.write('*'); }
            }
        };
        stdin.on('data', onData);
    });
}

function copyToClipboard(text) {
    if (process.env.NO_CLIPBOARD) return false; // 테스트용: 클립보드를 건드리지 않음
    const cmd = process.platform === 'win32' ? ['clip'] : process.platform === 'darwin' ? ['pbcopy'] : ['xclip', '-selection', 'clipboard'];
    try { return spawnSync(cmd[0], cmd.slice(1), { input: text, shell: process.platform === 'win32' }).status === 0; }
    catch { return false; }
}

// 이 컴퓨터에 저장된 계정 목록 (해시만). 없으면 Vercel에 넣었던 값을 한 번 붙여넣어 시작할 수 있음
async function loadAccounts() {
    if (fs.existsSync(STORE)) return JSON.parse(fs.readFileSync(STORE, 'utf8'));
    console.log('\nNo saved staff list on this computer yet.');
    console.log('If you still have the STAFF_ACCOUNTS value you saved in Vercel (e.g. in an open PowerShell window), paste it now.');
    console.log('Otherwise just press Enter and re-add everyone (including yourself) — the new value replaces the old one.\n');
    const pasted = (await ask('Current STAFF_ACCOUNTS value (or Enter): ')).trim();
    if (!pasted) return {};
    try { return JSON.parse(pasted); } catch { console.error('That is not a valid STAFF_ACCOUNTS value (it should start with { ).'); process.exit(1); }
}

function saveAndShow(accounts, message) {
    fs.writeFileSync(STORE, JSON.stringify(accounts, null, 2));
    const value = JSON.stringify(accounts);
    const copied = copyToClipboard(value);
    console.log(`\n${message}`);
    console.log(`Staff with access (${Object.keys(accounts).length}): ${Object.keys(accounts).join(', ') || '(none)'}`);
    console.log(copied ? '\nThe new STAFF_ACCOUNTS value is COPIED to your clipboard.' : '\nNew STAFF_ACCOUNTS value:\n\n' + value);
    console.log('\nNext: Vercel → Settings → Environment Variables → STAFF_ACCOUNTS → ⋯ → Edit → paste (Ctrl+V) → Save.');
    console.log('Then ask for a redeploy (or Deployments → ⋯ → Redeploy) so the change takes effect.\n');
}

function passwordProblems(pw, email) {
    const problems = [];
    // 한/영 키가 한글이면 영문 키가 한글로 입력됨 → 브라우저 로그인과 맞지 않게 됨
    if (/[^\x20-\x7E]/.test(pw)) return ['only English letters, numbers and symbols are allowed — your keyboard may be in KOREAN mode. Press the 한/영 key to switch to English (A) and type it again'];
    if (pw.length < 12) problems.push('use at least 12 characters');
    if ([/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(pw)).length < 3) problems.push('mix at least 3 of: lowercase, uppercase, numbers, symbols');
    const local = email.split('@')[0];
    if (local.length >= 3 && pw.toLowerCase().includes(local)) problems.push('do not include your email name');
    if (/password|cidc|utah|1234|qwer|admin/i.test(pw)) problems.push('avoid common words like password, cidc, utah, 1234, admin');
    return problems;
}

async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
    return `pbkdf2-sha256$${ITERATIONS}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}

// 저장된 목록 전체를 다시 클립보드로 (Vercel에 붙여넣기 전에 다른 걸 복사해 버렸을 때)
// --copy EMAIL ... 처럼 이메일을 적으면 그 계정만 골라서 복사 (예: 비밀번호가 노출된 계정을 잠시 빼고 싶을 때)
if (args.includes('--copy')) {
    if (!fs.existsSync(STORE)) { console.error('No saved staff list on this computer yet. Add someone first.'); process.exit(1); }
    const all = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    const wanted = args.filter(a => !a.startsWith('--')).map(a => a.trim().toLowerCase());
    const missing = wanted.filter(e => !(e in all));
    if (missing.length) { console.error(`Not in the saved staff list: ${missing.join(', ')}`); process.exit(1); }
    const accounts = wanted.length ? Object.fromEntries(wanted.map(e => [e, all[e]])) : all;
    const copied = copyToClipboard(JSON.stringify(accounts));
    console.log(copied
        ? `STAFF_ACCOUNTS value for ${Object.keys(accounts).length} staff (${Object.keys(accounts).join(', ')}) is COPIED to your clipboard.`
        : `Could not copy automatically. Value:\n\n${JSON.stringify(accounts)}`);
    process.exit(0);
}

// --check EMAIL: 입력한 비밀번호가 이 PC에 저장된 계정과 맞는지 확인 (Vercel에 올리기 전에 점검용)
const checkIdx = args.indexOf('--check');
if (checkIdx !== -1) {
    const email = String(args[checkIdx + 1] || '').trim().toLowerCase();
    const accounts = fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, 'utf8')) : {};
    if (!accounts[email]) { console.error(`${email || '(no email given)'} is not in the saved staff list.`); process.exit(1); }
    const password = await ask(`Password to test for ${email} (hidden): `, { hidden: true });
    if (/[^\x20-\x7E]/.test(password)) console.log('\nNote: what you typed contains non-English characters — your keyboard may be in KOREAN mode (press the 한/영 key).');
    const [, iter, salt, hash] = accounts[email].split('$');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(salt, 'base64url'), iterations: Number(iter) }, key, 256);
    console.log(b64url(new Uint8Array(bits)) === hash
        ? '\nMATCH — this password is correct for the saved account.'
        : '\nNO MATCH — this is not the saved password. Reset it with: node tools/hash-password.mjs');
    process.exit(0);
}

if (args.includes('--list')) {
    const accounts = fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, 'utf8')) : {};
    console.log(Object.keys(accounts).length ? `Staff with access:\n - ${Object.keys(accounts).join('\n - ')}` : 'No saved staff list on this computer yet.');
    process.exit(0);
}

const removeIdx = args.indexOf('--remove');
if (removeIdx !== -1) {
    const email = String(args[removeIdx + 1] || '').trim().toLowerCase();
    const accounts = await loadAccounts();
    if (!email || !(email in accounts)) { console.error(`${email || '(no email given)'} is not in the staff list.`); process.exit(1); }
    delete accounts[email];
    saveAndShow(accounts, `Removed ${email}. They lose access as soon as Vercel has the new value and redeploys.`);
    process.exit(0);
}

const accounts = await loadAccounts();
const email = (await ask('Staff email to add: ')).trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('That does not look like an email address.'); process.exit(1); }
if (email in accounts) console.log('This person already has access — continuing will reset their password.');

let password;
for (;;) {
    password = await ask(`Password for ${email} (hidden): `, { hidden: true });
    const problems = passwordProblems(password, email);
    if (problems.length) { console.log(`Please choose a stronger password:\n - ${problems.join('\n - ')}`); continue; }
    if ((await ask('Type it again (hidden): ', { hidden: true })) !== password) { console.log('Passwords did not match, try again.'); continue; }
    break;
}

const updating = email in accounts;
accounts[email] = await hashPassword(password);
saveAndShow(accounts, `${updating ? 'Reset the password for' : 'Added'} ${email}.`);
process.exit(0);

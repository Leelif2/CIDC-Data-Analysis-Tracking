// Make staff login settings for Vercel. Run on your own computer (Node 18+):
//
//   node tools/hash-password.mjs            add/update a staff account -> prints the new STAFF_ACCOUNTS value
//   node tools/hash-password.mjs --secret   print a new random SESSION_SECRET
//
// The password is typed hidden and never saved or sent anywhere; only its PBKDF2 hash is printed.
import { webcrypto as crypto } from 'node:crypto';
import readline from 'node:readline';

const ITERATIONS = 210000;
const b64url = bytes => Buffer.from(bytes).toString('base64url');

if (process.argv.includes('--secret')) {
    console.log(b64url(crypto.getRandomValues(new Uint8Array(48))));
    process.exit(0);
}

function ask(question, { hidden = false } = {}) {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        if (hidden) {
            // 입력한 글자를 화면에 표시하지 않음
            rl._writeToOutput = text => { if (!text.includes(question)) return; rl.output.write(text); };
        }
        rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
    });
}

function passwordProblems(pw, email) {
    const problems = [];
    if (pw.length < 12) problems.push('use at least 12 characters');
    if ([/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(pw)).length < 3) problems.push('mix at least 3 of: lowercase, uppercase, numbers, symbols');
    const local = email.split('@')[0];
    if (local && pw.toLowerCase().includes(local)) problems.push('do not include your email name');
    if (/password|cidc|utah|1234|qwer|admin/i.test(pw)) problems.push('avoid common words like password, cidc, utah, 1234, admin');
    return problems;
}

async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
    return `pbkdf2-sha256$${ITERATIONS}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}

const email = (await ask('Staff email: ')).trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('That does not look like an email address.'); process.exit(1); }

let password;
for (;;) {
    password = await ask('New password (hidden): ', { hidden: true });
    const problems = passwordProblems(password, email);
    if (problems.length) { console.log(`Please choose a stronger password:\n - ${problems.join('\n - ')}`); continue; }
    if ((await ask('Type it again (hidden): ', { hidden: true })) !== password) { console.log('Passwords did not match, try again.'); continue; }
    break;
}

const current = (await ask('Paste the current STAFF_ACCOUNTS value (or just press Enter if this is the first account): ')).trim();
let accounts = {};
if (current) {
    try { accounts = JSON.parse(current); } catch { console.error('That STAFF_ACCOUNTS value is not valid JSON.'); process.exit(1); }
}
const updating = email in accounts;
accounts[email] = await hashPassword(password);

console.log(`\n${updating ? 'Updated' : 'Added'} ${email}. Set this as STAFF_ACCOUNTS in Vercel (replace the whole value):\n`);
console.log(JSON.stringify(accounts));
console.log('\nVercel → Project → Settings → Environment Variables → STAFF_ACCOUNTS → Production and Preview → Save, then Redeploy.');

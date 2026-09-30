// Staff login gate (Vercel Routing Middleware) — runs on Vercel's server before every request.
// No page, script or data is sent until the visitor has a valid staff session.
//
// Settings live in Vercel → Project → Settings → Environment Variables (never in this code):
//   STAFF_ACCOUNTS  JSON of email → password hash, made with `node tools/hash-password.mjs`
//                   e.g. {"jane.park@utah.edu":"pbkdf2-sha256$210000$<salt>$<hash>"}
//   SESSION_SECRET  random 64-character string, made with `node tools/hash-password.mjs --secret`
// If either is missing the site stays locked (fails closed).
import { next } from '@vercel/functions';

export const config = { matcher: '/:path*' };

const SESSION_COOKIE = 'cidc_session';
const SESSION_HOURS = 12;
// 로그인 없이 열리는 것: 로그인 화면과 그 화면의 로고만
const PUBLIC_PATHS = new Set(['/login.html', '/assets/cidc-logo.png', '/favicon.ico']);

const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = str => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

function readSettings() {
    const secret = process.env.SESSION_SECRET || '';
    let accounts = null;
    try { accounts = JSON.parse(process.env.STAFF_ACCOUNTS || 'null'); } catch { accounts = null; }
    if (secret.length < 32 || !accounts || typeof accounts !== 'object') return null;
    const normalized = {};
    Object.entries(accounts).forEach(([email, hash]) => { normalized[String(email).trim().toLowerCase()] = String(hash); });
    return { secret, accounts: normalized };
}

// 길이가 같을 때 비교 시간이 내용에 따라 달라지지 않도록
function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

// 저장 형식: pbkdf2-sha256$<반복 횟수>$<salt base64url>$<hash base64url>
const DUMMY_HASH = 'pbkdf2-sha256$210000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
async function verifyPassword(password, stored) {
    const [scheme, iter, salt, hash] = String(stored || DUMMY_HASH).split('$');
    if (scheme !== 'pbkdf2-sha256' || !salt || !hash) return false;
    const iterations = Math.min(Math.max(parseInt(iter, 10) || 0, 100000), 1000000);
    const derived = await pbkdf2(password, fromB64(salt), iterations);
    return constantTimeEqual(derived, fromB64(hash));
}

async function hmac(secret, data) {
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

async function createSession(settings, email) {
    const payload = b64url(enc.encode(JSON.stringify({ e: email, x: Date.now() + SESSION_HOURS * 3600 * 1000 })));
    return `${payload}.${await hmac(settings.secret, payload)}`;
}

// 서명·만료를 확인하고, 계정이 STAFF_ACCOUNTS에서 지워졌으면 즉시 무효
async function readSession(settings, request) {
    const cookie = (request.headers.get('cookie') || '').split(/;\s*/).find(c => c.startsWith(`${SESSION_COOKIE}=`));
    if (!cookie) return null;
    const [payload, signature] = cookie.slice(SESSION_COOKIE.length + 1).split('.');
    if (!payload || !signature) return null;
    const expected = await hmac(settings.secret, payload);
    if (!constantTimeEqual(enc.encode(signature), enc.encode(expected))) return null;
    try {
        const { e, x } = JSON.parse(new TextDecoder().decode(fromB64(payload)));
        if (typeof x !== 'number' || Date.now() > x || !settings.accounts[e]) return null;
        return { email: e };
    } catch { return null; }
}

// 로그인 후 돌아갈 주소는 이 사이트 안의 경로만 허용 (외부 사이트로 튕기는 공격 방지)
const safeNext = value => (typeof value === 'string' && /^\/(?!\/)[^\s\\]*$/.test(value) ? value : '/');

const redirect = (location, extraHeaders = {}) => new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store', ...extraHeaders } });
const cookieHeader = (value, maxAge) => `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const loginUrl = (params) => `/login.html?${new URLSearchParams(params).toString()}`;

export default async function middleware(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const settings = readSettings();

    if (path === '/auth/login' && request.method === 'POST') {
        const form = await request.formData().catch(() => null);
        const email = String(form?.get('email') || '').trim().toLowerCase();
        const password = String(form?.get('password') || '');
        const nextPath = safeNext(String(form?.get('next') || '/'));
        if (!settings) return redirect(loginUrl({ error: 'config' }));
        // 없는 계정이어도 같은 시간이 걸리도록 항상 해시 계산
        const ok = (await verifyPassword(password, settings.accounts[email])) && Boolean(settings.accounts[email]);
        if (!ok) {
            await new Promise(r => setTimeout(r, 400)); // 무차별 대입 속도 늦추기
            return redirect(loginUrl({ error: 'invalid', next: nextPath }));
        }
        return redirect(nextPath, { 'Set-Cookie': cookieHeader(await createSession(settings, email), SESSION_HOURS * 3600) });
    }

    if (path === '/auth/logout') {
        return redirect(loginUrl({ signedout: '1' }), { 'Set-Cookie': cookieHeader('', 0) });
    }

    if (PUBLIC_PATHS.has(path)) return next();

    const session = settings && (await readSession(settings, request));
    if (path === '/auth/me') {
        return new Response(JSON.stringify(session ? { email: session.email } : {}), {
            status: session ? 200 : 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });
    }
    if (session) return next({ headers: { 'Cache-Control': 'private, no-store' } });

    if (!settings) return redirect(loginUrl({ error: 'config' }));
    const accept = request.headers.get('accept') || '';
    if (request.method === 'GET' && accept.includes('text/html')) return redirect(loginUrl({ next: path + url.search }));
    return new Response('Unauthorized', { status: 401, headers: { 'Cache-Control': 'no-store' } });
}

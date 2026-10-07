// 공유 데이터 저장소 API: 모든 직원이 같은 데이터를 보도록 Supabase 테이블 app_state 에 저장
// 로그인 확인은 middleware.js 가 먼저 함 (세션이 없으면 이 함수까지 오지 않음)
//
// Settings in Vercel → Project → Settings → Environment Variables (Supabase integration adds these):
//   SUPABASE_URL                                   e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)  server-only key, never sent to the browser
// Table: run supabase/app_state.sql once in Supabase → SQL Editor.
// If not configured, GET returns { configured: false } and the site keeps using browser storage.

const TABLE = 'app_state';
const KEYS = new Set(['placementData', 'optData', 'consultationData', 'eventData', 'consultationSource']);

function settings() {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    return url && key ? { url: url.replace(/\/+$/, ''), key } : null;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

// 새 형식 키(sb_secret_...)는 JWT가 아니라 Authorization 헤더에 넣으면 안 됨
const supabaseHeaders = key => ({
    apikey: key,
    ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
    'Content-Type': 'application/json'
});

// 누가 저장했는지 기록용 (세션 서명은 middleware.js 가 이미 확인함)
function staffEmail(request) {
    const cookie = (request.headers.get('cookie') || '').split(/;\s*/).find(c => c.startsWith('cidc_session='));
    try {
        const payload = cookie.slice('cidc_session='.length).split('.')[0];
        return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).e || null;
    } catch { return null; }
}

export async function GET() {
    const s = settings();
    if (!s) return json({ configured: false });
    const res = await fetch(`${s.url}/rest/v1/${TABLE}?select=key,data,updated_at,updated_by`, { headers: supabaseHeaders(s.key) });
    if (!res.ok) return json({ configured: false, error: `Database read failed (${res.status})` }, 502);
    const rows = await res.json();
    const state = {}, updated = {};
    rows.forEach(r => { if (KEYS.has(r.key)) { state[r.key] = r.data; updated[r.key] = { at: r.updated_at, by: r.updated_by }; } });
    return json({ configured: true, state, updated });
}

export async function PUT(request) {
    const s = settings();
    if (!s) return json({ error: 'Shared database is not configured' }, 503);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const sections = body && typeof body.sections === 'object' ? body.sections : null;
    const entries = sections ? Object.entries(sections).filter(([k]) => KEYS.has(k)) : [];
    if (!entries.length) return json({ error: 'Nothing to save' }, 400);

    const by = staffEmail(request);
    const now = new Date().toISOString();
    const res = await fetch(`${s.url}/rest/v1/${TABLE}?on_conflict=key`, {
        method: 'POST',
        headers: { ...supabaseHeaders(s.key), Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(entries.map(([key, data]) => ({ key, data: data ?? null, updated_at: now, updated_by: by })))
    });
    if (!res.ok) return json({ error: `Database write failed (${res.status})` }, 502);
    return json({ ok: true, saved: entries.map(([k]) => k), at: now });
}

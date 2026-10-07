// 공유 데이터 저장소 API: 모든 직원이 같은 데이터를 보도록 Supabase 테이블 app_state 에 저장
// 로그인 확인은 middleware.js 가 먼저 함 (세션이 없으면 이 함수까지 오지 않음)
//
// Settings in Vercel → Project → Settings → Environment Variables (Supabase integration adds these):
//   SUPABASE_URL                                        e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)  server-only key, never sent to the browser
// Table: run supabase/app_state.sql once in Supabase → SQL Editor.
//
//   GET  /api/state           → { configured, state: {key: data}, versions: {key: n}, updated: {key: {at, by}} }
//   GET  /api/state?check=1   → connection self-test (open it in the browser after signing in)
//   PUT  /api/state  { sections: {key: data}, base: {key: version|null} }
//        → { saved: {key: newVersion}, conflicts: {key: {version, at, by}} }
//        A section is only saved if nobody else saved it since `base` (otherwise it is a conflict).

const TABLE = 'app_state';
const KEYS = new Set(['placementData', 'optData', 'consultationData', 'eventData', 'consultationSource']);

function settings() {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    return url && key ? { url: url.replace(/\/+$/, ''), key } : null;
}

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

// 새 형식 키(sb_secret_...)는 JWT가 아니라 Authorization 헤더에 넣으면 안 됨
const supabaseHeaders = (key, extra = {}) => ({
    apikey: key,
    ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
    'Content-Type': 'application/json',
    ...extra
});

async function db(s, path, options = {}) {
    const res = await fetch(`${s.url}/rest/v1/${path}`, { ...options, headers: supabaseHeaders(s.key, options.headers) });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { ok: res.ok, status: res.status, body };
}

// 누가 저장했는지 기록용 (세션 서명은 middleware.js 가 이미 확인함)
function staffEmail(request) {
    const cookie = (request.headers.get('cookie') || '').split(/;\s*/).find(c => c.startsWith('cidc_session='));
    try {
        const payload = cookie.slice('cidc_session='.length).split('.')[0];
        return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).e || null;
    } catch { return null; }
}

const dbError = r => (r.body && (r.body.message || r.body.hint)) || `HTTP ${r.status}`;

// 연결 점검: 환경변수 → 테이블 읽기 → 버전 열 → 쓰기 순서로 확인하고 다음에 할 일을 알려줌
async function selfTest(request) {
    const s = settings();
    const report = {
        env: {
            SUPABASE_URL: Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
            SERVICE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
        },
        signedInAs: staffEmail(request)
    };
    if (!s) return json({ ok: false, ...report, next: 'Connect Supabase to this Vercel project (Storage tab) so SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are added, then Redeploy.' });
    const read = await db(s, `${TABLE}?select=key,version,updated_at,updated_by`);
    if (!read.ok) return json({ ok: false, ...report, read: dbError(read), next: read.status === 404 || /does not exist|schema cache/i.test(dbError(read)) ? 'Run supabase/app_state.sql in Supabase → SQL Editor.' : 'Check the Supabase key / project status (paused projects must be restored).' });
    const write = await db(s, `${TABLE}?on_conflict=key`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ key: '_healthcheck', data: { at: new Date().toISOString() }, updated_at: new Date().toISOString(), updated_by: report.signedInAs }])
    });
    if (!write.ok) return json({ ok: false, ...report, read: 'ok', write: dbError(write), next: /version/i.test(dbError(write)) ? 'Run the latest supabase/app_state.sql again (adds the version column).' : 'Run supabase/app_state.sql again (it grants write access).' });
    const sections = read.body.filter(r => KEYS.has(r.key)).map(r => ({ key: r.key, version: r.version, updatedAt: r.updated_at, updatedBy: r.updated_by }));
    return json({ ok: true, ...report, read: 'ok', write: 'ok', sections, next: sections.length ? 'All good — data is shared with all staff.' : 'Connected. Upload the latest Excel on the Consultation page to share it with everyone.' });
}

export async function GET(request) {
    if (new URL(request.url).searchParams.has('check')) return selfTest(request);
    const s = settings();
    if (!s) return json({ configured: false });
    const r = await db(s, `${TABLE}?select=key,data,version,updated_at,updated_by`);
    if (!r.ok) return json({ configured: false, error: `Database read failed: ${dbError(r)}` }, 502);
    const state = {}, versions = {}, updated = {};
    r.body.forEach(row => {
        if (!KEYS.has(row.key)) return;
        state[row.key] = row.data;
        versions[row.key] = row.version;
        updated[row.key] = { at: row.updated_at, by: row.updated_by };
    });
    return json({ configured: true, state, versions, updated });
}

export async function PUT(request) {
    const s = settings();
    if (!s) return json({ error: 'Shared database is not configured' }, 503);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const sections = body && typeof body.sections === 'object' && body.sections ? body.sections : null;
    const base = body && typeof body.base === 'object' && body.base ? body.base : {};
    const entries = sections ? Object.entries(sections).filter(([k]) => KEYS.has(k)) : [];
    if (!entries.length) return json({ error: 'Nothing to save' }, 400);

    const by = staffEmail(request);
    const now = new Date().toISOString();
    const saved = {}, conflicts = {};
    for (const [key, data] of entries) {
        const baseVersion = Number.isInteger(base[key]) ? base[key] : null;
        let r;
        if (baseVersion === null) {
            // 서버에 아직 없는 항목: 없을 때만 새로 만듦 (그 사이 다른 사람이 만들었으면 충돌)
            r = await db(s, `${TABLE}?on_conflict=key`, {
                method: 'POST',
                headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
                body: JSON.stringify([{ key, data: data ?? null, version: 1, updated_at: now, updated_by: by }])
            });
        } else {
            // 내가 본 버전 그대로일 때만 갱신 (조건부 업데이트라 동시에 저장해도 한 명만 성공)
            r = await db(s, `${TABLE}?key=eq.${encodeURIComponent(key)}&version=eq.${baseVersion}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify({ data: data ?? null, version: baseVersion + 1, updated_at: now, updated_by: by })
            });
        }
        if (!r.ok) return json({ error: `Database write failed: ${dbError(r)}`, saved, conflicts }, 502);
        if (Array.isArray(r.body) && r.body.length) { saved[key] = r.body[0].version; continue; }
        const cur = await db(s, `${TABLE}?key=eq.${encodeURIComponent(key)}&select=version,updated_at,updated_by`);
        const row = cur.ok && Array.isArray(cur.body) ? cur.body[0] : null;
        conflicts[key] = row ? { version: row.version, at: row.updated_at, by: row.updated_by } : { version: null };
    }
    return json({ saved, conflicts }, Object.keys(conflicts).length ? 409 : 200);
}

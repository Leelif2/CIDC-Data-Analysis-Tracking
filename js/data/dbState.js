const defaultState = {
    activeExcelSheet: 'Placement',
    currentEventIdx: 0,
    placementData: [
        { id: 'STU-101', studentName: 'Alex Johnson', cohort: 'Spring 2024', major: 'Computer Science', company: 'Apple', role: 'Software Engineer', status: 'Employed' },
        { id: 'STU-102', studentName: 'Sarah Smith', cohort: 'Fall 2023', major: 'Data Science', company: 'Google', role: 'Data Analyst', status: 'Employed' },
        { id: 'STU-103', studentName: 'Michael Brown', cohort: 'Spring 2025', major: 'UX Design', company: 'Microsoft', role: 'Product Designer', status: 'Employed' },
        { id: 'STU-104', studentName: 'Emily Davis', cohort: 'Spring 2024', major: 'Business Analytics', company: 'Amazon', role: 'Financial Analyst', status: 'Employed' }
    ],
    optData: [
        { studentId: 'STU-101', name: 'Alex Johnson', optType: 'STEM 24-Mo', status: 'Approved', startDate: '2024-06-01', employer: 'Apple' }
    ],
    // Sample data — replaced when real records are uploaded in Excel List > Consultation Sheet
    consultationData: [
        { sessionDate: '2026-03-15', student: 'Alex Johnson', umail: 'u1100101@umail.utah.edu', counselor: 'Dr. Robert Carter', topic: 'OPT Legal Filing & Resume Review', rating: 5, review: 'The OPT legal seminar clarified all my F1 visa questions and streamlined my EAD application.' },
        { sessionDate: '2026-03-02', student: 'Minji Kim', umail: 'u1100102@umail.utah.edu', counselor: 'Soohyun Lee', topic: 'Mock Interview & Tech Screen Prep', rating: 5, review: '10/10 mock interview sessions. I felt fully prepared for the tech screen at Apple.' },
        { sessionDate: '2026-02-18', student: 'Sarah Smith', umail: 'u1100103@umail.utah.edu', counselor: 'Dr. Robert Carter', topic: 'Career Fair Preparation', rating: 4, review: 'The career fair prep session was directly responsible for my full-time offer.' },
        { sessionDate: '2026-01-27', student: 'Junho Park', umail: 'u1100104@umail.utah.edu', counselor: 'Soohyun Lee', topic: 'Resume Review', rating: 4, review: 'My resume is much cleaner now and I am getting more interview calls.' },
        { sessionDate: '2025-11-12', student: 'Alex Johnson', umail: 'u1100101@umail.utah.edu', counselor: 'Dr. Robert Carter', topic: 'Resume Review', rating: 4, review: 'Clear, specific edits. My bullet points finally show impact.' },
        { sessionDate: '2025-09-22', student: 'Minji Kim', umail: 'u1100102@umail.utah.edu', counselor: 'Soohyun Lee', topic: 'Career Planning', rating: 5, review: 'Helped me map out internships for the next two semesters.' },
        { sessionDate: '2026-02-05', student: 'Minji Kim', umail: 'u1100207@umail.utah.edu', counselor: 'Jane Park', topic: 'F-1 Work Authorization Q&A', rating: 4, review: 'Quick, clear answers about on-campus work limits.' },
        { sessionDate: '2025-10-08', student: 'Emily Davis', umail: 'u1100105@umail.utah.edu', counselor: 'Jane Park', topic: 'Networking Strategy', rating: 5, review: 'Practical advice on reaching out to alumni on LinkedIn.' },
        { sessionDate: '2025-07-14', student: 'Yuna Choi', umail: 'u1100106@umail.utah.edu', counselor: 'Jane Park', topic: 'STEM OPT Extension', rating: 3, review: '' }
    ],
    eventData: [
        { title: 'OPT Workshop & Legal Seminar', date: '2026-02-15', attendance: 220, photo: 'https://images.unsplash.com/photo-1475721027785-f74eccf877e2?w=1000&auto=format&fit=crop&q=80', desc: 'Comprehensive visa & STEM OPT guidance with certified immigration attorneys.' },
        { title: 'Annual Spring Career Fair 2026', date: '2026-03-10', attendance: 450, photo: 'https://images.unsplash.com/photo-1511578314322-379afb476865?w=1000&auto=format&fit=crop&q=80', desc: 'Over 50 global tech and finance corporations recruiting on-campus.' },
        { title: 'Tech Alumni Networking Night', date: '2026-02-28', attendance: 180, photo: 'https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=1000&auto=format&fit=crop&q=80', desc: 'Direct 1-on-1 mentorship with senior engineers from Silicon Valley.' },
        { title: 'Resume & Portfolio Review Blitz', date: '2026-01-20', attendance: 310, photo: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=1000&auto=format&fit=crop&q=80', desc: 'Personalized feedback sessions with top corporate recruiters.' }
    ],
};

// ---------------------------------------------------------------------
// 저장: 서버 공유 저장소(/api/state → Supabase)에 자동 저장 + 이 브라우저에 사본(localStorage)
// 모든 직원이 같은 데이터를 봄. 서버가 아직 설정 안 됐거나 연결이 안 되면 이 브라우저 사본만 사용
// 항목마다 버전 번호가 있어서, 다른 직원이 먼저 저장한 항목은 덮어쓰지 않고 새로고침을 안내함
// ---------------------------------------------------------------------
const STORAGE_KEY = 'cidc_dashboard_data_v2';
// 직원 모두가 공유하는 항목 (activeExcelSheet 같은 화면 상태는 공유하지 않음)
const SHARED_KEYS = ['placementData', 'optData', 'consultationData', 'eventData', 'consultationSource'];
const SYNC_DELAY_MS = 600;
const FRESHNESS_CHECK_MS = 60000;
const KEEPALIVE_LIMIT = 60000; // 페이지를 떠나도 전송이 끝나는 요청의 크기 한도 (브라우저 64KB)

function loadLocalState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return JSON.parse(saved);
    } catch (e) {}
    return JSON.parse(JSON.stringify(defaultState));
}

// 페이지를 그리기 전에 서버 데이터를 받아야 하므로 동기 요청 (실패하면 null → 브라우저 사본 사용)
function fetchServerState() {
    try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/state', false);
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.send();
        if (xhr.status === 200) return JSON.parse(xhr.responseText);
    } catch (e) {}
    return null;
}

const toJson = v => JSON.stringify(v ?? null);
const DEFAULT_JSON = Object.fromEntries(SHARED_KEYS.map(k => [k, toJson(defaultState[k])]));

// synced: 서버에 있는 것으로 알고 있는 값(JSON), versions: 그 값의 버전 (서버에 없으면 null)
const cloudSync = {
    enabled: false, synced: {}, versions: {}, timer: null, saving: false, pending: false,
    failed: false, conflicts: {}, staleBy: null, keepaliveInFlight: false
};

(function initState() {
    const local = loadLocalState();
    const server = fetchServerState();
    if (server && server.configured) {
        cloudSync.enabled = true;
        const remote = server.state || {};
        const versions = server.versions || {};
        SHARED_KEYS.forEach(k => {
            if (k in remote) {
                local[k] = remote[k]; // 서버 값이 기준
                cloudSync.synced[k] = toJson(remote[k]);
                cloudSync.versions[k] = Number.isInteger(versions[k]) ? versions[k] : null;
            } else {
                cloudSync.versions[k] = null;
                // 서버에 아직 없는 항목: 이 브라우저에 실제 데이터가 있으면 처음으로 올림, 기본 샘플이면 올리지 않음
                cloudSync.synced[k] = toJson(local[k]) === DEFAULT_JSON[k] ? toJson(local[k]) : toJson(null);
            }
        });
    }
    window.dbState = local;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(local)); } catch (e) {}
})();
window.chartInstances = {};

function changedSections() {
    const out = {};
    SHARED_KEYS.forEach(k => {
        if (cloudSync.conflicts[k] || window.dbState[k] === undefined) return;
        if (toJson(window.dbState[k]) !== cloudSync.synced[k]) out[k] = window.dbState[k];
    });
    return out;
}

async function pushToServer({ leaving = false } = {}) {
    clearTimeout(cloudSync.timer);
    cloudSync.timer = null;
    if (cloudSync.saving) { cloudSync.pending = true; return; }
    const sections = changedSections();
    const keys = Object.keys(sections);
    if (!keys.length) { renderSyncBadge(); return; }
    const sent = Object.fromEntries(keys.map(k => [k, toJson(sections[k])]));
    const base = Object.fromEntries(keys.map(k => [k, cloudSync.versions[k] ?? null]));
    const body = JSON.stringify({ sections, base });
    const keepalive = body.length < KEEPALIVE_LIMIT;
    cloudSync.saving = true;
    cloudSync.keepaliveInFlight = keepalive;
    renderSyncBadge();
    try {
        const res = await fetch('/api/state', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body,
            keepalive // 작은 저장은 페이지를 떠나도 끝까지 전송됨
        });
        const result = await res.json().catch(() => ({}));
        if (res.status !== 200 && res.status !== 409) throw new Error(result.error || `HTTP ${res.status}`);
        Object.entries(result.saved || {}).forEach(([k, v]) => { cloudSync.synced[k] = sent[k]; cloudSync.versions[k] = v; });
        // 다른 직원이 먼저 저장한 항목: 덮어쓰지 않고 멈춤 → 새로고침 안내
        Object.entries(result.conflicts || {}).forEach(([k, info]) => { cloudSync.conflicts[k] = info || {}; });
        cloudSync.failed = false;
    } catch (e) {
        cloudSync.failed = true;
        if (!leaving) setTimeout(scheduleServerSave, 5000); // 잠시 후 다시 시도
    }
    cloudSync.saving = false;
    cloudSync.keepaliveInFlight = false;
    if (cloudSync.pending) { cloudSync.pending = false; scheduleServerSave(); }
    renderSyncBadge();
    renderSyncBanner();
}

function scheduleServerSave() {
    if (!cloudSync.enabled) return;
    clearTimeout(cloudSync.timer);
    cloudSync.timer = setTimeout(pushToServer, SYNC_DELAY_MS);
    renderSyncBadge();
}

// 데이터가 바뀔 때마다 호출: 이 브라우저에 바로 저장 + 서버에 자동 저장
window.saveStateToStorage = function() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(window.dbState)); } catch (e) {}
    scheduleServerSave();
};

// 페이지를 떠날 때: 기다리던 저장은 바로 보냄. 작은 저장은 떠나도 전송이 끝나므로 경고 없음
// 경고는 '떠나면 끊기는 큰 저장'이 진행 중일 때만 (계속 실패 중일 때는 배지로만 알림)
window.addEventListener('beforeunload', e => {
    if (!cloudSync.enabled) return;
    if (cloudSync.timer) pushToServer({ leaving: true });
    if (cloudSync.saving && !cloudSync.keepaliveInFlight) {
        e.preventDefault();
        e.returnValue = '';
    }
});

// 열어 둔 화면이 오래되었는지 확인: 다른 직원이 저장한 새 데이터가 있으면 새로고침 안내
async function checkFreshness() {
    if (!cloudSync.enabled || document.visibilityState === 'hidden' || cloudSync.saving || cloudSync.timer) return;
    try {
        const res = await fetch('/api/state', { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (!res.ok) return;
        const server = await res.json();
        if (!server.configured || cloudSync.saving || cloudSync.timer) return; // 그 사이 내가 저장을 시작했으면 다음에 확인
        const versions = server.versions || {};
        const newer = SHARED_KEYS.filter(k => (versions[k] ?? null) !== (cloudSync.versions[k] ?? null));
        if (!newer.length) return;
        cloudSync.staleBy = newer.map(k => server.updated && server.updated[k] && server.updated[k].by).find(Boolean) || 'Another staff member';
        renderSyncBanner();
    } catch (e) {}
}

const SECTION_LABELS = { consultationData: 'consultation records', placementData: 'placement data', optData: 'OPT data', eventData: 'event data', consultationSource: 'uploaded file info' };

// 화면 위쪽 안내: 충돌(내 변경이 저장되지 않음) 또는 다른 직원의 새 데이터
function renderSyncBanner() {
    const conflictKeys = Object.keys(cloudSync.conflicts);
    let banner = document.getElementById('cidc-sync-banner');
    if (!conflictKeys.length && !cloudSync.staleBy) { if (banner) banner.remove(); return; }
    if (!document.body) return;
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'cidc-sync-banner';
        banner.setAttribute('role', 'alert');
        banner.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:70;width:max-content;max-width:calc(100vw - 32px);display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;font:600 14px/1.4 system-ui,sans-serif;padding:12px 16px;border-radius:14px;border:1px solid;box-shadow:0 10px 30px rgba(15,23,42,.15)';
        document.body.appendChild(banner);
    }
    const conflict = conflictKeys.length > 0;
    const by = conflict ? (cloudSync.conflicts[conflictKeys[0]].by || 'Another staff member') : cloudSync.staleBy;
    const message = conflict
        ? `⚠ ${by} updated the ${conflictKeys.map(k => SECTION_LABELS[k] || k).join(', ')} before you. Your last change was NOT saved, so their newer data isn't overwritten. Reload to see the latest data, then make your change again.`
        : `ⓘ ${by} has updated the data. Reload to see the latest version before making changes.`;
    banner.style.background = conflict ? '#fef2f2' : '#eff6ff';
    banner.style.color = conflict ? '#991b1b' : '#1e3a8a';
    banner.style.borderColor = conflict ? '#fecaca' : '#bfdbfe';
    banner.innerHTML = '';
    const text = document.createElement('span');
    text.style.maxWidth = '520px';
    text.textContent = message;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Reload latest';
    button.style.cssText = 'font:inherit;font-weight:800;color:#fff;background:#2563eb;border:0;border-radius:10px;padding:8px 14px;cursor:pointer';
    button.onclick = () => location.reload();
    banner.append(text, button);
}

// 화면 왼쪽 아래 저장 상태 표시
function renderSyncBadge() {
    let badge = document.getElementById('cidc-sync-badge');
    if (!badge) {
        if (!document.body) return;
        badge = document.createElement('div');
        badge.id = 'cidc-sync-badge';
        badge.setAttribute('role', 'status');
        badge.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:60;font:600 13px/1.2 system-ui,sans-serif;padding:8px 12px;border-radius:12px;border:1px solid;box-shadow:0 4px 14px rgba(15,23,42,.08)';
        document.body.appendChild(badge);
    }
    let text, colors;
    if (!cloudSync.enabled) { text = '⚠ Saved on this computer only'; colors = ['#fffbeb', '#92400e', '#fcd34d']; }
    else if (Object.keys(cloudSync.conflicts).length) { text = '⚠ Not saved — newer data on server'; colors = ['#fef2f2', '#b91c1c', '#fecaca']; }
    else if (cloudSync.saving || cloudSync.timer) { text = '⟳ Saving…'; colors = ['#eff6ff', '#1d4ed8', '#bfdbfe']; }
    else if (cloudSync.failed) { text = '⚠ Not saved to server — retrying'; colors = ['#fef2f2', '#b91c1c', '#fecaca']; }
    else { text = '✓ All changes saved'; colors = ['#ecfdf5', '#047857', '#a7f3d0']; }
    badge.textContent = text;
    badge.title = cloudSync.enabled ? 'Shared with all staff' : 'The shared database is not connected yet, so changes stay in this browser.';
    badge.style.background = colors[0]; badge.style.color = colors[1]; badge.style.borderColor = colors[2];
}

window.addEventListener('DOMContentLoaded', () => {
    renderSyncBadge();
    if (!cloudSync.enabled) return;
    // 서버에 아직 없던 실제 데이터(처음 연결 시)는 바로 올림
    if (Object.keys(changedSections()).length) scheduleServerSave();
    setInterval(checkFreshness, FRESHNESS_CHECK_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkFreshness(); });
});

// 현재 탭에 맞는 데이터 배열을 반환하는 함수 (모든 파일에서 공유됨)
window.getActiveSheetData = function() {
    if (window.dbState.activeExcelSheet === 'Placement') return window.dbState.placementData;
    if (window.dbState.activeExcelSheet === 'OPT') return window.dbState.optData;
    if (window.dbState.activeExcelSheet === 'Consultation') return window.dbState.consultationData;
    if (window.dbState.activeExcelSheet === 'Event') return window.dbState.eventData;
    return [];
};
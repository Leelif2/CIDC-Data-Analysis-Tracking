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
// ---------------------------------------------------------------------
const STORAGE_KEY = 'cidc_dashboard_data_v2';
// 직원 모두가 공유하는 항목 (activeExcelSheet 같은 화면 상태는 공유하지 않음)
const SHARED_KEYS = ['placementData', 'optData', 'consultationData', 'eventData', 'consultationSource'];
const SYNC_DELAY_MS = 600;

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

const sectionJson = state => Object.fromEntries(SHARED_KEYS.map(k => [k, JSON.stringify(state[k] ?? null)]));

const cloudSync = { enabled: false, synced: {}, timer: null, saving: false, pending: false, failed: false };

(function initState() {
    const local = loadLocalState();
    const server = fetchServerState();
    if (server && server.configured) {
        cloudSync.enabled = true;
        const remote = server.state || {};
        // 서버에 있는 항목은 서버 값을 사용, 서버에 아직 없는 항목은 이 브라우저 값을 처음으로 올림
        SHARED_KEYS.forEach(k => { if (k in remote) local[k] = remote[k]; });
        cloudSync.synced = sectionJson(remote); // 서버에 없는 항목은 'null' → 이 브라우저 값과 달라서 처음 한 번 올라감
    }
    window.dbState = local;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(local)); } catch (e) {}
})();
window.chartInstances = {};

function changedSections() {
    const now = sectionJson(window.dbState);
    const out = {};
    SHARED_KEYS.forEach(k => { if (now[k] !== cloudSync.synced[k] && window.dbState[k] !== undefined) out[k] = window.dbState[k]; });
    return out;
}

async function pushToServer() {
    cloudSync.timer = null;
    if (cloudSync.saving) { cloudSync.pending = true; return; }
    const sections = changedSections();
    if (!Object.keys(sections).length) { renderSyncBadge(); return; }
    cloudSync.saving = true;
    renderSyncBadge();
    const sent = sectionJson(sections);
    const body = JSON.stringify({ sections });
    try {
        const res = await fetch('/api/state', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body,
            keepalive: body.length < 60000 // 작은 저장은 페이지를 떠나도 끝까지 전송 (브라우저 한도 64KB)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        Object.keys(sections).forEach(k => { cloudSync.synced[k] = sent[k]; });
        cloudSync.failed = false;
    } catch (e) {
        cloudSync.failed = true;
        // 잠시 후 다시 시도
        setTimeout(scheduleServerSave, 5000);
    }
    cloudSync.saving = false;
    if (cloudSync.pending) { cloudSync.pending = false; scheduleServerSave(); }
    renderSyncBadge();
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

// 저장 안 된 변경이 있으면 페이지를 떠나기 전에 경고
window.addEventListener('beforeunload', e => {
    if (cloudSync.enabled && (cloudSync.timer || cloudSync.saving || Object.keys(changedSections()).length)) {
        if (cloudSync.timer) { clearTimeout(cloudSync.timer); pushToServer(); }
        e.preventDefault();
        e.returnValue = '';
    }
});

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
    else if (cloudSync.saving || cloudSync.timer) { text = '⟳ Saving…'; colors = ['#eff6ff', '#1d4ed8', '#bfdbfe']; }
    else if (cloudSync.failed) { text = '⚠ Not saved to server — retrying'; colors = ['#fef2f2', '#b91c1c', '#fecaca']; }
    else { text = '✓ All changes saved'; colors = ['#ecfdf5', '#047857', '#a7f3d0']; }
    badge.textContent = text;
    badge.title = cloudSync.enabled ? 'Shared with all staff' : 'The shared database is not connected yet, so changes stay in this browser.';
    badge.style.background = colors[0]; badge.style.color = colors[1]; badge.style.borderColor = colors[2];
}

window.addEventListener('DOMContentLoaded', () => {
    renderSyncBadge();
    // 서버에 아직 없던 항목(처음 연결 시)은 바로 올림
    if (cloudSync.enabled && Object.keys(changedSections()).length) scheduleServerSave();
});

// 현재 탭에 맞는 데이터 배열을 반환하는 함수 (모든 파일에서 공유됨)
window.getActiveSheetData = function() {
    if (window.dbState.activeExcelSheet === 'Placement') return window.dbState.placementData;
    if (window.dbState.activeExcelSheet === 'OPT') return window.dbState.optData;
    if (window.dbState.activeExcelSheet === 'Consultation') return window.dbState.consultationData;
    if (window.dbState.activeExcelSheet === 'Event') return window.dbState.eventData;
    return [];
};
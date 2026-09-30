// 컨설턴트 전용 Consultation 페이지: 학생별 상담 이력을 한눈에
// 데이터는 Excel List > Consultation Sheet (window.dbState.consultationData) 그대로 사용
let selectedStudentKey = null;

const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const studentKey = rec => String(rec.student || '').trim().toLowerCase();
// onclick 인자용: 작은따옴표까지 인코딩 (O'Brien 같은 이름 대비)
const keyArg = key => encodeURIComponent(key).replace(/'/g, '%27');

function starsHtml(value) {
    const rating = toRating(value);
    if (rating === null) return '<span class="text-slate-300 font-bold">No rating</span>';
    const color = rating >= 4 ? 'text-amber-500' : rating >= 3 ? 'text-amber-400' : 'text-rose-500';
    const n = Math.round(rating);
    return `<span class="${color} tracking-tight">${'★'.repeat(n)}<span class="text-slate-300">${'★'.repeat(5 - n)}</span></span>`;
}

function setSelectOptions(id, values, allLabel) {
    const select = document.getElementById(id);
    if (!select) return;
    const prev = select.value;
    select.innerHTML = `<option value="All">${allLabel}</option>` + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    select.value = values.includes(prev) ? prev : 'All';
}

function getConsultFilters() {
    return {
        query: (document.getElementById('consult-search')?.value || '').trim().toLowerCase(),
        year: document.getElementById('filter-year')?.value || 'All',
        season: document.getElementById('filter-season')?.value || 'All',
        counselor: document.getElementById('filter-counselor')?.value || 'All'
    };
}

function applyConsultFilters(records, f) {
    return filterConsultations(records, f.year, f.season).filter(r => {
        if (f.counselor !== 'All' && r.counselor !== f.counselor) return false;
        if (!f.query) return true;
        return [r.student, r.topic, r.review, r.counselor].some(v => String(v || '').toLowerCase().includes(f.query));
    });
}

const byDateDesc = (a, b) => (b.sessionDate || '').localeCompare(a.sessionDate || '');

function groupByStudent(records) {
    const groups = new Map();
    records.forEach(r => {
        const key = studentKey(r);
        if (!key) return;
        if (!groups.has(key)) groups.set(key, { key, name: String(r.student).trim(), sessions: [] });
        groups.get(key).sessions.push(r);
    });
    return [...groups.values()].map(g => {
        g.sessions.sort(byDateDesc);
        g.stats = consultationStats(g.sessions);
        g.last = g.sessions[0];
        return g;
    }).sort((a, b) => byDateDesc(a.last, b.last));
}

function renderConsultationPage() {
    const all = getConsultationRecords();
    setSelectOptions('filter-year', getConsultationYears(all), 'All Years');
    setSelectOptions('filter-counselor', [...new Set(all.map(r => r.counselor).filter(Boolean))].sort(), 'All Counselors');

    const filtered = applyConsultFilters(all, getConsultFilters());
    const students = groupByStudent(filtered);
    renderConsultKpis(filtered, students);
    renderStudentList(students);
    renderStudentDetail(all);
    renderSessionTable(filtered);
}

function renderConsultKpis(filtered, students) {
    const stats = consultationStats(filtered);
    document.getElementById('kpi-sessions').innerText = stats.sessions.toLocaleString();
    document.getElementById('kpi-students').innerText = students.length.toLocaleString();
    document.getElementById('kpi-avg').innerText = stats.avg === null ? '-' : `${stats.avg.toFixed(1)} / 5`;
    document.getElementById('kpi-high').innerText = stats.highPct === null ? '-' : `${Math.round(stats.highPct)}%`;
}

function renderStudentList(students) {
    const list = document.getElementById('student-list');
    document.getElementById('student-count-badge').innerText = students.length;
    if (!students.length) {
        list.innerHTML = '<p class="text-[10px] text-slate-500 p-3 text-center">No students match these filters.</p>';
        return;
    }
    list.innerHTML = students.map(s => {
        const active = s.key === selectedStudentKey;
        return `
        <button onclick="selectStudent('${keyArg(s.key)}')" class="w-full text-left p-3 rounded-xl border transition-all ${active ? 'bg-blue-50 border-blue-300 shadow-sm' : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-slate-50'}">
            <div class="flex justify-between items-center gap-2">
                <span class="text-[12px] font-black text-slate-900 truncate">${escapeHtml(s.name)}</span>
                <span class="shrink-0 bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded-full text-[9px] font-black">${s.sessions.length} session${s.sessions.length === 1 ? '' : 's'}</span>
            </div>
            <div class="flex justify-between items-center gap-2 mt-1 text-[10px]">
                <span class="text-slate-500 font-semibold truncate">${escapeHtml(s.last.topic || 'No topic')}</span>
                <span class="shrink-0 text-[10px]">${starsHtml(s.stats.avg)}</span>
            </div>
            <div class="text-[9px] font-bold text-slate-400 mt-0.5">Last session: ${escapeHtml(s.last.sessionDate || '-')}${s.last.counselor ? ` · ${escapeHtml(s.last.counselor)}` : ''}</div>
        </button>`;
    }).join('');
}

// 상세 패널은 필터와 관계없이 해당 학생의 전체 상담 이력을 보여줌
function renderStudentDetail(all) {
    const panel = document.getElementById('student-detail');
    const student = selectedStudentKey && groupByStudent(all.filter(r => studentKey(r) === selectedStudentKey))[0];
    if (!student) {
        panel.innerHTML = `
            <div class="flex flex-col items-center justify-center text-center py-16 space-y-2">
                <div class="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center text-xl"><i class="fa-solid fa-user-graduate"></i></div>
                <h3 class="text-[14px] font-black text-slate-900">Select a student</h3>
                <p class="text-[10px] text-slate-500 font-semibold">Their full consultation history will appear here.</p>
            </div>`;
        return;
    }

    const sessions = student.sessions;
    const first = sessions[sessions.length - 1].sessionDate || '-';
    const counselors = [...new Set(sessions.map(s => s.counselor).filter(Boolean))];
    const initials = student.name.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
    const chip = (label, value) => `
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
            <span class="block text-[9px] font-black text-slate-500 uppercase tracking-wider">${label}</span>
            <span class="block text-[12px] font-black text-slate-900 mt-0.5">${value}</span>
        </div>`;

    panel.innerHTML = `
        <div class="flex justify-between items-start gap-3 border-b border-slate-200 pb-3">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-11 h-11 shrink-0 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center text-[13px] font-black">${escapeHtml(initials)}</div>
                <div class="min-w-0">
                    <h3 class="text-[16px] font-black text-slate-900 truncate">${escapeHtml(student.name)}</h3>
                    <p class="text-[10px] text-slate-500 font-semibold truncate">${counselors.length ? `Counselor${counselors.length > 1 ? 's' : ''}: ${escapeHtml(counselors.join(', '))}` : 'No counselor recorded'}</p>
                </div>
            </div>
            <button onclick="selectStudent(null)" class="shrink-0 w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center" title="Close"><i class="fa-solid fa-xmark text-[11px]"></i></button>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            ${chip('Sessions', sessions.length)}
            ${chip('Avg Rating', student.stats.avg === null ? '-' : `${student.stats.avg.toFixed(1)} / 5`)}
            ${chip('First Session', escapeHtml(first))}
            ${chip('Last Session', escapeHtml(student.last.sessionDate || '-'))}
        </div>

        <div>
            <h4 class="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2">Session History</h4>
            <ol class="space-y-0 max-h-[380px] overflow-y-auto pr-1">
                ${sessions.map(sessionCardHtml).join('')}
            </ol>
        </div>`;
}

function sessionCardHtml(s) {
    const season = seasonOfDate(s.sessionDate);
    const extras = Object.entries(s).filter(([k, v]) => !CONSULT_FIELDS.includes(k) && v !== '' && v !== null && v !== undefined);
    return `
        <li class="relative ml-1.5 pl-4 pb-3 border-l-2 border-slate-200 last:border-transparent">
            <span class="absolute -left-[7px] top-3 w-3 h-3 rounded-full bg-blue-600 ring-2 ring-white"></span>
            <div class="bg-white border border-slate-200 rounded-xl p-3 shadow-sm space-y-1.5">
                <div class="flex flex-wrap justify-between items-center gap-2">
                    <div class="flex items-center gap-1.5">
                        <span class="text-[10px] font-black text-slate-900">${escapeHtml(s.sessionDate || 'No date')}</span>
                        ${season ? `<span class="bg-teal-50 text-teal-700 border border-teal-200 px-1.5 py-0.5 rounded text-[9px] font-extrabold">${season}</span>` : ''}
                    </div>
                    <span class="text-[11px]">${starsHtml(s.rating)}</span>
                </div>
                <div class="text-[11px] font-black text-slate-800">${escapeHtml(s.topic || 'No topic')}</div>
                ${s.counselor ? `<div class="text-[10px] font-bold text-slate-500"><i class="fa-solid fa-user-tie mr-1 text-slate-400"></i>${escapeHtml(s.counselor)}</div>` : ''}
                ${s.review ? `<p class="text-[10px] italic text-slate-700 font-medium leading-snug bg-slate-50 border border-slate-200 rounded-lg p-2">"${escapeHtml(s.review)}"</p>` : ''}
                ${extras.map(([k, v]) => `<div class="text-[10px]"><span class="font-black text-slate-500">${escapeHtml(k)}:</span> <span class="text-slate-700 font-semibold">${escapeHtml(v)}</span></div>`).join('')}
            </div>
        </li>`;
}

function renderSessionTable(filtered) {
    const body = document.getElementById('session-table-body');
    const rows = [...filtered].sort(byDateDesc);
    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-500">No sessions match these filters.</td></tr>';
        return;
    }
    body.innerHTML = rows.map(r => `
        <tr onclick="selectStudent('${keyArg(studentKey(r))}')" class="cursor-pointer transition-colors ${studentKey(r) === selectedStudentKey ? 'bg-blue-50' : 'hover:bg-slate-50'}">
            <td class="p-3 whitespace-nowrap font-bold text-slate-900">${escapeHtml(r.sessionDate || '-')}</td>
            <td class="p-3 whitespace-nowrap font-bold text-blue-600">${escapeHtml(r.student || '-')}</td>
            <td class="p-3 whitespace-nowrap">${escapeHtml(r.counselor || '-')}</td>
            <td class="p-3">${escapeHtml(r.topic || '-')}</td>
            <td class="p-3 whitespace-nowrap">${starsHtml(r.rating)}</td>
            <td class="p-3 max-w-[280px] truncate text-slate-500 italic">${escapeHtml(r.review || '')}</td>
        </tr>`).join('');
}

// 선택한 학생은 주소(#student=...)에 남겨 새로고침·링크 공유 시에도 유지
function selectStudent(encodedKey) {
    selectedStudentKey = encodedKey ? decodeURIComponent(encodedKey) : null;
    history.replaceState(null, '', selectedStudentKey ? `#student=${encodeURIComponent(selectedStudentKey)}` : location.pathname);
    renderConsultationPage();
    if (selectedStudentKey && window.innerWidth < 1024) document.getElementById('student-detail')?.scrollIntoView({ behavior: 'smooth' });
}

function resetConsultFilters() {
    document.getElementById('consult-search').value = '';
    ['filter-year', 'filter-season', 'filter-counselor'].forEach(id => { document.getElementById(id).value = 'All'; });
    renderConsultationPage();
}

function goToConsultationSheet() {
    window.dbState.activeExcelSheet = 'Consultation';
    window.saveStateToStorage();
    window.location.href = 'data-management.html';
}

window.addEventListener('DOMContentLoaded', () => {
    const match = /#student=(.+)$/.exec(location.hash);
    if (match) selectedStudentKey = decodeURIComponent(match[1]);
    renderConsultationPage();
});

// 컨설턴트 전용 Consultation Records 페이지: 학생별·카테고리별 상담 이력
// 데이터는 Excel List > Consultation Sheet (window.dbState.consultationData) 그대로 사용
let selectedStudentKey = null;
let activeCategory = 'all';

const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 학생 구분: uMail 우선 (동명이인 대비), uMail이 없는 기록만 이름으로 묶음
const studentKey = consultStudentKey;
// onclick 인자용: 작은따옴표까지 인코딩 (O'Brien 같은 이름 대비)
const jsArg = v => encodeURIComponent(v).replace(/'/g, '%27');
const byDateDesc = (a, b) => (b.sessionDate || '').localeCompare(a.sessionDate || '');

// '2026-03-15' -> 'Mar 15, 2026'
function formatDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || 'No date';
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function starsHtml(value) {
    const rating = toRating(value);
    if (rating === null) return '';
    const n = Math.round(rating);
    return `<span class="text-amber-500 text-[15px] tracking-tight" title="${rating} / 5">${'★'.repeat(n)}<span class="text-slate-300">${'★'.repeat(5 - n)}</span></span>`;
}

function umailBadgeHtml(umail) {
    if (!umail) return '<span class="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-lg text-[13px] font-bold"><i class="fa-solid fa-triangle-exclamation"></i> No uMail · matched by name</span>';
    const warn = isValidUmail(umail) ? '' : ' <span class="bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-lg text-[12px] font-bold" title="Expected format: u1234567@umail.utah.edu">Check format</span>';
    return `<span class="text-[14px] font-semibold text-blue-700"><i class="fa-regular fa-envelope mr-1.5 text-blue-400"></i>${escapeHtml(umail)}</span>${warn}`;
}

function categoryChipHtml(cat) {
    return `<span class="inline-flex items-center gap-1.5 border px-2.5 py-1 rounded-full text-[13px] font-bold ${cat.chip}"><i class="fa-solid ${cat.icon} text-[12px]"></i>${escapeHtml(cat.label)}</span>`;
}

function groupByStudent(records) {
    const groups = new Map();
    records.forEach(r => {
        const key = studentKey(r);
        if (!key) return;
        if (!groups.has(key)) groups.set(key, { key, umail: r.umail, sessions: [] });
        groups.get(key).sessions.push(r);
    });
    return [...groups.values()].map(g => {
        g.sessions.sort(byDateDesc);
        g.last = g.sessions[0];
        // 같은 uMail에 이름이 다르게 적힌 경우: 가장 최근 이름을 대표로, 나머지는 별칭으로 표시
        const names = [...new Set(g.sessions.map(x => String(x.student || '').trim()).filter(Boolean))];
        g.name = names[0] || g.umail || 'Unknown student';
        g.aliases = names.slice(1);
        return g;
    }).sort((a, b) => byDateDesc(a.last, b.last));
}

// 카테고리별 묶음 (CONSULT_CATEGORIES 순서, 사용자 정의 카테고리는 Other 바로 앞)
function groupByCategory(records) {
    const groups = new Map();
    records.forEach(r => {
        const cat = getConsultCategory(r);
        if (!groups.has(cat.id)) groups.set(cat.id, { cat, sessions: [] });
        groups.get(cat.id).sessions.push(r);
    });
    const order = id => { const i = CONSULT_CATEGORIES.findIndex(c => c.id === id); return i === -1 ? CONSULT_CATEGORIES.length - 1.5 : i; };
    return [...groups.values()].sort((a, b) => order(a.cat.id) - order(b.cat.id));
}

function renderConsultationPage() {
    const all = getConsultationRecords();

    const counselorSelect = document.getElementById('filter-counselor');
    const counselors = [...new Set(all.map(r => r.counselor).filter(Boolean))].sort();
    const prevCounselor = counselorSelect.value;
    counselorSelect.innerHTML = '<option value="All">All Counselors</option>' + counselors.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    counselorSelect.value = counselors.includes(prevCounselor) ? prevCounselor : 'All';

    renderSummary(all);

    const query = document.getElementById('consult-search').value.trim().toLowerCase();
    const counselor = counselorSelect.value;
    const searched = all.filter(r => {
        if (counselor !== 'All' && r.counselor !== counselor) return false;
        if (!query) return true;
        return [r.student, r.umail, r.topic, r.review, r.counselor, getConsultCategory(r).label].some(v => String(v || '').toLowerCase().includes(query));
    });

    const categoryGroups = groupByCategory(searched);
    if (activeCategory !== 'all' && !categoryGroups.some(g => g.cat.id === activeCategory)) activeCategory = 'all';
    renderCategoryTabs(categoryGroups, searched.length);

    const inCategory = activeCategory === 'all' ? searched : searched.filter(r => getConsultCategory(r).id === activeCategory);
    const activeLabel = activeCategory === 'all' ? '' : categoryGroups.find(g => g.cat.id === activeCategory).cat.label;
    renderStudentList(groupByStudent(inCategory), activeLabel);
    renderStudentDetail(all);
}

function renderSummary(all) {
    const students = new Set(all.map(studentKey).filter(Boolean));
    const latest = all.map(r => r.sessionDate).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop();
    document.getElementById('kpi-sessions').innerText = all.length.toLocaleString();
    document.getElementById('kpi-students').innerText = students.size.toLocaleString();
    document.getElementById('kpi-latest').innerText = latest ? formatDate(latest) : '-';
}

function renderCategoryTabs(groups, total) {
    const tab = (id, label, icon, count, cat) => {
        const active = activeCategory === id;
        const style = active ? (cat ? cat.active : 'bg-slate-900 text-white border-slate-900') : (cat ? cat.chip : 'bg-white text-slate-700 border-slate-300');
        return `<button onclick="selectCategory('${jsArg(id)}')" class="inline-flex items-center gap-2 border px-4 py-2.5 rounded-2xl text-[15px] font-bold transition-all hover:shadow-sm ${style}">
            <i class="fa-solid ${icon}"></i> ${escapeHtml(label)}
            <span class="min-w-[24px] text-center px-2 py-0.5 rounded-full text-[12px] font-black ${active ? 'bg-white/25' : 'bg-white'}">${count}</span>
        </button>`;
    };
    document.getElementById('category-tabs').innerHTML =
        tab('all', 'All', 'fa-layer-group', total, null) +
        groups.map(g => tab(g.cat.id, g.cat.label, g.cat.icon, g.sessions.length, g.cat)).join('');
}

function renderStudentList(students, categoryLabel) {
    const list = document.getElementById('student-list');
    document.getElementById('student-count').innerText = `${students.length} student${students.length === 1 ? '' : 's'}`;
    document.getElementById('list-caption').innerText = categoryLabel ? `Grouped by student · ${categoryLabel}` : 'Grouped by student';
    if (!students.length) {
        list.innerHTML = '<div class="border border-dashed border-slate-300 rounded-3xl p-8 text-center text-[16px] text-slate-500 font-medium">No students match this search.</div>';
        return;
    }
    list.innerHTML = students.map(s => {
        const active = s.key === selectedStudentKey;
        const cats = groupByCategory(s.sessions).map(g => categoryChipHtml(g.cat)).join('');
        return `
        <button onclick="selectStudent('${jsArg(s.key)}')" class="w-full text-left bg-white border rounded-3xl p-5 md:p-6 transition-all ${active ? 'border-blue-400 ring-2 ring-blue-100 shadow-sm' : 'border-slate-200 hover:border-blue-300 hover:shadow-sm'}">
            <div class="flex justify-between items-start gap-3">
                <div class="min-w-0 space-y-1">
                    <div class="text-[22px] font-black text-slate-900 leading-tight truncate">${escapeHtml(s.name)}</div>
                    <div>${umailBadgeHtml(s.umail)}</div>
                </div>
                <span class="shrink-0 bg-blue-50 text-blue-700 px-3.5 py-1.5 rounded-full text-[14px] font-black">${s.sessions.length} session${s.sessions.length === 1 ? '' : 's'}</span>
            </div>
            <div class="text-[15px] text-slate-500 font-medium mt-2">Latest session: ${escapeHtml(formatDate(s.last.sessionDate))}${s.last.counselor ? ` · ${escapeHtml(s.last.counselor)}` : ''}</div>
            <div class="text-[16px] text-slate-700 font-medium mt-2">${escapeHtml(s.last.topic || 'No topic')}</div>
            <div class="flex flex-wrap gap-1.5 mt-3">${cats}</div>
        </button>`;
    }).join('');
}

// 상세 패널은 검색·카테고리와 관계없이 해당 학생의 전체 상담 이력을 카테고리별로 보여줌
function renderStudentDetail(all) {
    const panel = document.getElementById('student-detail');
    const student = selectedStudentKey && groupByStudent(all.filter(r => studentKey(r) === selectedStudentKey))[0];
    if (!student) {
        panel.innerHTML = '<p class="text-[17px] text-slate-500 font-medium">Select a student to see their consultation records here.</p>';
        return;
    }

    const sessions = student.sessions;
    const counselors = [...new Set(sessions.map(s => s.counselor).filter(Boolean))];
    const ratings = sessions.map(s => toRating(s.rating)).filter(n => n !== null);
    const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null;
    const initials = student.name.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
    const stat = (label, value) => `
        <div class="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
            <span class="block text-[13px] font-bold text-slate-500">${label}</span>
            <span class="block text-[18px] font-black text-slate-900 mt-0.5">${value}</span>
        </div>`;

    panel.innerHTML = `
        <div class="flex justify-between items-start gap-3">
            <div class="flex items-center gap-4 min-w-0">
                <div class="w-14 h-14 shrink-0 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center text-[18px] font-black">${escapeHtml(initials)}</div>
                <div class="min-w-0 space-y-1">
                    <h3 class="text-[24px] font-black text-slate-900 leading-tight truncate">${escapeHtml(student.name)}</h3>
                    <div>${umailBadgeHtml(student.umail)}</div>
                    ${student.aliases.length ? `<p class="text-[14px] text-amber-700 font-bold">Also recorded as: ${escapeHtml(student.aliases.join(', '))}</p>` : ''}
                </div>
            </div>
            <button onclick="selectStudent(null)" class="shrink-0 w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-[16px]" title="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>

        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
            ${stat('Sessions', sessions.length)}
            ${stat('First Session', escapeHtml(formatDate(sessions[sessions.length - 1].sessionDate)))}
            ${stat('Latest Session', escapeHtml(formatDate(student.last.sessionDate)))}
            ${stat('Avg Rating', avg ? `${avg} / 5` : '-')}
        </div>
        ${counselors.length ? `<p class="text-[15px] text-slate-600 font-medium mt-4"><i class="fa-solid fa-user-tie mr-2 text-slate-400"></i>Counselor${counselors.length > 1 ? 's' : ''}: <b class="text-slate-800">${escapeHtml(counselors.join(', '))}</b></p>` : ''}

        <div class="mt-6 space-y-6">
            ${groupByCategory(sessions).map(g => `
                <div>
                    <div class="flex items-center gap-2 mb-3">
                        ${categoryChipHtml(g.cat)}
                        <span class="text-[14px] font-bold text-slate-500">${g.sessions.length} session${g.sessions.length === 1 ? '' : 's'}</span>
                    </div>
                    <div class="space-y-3">${g.sessions.map(sessionCardHtml).join('')}</div>
                </div>`).join('')}
        </div>`;
}

function sessionCardHtml(s) {
    const extras = Object.entries(s).filter(([k, v]) => !CONSULT_FIELDS.includes(k) && v !== '' && v !== null && v !== undefined);
    return `
        <div class="bg-white border border-slate-200 rounded-2xl p-4 md:p-5 space-y-2">
            <div class="flex flex-wrap justify-between items-center gap-2">
                <span class="text-[15px] font-black text-slate-900"><i class="fa-regular fa-calendar mr-2 text-slate-400"></i>${escapeHtml(formatDate(s.sessionDate))}</span>
                ${starsHtml(s.rating)}
            </div>
            <div class="text-[18px] font-black text-slate-800 leading-snug">${escapeHtml(s.topic || 'No topic')}</div>
            ${s.counselor ? `<div class="text-[15px] font-semibold text-slate-500"><i class="fa-solid fa-user-tie mr-2 text-slate-400"></i>${escapeHtml(s.counselor)}</div>` : ''}
            ${s.review ? `<p class="text-[16px] text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">${escapeHtml(s.review)}</p>` : ''}
            ${extras.map(([k, v]) => `<div class="text-[15px]"><span class="font-bold text-slate-500">${escapeHtml(k)}:</span> <span class="text-slate-800">${escapeHtml(v)}</span></div>`).join('')}
        </div>`;
}

function selectCategory(encodedId) {
    activeCategory = decodeURIComponent(encodedId);
    renderConsultationPage();
}

// 선택한 학생은 주소(#student=...)에 남겨 새로고침·링크 공유 시에도 유지
function selectStudent(encodedKey) {
    selectedStudentKey = encodedKey ? decodeURIComponent(encodedKey) : null;
    history.replaceState(null, '', selectedStudentKey ? `#student=${encodeURIComponent(selectedStudentKey)}` : location.pathname);
    renderConsultationPage();
    if (selectedStudentKey) document.getElementById('student-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showConsultToast(message) {
    const toast = document.getElementById('consult-toast');
    toast.innerHTML = `<i class="fa-solid fa-circle-check mr-2 text-emerald-600"></i>${escapeHtml(message)}`;
    toast.classList.remove('hidden');
    clearTimeout(showConsultToast.timer);
    showConsultToast.timer = setTimeout(() => toast.classList.add('hidden'), 5000);
}

// Upload File: 현재 상담 기록을 파일 내용으로 교체 (기존 기록이 있으면 확인)
function handleConsultUpload(evt) {
    const file = evt.target.files[0];
    evt.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
        const rows = normalizeConsultationData(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]));
        if (!rows.length) { alert('No consultation records were found in this file.'); return; }
        const current = window.dbState.consultationData.length;
        if (current && !confirm(`Replace the ${current} current records with ${rows.length} records from "${file.name}"?`)) return;
        window.dbState.consultationData = rows;
        window.saveStateToStorage();
        selectedStudentKey = null;
        activeCategory = 'all';
        renderConsultationPage();
        const missing = rows.filter(r => !r.umail).length;
        showConsultToast(`Loaded ${rows.length} records from "${file.name}".${missing ? ` ${missing} record(s) have no uMail.` : ''}`);
    };
    reader.readAsArrayBuffer(file);
}

function openConsultRecordForm() {
    window.dbState.activeExcelSheet = 'Consultation';
    addNewRowModal();
}

function exportConsultationsCsv() {
    const rows = getConsultationRecords().sort(byDateDesc).map(r => {
        const out = {};
        CONSULT_FIELDS.forEach(f => { out[CONSULT_FIELD_LABELS[f]] = f === 'category' ? getConsultCategory(r).label : r[f]; });
        Object.keys(r).filter(k => !CONSULT_FIELDS.includes(k)).forEach(k => { out[k] = r[k]; });
        return out;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Consultation');
    XLSX.writeFile(wb, `CIDC_Consultation_Records_${toIsoDate(new Date())}.csv`);
}

window.addEventListener('DOMContentLoaded', () => {
    const match = /#student=(.+)$/.exec(location.hash);
    if (match) selectedStudentKey = decodeURIComponent(match[1]);
    renderConsultationPage();
});

// 컨설턴트 전용 Consultation Records 페이지: 학생별·카테고리별 상담 이력
// 데이터는 Excel List > Consultation Sheet (window.dbState.consultationData) 그대로 사용
let selectedStudentKey = null;
let activeCategory = 'all';
// Session History 편집 상태: 수정 중인 기록의 _idx, 새 기록 추가 중이면 'new', 아니면 null
let editingSessionIdx = null;

const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 학생 구분: uMail이 있으면 uMail로 묶고, uMail이 없는 기록은 이름이 같아도 같은 사람인지 알 수 없으므로 따로 표시
const studentKey = rec => (rec.umail ? `umail:${rec.umail}` : `row:${rec._idx ?? 'new'}`);
// 이름 비교용: 대소문자·여러 칸 공백 무시
const nameKey = name => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
// 같은 이름이 두 개 이상의 목록 항목에 쓰인 경우 -> 'Duplicate' 표시
let duplicateNames = new Set();
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
    if (!umail) return '<span class="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-lg text-[13px] font-bold"><i class="fa-solid fa-triangle-exclamation"></i> No uMail</span>';
    const warn = isValidUmail(umail) ? '' : ' <span class="bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-lg text-[12px] font-bold" title="Expected format: u1234567@umail.utah.edu">Check format</span>';
    return `<span class="text-[14px] font-semibold text-blue-700"><i class="fa-regular fa-envelope mr-1.5 text-blue-400"></i>${escapeHtml(umail)}</span>${warn}`;
}

function duplicateBadgeHtml(name) {
    return duplicateNames.has(nameKey(name))
        ? ' <span class="inline-flex items-center gap-1 align-middle bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-lg text-[13px] font-black" title="Another student entry has the same name"><i class="fa-solid fa-clone"></i> Duplicate</span>'
        : '';
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
    }).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || byDateDesc(a.last, b.last)); // 이름순
}

function findDuplicateNames(students) {
    const counts = new Map();
    students.forEach(s => { const k = nameKey(s.name); if (k) counts.set(k, (counts.get(k) || 0) + 1); });
    return new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
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

    duplicateNames = findDuplicateNames(groupByStudent(all));
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
    // 편집 중에는 검색 입력 등으로 상세 패널이 다시 그려져 입력 내용이 사라지지 않도록 유지
    if (editingSessionIdx === null) renderStudentDetail(all);
}

function renderSummary(all) {
    // uMail이 있으면 uMail 수, 없으면 이름 수로 셈
    const students = new Set(all.map(r => (r.umail ? 'u:' + r.umail : 'n:' + nameKey(r.student))).filter(k => k !== 'n:'));
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
    const dupCount = students.filter(s => duplicateNames.has(nameKey(s.name))).length;
    document.getElementById('list-caption').innerText = ['Sorted by name', categoryLabel, dupCount ? `${dupCount} with duplicate names` : ''].filter(Boolean).join(' · ');
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
                    <div class="text-[22px] font-black text-slate-900 leading-tight">${escapeHtml(s.name)}${duplicateBadgeHtml(s.name)}</div>
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
                    <h3 class="text-[24px] font-black text-slate-900 leading-tight">${escapeHtml(student.name)}${duplicateBadgeHtml(student.name)}</h3>
                    <div>${umailBadgeHtml(student.umail)}</div>
                    ${student.aliases.length ? `<p class="text-[14px] text-amber-700 font-bold">Also recorded as: ${escapeHtml(student.aliases.join(', '))}</p>` : ''}
                </div>
            </div>
            <div class="shrink-0 flex items-center gap-2">
                <button onclick="startNewSession()" class="consult-btn bg-emerald-600 hover:bg-emerald-500 text-white !text-[14px] !px-4 !py-2.5"><i class="fa-solid fa-plus"></i> Add Session</button>
                <button onclick="selectStudent(null)" class="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-[16px]" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>

        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
            ${stat('Sessions', sessions.length)}
            ${stat('First Session', escapeHtml(formatDate(sessions[sessions.length - 1].sessionDate)))}
            ${stat('Latest Session', escapeHtml(formatDate(student.last.sessionDate)))}
            ${stat('Avg Rating', avg ? `${avg} / 5` : '-')}
        </div>
        ${counselors.length ? `<p class="text-[15px] text-slate-600 font-medium mt-4"><i class="fa-solid fa-user-tie mr-2 text-slate-400"></i>Counselor${counselors.length > 1 ? 's' : ''}: <b class="text-slate-800">${escapeHtml(counselors.join(', '))}</b></p>` : ''}

        <div class="mt-6 space-y-6">
            ${editingSessionIdx === 'new' ? `<div><h4 class="text-[15px] font-black text-emerald-700 mb-3"><i class="fa-solid fa-plus-circle mr-2"></i>New Session</h4>${sessionFormHtml({ student: student.name, umail: student.umail, sessionDate: toIsoDate(new Date()), counselor: student.last.counselor }, true)}</div>` : ''}
            ${groupByCategory(sessions).map(g => `
                <div>
                    <div class="flex items-center gap-2 mb-3">
                        ${categoryChipHtml(g.cat)}
                        <span class="text-[14px] font-bold text-slate-500">${g.sessions.length} session${g.sessions.length === 1 ? '' : 's'}</span>
                    </div>
                    <div class="space-y-3">${g.sessions.map(x => x._idx === editingSessionIdx ? sessionFormHtml(x, false) : sessionCardHtml(x)).join('')}</div>
                </div>`).join('')}
        </div>`;
}

function sessionCardHtml(s) {
    const extras = Object.entries(s).filter(([k, v]) => !CONSULT_FIELDS.includes(k) && v !== '' && v !== null && v !== undefined);
    return `
        <div class="bg-white border border-slate-200 rounded-2xl p-4 md:p-5 space-y-2">
            <div class="flex flex-wrap justify-between items-center gap-2">
                <span class="text-[15px] font-black text-slate-900"><i class="fa-regular fa-calendar mr-2 text-slate-400"></i>${escapeHtml(formatDate(s.sessionDate))}</span>
                <div class="flex items-center gap-3">
                    ${starsHtml(s.rating)}
                    <button onclick="startEditSession(${s._idx})" class="session-action text-blue-600 hover:bg-blue-50" title="Edit this session"><i class="fa-solid fa-pen"></i> Edit</button>
                    <button onclick="deleteSession(${s._idx})" class="session-action text-rose-600 hover:bg-rose-50" title="Delete this session"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </div>
            <div class="text-[18px] font-black text-slate-800 leading-snug">${escapeHtml(s.topic || 'No topic')}</div>
            ${s.counselor ? `<div class="text-[15px] font-semibold text-slate-500"><i class="fa-solid fa-user-tie mr-2 text-slate-400"></i>${escapeHtml(s.counselor)}</div>` : ''}
            ${s.review ? `<p class="text-[16px] text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">${escapeHtml(s.review)}</p>` : ''}
            ${extras.map(([k, v]) => `<div class="text-[15px]"><span class="font-bold text-slate-500">${escapeHtml(k)}:</span> <span class="text-slate-800">${escapeHtml(v)}</span></div>`).join('')}
        </div>`;
}

// Session History 편집 폼 (수정 / 새 기록 공용). 엑셀에만 있던 추가 열도 함께 수정 가능
function sessionFormHtml(s, isNew) {
    const field = (label, control, wide = false) => `
        <label class="${wide ? 'md:col-span-2' : ''} block">
            <span class="block text-[14px] font-bold text-slate-600 mb-1.5">${label}</span>
            ${control}
        </label>`;
    const input = (name, value, attrs = '') => `<input name="${name}" value="${escapeHtml(value ?? '')}" ${attrs} class="session-input">`;
    const category = String(s.category || '').trim();
    const categoryOptions = [`<option value="">Auto (from topic)</option>`]
        .concat(CONSULT_CATEGORIES.map(c => `<option value="${escapeHtml(c.label)}" ${category.toLowerCase() === c.label.toLowerCase() ? 'selected' : ''}>${escapeHtml(c.label)}</option>`))
        .concat(category && !CONSULT_CATEGORIES.some(c => c.label.toLowerCase() === category.toLowerCase()) ? [`<option value="${escapeHtml(category)}" selected>${escapeHtml(category)}</option>`] : []);
    const rating = toRating(s.rating);
    const ratingOptions = [`<option value="">No rating</option>`]
        .concat([5, 4, 3, 2, 1].map(n => `<option value="${n}" ${rating !== null && Math.round(rating) === n ? 'selected' : ''}>${'★'.repeat(n)} (${n})</option>`));
    const extras = Object.keys(s).filter(k => !CONSULT_FIELDS.includes(k));

    return `
        <form onsubmit="saveSession(event)" class="bg-blue-50/40 border-2 border-blue-300 rounded-2xl p-4 md:p-5 space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                ${field('Student Name', input('student', s.student, 'required'))}
                ${field('uMail', input('umail', s.umail, 'type="email" required pattern="[uU][0-9]{7}@umail\\.utah\\.edu" placeholder="u1234567@umail.utah.edu" title="Format: u1234567@umail.utah.edu"'))}
                ${field('Session Date', input('sessionDate', s.sessionDate, 'type="date" required'))}
                ${field('Counselor', input('counselor', s.counselor))}
                ${field('Category', `<select name="category" class="session-input">${categoryOptions.join('')}</select>`)}
                ${field('Rating', `<select name="rating" class="session-input">${ratingOptions.join('')}</select>`)}
                ${field('Topic', input('topic', s.topic), true)}
                ${field('Notes / Review', `<textarea name="review" rows="4" class="session-input">${escapeHtml(s.review || '')}</textarea>`, true)}
                ${extras.map(k => field(escapeHtml(k), input(`extra:${k}`, s[k]), true)).join('')}
            </div>
            <div class="flex flex-wrap justify-end gap-2 pt-1">
                <button type="button" onclick="cancelEditSession()" class="consult-btn bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 !text-[15px]">Cancel</button>
                <button type="submit" class="consult-btn bg-blue-600 hover:bg-blue-500 text-white !text-[15px]"><i class="fa-solid fa-check"></i> ${isNew ? 'Add Session' : 'Save Changes'}</button>
            </div>
        </form>`;
}

function startEditSession(idx) {
    editingSessionIdx = idx;
    renderStudentDetail(getConsultationRecords());
    document.querySelector('#student-detail form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function startNewSession() {
    editingSessionIdx = 'new';
    renderStudentDetail(getConsultationRecords());
    document.querySelector('#student-detail form input[name="sessionDate"]')?.focus();
}

function cancelEditSession() {
    editingSessionIdx = null;
    renderConsultationPage();
}

function saveSession(evt) {
    evt.preventDefault();
    const raw = {};
    new FormData(evt.target).forEach((value, key) => {
        raw[key.startsWith('extra:') ? key.slice(6) : key] = typeof value === 'string' ? value.trim() : value;
    });
    const record = normalizeStoredRecord(raw);
    const isNew = editingSessionIdx === 'new';
    if (isNew) window.dbState.consultationData.unshift(record);
    else window.dbState.consultationData[editingSessionIdx] = record;
    window.saveStateToStorage();

    // uMail·이름을 고친 경우 학생 키가 바뀌므로 수정된 학생으로 다시 선택 (uMail이 없으면 그 행)
    const savedIdx = isNew ? 0 : editingSessionIdx;
    editingSessionIdx = null;
    selectedStudentKey = record.umail ? `umail:${record.umail}` : `row:${savedIdx}`;
    history.replaceState(null, '', `#student=${encodeURIComponent(selectedStudentKey)}`);
    renderConsultationPage();
    showConsultToast(isNew ? `Added a session for ${record.student}.` : `Saved changes to the ${formatDate(record.sessionDate)} session.`);
}

function deleteSession(idx) {
    const rec = getConsultationRecords().find(r => r._idx === idx);
    if (!rec) return;
    if (!confirm(`Delete the ${formatDate(rec.sessionDate)} session "${rec.topic || 'No topic'}" for ${rec.student || rec.umail}? This cannot be undone.`)) return;
    window.dbState.consultationData.splice(idx, 1);
    window.saveStateToStorage();
    editingSessionIdx = null;
    // 이 학생의 마지막 기록이었거나, 행 번호로 구분하던 항목(uMail 없음)이면 번호가 밀리므로 상세 패널을 닫음
    if (String(selectedStudentKey).startsWith('row:') || !getConsultationRecords().some(r => studentKey(r) === selectedStudentKey)) selectStudent(null);
    else renderConsultationPage();
    showConsultToast('Session deleted.');
}

function selectCategory(encodedId) {
    activeCategory = decodeURIComponent(encodedId);
    renderConsultationPage();
}

// 선택한 학생은 주소(#student=...)에 남겨 새로고침·링크 공유 시에도 유지
function selectStudent(encodedKey) {
    selectedStudentKey = encodedKey ? decodeURIComponent(encodedKey) : null;
    editingSessionIdx = null;
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

// ---------------------------------------------------------------------
// 열 매칭 화면 (Upload File / Fix Columns 공용)
// 어느 열이 이름·uMail·날짜인지 자동으로 고른 뒤, 표본 값과 미리보기를 보여주고 직접 바꿀 수 있게 함
// ---------------------------------------------------------------------
let mapper = null; // { mode: 'import' | 'fix', title, rawRows, headers, labels, fieldMap }

const MAPPER_FIELDS = [
    ['student', 'Student Name', true], ['umail', 'uMail', true], ['sessionDate', 'Session Date', false],
    ['counselor', 'Counselor', false], ['category', 'Category', false], ['topic', 'Topic', false],
    ['rating', 'Rating', false], ['review', 'Notes / Review', false]
];

function handleConsultUpload(evt) {
    const file = evt.target.files[0];
    evt.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        let parsed;
        try {
            parsed = parseConsultationWorkbook(XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true }));
        } catch (err) {
            showImportModal(`Couldn't read "${file.name}"`, '<p>This file couldn\'t be opened as a spreadsheet. Please upload an <b>.xlsx</b>, <b>.xls</b> or <b>.csv</b> file.</p>',
                [{ label: 'OK', style: 'bg-blue-600 text-white', action: 'closeImportModal()' }]);
            return;
        }
        if (!parsed.headers.length || !parsed.rawRows.length) {
            showImportModal(`No data found in "${file.name}"`, '<p>The file looks empty. Please check that the sheet has a header row and at least one record.</p>',
                [{ label: 'OK', style: 'bg-blue-600 text-white', action: 'closeImportModal()' }]);
            return;
        }
        openColumnMapper({ mode: 'import', title: `Import "${file.name}"`, rawRows: parsed.rawRows, headers: parsed.headers, labels: {}, fieldMap: parsed.fieldMap });
    };
    reader.readAsArrayBuffer(file);
}

// 이미 불러온 기록의 열을 다시 맞추기 (다시 업로드할 필요 없음)
function openFixColumns() {
    const rawRows = window.dbState.consultationData.map(r => ({ ...r }));
    if (!rawRows.length) { showConsultToast('There are no records to fix yet.'); return; }
    const headers = [...new Set(rawRows.flatMap(r => Object.keys(r)))];
    const labels = {};
    headers.forEach(h => { if (CONSULT_FIELDS.includes(h)) labels[h] = `${CONSULT_FIELD_LABELS[h]} (current)`; });
    openColumnMapper({ mode: 'fix', title: `Fix columns for ${rawRows.length} records`, rawRows, headers, labels, fieldMap: autoMapColumns(headers, rawRows) });
}

function openColumnMapper(state) {
    mapper = state;
    renderColumnMapper();
    document.getElementById('import-modal').classList.replace('hidden', 'flex');
}

function setMapperField(field, header) {
    if (!mapper) return;
    // 한 열은 한 필드에만: 다른 필드가 같은 열을 쓰고 있으면 비움
    if (header) Object.keys(mapper.fieldMap).forEach(f => { if (mapper.fieldMap[f] === header) mapper.fieldMap[f] = null; });
    mapper.fieldMap[field] = header || null;
    renderColumnMapper();
}

function renderColumnMapper() {
    const m = mapper;
    const rows = applyColumnMap(m.rawRows, m.fieldMap);
    const label = h => m.labels[h] || h;
    // 이름(또는 First+Last Name)이나 uMail이 한 건이라도 읽히면 진행 가능
    const hasKey = rows.some(r => r.student || r.umail);

    const selects = MAPPER_FIELDS.map(([field, title, important]) => {
        const chosen = m.fieldMap[field];
        const samples = chosen ? profileColumn(m.rawRows.map(r => r[chosen])).samples : [];
        return `
            <label class="block bg-white border ${important && !chosen ? 'border-amber-300' : 'border-slate-200'} rounded-2xl p-3">
                <span class="block text-[14px] font-black text-slate-800 mb-1.5">${title}${important ? ' <span class="text-rose-600">*</span>' : ''}</span>
                <select onchange="setMapperField('${field}', this.value)" class="session-input !text-[15px]">
                    <option value="">— Not in this file —</option>
                    ${m.headers.map(h => `<option value="${escapeHtml(h)}" ${chosen === h ? 'selected' : ''}>${escapeHtml(label(h))}</option>`).join('')}
                </select>
                <span class="block text-[13px] text-slate-500 mt-1.5 truncate">${samples.length ? 'e.g. ' + samples.map(v => `“${escapeHtml(String(v).slice(0, 40))}”`).join(', ') : '&nbsp;'}</span>
            </label>`;
    }).join('');

    // 미리보기와 확인 수치
    const noUmail = rows.filter(r => !r.umail).length;
    const noDate = rows.filter(r => !/^\d{4}-\d{2}-\d{2}$/.test(r.sessionDate)).length;
    const previewRows = rows.slice(0, 6).map(r => `
        <tr class="border-t border-slate-200">
            <td class="p-2 font-bold text-slate-900">${escapeHtml(r.student || '—')}</td>
            <td class="p-2 ${r.umail ? 'text-blue-700' : 'text-amber-700 font-bold'}">${escapeHtml(r.umail || 'No uMail')}</td>
            <td class="p-2 whitespace-nowrap">${escapeHtml(r.sessionDate ? formatDate(r.sessionDate) : 'No date')}</td>
            <td class="p-2">${escapeHtml(r.counselor || '')}</td>
            <td class="p-2">${escapeHtml(getConsultCategory(r).label)}</td>
            <td class="p-2 max-w-[220px] truncate text-slate-500">${escapeHtml(r.topic || r.review || '')}</td>
        </tr>`).join('');

    let summary;
    if (m.mode === 'import') {
        const { added, updated } = mergeConsultationRecords(window.dbState.consultationData, rows);
        summary = `<b>${rows.length}</b> records read · <b class="text-emerald-700">${added} new</b> · <b class="text-blue-700">${updated} already here</b> (updated, not duplicated)`;
    } else {
        summary = `<b>${rows.length}</b> records will be rebuilt with these columns. Nothing is deleted — columns you don't pick are kept as extra details.`;
    }
    const warns = [
        noUmail ? `${noUmail} without uMail (shown as “No uMail”)` : '',
        noDate ? `${noDate} without a readable date` : ''
    ].filter(Boolean).join(' · ');

    document.getElementById('import-title').innerText = m.title;
    document.getElementById('import-body').innerHTML = `
        <p class="text-[15px]">Check that each box points to the right column. The examples under each box show what's in that column.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${selects}</div>
        ${hasKey ? '' : '<p class="bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl px-4 py-3 font-bold">Pick the Student Name or uMail column to continue.</p>'}
        <div class="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-2">
            <p class="text-[15px]">${summary}</p>
            ${warns ? `<p class="text-[14px] font-semibold text-amber-700"><i class="fa-solid fa-triangle-exclamation mr-1"></i>${warns}</p>` : ''}
            <div class="overflow-x-auto"><table class="w-full text-left text-[13px]">
                <thead class="text-slate-500 font-black"><tr><th class="p-2">Name</th><th class="p-2">uMail</th><th class="p-2">Date</th><th class="p-2">Counselor</th><th class="p-2">Category</th><th class="p-2">Topic / Notes</th></tr></thead>
                <tbody>${previewRows}</tbody>
            </table></div>
            <p class="text-[13px] text-slate-400">Preview of the first ${Math.min(6, rows.length)} records</p>
        </div>`;

    const current = window.dbState.consultationData.length;
    const actions = [{ label: 'Cancel', style: 'bg-white text-slate-700 border border-slate-300', action: 'closeImportModal()' }];
    if (hasKey && m.mode === 'import') {
        if (current) actions.push({ label: 'Replace all', style: 'bg-white text-rose-700 border border-rose-300', action: "applyColumnMapper('replace')" });
        actions.push({ label: current ? 'Add to existing' : 'Import', style: 'bg-blue-600 text-white', action: "applyColumnMapper('merge')" });
    }
    if (hasKey && m.mode === 'fix') actions.push({ label: `Apply to ${rows.length} records`, style: 'bg-blue-600 text-white', action: "applyColumnMapper('fix')" });
    document.getElementById('import-actions').innerHTML = actions
        .map(a => `<button onclick="${a.action}" class="consult-btn !text-[15px] ${a.style}">${escapeHtml(a.label)}</button>`).join('');
}

function applyColumnMapper(mode) {
    if (!mapper) return;
    const rows = applyColumnMap(mapper.rawRows, mapper.fieldMap);
    const current = window.dbState.consultationData.length;
    let message;
    if (mode === 'replace') {
        if (!confirm(`Delete all ${current} current records and keep only the ${rows.length} from this file?`)) return;
        window.dbState.consultationData = mergeConsultationRecords([], rows).records;
        message = `Replaced all records with ${window.dbState.consultationData.length} from the file.`;
    } else if (mode === 'fix') {
        window.dbState.consultationData = rows;
        message = `Updated ${rows.length} records with the new columns.`;
    } else {
        const result = mergeConsultationRecords(window.dbState.consultationData, rows);
        window.dbState.consultationData = result.records;
        message = `Added ${result.added} new session(s)${result.updated ? ` and updated ${result.updated} existing` : ''}.`;
    }
    window.saveStateToStorage();
    closeImportModal();
    selectedStudentKey = null;
    editingSessionIdx = null;
    activeCategory = 'all';
    history.replaceState(null, '', location.pathname);
    renderConsultationPage();
    showConsultToast(message);
}

function showImportModal(title, bodyHtml, actions) {
    document.getElementById('import-title').innerText = title;
    document.getElementById('import-body').innerHTML = bodyHtml;
    document.getElementById('import-actions').innerHTML = actions
        .map(a => `<button onclick="${a.action}" class="consult-btn !text-[15px] ${a.style}">${escapeHtml(a.label)}</button>`).join('');
    document.getElementById('import-modal').classList.replace('hidden', 'flex');
}

function closeImportModal() {
    mapper = null;
    document.getElementById('import-modal').classList.replace('flex', 'hidden');
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

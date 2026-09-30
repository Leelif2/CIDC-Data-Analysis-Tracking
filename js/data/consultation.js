// 상담 기록(Consultation 시트) 표준 형식 & 집계
// 한 행 = 상담 1건: { sessionDate, student, umail, counselor, category, topic, rating, review }
// 학생 구분은 uMail 기준 (동명이인 대비). uMail이 없는 기록만 이름으로 묶음
const CONSULT_FIELDS = ['sessionDate', 'student', 'umail', 'counselor', 'category', 'topic', 'rating', 'review'];

const CONSULT_FIELD_LABELS = {
    sessionDate: 'Session Date',
    student: 'Student',
    umail: 'uMail',
    counselor: 'Counselor',
    category: 'Category',
    topic: 'Topic',
    rating: 'Rating (1–5)',
    review: 'Review'
};

// 상담 카테고리: Category 열이 있으면 그 값을, 없으면 Topic 키워드로 자동 분류 (위에서부터 먼저 맞는 것)
const CONSULT_CATEGORIES = [
    { id: 'visa', label: 'OPT / Visa', icon: 'fa-passport', pattern: /\b(opt|cpt|visa|f-?1|ead|i-20|sevis|immigration|work authori[sz]ation)\b/i,
      chip: 'bg-teal-50 text-teal-700 border-teal-200', active: 'bg-teal-600 text-white border-teal-600' },
    { id: 'interview', label: 'Interview Prep', icon: 'fa-user-tie', pattern: /\b(interview|mock|tech screen)/i,
      chip: 'bg-violet-50 text-violet-700 border-violet-200', active: 'bg-violet-600 text-white border-violet-600' },
    { id: 'resume', label: 'Resume & Cover Letter', icon: 'fa-file-lines', pattern: /\b(resume|résumé|cv|cover letter|portfolio)/i,
      chip: 'bg-blue-50 text-blue-700 border-blue-200', active: 'bg-blue-600 text-white border-blue-600' },
    { id: 'job', label: 'Job Search & Networking', icon: 'fa-briefcase', pattern: /\b(job|internship|network|linkedin|career fair|application|offer|recruit|employer)/i,
      chip: 'bg-amber-50 text-amber-700 border-amber-200', active: 'bg-amber-500 text-white border-amber-500' },
    { id: 'career', label: 'Career Planning', icon: 'fa-compass', pattern: /\b(career|plan|major|graduate|goal|path)/i,
      chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', active: 'bg-emerald-600 text-white border-emerald-600' },
    { id: 'other', label: 'Other', icon: 'fa-comments', pattern: null,
      chip: 'bg-slate-100 text-slate-700 border-slate-200', active: 'bg-slate-700 text-white border-slate-700' }
];

function getConsultCategory(rec) {
    const given = String(rec.category || '').trim();
    if (given) {
        const lower = given.toLowerCase();
        const known = CONSULT_CATEGORIES.find(c => c.id === lower || c.label.toLowerCase() === lower)
            || CONSULT_CATEGORIES.find(c => c.pattern && c.pattern.test(given));
        if (known) return known;
        // 목록에 없는 카테고리는 적힌 이름 그대로 새 카테고리로
        return { ...CONSULT_CATEGORIES[CONSULT_CATEGORIES.length - 1], id: `custom:${lower}`, label: given };
    }
    return CONSULT_CATEGORIES.find(c => c.pattern && c.pattern.test(rec.topic || '')) || CONSULT_CATEGORIES[CONSULT_CATEGORIES.length - 1];
}

// 엑셀 헤더(대소문자·공백·기호 무시) -> 표준 필드명
// 1) 정확히 일치하는 이름을 먼저 찾고, 2) 없으면 키워드 포함 여부로 추정 (예: 'Date of Consultation', Google Form 'Timestamp')
// 한글 헤더(상담일, 이름 등)로 된 기존 엑셀도 읽을 수 있게 함께 인식
const CONSULT_HEADER_ALIASES = {
    sessionDate: ['sessiondate', 'date', 'consultationdate', 'timestamp', '상담일', '상담일자', '날짜', '일자'],
    student: ['student', 'studentname', 'name', 'fullname', '학생', '학생명', '이름', '성명'],
    umail: ['umail', 'uemail', 'email', 'studentemail', 'studentumail', 'emailaddress', 'unid', 'uid', '이메일'],
    counselor: ['counselor', 'counsellor', 'advisor', 'consultant', 'staff', '상담사', '상담자', '담당자'],
    category: ['category', 'type', 'consultationtype', 'sessiontype', '카테고리', '분류', '유형'],
    topic: ['topic', 'subject', 'purpose', 'reason', '주제', '상담주제', '목적'],
    rating: ['rating', 'score', 'satisfaction', 'stars', '만족도', '평점', '별점'],
    review: ['review', 'feedback', 'comment', 'comments', 'notes', 'note', 'memo', '후기', '메모', '의견', '상담내용', '내용']
};
// 키워드 추정 순서가 중요: 'Counselor Name'은 student가 아니라 counselor, 'Student Email'은 umail
const CONSULT_HEADER_KEYWORDS = [
    ['umail', /umail|e-?mail|unid|이메일/],
    ['counselor', /counsel|advis|consultant|상담사|상담자|담당/],
    ['sessionDate', /date|timestamp|when|날짜|일자|상담일/],
    ['category', /category|type|카테고리|분류|유형/],
    ['rating', /rating|score|satisf|star|만족|평점|별점/],
    ['topic', /topic|subject|purpose|reason|주제|목적/],
    ['review', /review|feedback|comment|note|memo|summary|후기|메모|의견|내용/],
    ['student', /student|name|학생|이름|성명/]
];

const normalizeHeader = h => String(h).toLowerCase().replace(/[\s_\-().:#/]/g, '');
const CONSULT_HEADER_LOOKUP = {};
Object.entries(CONSULT_HEADER_ALIASES).forEach(([field, aliases]) => {
    aliases.forEach(a => { CONSULT_HEADER_LOOKUP[normalizeHeader(a)] = field; });
});

// 헤더 목록 -> { 원래 헤더: 표준 필드 } (필드마다 첫 번째로 맞는 열 하나만 사용, 나머지 열은 그대로 보존)
function mapConsultHeaders(headers) {
    const mapping = {};
    const used = new Set();
    const assign = (h, field) => { if (field && !used.has(field) && !(h in mapping)) { mapping[h] = field; used.add(field); } };
    headers.forEach(h => assign(h, CONSULT_HEADER_LOOKUP[normalizeHeader(h)]));
    headers.forEach(h => {
        if (h in mapping) return;
        const n = normalizeHeader(h);
        if (/^first ?name$|^given ?name$/.test(String(h).toLowerCase().trim()) || /^(last|family) ?name$|^surname$/.test(String(h).toLowerCase().trim())) return; // 아래에서 합침
        const hit = CONSULT_HEADER_KEYWORDS.find(([field, re]) => !used.has(field) && re.test(n));
        if (hit) assign(h, hit[0]);
    });
    return mapping;
}

// 엑셀 날짜(Date 객체, 일련번호, '2026.03.15', '2026/3/5' 등) -> 'YYYY-MM-DD'
function toIsoDate(value) {
    if (value === undefined || value === null || value === '') return '';
    let d = null;
    if (value instanceof Date) d = value;
    else if (typeof value === 'number' && value > 20000 && value < 80000) d = new Date(Math.round((value - 25569) * 86400000));
    else {
        // 2026-09-08, 2026.9.8, 2026/9/8, 2026. 9. 8., 2026년 9월 8일
        const m = /^(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/.exec(String(value).trim());
        if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
        const parsed = new Date(value);
        if (!isNaN(parsed)) d = parsed;
    }
    if (!d || isNaN(d)) return String(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// '5', '4.5', '4/5', '★★★★' -> 숫자 (1~5 밖이면 null)
function toRating(value) {
    if (value === undefined || value === null || value === '') return null;
    const stars = (String(value).match(/★/g) || []).length;
    const n = stars || parseFloat(String(value).replace(',', '.'));
    return n >= 1 && n <= 5 ? n : null;
}

function normalizeConsultationRecord(raw, mapping = mapConsultHeaders(Object.keys(raw))) {
    const rec = {};
    let firstName = '', lastName = '';
    Object.entries(raw).forEach(([key, value]) => {
        const clean = typeof value === 'string' ? value.trim() : value;
        const lower = String(key).toLowerCase().trim();
        if (!mapping[key] && /^first ?name$|^given ?name$/.test(lower)) { firstName = clean; return; }
        if (!mapping[key] && /^(last|family) ?name$|^surname$/.test(lower)) { lastName = clean; return; }
        rec[mapping[key] || key] = clean;
    });
    if (!rec.student && (firstName || lastName)) rec.student = `${firstName || ''} ${lastName || ''}`.trim();
    rec.sessionDate = toIsoDate(rec.sessionDate);
    rec.umail = String(rec.umail ?? '').trim().toLowerCase();
    if (/^u\d{7}$/.test(rec.umail)) rec.umail += '@umail.utah.edu'; // uNID만 적힌 경우
    const rating = toRating(rec.rating);
    rec.rating = rating === null ? '' : rating;
    CONSULT_FIELDS.forEach(f => { if (rec[f] === undefined) rec[f] = ''; });
    return rec;
}

// uMail 형식: u + 7자리 숫자 @umail.utah.edu (예: u1234567@umail.utah.edu)
const UMAIL_PATTERN = /^u\d{7}@umail\.utah\.edu$/;
const isValidUmail = v => UMAIL_PATTERN.test(String(v || '').trim().toLowerCase());

// 같은 학생 판별 키: uMail 우선, 없으면 이름
function consultStudentKey(rec) {
    if (rec.umail) return `umail:${rec.umail}`;
    const name = String(rec.student || '').trim().toLowerCase();
    return name ? `name:${name}` : '';
}

function normalizeConsultationData(rows) {
    return rows.map(r => normalizeConsultationRecord(r)).filter(r => r.sessionDate || r.student || r.umail || r.review);
}

// 엑셀 파일 읽기: 모든 시트의 위쪽 15줄에서 '진짜 헤더 줄'을 찾아 가장 잘 맞는 시트를 사용
// (맨 위에 제목 줄이 있거나 데이터가 두 번째 시트에 있어도 읽을 수 있게)
// 반환: { rows, sheetName, headers, mapping, found } — rows가 비면 found로 원인을 안내
function parseConsultationWorkbook(workbook) {
    let best = null;
    workbook.SheetNames.forEach(sheetName => {
        const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
        grid.slice(0, 15).forEach((row, rowIdx) => {
            const headers = row.map(c => String(c ?? '').trim());
            const mapping = mapConsultHeaders(headers.filter(Boolean));
            const fields = new Set(Object.values(mapping));
            const score = fields.size + (fields.has('umail') || fields.has('student') ? 2 : 0) + (fields.has('sessionDate') ? 1 : 0);
            if (!best || score > best.score) best = { score, sheetName, rowIdx, headers, mapping, grid };
        });
    });
    const allHeaders = best ? best.headers.filter(Boolean) : [];
    const fields = best ? new Set(Object.values(best.mapping)) : new Set();
    if (!best || !(fields.has('student') || fields.has('umail'))) {
        return { rows: [], sheetName: best?.sheetName, headers: allHeaders, mapping: best?.mapping || {}, found: false };
    }
    const rows = best.grid.slice(best.rowIdx + 1).map(cells => {
        const raw = {};
        best.headers.forEach((h, i) => { if (h && cells[i] !== '' && cells[i] !== undefined && cells[i] !== null) raw[h] = cells[i]; });
        return raw;
    }).filter(raw => Object.keys(raw).length)
      .map(raw => normalizeConsultationRecord(raw, best.mapping))
      .filter(r => r.sessionDate || r.student || r.umail || r.review);
    return { rows, sheetName: best.sheetName, headers: allHeaders, mapping: best.mapping, found: true };
}

// 중복 판별 키 (공유 DB의 UNIQUE 규칙과 동일): 학생 + 날짜 + 카테고리 + 주제(대소문자·공백 무시)
function consultRecordKey(rec) {
    return [consultStudentKey(rec), rec.sessionDate, getConsultCategory(rec).id, String(rec.topic || '').trim().toLowerCase()].join('|');
}

// 기존 기록에 새 기록 합치기: 같은 상담이면 새 값으로 갱신, 아니면 추가 (파일 안의 중복도 하나로)
function mergeConsultationRecords(existing, incoming) {
    const merged = existing.map(r => normalizeConsultationRecord(r));
    const index = new Map(merged.map((r, i) => [consultRecordKey(r), i]));
    let added = 0, updated = 0;
    incoming.forEach(rec => {
        const key = consultRecordKey(rec);
        if (index.has(key)) {
            const i = index.get(key);
            // 새 파일에 비어 있는 칸은 기존 값을 유지
            Object.entries(rec).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) merged[i][k] = v; });
            updated++;
        } else {
            index.set(key, merged.length);
            merged.push(rec);
            added++;
        }
    });
    return { records: merged, added, updated };
}

// Spring = Jan–May, Summer = Jun–Aug, Fall = Sep–Dec
function seasonOfDate(iso) {
    const month = Number((iso || '').slice(5, 7));
    if (!month) return '';
    if (month <= 5) return 'Spring';
    if (month <= 8) return 'Summer';
    return 'Fall';
}

function getConsultationYears(records) {
    const years = new Set(records.map(r => (r.sessionDate || '').slice(0, 4)).filter(y => /^\d{4}$/.test(y)));
    if (years.size === 0) years.add(String(new Date().getFullYear()));
    return [...years].sort((a, b) => b - a);
}

function filterConsultations(records, year, season) {
    return records.filter(r => {
        if (year && year !== 'All' && (r.sessionDate || '').slice(0, 4) !== year) return false;
        if (season && season !== 'All' && seasonOfDate(r.sessionDate) !== season) return false;
        return true;
    });
}

function consultationStats(records) {
    const ratings = records.map(r => toRating(r.rating)).filter(n => n !== null);
    const high = ratings.filter(n => n >= 4).length;
    return {
        sessions: records.length,
        ratedCount: ratings.length,
        highPct: ratings.length ? (high / ratings.length) * 100 : null,
        avg: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null
    };
}

// _idx(숨김 속성) = window.dbState.consultationData 안의 원래 위치 → 화면에서 수정·삭제할 때 사용
function getConsultationRecords() {
    return (window.dbState.consultationData || [])
        .map((raw, i) => Object.defineProperty(normalizeConsultationRecord(raw), '_idx', { value: i }))
        .filter(r => r.sessionDate || r.student || r.umail || r.review);
}

// 실제 기록 입력용 엑셀 양식 (헤더 + 예시 1행)
function downloadConsultationTemplate() {
    const rows = [{
        'Session Date': '2026-03-15', 'Student': 'Jane Doe', 'uMail': 'u1234567@umail.utah.edu', 'Counselor': 'Dr. Robert Carter', 'Category': 'OPT / Visa',
        'Topic': 'OPT Filing & Resume Review', 'Rating': 5, 'Review': 'The session made the OPT application process clear.'
    }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Consultation');
    XLSX.writeFile(wb, 'CIDC_Consultation_Template.xlsx');
}

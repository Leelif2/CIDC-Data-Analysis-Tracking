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
    // 주제로 먼저 판단하고, 없으면 상담 메모, 이름 칸에 메모가 잘못 들어간 경우 그 내용으로 판단
    const byText = text => CONSULT_CATEGORIES.find(c => c.pattern && c.pattern.test(text || ''));
    return byText(rec.topic) || byText(rec.review) || (looksLikeNotes(rec.student) ? byText(rec.student) : null)
        || CONSULT_CATEGORIES[CONSULT_CATEGORIES.length - 1];
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

const isFirstNameHeader = h => /^(first|given) ?name$/.test(String(h).toLowerCase().trim());
const isLastNameHeader = h => /^((last|family) ?name|surname)$/.test(String(h).toLowerCase().trim());

const DATE_LIKE = /\d{1,4}\s*[\/.\-]\s*\d{1,2}\s*[\/.\-]\s*\d{1,4}|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

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
        // 날짜처럼 생긴 글자만 해석 (상담 메모 같은 일반 문장이 날짜로 잘못 바뀌지 않게)
        if (!DATE_LIKE.test(String(value))) return String(value);
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
        if (!mapping[key] && isFirstNameHeader(key)) { firstName = clean; return; }
        if (!mapping[key] && isLastNameHeader(key)) { lastName = clean; return; }
        // 표준 필드 이름과 같은 열이 다른 필드로 쓰이지 않았다면 이름을 바꿔 보존 (값이 덮어써지지 않게, 빈 값은 버림)
        if (!mapping[key] && CONSULT_FIELDS.includes(key)) {
            if (clean !== '' && clean !== null && clean !== undefined) rec[`${CONSULT_FIELD_LABELS[key]} (old)`] = clean;
            return;
        }
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

const hasContent = r => r.sessionDate || r.student || r.umail || r.review;

function normalizeConsultationData(rows) {
    return rows.map(r => normalizeConsultationRecord(r)).filter(hasContent);
}

// 이미 저장된 기록(표준 필드 이름 사용)을 다시 읽을 때: 표준 필드는 그대로, 나머지 열은 추가 정보로 보존
// (추가 열 이름이 'Notes'처럼 별칭과 겹쳐도 다시 추측해서 뒤바뀌지 않게)
function normalizeStoredRecord(raw) {
    const identity = {};
    Object.keys(raw).forEach(k => { if (CONSULT_FIELDS.includes(k)) identity[k] = k; });
    return normalizeConsultationRecord(raw, identity);
}

// ---------------------------------------------------------------------
// 열 자동 매칭: 열 제목 + 실제 값 모양을 함께 보고 어느 열이 이름/uMail/날짜인지 판단
// ---------------------------------------------------------------------
const NAME_LIKE = /^(?:\p{Lu}[\p{L}'’.\-]*)(?:\s+\p{Lu}[\p{L}'’.\-]*){0,3}$|^[가-힣]{2,5}$/u;
// 사람 이름이 아니라 문장(상담 메모)처럼 보이는 값
const looksLikeNotes = s => {
    const t = String(s || '').trim();
    return t.length > 30 || (t.split(/\s+/).length > 4 && !NAME_LIKE.test(t));
};
const MAPPABLE_FIELDS = ['student', 'umail', 'sessionDate', 'counselor', 'category', 'topic', 'rating', 'review'];

function profileColumn(values) {
    const vals = values.filter(v => v !== '' && v !== null && v !== undefined).slice(0, 300);
    const n = vals.length || 1;
    const strs = vals.map(v => (v instanceof Date ? '' : String(v).trim()));
    const ratio = test => vals.filter(test).length / n;
    return {
        count: vals.length,
        umail: ratio(v => /^u\d{7}(@umail\.utah\.edu)?$/i.test(String(v).trim())),
        email: ratio(v => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(v).trim())),
        date: ratio(v => v instanceof Date || (typeof v === 'number' && v > 30000 && v < 60000) || (typeof v === 'string' && v.length <= 40 && /^\d{4}-\d{2}-\d{2}$/.test(toIsoDate(v)))),
        name: strs.filter(s => NAME_LIKE.test(s)).length / n,
        // 성+이름처럼 두 단어 이상이거나 한글 이름 (제목 없이 값만으로 이름 열을 고를 때 사용)
        fullName: strs.filter(s => NAME_LIKE.test(s) && (/\s/.test(s) || /^[가-힣]{2,5}$/.test(s))).length / n,
        rating: ratio(v => toRating(v) !== null && String(v).trim().length <= 6),
        avgLen: strs.reduce((a, s) => a + s.length, 0) / n,
        samples: [...new Set(strs.filter(Boolean))].slice(0, 3)
    };
}

// rows: [{ 열 제목: 값 }], 반환: { student: '열 제목' | null, umail: ..., ... }
function autoMapColumns(headers, rows) {
    const profiles = {};
    headers.forEach(h => { profiles[h] = profileColumn(rows.map(r => r[h])); });
    const byHeader = mapConsultHeaders(headers); // 제목으로 먼저 추측
    const map = Object.fromEntries(MAPPABLE_FIELDS.map(f => [f, null]));
    Object.entries(byHeader).forEach(([h, f]) => { if (f in map && !map[f]) map[f] = h; });
    const taken = () => new Set(Object.values(map).filter(Boolean));
    // First/Last Name 열은 따로 쓰지 않고 나중에 합침 (normalizeConsultationRecord)
    const splitName = h => isFirstNameHeader(h) || isLastNameHeader(h);
    const nameHeader = h => /name|이름|성명/i.test(h) && !/counsel|advis|staff|상담사|담당/i.test(h) && !splitName(h);

    // 값이 하나도 없는 열은 어떤 필드에도 쓰지 않음
    Object.keys(map).forEach(f => { if (map[f] && profiles[map[f]].count === 0) map[f] = null; });
    if (map.student && splitName(map.student)) map.student = null;

    // 값이 맞지 않으면 제목 추측을 버림
    const valid = {
        umail: p => p.umail + p.email >= 0.5,
        sessionDate: p => p.date >= 0.5,
        student: (p, h) => p.name >= 0.5 || (nameHeader(h) && p.avgLen <= 40),
        counselor: p => p.name >= 0.4,
        rating: p => p.rating >= 0.6
    };
    Object.entries(valid).forEach(([f, ok]) => { if (map[f] && !ok(profiles[map[f]], map[f])) map[f] = null; });

    // 이름: 'Name'이 들어간 열이 이름처럼 보이면 그 열을 우선
    const betterName = headers.find(h => nameHeader(h) && !taken().has(h) && profiles[h].name >= 0.5);
    if (betterName && (!map.student || !nameHeader(map.student))) map.student = betterName;

    // 빈 자리는 값 모양이 가장 잘 맞는 열로 채움
    const pick = (field, score, min) => {
        if (map[field]) return;
        let best = null;
        headers.forEach(h => {
            if (taken().has(h) || profiles[h].count === 0) return;
            const s = score(profiles[h], h);
            if (s >= min && (!best || s > best.s)) best = { h, s };
        });
        if (best) map[field] = best.h;
    };
    pick('umail', p => p.umail + (p.email * 0.5), 0.5);
    pick('sessionDate', p => p.date, 0.6);
    // 제목에 Name이 있으면 이름 모양이면 충분, 없으면 '성 이름' 모양이 대부분이어야 함 (한 단어 값만 있는 열 오인 방지)
    const hasSplitName = headers.some(isFirstNameHeader) && headers.some(isLastNameHeader);
    if (!hasSplitName) pick('student', (p, h) => (splitName(h) ? 0 : nameHeader(h) ? p.name + 0.5 : p.fullName) - (p.avgLen > 40 ? 1 : 0), 0.6);
    pick('review', p => (p.avgLen >= 25 ? p.avgLen / 100 : 0), 0.25);
    return map;
}

// { 필드: 열 제목 } 대로 원본 행을 표준 기록으로 변환
function applyColumnMap(rawRows, fieldMap) {
    const headerToField = {};
    Object.entries(fieldMap).forEach(([f, h]) => { if (h) headerToField[h] = f; });
    return rawRows.map(raw => normalizeConsultationRecord(raw, headerToField)).filter(hasContent);
}

// 엑셀 파일 읽기: 모든 시트의 위쪽 15줄에서 '진짜 헤더 줄'을 찾아 가장 잘 맞는 시트를 사용
// (맨 위에 제목 줄이 있거나 데이터가 두 번째 시트에 있어도 읽을 수 있게)
// 반환: { rawRows, headers, fieldMap, rows, sheetName, found } — 화면에서 열 매칭을 바꿔 다시 적용할 수 있게 원본도 돌려줌
function parseConsultationWorkbook(workbook) {
    let best = null;
    workbook.SheetNames.forEach(sheetName => {
        const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
        grid.slice(0, 15).forEach((row, rowIdx) => {
            const headers = row.map(c => String(c ?? '').trim());
            const mapping = mapConsultHeaders(headers.filter(Boolean));
            const fields = new Set(Object.values(mapping));
            const score = fields.size + (fields.has('umail') || fields.has('student') ? 2 : 0) + (fields.has('sessionDate') ? 1 : 0);
            if (!best || score > best.score) best = { score, sheetName, rowIdx, headers, grid };
        });
    });
    if (!best) return { rawRows: [], headers: [], fieldMap: {}, rows: [], found: false };
    // 제목이 같은 열이 여러 개면 뒤에 번호를 붙여 구분
    const seen = {};
    const headers = best.headers.map(h => { if (!h) return ''; seen[h] = (seen[h] || 0) + 1; return seen[h] > 1 ? `${h} (${seen[h]})` : h; });
    const rawRows = best.grid.slice(best.rowIdx + 1).map(cells => {
        const raw = {};
        headers.forEach((h, i) => { if (h && cells[i] !== '' && cells[i] !== undefined && cells[i] !== null) raw[h] = cells[i]; });
        return raw;
    }).filter(raw => Object.keys(raw).length);
    const usable = headers.filter(Boolean);
    const fieldMap = autoMapColumns(usable, rawRows);
    const found = Boolean(fieldMap.student || fieldMap.umail || (usable.some(isFirstNameHeader) && usable.some(isLastNameHeader)));
    return { rawRows, headers: usable, fieldMap, rows: found ? applyColumnMap(rawRows, fieldMap) : [], sheetName: best.sheetName, found };
}

// 중복 판별 키 (공유 DB의 UNIQUE 규칙과 동일): 학생 + 날짜 + 카테고리 + 주제(대소문자·공백 무시)
// 날짜가 없는 기록은 날짜로 구분할 수 없으므로 메모 내용까지 같아야 같은 상담으로 봄
function consultRecordKey(rec) {
    const parts = [consultStudentKey(rec), rec.sessionDate, getConsultCategory(rec).id, String(rec.topic || '').trim().toLowerCase()];
    if (!rec.sessionDate) parts.push(String(rec.review || '').trim().toLowerCase());
    return parts.join('|');
}

// 기존 기록에 새 기록 합치기: 같은 상담이면 새 값으로 갱신, 아니면 추가 (파일 안의 중복도 하나로)
function mergeConsultationRecords(existing, incoming) {
    const merged = existing.map(r => normalizeStoredRecord(r));
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
        .map((raw, i) => Object.defineProperty(normalizeStoredRecord(raw), '_idx', { value: i }))
        .filter(hasContent);
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

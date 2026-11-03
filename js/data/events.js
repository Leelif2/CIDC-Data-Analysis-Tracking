// CIDC 행사 기록: 엑셀 읽기 + 표준 형식
// 한 행 = 행사 1개: { name, type, start, end, year, rsvp, attendees, note }
// 대시보드는 브라우저에 올린 행사 파일(window.dbState.eventLog)이 있으면 그것을, 없으면 기본 목록(CIDC_EVENTS_DEFAULT)을 사용
// 날짜 변환은 js/data/consultation.js 의 toIsoDate 를 함께 사용 (먼저 불러와야 함)

const EVENT_FIELD_PATTERNS = [
    ['name', /event\s*name|^event$|^title$|^program$|행사명|행사\s*이름/i],
    ['type', /event\s*type|^type$|category|유형|분류/i],
    ['date', /^date|^when|일자|날짜|일시/i],
    ['year', /^year$|연도/i],
    ['rsvp', /rsvp|registered|registration|sign.?up|신청/i],
    ['attendees', /actual|attendees|attendance(?!\s*rate)|participants|headcount|참석(자|인원)?$|참여/i],
    ['rate', /rate|turnout|참석률/i],
    ['note', /note|memo|remark|비고|메모/i]
];

const eventText = v => String(v ?? '').replace(/\s+/g, ' ').trim();

// 'N/A', '', '-' → null / '59' → 59
function eventNumber(v) {
    if (typeof v === 'number') return isFinite(v) && v >= 0 ? Math.round(v) : null;
    const s = eventText(v).replace(/,/g, '');
    if (!s || /^(n\/?a|none|-|tbd|\?)$/i.test(s)) return null;
    const n = parseFloat(s);
    return isNaN(n) || n < 0 ? null : Math.round(n);
}

// "'2024-10-12 ~ 2024-10-14", "2024-11-22, 2024-11-29", 엑셀 날짜 → { start, end }
function eventDates(value) {
    if (value instanceof Date || typeof value === 'number') {
        const iso = toIsoDate(value);
        return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? { start: iso, end: iso } : { start: '', end: '' };
    }
    const s = eventText(value).replace(/^'+/, '');
    const found = (s.match(/\d{4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}/g) || []).map(toIsoDate).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (!found.length) {
        const single = toIsoDate(s);
        return /^\d{4}-\d{2}-\d{2}$/.test(single) ? { start: single, end: single } : { start: '', end: '' };
    }
    const sorted = [...found].sort();
    return { start: sorted[0], end: sorted[sorted.length - 1] };
}

const EVENT_TYPE_LABELS = {
    'info session': 'Info Session', 'career talk': 'Career Talk', 'boot camp': 'Boot Camp', bootcamp: 'Boot Camp',
    volunteer: 'Volunteer', 'alumni series': 'Alumni Series', other: 'Other'
};
function eventType(v) {
    const t = eventText(v);
    if (!t) return 'Other';
    return EVENT_TYPE_LABELS[t.toLowerCase()] || t.replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeEvent(raw) {
    const { start, end } = eventDates(raw.date);
    const year = start ? start.slice(0, 4) : (eventNumber(raw.year) ? String(eventNumber(raw.year)) : '');
    const note = eventText(raw.note);
    return {
        name: eventText(raw.name),
        type: eventType(raw.type),
        start, end, year,
        rsvp: eventNumber(raw.rsvp),
        attendees: eventNumber(raw.attendees),
        // '출석 기록 없음' 같은 메모는 숫자 칸으로 이미 드러나므로 숨김
        note: /no attendance data/i.test(note) ? '' : note
    };
}

// 엑셀 → 행사 목록: 시트마다 위쪽 15줄에서 '행사 이름 + 날짜' 가 있는 헤더 줄을 찾음
function parseEventsWorkbook(workbook) {
    let best = null;
    workbook.SheetNames.forEach(sheetName => {
        const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
        grid.slice(0, 15).forEach((row, rowIdx) => {
            const map = {};
            row.forEach((cell, col) => {
                const h = eventText(cell);
                if (!h) return;
                const hit = EVENT_FIELD_PATTERNS.find(([field, re]) => !(field in map) && re.test(h));
                if (hit) map[hit[0]] = col;
            });
            if (!('name' in map) || !('date' in map)) return;
            const score = Object.keys(map).length;
            if (!best || score > best.score) best = { score, sheetName, rowIdx, map, grid };
        });
    });
    if (!best) return { events: [], sheetName: null, found: false };
    const events = best.grid.slice(best.rowIdx + 1)
        .map(cells => normalizeEvent(Object.fromEntries(Object.entries(best.map).map(([field, col]) => [field, cells[col]]))))
        .filter(e => e.name);
    events.sort((a, b) => (b.start || '').localeCompare(a.start || ''));
    return { events, sheetName: best.sheetName, found: true };
}

// 대시보드가 쓸 행사 목록: 업로드한 파일 > 기본 목록
function getEventLog() {
    const uploaded = window.dbState && Array.isArray(window.dbState.eventLog) ? window.dbState.eventLog : null;
    if (uploaded && uploaded.length) return { events: uploaded, source: window.dbState.eventLogSource || { fileName: 'Uploaded file' }, builtIn: false };
    const def = typeof CIDC_EVENTS_DEFAULT !== 'undefined' ? CIDC_EVENTS_DEFAULT : { events: [], source: null };
    return { events: def.events, source: def.source, builtIn: true };
}

if (typeof module !== 'undefined') module.exports = { parseEventsWorkbook, normalizeEvent, eventDates, eventNumber };

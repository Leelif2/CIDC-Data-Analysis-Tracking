// 대시보드: Consultation Records 에 올린 상담 기록(window.dbState.consultationData)을 읽어 현황을 계산·시각화
// 상담 데이터는 읽기만 함 (Consultation 페이지·데이터는 바꾸지 않음)
// 계산(computeInsights)과 그리기(render*)를 분리해 둠

// ---------------------------------------------------------------------
// 1. 열 찾기: 엑셀마다 열 이름이 달라도 같은 의미의 열을 찾음
//    (Consultation 업로드가 표준 필드로 바꾼 열은 표준 이름으로, 나머지는 원래 열 이름으로 저장됨)
// ---------------------------------------------------------------------
const STD_FIELDS = ['sessionDate', 'student', 'umail', 'major', 'counselor', 'category', 'topic', 'rating', 'review'];
const isBlank = v => v === undefined || v === null || String(v).trim() === '';

function pickExtra(rec, patterns, exclude) {
    for (const re of patterns) {
        for (const [k, v] of Object.entries(rec)) {
            if (STD_FIELDS.includes(k) || isBlank(v)) continue;
            if (exclude && exclude.test(k)) continue;
            if (re.test(k)) return v;
        }
    }
    return '';
}

const titleCase = s => String(s).toLowerCase().replace(/(^|[\s/&(-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
const tidy = v => String(v ?? '').replace(/\s+/g, ' ').trim();

// 학년: 순서가 있는 값
const LEVEL_ORDER = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate', 'Alumni', 'Other'];
function levelOf(rec) {
    const raw = tidy(pickExtra(rec, [/academic\s*level/i, /class\s*standing/i, /^(level|grade|year in school|school year)$/i]));
    if (!raw) return '';
    const v = raw.toLowerCase();
    if (/[/,]|\band\b/.test(v)) return 'Other'; // 'Freshman/Senior' 처럼 둘 이상 적힌 값
    if (/fresh|1st|first/.test(v)) return 'Freshman';
    if (/soph|2nd|second/.test(v)) return 'Sophomore';
    if (/junior|3rd|third/.test(v)) return 'Junior';
    if (/senior|4th|fourth/.test(v)) return 'Senior';
    if (/grad|master|ph\.?d|doctor/.test(v)) return 'Graduate';
    if (/alum/.test(v)) return 'Alumni';
    return 'Other';
}

// 방문 이유: 비슷한 표현을 주제별로 묶음 (위에서부터 먼저 맞는 주제)
const REASON_THEMES = [
    ['Resume & Cover Letter', /resume|résumé|\bcv\b|cover letter|portfolio/i],
    ['Interview Prep', /interview|mock/i],
    ['Internship Search', /intern|experiential|co-?op/i],
    ['Job Search', /\bjob|employ|offer|application|hiring|recruit/i],
    ['Visa / OPT / CPT', /\b(opt|cpt|visa|f-?1|ead|sevis)\b/i],
    ['Graduate School', /grad(uate)?\s*school|master|ph\.?d|admission/i],
    ['Personal Counseling', /personal|wellbeing|well-being|mental|stress/i],
    ['Career Exploration', /career|explor|goal|plan|path|major|direction/i],
    ['General Consultation', /general|consult/i]
];
function reasonOf(rec) {
    const raw = tidy(pickExtra(rec, [/visit\w*\s*reason/i, /^reason/i, /purpose/i]) || rec.topic);
    if (!raw) return '';
    const hit = REASON_THEMES.find(([, re]) => re.test(raw));
    return hit ? hit[0] : 'Other';
}

// 상담 방식: 'Session Type' 열 (업로드 때 Category 로 들어갔을 수도 있음)
const MODE_LIKE = /counsel|zoom|face|in-?person|drop|e-?mail|phone|call|online|virtual|teams|walk/i;
function sessionTypeOf(rec) {
    // 순서: 'Session Type' 열 → Category 칸(업로드 때 Session Type 이 들어간 경우) → Meeting type / Format 열
    // 'Format' 처럼 상태값(Completed 등)이 섞인 열은 상담 방식처럼 보이는 값일 때만 사용
    const candidates = [
        pickExtra(rec, [/session\s*type/i], /follow/i),
        rec.category,
        pickExtra(rec, [/meeting\s*type|appointment\s*type|^mode$|^format$/i], /follow/i)
    ].map(tidy);
    const raw = candidates.find(v => v && MODE_LIKE.test(v));
    if (!raw) return '';
    const v = raw.toLowerCase();
    if (/zoom|online|virtual|teams/.test(v)) return 'Zoom / Online';
    if (/face|in-?person/.test(v)) return 'Face-to-Face';
    if (/drop|walk/.test(v)) return 'Drop-in';
    if (/e-?mail/.test(v)) return 'Email';
    if (/phone|call/.test(v)) return 'Phone';
    if (/1\s*:\s*1|one.on.one|individual|counsel/.test(v)) return '1:1 Counseling';
    return titleCase(raw);
}

function referralOf(rec) {
    const raw = tidy(pickExtra(rec, [/referral/i, /how did .*hear|heard about|^source$/i]));
    return raw ? titleCase(raw) : '';
}

// 상담 시간(분): '30mins', '30', '0.5 hour', '1hr', '1.5 hours'
function durationOf(rec) {
    const raw = tidy(pickExtra(rec, [/duration/i, /length|minutes/i])).toLowerCase();
    if (!raw) return null;
    const n = parseFloat(raw);
    if (isNaN(n)) return null;
    const minutes = /h(ou)?r/.test(raw) ? n * 60 : n;
    return minutes > 0 && minutes <= 480 ? Math.round(minutes) : null;
}

function followUpOf(rec) {
    const raw = tidy(pickExtra(rec, [/follow.?up\s*(required|needed)|follow.?up\s*\?/i], /date/i)).toLowerCase();
    if (/^(y|yes|true|1)$/.test(raw)) return true;
    if (/^(n|no|false|0)$/.test(raw)) return false;
    return null;
}

function satisfactionOf(rec) {
    const r = toRating(rec.rating);
    return r !== null ? r : toRating(pickExtra(rec, [/satisf/i, /rating|score/i]));
}

// 전공·상담사: 대소문자만 다른 값은 하나로 (가장 많이 쓰인 표기를 대표로)
function canonicalizer(values, extraMerge) {
    const counts = new Map();
    values.forEach(v => { const t = tidy(v); if (t) counts.set(t, (counts.get(t) || 0) + 1); });
    const byKey = new Map();
    [...counts].sort((a, b) => b[1] - a[1]).forEach(([v, n]) => {
        let key = v.toLowerCase();
        if (extraMerge) key = extraMerge(key, [...byKey.keys()]) || key;
        if (!byKey.has(key)) byKey.set(key, v);
    });
    return v => { const t = tidy(v); if (!t) return ''; let key = t.toLowerCase(); if (extraMerge) key = extraMerge(key, [...byKey.keys()]) || key; return byKey.get(key) || t; };
}

// 상담사 이름: 'Jacob' → 'Jacob Lee', 오타 한 글자('Hailiey' → 'Hailey')는 같은 사람으로
function editDistanceAtMost1(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++edits > 1) return false;
        if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
}
const mergeCounselor = (key, known) => known.find(k => k.split(' ')[0] === key || key.split(' ')[0] === k || editDistanceAtMost1(k, key));

// ---------------------------------------------------------------------
// 2. 계산
// ---------------------------------------------------------------------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// 원본 기록 → 대시보드용 행
function toRows(records) {
    const majorName = canonicalizer(records.map(r => r.major));
    const counselorName = canonicalizer(records.map(r => r.counselor), mergeCounselor);
    return records.map(r => {
        const date = ISO_DATE.test(r.sessionDate || '') ? r.sessionDate : '';
        return {
            date,
            year: date.slice(0, 4),
            month: date.slice(0, 7),
            term: date ? seasonOfDate(date) : '',
            weekday: date ? WEEKDAYS[(new Date(`${date}T00:00:00`).getDay() + 6) % 7] : '',
            student: consultStudentKey(r),
            level: levelOf(r),
            major: majorName(r.major),
            reason: reasonOf(r),
            sessionType: sessionTypeOf(r),
            referral: referralOf(r),
            counselor: counselorName(r.counselor),
            duration: durationOf(r),
            followUp: followUpOf(r),
            satisfaction: satisfactionOf(r)
        };
    });
}

function countBy(rows, field, order) {
    const c = new Map();
    rows.forEach(r => { if (r[field]) c.set(r[field], (c.get(r[field]) || 0) + 1); });
    let entries = [...c];
    entries = order
        ? entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
        : entries.sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    return { entries, recorded: entries.reduce((s, [, n]) => s + n, 0), missing: rows.filter(r => !r[field]).length };
}

// 많은 항목은 상위 N개 + 'Other'
function topN(entries, n) {
    if (entries.length <= n) return entries;
    const rest = entries.slice(n - 1).reduce((s, [, v]) => s + v, 0);
    return [...entries.slice(0, n - 1), [`Other (${entries.length - n + 1})`, rest]];
}

function monthRange(first, last) {
    const out = [];
    let [y, m] = first.split('-').map(Number);
    const [ly, lm] = last.split('-').map(Number);
    while (y < ly || (y === ly && m <= lm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
    return out;
}

const pct = (a, b) => (b ? (a / b) * 100 : null);

function computeInsights(allRows, filters = {}) {
    const rows = allRows.filter(r =>
        (!filters.year || filters.year === 'All' || r.year === filters.year)
        && (!filters.term || filters.term === 'All' || r.term === filters.term)
        && (!filters.counselor || filters.counselor === 'All' || r.counselor === filters.counselor));

    // 학생 수·재방문
    const perStudent = new Map();
    rows.forEach(r => { if (r.student) perStudent.set(r.student, (perStudent.get(r.student) || 0) + 1); });
    const students = perStudent.size;
    const returning = [...perStudent.values()].filter(n => n > 1).length;

    // 비교: 연도를 골랐으면 같은 조건의 전년도와 비교
    let compare = null;
    if (filters.year && filters.year !== 'All' && !filters._noCompare) {
        const prevYear = String(Number(filters.year) - 1);
        const prev = computeInsights(allRows, { ...filters, year: prevYear, _noCompare: true }).total;
        if (prev > 0) compare = { label: prevYear, value: prev, change: pct(rows.length - prev, prev) };
    }

    // 월별 추이: 연도를 고르면 그 해 1~12월, 아니면 첫 기록 달 ~ 마지막 기록 달 (기록 없는 달은 0)
    const months = rows.map(r => r.month).filter(Boolean).sort();
    let monthKeys = [];
    if (filters.year && filters.year !== 'All') monthKeys = monthRange(`${filters.year}-01`, `${filters.year}-12`);
    else if (months.length) monthKeys = monthRange(months[0], months[months.length - 1]);
    const monthCount = new Map(monthKeys.map(k => [k, 0]));
    rows.forEach(r => { if (monthCount.has(r.month)) monthCount.set(r.month, monthCount.get(r.month) + 1); });

    const followKnown = rows.filter(r => r.followUp !== null);
    const durations = rows.map(r => r.duration).filter(n => n !== null);
    const ratings = rows.map(r => r.satisfaction).filter(n => n !== null);
    const yearCounts = countBy(allRows, 'year', null).entries.sort((a, b) => a[0].localeCompare(b[0]));

    return {
        total: rows.length,
        students,
        sessionsPerStudent: students ? rows.filter(r => r.student).length / students : null,
        returning,
        returningPct: pct(returning, students),
        followUp: { yes: followKnown.filter(r => r.followUp).length, known: followKnown.length, pct: pct(followKnown.filter(r => r.followUp).length, followKnown.length) },
        avgDuration: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
        satisfaction: { count: ratings.length, avg: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null },
        compare,
        monthly: [...monthCount],
        byYear: yearCounts,
        reason: countBy(rows, 'reason'),
        level: countBy(rows, 'level', LEVEL_ORDER),
        major: countBy(rows, 'major'),
        sessionType: countBy(rows, 'sessionType'),
        referral: countBy(rows, 'referral'),
        counselor: countBy(rows, 'counselor'),
        weekday: countBy(rows, 'weekday', WEEKDAYS),
        undated: rows.filter(r => !r.date).length,
        completeness: [
            ['Session date', rows.filter(r => r.date).length],
            ['Academic level', rows.filter(r => r.level).length],
            ['Visiting reason', rows.filter(r => r.reason).length],
            ['Counselor', rows.filter(r => r.counselor).length],
            ['Session type', rows.filter(r => r.sessionType).length],
            ['Referral source', rows.filter(r => r.referral).length],
            ['Major', rows.filter(r => r.major).length],
            ['Follow-up (Yes/No)', followKnown.length],
            ['Satisfaction score', ratings.length]
        ]
    };
}

// 연도별 기록 수가 다른 해보다 크게 적으면 '기록이 빠졌을 수 있음' 안내
function sparseYears(byYear) {
    if (byYear.length < 3) return [];
    const sorted = byYear.map(([, n]) => n).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return byYear.filter(([, n]) => n < median * 0.1).map(([y, n]) => ({ year: y, count: n }));
}

// ---------------------------------------------------------------------
// 3. 화면 그리기 (브라우저)
// ---------------------------------------------------------------------
const VIZ = {
    bar: '#2a78d6',        // 단일 계열 색 (한 가지 색만 사용: 막대 길이가 값을 나타냄)
    barHover: '#1f63b8',
    grid: '#e2e8f0',
    axis: '#64748b',
    ink: '#0f172a',
    inkSoft: '#334155',
    font: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif"
};
const charts = {};
let dashRows = [];
const dashFilters = { year: 'All', term: 'All', counselor: 'All' };

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtInt = n => (n ?? 0).toLocaleString('en-US');
const fmtPct = n => (n === null || n === undefined ? '–' : `${n < 10 && n > 0 ? n.toFixed(1) : Math.round(n)}%`);
// 'short' = 차트 축용 (May 26 = 2026년 5월), 'long' = 문장·표용 (May 2026)
const monthLabel = (key, withYear, style = 'short') => {
    const [y, m] = key.split('-').map(Number);
    const name = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' });
    if (!withYear) return name;
    return style === 'long' ? `${name} ${y}` : `${name} '${String(y).slice(2)}`;
};

// 가로 막대 끝에 값 표시 (순위 막대에서만)
const endLabels = {
    id: 'endLabels',
    afterDatasetsDraw(chart, args, opts) {
        if (!opts || !opts.enabled) return;
        const { ctx } = chart;
        const meta = chart.getDatasetMeta(0);
        ctx.save();
        ctx.font = `700 12px ${VIZ.font}`;
        ctx.fillStyle = VIZ.inkSoft;
        ctx.textBaseline = 'middle';
        meta.data.forEach((bar, i) => {
            const v = chart.data.datasets[0].data[i];
            if (!v) return;
            ctx.fillText(fmtInt(v), bar.x + 6, bar.y);
        });
        ctx.restore();
    }
};

// unit: 툴팁의 단위 ('consultation' → '12 consultations'), extra(i): 툴팁에 덧붙일 줄
function barChart(id, labels, values, { horizontal = false, total = null, height, unit = 'consultation', extra = null, share = true } = {}) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    if (charts[id]) charts[id].destroy();
    if (height) canvas.parentElement.style.height = `${height}px`;
    const sum = total ?? values.reduce((a, b) => a + b, 0);
    const valueAxis = {
        beginAtZero: true,
        grid: { color: VIZ.grid, drawTicks: false },
        border: { display: false },
        ticks: { color: VIZ.axis, font: { family: VIZ.font, size: 11 }, precision: 0, padding: 6 },
        grace: horizontal ? '12%' : '5%'
    };
    const categoryAxis = {
        grid: { display: false },
        border: { color: VIZ.grid },
        ticks: { color: VIZ.inkSoft, font: { family: VIZ.font, size: 12, weight: '600' }, autoSkip: !horizontal, maxRotation: 0 }
    };
    charts[id] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: VIZ.bar,
                hoverBackgroundColor: VIZ.barHover,
                borderRadius: 4,
                borderSkipped: 'start',
                maxBarThickness: horizontal ? 22 : 34,
                categoryPercentage: 0.82,
                barPercentage: 0.9
            }]
        },
        options: {
            indexAxis: horizontal ? 'y' : 'x',
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 250 },
            layout: { padding: { right: horizontal ? 8 : 0 } },
            interaction: { mode: 'index', intersect: false },
            scales: horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
            plugins: {
                legend: { display: false },
                endLabels: { enabled: horizontal },
                tooltip: {
                    backgroundColor: '#0f172a',
                    titleFont: { family: VIZ.font, size: 13, weight: '700' },
                    bodyFont: { family: VIZ.font, size: 13 },
                    padding: 10,
                    displayColors: false,
                    callbacks: {
                        label: c => `${fmtInt(c.raw)} ${unit}${c.raw === 1 ? '' : 's'}${share && sum ? ` · ${fmtPct((c.raw / sum) * 100)}` : ''}`,
                        afterLabel: c => (extra ? extra(c.dataIndex) || '' : '')
                    }
                }
            }
        },
        plugins: [endLabels]
    });
}

// 차트 카드 아래 '표로 보기' (색을 구분하기 어려운 경우·정확한 숫자 확인용)
function setTable(id, header, rows) {
    const box = document.getElementById(`${id}-table`);
    if (!box) return;
    const total = rows.reduce((s, r) => s + r[1], 0);
    box.innerHTML = `
        <table class="w-full text-left text-[13px]">
            <thead><tr class="text-slate-500"><th class="py-1.5 pr-3 font-bold">${esc(header)}</th><th class="py-1.5 pr-3 font-bold text-right">Count</th><th class="py-1.5 font-bold text-right">Share</th></tr></thead>
            <tbody>${rows.map(([k, v]) => `<tr class="border-t border-slate-100"><td class="py-1.5 pr-3 text-slate-800">${esc(k)}</td><td class="py-1.5 pr-3 text-right font-bold text-slate-900">${fmtInt(v)}</td><td class="py-1.5 text-right text-slate-500">${fmtPct(total ? (v / total) * 100 : null)}</td></tr>`).join('')}</tbody>
        </table>`;
}

function toggleTable(id) {
    const box = document.getElementById(`${id}-table`);
    const btn = document.querySelector(`[data-table-for="${id}"]`);
    if (!box) return;
    const show = box.classList.contains('hidden');
    box.classList.toggle('hidden', !show);
    if (btn) btn.innerHTML = show ? '<i class="fa-solid fa-chart-column"></i> Chart only' : '<i class="fa-solid fa-table"></i> Table';
}

function setText(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }

// 한 줄 요약: 1위 항목과 비율
function lead(entries, recorded, noun) {
    if (!entries.length) return `No ${noun} recorded for this selection.`;
    const [name, n] = entries[0];
    return `<b>${esc(name)}</b> is the top ${noun} — ${fmtPct((n / recorded) * 100)} of recorded consultations.`;
}

function missingNote(missing, total, what) {
    if (!missing || !total) return '';
    return `<span class="text-amber-700"><i class="fa-solid fa-circle-info mr-1"></i>${fmtInt(missing)} of ${fmtInt(total)} records (${fmtPct((missing / total) * 100)}) have no ${what}.</span>`;
}

function renderSource(records) {
    const src = window.dbState.consultationSource;
    const box = document.getElementById('dash-source');
    if (src && src.fileName) {
        const when = new Date(src.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        box.className = 'flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-2xl px-5 py-4';
        box.innerHTML = `
            <p class="text-[15px] text-slate-700"><i class="fa-solid fa-file-excel text-emerald-600 mr-2"></i>Based on <b>${esc(src.fileName)}</b> · uploaded ${esc(when)} · <b>${fmtInt(records.length)}</b> consultation records</p>
            <a href="consultation.html" class="text-[14px] font-bold text-blue-700 hover:text-blue-900"><i class="fa-solid fa-upload mr-1.5"></i>Upload a newer file</a>`;
    } else {
        box.className = 'flex flex-wrap items-center justify-between gap-3 bg-amber-50 border border-amber-300 rounded-2xl px-5 py-4';
        box.innerHTML = `
            <p class="text-[15px] text-amber-900"><i class="fa-solid fa-triangle-exclamation mr-2"></i><b>Showing sample data.</b> Upload the latest consultation Excel to see CIDC's real numbers. The file stays in this browser.</p>
            <a href="consultation.html" class="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-[14px] font-bold px-4 py-2.5 rounded-xl"><i class="fa-solid fa-upload"></i> Upload latest file</a>`;
    }
}

function renderFilters() {
    // 연도 목록: 상담 기록 + 행사 기록에 있는 연도
    const eventYears = typeof getEventLog === 'function' ? getEventLog().events.map(e => e.year) : [];
    const years = [...new Set([...dashRows.map(r => r.year), ...eventYears].filter(Boolean))].sort().reverse();
    const counselors = [...new Set(dashRows.map(r => r.counselor).filter(Boolean))].sort();
    const fill = (id, label, values, current) => {
        const el = document.getElementById(id);
        el.innerHTML = `<option value="All">${label}</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
        el.value = values.includes(current) ? current : 'All';
        return el.value;
    };
    dashFilters.year = fill('f-year', 'All years', years, dashFilters.year);
    dashFilters.term = fill('f-term', 'All terms', ['Spring', 'Summer', 'Fall'], dashFilters.term);
    dashFilters.counselor = fill('f-counselor', 'All counselors', counselors, dashFilters.counselor);
}

function setFilter(key, value) {
    dashFilters[key] = value;
    renderDashboard(false);
}

function resetFilters() {
    Object.assign(dashFilters, { year: 'All', term: 'All', counselor: 'All' });
    renderFilters();
    renderDashboard(false);
}

function renderKpis(s) {
    const cmp = s.compare
        ? (() => {
            const up = s.compare.change >= 0;
            const arrow = up ? 'fa-arrow-trend-up text-emerald-600' : 'fa-arrow-trend-down text-rose-600';
            return `<i class="fa-solid ${arrow} mr-1"></i>${up ? '+' : ''}${fmtPct(s.compare.change)} vs ${esc(s.compare.label)} (${fmtInt(s.compare.value)})`;
        })()
        : 'All consultations in this selection';
    const tile = (label, value, hint, icon) => `
        <div class="bg-white border border-slate-200 rounded-2xl p-5 flex items-start justify-between gap-3">
            <div class="min-w-0">
                <span class="block text-[13px] font-bold text-slate-500">${label}</span>
                <span class="block text-[34px] leading-tight font-black text-slate-900 mt-1">${value}</span>
                <span class="block text-[13px] text-slate-500 mt-1">${hint}</span>
            </div>
            <div class="w-11 h-11 shrink-0 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center text-[18px]"><i class="fa-solid ${icon}"></i></div>
        </div>`;
    setText('dash-kpis', [
        tile('Consultations', fmtInt(s.total), cmp, 'fa-comments'),
        tile('Students served', fmtInt(s.students), s.sessionsPerStudent ? `${s.sessionsPerStudent.toFixed(1)} sessions per student on average` : '–', 'fa-user-graduate'),
        tile('Returning students', fmtPct(s.returningPct), `${fmtInt(s.returning)} students came back for 2+ sessions`, 'fa-rotate'),
        tile('Follow-up needed', fmtPct(s.followUp.pct), s.followUp.known ? `${fmtInt(s.followUp.yes)} of ${fmtInt(s.followUp.known)} records with a Yes/No answer` : 'No follow-up answers recorded', 'fa-list-check')
    ].join(''));

    const mini = (label, value, hint) => `
        <div class="flex items-baseline gap-2 flex-wrap"><span class="text-[13px] font-bold text-slate-500">${label}</span><span class="text-[18px] font-black text-slate-900">${value}</span><span class="text-[13px] text-slate-500">${hint}</span></div>`;
    setText('dash-mini', [
        mini('Average session length', s.avgDuration ? `${Math.round(s.avgDuration)} min` : '–', ''),
        mini('Satisfaction', s.satisfaction.avg ? `${s.satisfaction.avg.toFixed(1)} / 5` : '–',
            s.satisfaction.count ? `from only ${fmtInt(s.satisfaction.count)} rated sessions — collect more ratings for a reliable score` : 'no ratings recorded'),
        mini('Records without a date', fmtInt(s.undated), s.undated ? 'not shown in the timeline' : '')
    ].join(''));
}

function renderAlerts(s) {
    const notes = [];
    if (dashFilters.year === 'All') {
        sparseYears(s.byYear).forEach(({ year, count }) => notes.push(
            `<b>${esc(year)}</b> has only ${fmtInt(count)} record${count === 1 ? '' : 's'}, far fewer than other years — that year's logs may be missing from the file.`));
    }
    setText('dash-alerts', notes.map(n => `
        <div class="bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl px-5 py-3 text-[14px]"><i class="fa-solid fa-triangle-exclamation mr-2"></i>${n}</div>`).join(''));
}

function renderTrend(s) {
    const withYear = dashFilters.year === 'All';
    const labels = s.monthly.map(([k]) => monthLabel(k, withYear));
    const values = s.monthly.map(([, n]) => n);
    barChart('c-trend', labels, values, { total: values.reduce((a, b) => a + b, 0) });
    setTable('c-trend', 'Month', s.monthly.map(([k, n]) => [monthLabel(k, true, 'long'), n]));
    if (!values.some(Boolean)) { setText('c-trend-lead', 'No dated consultations for this selection.'); return; }
    const peak = s.monthly.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
    const byYear = s.byYear.map(([y, n]) => `${esc(y)}: <b>${fmtInt(n)}</b>`).join(' · ');
    setText('c-trend-lead', `Busiest month: <b>${monthLabel(peak[0], true, 'long')}</b> with ${fmtInt(peak[1])} consultations.${withYear ? `<br><span class="text-slate-500">By year — ${byYear}</span>` : ''}`);
}

function renderRanked(id, data, noun, missingWhat, { limit = 10, ordered = false, header } = {}) {
    const entries = ordered ? data.entries : topN(data.entries, limit);
    // 값이 하나도 없으면 빈 축 대신 안내 문장만
    const box = document.getElementById(id)?.parentElement;
    if (box) box.classList.toggle('hidden', !entries.length);
    document.querySelector(`[data-table-for="${id}"]`)?.classList.toggle('hidden', !entries.length);
    if (!entries.length) {
        if (charts[id]) { charts[id].destroy(); delete charts[id]; }
        document.getElementById(`${id}-table`)?.classList.add('hidden');
        setText(`${id}-lead`, `No ${noun} is recorded for this selection. Add a <b>${esc(noun)}</b> column to the Excel log to see this chart.`);
        setText(`${id}-note`, '');
        return;
    }
    barChart(id, entries.map(([k]) => k), entries.map(([, n]) => n), {
        horizontal: !ordered, total: data.recorded,
        height: ordered ? undefined : Math.max(150, entries.length * 34 + 30)
    });
    setTable(id, header || noun, data.entries);
    setText(`${id}-lead`, ordered ? leadOrdered(data, noun) : lead(data.entries, data.recorded, noun));
    setText(`${id}-note`, missingNote(data.missing, data.recorded + data.missing, missingWhat));
}

function leadOrdered(data, noun) {
    if (!data.entries.length) return `No ${noun} recorded for this selection.`;
    const top = [...data.entries].sort((a, b) => b[1] - a[1])[0];
    return `<b>${esc(top[0])}</b> is the largest group — ${fmtPct((top[1] / data.recorded) * 100)} of consultations with a recorded ${noun}.`;
}

function renderCompleteness(s) {
    setText('dash-completeness', s.completeness.map(([label, filled]) => {
        const p = s.total ? (filled / s.total) * 100 : 0;
        const tone = p >= 80 ? 'bg-emerald-500' : p >= 50 ? 'bg-amber-400' : 'bg-rose-400';
        return `
            <div class="grid grid-cols-[150px_1fr_64px] items-center gap-3 text-[13px]">
                <span class="font-semibold text-slate-700">${esc(label)}</span>
                <div class="h-2.5 bg-slate-100 rounded-full overflow-hidden" role="img" aria-label="${esc(label)} filled in ${fmtPct(p)} of records"><div class="h-full ${tone} rounded-full" style="width:${p.toFixed(1)}%"></div></div>
                <span class="text-right font-bold text-slate-800">${fmtPct(p)}</span>
            </div>`;
    }).join(''));
}

function renderDashboard(rebuildFilters = true) {
    const records = getConsultationRecords();
    dashRows = toRows(records);
    renderSource(records);
    if (rebuildFilters) renderFilters();
    // 행사 섹션은 상담 기록이 없어도 표시 (같은 연도·학기 필터 사용)
    if (typeof renderEvents === 'function') renderEvents(dashFilters);
    const s = computeInsights(dashRows, dashFilters);
    const empty = document.getElementById('dash-empty');
    const content = document.getElementById('dash-content');
    if (!s.total) {
        empty.classList.remove('hidden');
        content.classList.add('hidden');
        return;
    }
    empty.classList.add('hidden');
    content.classList.remove('hidden');
    renderKpis(s);
    renderAlerts(s);
    renderTrend(s);
    renderRanked('c-reason', s.reason, 'visiting reason', 'visiting reason', { limit: 10 });
    renderRanked('c-level', s.level, 'academic level', 'academic level', { ordered: true });
    renderRanked('c-major', s.major, 'major', 'major', { limit: 10 });
    renderRanked('c-referral', s.referral, 'referral source', 'referral source', { limit: 6 });
    renderRanked('c-session', s.sessionType, 'session type', 'session type', { limit: 6 });
    renderRanked('c-counselor', s.counselor, 'counselor', 'counselor', { limit: 8 });
    renderRanked('c-weekday', s.weekday, 'weekday', 'date', { ordered: true });
    renderCompleteness(s);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        if (typeof Chart === 'undefined') {
            document.getElementById('dash-empty').classList.remove('hidden');
            document.getElementById('dash-empty').innerHTML = '<p class="text-[15px] text-rose-700 font-bold">Charts could not load (no internet connection to the chart library). Refresh the page to try again.</p>';
            return;
        }
        // 공유용 주소: dashboard.html?year=2026&term=Spring 처럼 필터를 미리 지정
        const params = new URLSearchParams(location.search);
        ['year', 'term', 'counselor'].forEach(k => { if (params.get(k)) dashFilters[k] = params.get(k); });
        renderDashboard();
    });
}

// node 테스트용
if (typeof module !== 'undefined') module.exports = { toRows, computeInsights, sparseYears, levelOf, reasonOf, sessionTypeOf, durationOf, followUpOf, referralOf };

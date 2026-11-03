// 대시보드 '행사' 섹션: CIDC 가 진행한 모든 행사 (기본 목록 또는 업로드한 행사 파일)
// 공통 도구(barChart, setTable, setText, esc, fmtInt, fmtPct, monthLabel)는 insights.js 에 있음
// 연도·학기 필터는 대시보드 상단 필터를 같이 사용하고, 행사 유형은 이 섹션에서 고름

let eventTypeFilter = 'All';

// 유형별 색 (고정 순서, 순위가 바뀌어도 같은 유형은 같은 색). 칩에는 항상 글자 이름이 함께 표시됨
const EVENT_TYPE_ORDER = ['Career Talk', 'Info Session', 'Boot Camp', 'Volunteer', 'Alumni Series'];
const EVENT_TYPE_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6', '#008300'];
const EVENT_OTHER_COLOR = '#94a3b8';
function eventTypeColor(type, allTypes) {
    if (type === 'Other') return EVENT_OTHER_COLOR;
    const known = EVENT_TYPE_ORDER.indexOf(type);
    if (known !== -1) return EVENT_TYPE_COLORS[known];
    const custom = allTypes.filter(t => t !== 'Other' && !EVENT_TYPE_ORDER.includes(t)).sort().indexOf(type);
    return EVENT_TYPE_COLORS[EVENT_TYPE_ORDER.length + custom] || EVENT_OTHER_COLOR;
}

// '2026-03-28' → 'Mar 28, 2026' / 기간은 'Oct 12–14, 2024', 'Nov 22 – 29, 2024', 'Mar 20 – Aug 20, 2026'
function fmtEventDate(start, end) {
    if (!start) return 'Date not recorded';
    const d = iso => { const [y, m, day] = iso.split('-').map(Number); return new Date(y, m - 1, day); };
    const s = d(start), e = d(end || start);
    const mon = x => x.toLocaleDateString('en-US', { month: 'short' });
    if (!end || end === start) return `${mon(s)} ${s.getDate()}, ${s.getFullYear()}`;
    if (s.getFullYear() !== e.getFullYear()) return `${mon(s)} ${s.getDate()}, ${s.getFullYear()} – ${mon(e)} ${e.getDate()}, ${e.getFullYear()}`;
    if (s.getMonth() === e.getMonth()) return `${mon(s)} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`;
    return `${mon(s)} ${s.getDate()} – ${mon(e)} ${e.getDate()}, ${s.getFullYear()}`;
}

function filterEvents(events, f, type) {
    return events.filter(e =>
        (!f.year || f.year === 'All' || e.year === f.year)
        && (!f.term || f.term === 'All' || (e.start && seasonOfDate(e.start) === f.term))
        && (!type || type === 'All' || e.type === type));
}

function eventStats(list) {
    const withAtt = list.filter(e => e.attendees !== null);
    const both = list.filter(e => e.attendees !== null && e.rsvp);
    const attendees = withAtt.reduce((s, e) => s + e.attendees, 0);
    const rsvp = both.reduce((s, e) => s + e.rsvp, 0);
    return {
        count: list.length,
        attendees,
        withAtt: withAtt.length,
        avg: withAtt.length ? attendees / withAtt.length : null,
        turnout: rsvp ? (both.reduce((s, e) => s + e.attendees, 0) / rsvp) * 100 : null,
        withBoth: both.length
    };
}

function renderEventSource(log) {
    const src = log.source || {};
    const when = src.uploadedAt
        ? new Date(src.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : (src.updated ? fmtEventDate(src.updated) : '');
    setText('e-source', `
        <i class="fa-solid fa-file-excel text-emerald-600 mr-1.5"></i>${log.builtIn ? 'Built-in list from' : 'Uploaded file'} <b>${esc(src.fileName || 'events file')}</b>${when ? ` · ${esc(when)}` : ''} · <b>${fmtInt(log.events.length)}</b> events
        ${log.builtIn ? '' : ' · <button onclick="resetEventsToBuiltIn()" class="text-blue-700 font-bold hover:underline">Use built-in list</button>'}`);
}

function renderEventKpis(st, total) {
    const tile = (label, value, hint, icon) => `
        <div class="bg-white border border-slate-200 rounded-2xl p-5 flex items-start justify-between gap-3">
            <div class="min-w-0">
                <span class="block text-[13px] font-bold text-slate-500">${label}</span>
                <span class="block text-[34px] leading-tight font-black text-slate-900 mt-1">${value}</span>
                <span class="block text-[13px] text-slate-500 mt-1">${hint}</span>
            </div>
            <div class="w-11 h-11 shrink-0 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center text-[18px]"><i class="fa-solid ${icon}"></i></div>
        </div>`;
    setText('e-kpis', [
        tile('Events held', fmtInt(st.count), st.count === total ? 'All events in the list' : `of ${fmtInt(total)} events in the list`, 'fa-calendar-check'),
        tile('Total attendees', fmtInt(st.attendees), st.withAtt ? `from ${fmtInt(st.withAtt)} event${st.withAtt === 1 ? '' : 's'} with attendance recorded` : 'No attendance recorded', 'fa-people-group'),
        tile('Average per event', st.avg !== null ? fmtInt(Math.round(st.avg)) : '–', st.withAtt ? 'attendees, among events with a count' : 'No attendance recorded', 'fa-user-check'),
        tile('RSVP → attended', fmtPct(st.turnout), st.withBoth ? `turnout across ${fmtInt(st.withBoth)} event${st.withBoth === 1 ? '' : 's'} with both numbers` : 'No events with both RSVP and attendance', 'fa-clipboard-check')
    ].join(''));
}

function renderEventTypeChips(inPeriod, allTypes) {
    const counts = {};
    inPeriod.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
    const types = [...EVENT_TYPE_ORDER, ...allTypes.filter(t => !EVENT_TYPE_ORDER.includes(t) && t !== 'Other').sort(), 'Other'].filter(t => counts[t]);
    if (eventTypeFilter !== 'All' && !counts[eventTypeFilter]) eventTypeFilter = 'All';
    const chip = (value, label, n, color) => {
        const on = eventTypeFilter === value;
        const arg = encodeURIComponent(value).replace(/'/g, '%27');
        return `<button onclick="setEventType(decodeURIComponent('${arg}'))" class="inline-flex items-center gap-2 border px-3.5 py-2 rounded-full text-[14px] font-bold transition-colors ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'}">
            ${color ? `<span class="w-2.5 h-2.5 rounded-full" style="background:${color}"></span>` : ''}${esc(label)}
            <span class="text-[12px] font-black px-1.5 rounded-full ${on ? 'bg-white/20' : 'bg-slate-100'}">${n}</span></button>`;
    };
    setText('e-types', chip('All', 'All types', inPeriod.length, null) + types.map(t => chip(t, t, counts[t], eventTypeColor(t, allTypes))).join(''));
}

function setEventType(type) {
    eventTypeFilter = type;
    renderEvents(dashFilters);
}

function renderEventCharts(list, f) {
    // 연도를 고르지 않았으면 '연도별', 골랐으면 그 해 '월별' (막대 1개짜리 차트 방지)
    if (!f.year || f.year === 'All') {
        const years = [...new Set(list.map(e => e.year).filter(Boolean))].sort();
        const counts = years.map(y => list.filter(e => e.year === y).length);
        const att = years.map(y => list.filter(e => e.year === y && e.attendees !== null).reduce((s, e) => s + e.attendees, 0));
        setText('e-period-title', 'Events per year');
        barChart('e-period', years, counts, { unit: 'event', share: false, extra: i => `${fmtInt(att[i])} attendees recorded` });
        setTable('e-period', 'Year', years.map((y, i) => [y, counts[i]]));
        const top = counts.length ? years[counts.indexOf(Math.max(...counts))] : null;
        setText('e-period-lead', top ? `<b>${esc(top)}</b> had the most events (${fmtInt(Math.max(...counts))}).` : 'No dated events.');
    } else {
        const months = Array.from({ length: 12 }, (_, i) => `${f.year}-${String(i + 1).padStart(2, '0')}`);
        const counts = months.map(m => list.filter(e => (e.start || '').startsWith(m)).length);
        setText('e-period-title', `Events per month in ${esc(f.year)}`);
        barChart('e-period', months.map(m => monthLabel(m, false)), counts, { unit: 'event', share: false });
        setTable('e-period', 'Month', months.map((m, i) => [monthLabel(m, true, 'long'), counts[i]]));
        const max = Math.max(...counts);
        setText('e-period-lead', max ? `Busiest month: <b>${monthLabel(months[counts.indexOf(max)], true, 'long')}</b> with ${fmtInt(max)} event${max === 1 ? '' : 's'}.` : 'No events in this selection.');
    }

    // 유형별 행사 수 (툴팁에 평균 참석자)
    const typeCounts = {};
    list.forEach(e => { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; });
    const types = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const avgFor = t => { const w = list.filter(e => e.type === t && e.attendees !== null); return w.length ? Math.round(w.reduce((s, e) => s + e.attendees, 0) / w.length) : null; };
    barChart('e-type', types.map(([t]) => t), types.map(([, n]) => n), {
        horizontal: true, unit: 'event', height: Math.max(150, types.length * 36 + 30),
        extra: i => { const a = avgFor(types[i][0]); return a !== null ? `avg ${fmtInt(a)} attendees` : 'attendance not recorded'; }
    });
    setTable('e-type', 'Event type', types);
    // 요약 문장은 'Other' 대신 이름이 있는 유형 기준 (같은 수면 함께 표시)
    const named = types.filter(([t]) => t !== 'Other');
    let typeLead = 'No events in this selection.';
    if (named.length) {
        const leaders = named.filter(([, n]) => n === named[0][1]).map(([t]) => `<b>${esc(t)}</b>`);
        const joined = leaders.length > 1 ? `${leaders.slice(0, -1).join(', ')} and ${leaders[leaders.length - 1]}` : leaders[0];
        typeLead = `${joined} ${leaders.length > 1 ? 'are the most common types' : 'is the most common type'} (${fmtInt(named[0][1])}${leaders.length > 1 ? ' each' : ''} of ${fmtInt(list.length)}).`;
        if (typeCounts.Other) typeLead += ` ${fmtInt(typeCounts.Other)} are listed as Other.`;
    } else if (types.length) {
        typeLead = `All ${fmtInt(list.length)} events are listed as Other.`;
    }
    setText('e-type-lead', typeLead);

    // 참석자가 많았던 행사 상위 10
    const top = list.filter(e => e.attendees !== null).sort((a, b) => b.attendees - a.attendees).slice(0, 10);
    const short = s => (s.length > 34 ? `${s.slice(0, 33)}…` : s);
    const topBox = document.getElementById('e-top')?.parentElement;
    if (topBox) topBox.classList.toggle('hidden', !top.length);
    if (top.length) {
        barChart('e-top', top.map(e => short(e.name)), top.map(e => e.attendees), {
            horizontal: true, unit: 'attendee', share: false, height: Math.max(150, top.length * 34 + 30),
            extra: i => `${top[i].name} · ${fmtEventDate(top[i].start, top[i].end)}${top[i].rsvp ? ` · ${fmtInt(top[i].rsvp)} RSVP` : ''}`
        });
        setTable('e-top', 'Event', top.map(e => [`${e.name} (${fmtEventDate(e.start, e.end)})`, e.attendees]));
        setText('e-top-lead', `<b>${esc(top[0].name)}</b> drew the most people — ${fmtInt(top[0].attendees)} attendees.`);
    } else {
        setText('e-top-lead', 'No attendance is recorded for the events in this selection.');
    }
}

function renderEventList(list, allTypes) {
    const box = document.getElementById('e-list');
    if (!list.length) { box.innerHTML = '<p class="text-[15px] text-slate-500 py-6 text-center">No events in this selection.</p>'; return; }
    const years = [...new Set(list.map(e => e.year || 'No date'))];
    box.innerHTML = years.map(y => {
        const items = list.filter(e => (e.year || 'No date') === y);
        const st = eventStats(items);
        return `
        <div>
            <div class="flex items-baseline justify-between gap-3 sticky top-0 bg-white py-2 z-10 border-b border-slate-200">
                <h3 class="text-[18px] font-black text-slate-900">${esc(y)}</h3>
                <span class="text-[13px] text-slate-500">${fmtInt(items.length)} event${items.length === 1 ? '' : 's'} · ${fmtInt(st.attendees)} attendees recorded</span>
            </div>
            <div class="divide-y divide-slate-100">
            ${items.map(e => {
                const color = eventTypeColor(e.type, allTypes);
                const [, m, d] = (e.start || '--').split('-');
                const mon = e.start ? new Date(Number(e.start.slice(0, 4)), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short' }) : '–';
                const turnout = e.rsvp && e.attendees !== null ? Math.min(100, (e.attendees / e.rsvp) * 100) : null;
                return `
                <div class="grid grid-cols-[56px_1fr] sm:grid-cols-[56px_1fr_210px] gap-x-4 gap-y-2 items-center py-3">
                    <div class="text-center rounded-xl border border-slate-200 bg-slate-50 py-1.5">
                        <span class="block text-[11px] font-black uppercase text-slate-500">${esc(mon)}</span>
                        <span class="block text-[20px] leading-none font-black text-slate-900">${e.start ? Number(d) : '?'}</span>
                    </div>
                    <div class="min-w-0">
                        <p class="text-[15px] font-bold text-slate-900 leading-snug">${esc(e.name)}</p>
                        <p class="text-[13px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span class="inline-flex items-center gap-1.5 font-bold text-slate-700"><span class="w-2 h-2 rounded-full" style="background:${color}"></span>${esc(e.type)}</span>
                            <span>${esc(fmtEventDate(e.start, e.end))}</span>
                            ${e.note ? `<span class="text-slate-400">· ${esc(e.note)}</span>` : ''}
                        </p>
                    </div>
                    <div class="col-span-2 sm:col-span-1 sm:text-right">
                        ${e.attendees !== null
                            ? `<span class="text-[18px] font-black text-slate-900">${fmtInt(e.attendees)}</span> <span class="text-[13px] text-slate-500">attended</span>`
                            : (e.rsvp ? `<span class="text-[15px] font-bold text-slate-700">${fmtInt(e.rsvp)}</span> <span class="text-[13px] text-slate-500">RSVP · attendance not recorded</span>` : '<span class="text-[13px] text-slate-400">Attendance not recorded</span>')}
                        ${turnout !== null ? `
                        <div class="mt-1 flex items-center gap-2 sm:justify-end" title="${fmtInt(e.attendees)} of ${fmtInt(e.rsvp)} RSVP attended">
                            <div class="h-1.5 w-24 bg-slate-100 rounded-full overflow-hidden"><div class="h-full bg-indigo-500 rounded-full" style="width:${turnout.toFixed(0)}%"></div></div>
                            <span class="text-[12px] text-slate-500 whitespace-nowrap">${fmtPct(turnout)} of ${fmtInt(e.rsvp)} RSVP</span>
                        </div>` : ''}
                    </div>
                </div>`;
            }).join('')}
            </div>
        </div>`;
    }).join('');
}

function renderEvents(f) {
    const log = getEventLog();
    const allTypes = [...new Set(log.events.map(e => e.type))];
    renderEventSource(log);
    const inPeriod = filterEvents(log.events, f, 'All');
    renderEventTypeChips(inPeriod, allTypes);
    const list = filterEvents(log.events, f, eventTypeFilter);
    renderEventKpis(eventStats(list), log.events.length);
    const empty = !list.length;
    document.getElementById('e-body').classList.toggle('hidden', empty);
    document.getElementById('e-empty').classList.toggle('hidden', !empty);
    if (empty) return;
    renderEventCharts(list, f);
    renderEventList(list, allTypes);
}

// 새 행사 파일 올리기: 이 브라우저에서 기본 목록 대신 사용
function handleEventsUpload(evt) {
    const file = evt.target.files[0];
    evt.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        let parsed;
        try { parsed = parseEventsWorkbook(XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true })); }
        catch (err) { showEventsMessage(`"${file.name}" couldn't be opened as a spreadsheet. Please upload an .xlsx, .xls or .csv file.`, true); return; }
        if (!parsed.found || !parsed.events.length) {
            showEventsMessage(`No events found in "${file.name}". The sheet needs an "Event Name" column and a "Date" column.`, true);
            return;
        }
        window.dbState.eventLog = parsed.events;
        window.dbState.eventLogSource = { fileName: file.name, uploadedAt: new Date().toISOString(), count: parsed.events.length };
        window.saveStateToStorage();
        eventTypeFilter = 'All';
        renderDashboard(true);
        showEventsMessage(`Updated to "${file.name}": ${parsed.events.length} events.`, false);
    };
    reader.readAsArrayBuffer(file);
}

function resetEventsToBuiltIn() {
    delete window.dbState.eventLog;
    delete window.dbState.eventLogSource;
    window.saveStateToStorage();
    eventTypeFilter = 'All';
    renderDashboard(true);
    showEventsMessage('Back to the built-in event list.', false);
}

function showEventsMessage(text, isError) {
    const box = document.getElementById('e-message');
    box.className = `rounded-2xl px-5 py-3 text-[14px] font-semibold border ${isError ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`;
    box.innerHTML = `<i class="fa-solid ${isError ? 'fa-triangle-exclamation' : 'fa-circle-check'} mr-2"></i>${esc(text)}`;
    clearTimeout(showEventsMessage.timer);
    showEventsMessage.timer = setTimeout(() => box.classList.add('hidden'), 8000);
}

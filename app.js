const els = {
  screenFile: document.getElementById('screenFile'),
  sleepFile: document.getElementById('sleepFile'),
  weeklyKpis: document.getElementById('weeklyKpis'),
  weeklyNotes: document.getElementById('weeklyNotes'),
  dailyTbody: document.querySelector('#dailyTable tbody'),
  rangePill: document.getElementById('rangePill'),
  errorBox: document.getElementById('errorBox'),
  demoBtn: document.getElementById('demoBtn'),
  clearBtn: document.getElementById('clearBtn'),
  screenChart: document.getElementById('screenChart'),
  screenChartNote: document.getElementById('screenChartNote'),
  loadCard: document.getElementById('loadCard'),
};

let state = {
  screen: [], // {date: Date, minutes: number}
  sleep: [],  // {date: Date, sleepMinOfDay: number, wakeMinOfDay: number, durationMin: number}
};

function showError(msg) {
  if (!msg) {
    els.errorBox.hidden = true;
    els.errorBox.textContent = '';
    return;
  }
  els.errorBox.hidden = false;
  els.errorBox.textContent = msg;
}

function parseCSV(text) {
  // Minimal CSV parser: supports commas + quotes.
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }

    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field.trim()); field = ''; i++; continue; }
    if (ch === '\n') { row.push(field.trim()); rows.push(row); row = []; field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field.trim()); rows.push(row); }

  // Drop empty trailing lines
  return rows.filter(r => r.some(x => (x ?? '').toString().trim() !== ''));
}

function parseUSDate(s) {
  // Supports M/D/YYYY or MM/DD/YYYY
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(String(s || ''));
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  const yyyy = Number(m[3]);
  const d = new Date(yyyy, mm - 1, dd);
  // Validate round-trip
  if (d.getFullYear() !== yyyy || d.getMonth() !== (mm - 1) || d.getDate() !== dd) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function minutesToHM(min) {
  if (!Number.isFinite(min)) return '—';
  const sign = min < 0 ? '-' : '';
  min = Math.abs(Math.round(min));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${sign}${h}:${String(m).padStart(2, '0')}`;
}

function minutesToClock(minOfDay) {
  if (!Number.isFinite(minOfDay)) return '—';
  const m = ((Math.round(minOfDay) % 1440) + 1440) % 1440;
  let hh = Math.floor(m / 60);
  const mm = m % 60;
  const suffix = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${String(mm).padStart(2,'0')} ${suffix}`;
}

function parseTimeToMinutesOfDay(s) {
  // Accepts:
  // - 23:15
  // - 7:05
  // - 7:05 PM / 7:05PM / 7 PM
  // - 07:05 am
  const str = String(s || '').trim();
  if (!str) return null;

  // 24-hour HH:MM
  let m = /^\s*(\d{1,2})\s*:\s*(\d{2})\s*$/.exec(str);
  if (m) {
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
  }

  // 12-hour with AM/PM, minutes optional
  m = /^\s*(\d{1,2})(?:\s*:\s*(\d{2}))?\s*([AaPp][Mm])\s*$/.exec(str);
  if (m) {
    let hh = Number(m[1]);
    const mm = m[2] ? Number(m[2]) : 0;
    const ap = m[3].toUpperCase();
    if (hh < 1 || hh > 12 || mm < 0 || mm > 59) return null;
    if (ap === 'AM') {
      if (hh === 12) hh = 0;
    } else {
      if (hh !== 12) hh += 12;
    }
    return hh * 60 + mm;
  }

  return null;
}

function parseDurationToMinutes(s) {
  // For screen time values like 5:26 meaning 5h26m
  // Accepts H:MM or HH:MM
  const m = /^\s*(\d+)\s*:\s*(\d{2})\s*$/.exec(String(s || ''));
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function loadScreenCSV(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) throw new Error('screen_time.csv: expected a header row and at least 1 data row.');

  const header = rows[0].map(normalizeHeader);
  const idxDate = header.indexOf('date');
  const idxTime = header.indexOf('screen time');
  if (idxDate === -1 || idxTime === -1) {
    throw new Error('screen_time.csv: expected headers: Date, Screen Time');
  }

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const date = parseUSDate(rows[r][idxDate]);
    const minutes = parseDurationToMinutes(rows[r][idxTime]);
    if (!date || minutes == null) continue;
    out.push({ date, minutes });
  }
  return out;
}

function loadSleepCSV(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) throw new Error('sleep.csv: expected a header row and at least 1 data row.');

  const header = rows[0].map(normalizeHeader);
  const idxDate = header.indexOf('date');
  // allow multiple header spellings
  const idxSleep = header.indexOf('sleep') !== -1 ? header.indexOf('sleep') : header.indexOf('sleep time');
  const idxWake  = header.indexOf('wake')  !== -1 ? header.indexOf('wake')  : header.indexOf('wake time');

  if (idxDate === -1 || idxSleep === -1 || idxWake === -1) {
    throw new Error('sleep.csv: expected headers: Date, Sleep (or Sleep Time), Wake (or Wake Time)');
  }

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const date = parseUSDate(rows[r][idxDate]);
    const sleepMin = parseTimeToMinutesOfDay(rows[r][idxSleep]);
    const wakeMin = parseTimeToMinutesOfDay(rows[r][idxWake]);
    if (!date || sleepMin == null || wakeMin == null) continue;

        // Compute duration. Date column = wake date, so use it directly.
    let dur = wakeMin - sleepMin;

    // If sleep time is before midnight (e.g. 23:42), dur will be negative.
    // Add 24h to get the correct duration — but the date stays the same.
    if (dur <= 0) {
      dur += 1440;
    }

    // Bed date: if sleep was before midnight, bed was the previous calendar day.
    const bedDate = new Date(date);
    if (sleepMin >= wakeMin) {
      bedDate.setDate(bedDate.getDate() - 1);
    }

    out.push({
      date: date,              // <-- CSV date is the wake date, use as-is
      bedDate: bedDate,        // computed: the calendar day they went to bed
      sleepMinOfDay: sleepMin,
      wakeMinOfDay: wakeMin,
      durationMin: dur
    });
  }
  return out;
}

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDate(d) {
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function maxDate(arr) {
  if (!arr.length) return null;
  return new Date(Math.max(...arr.map(x => x.date.getTime())));
}

function buildRange(endDate, days) {
  const end = new Date(endDate);
  end.setHours(0,0,0,0);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0,0,0,0);
  return { start, end };
}

function inRange(d, start, end) {
  const t = d.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function byDateMap(arr, valueFn) {
  const m = new Map();
  for (const x of arr) {
    m.set(dateKey(x.date), valueFn(x));
  }
  return m;
}

function avg(nums) {
  const v = nums.filter(n => Number.isFinite(n));
  if (!v.length) return null;
  return v.reduce((a,b) => a+b, 0) / v.length;
}

function avgBedtime(mins) {
  // Circular average for bedtimes that cluster around midnight.
  // Shift so that times after noon are treated as negative (before midnight).
  const v = mins.filter(n => Number.isFinite(n));
  if (!v.length) return null;
  const shifted = v.map(m => m >= 720 ? m - 1440 : m);  // e.g. 23:42 (1422) → -18
  const mean = shifted.reduce((a, b) => a + b, 0) / shifted.length;
  return ((mean % 1440) + 1440) % 1440;  // wrap back to 0–1439
}

function minMax(nums) {
  const v = nums.filter(n => Number.isFinite(n));
  if (!v.length) return { min: null, max: null };
  return { min: Math.min(...v), max: Math.max(...v) };
}

function sum(nums) {
  const v = nums.filter(n => Number.isFinite(n));
  return v.reduce((a,b) => a+b, 0);
}

function renderKpis(container, kpis) {
  container.innerHTML = '';
  for (const k of kpis) {
    const div = document.createElement('div');
    div.className = 'kpi';
    div.innerHTML = `<div class="label">${escapeHtml(k.label)}</div><div class="value">${escapeHtml(k.value)}</div>`;
    container.appendChild(div);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function render() {
  showError('');

  const bothLoaded = state.screen.length > 0 && state.sleep.length > 0;
  els.loadCard.hidden = bothLoaded;

  const anyData = state.screen.length || state.sleep.length;
  if (!anyData) {
    els.rangePill.textContent = 'No data loaded';
    els.weeklyKpis.innerHTML = '';
    els.weeklyNotes.textContent = '';
    els.dailyTbody.innerHTML = '';
    return;
  }

  // Choose an "end date" anchored to the most recent date in either dataset.
  const end = maxDate([...state.screen, ...state.sleep].map(x => ({date: x.date}))) || new Date();
  const { start: weekStart, end: weekEnd } = buildRange(end, 7);

  els.rangePill.textContent = `Weekly window: ${formatDate(weekStart)} – ${formatDate(weekEnd)}`;

  const weekly = computeStats(weekStart, weekEnd);

  renderKpis(els.weeklyKpis, weekly.kpis);

  els.weeklyNotes.textContent = weekly.notes;

  renderDailyTable(weekStart, weekEnd);

  renderScreenBarChart(weekStart, weekEnd);
}

function computeStats(rangeStart, rangeEnd) {
  const screen = rangeStart ? state.screen.filter(x => inRange(x.date, rangeStart, rangeEnd)) : state.screen;
  const sleep  = rangeStart ? state.sleep.filter(x => inRange(x.date, rangeStart, rangeEnd))  : state.sleep;

  const screenMinutes = screen.map(x => x.minutes);
  const sleepMinutes  = sleep.map(x => x.durationMin);
  const bedTimes      = sleep.map(x => x.sleepMinOfDay);
  const wakeTimes     = sleep.map(x => x.wakeMinOfDay);

  const screenDays = screen.length;
  const sleepDays  = sleep.length;

  const { min: minSleep, max: maxSleep } = minMax(sleepMinutes);
  const { min: minScreen, max: maxScreen } = minMax(screenMinutes);

  const kpis = [
    {
      label: `Sleep avg / day (${sleepDays} days)`,
      value: sleepDays ? minutesToHM(avg(sleepMinutes)) : '—',
    },
    {
      label: `Screen avg / day (${screenDays} days)`,
      value: screenDays ? minutesToHM(avg(screenMinutes)) : '—',
    },
    {
      label: `Best / worst sleep`,
      value: (minSleep != null) ? `${minutesToHM(maxSleep)} / ${minutesToHM(minSleep)}` : '—',
    },
    {
      label: `Avg bedtime`,
      value: bedTimes.length ? minutesToClock(avgBedtime(bedTimes)) : '—',
    },
    {
      label: `Avg wake time`,
      value: wakeTimes.length ? minutesToClock(avg(wakeTimes)) : '—',
    },
    {
      label: `Screen total`,
      value: screenDays ? minutesToHM(sum(screenMinutes)) : '—',
    },
  ];

  let notes = '';
  if (!sleepDays) notes += 'No sleep entries found for this range. '; 
  if (!screenDays) notes += 'No screen time entries found for this range. '; 
  // if (sleepDays && screenDays) notes += 'Tip: You can spot tradeoffs by comparing sleep avg/day vs screen avg/day.';

  return { kpis, notes: notes.trim() };
}

function renderDailyTable(rangeStart, rangeEnd) {
  const keys = [];
  const d = new Date(rangeStart);
  d.setHours(0,0,0,0);
  while (d.getTime() <= rangeEnd.getTime()) {
    keys.push(dateKey(d));
    d.setDate(d.getDate() + 1);
  }

  const sleepMap = byDateMap(state.sleep, x => x);
  const screenMap = byDateMap(state.screen, x => x);

  // Collect values for min/max detection
  const sleepVals = [];
  const screenVals = [];
  for (const k of keys) {
    const s = sleepMap.get(k);
    const sc = screenMap.get(k);
    if (s) sleepVals.push(s.durationMin);
    if (sc) screenVals.push(sc.minutes);
  }
  const { min: minSleep, max: maxSleep } = minMax(sleepVals);
  const { min: minScreen, max: maxScreen } = minMax(screenVals);

  els.dailyTbody.innerHTML = '';
  for (const k of keys) {
    const [yyyy, mm, dd] = k.split('-').map(Number);
    const date = new Date(yyyy, mm - 1, dd);

    const s = sleepMap.get(k);
    const sc = screenMap.get(k);

    const sleepClass = s ? (s.durationMin === maxSleep ? ' class="cell-max"' : s.durationMin === minSleep ? ' class="cell-min"' : '') : '';
    const screenClass = sc ? (sc.minutes === minScreen ? ' class="cell-max"' : sc.minutes === maxScreen ? ' class="cell-min"' : '') : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(formatDate(date))}</td>
      <td${sleepClass}>${escapeHtml(s ? minutesToHM(s.durationMin) : '—')}</td>
      <td>${escapeHtml(s ? minutesToClock(s.sleepMinOfDay) : '—')}</td>
      <td>${escapeHtml(s ? minutesToClock(s.wakeMinOfDay) : '—')}</td>
      <td${screenClass}>${escapeHtml(sc ? minutesToHM(sc.minutes) : '—')}</td>
    `;
    els.dailyTbody.appendChild(tr);
  }
}

async function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

async function handleFilesChanged() {
  showError('');
  try {
    if (els.screenFile.files?.[0]) {
      const text = await readFileText(els.screenFile.files[0]);
      state.screen = loadScreenCSV(text);
    }
    if (els.sleepFile.files?.[0]) {
      const text = await readFileText(els.sleepFile.files[0]);
      state.sleep = loadSleepCSV(text);
    }

    // Sort by date
    state.screen.sort((a,b) => a.date - b.date);
    state.sleep.sort((a,b) => a.date - b.date);

    render();
  } catch (e) {
    showError(String(e?.message || e));
  }
}

function loadDemo() {
  // Demo data anchored to recent-ish dates so the weekly view shows something.
  const base = new Date();
  base.setHours(0,0,0,0);
  base.setDate(base.getDate() - 9);

  const screenRows = [['Date','Screen Time']];
  const sleepRows = [['Date','Sleep','Wake']];

  for (let i = 0; i < 10; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const mm = d.getMonth()+1;
    const dd = d.getDate();
    const yyyy = d.getFullYear();
    const ds = `${mm}/${dd}/${yyyy}`;

    // Screen: 2:30 - 6:15
    const screenMin = 150 + (i*23 % 225);
    screenRows.push([ds, minutesToHM(screenMin)]);

    // Sleep: bed 10:30pm-12:15am, wake 6:15-8:10
    const bed = 22*60 + 30 + (i*7 % 90);
    const wake = 6*60 + 45 + (i*11 % 85);
    // Store as 24h HH:MM
    const bedHH = Math.floor(bed/60)%24;
    const bedMM = bed%60;
    const wakeHH = Math.floor(wake/60)%24;
    const wakeMM = wake%60;
    sleepRows.push([ds, `${bedHH}:${String(bedMM).padStart(2,'0')}`, `${wakeHH}:${String(wakeMM).padStart(2,'0')}`]);
  }

  const toCsv = (rows) => rows.map(r => r.map(x => {
    const s = String(x ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(',')).join('\n');

  state.screen = loadScreenCSV(toCsv(screenRows));
  state.sleep  = loadSleepCSV(toCsv(sleepRows));

  render();
}

function clearAll() {
  state.screen = [];
  state.sleep = [];
  els.screenFile.value = '';
  els.sleepFile.value = '';
  render();
}

function renderScreenBarChart(rangeStart, rangeEnd) {
  const canvas = els.screenChart;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Build a 7-day key list
  const keys = [];
  const d = new Date(rangeStart);
  d.setHours(0,0,0,0);
  while (d.getTime() <= rangeEnd.getTime()) {
    keys.push(dateKey(d));
    d.setDate(d.getDate() + 1);
  }

  const screenMap = byDateMap(state.screen, x => x.minutes);
  const values = keys.map(k => screenMap.get(k) ?? 0);

  const maxVal = 480; // fixed 8 hours
  const padL = 46, padR = 16, padT = 16, padB = 44;

  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Background grid
  ctx.globalAlpha = 1;
  ctx.font = '12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;

  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Y-axis ticks (0, 25, 50, 75, 100% of max)
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const t = i / ticks;
    const y = padT + plotH - t * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();

    const labelMin = Math.round(t * maxVal);
    ctx.fillText(minutesToHM(labelMin), 8, y + 4);
  }

  // Bars
  const n = values.length;
  const gap = Math.max(6, Math.floor(plotW * 0.02));
  const barW = Math.floor((plotW - gap * (n - 1)) / n);

  for (let i = 0; i < n; i++) {
    const v = values[i];
    const h = (v / maxVal) * plotH;
    const x = padL + i * (barW + gap);
    const y = padT + (plotH - h);

    // Gradient fill per bar
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, 'rgba(96,165,250,0.65)');
    grad.addColorStop(1, 'rgba(96,165,250,0.15)');
    ctx.fillStyle = grad;
    ctx.strokeStyle = 'rgba(96,165,250,0.35)';

    // Rounded top corners only
    const r = 10;
    roundRect(ctx, x, y, barW, h, r);
    ctx.fill();
    ctx.stroke();

    // X label (M/D)
    const [yyyy, mm, dd] = keys[i].split('-').map(Number);
    const label = `${mm}/${dd}`;
    const tx = x + Math.floor(barW / 2) - ctx.measureText(label).width / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.70)';
    ctx.fillText(label, tx, H - 16);
  }

  // Note
  const total = sum(values);
    els.screenChartNote.textContent =
      `Total: ${minutesToHM(total)} hours`;
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

els.screenFile.addEventListener('change', handleFilesChanged);
els.sleepFile.addEventListener('change', handleFilesChanged);
els.demoBtn.addEventListener('click', loadDemo);
els.clearBtn.addEventListener('click', clearAll);

render();
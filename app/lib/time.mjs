// Datas e fusos. Toda data "do dia" (YYYY-MM-DD) é no fuso da república.
const dtfCache = new Map();
function dtf(tz) {
  if (!dtfCache.has(tz)) {
    dtfCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return dtfCache.get(tz);
}

export function isValidTz(tz) {
  try { dtf(tz); return true; } catch { return false; }
}

function partsOf(utcMs, tz) {
  const m = {};
  for (const p of dtf(tz).formatToParts(new Date(utcMs))) m[p.type] = p.value;
  return m;
}

function offsetMs(tz, utcMs) {
  const m = partsOf(utcMs, tz);
  const asUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour % 24, +m.minute, +m.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// Instante UTC -> { date: 'YYYY-MM-DD', time: 'HH:MM' } no fuso da casa
export function localNow(tz, utcMs = Date.now()) {
  const m = partsOf(utcMs, tz);
  return { date: `${m.year}-${m.month}-${m.day}`, time: `${m.hour}:${m.minute}` };
}

// 'YYYY-MM-DD' + 'HH:MM' no fuso da casa -> instante UTC (ms). Aceita '24:00'.
export function zonedToUtc(dateStr, timeStr, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = (timeStr || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = offsetMs(tz, guess);
  let ts = guess - off;
  const off2 = offsetMs(tz, ts);
  if (off2 !== off) ts = guess - off2;
  return ts;
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a, b) { // b - a em dias
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function weekday(dateStr) { // 0 = domingo
  return new Date(dateStr + 'T00:00:00Z').getUTCDay();
}

export function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)); }
export function isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(s); }

export const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const WEEKDAYS_SHORT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function fmtHour(t) {
  const [h, m] = t.split(':');
  return m === '00' ? `${+h}h` : `${+h}h${m}`;
}

// "até 00h de terça-feira" para a louça de segunda (prazo 24:00)
export function deadlineLabel(dateStr, timeStr) {
  if (timeStr === '24:00') return `até 00h de ${WEEKDAYS[weekday(addDays(dateStr, 1))]}`;
  return `até ${fmtHour(timeStr)} de ${WEEKDAYS[weekday(dateStr)]}`;
}

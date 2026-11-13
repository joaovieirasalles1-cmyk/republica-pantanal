// Escala: calcula as ocorrências previstas de cada tarefa sem precisar gerar linhas no banco.
// O rodízio avança por ocorrência prevista: a N-ésima ocorrência é de rotation[N % tamanho],
// independente de a anterior ter sido concluída.
import { all, one } from './db.mjs';
import { addDays, diffDays, weekday, zonedToUtc } from './time.mjs';

const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

export function occursOn(task, date) {
  if (date < task.start_date) return false;
  if (task.end_date && date > task.end_date) return false;
  switch (task.recurrence) {
    case 'once': return date === task.start_date;
    case 'daily': return true;
    case 'weekdays': return parse(task.weekdays, []).includes(weekday(date));
    case 'weekly': return weekday(date) === weekday(task.start_date);
    default: return false;
  }
}

// Quantas ocorrências previstas existem antes de `date` (desde o início da tarefa)
export function occurrenceIndex(task, date) {
  const days = diffDays(task.start_date, date);
  let n = 0;
  switch (task.recurrence) {
    case 'once': n = 0; break;
    case 'daily': n = days; break;
    case 'weekly': n = Math.floor(days / 7); break;
    case 'weekdays': {
      const wd = new Set(parse(task.weekdays, []));
      const full = Math.floor(days / 7);
      n = full * wd.size;
      for (let i = full * 7; i < days; i++) if (wd.has(weekday(addDays(task.start_date, i)))) n++;
      break;
    }
  }
  return n + (task.rotation_offset || 0);
}

export function baseAssignee(task, date) {
  if (task.assign_mode === 'fixed') return task.fixed_member_id;
  const rot = parse(task.rotation, []);
  if (!rot.length) return null;
  return rot[occurrenceIndex(task, date) % rot.length];
}

export function instanceStatus(inst, now = Date.now()) {
  if (inst.completion) return inst.completion.completed_at > inst.due_ts ? 'concluida_atrasada' : 'concluida';
  return now > inst.due_ts ? 'atrasada' : 'pendente';
}

function build(task, date, ov, comp, tz) {
  const due_time = ov?.due_time || task.due_time;
  const inst = {
    task_id: task.id, date, name: task.name, environment_id: task.environment_id,
    due_time, due_ts: zonedToUtc(date, due_time, tz),
    assignee: ov?.assignee_member_id ?? baseAssignee(task, date),
    swapped: !!ov?.assignee_member_id,
    require_photo: !!task.require_photo, recurrence: task.recurrence,
    completion: comp || null,
  };
  inst.status = instanceStatus(inst);
  return inst;
}

// Todas as ocorrências da casa entre `from` e `to` (inclusive)
export async function instancesInRange(house, from, to) {
  const tasks = await all('SELECT * FROM tasks WHERE house_id = ? AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)', house.id, to, from);
  if (!tasks.length) return [];
  const ids = tasks.map(t => t.id).join(',');
  const ovs = new Map((await all(`SELECT * FROM task_overrides WHERE task_id IN (${ids}) AND date BETWEEN ? AND ?`, from, to)).map(o => [o.task_id + '|' + o.date, o]));
  const comps = new Map((await all(`SELECT * FROM task_completions WHERE task_id IN (${ids}) AND date BETWEEN ? AND ?`, from, to)).map(c => [c.task_id + '|' + c.date, c]));
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const t of tasks) {
      if (!occursOn(t, d)) continue;
      const k = t.id + '|' + d;
      const ov = ovs.get(k);
      if (ov?.skipped) continue;
      out.push(build(t, d, ov, comps.get(k), house.timezone));
    }
  }
  out.sort((a, b) => a.due_ts - b.due_ts);
  return out;
}

export async function getInstance(house, taskId, date) {
  const t = await one('SELECT * FROM tasks WHERE id = ? AND house_id = ?', taskId, house.id);
  if (!t || !occursOn(t, date)) return null;
  const ov = await one('SELECT * FROM task_overrides WHERE task_id = ? AND date = ?', t.id, date);
  if (ov?.skipped) return null;
  const comp = await one('SELECT * FROM task_completions WHERE task_id = ? AND date = ?', t.id, date);
  return { ...build(t, date, ov, comp, house.timezone), task: t };
}

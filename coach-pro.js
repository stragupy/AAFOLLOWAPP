/* Uses AA Follow's existing DB, dates, routines and authentication state. */
window.CoachPro = (() => {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const list = key => { const value = DB.get(key); return Array.isArray(value) ? value : []; };
  const num = value => Number.isFinite(+value) ? +value : 0;
  const optionalNumber = value => value === '' || value == null ? null : num(value);
  const now = () => new Date().toISOString();
  const norm = value => String(value || '').trim().toLocaleLowerCase('es').replace(/\s+/g, ' ');
  const n = (value, digits = 1) => num(value).toLocaleString('es-AR', { maximumFractionDigits: digits });
  const delta = value => `${value > 0 ? '+' : ''}${n(value)}`;
  const stamp = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const journalStatus = value => ({ done: 'Resuelta', pending: 'Pendiente', observation: 'Observación' })[value] || value || '';
  const el = id => document.getElementById(id);
  const val = id => el(id)?.value || '';
  const safe = esc;
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const button = (action, label, data = '', style = '') => `<button type="button" class="${style}" data-cp-action="${action}" ${data}>${label}</button>`;
  const idAttr = id => `data-id="${safe(id)}"`;
  const empty = message => `<div class="cp-empty">${safe(message)}</div>`;
  const tag = (text, tone = '') => `<span class="cp-tag ${tone}">${safe(text)}</span>`;
  const field = (label, id, value = '', type = 'text', attributes = '') => `<label>${label}<input id="${id}" type="${type}" value="${safe(value)}" ${attributes}></label>`;
  const area = (label, id, value = '') => `<label>${label}<textarea id="${id}" maxlength="5000">${safe(value)}</textarea></label>`;
  const section = (title, content) => `<section class="cp-band"><h3>${safe(title)}</h3>${content}</section>`;
  const head = (title, text, actions = '') => `<div class="cp-head"><div><h2>${safe(title)}</h2><p>${safe(text)}</p></div><div class="cp-tools">${actions}</div></div>`;
  const form = (name, content) => `<form data-cp-form="${name}">${content}</form>`;
  const put = (key, item) => {
    const rows = list(key);
    const index = rows.findIndex(row => row.id === item.id);
    if (index < 0) rows.unshift(item); else rows[index] = item;
    DB.set(key, rows);
    return item;
  };
  const state = { week: '', day: '', plan: null, map: null, selectedNode: '', journalId: '', guidelineId: '', report: null };
  const week = () => state.week || weekValueFromDate(selectedDate());
  const weekDates = () => getWeekDates(week());
  const storageDrafts = () => DB.get('coach_workspace_drafts') || {};
  const draftKey = name => `${name}:${DB.get('activeUser') || ''}:${week()}`;
  const draft = name => storageDrafts()[draftKey(name)];
  function setDraft(name, data) {
    const drafts = storageDrafts();
    drafts[draftKey(name)] = clone(data);
    DB.set('coach_workspace_drafts', drafts);
  }
  function clearDraft(name) {
    const drafts = storageDrafts();
    delete drafts[draftKey(name)];
    DB.set('coach_workspace_drafts', drafts);
  }
  function redraw() { renderCoachWorkspace(); }
  function notify(message) { toast(message); }
  function protect() { if (!coachModeUnlocked) throw new Error('Abre Modo Coach para continuar.'); }
  function weekControl() {
    return `<div class="cp-tools">${button('previous-week', icon('chevron-left'), 'title="Semana anterior" aria-label="Semana anterior"', 'icon')}<label>Semana<input id="cp-week" type="week" value="${safe(week())}" data-cp-change="week"></label>${button('next-week', icon('chevron-right'), 'title="Semana siguiente" aria-label="Semana siguiente"', 'icon')}${button('current-week', 'Esta semana')}</div>`;
  }
  function changeWeek(value) {
    if (!/^\d{4}-W\d{2}$/.test(value) || weekValueFromDate(getWeekDates(value)[0]) !== value) return;
    state.week = value; state.day = ''; state.plan = null; state.report = null;
    state.anchor = getWeekDates(value)[0];
    if (el('global-date')) el('global-date').value = state.anchor;
    syncDateControls(state.anchor);
    redraw();
  }
  function savedPlan(value = week()) { return list('coach_plans').find(plan => plan.week === value) || null; }
  function loadPlan() {
    if (state.plan?.week === week()) return state.plan;
    const existing = draft('plan') || savedPlan();
    state.plan = clone(existing || { id: uid(), week: week(), focus: '', training: '', nutrition: '', recovery: '', review: '', days: [] });
    state.plan.days = Array.isArray(state.plan.days) ? state.plan.days : [];
    return state.plan;
  }
  function planDay(date = state.day || weekDates()[0]) {
    const plan = loadPlan();
    let day = plan.days.find(item => item.date === date);
    if (!day) { day = { date, kind: 'unplanned', exercises: [], notes: '', routine_id: '', routine_day_id: '', session_id: '' }; plan.days.push(day); }
    return day;
  }
  function persistPlanDraft() { setDraft('plan', state.plan); const status = el('cp-plan-status'); if (status) status.textContent = 'Borrador guardado'; }
  function setStats(sets = []) {
    return { sets: sets.length, reps: sets.reduce((sum, set) => sum + num(set.reps), 0), weight: sets.reduce((max, set) => Math.max(max, num(set.weight)), 0), volume: sets.reduce((sum, set) => sum + num(set.reps) * num(set.weight), 0) };
  }
  function matchSessions(day) {
    const sessions = list('sessions').filter(session => session.date === day.date);
    if (day.session_id) return sessions.filter(session => session.id === day.session_id);
    if (!day.routine_name && !day.day_name) return [];
    return sessions.filter(session => (!day.routine_name || norm(session.routine_name) === norm(day.routine_name)) && (!day.day_name || norm(session.day_name) === norm(day.day_name)));
  }
  function compareDay(day) {
    const sessions = day ? matchSessions(day) : [];
    const sets = sessions.flatMap(session => session.sets || []);
    const exercises = (day?.exercises || []).map(exercise => {
      const achieved = sets.filter(set => norm(set.exercise_name || set.exercise) === norm(exercise.name));
      const actual = achieved.length ? setStats(achieved) : null;
      const expected = { sets: num(exercise.sets), reps: num(exercise.sets) * num(exercise.reps), weight: optionalNumber(exercise.weight), volume: optionalNumber(exercise.weight) == null ? null : num(exercise.sets) * num(exercise.reps) * num(exercise.weight) };
      return { name: exercise.name, actual, expected, diff: actual ? { sets: actual.sets - expected.sets, reps: actual.reps - expected.reps, weight: expected.weight == null ? null : actual.weight - expected.weight, volume: expected.volume == null ? null : actual.volume - expected.volume } : null };
    });
    return { sessions, exercises, actual: sets.length ? setStats(sets) : null };
  }
  function comparisonHtml(day) {
    if (!day || day.kind !== 'training') return empty('Sin entrenamiento planificado para este día.');
    const result = compareDay(day);
    const sessions = list('sessions').filter(session => session.date === day.date);
    const options = sessions.map(session => `<option value="${safe(session.id)}" ${day.session_id === session.id ? 'selected' : ''}>${safe([session.routine_name, session.day_name].filter(Boolean).join(' / ') || 'Sesión guardada')} · ${session.sets?.length || 0} series</option>`).join('');
    return `<div class="cp-row"><p>${result.sessions.length ? `${result.sessions.length} sesión(es) vinculada(s)` : 'Sin sesión vinculada'} · ${safe(day.date)}</p><label>Sesión realizada<select data-cp-change="session" data-date="${safe(day.date)}"><option value="">Buscar por rutina y día</option>${options}</select></label></div>${result.exercises.length ? `<div class="cp-table-wrap"><table><thead><tr><th>Ejercicio</th><th>Plan</th><th>Real</th><th>Diferencia real − plan</th></tr></thead><tbody>${result.exercises.map(item => `<tr><td>${safe(item.name)}</td><td>${item.expected.sets} × ${n(num(item.expected.reps) / (item.expected.sets || 1))} reps<br>${item.expected.weight == null ? 'Carga sin definir' : n(item.expected.weight) + ' kg'}</td><td>${item.actual ? `${item.actual.sets} series · ${item.actual.reps} reps<br>${n(item.actual.weight)} kg máx. · ${n(item.actual.volume)} kg vol.` : 'Sin registro'}</td><td>${item.diff ? `${delta(item.diff.sets)} series · ${delta(item.diff.reps)} reps<br>${item.diff.weight == null ? 'Sin referencia de carga' : delta(item.diff.weight) + ' kg máx.'}${item.diff.volume == null ? '' : ' · ' + delta(item.diff.volume) + ' kg vol.'}` : 'Sin comparación'}</td></tr>`).join('')}</tbody></table></div>` : empty('Agrega ejercicios al plan para comparar series, repeticiones y cargas.')}`;
  }
  function renderPlanning() {
    const plan = loadPlan();
    if (!weekDates().includes(state.day)) state.day = weekDates().includes(selectedDate()) ? selectedDate() : weekDates()[0];
    const day = planDay();
    const routines = list('routines');
    const routine = routines.find(row => row.id === day.routine_id);
    return `<div class="cp">${head('Plan semanal', 'Organiza cada día y revisa el trabajo realizado.', weekControl())}
      <div class="cp-form">${field('Foco de la semana', 'cp-plan-focus', plan.focus, 'text', 'maxlength="160" data-cp-plan-field="focus"')}${field('Copiar hacia otra semana', 'cp-plan-copy-week', weekValueFromDate(addDays(weekDates()[0], 7)), 'week')}</div>
      <div class="cp-week">${weekDates().map((date, index) => { const item = plan.days.find(row => row.date === date); return `<div class="cp-day ${date === state.day ? 'selected' : ''}">${button('plan-day', `${dayNamesShort[index]} <b>${date.slice(8)}</b>`, `data-date="${date}"`)}<strong>${safe(item?.kind === 'rest' ? 'Descanso' : item?.day_name || (item?.kind === 'training' ? 'Entrenamiento' : 'Sin asignar'))}</strong><small>${item?.exercises?.length || 0} ejercicios${item?.kind === 'training' ? ` · ${matchSessions(item).length ? 'Registrado' : 'Sin sesión'}` : ''}</small></div>`; }).join('')}</div>
      <section class="cp-panel"><div class="cp-editor-header"><h3>${safe(coachDateText(state.day))}</h3><label>Tipo de día<select data-cp-change="plan-kind"><option value="unplanned" ${day.kind === 'unplanned' ? 'selected' : ''}>Sin asignar</option><option value="training" ${day.kind === 'training' ? 'selected' : ''}>Entrenamiento</option><option value="rest" ${day.kind === 'rest' ? 'selected' : ''}>Descanso</option></select></label></div>
      ${day.kind === 'training' ? `<div class="cp-form"><label>Rutina<select data-cp-change="plan-routine"><option value="">Personalizado</option>${routines.map(row => `<option value="${safe(row.id)}" ${row.id === day.routine_id ? 'selected' : ''}>${safe(row.name)}</option>`).join('')}</select></label><label>Día de rutina<select data-cp-change="plan-routine-day"><option value="">Elegir día</option>${(routine?.days || []).map(row => `<option value="${safe(row.id)}" ${row.id === day.routine_day_id ? 'selected' : ''}>${safe(row.name)}</option>`).join('')}</select></label></div>
      <div class="cp-table-wrap"><table class="cp-prescription"><thead><tr><th>Ejercicio</th><th>Series</th><th>Reps / serie</th><th>kg / serie</th><th></th></tr></thead><tbody>${day.exercises.map((exercise, index) => `<tr><td><input aria-label="Ejercicio" value="${safe(exercise.name)}" maxlength="120" data-cp-exercise="name" data-index="${index}"></td>${['sets', 'reps', 'weight'].map(key => `<td><input type="number" aria-label="${key === 'weight' ? 'Peso en kg' : key === 'sets' ? 'Series' : 'Repeticiones'}" min="${key === 'weight' ? 0 : 1}" max="${key === 'weight' ? 1500 : 100}" step="${key === 'weight' ? '.5' : 1}" value="${safe(exercise[key] ?? '')}" data-cp-exercise="${key}" data-index="${index}"></td>`).join('')}<td>${button('remove-exercise', icon('trash-2'), `data-index="${index}" title="Quitar ejercicio" aria-label="Quitar ejercicio"`, 'icon danger')}</td></tr>`).join('')}</tbody></table></div><div class="cp-tools">${button('add-exercise', icon('plus') + 'Ejercicio')}${button('load-prescription', icon('list-restart') + 'Cargar objetivos de rutina')}</div>` : ''}
      <label>Notas del día<textarea data-cp-day-field="notes" maxlength="2000">${safe(day.notes)}</textarea></label></section>
      ${section('Planificado frente a realizado', comparisonHtml(day))}
      <div class="cp-grid">${area('Entrenamiento / contexto', 'cp-plan-training', plan.training)}${area('Nutrición', 'cp-plan-nutrition', plan.nutrition)}${area('Recuperación', 'cp-plan-recovery', plan.recovery)}${area('Revisión al cierre', 'cp-plan-review', plan.review)}</div>
      <div class="cp-band cp-row"><span id="cp-plan-status" class="cp-save-state">${draft('plan') ? 'Borrador recuperado' : 'Plan guardado o sin cambios'}</span><div class="cp-tools">${button('copy-plan', icon('copy') + 'Duplicar semana')}${button('save-plan', icon('save') + 'Guardar plan', '', 'primary')}</div></div>
      ${section('Planes guardados', list('coach_plans').map(item => `<div class="cp-row cp-item"><div><strong>${safe(item.focus)}</strong><small> · ${safe(item.week)}</small></div>${button('open-plan', 'Abrir', `data-week="${safe(item.week)}"`)}</div>`).join('') || empty('Todavía no hay planes guardados.'))}</div>`;
  }
  function capturePlan() {
    if (!state.plan) return;
    ['focus', 'training', 'nutrition', 'recovery', 'review'].forEach(key => { const input = el(`cp-plan-${key}`); if (input) state.plan[key] = input.value; });
    persistPlanDraft();
  }
  function validatePlan(plan) {
    if (!String(plan.focus || '').trim()) throw new Error('Escribe el foco de la semana.');
    for (const day of plan.days || []) for (const exercise of day.kind === 'training' ? day.exercises : []) {
      if (!exercise.name.trim() || !Number.isInteger(+exercise.sets) || +exercise.sets < 1 || +exercise.sets > 100 || !Number.isInteger(+exercise.reps) || +exercise.reps < 1 || +exercise.reps > 100 || (exercise.weight != null && (!Number.isFinite(+exercise.weight) || +exercise.weight < 0 || +exercise.weight > 1500))) throw new Error('Revisa nombres, series, repeticiones y cargas del plan.');
    }
  }
  function savePlan() {
    capturePlan(); validatePlan(state.plan);
    state.plan.created_at ||= now(); state.plan.updated_at = now();
    put('coach_plans', clone(state.plan)); clearDraft('plan');
    notify('Plan semanal guardado'); redraw();
  }
  function copyPlan() {
    capturePlan(); validatePlan(state.plan);
    const target = val('cp-plan-copy-week');
    if (!/^\d{4}-W\d{2}$/.test(target) || target === week()) throw new Error('Elige otra semana para duplicar.');
    if (savedPlan(target)) throw new Error('Esa semana ya tiene un plan. Ábrelo para editarlo.');
    if (storageDrafts()[`plan:${DB.get('activeUser') || ''}:${target}`]) throw new Error('Esa semana tiene un borrador pendiente. Ábrelo antes de duplicar.');
    const copy = clone(state.plan); const dates = getWeekDates(target); const datesFrom = weekDates();
    copy.id = uid(); copy.week = target; copy.created_at = now(); copy.updated_at = now();
    copy.days = copy.days.filter(day => datesFrom.includes(day.date)).map(day => ({ ...day, date: dates[datesFrom.indexOf(day.date)], session_id: '' }));
    put('coach_plans', copy); changeWeek(target); notify('Semana duplicada; historial realizado conservado');
  }
  function loadPrescription() {
    const day = planDay();
    const routine = list('routines').find(row => row.id === day.routine_id);
    const source = routine?.days?.find(row => row.id === day.routine_day_id);
    if (!source) throw new Error('Selecciona una rutina y uno de sus días.');
    if (day.exercises.length && !confirm('¿Reemplazar los objetivos de este día con los de la rutina?')) return;
    day.routine_name = routine.name; day.day_name = source.name;
    day.exercises = (source.exercises || []).map(row => { const target = row.coach_prescriptions?.length ? window.CoachAI?.targetState(row, day.date) : null; return { name: row.name, sets: target?.sets ?? (num(row.target_sets || row.sets) || 1), reps: target?.reps ?? (num(row.target_reps || row.reps) || 1), weight: target?.weight ?? optionalNumber(row.weight) }; });
    persistPlanDraft(); redraw();
  }
  function comparisonWeekHtml() {
    const plan = savedPlan();
    return `<div class="cp">${section('Planificado frente a realizado', `<div class="cp-row">${weekControl()}${button('open-planning', icon('calendar-check') + 'Editar plan')}</div>${plan?.days?.some(day => day.kind === 'training') ? plan.days.filter(day => day.kind === 'training').map(day => `<details class="cp-item"><summary>${safe(day.date)} · ${safe(day.day_name || 'Entrenamiento')} · ${matchSessions(day).length ? 'Con sesión' : 'Sin sesión vinculada'}</summary>${comparisonHtml(day)}</details>`).join('') : empty('Esta semana aún no tiene días de entrenamiento planificados.')}`)}</div>`;
  }
  function linkOptions(type, value) {
    const rows = type === 'session' ? list('sessions').map(row => ({ id: row.id, title: `${row.date} · ${row.day_name || row.routine_name || 'Sesión'}` })) : type === 'meal' ? list('meals').map(row => ({ id: row.id, title: `${row.date} · ${row.food_item || row.name || 'Comida'}` })) : type === 'exercise' ? [...new Set(list('sessions').flatMap(row => (row.sets || []).map(set => set.exercise_name)).filter(Boolean))].map(name => ({ id: name, title: name })) : [];
    return `<option value="">Sin vínculo</option>${rows.map(row => `<option value="${safe(row.id)}" ${row.id === value ? 'selected' : ''}>${safe(row.title)}</option>`).join('')}`;
  }
  function renderJournal() {
    const pending = draft('journal');
    if (!state.journalId && pending?.id) state.journalId = pending.id;
    const entry = state.journalId ? (pending?.id === state.journalId ? pending : list('coach_journal').find(row => row.id === state.journalId)) : pending;
    const rows = list('coach_journal').slice().sort((a, b) => b.date.localeCompare(a.date));
    return `<div class="cp">${head('Bitácora del coach', 'Observaciones y decisiones vinculadas a tus registros.')}${form('journal', `<div class="cp-form">${field('Fecha', 'cp-journal-date', entry?.date || selectedDate(), 'date', 'required')}${field('Título', 'cp-journal-title', entry?.title || '', 'text', 'maxlength="160" required')}<label>Vincular a<select id="cp-journal-type" data-cp-change="journal-type">${[['', 'Sin vínculo'], ['session', 'Entrenamiento'], ['exercise', 'Ejercicio'], ['meal', 'Comida']].map(([value, label]) => `<option value="${value}" ${entry?.link_type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Registro<select id="cp-journal-link">${linkOptions(entry?.link_type, entry?.link_id)}</select></label>${area('Observación', 'cp-journal-copy', entry?.copy || '')}${area('Decisión / próxima acción', 'cp-journal-action', entry?.action || '')}<label>Estado<select id="cp-journal-status">${[['pending', 'Pendiente'], ['done', 'Resuelta'], ['observation', 'Solo observación']].map(([value, label]) => `<option value="${value}" ${entry?.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><div class="cp-band cp-tools">${button('reset-journal', 'Nueva entrada')}<button class="primary" type="submit">${icon('save')}Guardar entrada</button></div>`)}
      ${section('Entradas y decisiones', rows.map(row => `<article class="cp-item"><div class="cp-row"><h3>${safe(row.title)}</h3>${tag(row.status === 'done' ? 'Resuelta' : row.status === 'observation' ? 'Observación' : 'Pendiente', row.status === 'done' ? 'good' : 'warn')}</div><small>${safe(row.date)}${row.link_label ? ' · ' + safe(row.link_label) : ''}</small><p class="cp-copy">${safe(row.copy)}</p><p class="cp-copy">${safe(row.action)}</p><div class="cp-tools">${button('edit-journal', icon('pencil'), idAttr(row.id) + ' title="Editar entrada" aria-label="Editar entrada"', 'icon')}${row.status !== 'observation' ? button('resolve-journal', row.status === 'done' ? 'Reabrir' : 'Resolver', idAttr(row.id)) : ''}${button('delete-journal', icon('trash-2'), idAttr(row.id) + ' title="Eliminar entrada" aria-label="Eliminar entrada"', 'icon danger')}</div></article>`).join('') || empty('Sin observaciones guardadas.'))}</div>`;
  }
  function journalFormValue() {
    return { date: val('cp-journal-date'), title: val('cp-journal-title').trim(), link_type: val('cp-journal-type'), link_id: val('cp-journal-link'), link_label: el('cp-journal-link')?.selectedOptions[0]?.textContent || '', copy: val('cp-journal-copy'), action: val('cp-journal-action'), status: val('cp-journal-status') };
  }
  function saveJournal() {
    const entry = journalFormValue();
    if (!entry.date || !entry.title || (!entry.copy.trim() && !entry.action.trim())) throw new Error('Completa fecha, título y una observación o decisión.');
    const existing = list('coach_journal').find(row => row.id === state.journalId);
    put('coach_journal', { ...existing, ...entry, id: existing?.id || uid(), created_at: existing?.created_at || now(), updated_at: now() });
    state.journalId = ''; clearDraft('journal'); notify('Entrada guardada'); redraw();
  }

  // MAPS
  function normalizeMap(source) {
    const map = clone(source);
    if (!Array.isArray(map.nodes)) {
      map.nodes = [{ id: 'root', text: map.central || map.title || 'Proceso', x: 414, y: 60, source: '' }, ...(map.branches || []).map((text, index) => ({ id: `branch-${index}`, text, x: 40 + (index % 4) * 240, y: 270 + Math.floor(index / 4) * 120, source: '' }))];
      map.edges = map.nodes.slice(1).map(node => ({ id: uid(), from: 'root', to: node.id }));
    }
    map.edges = (map.edges || []).filter(edge => map.nodes.some(node => node.id === edge.from) && map.nodes.some(node => node.id === edge.to));
    return map;
  }
  function loadMap() {
    if (!state.map) {
      const source = draft('map') || list('coach_maps').find(row => row.id === coachSelectedMapId) || list('coach_maps')[0];
      state.map = source ? normalizeMap(source) : { id: uid(), title: '', nodes: [{ id: uid(), text: 'Idea central', x: 414, y: 60, source: '' }], edges: [] };
    }
    if (!state.map.nodes.some(node => node.id === state.selectedNode)) state.selectedNode = state.map.nodes[0]?.id || '';
    return state.map;
  }
  function nodeReference(node) {
    if (!node.source) return '';
    const date = node.date || selectedDate();
    if (node.source === 'training') {
      const sets = list('sessions').filter(row => row.date === date).flatMap(row => row.sets || []);
      return sets.length ? `${date} · ${sets.length} series · ${n(setStats(sets).volume)} kg vol.` : `${date} · Sin sesión registrada`;
    }
    if (node.source === 'nutrition') {
      const nutrition = nutritionForDate(date);
      return nutrition.meals.length ? `${date} · ${n(nutrition.totals.cal)} kcal · ${n(nutrition.totals.p)} g proteína` : `${date} · Sin comidas`;
    }
    if (node.source === 'recovery') {
      const wellness = (DB.get('daily_wellness') || {})[date];
      return `${date} · ${wellness?.sleep != null ? n(wellness.sleep) + ' h sueño' : 'Sin sueño registrado'}`;
    }
    const goals = list('goals').filter(goal => goal.status === 'active');
    return goals.length ? goals.map(goal => goal.title).join(' · ') : 'Sin objetivos activos';
  }
  function mapSvg(map) {
    return `<svg viewBox="0 0 1000 650" aria-hidden="true"><defs><marker id="cp-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#7caa90"/></marker></defs>${map.edges.map(edge => {
      const from = map.nodes.find(node => node.id === edge.from); const to = map.nodes.find(node => node.id === edge.to);
      return `<line x1="${num(from.x) + 86}" y1="${num(from.y) + 50}" x2="${num(to.x) + 86}" y2="${num(to.y) + 30}" stroke="#7caa90" stroke-width="2" marker-end="url(#cp-arrow)"/>`;
    }).join('')}</svg>`;
  }
  function mapNodesHtml(map) {
    return `${mapSvg(map)}${map.nodes.map((node, index) => `<div class="cp-node ${index === 0 ? 'root' : ''} ${node.id === state.selectedNode ? 'selected' : ''}" style="left:${num(node.x)}px;top:${num(node.y)}px" tabindex="0" role="button" aria-label="${safe(node.text)}" data-cp-node="${safe(node.id)}"><small>${index === 0 ? 'IDEA CENTRAL' : 'CONCEPTO'}</small><strong>${safe(node.text)}</strong>${node.source ? `<small>${safe(nodeReference(node))}</small>` : ''}</div>`).join('')}`;
  }
  function renderMaps() {
    const map = loadMap();
    const node = map.nodes.find(row => row.id === state.selectedNode);
    return `<div class="cp">${head('Mapa del proceso', 'Conceptos, decisiones y registros relacionados.')}
      <div class="cp-editor-header">${field('Nombre del mapa', 'cp-map-title', map.title, 'text', 'maxlength="160"')}<label>Mapas guardados<select data-cp-change="map-open"><option value="">Elegir mapa</option>${list('coach_maps').map(row => `<option value="${safe(row.id)}" ${row.id === map.id ? 'selected' : ''}>${safe(row.title)}</option>`).join('')}</select></label><div class="cp-tools">${button('new-map', icon('plus') + 'Nuevo')}${button('save-map', icon('save') + 'Guardar', '', 'primary')}${button('delete-map', icon('trash-2'), idAttr(map.id) + ' title="Eliminar mapa" aria-label="Eliminar mapa"', 'icon danger')}</div></div>
      <div class="cp-map-layout"><div class="cp-board-wrap"><div id="cp-map-board" class="cp-board">${mapNodesHtml(map)}</div></div>
      <aside class="cp-map-side"><div class="cp-panel"><h3>Concepto seleccionado</h3>${node ? `${area('Texto', 'cp-node-text', node.text)}<label>Relacionar con<select id="cp-node-source">${[['', 'Concepto manual'], ['training', 'Entrenamiento'], ['nutrition', 'Nutrición'], ['recovery', 'Recuperación'], ['goals', 'Objetivos activos']].map(([value, label]) => `<option value="${value}" ${node.source === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${field('Fecha de referencia', 'cp-node-date', node.date || selectedDate(), 'date')}<div class="cp-form">${field('Posición X', 'cp-node-x', node.x, 'number', 'min="0" max="828"')}${field('Posición Y', 'cp-node-y', node.y, 'number', 'min="0" max="530"')}</div><div class="cp-band cp-tools">${button('add-node', icon('plus') + 'Concepto')}${button('delete-node', icon('trash-2'), 'title="Eliminar concepto" aria-label="Eliminar concepto"', 'icon danger')}</div>` : button('add-node', 'Agregar concepto')}</div>
      <div class="cp-panel"><h3>Relaciones</h3><label>Desde<select id="cp-edge-from">${map.nodes.map(row => `<option value="${safe(row.id)}" ${row.id === node?.id ? 'selected' : ''}>${safe(row.text)}</option>`).join('')}</select></label><label>Hacia<select id="cp-edge-to">${map.nodes.map(row => `<option value="${safe(row.id)}">${safe(row.text)}</option>`).join('')}</select></label>${button('add-edge', icon('git-fork') + 'Conectar')}<div class="cp-list">${map.edges.map(edge => `<div class="cp-edge"><span>${safe(map.nodes.find(row => row.id === edge.from)?.text)} → ${safe(map.nodes.find(row => row.id === edge.to)?.text)}</span>${button('delete-edge', icon('x'), idAttr(edge.id) + ' title="Quitar conexión" aria-label="Quitar conexión"', 'icon')}</div>`).join('')}</div></div></aside></div><small id="cp-map-status" class="cp-save-state">${draft('map') ? 'Borrador recuperado' : 'Mapa listo para editar'}</small></div>`;
  }
  function mapDraft() { setDraft('map', state.map); if (el('cp-map-status')) el('cp-map-status').textContent = 'Borrador guardado'; }
  function saveMap() {
    const map = loadMap(); map.title = val('cp-map-title').trim();
    if (!map.title || !map.nodes.length || map.nodes.some(node => !node.text.trim())) throw new Error('Escribe el título y los conceptos del mapa.');
    map.updated_at = now(); map.created_at ||= now();
    // Legacy text fields remain available to older versions and exports.
    map.central = map.nodes[0].text; map.branches = map.nodes.slice(1).map(node => node.text);
    put('coach_maps', clone(map)); coachSelectedMapId = map.id; clearDraft('map'); notify('Mapa guardado'); redraw();
  }
  let dragging = null;
  function selectNode(id) { state.selectedNode = id; redraw(); }
  document.addEventListener('pointerdown', event => {
    const target = event.target.closest?.('[data-cp-node]');
    if (!target || !coachModeUnlocked || event.button !== 0) return;
    const node = loadMap().nodes.find(row => row.id === target.dataset.cpNode);
    if (!node) return;
    dragging = { target, node, x: event.clientX, y: event.clientY, originalX: node.x, originalY: node.y, moved: false };
    target.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  document.addEventListener('pointermove', event => {
    if (!dragging) return;
    const item = dragging;
    const dx = event.clientX - item.x; const dy = event.clientY - item.y;
    if (Math.abs(dx) + Math.abs(dy) < 4 && !item.moved) return;
    item.moved = true;
    item.node.x = Math.max(0, Math.min(828, item.originalX + dx));
    item.node.y = Math.max(0, Math.min(530, item.originalY + dy));
    item.target.style.left = item.node.x + 'px'; item.target.style.top = item.node.y + 'px';
    const svg = el('cp-map-board')?.querySelector('svg');
    if (svg) svg.outerHTML = mapSvg(state.map);
  });
  function finishDrag() {
    if (!dragging) return;
    const item = dragging; dragging = null;
    if (item.moved) mapDraft();
    selectNode(item.node.id);
  }
  document.addEventListener('pointerup', finishDrag);
  document.addEventListener('pointercancel', finishDrag);
  document.addEventListener('keydown', event => {
    const target = event.target.closest?.('[data-cp-node]');
    if (!target || !coachModeUnlocked) return;
    const steps = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(target.dataset.cpNode); }
    if (steps[event.key]) {
      event.preventDefault(); const node = loadMap().nodes.find(row => row.id === target.dataset.cpNode);
      node.x = Math.max(0, Math.min(828, node.x + steps[event.key][0])); node.y = Math.max(0, Math.min(530, node.y + steps[event.key][1]));
      mapDraft(); const id = node.id; state.selectedNode = id; redraw();
      document.querySelector(`[data-cp-node="${CSS.escape(id)}"]`)?.focus();
    }
  });

  // GUIDELINES
  const metricLabels = { manual: 'Cumplimiento manual', training: 'Sesiones del día', protein: 'Proteína (g)', water: 'Agua (ml)', steps: 'Pasos', sleep: 'Sueño (h)' };
  function guidelineDates(item, dates = weekDates()) {
    return dates.filter(date => (!item.start_date || date >= item.start_date) && (!item.end_date || date <= item.end_date) && (item.frequency !== 'weekdays' || localDate(date).getDay() % 6 !== 0) && (item.frequency !== 'weekly' || localDate(date).getDay() === 0));
  }
  function guidelineReading(item, date) {
    if (!item.metric || item.metric === 'manual') return { known: Boolean(item.checks?.[date]), value: item.checks?.[date] ? 1 : null, done: Boolean(item.checks?.[date]) };
    const dates = item.frequency === 'weekly' ? getWeekDates(weekValueFromDate(date)).filter(day => (!item.start_date || day >= item.start_date) && (!item.end_date || day <= item.end_date)) : [date];
    const meals = list('meals').filter(row => dates.includes(row.date));
    const water = DB.get('daily_water') || {}; const wellness = DB.get('daily_wellness') || {};
    const steps = list('checking_cardio').filter(row => dates.includes(row.date) && row.type === 'steps');
    let value = null;
    if (item.metric === 'training') { const rows = list('sessions').filter(row => dates.includes(row.date)); if (rows.length) value = rows.length; }
    if (item.metric === 'protein' && meals.length) value = meals.reduce((sum, row) => sum + num(row.protein), 0);
    if (item.metric === 'water' && dates.some(day => Object.hasOwn(water, day))) value = dates.reduce((sum, day) => sum + num(water[day]), 0);
    if (item.metric === 'steps' && steps.length) value = steps.reduce((sum, row) => sum + num(row.value), 0);
    if (item.metric === 'sleep') { const values = dates.map(day => optionalNumber(wellness[day]?.sleep)).filter(value => value != null); if (values.length) value = values.reduce((a, b) => a + b, 0) / values.length; }
    return { value, known: value != null, done: value != null && value >= num(item.target || 1) };
  }
  function renderGuidelines() {
    const pending = draft('guideline');
    if (!state.guidelineId && pending?.id) state.guidelineId = pending.id;
    const item = state.guidelineId ? (pending?.id === state.guidelineId ? pending : list('coach_guidelines').find(row => row.id === state.guidelineId)) || {} : pending || {};
    return `<div class="cp">${head('Pautas con seguimiento', 'Acciones, frecuencia y cumplimiento de la semana.', weekControl())}<div class="cp-grid"><section class="cp-panel">${form('guideline', `<h3>${state.guidelineId ? 'Editar pauta' : 'Nueva pauta'}</h3><div class="cp-form">${field('Título', 'cp-guide-title', item.title, 'text', 'maxlength="160" required')}<label>Área<select id="cp-guide-area">${['general', 'training', 'nutrition', 'recovery', 'habits'].map(area => `<option value="${area}" ${area === item.area ? 'selected' : ''}>${coachGuidelineAreaLabel(area)}</option>`).join('')}</select></label>${area('Acción / pauta', 'cp-guide-copy', item.copy || '')}${field('Cuándo usarla', 'cp-guide-condition', item.condition || '')}${field('Desde', 'cp-guide-start', item.start_date || selectedDate(), 'date', 'required')}${field('Hasta (opcional)', 'cp-guide-end', item.end_date || '', 'date')}<label>Frecuencia<select id="cp-guide-frequency">${[['daily', 'Diaria'], ['weekdays', 'Lunes a viernes'], ['weekly', 'Semanal (cierre domingo)']].map(([value, label]) => `<option value="${value}" ${item.frequency === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Verificación<select id="cp-guide-metric">${Object.entries(metricLabels).map(([value, label]) => `<option value="${value}" ${item.metric === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${field('Meta (por día; total semanal si corresponde)', 'cp-guide-target', item.target ?? 1, 'number', 'min="0.1" step="any" required')}</div><div class="cp-band cp-tools">${button('new-guideline', 'Nueva pauta')}<button type="submit" class="primary">${icon('save')}Guardar pauta</button></div>`)}</section><section><div class="cp-list">${list('coach_guidelines').map(row => {
      const dates = guidelineDates(row); const done = dates.filter(date => guidelineReading(row, date).done).length;
      return `<article class="cp-panel"><div class="cp-row"><h3>${safe(row.title)}</h3>${tag(row.active === false ? 'Pausada' : `${done}/${dates.length} cumplimientos`, row.active === false ? '' : 'good')}</div><p class="cp-copy">${safe(row.copy)}</p><small>${safe(row.condition || '')} · ${safe(metricLabels[row.metric] || 'Manual')} · ${safe(row.frequency === 'weekly' ? 'Semanal' : row.frequency === 'weekdays' ? 'Lunes a viernes' : 'Diaria')}</small><div class="cp-daychecks">${dates.map(date => {
        const reading = guidelineReading(row, date); const manual = !row.metric || row.metric === 'manual';
        return button(manual ? 'check-guideline' : 'inspect-guideline', `${date.slice(8)} ${reading.done ? '✓' : reading.known ? n(reading.value) : '—'}`, `${idAttr(row.id)} data-date="${date}" title="${safe(date + ' · ' + (reading.done ? 'Cumplida' : reading.known ? `Registrado: ${reading.value}` : 'Sin registro'))}" ${row.active === false || date > today() ? 'disabled' : ''}`, reading.done ? 'checked' : 'unknown');
      }).join('') || '<small>Sin vencimientos en esta semana.</small>'}</div><div class="cp-band cp-tools">${button('edit-guideline', icon('pencil'), idAttr(row.id) + ' title="Editar pauta" aria-label="Editar pauta"', 'icon')}${button('toggle-guideline', row.active === false ? 'Activar' : 'Pausar', idAttr(row.id))}${button('delete-guideline', icon('trash-2'), idAttr(row.id) + ' title="Eliminar pauta" aria-label="Eliminar pauta"', 'icon danger')}</div></article>`;
    }).join('') || empty('Sin pautas guardadas.')}</div></section></div></div>`;
  }
  function guidelineFormValue() {
    return { title: val('cp-guide-title').trim(), area: val('cp-guide-area'), copy: val('cp-guide-copy').trim(), condition: val('cp-guide-condition').trim(), start_date: val('cp-guide-start'), end_date: val('cp-guide-end'), frequency: val('cp-guide-frequency'), metric: val('cp-guide-metric'), target: num(val('cp-guide-target')) };
  }
  function saveGuideline() {
    const data = guidelineFormValue(); const existing = list('coach_guidelines').find(row => row.id === state.guidelineId);
    if (data.metric === 'manual') data.target = 1;
    if (!data.title || !data.copy || !data.start_date || data.target <= 0 || (data.end_date && data.end_date < data.start_date)) throw new Error('Revisa título, acción, fechas y meta de la pauta.');
    put('coach_guidelines', { ...existing, ...data, id: existing?.id || uid(), active: existing?.active !== false, checks: existing?.checks || {}, created_at: existing?.created_at || now(), updated_at: now() });
    state.guidelineId = ''; clearDraft('guideline'); notify('Pauta guardada'); redraw();
  }
  function configureGuidelineMetric() {
    const metric = el('cp-guide-metric'); const target = el('cp-guide-target');
    if (!metric || !target) return;
    metric.dataset.cpChange = 'guide-metric';
    target.disabled = metric.value === 'manual';
    if (target.disabled) target.value = '1';
    target.closest('label').firstChild.textContent = target.disabled ? 'Cumplimiento por acción (sí / no)' : metric.value === 'sleep' ? 'Meta de sueño (h de promedio)' : 'Meta por día / total semanal';
  }

  // EFFORT
  function openEffort(id) {
    const session = list('sessions').find(row => row.id === id);
    if (!session) throw new Error('La sesión ya no está disponible.');
    el('cp-effort-modal')?.remove();
    const savedDraft = (DB.get('coach_effort_drafts') || {})[id];
    const source = savedDraft || session;
    const names = [...new Set((session.sets || []).map(set => set.exercise_name || set.exercise).filter(Boolean))];
    const overlay = document.createElement('div'); overlay.id = 'cp-effort-modal'; overlay.className = 'overlay show cp-modal';
    overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="cp-effort-heading"><div class="cp">${form('effort', `<input type="hidden" id="cp-effort-id" value="${safe(id)}"><div class="cp-head"><div><h2 id="cp-effort-heading">Esfuerzo y molestias</h2><small>${safe(session.date)} · ${safe(session.day_name || session.routine_name || 'Sesión')}</small></div>${button('close-effort', icon('x'), 'title="Cerrar" aria-label="Cerrar"', 'icon')}</div><div class="cp-form">${field('Fatiga de la sesión (1–10, opcional)', 'cp-fatigue', source.coach_review?.fatigue ?? '', 'number', 'min="1" max="10" step="1"')}${area('Sensaciones', 'cp-effort-notes', source.coach_review?.notes || '')}</div><div class="cp-table-wrap"><table><thead><tr><th>Ejercicio / serie</th><th>RIR (0–10)</th><th>RPE (1–10)</th></tr></thead><tbody>${(session.sets || []).map((set, index) => `<tr><td>${safe(set.exercise_name || set.exercise)} · ${index + 1}<br><small>${n(set.weight)} kg × ${n(set.reps)} reps</small></td><td><input type="number" aria-label="RIR serie ${index + 1}" min="0" max="10" step=".5" data-cp-rir="${index}" value="${safe(source.sets?.[index]?.rir ?? '')}"></td><td><input type="number" aria-label="RPE serie ${index + 1}" min="1" max="10" step=".5" data-cp-rpe="${index}" value="${safe(source.sets?.[index]?.rpe ?? '')}"></td></tr>`).join('')}</tbody></table></div><div class="cp-list">${names.map((name, index) => { const item = (source.coach_review?.exercises || []).find(row => norm(row.name) === norm(name)); return `<div class="cp-band"><h3>${safe(name)}</h3><input type="hidden" data-cp-discomfort-name="${index}" value="${safe(name)}"><div class="cp-form">${field('Molestia percibida (0–10, opcional)', `cp-pain-${index}`, item?.pain ?? '', 'number', 'min="0" max="10" step="1"')}${field('Zona / observación', `cp-pain-note-${index}`, item?.note || '', 'text', 'maxlength="600"')}</div></div>`; }).join('')}</div><div class="cp-tools"><small id="cp-effort-status">${savedDraft ? 'Borrador recuperado' : 'Los campos vacíos quedan sin registro.'}</small><button type="submit" class="primary">${icon('save')}Guardar evaluación</button></div>`)}</div></div>`;
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
    document.body.append(overlay); refreshInterfaceIcons(); overlay.querySelector('input:not([type=hidden])')?.focus();
  }
  function effortValue(validate = true) {
    const session = list('sessions').find(row => row.id === val('cp-effort-id'));
    if (!session) throw new Error('La sesión fue eliminada.');
    const read = (input, min, max) => {
      if (!input || input.value === '') return null;
      const value = +input.value;
      if (validate && (!Number.isFinite(value) || value < min || value > max)) throw new Error(`Completa un valor entre ${min} y ${max}.`);
      return Number.isFinite(value) ? value : null;
    };
    return { ...session, sets: (session.sets || []).map((set, index) => ({ ...set, rir: read(document.querySelector(`[data-cp-rir="${index}"]`), 0, 10), rpe: read(document.querySelector(`[data-cp-rpe="${index}"]`), 1, 10) })), coach_review: { fatigue: read(el('cp-fatigue'), 1, 10), notes: val('cp-effort-notes'), exercises: [...document.querySelectorAll('[data-cp-discomfort-name]')].map(input => ({ name: input.value, pain: read(el(`cp-pain-${input.dataset.cpDiscomfortName}`), 0, 10), note: val(`cp-pain-note-${input.dataset.cpDiscomfortName}`) })), updated_at: now() } };
  }
  function saveEffort() {
    const session = effortValue();
    put('sessions', session);
    const drafts = DB.get('coach_effort_drafts') || {}; delete drafts[session.id]; DB.set('coach_effort_drafts', drafts);
    el('cp-effort-modal')?.remove();
    renderSessionsList();
    if (document.querySelector('.page.active')?.id === 'page-coach') redraw();
    notify('Esfuerzo y molestias guardados en la sesión');
  }
  function effortSummary(sessions) {
    const values = sessions.map(row => row.coach_review?.fatigue).filter(value => value != null);
    const pain = sessions.flatMap(row => (row.coach_review?.exercises || []).filter(item => num(item.pain) > 0).map(item => ({ ...item, date: row.date })));
    return `<div class="cp">${section('Esfuerzo y molestias', `<p>${values.length ? `Fatiga registrada: ${n(values.reduce((a, b) => a + b, 0) / values.length)}/10 de media en ${values.length} sesión(es).` : 'Sin fatiga registrada.'}</p>${pain.map(item => `<div class="cp-item"><strong>${safe(item.name)}</strong> ${tag(`${item.pain}/10`, 'warn')}<small> · ${safe(item.date)}</small><p>${safe(item.note)}</p></div>`).join('')}${sessions.map(row => `<div class="cp-row cp-item"><span>${safe(row.date)} · ${safe(row.day_name || row.routine_name || 'Sesión')}</span>${button('effort', icon('activity') + 'Evaluar', idAttr(row.id))}</div>`).join('') || empty('Sin sesiones para evaluar.')}`)}</div>`;
  }

  // PHASES AND REPORTS
  function phaseSnapshot(plan) {
    if (!plan) return null;
    const cycle = plan.cycles?.[0] || {};
    return { id: plan.id, name: plan.name || '', objective: plan.objective || '', status: plan.status || 'draft', start_date: plan.start_date || '', duration_weeks: plan.duration_weeks ?? cycle.weeks ?? null, stage: cycle.stage_key || cycle.name || '', cycle_name: cycle.name || '', calories: cycle.calories ?? plan.baseline?.calories ?? null, protein: cycle.protein ?? plan.baseline?.protein ?? null, carbs: cycle.carbs ?? plan.baseline?.carbs ?? null, fat: cycle.fat ?? plan.baseline?.fat ?? null, training_days: plan.training_days ?? null, weekly_volume_target: cycle.weekly_volume_target ?? null, training_volume_pct: cycle.training_volume_pct ?? null, load_min_pct: cycle.load_min_pct ?? null, load_max_pct: cycle.load_max_pct ?? null, current_weight: plan.current_weight ?? null, target_weight: plan.target_weight ?? null, notes: plan.notes || '' };
  }
  function recordPhase(plan, previous, action) {
    const before = phaseSnapshot(previous); const after = phaseSnapshot(plan);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    DB.push('coach_phase_history', { id: uid(), date: today(), changed_at: now(), action, plan_id: plan.id, before, after });
  }
  const phaseLabels = { name: 'Nombre', objective: 'Fase', status: 'Estado', start_date: 'Inicio', duration_weeks: 'Semanas', stage: 'Intra fase', calories: 'kcal', protein: 'Proteína g', carbs: 'Carbohidratos g', fat: 'Grasas g', training_days: 'Días de entreno', weekly_volume_target: 'Volumen semanal kg', training_volume_pct: 'Volumen %', load_min_pct: 'Carga mín. %', load_max_pct: 'Carga máx. %', current_weight: 'Peso inicial kg', target_weight: 'Peso objetivo kg', notes: 'Notas' };
  function phaseChanges(entry) {
    const after = entry.after || {}; const before = entry.before || {};
    const display = (key, value) => {
      if (value == null || value === '') return '—';
      if (key === 'objective') return PREPARATION_OBJECTIVES[value]?.label || value;
      if (key === 'status') return ({ active: 'Activa', draft: 'Borrador', paused: 'Pausada', completed: 'Completada', archived: 'Archivada' })[value] || value;
      if (key === 'stage') return value === 'growth_1' ? 'Crecimiento I' : value === 'growth_2' ? 'Crecimiento II' : PREPARATION_INTRAPHASES.find(row => row.key === value)?.name || value;
      if (['target_weight', 'weekly_volume_target'].includes(key) && value === 0) return 'Sin definir';
      return value;
    };
    return Object.entries(phaseLabels).filter(([key]) => JSON.stringify(after[key] ?? null) !== JSON.stringify(before[key] ?? null)).map(([key, label]) => ({ label, before: display(key, before[key]), after: display(key, after[key]) }));
  }
  const phaseActionLabels = { phase_create: 'Fase creada', phase_edit: 'Configuración editada', phase_activation: 'Fase activada', phase_pause: 'Fase pausada', phase_archive: 'Fase archivada', coach_ai_agreement: 'Acuerdo Coach IA aprobado' };
  function historyHtml(entries) {
    return entries.map(entry => `<article class="cp-item"><div class="cp-row"><h3>${safe(phaseActionLabels[entry.action] || entry.action)}</h3><small>${safe(stamp(entry.changed_at))}</small></div><p>${safe(entry.after?.name || entry.before?.name)}</p><div class="cp-table-wrap"><table><thead><tr><th>Dato</th><th>Antes</th><th>Después</th></tr></thead><tbody>${phaseChanges(entry).map(change => `<tr><td>${safe(change.label)}</td><td>${safe(change.before)}</td><td>${safe(change.after)}</td></tr>`).join('')}</tbody></table></div></article>`).join('') || empty('Los próximos cambios de tus fases quedarán registrados aquí.');
  }
  function renderHistory() {
    const macroHistory = list('preparation_macro_history');
    return `<div class="cp">${head('Historial de fases', 'Valores y decisiones conservados en el momento de cada cambio.', button('open-preparation', icon('route') + 'Abrir preparación'))}
      ${section('Cambios de configuración', historyHtml(list('coach_phase_history')))}
      ${section('Cambios anteriores de macros', macroHistory.map(entry => `<div class="cp-item"><strong>${safe(entry.cycle || 'Cambio de macros')}</strong><small> · ${safe(String(entry.applied_at || '').slice(0, 16).replace('T', ' '))}</small><div class="cp-table-wrap"><table><thead><tr><th>Valor</th><th>Antes</th><th>Después</th></tr></thead><tbody>${['calories', 'protein', 'carbs', 'fat'].map(key => `<tr><td>${phaseLabels[key]}</td><td>${safe(entry.previous?.[key] ?? '—')}</td><td>${safe(entry.next?.[key] ?? '—')}</td></tr>`).join('')}</tbody></table></div></div>`).join('') || empty('Sin cambios anteriores de macros.'))}
      ${section('Configuraciones guardadas', list('preparation_plans').map(plan => { const value = phaseSnapshot(plan); return `<div class="cp-item"><h3>${safe(plan.name)}</h3><small>Configuración actual guardada · ${safe(value.status)} · ${safe(plan.start_date)}</small><p>${safe(value.calories ?? '—')} kcal · ${safe(value.protein ?? '—')} P · ${safe(value.carbs ?? '—')} C · ${safe(value.fat ?? '—')} G · ${safe(value.weekly_volume_target ?? '—')} kg/sem</p></div>`; }).join('') || empty('Sin fases guardadas.'))}</div>`;
  }
  function reportData(value = week()) {
    const dates = getWeekDates(value); const start = dates[0]; const end = dates[6];
    const included = row => row.date >= start && row.date <= end;
    const sessions = list('sessions').filter(included);
    const journal = list('coach_journal').filter(included);
    const body = list('bodylogs').filter(included).sort((a, b) => a.date.localeCompare(b.date));
    const meals = list('meals').filter(included);
    return { id: uid(), week: value, created_at: now(), owner: DB.get('activeUser') || 'AA Follow', dates, sessions: clone(sessions), meals: clone(meals), body: clone(body), journal: clone(journal), plan: clone(savedPlan(value)), comparisons: (savedPlan(value)?.days || []).filter(day => day.kind === 'training').map(day => ({ date: day.date, ...clone(compareDay(day)) })), next_plan: clone(savedPlan(weekValueFromDate(addDays(start, 7)))), guidelines: list('coach_guidelines').filter(item => item.active !== false).map(item => ({ title: item.title, copy: item.copy, metric: item.metric || 'manual', checks: guidelineDates(item, dates).map(date => ({ date, ...guidelineReading(item, date) })) })), phases: clone(list('coach_phase_history').filter(included)), assessment: clone(list('coach_assessments').filter(row => row.week === value)), days: dates.map(date => { const nutrition = nutritionForDate(date); const habits = dailyTrackingHabitData(date); return { date, nutrition: clone(nutrition), habits: clone(habits), volume: setStats(sessions.filter(row => row.date === date).flatMap(row => row.sets || [])).volume }; }), conclusion: val('cp-report-conclusion'), next_action: val('cp-report-next-action') };
  }
  function reportTable(headers, rows) {
    return rows.length ? `<div class="cp-table-wrap"><table><thead><tr>${headers.map(header => `<th>${safe(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${safe(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : empty('Sin registros en este período.');
  }
  function reportBody(data) {
    const sets = data.sessions.flatMap(session => session.sets || []); const stats = setStats(sets);
    const volumeMax = Math.max(1, ...data.days.map(day => day.volume));
    const totalCal = data.meals.reduce((sum, meal) => sum + num(meal.calories), 0);
    const plannedRows = (data.comparisons || []).flatMap(day => day.exercises.map(row => [day.date, row.name, `${row.expected.sets} series / ${row.expected.reps} reps / ${row.expected.weight == null ? 'sin carga' : row.expected.weight + ' kg'}`, row.actual ? `${row.actual.sets} series / ${row.actual.reps} reps / ${row.actual.weight} kg máx.` : 'Sin sesión vinculada', row.diff ? `${delta(row.diff.reps)} reps · ${row.diff.weight == null ? 'sin referencia de carga' : delta(row.diff.weight) + ' kg'}` : 'Sin comparación']));
    return `<div class="cp"><header><h2>Informe del coach · ${safe(data.week)}</h2><p>${safe(data.owner)} · ${safe(data.dates[0])} al ${safe(data.dates[6])}</p><small>Preparado ${safe(stamp(data.created_at))}</small></header><div class="cp-kpis"><div class="cp-kpi"><small>Sesiones realizadas</small><strong>${data.sessions.length}</strong></div><div class="cp-kpi"><small>Volumen registrado</small><strong>${n(stats.volume)} kg</strong></div><div class="cp-kpi"><small>Comidas registradas</small><strong>${data.meals.length}</strong></div></div>
      ${section('Volumen diario (kg)', `<div class="cp-chart">${data.days.map(day => `<div class="cp-bar" style="height:${Math.max(2, day.volume / volumeMax * 120)}px"><span>${n(day.volume)}</span><small>${safe(day.date.slice(5))}</small></div>`).join('')}</div>`)}
      ${section('Planificado frente a realizado', reportTable(['Fecha', 'Ejercicio', 'Plan', 'Real', 'Diferencia'], plannedRows))}
      ${section('Entrenamiento y esfuerzo', reportTable(['Fecha', 'Ejercicio', 'Serie', 'kg', 'Reps', 'RIR', 'RPE'], data.sessions.flatMap(session => (session.sets || []).map((set, index) => [session.date, set.exercise_name || set.exercise, set.set_number || index + 1, set.weight ?? '—', set.reps ?? '—', set.rir ?? '—', set.rpe ?? '—']))))}
      ${section('Recuperación y molestias', reportTable(['Fecha', 'Fatiga /10', 'Ejercicio', 'Molestia /10', 'Observación'], data.sessions.flatMap(session => { const review = session.coach_review; return review ? (review.exercises?.length ? review.exercises : [{}]).map(item => [session.date, review.fatigue ?? '—', item.name || '—', item.pain ?? '—', [item.note, review.notes].filter(Boolean).join(' · ')]) : []; })))}
      ${section('Nutrición y hábitos', reportTable(['Fecha', 'kcal / meta', 'P / C / G (g)', 'Peso kg', 'Agua ml', 'Pasos', 'Sueño h'], data.days.map(day => [day.date, day.nutrition.meals.length ? `${n(day.nutrition.totals.cal)} / ${n(day.nutrition.cfg.calories)}` : 'Sin comidas', day.nutrition.meals.length ? `${n(day.nutrition.totals.p)} / ${n(day.nutrition.totals.c)} / ${n(day.nutrition.totals.f)}` : '—', day.habits.body?.weight ?? '—', day.habits.water ?? '—', day.habits.steps ?? '—', day.habits.sleep ?? '—']))) }
      ${section('Comidas', reportTable(['Fecha', 'Comida', 'Alimento', 'kcal', 'P / C / G'], data.meals.map(meal => [meal.date, meal.meal_name || meal.meal || 'Comida', meal.food_item || meal.name || 'Alimento', meal.calories ?? '—', `${meal.protein ?? '—'} / ${meal.carbs ?? '—'} / ${meal.fat ?? '—'}`])))}
      ${section('Pautas', data.guidelines.map(item => `<div class="cp-item"><h4>${safe(item.title)}</h4><p>${safe(item.copy)}</p><small>${item.checks.filter(row => row.done).length}/${item.checks.length} cumplimientos · ${safe(metricLabels[item.metric])}</small></div>`).join('') || empty('Sin pautas activas.'))}
      ${section('Bitácora y decisiones', data.journal.map(item => `<div class="cp-item"><h4>${safe(item.date)} · ${safe(item.title)}</h4><small>${safe(journalStatus(item.status))} · ${safe(item.link_label || '')}</small><p class="cp-copy">${safe(item.copy)}</p><p class="cp-copy">${safe(item.action)}</p></div>`).join('') || empty('Sin observaciones guardadas.'))}
      ${section('Lecturas guardadas', data.assessment.map(item => `<p>${safe(item.date)} · ${safe(item.headline)}</p>`).join('') || empty('Sin análisis guardado.'))}
      ${section('Cambios de fase en la semana', historyHtml(data.phases))}
      ${section('Conclusión del coach', `<p class="cp-copy">${safe(data.conclusion || 'Sin conclusión añadida.')}</p>`)}
      ${section('Próxima semana', `<h4>${safe(data.next_plan?.focus || 'Sin plan guardado para la próxima semana')}</h4><p class="cp-copy">${safe(data.next_plan?.training || '')}</p><p class="cp-copy">${safe(data.next_action || '')}</p>${reportTable(['Fecha', 'Plan'], (data.next_plan?.days || []).map(day => [day.date, day.kind === 'rest' ? 'Descanso' : day.day_name || 'Sin asignar']))}`)}
      <footer><small>AA Follow · ${n(totalCal)} kcal registradas durante el período. Los espacios sin registro permanecen sin evaluación.</small></footer></div>`;
  }
  function renderReport() {
    return `<div class="cp">${head('Informe del coach', 'Resultados, observaciones y próxima semana en un reporte.', weekControl())}<div class="cp-form">${area('Conclusión del coach', 'cp-report-conclusion', state.report?.conclusion || draft('report')?.conclusion || '')}${area('Decisiones para la próxima semana', 'cp-report-next-action', state.report?.next_action || draft('report')?.next_action || '')}</div><div class="cp-band cp-tools">${button('preview-report', icon('refresh-cw') + 'Actualizar vista')}${button('save-report', icon('bookmark') + 'Guardar informe')}${button('print-report', icon('printer') + 'Imprimir / PDF', '', 'primary')}${button('download-report', icon('download') + 'Descargar HTML')}</div><div id="cp-report-preview" class="cp-report-preview">${state.report ? reportBody(state.report) : empty('Actualiza la vista para revisar el informe de la semana.')}</div>${section('Informes guardados', list('coach_reports').map(item => `<div class="cp-row cp-item"><span>${safe(item.week)} · ${safe(String(item.created_at).slice(0, 10))}</span><div class="cp-tools">${button('read-report', 'Abrir', idAttr(item.id))}${button('delete-report', icon('trash-2'), idAttr(item.id) + ' title="Eliminar informe" aria-label="Eliminar informe"', 'icon danger')}</div></div>`).join('') || empty('Sin informes guardados.'))}</div>`;
  }
  function reportHtml(data) {
    const logo = document.querySelector('#sidebar .logo img')?.src || '';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>AA Follow - Coach ${safe(data.week)}</title><style>body{margin:0;background:#edf0ed;font:13px/1.5 Arial,sans-serif;color:#202922}main{max-width:1060px;margin:20px auto;padding:36px;background:white}h2{font-size:24px}h3{font-size:17px}.logo{width:130px;height:66px;object-fit:cover;object-position:center 52%;mix-blend-mode:multiply}.cp-band{border-top:1px solid #bbc8bf;margin-top:24px;padding-top:16px}.cp-kpis{display:flex;gap:18px;margin:20px 0}.cp-kpi{flex:1;background:#edf3ef;padding:14px}.cp-kpi strong{display:block;font-size:25px}.cp-chart{display:grid;grid-template-columns:repeat(7,1fr);gap:12px;height:160px;align-items:end;margin:25px 0 40px;padding:0 5px 20px;border-bottom:1px solid #bcc8be}.cp-bar{position:relative;background:#306897;min-height:2px;text-align:center}.cp-bar span{position:absolute;bottom:100%;left:0;right:0;font-size:11px}.cp-bar small{position:absolute;top:100%;left:0;right:0;font-size:10px}table{width:100%;border-collapse:collapse;font-size:11px}td,th{padding:8px;border-bottom:1px solid #dce4de;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#edf3ef}small{color:#566b5d}.cp-copy{white-space:pre-wrap}.cp-item{margin:10px 0}.cp-empty{padding:12px;color:#6b776f}.cp-tag{font-size:11px}.print-button{padding:10px 16px;background:#245a39;color:white;border:0;border-radius:5px;cursor:pointer}footer{margin-top:25px}@page{size:A4;margin:14mm}@media print{body{background:white}main{margin:0;padding:0;max-width:none}.print-button{display:none}.cp-kpi,.cp-chart,table{print-color-adjust:exact;-webkit-print-color-adjust:exact}tr,.cp-item{break-inside:avoid}thead{display:table-header-group}h3{break-after:avoid}}</style></head><body><main>${logo ? `<img class="logo" src="${safe(logo)}" alt="AA Follow">` : ''}<button class="print-button" onclick="window.print()">Imprimir / Guardar PDF</button>${reportBody(data)}</main></body></html>`;
  }
  function exportReport(print) {
    const data = state.report || reportData();
    const html = reportHtml(data);
    if (print) {
      const output = window.open('', '_blank');
      if (!output) throw new Error('Permite ventanas emergentes para abrir el informe.');
      output.document.open(); output.document.write(html); output.document.close();
      output.addEventListener('load', () => output.print(), { once: true });
    } else exportDownloadBlob(`aa-follow-coach-${data.week}.html`, new Blob([html], { type: 'text/html;charset=utf-8' }));
  }

  // EVENTS AND PUBLIC API
  function mutateMap() {
    const map = loadMap();
    if (el('cp-map-title')) map.title = val('cp-map-title');
    const node = map.nodes.find(row => row.id === state.selectedNode);
    if (node && el('cp-node-text')) {
      node.text = val('cp-node-text'); node.source = val('cp-node-source'); node.date = val('cp-node-date');
      node.x = Math.max(0, Math.min(828, num(val('cp-node-x')))); node.y = Math.max(0, Math.min(530, num(val('cp-node-y'))));
      const target = document.querySelector(`[data-cp-node="${CSS.escape(node.id)}"]`);
      if (target) { target.style.left = node.x + 'px'; target.style.top = node.y + 'px'; target.querySelector('strong').textContent = node.text; }
      const svg = el('cp-map-board')?.querySelector('svg'); if (svg) svg.outerHTML = mapSvg(map);
    }
    mapDraft();
  }
  function removeRecord(collection, id, label) {
    if (!list(collection).some(row => row.id === id) || !confirm(`¿Eliminar ${label}? Se conservará en la papelera.`)) return false;
    DB.del(collection, id); notify('Enviado a la papelera'); return true;
  }
  const actions = {
    'previous-week': () => changeWeek(weekValueFromDate(addDays(weekDates()[0], -7))),
    'next-week': () => changeWeek(weekValueFromDate(addDays(weekDates()[0], 7))),
    'current-week': () => changeWeek(weekValueFromDate(today())),
    'plan-day': target => { state.day = target.dataset.date; redraw(); },
    'add-exercise': () => { planDay().exercises.push({ name: '', sets: 3, reps: 10, weight: null }); persistPlanDraft(); redraw(); },
    'remove-exercise': target => { planDay().exercises.splice(+target.dataset.index, 1); persistPlanDraft(); redraw(); },
    'load-prescription': loadPrescription,
    'save-plan': savePlan,
    'copy-plan': copyPlan,
    'open-plan': target => changeWeek(target.dataset.week),
    'open-planning': () => setCoachView('planning'),
    'open-preparation': () => go('preparation'),
    'new-map': () => { state.map = { id: uid(), title: '', nodes: [{ id: uid(), text: 'Idea central', x: 414, y: 60, source: '' }], edges: [] }; state.selectedNode = ''; mapDraft(); redraw(); },
    'save-map': saveMap,
    'delete-map': target => { if (removeRecord('coach_maps', target.dataset.id, 'este mapa')) { state.map = null; coachSelectedMapId = ''; clearDraft('map'); redraw(); } },
    'add-node': () => { const map = loadMap(); const node = { id: uid(), text: 'Nuevo concepto', x: 40 + (map.nodes.length % 4) * 230, y: 230 + (Math.floor(map.nodes.length / 4) % 3) * 110, source: '' }; map.nodes.push(node); state.selectedNode = node.id; mapDraft(); redraw(); },
    'delete-node': () => { const map = loadMap(); if (map.nodes.length < 2) throw new Error('El mapa necesita al menos un concepto.'); map.nodes = map.nodes.filter(node => node.id !== state.selectedNode); map.edges = map.edges.filter(edge => edge.from !== state.selectedNode && edge.to !== state.selectedNode); state.selectedNode = ''; mapDraft(); redraw(); },
    'add-edge': () => { const map = loadMap(); const from = val('cp-edge-from'); const to = val('cp-edge-to'); if (!from || !to || from === to) throw new Error('Elige dos conceptos distintos.'); if (map.edges.some(edge => edge.from === from && edge.to === to)) throw new Error('Esta conexión ya existe.'); map.edges.push({ id: uid(), from, to }); mapDraft(); redraw(); },
    'delete-edge': target => { state.map.edges = state.map.edges.filter(edge => edge.id !== target.dataset.id); mapDraft(); redraw(); },
    'reset-journal': () => { state.journalId = ''; clearDraft('journal'); redraw(); },
    'edit-journal': target => { state.journalId = target.dataset.id; redraw(); },
    'resolve-journal': target => { const entry = list('coach_journal').find(row => row.id === target.dataset.id); if (entry) put('coach_journal', { ...entry, status: entry.status === 'done' ? 'pending' : 'done', updated_at: now() }); redraw(); },
    'delete-journal': target => { if (removeRecord('coach_journal', target.dataset.id, 'esta entrada')) { if (state.journalId === target.dataset.id) state.journalId = ''; redraw(); } },
    'new-guideline': () => { state.guidelineId = ''; clearDraft('guideline'); redraw(); },
    'edit-guideline': target => { state.guidelineId = target.dataset.id; redraw(); },
    'toggle-guideline': target => { const item = list('coach_guidelines').find(row => row.id === target.dataset.id); if (item) put('coach_guidelines', { ...item, active: item.active === false, updated_at: now() }); redraw(); },
    'delete-guideline': target => { if (removeRecord('coach_guidelines', target.dataset.id, 'esta pauta')) { state.guidelineId = ''; redraw(); } },
    'check-guideline': target => { const item = list('coach_guidelines').find(row => row.id === target.dataset.id); const date = target.dataset.date; if (!item || item.active === false || date > today() || (item.metric && item.metric !== 'manual') || !guidelineDates(item).includes(date)) return; const checks = { ...item.checks }; if (checks[date]) delete checks[date]; else checks[date] = { completed_at: now() }; put('coach_guidelines', { ...item, checks, updated_at: now() }); redraw(); },
    'inspect-guideline': target => { const item = list('coach_guidelines').find(row => row.id === target.dataset.id); if (!item) return; const reading = guidelineReading(item, target.dataset.date); notify(reading.known ? `${n(reading.value)} / ${n(item.target)} · ${reading.done ? 'Cumplida' : 'Meta pendiente'}` : 'Sin registro para comprobar esta pauta.'); },
    effort: target => openEffort(target.dataset.id),
    'close-effort': () => el('cp-effort-modal')?.remove(),
    'preview-report': () => { state.report = reportData(); redraw(); },
    'save-report': () => { const data = state.report || reportData(); data.conclusion = val('cp-report-conclusion'); data.next_action = val('cp-report-next-action'); put('coach_reports', clone(data)); state.report = data; notify('Informe guardado'); redraw(); },
    'read-report': target => { const data = list('coach_reports').find(row => row.id === target.dataset.id); if (data) { state.week = data.week; state.anchor = getWeekDates(data.week)[0]; if (el('global-date')) el('global-date').value = state.anchor; syncDateControls(state.anchor); state.plan = null; state.report = clone(data); redraw(); } },
    'delete-report': target => { if (removeRecord('coach_reports', target.dataset.id, 'este informe')) { if (state.report?.id === target.dataset.id) state.report = null; redraw(); } },
    'print-report': () => exportReport(true),
    'download-report': () => exportReport(false)
  };
  function guarded(callback) {
    try { callback(); refreshInterfaceIcons(); }
    catch (error) { console.error(error); toast(error.message || 'No se pudo guardar el cambio.', 'err'); }
  }
  document.addEventListener('click', event => {
    const target = event.target.closest?.('[data-cp-action]');
    if (!target || target.disabled) return;
    const action = target.dataset.cpAction;
    if (!actions[action]) return;
    event.preventDefault();
    guarded(() => { if (!['close-effort', 'effort'].includes(action)) protect(); actions[action](target); });
  });
  document.addEventListener('submit', event => {
    const name = event.target.dataset?.cpForm;
    if (!name) return;
    event.preventDefault();
    guarded(() => { if (name !== 'effort') protect(); ({ journal: saveJournal, guideline: saveGuideline, effort: saveEffort })[name]?.(); });
  });
  document.addEventListener('change', event => {
    const target = event.target; const key = target.dataset?.cpChange;
    if (!key) return;
    guarded(() => {
      protect();
      if (key === 'week') return changeWeek(target.value);
      if (key === 'guide-metric') { configureGuidelineMetric(); setDraft('guideline', { ...guidelineFormValue(), id: state.guidelineId }); }
      if (key === 'plan-kind') { planDay().kind = target.value; persistPlanDraft(); redraw(); }
      if (key === 'plan-routine') { const day = planDay(); day.routine_id = target.value; day.routine_day_id = ''; persistPlanDraft(); redraw(); }
      if (key === 'plan-routine-day') { planDay().routine_day_id = target.value; persistPlanDraft(); redraw(); }
      if (key === 'session') {
        if (coachActiveView === 'planning') { planDay(target.dataset.date).session_id = target.value; persistPlanDraft(); }
        else { const plan = savedPlan(); if (plan) { const day = plan.days.find(row => row.date === target.dataset.date); if (day) { day.session_id = target.value; plan.updated_at = now(); put('coach_plans', plan); } } }
        redraw();
      }
      if (key === 'map-open' && target.value) { const map = list('coach_maps').find(row => row.id === target.value); if (map) { state.map = normalizeMap(map); coachSelectedMapId = map.id; state.selectedNode = ''; mapDraft(); redraw(); } }
      if (key === 'journal-type') { el('cp-journal-link').innerHTML = linkOptions(target.value, ''); setDraft('journal', journalFormValue()); }
    });
  });
  document.addEventListener('input', event => {
    const target = event.target;
    if (!target.closest?.('.cp')) return;
    if (target.closest('.tp')) return;
    guarded(() => {
      if (target.closest('#cp-effort-modal')) {
        const data = effortValue(false); const drafts = DB.get('coach_effort_drafts') || {}; drafts[data.id] = data; DB.set('coach_effort_drafts', drafts);
        if (el('cp-effort-status')) el('cp-effort-status').textContent = 'Borrador guardado';
        return;
      }
      protect();
      if (target.closest('[data-cp-form="journal"]')) setDraft('journal', { ...journalFormValue(), id: state.journalId });
      if (target.closest('[data-cp-form="guideline"]')) setDraft('guideline', { ...guidelineFormValue(), id: state.guidelineId });
      if (target.id.startsWith('cp-plan-') && target.id !== 'cp-plan-copy-week') capturePlan();
      if (target.dataset.cpExercise) { const exercise = planDay().exercises[+target.dataset.index]; const key = target.dataset.cpExercise; exercise[key] = key === 'name' ? target.value : optionalNumber(target.value); persistPlanDraft(); }
      if (target.dataset.cpDayField) { planDay()[target.dataset.cpDayField] = target.value; persistPlanDraft(); }
      if (target.id.startsWith('cp-map-') || target.id.startsWith('cp-node-')) mutateMap();
      if (target.id.startsWith('cp-report-')) { const data = { conclusion: val('cp-report-conclusion'), next_action: val('cp-report-next-action') }; setDraft('report', data); if (state.report) Object.assign(state.report, data); }
    });
  });
  function render(view) {
    if (state.anchor !== selectedDate()) { state.anchor = selectedDate(); state.week = weekValueFromDate(selectedDate()); state.plan = null; state.day = ''; state.report = null; }
    return ({ planning: renderPlanning, maps: renderMaps, guidelines: renderGuidelines, journal: renderJournal, history: renderHistory, report: renderReport })[view]?.();
  }
  function mount(view) {
    if (view === 'guidelines') configureGuidelineMetric();
    if (view === 'monitor' || view === 'analysis') {
      const dates = weekDates();
      el('coach-workspace')?.insertAdjacentHTML('beforeend', comparisonWeekHtml() + effortSummary(list('sessions').filter(row => dates.includes(row.date))));
    }
    if (view === 'journal') {
      const saved = draft('journal'); if (!state.journalId && saved?.id) state.journalId = saved.id;
    }
  }
  function invalidatePlans() { state.plan = null; state.report = null; }
  return { render, mount, openEffort, recordPhase, compareDay, guidelineReading, guidelineDates, phaseSnapshot, normalizeMap, reportData, reportHtml, validatePlan, invalidatePlans };
})();

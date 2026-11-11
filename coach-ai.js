/* Conversations propose changes; only the explicit review action commits an agreement. */
window.CoachAI = (() => {
  'use strict';
  const C = window.CoachContract;
  const clone = value => JSON.parse(JSON.stringify(value));
  const rows = key => { const data = DB.get(key); return Array.isArray(data) ? data : []; };
  const now = () => new Date().toISOString();
  const norm = value => String(value || '').trim().toLocaleLowerCase('es').replace(/\s+/g, ' ');
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const button = (action, label, extra = '', style = '') => `<button type="button" class="${style}" data-cai="${action}" ${extra}>${label}</button>`;
  const watchKeys = ['nutconfig', 'routines', 'coach_plans', 'preparation_plans', 'preparation_active_id', 'goals', 'calendar_events', 'coach_guidelines', 'coach_workspace_drafts'];
  const labels = { calories: 'Calorías diarias', protein: 'Proteína (g)', carbs: 'Carbohidratos (g)', fat: 'Grasas (g)', sets: 'Series', reps: 'Repeticiones', weight: 'Carga (kg)', weekly_volume_target: 'Volumen semanal (kg)', training_volume_pct: 'Volumen (%)', load_min_pct: 'Carga mínima (%)', load_max_pct: 'Carga máxima (%)', title: 'Título', target: 'Meta', unit: 'Unidad', type: 'Tipo', date: 'Fecha', all_day: 'Todo el día', start_time: 'Inicio', end_time: 'Fin', category: 'Área', notes: 'Notas', copy: 'Pauta', start_date: 'Desde', end_date: 'Hasta' };
  let selectedId = '', controller = null, runningId = '', status = '', error = '';
  const activeView = () => coachModeUnlocked && coachActiveView === 'chat' && document.querySelector('.page.active')?.id === 'page-coach';
  function guard() { if (!coachModeUnlocked) throw new Error('Abre Modo Coach antes de continuar.'); }
  function thread() { return rows('coach_ai_threads').find(item => item.id === selectedId) || null; }
  function saveThread(item) {
    const all = rows('coach_ai_threads'), index = all.findIndex(row => row.id === item.id);
    item.updated_at = now();
    if (index < 0) all.unshift(item); else all[index] = item;
    DB.set('coach_ai_threads', all);
  }
  function newThread() {
    guard(); suspend();
    if (rows('coach_ai_threads').length >= 80) throw new Error('Alcanzaste 80 conversaciones. Tus conversaciones anteriores se conservaron.');
    const item = { id: uid(), title: 'Nueva conversación', created_at: now(), updated_at: now(), messages: [], draft: '', pending: null };
    saveThread(item); selectedId = item.id; DB.set('coach_ai_active_thread', item.id); error = ''; status = ''; redraw();
  }
  function ensureThread() {
    if (!selectedId) selectedId = DB.get('coach_ai_active_thread') || rows('coach_ai_threads')[0]?.id || '';
    if (!thread()) {
      const item = { id: uid(), title: 'Nueva conversación', created_at: now(), updated_at: now(), messages: [], draft: '', pending: null };
      saveThread(item); selectedId = item.id; DB.set('coach_ai_active_thread', item.id);
    }
    return thread();
  }
  function snapshots() { return Object.fromEntries(watchKeys.map(key => [key, JSON.stringify(DB.get(key))])); }
  function unchanged(baseline) { return watchKeys.every(key => baseline?.[key] === JSON.stringify(DB.get(key))); }
  function phase() {
    const all = rows('preparation_plans');
    return all.find(item => item.id === DB.get('preparation_active_id') && item.status === 'active') || all.find(item => item.status === 'active') || null;
  }
  function targetState(exercise, date = today()) {
    const base = exercise.coach_base || { sets: +(exercise.target_sets || exercise.sets || 1), reps: +(exercise.reps || exercise.target_reps || 1), weight: exercise.weight ?? null };
    const value = { ...base }, fields = new Set();
    (exercise.coach_prescriptions || []).map((item, index) => ({ ...item, index })).filter(item => item.effective_date <= date).sort((a, b) => a.effective_date.localeCompare(b.effective_date) || a.index - b.index).forEach(item => {
      Object.assign(value, item.data); Object.keys(item.data).forEach(key => fields.add(key));
    });
    return { ...value, fields: [...fields] };
  }
  function exerciseCatalog() {
    return rows('routines').flatMap(routine => (routine.days || []).flatMap(day => (day.exercises || []).map((exercise, index) => ({ routine_id: routine.id, routine_name: routine.name, day_id: day.id, day_name: day.name, exercise_index: index, name: exercise.name, ...targetState(exercise), scheduled: (exercise.coach_prescriptions || []).filter(item => item.effective_date > today()).slice(-6).map(item => ({ effective_date:item.effective_date, data:item.data })) }))));
  }
  function planCatalog() {
    return rows('coach_plans').flatMap(plan => (plan.days || []).filter(day => day.kind === 'training' && day.date >= today()).flatMap(day => (day.exercises || []).map((exercise, index) => ({ plan_id: plan.id, date: day.date, routine_id: day.routine_id, day_id: day.routine_day_id, exercise_index: index, name: exercise.name, sets: exercise.sets, reps: exercise.reps, weight: exercise.weight }))));
  }
  function context(full = false) {
    const current = phase();
    const catalog = exerciseCatalog(), plans = planCatalog();
    const compact = (key, fields, count) => rows(key).slice(0, count).map(item => Object.fromEntries(['id', ...fields].filter(field => item[field] !== undefined).map(field => [field, item[field]])));
    const result = {
      today: today(), selected_date: selectedDate(), nutrition: DB.get('nutconfig') || {},
      phase: current ? { ...window.CoachPro?.phaseSnapshot(current), id: current.id, format_ready: current.manual_configuration === true && current.cycles?.length === 1 } : null,
      exercise_catalog: full ? catalog : catalog.slice(0, 180), plan_catalog: full ? plans : plans.slice(0, 80),
      goals: compact('goals', ['title', 'target', 'unit', 'type', 'status'], full ? 500 : 15),
      events: compact('calendar_events', ['title', 'date', 'all_day', 'start_time', 'end_time', 'category', 'notes'], full ? 1000 : 20),
      guidelines: compact('coach_guidelines', ['title', 'copy', 'start_date', 'end_date'], full ? 500 : 15)
    };
    if (!full) {
      result.body = compact('bodylogs', ['date', 'weight', 'body_fat'], 12);
      result.recent_sessions = rows('sessions').slice().filter(item => item.date <= today()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map(item => ({ date: item.date, routine: item.routine_name, day: item.day_name, fatigue: item.coach_review?.fatigue, discomfort: (item.coach_review?.exercises || []).filter(row => +row.pain > 0).slice(0, 5), exercises: [...new Set((item.sets || []).map(set => set.exercise_name))].slice(0, 10).map(name => { const sets = (item.sets || []).filter(set => set.exercise_name === name && !['warmup', 'warm-up', 'calentamiento'].includes(norm(set.type || set.set_type))); return { name, working_sets: sets.length, reps: sets.map(set => set.reps), kg: sets.map(set => set.weight), rir: sets.map(set => set.rir ?? null) }; }) }));
      const start = addDays(today(), -6), meals = rows('meals').filter(item => item.date >= start && item.date <= today());
      result.recent_nutrition = { days_with_meals: new Set(meals.map(item => item.date)).size, total_calories_recorded: meals.reduce((sum, item) => sum + (+item.calories || 0), 0), total_protein_recorded: meals.reduce((sum, item) => sum + (+item.protein || 0), 0), free_days: Object.keys(DB.get('free_days') || {}).filter(date => date >= start && date <= today()), unrecorded_days_are_unknown: true };
      result.last_agreements = rows('coach_ai_agreements').slice(0, 3).map(item => ({ summary: item.summary, applied_at: item.applied_at, changes: item.changes }));
      result.pending_proposal = thread()?.pending ? { summary: thread().pending.summary, operations: thread().pending.operations } : null;
      result.context_truncated = catalog.length > result.exercise_catalog.length || plans.length > result.plan_catalog.length;
      while (JSON.stringify(result).length > 52000 && (result.exercise_catalog.length > 10 || result.plan_catalog.length > 10)) {
        if (result.exercise_catalog.length > 10) result.exercise_catalog.pop();
        if (result.plan_catalog.length > 10) result.plan_catalog.pop();
        result.context_truncated = true;
      }
    }
    return result;
  }
  function buildPlan(operations, agreementId) {
    const normalized = C.normalize({ message: 'Propuesta', operations }, context(true));
    if (normalized.needs_clarification || !normalized.operations.length) throw new Error(normalized.warnings.join(' ') || 'No hay cambios válidos para aplicar.');
    const staged = {}, changes = [], warnings = [], touchedWeeks = new Set();
    const read = key => { if (!Object.hasOwn(staged, key)) staged[key] = clone(DB.get(key) ?? (key === 'nutconfig' ? {} : [])); return staged[key]; };
    const change = (area, destination, before, after, fields) => {
      const differences = fields.filter(key => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)).map(key => ({ label: labels[key] || key, field: key, before: before[key] ?? null, after: after[key] ?? null }));
      if (differences.length) changes.push({ area, destination, fields: differences });
    };
    const currentPhase = phase(), previousPhase = currentPhase ? clone(currentPhase) : null;
    let nextPhase = null, nutritionChange = null;
    function phaseCopy() {
      if (!currentPhase) return null;
      if (currentPhase.manual_configuration !== true || currentPhase.cycles?.length !== 1) throw new Error('La fase activa usa un formato anterior. Ábrela y guárdala antes de aplicar este acuerdo.');
      if (!nextPhase) nextPhase = read('preparation_plans').find(item => item.id === currentPhase.id);
      return nextPhase;
    }
    const stamp = { agreement_id: agreementId, agreed_at: now() };
    for (const operation of normalized.operations) {
      const { type, target, data } = operation;
      if (type === 'nutrition') {
        const config = read('nutconfig'), before = clone(config);
        Object.assign(config, data); nutritionChange = { before, after: clone(config) };
        change('Nutrición', 'Objetivo diario actual', before, config, Object.keys(data));
        const plan = phaseCopy();
        if (plan) {
          const beforeCycle = clone(plan.cycles[0]);
          const targets = Object.fromEntries(Object.keys(C.nutritionFields).filter(key => config[key] !== undefined).map(key => [key, config[key]]));
          Object.assign(plan.cycles[0], targets); Object.assign(plan.baseline ||= {}, targets);
          plan.updated_at = now(); plan.ai_review_stale = true;
          change('Fase', plan.name || plan.cycles[0].name || 'Fase activa', beforeCycle, plan.cycles[0], Object.keys(C.nutritionFields));
        }
        const macroEnergy = (+config.protein || 0) * 4 + (+config.carbs || 0) * 4 + (+config.fat || 0) * 9;
        if (Math.abs(macroEnergy - config.calories) > Math.max(100, config.calories * .1)) warnings.push('Las calorías y la energía de los macros no coinciden. Revisa este punto con el coach antes de autorizar.');
      }
      if (type === 'phase_training') {
        const plan = phaseCopy(); if (!plan || plan.id !== target.id) throw new Error('La fase activa cambió.');
        const before = clone(plan.cycles[0]); Object.assign(plan.cycles[0], data);
        if (plan.cycles[0].load_min_pct > plan.cycles[0].load_max_pct) throw new Error('La carga mínima no puede superar la máxima.');
        plan.updated_at = now(); plan.ai_review_stale = true;
        change('Fase', plan.name || 'Referencia de entrenamiento', before, plan.cycles[0], Object.keys(data));
        if (data.training_volume_pct !== undefined && !normalized.operations.some(item => ['exercise_target', 'plan_exercise'].includes(item.type))) warnings.push('El porcentaje de fase no cambia por sí solo las series de los ejercicios.');
      }
      if (type === 'exercise_target') {
        const routine = read('routines').find(item => item.id === target.routine_id), day = routine?.days?.find(item => item.id === target.day_id), exercise = day?.exercises?.[target.exercise_index];
        if (!exercise || exercise.name !== target.name) throw new Error('La rutina cambió desde la propuesta.');
        if ((day.exercises || []).filter(item => norm(item.name) === norm(exercise.name)).length !== 1) throw new Error('Ese ejercicio está repetido en el mismo día. Identifícalo antes de cambiarlo.');
        exercise.coach_base ||= { sets: +(exercise.target_sets || exercise.sets || 1), reps: +(exercise.reps || exercise.target_reps || 1), weight: exercise.weight ?? null };
        const before = targetState(exercise, operation.effective_date);
        const history = exercise.coach_prescriptions ||= [];
        if (history.length >= 100) throw new Error('Este ejercicio alcanzó el límite de prescripciones conservadas.');
        if (history.some(item => item.effective_date > operation.effective_date)) warnings.push(`${exercise.name} tiene prescripciones posteriores ya acordadas. Esas fechas posteriores se conservan.`);
        history.push({ ...stamp, effective_date: operation.effective_date, data: clone(data) });
        const after = targetState(exercise, operation.effective_date), current = targetState(exercise);
        exercise.target_sets = current.sets; exercise.reps = current.reps; if (current.weight != null) exercise.weight = current.weight;
        change('Rutina', `${routine.name} / ${day.name} / ${exercise.name} · desde ${operation.effective_date}`, before, after, Object.keys(data));
        for (const plan of read('coach_plans')) for (const plannedDay of plan.days || []) {
          if (plannedDay.kind !== 'training' || plannedDay.date < operation.effective_date || plannedDay.routine_id !== routine.id || plannedDay.routine_day_id !== day.id) continue;
          const matches = (plannedDay.exercises || []).filter(item => norm(item.name) === norm(exercise.name));
          if (matches.length > 1) throw new Error(`Hay ejercicios repetidos en el plan del ${plannedDay.date}.`);
          if (!matches.length) continue;
          const plannedExercise = matches[0], previous = clone(plannedExercise), resolved = targetState(exercise, plannedDay.date);
          Object.keys(data).forEach(key => plannedExercise[key] = resolved[key]);
          if (!Number.isInteger(plannedExercise.sets) || plannedExercise.sets < 1 || !Number.isInteger(plannedExercise.reps) || plannedExercise.reps < 1) throw new Error(`El plan del ${plannedDay.date} necesita series y repeticiones completas.`);
          plannedExercise.coach_ai = { ...stamp, effective_date: operation.effective_date }; plan.updated_at = now(); touchedWeeks.add(plan.week);
          change('Calendario y plan', `${plannedDay.date} / ${plannedExercise.name}`, previous, plannedExercise, Object.keys(data));
        }
      }
      if (type === 'plan_exercise') {
        const plan = read('coach_plans').find(item => item.id === target.plan_id), day = plan?.days?.find(item => item.date === target.date), exercise = day?.exercises?.[target.exercise_index];
        if (!exercise || exercise.name !== target.name) throw new Error('El día planificado cambió.');
        const routineOperations = normalized.operations.filter(item => item.type === 'exercise_target');
        if (routineOperations.some(item => item.target.routine_id === day.routine_id && item.target.day_id === day.routine_day_id && norm(item.target.name) === norm(exercise.name) && item.effective_date <= day.date)) throw new Error('El mismo ejercicio del plan se está modificando dos veces.');
        const before = clone(exercise); Object.assign(exercise, data); exercise.coach_ai = { ...stamp, effective_date: operation.effective_date };
        if (!Number.isInteger(exercise.sets) || exercise.sets < 1 || !Number.isInteger(exercise.reps) || exercise.reps < 1) throw new Error('El ejercicio planificado necesita series y repeticiones completas.');
        if (!day.routine_id || !day.routine_day_id) warnings.push(`El plan del ${day.date} no está vinculado a una rutina. Se actualiza ese plan, no una rutina del gimnasio.`);
        plan.updated_at = now(); touchedWeeks.add(plan.week);
        change('Calendario y plan', `${target.date} / ${exercise.name}`, before, exercise, Object.keys(data));
      }
      if (['goal', 'calendar_event', 'guideline'].includes(type)) {
        const key = { goal: 'goals', calendar_event: 'calendar_events', guideline: 'coach_guidelines' }[type], all = read(key), existing = Object.hasOwn(target, 'id') ? all.find(item => item.id === target.id) : null;
        const defaults = type === 'goal' ? { status: 'active', current: 0, type: 'other', unit: '' } : type === 'calendar_event' ? { category: 'personal', color: 'blue', all_day: true, notes: '' } : { area: 'general', metric: 'manual', target: 1, frequency: 'daily', active: true, checks: {} };
        const entry = { ...(existing || defaults), ...data, id: existing?.id ?? uid(), updated_at: now(), created_at: existing?.created_at || now(), coach_ai: stamp };
        if (type === 'goal' && (!(entry.target > 0) || !entry.title)) throw new Error('El objetivo necesita una meta positiva y un título.');
        if (type === 'guideline' && !entry.copy) throw new Error('La pauta necesita una acción concreta.');
        if (existing) all[all.indexOf(existing)] = entry; else all.unshift(entry);
        change({ goal: 'Objetivos', calendar_event: 'Calendario', guideline: 'Pautas' }[type], entry.title, existing || {}, entry, Object.keys(data));
      }
    }
    const drafts = DB.get('coach_workspace_drafts') || {};
    if ([...touchedWeeks].some(week => Object.keys(drafts).some(key => key.startsWith('plan:') && key.endsWith(':' + week)))) throw new Error('Hay un borrador manual del plan afectado. Guárdalo o descártalo antes de revisar este acuerdo.');
    if (changes.length > 200) throw new Error('El acuerdo afecta demasiados destinos. Divide el cambio en acuerdos más pequeños.');
    if (!changes.length) throw new Error('Los valores ya coinciden; no hay cambios pendientes.');
    if (nextPhase && JSON.stringify(previousPhase) !== JSON.stringify(nextPhase)) {
      const before = window.CoachPro?.phaseSnapshot(previousPhase), after = window.CoachPro?.phaseSnapshot(nextPhase);
      staged.coach_phase_history = [{ id: uid(), date: today(), changed_at: now(), action: 'coach_ai_agreement', plan_id: nextPhase.id, before, after, ...stamp }, ...rows('coach_phase_history')];
    }
    if (nutritionChange) staged.preparation_macro_history = [{ id: uid(), plan_id: currentPhase?.id || null, cycle: currentPhase?.cycles?.[0]?.name || 'Acuerdo Coach', previous: nutritionChange.before, next: nutritionChange.after, applied_at: now(), source: 'coach_ai_agreement', ...stamp }, ...rows('preparation_macro_history')].slice(0, 80);
    return { staged, changes, warnings };
  }
  function commit(staged) { appAiCommitMutationPlan(new Map(Object.entries(staged))); }
  function redraw() { if (activeView()) renderCoachWorkspace(); }
  function display(value) { return value == null || value === '' ? 'Sin definir' : typeof value === 'boolean' ? value ? 'Sí' : 'No' : String(value); }
  function proposalHtml(item) {
    const pending = item.pending;
    if (!pending) return `<aside class="cai-review"><h3>Acuerdo</h3><p>Sin cambios pendientes</p><dl class="cai-current"><dt>Calorías diarias</dt><dd>${esc((DB.get('nutconfig') || {}).calories ?? 'Sin definir')} kcal</dd><dt>Proteína</dt><dd>${esc((DB.get('nutconfig') || {}).protein ?? 'Sin definir')} g</dd><dt>Fase activa</dt><dd>${esc(phase()?.name || phase()?.cycles?.[0]?.name || 'Sin fase activa')}</dd></dl></aside>`;
    let plan = null, problem = '';
    try { if (!unchanged(pending.baseline)) throw new Error('Los datos cambiaron desde esta propuesta. Pide al coach una versión actualizada antes de aplicarla.'); plan = buildPlan(pending.operations, pending.id); }
    catch (failure) { problem = failure.message; }
    return `<aside class="cai-review" aria-label="Acuerdo pendiente"><header><span class="cp-tag warn">Pendiente de autorización</span><h3>${esc(pending.summary)}</h3></header>
      ${[...new Set([...(pending.warnings || []), ...(plan?.warnings || [])])].map(warning => `<p class="cai-warning">${esc(warning)}</p>`).join('')}
      ${problem ? `<p role="alert" class="cai-error">${esc(problem)}</p>` : `<div class="cai-changes">${plan.changes.map(change => `<section><small>${esc(change.area)}</small><h4>${esc(change.destination)}</h4><table><thead><tr><th>Dato</th><th>Antes</th><th>Acordado</th></tr></thead><tbody>${change.fields.map(field => `<tr><td>${esc(field.label)}</td><td>${esc(display(field.before))}</td><td>${esc(display(field.after))}</td></tr>`).join('')}</tbody></table></section>`).join('')}</div><p class="cai-scope">Los registros realizados y el entrenamiento iniciado se conservan.</p><label class="cai-consent"><input id="cai-consent" type="checkbox">Autorizo todos los cambios mostrados en este acuerdo.</label>`}
      <div class="cp-tools">${button('discard', icon('x') + 'Descartar')}${button('apply', icon('check-check') + 'Aplicar acuerdo', 'id="cai-apply" disabled', 'primary')}</div></aside>`;
  }
  function render(view) {
    if (view !== 'chat') return undefined;
    const item = ensureThread(), busy = Boolean(controller), messages = item.messages || [];
    return `<div class="cp cai"><div class="cp-head"><div><h2>Coach IA</h2><p>${esc(status || (busy ? 'Conversando...' : 'Conversación y acuerdos'))}</p></div><div class="cp-tools"><label>Conversación<select id="cai-thread" ${busy ? 'disabled' : ''}>${rows('coach_ai_threads').map(row => `<option value="${esc(row.id)}" ${row.id === item.id ? 'selected' : ''}>${esc(row.title)}</option>`).join('')}</select></label>${button('new', icon('message-circle-plus'), 'title="Nueva conversación" aria-label="Nueva conversación"')}</div></div>
      <div class="cai-layout"><section class="cai-conversation"><div id="cai-messages" class="cai-messages" role="log" aria-label="Conversación con el coach" aria-live="polite">${messages.length ? messages.map(message => `<article class="cai-message ${message.role}"><header><strong>${message.role === 'user' ? 'Tú' : message.role === 'event' ? 'Acuerdo' : 'Coach IA'}</strong><time>${esc(new Date(message.created_at).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' }))}</time></header><div>${esc(message.text)}</div></article>`).join('') : '<div class="cai-empty"><i data-lucide="messages-square"></i><h3>Tu conversación</h3></div>'}${busy ? '<p class="cai-pending" role="status">El coach está preparando su respuesta...</p>' : ''}</div>
      ${error ? `<p class="cai-error" role="alert">${esc(error)}</p>` : ''}${item.request_id && !busy ? '<p class="cai-warning">La consulta anterior se interrumpió. Tu mensaje se conservó.</p>' : ''}
      <form id="cai-form" class="cai-composer"><label for="cai-message">Mensaje</label><textarea id="cai-message" maxlength="4000" rows="3" required ${busy ? 'disabled' : ''} placeholder="¿Qué revisamos hoy?">${esc(item.draft || '')}</textarea><div class="cp-tools">${busy ? button('stop', icon('square') + 'Detener') : `<button type="submit" class="primary" id="cai-send">${icon('send')}Enviar</button>`}${button('profile', icon('plug-zap') + 'Mi conexión de IA')}</div></form></section>${proposalHtml(item)}</div>
      ${rows('coach_ai_agreements').length ? `<section class="cp-band"><h3>Acuerdos aplicados</h3>${rows('coach_ai_agreements').slice(0, 8).map(agreement => `<details class="cai-receipt"><summary>${esc(agreement.summary)} <small>${esc(new Date(agreement.applied_at).toLocaleString('es-AR'))}</small></summary>${agreement.changes.map(change => `<p><strong>${esc(change.destination)}</strong><br>${change.fields.map(field => `${esc(field.label)}: ${esc(display(field.before))} → ${esc(display(field.after))}`).join('<br>')}</p>`).join('')}</details>`).join('')}</section>` : ''}</div>`;
  }
  function mount(view) { if (view === 'chat') { const log = document.getElementById('cai-messages'); if (log) log.scrollTop = log.scrollHeight; } }
  async function send(event) {
    event?.preventDefault(); guard(); if (controller) return;
    const item = ensureThread(), input = document.getElementById('cai-message'), request = (input?.value || item.draft || '').trim();
    if (request.length < 2 || request.length > 4000) throw new Error('Escribe un mensaje de entre 2 y 4000 caracteres.');
    if (item.messages.length >= 100) throw new Error('Esta conversación tiene 100 mensajes. Abre una nueva; el historial se conserva.');
    const payloadContext = context(), baseline = snapshots(), previous = item.messages.filter(message => ['user', 'assistant'].includes(message.role)).slice(-16);
    const requestId = uid(); item.request_id = requestId; item.pending = null; item.draft = '';
    item.messages.push({ id: uid(), role:'user', text:request, created_at:now() });
    if (item.title === 'Nueva conversación') item.title = request.slice(0, 65);
    saveThread(item); controller = new AbortController(); runningId = item.id; error = ''; status = ''; redraw();
    const signal = controller.signal;
    try {
      const response = await accountFetch('/api/app-assistant', { method:'POST', headers:{'Content-Type':'application/json'}, signal, body:JSON.stringify({ mode:'coach_chat', request, messages:previous.map(message => ({role:message.role,text:message.text.slice(0,1800)})), context:payloadContext }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo consultar al coach.');
      const current = rows('coach_ai_threads').find(row => row.id === item.id);
      if (signal.aborted || !coachModeUnlocked || current?.request_id !== requestId) return;
      const normalized = C.normalize(data, payloadContext);
      current.messages.push({ id:uid(), role:'assistant', text:normalized.message, created_at:now() });
      current.request_id = null;
      if (normalized.operations.length) current.pending = { id:uid(), summary:normalized.summary, operations:normalized.operations, warnings:normalized.warnings, baseline, created_at:now() };
      else if (normalized.warnings.length) current.messages.push({ id:uid(), role:'event', text:normalized.warnings.join('\n'), created_at:now() });
      saveThread(current);
    } catch (failure) {
      if (!signal.aborted) {
        error = failure.message || 'No se pudo consultar al coach.';
        const current = rows('coach_ai_threads').find(row => row.id === item.id);
        if (current?.request_id === requestId) { current.request_id = null; current.messages.push({ id:uid(),role:'event',text:error,created_at:now() }); saveThread(current); }
      }
    } finally { if (!signal.aborted) { controller = null; runningId = ''; redraw(); } }
  }
  function suspend() {
    if (!controller) return;
    controller.abort(); controller = null;
    const id = runningId; runningId = '';
    try {
      const current = rows('coach_ai_threads').find(row => row.id === id);
      if (current?.request_id) { current.request_id = null; current.messages.push({ id:uid(), role:'event', text:'Consulta detenida. No se cambió ningún dato.', created_at:now() }); saveThread(current); }
    } catch {}
  }
  function apply() {
    guard(); const item = thread(), pending = item?.pending;
    if (!pending || !document.getElementById('cai-consent')?.checked) throw new Error('Revisa el acuerdo y marca tu autorización antes de aplicar.');
    if (rows('coach_ai_agreements').some(agreement => agreement.id === pending.id)) throw new Error('Este acuerdo ya fue aplicado.');
    if (!unchanged(pending.baseline)) throw new Error('Los datos cambiaron. Pide una propuesta actualizada; no se sobrescribió nada.');
    const plan = buildPlan(pending.operations, pending.id);
    if (!confirm(`¿Aplicar este acuerdo en ${plan.changes.length} destino(s)? Se actualizarán solo los valores que acabas de revisar.`)) return;
    if (!unchanged(pending.baseline)) throw new Error('Los datos cambiaron antes de confirmar. Vuelve a conversar con el coach.');
    const agreement = { id:pending.id, summary:pending.summary, thread_id:item.id, applied_at:now(), user_confirmed:true, changes:plan.changes, operations:pending.operations };
    const updated = clone(item); updated.pending = null; updated.updated_at = now(); updated.messages.push({ id:uid(),role:'event',text:`Acuerdo aplicado: ${agreement.summary}. ${plan.changes.length} destino(s) actualizados con tu autorización.`,created_at:now() });
    plan.staged.coach_ai_agreements = [agreement, ...rows('coach_ai_agreements')];
    plan.staged.coach_ai_threads = rows('coach_ai_threads').map(row => row.id === item.id ? updated : row);
    commit(plan.staged);
    if (plan.staged.nutconfig) { mealSuggestionOptions = []; renderMealSuggestions(null); }
    window.CoachPro?.invalidatePlans?.();
    status = 'Acuerdo aplicado'; error = ''; redraw(); renderTrainingNote(); toast('Acuerdo aplicado con tu autorización');
  }
  function workoutPrefills(routine, day, base, date = selectedDate()) {
    if (!routine || !day) return base;
    const targets = new Map();
    for (const exercise of day.exercises || []) {
      const resolved = targetState(exercise, date);
      if (resolved.fields.length) targets.set(norm(exercise.name), { name:exercise.name, ...resolved });
    }
    for (const plan of rows('coach_plans')) for (const planned of plan.days || []) {
      if (planned.kind !== 'training' || planned.date !== date || planned.routine_id !== routine.id || planned.routine_day_id !== day.id) continue;
      for (const exercise of planned.exercises || []) if (exercise.coach_ai && exercise.coach_ai.effective_date <= date) targets.set(norm(exercise.name), { ...exercise, fields:['sets','reps','weight'] });
    }
    if (!targets.size) return base;
    const result = [], inserted = new Set();
    const replacement = (key, target) => {
      const previous = base.filter(item => norm(item.exercise) === key), work = previous.filter(item => !['warmup','warm-up','calentamiento'].includes(item.type));
      const count = target.fields.includes('sets') ? target.sets : work.length || target.sets;
      const warmups = previous.filter(item => ['warmup','warm-up','calentamiento'].includes(item.type));
      return [...warmups, ...Array.from({length:count}, (_,index) => { const old = work[index] || work.at(-1) || {}; return { exercise:target.name,setNumber:index+1,targetSets:count,targetReps:target.fields.includes('reps')?target.reps:old.targetReps??target.reps,achievedReps:'',weight:target.fields.includes('weight')&&target.weight!=null?target.weight:old.weight??'',rir:'',rpe:'',type:'normal' }; })];
    };
    for (const item of base) {
      const key = norm(item.exercise), target = targets.get(key);
      if (!target) result.push(item);
      else if (!inserted.has(key)) { result.push(...replacement(key,target)); inserted.add(key); }
    }
    for (const [key,target] of targets) if (!inserted.has(key)) result.push(...replacement(key,target));
    return result;
  }
  function renderTrainingNote() {
    const el = document.getElementById('coach-ai-training-note'); if (!el) return;
    const agreement = rows('coach_ai_agreements').find(item => item.operations.some(operation => ['exercise_target','plan_exercise'].includes(operation.type)));
    const targets = agreement?.changes.filter(change => change.area === 'Rutina' || change.area === 'Calendario y plan') || [];
    el.innerHTML = agreement ? `<div class="cai-training-note"><i data-lucide="clipboard-check"></i><div><strong>${esc(agreement.summary)}</strong>${targets.slice(0, 6).map(change => `<p><strong>${esc(change.destination)}</strong><br>${change.fields.map(field => `${esc(field.label)}: ${esc(display(field.before))} → ${esc(display(field.after))}`).join(' · ')}</p>`).join('')}<p>Objetivos para la rutina y fecha correspondientes. El entrenamiento iniciado se conserva.</p>${button('open-chat', icon('messages-square') + 'Ver acuerdo')}</div></div>` : '';
    refreshInterfaceIcons();
  }
  function preserveImportedTargets(previous, incoming) {
    if (!(previous?.days || []).some(day => (day.exercises || []).some(exercise => exercise.coach_prescriptions?.length))) return incoming;
    for (const day of incoming.days || []) {
      const candidates = (previous.days || []).filter(item => norm(item.name) === norm(day.name));
      const old = candidates.length === 1 ? candidates[0] : previous.days.length === 1 && incoming.days.length === 1 ? previous.days[0] : null;
      if (!old) continue;
      day.id = old.id;
      for (const exercise of day.exercises || []) {
        const matches = (old.exercises || []).filter(item => norm(item.name) === norm(exercise.name));
        if (matches.length !== 1 || !matches[0].coach_prescriptions?.length) continue;
        exercise.coach_base = clone(matches[0].coach_base); exercise.coach_prescriptions = clone(matches[0].coach_prescriptions);
        const current = targetState(exercise);
        if (current.fields.includes('sets')) exercise.target_sets = current.sets;
        if (current.fields.includes('reps')) exercise.reps = current.reps;
        if (current.fields.includes('weight')) exercise.weight = current.weight;
      }
    }
    return incoming;
  }
  document.addEventListener('submit', event => { if (event.target.id === 'cai-form') { event.preventDefault(); Promise.resolve().then(() => send(event)).catch(failure => { error=failure.message; redraw(); }); } });
  document.addEventListener('input', event => {
    if (event.target.id !== 'cai-message' || !coachModeUnlocked) return;
    try { const item = thread(); if (item) { item.draft=event.target.value; saveThread(item); } } catch (failure) { toast(failure.message,'err'); }
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'cai-consent') document.getElementById('cai-apply').disabled = !event.target.checked;
    if (event.target.id === 'cai-thread' && coachModeUnlocked) { suspend(); selectedId=event.target.value; DB.set('coach_ai_active_thread',selectedId); error='';status='';redraw(); }
  });
  document.addEventListener('keydown', event => {
    if (event.target.id === 'cai-message' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); event.target.form?.requestSubmit(); }
  });
  document.addEventListener('click', event => {
    const target=event.target.closest('[data-cai]');if(!target)return;
    try {
      const action=target.dataset.cai;
      if(action==='open-chat'){coachActiveView='chat';if(coachModeUnlocked)go('coach');else openCoachMode();return;}
      guard();
      if(action==='new')newThread();
      if(action==='stop'){suspend();redraw();}
      if(action==='profile')go('profile');
      if(action==='apply')apply();
      if(action==='discard'){const item=thread();if(item?.pending&&confirm('¿Descartar esta propuesta sin cambiar tus datos?')){item.pending=null;saveThread(item);redraw();}}
    } catch(failure){error=failure.message;toast(error,'err');redraw();}
  });
  return { render, mount, suspend, buildPlan, workoutPrefills, renderTrainingNote, targetState, context, preserveImportedTargets };
})();

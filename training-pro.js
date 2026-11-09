/* Manual training tools over AA Follow's existing routines, sessions and plans. */
window.TrainingPro = (() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const value = id => byId(id)?.value || '';
  const clone = data => JSON.parse(JSON.stringify(data));
  const rows = key => { const data = DB.get(key); return Array.isArray(data) ? data : []; };
  const number = data => Number.isFinite(+data) ? +data : 0;
  const nullable = data => data === '' || data == null ? null : Number(data);
  const normalize = data => String(data || '').trim().toLocaleLowerCase('es').replace(/\s+/g, ' ');
  const format = (data, digits = 1) => number(data).toLocaleString('es-AR', { maximumFractionDigits: digits });
  const now = () => new Date().toISOString();
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const attr = id => `data-id="${esc(id)}"`;
  const button = (action, label, attributes = '', style = '') => `<button type="button" class="${style}" data-tp-action="${action}" ${attributes}>${label}</button>`;
  const input = (label, id, data = '', type = 'text', attributes = '') => `<label>${label}<input id="${id}" type="${type}" value="${esc(data)}" ${attributes}></label>`;
  const textarea = (label, id, data = '') => `<label>${label}<textarea id="${id}" maxlength="4000">${esc(data)}</textarea></label>`;
  const empty = text => `<div class="cp-empty">${esc(text)}</div>`;
  const tag = (text, tone = '') => `<span class="cp-tag ${tone}">${esc(text)}</span>`;
  const heading = (title, copy, tools = '') => `<div class="cp-head"><div><h2>${esc(title)}</h2><p>${esc(copy)}</p></div><div class="cp-tools">${tools}</div></div>`;
  const section = (title, html) => `<section class="cp-band"><h3>${esc(title)}</h3>${html}</section>`;
  const form = (name, html) => `<form data-tp-form="${name}">${html}</form>`;
  const table = (headers, data) => data.length ? `<div class="cp-table-wrap"><table><thead><tr>${headers.map(label => `<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${data.map(cells => `<tr>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : empty('Sin registros.');
  const state = { hub: 'muscles', libraryName: '', filter: '', ruleId: '', block: null, blockPreview: null, blockOverwrite: false, bulk: false, dates: new Set(), bulkPreview: null, group: null, closure: null };
  const draftStore = () => DB.get('training_tool_drafts') || {};
  const draft = key => draftStore()[key];
  function saveDraft(key, data) { const drafts = draftStore(); drafts[key] = clone(data); DB.set('training_tool_drafts', drafts); }
  function clearDraft(key) { const drafts = draftStore(); delete drafts[key]; DB.set('training_tool_drafts', drafts); }
  function put(key, entry) {
    const data = rows(key); const index = data.findIndex(row => row.id === entry.id);
    if (index < 0) data.unshift(entry); else data[index] = entry;
    DB.set(key, data); return entry;
  }
  function transaction(changes) {
    const keys = [...new Set([...Object.keys(changes), 'trash', 'change_history'])];
    const before = new Map(keys.map(key => [key, localStorage.getItem(accountStorageKey(key))]));
    try { Object.entries(changes).forEach(([key, data]) => DB.set(key, data)); }
    catch (error) {
      for (const [key, raw] of before) { if (raw == null) localStorage.removeItem(accountStorageKey(key)); else localStorage.setItem(accountStorageKey(key), raw); scheduleCloudAutoUpload(key); }
      throw error;
    }
  }
  function refresh() {
    if (document.querySelector('.page.active')?.id === 'page-coach') renderCoachWorkspace();
    else renderHub();
    restoreLibraryDrafts();
    refreshInterfaceIcons();
  }
  function openCoach(view) { coachActiveView = view; if (coachModeUnlocked) go('coach'); else openCoachMode(); }
  function dialog(content, label) {
    byId('tp-dialog')?.remove();
    const overlay = document.createElement('div'); overlay.id = 'tp-dialog'; overlay.className = 'overlay show tp-dialog';
    overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1"><div class="tp cp">${content}</div></div>`;
    overlay.addEventListener('click', event => { if (event.target === overlay) closeDialog(); });
    document.body.append(overlay); refreshInterfaceIcons(); overlay.querySelector('.modal').focus();
  }
  function closeDialog() { byId('tp-dialog')?.remove(); state.group = null; }
  function remove(key, id, name) { if (!confirm(`¿Eliminar ${name}? Se conservará en la papelera.`)) return false; DB.del(key, id); return true; }
  function isWorkSet(set) { return number(set.reps) > 0 && !['warmup', 'warm-up', 'calentamiento'].includes(normalize(set.type || set.set_type)); }
  function exerciseNames() {
    const names = [
      ...rows('sessions').flatMap(session => (session.sets || []).map(set => set.exercise_name || set.exercise)),
      ...rows('routines').flatMap(routine => (routine.days || []).flatMap(day => (day.exercises || []).map(exercise => exercise.name))),
      ...rows('exercise_profiles').map(profile => profile.name)
    ].filter(Boolean);
    return [...new Map(names.map(name => [normalize(name), name])).values()].sort((a, b) => a.localeCompare(b, 'es'));
  }
  const muscles = { chest: 'Pecho', back: 'Espalda', shoulders: 'Hombros', biceps: 'Bíceps', triceps: 'Tríceps', quads: 'Cuádriceps', hamstrings: 'Isquiotibiales', glutes: 'Glúteos', calves: 'Pantorrillas', core: 'Abdomen / core', forearms: 'Antebrazos', other: 'Otro' };
  const profileFor = name => rows('exercise_profiles').find(profile => normalize(profile.name) === normalize(name));
  function muscleVolume(week = weekValueFromDate()) {
    const dates = getWeekDates(week); const totals = new Map(); let unclassified = 0; let classified = 0;
    rows('sessions').filter(session => dates.includes(session.date)).forEach(session => (session.sets || []).filter(isWorkSet).forEach(set => {
      const profile = profileFor(set.exercise_name || set.exercise);
      const muscle = profile?.muscle;
      if (!muscle || !muscles[muscle]) { unclassified++; return; }
      classified++;
      if (!totals.has(muscle)) totals.set(muscle, { muscle, label: muscles[muscle], sets: 0, reps: 0, volume: 0 });
      const item = totals.get(muscle); item.sets++; item.reps += number(set.reps); item.volume += number(set.reps) * number(set.weight);
    }));
    return { items: [...totals.values()].sort((a, b) => b.sets - a.sets), unclassified, classified };
  }
  function renderMuscles() {
    const week = byId('tp-muscle-week')?.value || weekValueFromDate();
    const data = muscleVolume(week); const max = Math.max(1, ...data.items.map(item => item.sets));
    return `${heading('Trabajo por grupo muscular', 'Series realizadas, clasificadas por el músculo principal que asignaste.', input('Semana', 'tp-muscle-week', week, 'week', 'data-tp-change="muscle-week"'))}<div class="tp-metrics"><div class="tp-metric"><small>Series clasificadas</small><strong>${data.classified}</strong></div><div class="tp-metric"><small>Sin clasificar</small><strong>${data.unclassified}</strong></div><div class="tp-metric"><small>Grupos con trabajo</small><strong>${data.items.length}</strong></div><div class="tp-metric"><small>Volumen clasificado</small><strong>${format(data.items.reduce((sum, item) => sum + item.volume, 0))} kg</strong></div></div><div>${data.items.map(item => `<div class="tp-volume-row"><strong>${item.label}</strong><div class="tp-volume-track"><i style="width:${item.sets / max * 100}%"></i></div><small>${item.sets} series</small></div>`).join('') || empty('Asigna un músculo principal a tus ejercicios para ver la distribución.')}</div>${table(['Grupo', 'Series', 'Reps', 'Volumen kg'], data.items.map(item => [item.label, item.sets, item.reps, format(item.volume)]))}<small>Se cuenta una vez cada serie con repeticiones realizadas, según su músculo principal. Las series identificadas como calentamiento quedan fuera.</small>`;
  }
  function librarySelected() {
    const names = exerciseNames();
    if (!state.libraryName) state.libraryName = names[0] || '';
    return state.libraryName;
  }
  function safeUrl(raw) {
    if (!raw) return '';
    try { const url = new URL(raw); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
  }
  function techniqueCards(name) {
    return rows('exercise_techniques').filter(item => normalize(item.exercise) === normalize(name)).map(item => {
      const url = safeUrl(item.url); const kind = item.kind || 'link';
      return `<article class="cp-item"><div class="cp-row"><strong>${esc(item.title)}</strong><div class="cp-tools">${button('edit-technique', icon('pencil'), attr(item.id) + ' title="Editar referencia" aria-label="Editar referencia"', 'icon')}${button('delete-technique', icon('trash-2'), attr(item.id) + ' title="Eliminar referencia" aria-label="Eliminar referencia"', 'icon danger')}</div></div>${url ? `<a class="tp-media-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${kind === 'image' ? `<img src="${esc(url)}" loading="lazy" alt="${esc(item.title)}" onerror="this.hidden=true">` : icon('external-link')}<span>${esc(kind === 'video' ? 'Video' : kind === 'image' ? 'Imagen' : 'Referencia')} · ${esc(new URL(url).hostname)}</span></a>` : ''}<p class="cp-copy">${esc(item.cues)}</p><small>${esc(item.author || '')}</small></article>`;
    }).join('') || empty('Aún no hay referencias personales guardadas.');
  }
  function renderLibrary() {
    const name = librarySelected(); const profile = profileFor(name) || {}; const pending = draft('profile:' + normalize(name));
    const data = pending || profile;
    const alternatives = rows('exercise_alternatives').filter(item => normalize(item.exercise) === normalize(name));
    const options = exerciseNames().map(item => `<option value="${esc(item)}">`).join('');
    return `<div class="tp cp">${heading('Biblioteca de ejercicios', 'Músculos, alternativas y referencias de técnica de tus ejercicios.')}<datalist id="tp-exercise-names">${options}</datalist><div class="cp-form">${input('Buscar ejercicio', 'tp-library-filter', state.filter, 'search', 'data-tp-change="library-filter"')}${input('Añadir ejercicio', 'tp-library-new', '', 'text', 'maxlength="120" list="tp-exercise-names"')}</div><div class="cp-tools">${button('new-profile', icon('plus') + 'Abrir ficha')}</div><div class="tp-library-layout"><div class="tp-exercise-list">${exerciseNames().filter(item => normalize(item).includes(normalize(state.filter))).map(item => button('select-exercise', `<span>${esc(item)}</span><small>${esc(muscles[profileFor(item)?.muscle] || 'Sin clasificar')}</small>`, `data-name="${esc(item)}"`, item === name ? 'selected' : '')).join('') || empty('Sin ejercicios en esta búsqueda.')}</div><div>${name ? `${form('profile', `<h3>${esc(name)}</h3><div class="cp-form"><label>Músculo principal<select id="tp-profile-muscle"><option value="">Sin clasificar</option>${Object.entries(muscles).map(([key, label]) => `<option value="${key}" ${data.muscle === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${input('Material', 'tp-profile-equipment', data.equipment || '', 'text', 'maxlength="120"')}${textarea('Indicaciones personales', 'tp-profile-cues', data.cues || '')}</div><div class="cp-band"><button type="submit" class="primary">${icon('save')}Guardar ficha</button></div>`)}${section('Alternativas guardadas', alternatives.map(item => `<div class="cp-item cp-row"><div><strong>${esc(item.alternative)}</strong><p>${esc(item.reason)}</p></div>${button('delete-alternative', icon('trash-2'), attr(item.id) + ' title="Eliminar alternativa" aria-label="Eliminar alternativa"', 'icon danger')}</div>`).join('') || empty('Sin sustituciones para este ejercicio.'))}${form('alternative', `<div class="cp-form">${input('Ejercicio alternativo', 'tp-alternative-name', '', 'text', 'maxlength="120" list="tp-exercise-names" required')}${input('Cuándo usarlo / material', 'tp-alternative-reason', '', 'text', 'maxlength="400"')}</div><div class="cp-band"><button type="submit">${icon('plus')}Guardar alternativa</button></div>`)}${section('Referencias de técnica', techniqueCards(name))}${form('technique', `<div class="cp-form">${input('Título', 'tp-tech-title', '', 'text', 'maxlength="160" required')}<label>Tipo<select id="tp-tech-kind"><option value="link">Enlace</option><option value="video">Video</option><option value="image">Imagen</option><option value="note">Nota técnica</option></select></label>${input('URL https (opcional para notas)', 'tp-tech-url', '', 'url', 'maxlength="2000"')}${input('Autor / procedencia', 'tp-tech-author', '', 'text', 'maxlength="160"')}${textarea('Puntos técnicos y observaciones', 'tp-tech-cues')}</div><div class="cp-band"><button type="submit">${icon('bookmark-plus')}Guardar referencia</button></div>`)}` : empty('Selecciona un ejercicio o crea su ficha.')}</div></div></div>`;
  }
  function saveProfile() {
    const name = librarySelected(); if (!name) throw new Error('Escribe un ejercicio.');
    const current = profileFor(name);
    put('exercise_profiles', { ...current, id: current?.id || uid(), name, muscle: value('tp-profile-muscle'), equipment: value('tp-profile-equipment').trim(), cues: value('tp-profile-cues').trim(), updated_at: now(), created_at: current?.created_at || now() });
    clearDraft('profile:' + normalize(name)); toast('Ficha guardada'); refresh();
  }
  function saveAlternative() {
    const name = librarySelected(); const alternative = value('tp-alternative-name').trim();
    if (!alternative || normalize(alternative) === normalize(name)) throw new Error('Escribe un ejercicio alternativo distinto.');
    if (rows('exercise_alternatives').some(item => normalize(item.exercise) === normalize(name) && normalize(item.alternative) === normalize(alternative))) throw new Error('Esta alternativa ya está guardada.');
    DB.push('exercise_alternatives', { id: uid(), exercise: name, alternative, reason: value('tp-alternative-reason').trim(), created_at: now() }); clearDraft('alternative:' + normalize(name)); toast('Alternativa guardada'); refresh();
  }
  function saveTechnique() {
    const title = value('tp-tech-title').trim(); const raw = value('tp-tech-url').trim(); const kind = value('tp-tech-kind'); const cues = value('tp-tech-cues').trim();
    if (!title || (kind !== 'note' && !safeUrl(raw)) || (kind === 'note' && !cues) || (raw && !safeUrl(raw))) throw new Error('Completa el título y una URL https válida, o una nota técnica.');
    const previous = rows('exercise_techniques').find(row => row.id === state.techniqueId);
    put('exercise_techniques', { ...previous, id: previous?.id || uid(), exercise: librarySelected(), title, kind, url: safeUrl(raw), author: value('tp-tech-author').trim(), cues, created_at: previous?.created_at || now(), updated_at: now() }); clearDraft('technique:' + normalize(librarySelected())); state.techniqueId = ''; toast('Referencia guardada'); refresh();
  }
  function restoreLibraryDrafts() {
    const name = librarySelected();
    const technique = draft('technique:' + normalize(name));
    if (byId('tp-tech-title')) {
      state.techniqueId = technique?.id || '';
      ['title', 'kind', 'url', 'author', 'cues'].forEach(key => { const field = byId('tp-tech-' + key); if (field) field.value = technique?.[key] || (key === 'kind' ? 'link' : ''); });
    }
    const alternative = draft('alternative:' + normalize(name));
    if (byId('tp-alternative-name')) byId('tp-alternative-name').value = alternative?.name || '';
    if (byId('tp-alternative-reason')) byId('tp-alternative-reason').value = alternative?.reason || '';
  }

  // PROGRESSION RULES
  function evaluateRule(rule, referenceDate = selectedDate()) {
    const history = exerciseSessionHistory(rule.exercise, referenceDate).map(item => ({ ...item, sets: item.sets.filter(isWorkSet) })).filter(item => item.sets.length);
    const needed = number(rule.sessions) || 1; const recent = history.slice(0, needed);
    const base = nullable(rule.base_weight) ?? (recent[0]?.sets[0] ? number(recent[0].sets[0].weight) : null);
    const qualify = item => item.sets.length >= number(rule.sets) && item.sets.every(set => number(set.reps) >= number(rule.max_reps) && Math.abs(number(set.weight) - base) < .001 && (rule.min_rir == null || (set.rir != null && number(set.rir) >= number(rule.min_rir))));
    const ready = base != null && recent.length >= needed && recent.every(qualify);
    const latest = recent[0];
    const message = !latest ? 'Sin sesiones registradas para comparar.' : recent.length < needed ? `${recent.length}/${needed} sesiones disponibles.` : ready ? `Objetivo cumplido en ${needed} sesión(es) consecutiva(s).` : latest.sets.length < number(rule.sets) ? 'La última sesión tiene menos series que el objetivo.' : latest.sets.some(set => number(set.reps) < number(rule.min_reps)) ? 'Hay series por debajo del rango configurado.' : 'Aún faltan las repeticiones, la carga o el RIR que configuraste.';
    return { ready, message, base, suggested: ready ? Math.round((base + number(rule.increment)) * 100) / 100 : null, recent, qualified: recent.filter(qualify).length };
  }
  function renderRules() {
    const pending = draft('rule');
    if (!state.ruleId && pending?.id) state.ruleId = pending.id;
    const item = state.ruleId ? (pending?.id === state.ruleId ? pending : rows('training_progression_rules').find(row => row.id === state.ruleId)) || {} : pending || {};
    const names = exerciseNames();
    return `<div class="tp cp">${heading('Reglas de progresión', 'Condiciones definidas por ti para revisar la siguiente carga.')}<datalist id="tp-rule-exercises">${names.map(name => `<option value="${esc(name)}">`).join('')}</datalist><div class="cp-grid"><section class="cp-panel">${form('rule', `<h3>${state.ruleId ? 'Editar regla' : 'Nueva regla'}</h3><div class="cp-form">${input('Ejercicio', 'tp-rule-exercise', item.exercise || librarySelected(), 'text', 'list="tp-rule-exercises" required maxlength="120"')}${input('Series mínimas', 'tp-rule-sets', item.sets ?? 3, 'number', 'min="1" max="30" required')}${input('Mínimo de repeticiones', 'tp-rule-min', item.min_reps ?? 8, 'number', 'min="1" max="100" required')}${input('Máximo de repeticiones', 'tp-rule-max', item.max_reps ?? 12, 'number', 'min="1" max="100" required')}${input('Carga de referencia kg (opcional)', 'tp-rule-base', item.base_weight ?? '', 'number', 'min="0" max="1500" step=".1"')}${input('Incremento a revisar kg', 'tp-rule-increment', item.increment ?? 2.5, 'number', 'min=".1" max="100" step=".1" required')}${input('Sesiones consecutivas', 'tp-rule-sessions', item.sessions ?? 1, 'number', 'min="1" max="5" required')}${input('RIR mínimo (opcional)', 'tp-rule-rir', item.min_rir ?? '', 'number', 'min="0" max="10" step=".5"')}</div><div class="cp-band cp-tools">${button('new-rule', 'Nueva regla')}<button type="submit" class="primary">${icon('save')}Guardar regla</button></div>`)}</section><div>${rows('training_progression_rules').map(rule => { const result = evaluateRule(rule); return `<article class="cp-panel cp-item"><div class="cp-row"><h3>${esc(rule.exercise)}</h3>${tag(rule.active === false ? 'Pausada' : result.ready ? 'Lista para revisar' : 'En seguimiento', rule.active !== false && result.ready ? 'good' : '')}</div><p>${rule.sets} series · ${rule.min_reps}–${rule.max_reps} reps · ${rule.sessions} sesión(es)${rule.base_weight != null ? ` · ${format(rule.base_weight)} kg` : ''}${rule.min_rir != null ? ` · RIR ≥ ${rule.min_rir}` : ''}</p><div class="tp-rule-state ${result.ready ? 'ready' : 'pending'}">${esc(result.message)}${result.ready ? `<strong> ${format(result.base)} → ${format(result.suggested)} kg</strong>` : ''}</div><small>${result.recent.map(row => `${row.date}: ${row.sets.length} series`).join(' · ') || 'Sin historial'}</small><div class="cp-band cp-tools">${button('edit-rule', icon('pencil'), attr(rule.id) + ' title="Editar regla" aria-label="Editar regla"', 'icon')}${button('toggle-rule', rule.active === false ? 'Activar' : 'Pausar', attr(rule.id))}${result.ready && rule.active !== false ? button('prepare-rule', 'Preparar carga en series pendientes', attr(rule.id)) : ''}${button('delete-rule', icon('trash-2'), attr(rule.id) + ' title="Eliminar regla" aria-label="Eliminar regla"', 'icon danger')}</div></article>`; }).join('') || empty('Sin reglas configuradas.')}</div></div></div>`;
  }
  function ruleData() { return { exercise: value('tp-rule-exercise').trim(), sets: number(value('tp-rule-sets')), min_reps: number(value('tp-rule-min')), max_reps: number(value('tp-rule-max')), base_weight: nullable(value('tp-rule-base')), increment: number(value('tp-rule-increment')), sessions: number(value('tp-rule-sessions')), min_rir: nullable(value('tp-rule-rir')) }; }
  function saveRule() {
    const data = ruleData();
    if (!data.exercise || !Number.isInteger(data.sets) || data.sets < 1 || data.sets > 30 || !Number.isInteger(data.min_reps) || !Number.isInteger(data.max_reps) || data.min_reps < 1 || data.max_reps > 100 || data.min_reps > data.max_reps || data.increment <= 0 || data.increment > 100 || !Number.isInteger(data.sessions) || data.sessions < 1 || data.sessions > 5 || (data.min_rir != null && (data.min_rir < 0 || data.min_rir > 10)) || (data.base_weight != null && (data.base_weight < 0 || data.base_weight > 1500))) throw new Error('Revisa los rangos, series, carga e incremento de la regla.');
    const existing = rows('training_progression_rules').find(row => row.id === state.ruleId);
    put('training_progression_rules', { ...existing, ...data, id: existing?.id || uid(), active: existing?.active !== false, created_at: existing?.created_at || now(), updated_at: now() });
    state.ruleId = ''; clearDraft('rule'); toast('Regla guardada'); refresh();
  }
  function prepareRule(id) {
    const rule = rows('training_progression_rules').find(row => row.id === id);
    if (!rule || rule.active === false) return;
    const result = evaluateRule(rule);
    if (!result.ready || result.suggested > 1500) throw new Error('No hay una carga nueva lista para preparar.');
    const pending = liveGymGroups().filter(group => normalize(group.name) === normalize(rule.exercise)).flatMap(group => group.rows).filter(row => !liveRowCompleted(row) && row.dataset.manualTouched !== 'true');
    if (!pending.length) throw new Error('Carga este ejercicio en Entrenamiento y deja series pendientes para preparar la carga.');
    if (!confirm(`¿Preparar ${format(result.suggested)} kg en ${pending.length} serie(s) pendiente(s) de ${rule.exercise}?`)) return;
    pending.forEach(row => { row.querySelector('.live-kg').value = result.suggested; });
    saveWorkoutDraftsNow('live'); renderMobileGymDraft(); toast('Carga preparada en el borrador; confirma las series al realizarlas');
  }

  // TRAINING BLOCKS
  function loadBlock() {
    if (!state.block) state.block = clone(draft('block') || { id: uid(), name: '', start_week: weekValueFromDate(addDays(selectedDate(), 7)), source_week: weekValueFromDate(), phase_id: '', weeks: [{ type: 'load', volume_pct: 100, load_pct: 100, notes: '' }, { type: 'load', volume_pct: 100, load_pct: 100, notes: '' }, { type: 'load', volume_pct: 100, load_pct: 100, notes: '' }, { type: 'deload', volume_pct: 100, load_pct: 100, notes: '' }], status: 'draft' });
    return state.block;
  }
  const blockTypes = { adaptation: 'Adaptación', load: 'Carga', deload: 'Descarga', review: 'Revisión', custom: 'Personalizada' };
  function renderBlocks() {
    const block = loadBlock();
    return `<div class="tp cp">${heading('Bloques de entrenamiento', 'Organiza varias semanas y define sus ajustes de forma manual.')}<div class="cp-form">${input('Nombre del bloque', 'tp-block-name', block.name, 'text', 'maxlength="160"')}${input('Semana inicial', 'tp-block-start', block.start_week, 'week')}<label>Semana base<select id="tp-block-source"><option value="">Seleccionar un plan guardado</option>${rows('coach_plans').map(plan => `<option value="${esc(plan.week)}" ${plan.week === block.source_week ? 'selected' : ''}>${esc(plan.week)} · ${esc(plan.focus)}</option>`).join('')}</select></label><label>Fase relacionada<select id="tp-block-phase"><option value="">Sin fase asociada</option>${rows('preparation_plans').map(plan => `<option value="${esc(plan.id)}" ${block.phase_id === plan.id ? 'selected' : ''}>${esc(plan.name)}</option>`).join('')}</select></label></div><div class="tp-inline-help">Los porcentajes parten del plan base. 100% conserva sus objetivos. El tipo de semana sirve para organizar el bloque; los valores los decides tú.</div><div class="tp-block-weeks">${block.weeks.map((week, index) => `<article class="tp-block-week"><h4>Semana ${index + 1} · ${esc(weekValueFromDate(addDays(getWeekDates(block.start_week)[0], index * 7)))}</h4><label>Tipo<select data-tp-block-week="type" data-index="${index}">${Object.entries(blockTypes).map(([key, label]) => `<option value="${key}" ${week.type === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Series respecto al plan base %<input type="number" data-tp-block-week="volume_pct" data-index="${index}" min="0" max="200" step="5" value="${esc(week.volume_pct)}"></label><label>Carga respecto al plan base %<input type="number" data-tp-block-week="load_pct" data-index="${index}" min="0" max="200" step="5" value="${esc(week.load_pct)}"></label><label>Foco / revisión<textarea data-tp-block-week="notes" data-index="${index}" maxlength="1500">${esc(week.notes)}</textarea></label></article>`).join('')}</div><div class="cp-band cp-tools">${button('add-block-week', icon('plus') + 'Semana', block.weeks.length >= 16 ? 'disabled' : '')}${button('remove-block-week', icon('minus') + 'Última semana', block.weeks.length <= 1 ? 'disabled' : '')}${button('new-block', 'Nuevo bloque')}${button('save-block', icon('save') + 'Guardar bloque', '', 'primary')}${button('preview-block', icon('calendar-range') + 'Revisar planificación')}</div><div id="tp-block-preview">${state.blockPreview ? blockPreviewHtml(state.blockPreview) : ''}</div>${section('Bloques guardados', rows('training_blocks').map(item => `<article class="cp-item"><div class="cp-row"><div><h3>${esc(item.name)}</h3><small>${esc(item.start_week)} · ${item.weeks.length} semanas · ${esc(item.status === 'archived' ? 'Archivado' : item.status === 'scheduled' ? 'Planificado' : 'Borrador')}</small></div><div class="cp-tools">${button('edit-block', 'Abrir', attr(item.id))}${button('archive-block', 'Archivar', attr(item.id), item.status === 'archived' ? 'disabled' : '')}</div></div></article>`).join('') || empty('Sin bloques guardados.'))}</div>`;
  }
  function captureBlock() {
    const block = loadBlock();
    ['name', 'phase', 'source', 'start'].forEach(key => { if (!byId('tp-block-' + key)) return; block[{ name: 'name', phase: 'phase_id', source: 'source_week', start: 'start_week' }[key]] = value('tp-block-' + key); });
    saveDraft('block', block); return block;
  }
  function validateBlock(block) {
    if (!block.name.trim() || !/^\d{4}-W\d{2}$/.test(block.start_week) || weekValueFromDate(getWeekDates(block.start_week)[0]) !== block.start_week || block.weeks.length < 1 || block.weeks.length > 16) throw new Error('Completa nombre, semana inicial y entre 1 y 16 semanas.');
    for (const week of block.weeks) if (!blockTypes[week.type] || week.volume_pct == null || week.load_pct == null || !Number.isFinite(+week.volume_pct) || week.volume_pct < 0 || week.volume_pct > 200 || !Number.isFinite(+week.load_pct) || week.load_pct < 0 || week.load_pct > 200) throw new Error('Los porcentajes del bloque deben estar entre 0 y 200.');
  }
  function saveBlock() {
    const block = captureBlock(); validateBlock(block);
    block.created_at ||= now(); block.updated_at = now(); put('training_blocks', clone(block)); clearDraft('block'); toast('Bloque guardado'); refresh();
  }
  function buildBlockPlans(block, overwrite = false) {
    validateBlock(block);
    const source = block.source_snapshot || rows('coach_plans').find(plan => plan.week === block.source_week);
    if (!source?.days?.some(day => day.kind === 'training')) throw new Error('Selecciona una semana base con entrenamientos planificados.');
    const sourceDates = getWeekDates(source.week); const plans = clone(rows('coach_plans')); const changes = [];
    block.weeks.forEach((week, index) => {
      const targetWeek = weekValueFromDate(addDays(getWeekDates(block.start_week)[0], index * 7));
      const existing = plans.find(plan => plan.week === targetWeek);
      if (existing && !overwrite) { changes.push({ week: targetWeek, conflict: true, skipped: true }); return; }
      const dates = getWeekDates(targetWeek);
      const days = (source.days || []).filter(day => sourceDates.includes(day.date)).map(day => {
        const exercises = (day.exercises || []).map(exercise => ({ ...clone(exercise), sets: Math.round(number(exercise.sets) * number(week.volume_pct) / 100), weight: exercise.weight == null ? null : Math.round(number(exercise.weight) * number(week.load_pct) / 100 * 2) / 2 })).filter(exercise => exercise.sets > 0);
        return { ...clone(day), date: dates[sourceDates.indexOf(day.date)], exercises, session_id: '', notes: [day.notes, week.notes].filter(Boolean).join('\n'), kind: day.kind === 'training' && !exercises.length ? 'rest' : day.kind };
      });
      const plan = { ...clone(source), id: existing?.id || uid(), week: targetWeek, focus: `${block.name} · ${blockTypes[week.type]} · ${index + 1}/${block.weeks.length}`, days, block_id: block.id, created_at: existing?.created_at || now(), updated_at: now() };
      const position = plans.findIndex(row => row.week === targetWeek); if (position < 0) plans.unshift(plan); else plans[position] = plan;
      changes.push({ week: targetWeek, conflict: Boolean(existing), skipped: false, sessions: days.filter(day => day.kind === 'training').length, sets: days.reduce((sum, day) => sum + (day.kind === 'training' ? day.exercises.reduce((count, exercise) => count + exercise.sets, 0) : 0), 0), id: plan.id });
    });
    return { plans, changes, source: clone(source), fingerprint: JSON.stringify(rows('coach_plans')) };
  }
  function blockPreviewHtml(preview) {
    return `<div class="tp-preview"><h3>Vista previa del bloque</h3>${table(['Semana', 'Sesiones', 'Series', 'Acción'], preview.changes.map(item => [esc(item.week), item.sessions ?? '—', item.sets ?? '—', item.skipped ? tag('Omitida: ya tiene plan', 'warn') : item.conflict ? tag('Reemplazar plan', 'warn') : tag('Crear plan', 'good')]))}<label class="check"><input id="tp-block-overwrite" type="checkbox" data-tp-change="block-overwrite" ${state.blockOverwrite ? 'checked' : ''}>Reemplazar las semanas que ya tienen planificación</label><div class="cp-band cp-tools">${button('apply-block', 'Confirmar planificación del bloque', '', 'primary')}</div></div>`;
  }
  function applyBlock() {
    const preview = state.blockPreview; if (!preview) throw new Error('Revisa primero la vista previa.');
    if (preview.fingerprint !== JSON.stringify(rows('coach_plans'))) throw new Error('La planificación cambió. Genera otra vista previa.');
    if (!preview.changes.some(item => !item.skipped)) throw new Error('No hay semanas nuevas para crear.');
    const block = clone(loadBlock()); block.source_snapshot = preview.source; block.status = 'scheduled'; block.generated_plan_ids = preview.changes.filter(item => !item.skipped).map(item => item.id); block.updated_at = now(); block.created_at ||= now();
    const blocks = rows('training_blocks'); const index = blocks.findIndex(item => item.id === block.id); if (index < 0) blocks.unshift(block); else blocks[index] = block;
    transaction({ coach_plans: preview.plans, training_blocks: blocks }); state.block = block; state.blockPreview = null; clearDraft('block'); toast('Bloque planificado; sesiones realizadas conservadas'); refresh();
  }

  // CALENDAR BATCH ACTIONS
  function plannedDay(date) { return rows('coach_plans').find(plan => plan.week === weekValueFromDate(date))?.days?.find(day => day.date === date); }
  function calendarPlanHtml(date, compact = false) {
    const day = plannedDay(date);
    if (!day || !['training', 'rest'].includes(day.kind)) return '';
    return `<button type="button" class="tp-calendar-plan ${compact ? 'compact' : ''} ${day.kind === 'rest' ? 'rest' : ''}" data-tp-action="open-day-plan" data-date="${date}"><small>PLANIFICADO</small><strong>${esc(day.kind === 'rest' ? 'Descanso' : day.day_name || day.routine_name || 'Entrenamiento')}</strong>${!compact && day.kind === 'training' ? `<small>${day.exercises?.length || 0} ejercicios · ${(day.exercises || []).reduce((sum, item) => sum + number(item.sets), 0)} series objetivo</small>` : ''}</button>`;
  }
  function mountCalendar() {
    const toolbar = byId('tp-bulk-toolbar'); if (!toolbar) return;
    toolbar.hidden = !state.bulk;
    if (state.bulk) toolbar.innerHTML = `<div class="cp-row"><strong>${state.dates.size} día(s) seleccionado(s)</strong><div class="cp-tools">${button('select-visible-days', 'Período visible')}${button('clear-bulk-selection', 'Limpiar')}${button('open-bulk', 'Acciones en bloque', '', 'primary')}${button('close-bulk', icon('x'), 'title="Salir de selección" aria-label="Salir de selección"', 'icon')}</div></div>`;
    document.querySelectorAll('#page-calendar [data-calendar-drop-date]').forEach(zone => zone.classList.toggle('tp-cal-selected', state.bulk && state.dates.has(zone.dataset.calendarDropDate)));
    const toggle = byId('tp-bulk-toggle'); if (toggle) toggle.setAttribute('aria-pressed', String(state.bulk));
    refreshInterfaceIcons();
  }
  function toggleBulk() { state.bulk = !state.bulk; state.bulkPreview = null; mountCalendar(); }
  document.addEventListener('click', event => {
    if (!state.bulk || !event.target.closest?.('#page-calendar')) return;
    const zone = event.target.closest('[data-calendar-drop-date]');
    if (!zone) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const date = zone.dataset.calendarDropDate;
    if (state.dates.has(date)) state.dates.delete(date); else state.dates.add(date);
    state.bulkPreview = null; mountCalendar();
  }, true);
  function bulkDialog() {
    state.bulkPreview = null;
    dialog(`${heading('Acciones en bloque', 'Copia o mueve planificación y eventos; las sesiones realizadas conservan sus fechas.', button('close-dialog', icon('x'), 'title="Cerrar" aria-label="Cerrar"', 'icon'))}<div class="cp-form">${input('Añadir desde', 'tp-bulk-from', selectedDate(), 'date')}${input('Hasta', 'tp-bulk-until', selectedDate(), 'date')}</div><div class="cp-band cp-tools">${button('select-date-range', 'Añadir rango a la selección')}</div><div id="tp-bulk-dates" class="tp-bulk-dates"></div><div class="cp-form"><label>Acción<select id="tp-bulk-mode" data-tp-change="invalidate-bulk"><option value="copy">Copiar a otro período</option><option value="move">Mover a otro período</option><option value="rest">Asignar descanso en los días seleccionados</option></select></label>${input('Primer día de destino', 'tp-bulk-target', addDays([...state.dates].sort()[0] || selectedDate(), 7), 'date', 'data-tp-change="invalidate-bulk"')}<label class="check"><input type="checkbox" id="tp-bulk-plans" checked data-tp-change="invalidate-bulk">Incluir planificación de entrenamiento</label><label class="check"><input type="checkbox" id="tp-bulk-events" checked data-tp-change="invalidate-bulk">Incluir eventos de agenda</label><label class="check"><input type="checkbox" id="tp-bulk-overwrite" data-tp-change="invalidate-bulk">Reemplazar planificación existente en el destino</label></div><div class="cp-band cp-tools">${button('preview-bulk', icon('scan-eye') + 'Revisar cambios')}</div><div id="tp-bulk-preview"></div>`, 'Acciones en bloque del calendario');
    renderBulkDates();
  }
  function renderBulkDates() { if (byId('tp-bulk-dates')) byId('tp-bulk-dates').innerHTML = [...state.dates].sort().map(date => button('remove-bulk-date', esc(date) + ' ×', `data-date="${date}"`)).join('') || '<small>Selecciona días en el calendario o añade un rango.</small>'; }
  function dayDistance(from, to) { return Math.round((localDate(to) - localDate(from)) / 86400000); }
  function buildBulk(options) {
    const dates = [...new Set(options.dates)].sort();
    if (!dates.length || dates.length > 93 || dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || dateKey(localDate(date)) !== date)) throw new Error('Selecciona entre 1 y 93 fechas válidas.');
    if (!['copy', 'move', 'rest'].includes(options.mode) || (options.mode !== 'rest' && (!/^\d{4}-\d{2}-\d{2}$/.test(options.target) || dateKey(localDate(options.target)) !== options.target))) throw new Error('Elige una acción y una fecha de destino válida.');
    const offset = options.mode === 'rest' ? 0 : dayDistance(dates[0], options.target);
    if (options.mode !== 'rest' && !offset) throw new Error('El destino debe ser distinto del período de origen.');
    const beforePlans = clone(rows('coach_plans')); const beforeEvents = clone(rows('calendar_events'));
    const getDay = (plans, date) => plans.find(plan => plan.week === weekValueFromDate(date))?.days?.find(day => day.date === date);
    const meaningful = day => day && (['training', 'rest'].includes(day.kind) || String(day.notes || '').trim() || day.exercises?.length);
    const operations = dates.map(date => ({ date, to: addDays(date, offset), day: clone(getDay(beforePlans, date) || null), events: beforeEvents.filter(event => event.date === date) }));
    const weeks = new Set(operations.flatMap(item => [weekValueFromDate(item.date), weekValueFromDate(item.to)]));
    const drafts = DB.get('coach_workspace_drafts') || {};
    if ([...weeks].some(week => drafts[`plan:${DB.get('activeUser') || ''}:${week}`])) throw new Error('Hay un plan con borrador pendiente en este período. Guárdalo antes de usar acciones en bloque.');
    if (options.mode === 'move' && options.plans && !options.overwrite && operations.some(item => item.day && meaningful(getDay(beforePlans, item.to)) && !dates.includes(item.to))) throw new Error('Hay planificación en el destino. Cambia el destino o autoriza reemplazarla antes de mover.');
    const plans = clone(beforePlans); let events = clone(beforeEvents); const changes = []; let changed = 0;
    const ensurePlan = date => {
      const week = weekValueFromDate(date); let plan = plans.find(row => row.week === week);
      if (!plan) { plan = { id: uid(), week, focus: 'Planificación de calendario', days: [], created_at: now(), updated_at: now() }; plans.unshift(plan); }
      if (!Array.isArray(plan.days)) plan.days = []; return plan;
    };
    if (options.mode === 'move' && options.plans) operations.filter(item => item.day).forEach(item => { const plan = plans.find(row => row.week === weekValueFromDate(item.date)); if (plan) plan.days = (plan.days || []).filter(day => day.date !== item.date); });
    if (options.mode === 'move' && options.events) events = events.filter(event => !dates.includes(event.date));
    operations.forEach(item => {
      let description = '';
      if (options.mode === 'rest' || (options.plans && item.day)) {
        const destination = getDay(plans, item.to);
        const conflict = meaningful(destination);
        if (conflict && !options.overwrite) description = 'Plan omitido: destino ocupado';
        else {
          const plan = ensurePlan(item.to);
          const day = options.mode === 'rest' ? { ...(destination || {}), date: item.to, kind: 'rest', exercises: [], session_id: '', routine_id: '', routine_day_id: '', routine_name: '', day_name: '', notes: destination?.notes || '' } : { ...clone(item.day), date: item.to, session_id: '' };
          plan.days = plan.days.filter(row => row.date !== item.to).concat(day); plan.updated_at = now(); changed++;
          description = options.mode === 'rest' ? 'Asignar descanso' : `${options.mode === 'move' ? 'Mover' : 'Copiar'} plan${conflict ? ' (reemplazo)' : ''}`;
        }
      }
      let eventCount = 0;
      if (options.mode !== 'rest' && options.events) item.events.forEach(event => {
        if (options.mode === 'copy' && events.some(row => row.date === item.to && row.source_event_id === event.id)) return;
        events.push({ ...clone(event), id: options.mode === 'move' ? event.id : uid(), date: item.to, ...(options.mode === 'copy' ? { source_event_id: event.id, created_at: now() } : {}), updated_at: now() }); eventCount++; changed++;
      });
      changes.push({ date: item.date, to: item.to, description: [description, eventCount ? `${eventCount} evento(s)` : ''].filter(Boolean).join(' · ') || 'Sin cambios' });
    });
    if (!changed) throw new Error('La selección no contiene cambios aplicables.');
    return { plans, events, changes, changed, fingerprint: JSON.stringify([rows('coach_plans'), rows('calendar_events')]) };
  }
  function previewBulk() {
    state.bulkPreview = buildBulk({ dates: [...state.dates], mode: value('tp-bulk-mode'), target: value('tp-bulk-target'), plans: byId('tp-bulk-plans').checked, events: byId('tp-bulk-events').checked, overwrite: byId('tp-bulk-overwrite').checked });
    byId('tp-bulk-preview').innerHTML = `<div class="tp-preview"><h3>Revisar ${state.bulkPreview.changed} cambio(s)</h3>${table(['Origen', 'Destino', 'Acción'], state.bulkPreview.changes.map(item => [esc(item.date), esc(item.to), esc(item.description)]))}<div class="cp-band">${button('confirm-bulk', 'Confirmar estos cambios', '', 'primary')}</div></div>`;
  }
  function confirmBulk() {
    const preview = state.bulkPreview; if (!preview) throw new Error('Genera primero la vista previa.');
    if (preview.fingerprint !== JSON.stringify([rows('coach_plans'), rows('calendar_events')])) throw new Error('Los datos cambiaron. Actualiza la vista previa.');
    transaction({ coach_plans: preview.plans, calendar_events: preview.events });
    state.bulkPreview = null; closeDialog(); loadCalendar({ preserveCursor: true }); toast('Planificación y eventos actualizados');
  }

  // WORKOUT REVIEW AND SUBSTITUTION
  function syncGymFocus() {
    const group = liveGymGroups()[gymExerciseIndex]; const row = group?.rows.find(item => !liveRowCompleted(item));
    if (!row) return;
    const mode = value('live-effort-mode') === 'rpe' ? 'rpe' : 'rir';
    [['gym-focus-reps', '.live-reps'], ['gym-focus-weight', '.live-kg'], ['gym-focus-effort', '.live-' + mode]].forEach(([id, selector]) => {
      const source = byId(id); const destination = row.querySelector(selector);
      if (source && destination && source.value !== destination.value) { destination.value = source.value; row.dataset.manualTouched = 'true'; }
    });
  }
  function workoutSnapshot(mode) {
    const live = mode === 'live'; const prefix = live ? 'live' : 'set'; const container = live ? '#live-sets' : '#s-sets';
    const data = { mode, date: value(live ? 'live-date' : 's-date') || selectedDate(), duration: value(live ? 'live-duration' : 's-dur'), notes: value(live ? 'live-notes' : 's-notes'), routine: value(live ? 'live-routine' : 's-routine'), day: value(live ? 'live-day' : 's-day'), rows: [...document.querySelectorAll(container + ' .exercise-series-row')].map((row, index) => ({ index, name: row.closest('.exercise-group')?.querySelector('.' + (live ? 'live-ex' : 'set-ex'))?.value.trim() || '', reps: row.querySelector('.' + prefix + '-reps')?.value ?? '', weight: row.querySelector('.' + prefix + '-kg')?.value ?? '', rir: row.querySelector('.' + prefix + '-rir')?.value ?? '', rpe: row.querySelector('.' + prefix + '-rpe')?.value ?? '', set_number: number(row.querySelector('.' + prefix + '-sn')?.value) || index + 1, target_sets: nullable(row.querySelector('.' + prefix + '-target-sets')?.value), target_reps: nullable(row.querySelector('.' + prefix + '-target-reps')?.value), type: row.dataset.setType || 'normal', completed: live ? liveRowCompleted(row) : row.dataset.completed === 'true', touched: row.dataset.manualTouched === 'true' })) };
    return { ...data, fingerprint: JSON.stringify(data) };
  }
  function reviewWorkout(mode) {
    if (!['live', 'session'].includes(mode)) return;
    if (mode === 'live') syncGymFocus();
    saveWorkoutDraftsNow(mode);
    const snapshot = workoutSnapshot(mode);
    if (!snapshot.rows.some(row => row.name)) return toast('Añade al menos un ejercicio antes del cierre', 'err');
    const previous = draft('closure:' + mode);
    state.closure = previous?.fingerprint === snapshot.fingerprint ? previous : { mode, session_id: uid(), fingerprint: snapshot.fingerprint, date: snapshot.date, duration: snapshot.duration, notes: snapshot.notes, fatigue: '', rows: snapshot.rows.map(row => ({ ...row, include: Boolean(row.name && number(row.reps) > 0 && (mode === 'session' || row.completed || row.touched)) })) };
    const data = state.closure;
    dialog(`${heading('Cierre del entrenamiento', 'Revisa las series incluidas, la duración y las sensaciones antes de confirmar.', button('close-dialog', icon('x'), 'title="Volver al entrenamiento" aria-label="Volver al entrenamiento"', 'icon'))}${form('closure', `<div class="cp-form">${input('Fecha', 'tp-close-date', data.date, 'date', 'required')}${input('Duración total min (opcional)', 'tp-close-duration', data.duration, 'number', 'min="1" max="1440" step="1"')}${input('Fatiga percibida (1–10, opcional)', 'tp-close-fatigue', data.fatigue, 'number', 'min="1" max="10" step="1"')}${textarea('Notas y sensaciones', 'tp-close-notes', data.notes)}</div><div id="tp-close-summary" class="tp-metrics"></div><div class="cp-table-wrap"><table><thead><tr><th>Ejercicio / estado</th><th>Incluir</th><th>Reps</th><th>Carga externa kg</th><th>RIR</th><th>RPE</th><th>Tipo</th></tr></thead><tbody>${data.rows.map((row, index) => `<tr class="tp-review-row ${row.include ? '' : 'omitted'}" data-tp-review-index="${index}"><td><strong>${esc(row.name || 'Ejercicio sin nombre')}</strong><small>${row.completed ? 'Confirmada en gimnasio' : row.touched ? 'Editada · sin confirmar' : mode === 'live' ? 'Pendiente' : 'Registro manual'} · serie ${row.set_number}</small></td><td><input aria-label="Incluir serie ${index + 1}" type="checkbox" data-tp-close="include" data-index="${index}" ${row.include ? 'checked' : ''}></td>${[['reps', '1', '200', '1'], ['weight', '0', '1500', '.5'], ['rir', '0', '10', '.5'], ['rpe', '1', '10', '.5']].map(([key, min, max, step]) => `<td><input type="number" aria-label="${key} serie ${index + 1}" data-tp-close="${key}" data-index="${index}" min="${min}" max="${max}" step="${step}" value="${esc(row[key])}"></td>`).join('')}<td><select aria-label="Tipo de serie ${index + 1}" data-tp-close="type" data-index="${index}"><option value="normal" ${row.type !== 'warmup' ? 'selected' : ''}>Trabajo</option><option value="warmup" ${row.type === 'warmup' ? 'selected' : ''}>Calentamiento</option></select></td></tr>`).join('')}</tbody></table></div><div class="tp-close-status"><small id="tp-close-save-state">${previous?.fingerprint === snapshot.fingerprint ? 'Borrador de cierre recuperado' : 'La sesión se guardará al confirmar este cierre.'}</small></div><div class="tp-sticky-actions cp-row">${button('close-dialog', 'Volver a editar')}<button type="submit" class="primary" id="tp-close-confirm">${icon('check-check')}Confirmar y guardar sesión</button></div>`)}`, 'Cierre del entrenamiento');
    closureSummary();
  }
  function captureClosure() {
    const data = state.closure; if (!data) return;
    ['date', 'duration', 'fatigue', 'notes'].forEach(key => { const input = byId('tp-close-' + key); if (input) data[key] = input.value; });
    document.querySelectorAll('[data-tp-close]').forEach(input => { const row = data.rows[+input.dataset.index]; row[input.dataset.tpClose] = input.type === 'checkbox' ? input.checked : input.value; });
    saveDraft('closure:' + data.mode, data);
    if (byId('tp-close-save-state')) byId('tp-close-save-state').textContent = 'Borrador de cierre guardado';
    closureSummary();
  }
  function closureSummary() {
    if (!byId('tp-close-summary') || !state.closure) return;
    const included = state.closure.rows.filter(row => row.include); const complete = included.every(row => row.weight !== '' && row.reps !== '');
    byId('tp-close-summary').innerHTML = `<div class="tp-metric"><small>Series incluidas</small><strong>${included.length}</strong></div><div class="tp-metric"><small>Series fuera del guardado</small><strong>${state.closure.rows.length - included.length}</strong></div><div class="tp-metric"><small>Volumen seleccionado</small><strong>${complete ? format(included.reduce((sum, row) => sum + number(row.reps) * number(row.weight), 0)) + ' kg' : 'Por completar'}</strong></div><div class="tp-metric"><small>Ejercicios incluidos</small><strong>${new Set(included.map(row => normalize(row.name))).size}</strong></div>`;
    document.querySelectorAll('[data-tp-review-index]').forEach(target => {
      const included = state.closure.rows[+target.dataset.tpReviewIndex].include;
      target.classList.toggle('omitted', !included);
      target.querySelectorAll('input:not([type="checkbox"]),select').forEach(input => { input.disabled = !included; });
    });
  }
  function closureOptions(data) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || dateKey(localDate(data.date)) !== data.date) throw new Error('Indica una fecha válida.');
    const duration = nullable(data.duration); const fatigue = nullable(data.fatigue);
    if ((duration != null && (!Number.isInteger(duration) || duration < 1 || duration > 1440)) || (fatigue != null && (!Number.isInteger(fatigue) || fatigue < 1 || fatigue > 10))) throw new Error('Revisa la duración y la fatiga del cierre.');
    const selected = data.rows.filter(row => row.include);
    if (!selected.length) throw new Error('Incluye al menos una serie realizada.');
    const sets = selected.map(row => {
      const reps = nullable(row.reps); const weight = nullable(row.weight); const rir = nullable(row.rir); const rpe = nullable(row.rpe);
      if (!row.name || !Number.isInteger(reps) || reps < 1 || reps > 200 || weight == null || !Number.isFinite(weight) || weight < 0 || weight > 1500 || (rir != null && (!Number.isFinite(rir) || rir < 0 || rir > 10)) || (rpe != null && (!Number.isFinite(rpe) || rpe < 1 || rpe > 10))) throw new Error(`Revisa reps, carga y esfuerzo de ${row.name || 'la serie incluida'}.`);
      return { exercise_name: row.name, set_number: row.set_number, target_sets: row.target_sets, target_reps: row.target_reps, reps, weight, rir, rpe, type: row.type === 'warmup' ? 'warmup' : 'normal' };
    });
    return { reviewed: true, session_id: data.session_id, sets, coach_review: { fatigue, notes: data.notes, exercises: [], updated_at: now() }, closure: { reviewed_at: now(), omitted_sets: data.rows.length - selected.length, selected_sets: selected.length } };
  }
  function confirmClosure() {
    captureClosure(); const data = state.closure; if (!data) return;
    if (workoutSnapshot(data.mode).fingerprint !== data.fingerprint) throw new Error('El borrador cambió durante la revisión. Vuelve a abrir el cierre para actualizarlo.');
    const options = closureOptions(data); const live = data.mode === 'live';
    byId(live ? 'live-date' : 's-date').value = data.date;
    byId(live ? 'live-duration' : 's-dur').value = data.duration;
    byId(live ? 'live-notes' : 's-notes').value = data.notes;
    data.fingerprint = workoutSnapshot(data.mode).fingerprint;
    saveDraft('closure:' + data.mode, data);
    saveWorkoutDraftsNow(data.mode);
    const confirmButton = byId('tp-close-confirm'); if (confirmButton) confirmButton.disabled = true;
    try {
      const saved = live ? saveLiveWorkout(options) : saveSession(options);
      if (!saved?.id) throw new Error('No se pudo completar el guardado. El borrador sigue disponible.');
      clearDraft('closure:' + data.mode); state.closure = null; closeDialog();
    } finally { if (confirmButton?.isConnected) confirmButton.disabled = false; }
  }
  function persistSession(session, records) {
    if (rows('sessions').some(row => row.id === session.id)) return;
    transaction({ records, sessions: [session, ...rows('sessions')] });
  }
  function afterWorkoutSaved(session) {
    renderHub();
    const names = new Set((session?.sets || []).map(set => normalize(set.exercise_name || set.exercise)));
    rows('training_progression_rules').filter(rule => rule.active !== false && names.has(normalize(rule.exercise))).forEach(rule => {
      const result = evaluateRule(rule, session.date);
      if (result.ready) toast(`${rule.exercise}: regla cumplida. Puedes revisar ${format(result.suggested)} kg.`);
    });
  }
  function openExerciseTools(group) {
    if (group.dataset.mode === 'live') { syncGymFocus(); saveWorkoutDraftsNow('live'); }
    state.group = group;
    const name = group.querySelector('.live-ex, .set-ex')?.value.trim() || '';
    if (!name) return toast('Escribe primero el ejercicio', 'err');
    const profile = profileFor(name);
    const alternatives = rows('exercise_alternatives').filter(item => normalize(item.exercise) === normalize(name));
    dialog(`${heading(name, 'Referencias y alternativas de tu biblioteca.', button('close-dialog', icon('x'), 'title="Cerrar" aria-label="Cerrar"', 'icon'))}<p class="cp-copy">${esc(profile?.cues || 'Sin indicaciones personales guardadas.')}</p>${section('Alternativas para las series pendientes', alternatives.map(item => `<article class="cp-item cp-row"><div><strong>${esc(item.alternative)}</strong><p>${esc(item.reason)}</p></div>${button('use-alternative', 'Usar alternativa', attr(item.id))}</article>`).join('') || empty('Guarda alternativas desde la biblioteca de ejercicios.'))}${section('Técnica', rows('exercise_techniques').filter(item => normalize(item.exercise) === normalize(name)).map(item => `<article class="cp-item"><h3>${esc(item.title)}</h3><p class="cp-copy">${esc(item.cues)}</p>${safeUrl(item.url) ? `<a class="tp-media-link" href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${icon('external-link')}Abrir referencia</a>` : ''}</article>`).join('') || empty('Sin referencias guardadas.'))}`, 'Alternativas y técnica');
    state.group = group;
  }
  function useAlternative(id) {
    const group = state.group; const alternative = rows('exercise_alternatives').find(item => item.id === id);
    if (!group?.isConnected || !alternative) throw new Error('El ejercicio ya no está disponible en el borrador.');
    const mode = group.dataset.mode; const prefix = mode === 'live' ? 'live' : 'set';
    const pending = [...group.querySelectorAll('.exercise-series-row')].filter(row => !liveRowCompleted(row) && row.dataset.manualTouched !== 'true');
    if (!pending.length) throw new Error('No hay series pendientes sin editar para sustituir. Las series realizadas se conservan.');
    if (!confirm(`¿Sustituir ${pending.length} serie(s) pendiente(s) por ${alternative.alternative}? La carga quedará vacía para que la registres para este ejercicio.`)) return;
    const parent = group.parentElement; const target = getOrCreateExerciseGroup(parent, alternative.alternative, mode);
    const targetList = target.querySelector('.exercise-series-list'); const existing = targetList.children.length;
    pending.forEach((row, index) => {
      row.querySelector('.' + prefix + '-kg').value = '';
      ['rir', 'rpe'].forEach(key => { const input = row.querySelector('.' + prefix + '-' + key); if (input) input.value = ''; });
      row.querySelector('.' + prefix + '-sn').value = existing + index + 1;
      row.querySelector('.' + prefix + '-target-sets').value = existing + pending.length;
      const label = row.querySelector('.series-index'); if (label) label.textContent = existing + index + 1;
      const goal = row.querySelector('.target-pill'); const reps = row.querySelector('.' + prefix + '-target-reps')?.value;
      if (goal) goal.textContent = reps ? `${existing + index + 1}/${existing + pending.length} × ${reps}` : 'Libre';
      row.dataset.completed = 'false'; row.dataset.manualTouched = 'false'; targetList.append(row);
    });
    if (!group.querySelector('.exercise-series-row')) group.remove();
    saveWorkoutDraftsNow(mode === 'live' ? 'live' : 'session'); if (mode === 'live') renderMobileGymDraft();
    closeDialog(); refreshInterfaceIcons(); toast('Alternativa preparada; las series realizadas mantienen su ejercicio original');
  }

  // EVENTS AND PUBLIC API
  function renderHub() {
    const target = byId('training-pro-hub'); if (!target) return;
    const nav = [['muscles', 'Trabajo muscular', 'chart-bar'], ['library', 'Ejercicios y técnica', 'library'], ['rules', 'Reglas de carga', 'trending-up'], ['blocks', 'Bloques', 'layers']];
    target.innerHTML = `<div class="cp-row"><h3>Control del entrenamiento</h3><small>Semana ${esc(weekValueFromDate())}</small></div><nav class="tp-nav" aria-label="Herramientas de entrenamiento">${nav.map(([key, label, symbol]) => button('hub-view', icon(symbol) + label, `data-view="${key}"`, state.hub === key ? 'active' : '')).join('')}</nav><div id="tp-hub-content">${state.hub === 'library' ? renderLibrary() : state.hub === 'rules' ? renderRules() : renderMuscles()}</div>`;
    restoreLibraryDrafts();
    refreshInterfaceIcons();
  }
  function renderCoach(view) {
    return ({ blocks: renderBlocks, 'exercise-library': renderLibrary, 'training-rules': renderRules })[view]?.();
  }
  function mountCoach(view) {
    restoreLibraryDrafts();
    if (!['monitor', 'analysis'].includes(view)) return;
    const ready = rows('training_progression_rules').filter(rule => rule.active !== false).map(rule => ({ rule, result: evaluateRule(rule) })).filter(item => item.result.ready);
    if (ready.length) byId('coach-workspace')?.insertAdjacentHTML('beforeend', `<div class="tp cp">${section('Reglas listas para revisar', ready.map(({ rule, result }) => `<div class="cp-item cp-row"><span><strong>${esc(rule.exercise)}</strong> · ${format(result.base)} → ${format(result.suggested)} kg</span>${button('view-rules', 'Revisar regla')}</div>`).join(''))}</div>`);
  }
  const actions = {
    'hub-view': target => { if (target.dataset.view === 'blocks') return openCoach('blocks'); state.hub = target.dataset.view; renderHub(); },
    'select-exercise': target => { state.libraryName = target.dataset.name; refresh(); },
    'new-profile': () => { const name = value('tp-library-new').trim(); if (!name) throw new Error('Escribe el nombre del ejercicio.'); state.libraryName = name; refresh(); },
    'delete-alternative': target => { if (remove('exercise_alternatives', target.dataset.id, 'esta alternativa')) refresh(); },
    'delete-technique': target => { if (remove('exercise_techniques', target.dataset.id, 'esta referencia')) refresh(); },
    'edit-technique': target => { const item = rows('exercise_techniques').find(row => row.id === target.dataset.id); if (item) { state.techniqueId = item.id; saveDraft('technique:' + normalize(item.exercise), item); restoreLibraryDrafts(); byId('tp-tech-title')?.focus(); } },
    'new-rule': () => { state.ruleId = ''; clearDraft('rule'); refresh(); },
    'edit-rule': target => { state.ruleId = target.dataset.id; clearDraft('rule'); refresh(); },
    'toggle-rule': target => { const rule = rows('training_progression_rules').find(row => row.id === target.dataset.id); if (rule) put('training_progression_rules', { ...rule, active: rule.active === false, updated_at: now() }); refresh(); },
    'delete-rule': target => { if (remove('training_progression_rules', target.dataset.id, 'esta regla')) { state.ruleId = ''; refresh(); } },
    'prepare-rule': target => prepareRule(target.dataset.id),
    'view-rules': () => openCoach('training-rules'),
    'new-block': () => { state.block = null; state.blockPreview = null; clearDraft('block'); refresh(); },
    'save-block': saveBlock,
    'edit-block': target => { state.block = clone(rows('training_blocks').find(row => row.id === target.dataset.id)); state.blockPreview = null; saveDraft('block', state.block); refresh(); },
    'archive-block': target => { const block = rows('training_blocks').find(row => row.id === target.dataset.id); if (block && confirm('¿Archivar el bloque? Sus semanas planificadas se conservarán.')) { put('training_blocks', { ...block, status: 'archived', updated_at: now() }); if (state.block?.id === block.id) state.block.status = 'archived'; refresh(); } },
    'add-block-week': () => { const block = captureBlock(); if (block.weeks.length < 16) block.weeks.push({ type: 'custom', volume_pct: 100, load_pct: 100, notes: '' }); state.blockPreview = null; saveDraft('block', block); refresh(); },
    'remove-block-week': () => { const block = captureBlock(); if (block.weeks.length > 1) block.weeks.pop(); state.blockPreview = null; saveDraft('block', block); refresh(); },
    'preview-block': () => { captureBlock(); state.blockPreview = buildBlockPlans(state.block, state.blockOverwrite); refresh(); },
    'apply-block': applyBlock,
    'open-day-plan': target => { changeGlobalDate(target.dataset.date); openCoach('planning'); },
    'select-visible-days': () => { document.querySelectorAll('#calendar-month-draft [data-calendar-drop-date]').forEach(zone => state.dates.add(zone.dataset.calendarDropDate)); state.bulkPreview = null; mountCalendar(); },
    'clear-bulk-selection': () => { state.dates.clear(); state.bulkPreview = null; mountCalendar(); },
    'close-bulk': () => { state.bulk = false; mountCalendar(); },
    'open-bulk': bulkDialog,
    'select-date-range': () => { const from = value('tp-bulk-from'); const until = value('tp-bulk-until'); const count = dayDistance(from, until); if (!from || !until || !Number.isFinite(count) || count < 0 || count > 92) throw new Error('Elige un rango de hasta 93 días.'); for (let offset = 0; offset <= count; offset++) state.dates.add(addDays(from, offset)); state.bulkPreview = null; if (byId('tp-bulk-preview')) byId('tp-bulk-preview').innerHTML = ''; renderBulkDates(); mountCalendar(); },
    'remove-bulk-date': target => { state.dates.delete(target.dataset.date); state.bulkPreview = null; if (byId('tp-bulk-preview')) byId('tp-bulk-preview').innerHTML = ''; renderBulkDates(); mountCalendar(); },
    'preview-bulk': previewBulk,
    'confirm-bulk': confirmBulk,
    'use-alternative': target => useAlternative(target.dataset.id),
    'close-dialog': closeDialog
  };
  function guard(callback) { try { callback(); refreshInterfaceIcons(); } catch (error) { console.error(error); toast(error.message || 'No se pudo completar la operación.', 'err'); } }
  document.addEventListener('click', event => {
    const target = event.target.closest?.('[data-tp-action]'); if (!target || target.disabled) return;
    const action = actions[target.dataset.tpAction]; if (!action) return;
    event.preventDefault(); event.stopPropagation(); guard(() => action(target));
  });
  document.addEventListener('submit', event => {
    const name = event.target.dataset?.tpForm; if (!name) return;
    event.preventDefault(); guard(() => ({ profile: saveProfile, alternative: saveAlternative, technique: saveTechnique, rule: saveRule, closure: confirmClosure })[name]?.());
  });
  document.addEventListener('change', event => {
    const target = event.target; const key = target.dataset?.tpChange;
    if (!key) return;
    guard(() => {
      if (key === 'muscle-week') renderHub();
      if (key === 'library-filter') { state.filter = target.value; refresh(); }
      if (key === 'block-overwrite') { state.blockOverwrite = target.checked; state.blockPreview = buildBlockPlans(captureBlock(), state.blockOverwrite); refresh(); }
      if (key === 'invalidate-bulk') { state.bulkPreview = null; if (byId('tp-bulk-preview')) byId('tp-bulk-preview').innerHTML = ''; }
    });
  });
  document.addEventListener('input', event => {
    const target = event.target; if (!target.closest?.('.tp')) return;
    guard(() => {
      if (target.closest('[data-tp-form="closure"]')) return captureClosure();
      if (target.id === 'tp-library-filter') {
        state.filter = target.value;
        document.querySelectorAll('[data-tp-action="select-exercise"]').forEach(button => { button.hidden = !normalize(button.dataset.name).includes(normalize(state.filter)); });
      }
      if (target.closest('[data-tp-form="profile"]')) saveDraft('profile:' + normalize(librarySelected()), { muscle: value('tp-profile-muscle'), equipment: value('tp-profile-equipment'), cues: value('tp-profile-cues') });
      if (target.closest('[data-tp-form="technique"]')) saveDraft('technique:' + normalize(librarySelected()), { id: state.techniqueId || '', title: value('tp-tech-title'), kind: value('tp-tech-kind'), url: value('tp-tech-url'), author: value('tp-tech-author'), cues: value('tp-tech-cues') });
      if (target.closest('[data-tp-form="alternative"]')) saveDraft('alternative:' + normalize(librarySelected()), { name: value('tp-alternative-name'), reason: value('tp-alternative-reason') });
      if (target.closest('[data-tp-form="rule"]')) saveDraft('rule', { ...ruleData(), id: state.ruleId });
      if (target.id.startsWith('tp-block-') && target.id !== 'tp-block-overwrite') {
        if (target.id === 'tp-block-source' && state.block?.source_week !== target.value) delete state.block.source_snapshot;
        captureBlock(); state.blockPreview = null; if (byId('tp-block-preview')) byId('tp-block-preview').innerHTML = '';
      }
      if (target.dataset.tpBlockWeek) {
        const week = loadBlock().weeks[+target.dataset.index]; const key = target.dataset.tpBlockWeek;
        week[key] = ['volume_pct', 'load_pct'].includes(key) ? (target.value === '' ? null : Number(target.value)) : target.value;
        saveDraft('block', state.block); state.blockPreview = null; if (byId('tp-block-preview')) byId('tp-block-preview').innerHTML = '';
      }
    });
  });
  document.addEventListener('keydown', event => {
    const modal = byId('tp-dialog'); if (!modal) return;
    if (event.key === 'Escape') { event.preventDefault(); closeDialog(); }
    if (event.key === 'Tab') {
      const focusable = [...modal.querySelectorAll('button:not([disabled]),input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')].filter(node => node.getClientRects().length);
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === modal.querySelector('.modal'))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  return { renderHub, renderCoach, mountCoach, toggleBulk, mountCalendar, calendarPlanHtml, openExerciseTools, reviewWorkout, persistSession, afterWorkoutSaved, muscleVolume, evaluateRule, buildBlockPlans, buildBulk, closureOptions, workoutSnapshot };
})();

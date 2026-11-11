(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CoachContract = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const nutritionFields = { calories: [800, 6000], protein: [20, 400], carbs: [20, 800], fat: [15, 250] };
  const exerciseFields = { sets: [1, 40], reps: [1, 100], weight: [0, 1500] };
  const phaseFields = { weekly_volume_target: [0, 10000000], training_volume_pct: [10, 200], load_min_pct: [0, 100], load_max_pct: [0, 100] };
  const allowed = ['nutrition', 'exercise_target', 'plan_exercise', 'phase_training', 'goal', 'calendar_event', 'guideline'];
  const text = (value, limit = 240) => String(value ?? '').trim().slice(0, limit);
  function date(value) {
    const raw = text(value, 10);
    const parsed = new Date(raw + 'T12:00:00Z');
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw;
  }
  function pickNumbers(data, fields) {
    const clean = {};
    for (const [field, [min, max]] of Object.entries(fields)) {
      if (data[field] === undefined) continue;
      const value = data[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (field !== 'weight' && !Number.isInteger(value))) throw new Error(`Valor inválido para ${field}.`);
      clean[field] = value;
    }
    return clean;
  }
  function clean(value, depth = 0) {
    if (value == null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') return value.slice(0, 6000);
    if (depth > 10) return null;
    if (Array.isArray(value)) return value.slice(0, 240).map(item => clean(item, depth + 1));
    if (typeof value !== 'object') return null;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key)).slice(0, 80).map(([key, item]) => [key, clean(item, depth + 1)]));
  }
  function operation(raw, context) {
    if (!raw || typeof raw !== 'object' || !allowed.includes(raw.type)) throw new Error('Tipo de cambio no permitido.');
    const type = raw.type, target = raw.target || {}, data = raw.data || {};
    const result = { type, label: text(raw.label) || type, target: {}, data: {} };
    if (type === 'nutrition') result.data = pickNumbers(data, nutritionFields);
    if (type === 'phase_training') {
      if (context.phase?.id == null || context.phase.id === '' || String(target.id) !== String(context.phase.id)) throw new Error('No se identificó la fase activa.');
      result.target = { id: context.phase.id }; result.data = pickNumbers(data, phaseFields);
    }
    if (type === 'exercise_target' || type === 'plan_exercise') {
      const catalog = type === 'exercise_target' ? context.exercise_catalog : context.plan_catalog;
      const match = (catalog || []).find(row => type === 'exercise_target'
        ? String(row.routine_id) === String(target.routine_id) && String(row.day_id) === String(target.day_id) && row.exercise_index === target.exercise_index && row.name === target.name
        : String(row.plan_id) === String(target.plan_id) && row.date === target.date && row.exercise_index === target.exercise_index && row.name === target.name);
      if (!match) throw new Error('El ejercicio o plan no coincide con los datos actuales.');
      if (type === 'exercise_target' ? match.routine_id == null || match.day_id == null : match.plan_id == null) throw new Error('Faltan identificadores del plan o la rutina.');
      const effective = text(raw.effective_date || context.today, 10);
      if (!date(effective) || effective < context.today || (type === 'plan_exercise' && (!date(match.date) || match.date < effective))) throw new Error('La prescripción no puede modificar días anteriores.');
      result.target = type === 'exercise_target'
        ? { routine_id: match.routine_id, day_id: match.day_id, exercise_index: match.exercise_index, name: match.name }
        : { plan_id: match.plan_id, date: match.date, exercise_index: match.exercise_index, name: match.name };
      result.effective_date = effective;
      result.data = pickNumbers(data, exerciseFields);
    }
    if (['goal', 'calendar_event', 'guideline'].includes(type)) {
      const key = { goal: 'goals', calendar_event: 'events', guideline: 'guidelines' }[type];
      const hasId = target.id !== undefined && target.id !== null && target.id !== '';
      const current = hasId ? (context[key] || []).find(row => String(row.id) === String(target.id)) : null;
      if (hasId && !current) throw new Error('El registro solicitado ya no está disponible.');
      result.target = current ? { id: current.id } : {};
      const fields = type === 'goal' ? ['title', 'target', 'unit', 'type'] : type === 'calendar_event' ? ['title', 'date', 'all_day', 'start_time', 'end_time', 'category', 'notes'] : ['title', 'copy', 'start_date', 'end_date'];
      for (const field of fields) if (data[field] !== undefined) {
        if (field === 'target') {
          if (typeof data[field] !== 'number' || !Number.isFinite(data[field]) || data[field] < 0 || data[field] > 10000000) throw new Error('Meta inválida.');
          result.data[field] = data[field];
        } else if (field === 'all_day') {
          if (typeof data[field] !== 'boolean') throw new Error('Formato de evento inválido.');
          result.data[field] = data[field];
        } else result.data[field] = text(data[field], field === 'copy' || field === 'notes' ? 1500 : 160);
      }
      const merged = { ...current, ...result.data };
      if (!merged.title) throw new Error('Falta el título del registro.');
      if (type === 'calendar_event') {
        if (!date(merged.date) || merged.date < context.today) throw new Error('El evento debe estar en una fecha actual o futura.');
        if (merged.all_day !== true && (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(merged.start_time || '') || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(merged.end_time || '') || merged.start_time >= merged.end_time)) throw new Error('Revisa los horarios del evento.');
        if (merged.category && !['personal', 'training', 'nutrition', 'health', 'reminder'].includes(merged.category)) throw new Error('Categoría de evento inválida.');
      }
      if (type === 'guideline' && (!date(merged.start_date) || !date(merged.end_date) || merged.start_date < context.today || merged.end_date < merged.start_date)) throw new Error('Revisa las fechas de la pauta.');
      if (type === 'goal' && merged.type && !['weight', 'fat', 'strength', 'cardio_steps', 'cardio_minutes', 'training_count', 'checking_rate', 'other'].includes(merged.type)) throw new Error('Tipo de objetivo inválido.');
    }
    if (!Object.keys(result.data).length) throw new Error('El cambio no tiene valores concretos.');
    return result;
  }
  function normalize(raw, context) {
    const response = { message: text(raw?.message, 6000) || 'No hay una respuesta disponible.', warnings: (Array.isArray(raw?.warnings) ? raw.warnings : []).slice(0, 8).map(item => text(item, 500)), summary: text(raw?.summary) || 'Acuerdo propuesto', operations: [], needs_clarification: Boolean(raw?.needs_clarification) };
    try {
      if (raw?.operations !== undefined && !Array.isArray(raw.operations)) throw new Error('La propuesta no tiene un formato válido.');
      if ((raw?.operations || []).length > 20) throw new Error('La propuesta contiene demasiados cambios.');
      if (!response.needs_clarification) response.operations = (raw?.operations || []).map(item => operation(item, context));
      const signatures = response.operations.map(item => item.type + ':' + JSON.stringify(item.target) + (['goal', 'calendar_event', 'guideline'].includes(item.type) && !Object.hasOwn(item.target, 'id') ? ':' + JSON.stringify(item.data) : ''));
      if (new Set(signatures).size !== signatures.length) throw new Error('Hay cambios repetidos sobre el mismo destino.');
    } catch (error) {
      response.operations = []; response.needs_clarification = true;
      response.warnings.push(`Propuesta bloqueada: ${error.message}`);
    }
    return response;
  }
  return { nutritionFields, exerciseFields, phaseFields, clean, date, normalize };
});

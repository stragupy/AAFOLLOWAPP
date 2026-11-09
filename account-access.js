(() => {
  let state = null, page = 1, loading = false, requestId = 0;
  const root = () => document.getElementById('account-access');
  const text = value => esc(String(value ?? ''));
  const icon = name => `<i data-lucide="${name}"></i>`;
  const storageKey = userId => `aa_ai_connection:${userId}`;
  function connectionToken(userId) {
    try {
      const token = localStorage.getItem(storageKey(userId)) || '';
      return token.length <= 2048 && /^v2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? token : '';
    } catch { return ''; }
  }
  function saveConnection(userId, token) {
    if (!userId || typeof token !== 'string' || !token.startsWith('v2.') || token.length > 2048) throw new Error('El servidor no devolvió una conexión válida.');
    try { localStorage.setItem(storageKey(userId), token); }
    catch { throw new Error('No se pudo guardar la conexión en este navegador. Revisa el espacio disponible.'); }
  }
  async function call(action, options = {}) {
    const response = await accountFetch(`/api/app-assistant?account=${action}`, { ...options, cache:'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo consultar la cuenta.');
    return data;
  }
  function render(error = '') {
    const el = root(); if (!el) return;
    const roleLabel = document.getElementById('workspace-account-role');
    if (roleLabel) { roleLabel.textContent = state?.role === 'founder' ? 'Fundador verificado' : 'Control personal'; roleLabel.classList.toggle('aa-founder-header', state?.role === 'founder'); }
    if (!state) {
      el.innerHTML = `<section class="aa-panel"><header><h2>Cuenta y conexión de IA</h2></header><p role="status" class="${error ? 'aa-error' : ''}">${text(error || 'Verificando tu cuenta...')}</p><button class="btn btn-ghost btn-sm" data-aa="refresh">${icon('refresh-cw')} Actualizar</button></section>`;
      refreshInterfaceIcons(); return;
    }
    const founder = state.role === 'founder', ai = state.ai;
    el.innerHTML = `<section class="aa-panel"><header><h2>Mi cuenta</h2><span class="aa-badge">${icon(founder ? 'badge-check' : 'user-check')}${founder ? 'Fundador verificado' : 'Cuenta verificada'}</span></header>
      <dl class="aa-details"><dt>Correo</dt><dd>${text(state.user.email)}</dd><dt>Permiso</dt><dd>${founder ? 'Fundador de AA Follow' : 'Usuario'}</dd><dt>ID de cuenta</dt><dd class="aa-uuid"><code>${text(state.user.id)}</code><button class="btn btn-ghost btn-sm" data-aa="copy-id" aria-label="Copiar ID de cuenta" title="Copiar ID de cuenta">${icon('copy')}</button></dd></dl>
      ${!state.founder_configured ? '<p>La cuenta fundadora todavía no está asignada en el servidor.</p>' : ''}</section>
      <section class="aa-panel"><header><h2>Mi conexión de IA</h2><span class="aa-badge">${ai.connected ? 'Conectada' : 'Sin conexión'}</span></header>
        <div class="aa-connection">${icon('sparkles')}<div><strong>Gemini</strong><small>${text(ai.model)}${ai.source === 'founder' ? ' · Conexión de fundador' : ai.connected ? ' · Conexión personal' : ''}</small></div></div>
        <p>La IA utiliza la cuota de tu propia clave de Google. Tu cuenta funciona sin IA para registrar y consultar tus datos.</p>
        ${state.connection_error ? `<div class="aa-notice">${text(state.connection_error.message)}</div>` : ''}
        <form id="aa-connect-form"><label for="aa-gemini-key">${ai.connected ? 'Reemplazar conexión personal' : 'Clave de Gemini'}</label><div class="aa-key-row"><input id="aa-gemini-key" type="password" name="gemini-key" autocomplete="new-password" spellcheck="false" autocapitalize="none" maxlength="256" required placeholder="Clave de Google AI Studio"><button class="btn btn-primary btn-sm" type="submit">${icon('plug-zap')} Verificar y conectar</button></div></form>
        <div class="aa-actions"><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm">${icon('external-link')} Obtener mi clave</a>${ai.personal_connected ? `<button class="btn btn-ghost btn-sm" data-aa="disconnect">${icon('unplug')} Desconectar</button>` : ''}</div>
        <p>La conexión se guarda cifrada en este navegador durante un máximo de 90 días. No se incluye en copias de seguridad. En otro dispositivo deberás conectarla de nuevo. Verificar realiza una consulta breve a Gemini.</p>
        <p>Desconectar elimina la conexión de este navegador; para invalidar la clave de Google, revócala en Google AI Studio.</p>
        <p>Al usar IA, se envían a Google el texto, las imágenes y los registros necesarios para la solicitud. Se aplican los límites y condiciones de tu cuenta de Google.</p>
        <div id="aa-connection-status" role="status" aria-live="polite" class="${error ? 'aa-error' : ''}">${text(error)}</div></section>
      ${founder ? `<section class="aa-panel"><header><h2>Administración de AA Follow</h2><span class="aa-badge">${icon('shield-check')} Solo fundador</span></header><p>Consulta las cuentas registradas. Las claves privadas y los registros personales no se muestran en este listado.</p>${state.admin_available ? `<button class="btn btn-ghost btn-sm" data-aa="users">${icon('users')} Ver cuentas</button>` : '<p>El listado no está disponible con la conexión administrativa actual. Tu acceso de fundador sigue activo.</p>'}<div id="aa-users" aria-live="polite"></div></section>` : ''}`;
    refreshInterfaceIcons();
  }
  async function refresh() {
    const id = ++requestId;
    try { const result = await call('status'); if (id !== requestId) return; state = result; render(); }
    catch (error) { if (id === requestId) { state = null; render(error.message); } }
  }
  function busy(value) { loading = value; root()?.querySelectorAll('button').forEach(button => button.disabled = value); }
  async function connect(event) {
    event.preventDefault(); if (loading) return;
    const input = document.getElementById('aa-gemini-key');
    const key = input?.value.trim(); if (!key) return;
    const id = requestId;
    busy(true);
    document.getElementById('aa-connection-status').textContent = 'Verificando conexión...';
    try {
      const userId = state?.user?.id;
      const result = await call('connect', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({api_key:key}) });
      if (id === requestId) { saveConnection(userId, result.connection_token); input.value = ''; toast('Gemini conectado en este navegador'); await refresh(); }
    }
    catch (error) { if (id === requestId) document.getElementById('aa-connection-status').textContent = error.message; }
    finally { if (input) input.value = ''; busy(false); }
  }
  async function users() {
    const target = document.getElementById('aa-users'); if (!target) return;
    const id = requestId;
    target.textContent = 'Consultando cuentas...'; busy(true);
    try {
      const data = await call(`users&page=${page}`); if (id !== requestId) return;
      const date = value => value ? new Date(value).toLocaleDateString('es-AR') : 'Sin acceso';
      target.innerHTML = `<div class="aa-table-wrap"><table><thead><tr><th>Cuenta</th><th>Permiso</th><th>Correo</th><th>Creación</th><th>Último acceso</th></tr></thead><tbody>${data.users.map(user => `<tr><td>${text(user.email)}<br><code>${text(user.id)}</code></td><td>${user.role === 'founder' ? 'Fundador' : 'Usuario'}</td><td>${user.verified ? 'Verificado' : 'Pendiente'}</td><td>${text(date(user.created_at))}</td><td>${text(date(user.last_sign_in_at))}</td></tr>`).join('') || '<tr><td colspan="5">Sin cuentas en esta página</td></tr>'}</tbody></table></div><div class="aa-actions"><button class="btn btn-ghost btn-sm" data-aa="prev" ${page === 1 ? 'hidden' : ''}>Anterior</button><span>Página ${page}</span><button class="btn btn-ghost btn-sm" data-aa="next" ${data.has_more ? '' : 'hidden'}>Siguiente</button></div>`;
    } catch (error) { if (id === requestId) target.textContent = error.message; }
    finally { busy(false); }
  }
  document.addEventListener('submit', event => { if (event.target.id === 'aa-connect-form') connect(event); });
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-aa]'); if (!button || loading) return;
    try {
      const action = button.dataset.aa;
      if (action === 'refresh') await refresh();
      if (action === 'copy-id') { await navigator.clipboard.writeText(state.user.id); toast('ID copiado'); }
      if (action === 'users') { page = 1; await users(); }
      if (action === 'prev' || action === 'next') { page = Math.max(1, page + (action === 'next' ? 1 : -1)); await users(); }
      if (action === 'disconnect' && confirm('¿Desconectar Gemini en este navegador? Tus registros se conservarán.')) { localStorage.removeItem(storageKey(state.user.id)); await refresh(); }
    } catch (error) { toast(error.message, 'err'); }
    finally { busy(false); }
  });
  window.AccountAccess = { refresh, connectionToken, reset() { requestId++; state = null; page = 1; root()?.replaceChildren(); const label = document.getElementById('workspace-account-role'); if (label) { label.textContent = 'Control personal'; label.classList.remove('aa-founder-header'); } }, get role() { return state?.role || 'member'; } };
})();

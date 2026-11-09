// Legacy ft_ data stays in place; additional accounts get independent namespaces.
(() => {
  const marker = 'aa_storage_account';
  const legacyOwner = 'aa_legacy_owner_id';
  let userId = localStorage.getItem(marker) || '';
  const prefixFor = id => !id || localStorage.getItem(legacyOwner) === id ? 'ft_' : `aa_account:${id}:ft_`;
  const prefix = prefixFor(userId);
  function ensure() {
    if ((localStorage.getItem(marker) || '') !== userId) throw new Error('La cuenta cambió en otra pestaña. Recarga antes de guardar.');
  }
  function activate(user) {
    if (!user?.id || !user.email) throw new Error('No se pudo identificar la cuenta.');
    let savedEmail = '';
    try { savedEmail = JSON.parse(localStorage.getItem('ft_activeUser') || 'null') || ''; } catch {}
    let nextPrefix;
    try {
      if (!localStorage.getItem(legacyOwner) && String(savedEmail).toLowerCase() === user.email.toLowerCase()) {
        localStorage.setItem(legacyOwner, user.id);
      }
      nextPrefix = prefixFor(user.id);
      localStorage.setItem(marker, user.id);
    } catch {
      window.setLoginStatus?.('No se pudo preparar el almacenamiento de esta cuenta. Tus datos anteriores no se borraron.');
      window.toast?.('No se pudo abrir la cuenta en este navegador. Revisa el espacio disponible.', 'err');
      return false;
    }
    if (nextPrefix !== prefix) {
      sessionStorage.setItem('aa_resume_account', user.id);
      location.reload();
      return false;
    }
    userId = user.id;
    return true;
  }
  function owns(id) { return Boolean(id && id === userId && localStorage.getItem(marker) === userId); }
  function entries() {
    ensure();
    return Object.keys(localStorage).filter(key => key.startsWith(prefix)).map(key => [key.slice(prefix.length), localStorage.getItem(key)]);
  }
  window.AccountStorage = { activate, owns, ensure, entries, get userId() { return userId; } };
  window.accountStorageKey = key => { ensure(); return prefix + key; };
  window.addEventListener('storage', event => { if (event.key === marker && (event.newValue || '') !== userId) location.reload(); });
})();

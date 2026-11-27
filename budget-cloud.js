(() => {
    const config = window.budgetSupabaseConfig;
    if (!config?.url && !config?.publishableKey) return;

    const accountPanel = document.getElementById('accountPanel');
    const login = document.getElementById('loginForm');
    const signOut = document.getElementById('signOut');
    const retry = document.getElementById('retrySync');
    const reload = document.getElementById('reloadCloud');
    const status = document.getElementById('accountStatus');
    const app = document.getElementById('budgetApp');
    const nav = document.getElementById('budgetNav');
    let client;
    let account;

    accountPanel.hidden = false;
    showBudget(false);
    status.textContent = 'Conectando con Supabase…';

    function showBudget(visible) {
        app.hidden = !visible;
        nav.hidden = !visible;
    }

    function showStatus(message, { canRetry = false, conflict = false } = {}) {
        status.textContent = message;
        retry.hidden = !canRetry;
        reload.hidden = !conflict;
    }

    function saveDraft(state) {
        try {
            if (state.pending) {
                sessionStorage.setItem(state.key, JSON.stringify({
                    revision: state.revision, pending: state.pending, attempt: state.attempt,
                }));
            } else {
                sessionStorage.removeItem(state.key);
            }
            return true;
        } catch {
            return false;
        }
    }

    async function loadAccount(state, discardDraft = false) {
        state.ready = false;
        budgetSession++;
        showBudget(false);
        showStatus('Cargando tu presupuesto…');
        try {
            const { data, error } = await client.from('budget_workspaces')
                .select('version, payload').eq('user_id', state.id).maybeSingle();
            if (account !== state) return;
            if (error) throw error;
            const remote = data ? parseBudget(data.payload, defaultSchema) : emptyBudget();
            const revision = data?.version ?? null;
            const draft = discardDraft ? null : JSON.parse(sessionStorage.getItem(state.key) || 'null');
            state.pending = draft ? parseBudget(draft.pending, defaultSchema) : null;
            state.attempt = draft?.attempt ?? null;
            state.conflict = Boolean(draft && draft.revision !== revision && state.attempt?.version !== revision);
            state.revision = revision;
            if (state.attempt?.version === revision) {
                if (JSON.stringify(state.pending) === JSON.stringify(state.attempt.payload)) state.pending = null;
                state.attempt = null;
            }
            if (state.conflict) state.revision = draft.revision;
            setBudget(structuredClone(state.pending || remote));
            state.ready = true;
            signOut.disabled = false;
            showBudget(true);
            saveDraft(state);
            if (state.conflict) {
                showConflict();
            } else if (state.pending) {
                sync(state);
            } else {
                showStatus(data ? 'Presupuesto sincronizado' : 'Cuenta lista. Puedes importar un respaldo en Plan.');
            }
        } catch (error) {
            if (account !== state) return;
            signOut.disabled = false;
            showStatus(`No se pudo cargar el presupuesto. ${error.message}`, { canRetry: true });
        }
    }

    function showConflict() {
        showStatus('Hay cambios en otro dispositivo. Descarga un respaldo en Plan antes de cargar la versión de la nube.', { conflict: true });
    }

    async function sync(state) {
        if (!state.ready || state.saving || !state.pending || state.conflict) return;
        state.saving = true;
        try {
            while (state.pending && account === state) {
                const attempt = state.attempt ??= { version: crypto.randomUUID(), payload: state.pending };
                const draftSaved = saveDraft(state);
                showStatus(draftSaved ? 'Guardando cambios…' : 'Guardando cambios. Mantén abierta esta pestaña.');
                const table = client.from('budget_workspaces');
                const record = { version: attempt.version, payload: attempt.payload };
                const write = state.revision === null
                    ? table.insert({ ...record, user_id: state.id })
                    : table.update(record).eq('user_id', state.id).eq('version', state.revision);
                const { data, error } = await write.select('version').maybeSingle();
                if (account !== state) return;
                if (error && error.code !== '23505') throw error;
                if (!data) {
                    const { data: latest, error: readError } = await client.from('budget_workspaces')
                        .select('version').eq('user_id', state.id).maybeSingle();
                    if (account !== state) return;
                    if (readError) throw readError;
                    if (latest?.version !== attempt.version) {
                        state.conflict = true;
                        showConflict();
                        return;
                    }
                }
                state.revision = attempt.version;
                state.attempt = null;
                if (JSON.stringify(state.pending) === JSON.stringify(attempt.payload)) state.pending = null;
                saveDraft(state);
            }
            if (account === state) showStatus('Presupuesto sincronizado');
        } catch {
            if (account === state) {
                const stored = saveDraft(state);
                showStatus(stored ? 'Cambios pendientes en esta pestaña. Reintenta para sincronizarlos.'
                    : 'Cambios pendientes. Mantén abierta esta pestaña y reintenta.', { canRetry: true });
            }
        } finally {
            state.saving = false;
        }
    }

    window.saveBudgetToCloud = payload => {
        if (!account?.ready) return;
        account.pending = payload;
        saveDraft(account);
        if (!account.saving && !account.conflict) showStatus('Cambios pendientes…');
        clearTimeout(account.timer);
        const state = account;
        state.timer = setTimeout(() => { if (account === state) sync(state); }, 350);
    };

    async function selectAccount(user) {
        if (user && user.id === account?.id) return;
        budgetSession++;
        if (account) clearTimeout(account.timer);
        account = user ? {
            id: user.id, key: `budget-draft:${config.url}:${user.id}`,
            ready: false, revision: null, pending: null, attempt: null,
        } : null;
        showBudget(false);
        for (const id of ['incomeLogAmount', 'incomeLogDesc', 'logAmount', 'logDesc']) {
            document.getElementById(id).value = '';
        }
        setBudget(emptyBudget());
        login.hidden = Boolean(user);
        signOut.hidden = !user;
        signOut.disabled = Boolean(user);
        if (account) await loadAccount(account);
        else showStatus('Inicia sesión para acceder a tu presupuesto.');
    }

    login.addEventListener('submit', async event => {
        event.preventDefault();
        const button = login.querySelector('button');
        button.disabled = true;
        showStatus('Iniciando sesión…');
        try {
            const { data, error } = await client.auth.signInWithPassword({
                email: login.elements.email.value.trim(), password: login.elements.password.value,
            });
            if (error) throw error;
            login.reset();
            await selectAccount(data.user);
        } catch {
            showStatus('No se pudo iniciar sesión. Verifica tus credenciales y tu conexión.');
        } finally {
            button.disabled = false;
        }
    });

    signOut.addEventListener('click', async () => {
        if (account?.pending || account?.saving) {
            if (!account.conflict) sync(account);
            return;
        }
        signOut.disabled = true;
        try {
            const { error } = await client.auth.signOut({ scope: 'local' });
            if (error) throw error;
            await selectAccount(null);
        } catch {
            showStatus('No se pudo cerrar sesión. Intenta de nuevo.');
            signOut.disabled = false;
        }
    });

    retry.addEventListener('click', () => {
        if (!account) return;
        if (account.ready) sync(account);
        else loadAccount(account);
    });
    reload.addEventListener('click', () => {
        if (confirm('¿Descartar los cambios de esta pestaña y cargar la versión de la nube?')) loadAccount(account, true);
    });
    window.addEventListener('beforeunload', event => {
        if (!account?.pending) return;
        event.preventDefault();
        event.returnValue = '';
    });

    const sdk = document.createElement('script');
    sdk.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    sdk.onload = () => {
        try {
            const url = new URL(config.url);
            if (url.protocol !== 'https:' || !config.publishableKey.startsWith('sb_publishable_')) {
                throw new Error('Configuración inválida');
            }
            client = window.supabase.createClient(config.url, config.publishableKey);
            client.auth.onAuthStateChange((event, session) => {
                setTimeout(() => selectAccount(session?.user ?? null), 0);
            });
        } catch {
            showStatus('Revisa la URL HTTPS y la clave publicable en supabase-config.js.');
        }
    };
    sdk.onerror = () => showStatus('No se pudo cargar Supabase. Comprueba tu conexión y recarga la página.');
    document.head.append(sdk);
})();

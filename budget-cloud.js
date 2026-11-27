(() => {
    const config = window.budgetSupabaseConfig;
    if (!config?.url && !config?.publishableKey) return;

    const accountPanel = document.getElementById('accountPanel');
    const login = document.getElementById('loginForm');
    const signOut = document.getElementById('signOut');
    const retryAccount = document.getElementById('retryAccount');
    const retry = document.getElementById('syncRetry');
    const reload = document.getElementById('syncReload');
    const accountStatus = document.getElementById('accountStatus');
    const syncStatus = document.getElementById('syncStatus');
    const syncPanel = document.getElementById('syncPanel');
    const profileStatus = document.getElementById('profileStatus');
    const profileButton = document.getElementById('profileButton');
    const app = document.getElementById('budgetApp');
    const nav = document.getElementById('budgetNav');
    let client;
    let account;
    let sessionToVerify;
    let verification = 0;

    accountPanel.hidden = false;
    showBudget(false);
    accountStatus.textContent = 'Conectando con Supabase…';

    function showBudget(visible) {
        app.hidden = !visible;
        nav.hidden = !visible;
        profileButton.hidden = !visible;
        accountPanel.hidden = visible;
    }

    function showStatus(message, { canRetry = false, conflict = false } = {}) {
        accountStatus.textContent = message;
        syncStatus.textContent = message;
        syncStatus.dataset.state = message === 'Presupuesto sincronizado' ? 'ok' : 'pending';
        retryAccount.hidden = !canRetry;
        retry.hidden = !canRetry;
        reload.hidden = !conflict;
        syncPanel.hidden = !message;
        syncPanel.classList.toggle('warning', canRetry || conflict);
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
        } catch {
            if (account !== state) return;
            signOut.disabled = false;
            showStatus('No se pudo cargar tu presupuesto. Verifica la conexión y vuelve a intentar.', { canRetry: true });
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

    function showProfile(user) {
        const email = user.email || 'Sin correo registrado';
        const metadata = user.user_metadata || {};
        const name = [metadata.display_name, metadata.full_name, metadata.name]
            .find(value => typeof value === 'string' && value.trim())?.trim() || '';
        const initials = (name || user.email || 'U').split(/\s+/).slice(0, 2)
            .map(part => [...part][0]).join('').toLocaleUpperCase('es-GT');
        const formatDate = value => value && Number.isFinite(Date.parse(value))
            ? new Intl.DateTimeFormat('es-GT', {
                timeZone: budgetTimeZone, dateStyle: 'medium', timeStyle: 'short',
            }).format(new Date(value))
            : 'Sin registro';
        for (const [id, text] of Object.entries({
            accountAvatar: initials,
            accountName: name || email,
            profileAvatar: initials,
            profileName: name || 'Mi cuenta',
            profileEmail: email,
            profileVerified: user.email_confirmed_at ? 'Verificado' : 'Pendiente de verificar',
            profileCreated: formatDate(user.created_at),
            profileLastSignIn: formatDate(user.last_sign_in_at),
        })) document.getElementById(id).textContent = text;
    }

    async function selectAccount(user) {
        if (user) showProfile(user);
        if (user && user.id === account?.id) return;
        budgetSession++;
        if (account) clearTimeout(account.timer);
        profileStatus.hidden = true;
        account = user ? {
            id: user.id, key: `budget-draft:${config.url}:${user.id}`,
            ready: false, revision: null, pending: null, attempt: null,
        } : null;
        showBudget(false);
        for (const id of ['incomeLogAmount', 'incomeLogDesc', 'logAmount', 'logDesc']) {
            document.getElementById(id).value = '';
        }
        setBudget(emptyBudget());
        useCurrentMonth();
        switchTab('home');
        login.hidden = Boolean(user);
        signOut.hidden = !user;
        signOut.disabled = Boolean(user);
        if (account) await loadAccount(account);
        else showStatus('Inicia sesión para acceder a tu presupuesto.');
    }

    async function verifySession(session, event) {
        if (!session) {
            verification++;
            sessionToVerify = null;
            await selectAccount(null);
            return;
        }
        if (session.user?.id === account?.id && event !== 'USER_UPDATED') return;
        const request = ++verification;
        sessionToVerify = session;
        if (session.user?.id !== account?.id) {
            if (account) await selectAccount(null);
            login.hidden = true;
            showStatus('Verificando tu sesión…');
        }
        try {
            const { data, error } = await client.auth.getUser(session.access_token);
            if (request !== verification) return;
            if (error || !data.user) throw error || new Error('Sesión inválida');
            sessionToVerify = null;
            await selectAccount(data.user);
        } catch (error) {
            if (request !== verification) return;
            if ([400, 401, 403, 422].includes(error?.status)) {
                verification++;
                sessionToVerify = null;
                await selectAccount(null);
                if (request + 1 === verification) showStatus('Tu sesión expiró. Inicia sesión de nuevo.');
            } else {
                showStatus('No se pudo verificar tu sesión. Revisa la conexión e inténtalo de nuevo.', { canRetry: true });
            }
        }
    }

    login.addEventListener('submit', async event => {
        event.preventDefault();
        const button = login.querySelector('button');
        button.disabled = true;
        showStatus('Iniciando sesión…');
        try {
            const { error } = await client.auth.signInWithPassword({
                email: login.elements.email.value.trim(), password: login.elements.password.value,
            });
            if (error) throw error;
            login.reset();
        } catch {
            showStatus('No se pudo iniciar sesión. Verifica tus credenciales y tu conexión.');
        } finally {
            button.disabled = false;
        }
    });

    signOut.addEventListener('click', async () => {
        if (account?.pending || account?.saving) {
            profileStatus.hidden = false;
            profileStatus.textContent = account.conflict
                ? 'Resuelve los cambios pendientes antes de cerrar sesión.'
                : 'Espera a que se sincronicen los cambios y vuelve a pulsar Cerrar sesión.';
            if (!account.conflict) sync(account);
            return;
        }
        signOut.disabled = true;
        try {
            const { error } = await client.auth.signOut({ scope: 'local' });
            if (error) throw error;
            await verifySession(null);
        } catch {
            profileStatus.hidden = false;
            profileStatus.textContent = 'No se pudo cerrar sesión. Intenta de nuevo.';
            signOut.disabled = false;
        }
    });

    retryAccount.addEventListener('click', () => {
        if (sessionToVerify) verifySession(sessionToVerify);
        else if (account) loadAccount(account);
    });
    retry.addEventListener('click', () => {
        if (!account) return;
        if (account.ready) sync(account);
        else loadAccount(account);
    });
    reload.addEventListener('click', () => {
        if (account && confirm('¿Descartar los cambios de esta pestaña y cargar la versión de la nube?')) loadAccount(account, true);
    });
    window.addEventListener('beforeunload', event => {
        if (!account?.pending) return;
        event.preventDefault();
        event.returnValue = '';
    });

    const sdk = document.createElement('script');
    sdk.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/dist/umd/supabase.js';
    sdk.integrity = 'sha384-A97u3Qnt9GZHURO9YJZRe7VQgGUeFzcv6I1oIGnUTxQrCxnpQMwR0/G8F2zt9abZ';
    sdk.crossOrigin = 'anonymous';
    sdk.onload = () => {
        try {
            const url = new URL(config.url);
            if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
                || !config.publishableKey?.startsWith('sb_publishable_')) {
                throw new Error('Configuración inválida');
            }
            client = window.supabase.createClient(config.url, config.publishableKey);
            login.querySelector('button').disabled = false;
            client.auth.onAuthStateChange((event, session) => {
                setTimeout(() => verifySession(session, event), 0);
            });
        } catch {
            showStatus('Revisa la URL HTTPS y la clave publicable en supabase-config.js.');
        }
    };
    sdk.onerror = () => showStatus('No se pudo cargar Supabase. Comprueba tu conexión y recarga la página.');
    document.head.append(sdk);
})();

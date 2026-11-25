'use strict';
const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
const storageKey = 'gestion-riesgos-v1';
const catalogLabels = {
  people: 'Analistas de riesgos',
  researchers: 'Analistas de investigación',
  departments: 'Dependencias solicitantes',
  types: 'Tipos de caso'
};
const typeDetails = {
  matrix: 'Matriz',
  research: 'Investigación',
  followup: 'Seguimiento'
};
const initial = {
  people: ['Luis Menendez', 'Julio Hernández', 'Renato Escobar', 'Roger González', 'Andrés López']
    .map((name, index) => ({ id: String(index + 1), name, active: true })),
  researchers: [
    { id: 'william', name: 'William Espinoza', active: true },
    { id: 'victor', name: 'Victor de León', active: true }
  ],
  departments: [
    { id: 'dit', name: 'Departamento de Infraestructura Tecnológica', active: true },
    { id: 'dgpt', name: 'Departamento de Gestión de Proyectos Tecnológicos', active: true }
  ],
  types: [
    { id: 'matrix', name: 'Matriz de Riesgos', mode: 'matrix', active: true },
    { id: 'research', name: 'Investigación con Matriz de Riesgos', mode: 'research', active: true },
    { id: 'followup', name: 'Seguimiento de Matriz de Riesgos', mode: 'followup', active: true }
  ],
  cases: []
};
let data = initial;
let localData;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved && Array.isArray(saved.cases) && Array.isArray(saved.people)) localData = { ...initial, ...saved };
} catch {
  // A local backup is optional.
}
let client;
let account;
let role;
const canManage = () => role === 'admin';
let revision;
let ready = false;
let busy = false;
let generation = 0;
const shell = document.querySelector('aside');
const sessionBar = document.querySelector('#session');
const views = {
  dashboard: ['Dashboard', 'Consulta la carga de trabajo y los próximos vencimientos.'],
  cases: ['Casos', 'Registra, asigna y actualiza los casos de riesgos.'],
  calendar: ['Calendario', 'Consulta los casos por fecha de plazo.'],
  people: ['Catálogos', 'Administra los tipos de caso, responsables y dependencias solicitantes.']
};
let view = 'dashboard';
let selected = today();
let month = selected.slice(0, 7);
let query = '';
let filter = '';
let noticeTimer;
const dateFormat = new Intl.DateTimeFormat('es-GT', { dateStyle: 'medium', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('es-GT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);
const formatDate = value => value ? dateFormat.format(new Date(value + 'T00:00:00Z')) : 'Sin fecha';
const entryOf = (group, id) => data[group].find(entry => entry.id === id);
const nameOf = id => entryOf('people', id)?.name ?? 'Sin analista';
const typeOf = record => entryOf('types', record.type ?? 'matrix');
const catalogOptions = (group, selected) => data[group]
  .filter(entry => entry.active || entry.id === selected)
  .map(entry => `<option value="${escape(entry.id)}" ${entry.id === selected ? 'selected' : ''}>${escape(entry.name)}${entry.active ? '' : ' (inactivo)'}</option>`).join('');
const normalize = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const sortDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.number ?? '').localeCompare(b.number ?? '');
function today() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts();
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key).value).join('-');
}
function daysLeft(due) {
  return (Date.parse(due) - Date.parse(today())) / 86400000;
}
function status(record) {
  if (record.closed) return ['Cerrado', 'done'];
  if (!record.due) return ['Sin plazo', ''];
  const days = daysLeft(record.due);
  if (days < 0) return ['Vencido', 'late'];
  if (days === 0) return ['Vence hoy', 'soon'];
  if (days <= 7) return ['Próximo', 'soon'];
  return ['Asignado', ''];
}
function notify(message) {
  const notice = document.querySelector('#notice');
  notice.textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.textContent = ''; }, 4200);
}
function showGate(title, message, controls = '') {
  shell.hidden = true;
  sessionBar.hidden = true;
  main.classList.add('gated');
  main.innerHTML = `<section class="card login-card"><div class="eyebrow">Gestión de Riesgos</div>
    <h1>${escape(title)}</h1><p>${escape(message)}</p>${controls}</section>`;
}
function showLogin(message = 'Inicia sesión para acceder a Gestión de Riesgos.') {
  showGate('Iniciar sesión', message, `<form id="login-form">
    <label>Correo electrónico<input type="email" name="email" autocomplete="username" required></label>
    <label>Contraseña<input type="password" name="password" autocomplete="current-password" required></label>
    <button class="action primary">Entrar</button><p class="error" role="alert"></p></form>`);
}
async function loadWorkspace({ quiet = false } = {}) {
  if (!account || busy || dialog.open) return;
  busy = true;
  const request = generation;
  try {
    const membership = await client.from('risk_access').select('role').eq('user_id', account.id).maybeSingle();
    if (request !== generation) return;
    if (membership.error) throw membership.error;
    const nextRole = membership.data?.role;
    if (!nextRole) {
      ready = false;
      role = undefined;
      data = initial;
      showGate('Acceso pendiente', 'Pide al administrador que vincule esta cuenta.',
        '<div class="buttons gate-actions"><button class="action" data-logout>Cerrar sesión</button><button class="action primary" data-reload>Reintentar</button></div>');
      return;
    }
    const admin = nextRole === 'admin';
    const result = admin
      ? await client.from('risk_workspace').select('payload, revision').eq('owner_id', account.id).maybeSingle()
      : await client.rpc('risk_my_cases');
    if (request !== generation) return;
    if (result.error) throw result.error;
    if (!admin && !result.data) {
      ready = false;
      role = undefined;
      data = initial;
      showGate('Acceso pendiente', 'Pide al administrador que revise la vinculación de esta cuenta.',
        '<div class="buttons gate-actions"><button class="action" data-logout>Cerrar sesión</button><button class="action primary" data-reload>Reintentar</button></div>');
      return;
    }
    if (role !== nextRole) {
      view = admin ? 'dashboard' : 'cases';
      filter = '';
      query = '';
    }
    role = nextRole;
    data = (admin ? result.data?.payload : result.data) ?? initial;
    revision = admin ? result.data?.revision ?? null : null;
    ready = true;
    render();
  } catch {
    if (request !== generation) return;
    if (ready) {
      if (!quiet) notify('No se pudo actualizar. Intenta de nuevo.');
    } else {
      showGate('No se pudieron cargar los casos', 'Verifica la conexión y que el esquema esté instalado en Supabase.',
        '<div class="buttons gate-actions"><button class="action" data-logout>Cerrar sesión</button><button class="action primary" data-reload>Reintentar</button></div>');
    }
  } finally {
    if (request === generation) busy = false;
  }
}
function activateSession(session) {
  const user = session?.user;
  if (user?.id === account?.id && ready) return;
  generation++;
  account = user;
  role = undefined;
  ready = false;
  busy = false;
  data = initial;
  revision = null;
  view = 'dashboard';
  query = '';
  filter = '';
  if (dialog.open) dialog.close();
  document.querySelector('#notice').textContent = '';
  if (!account) {
    showLogin();
    return;
  }
  showGate('Cargando casos', 'Conectando con Supabase…');
  void loadWorkspace();
}
function showSaveError(message) {
  const error = dialog.open && dialog.querySelector('.error');
  if (error) error.textContent = message;
  else notify(message);
}
async function save(next, message) {
  if (!ready || !account || !canManage() || busy) {
    showSaveError('Hay una operación en curso. Intenta de nuevo.');
    return;
  }
  busy = true;
  const request = generation;
  const version = revision;
  const owner = account.id;
  let conflict = false;
  try {
    const table = client.from('risk_workspace');
    const write = version === null
      ? table.insert({ owner_id: owner, payload: next })
      : table.update({ payload: next, revision: version + 1 }).eq('owner_id', owner).eq('revision', version);
    const { data: row, error } = await write.select('revision').maybeSingle();
    if (request !== generation) return;
    if (error && error.code !== '23505') throw error;
    if (!row) {
      conflict = true;
      if (dialog.open) dialog.close();
      return;
    }
    revision = row.revision;
    data = next;
    if (dialog.open) dialog.close();
    render();
    notify(message);
  } catch {
    if (request === generation) showSaveError('No se pudo guardar en Supabase. Revisa tu conexión e intenta de nuevo.');
  } finally {
    if (request === generation) {
      busy = false;
      if (conflict) {
        await loadWorkspace();
        notify('Los datos cambiaron en otro dispositivo. Revisa la versión actual antes de volver a editar.');
      }
    }
  }
}
function caseRows(records, empty) {
  if (!records.length) return '<p class="empty">' + escape(empty) + '</p>';
  return records.map(record => {
    const [label, tone] = status(record);
    return `<article class="case row"><button data-edit-case="${escape(record.id)}"><strong>${escape(record.topic)}</strong>
      <small>Caso ${escape(record.number || 'sin número')}${record.matrix ? ' · ' + escape(record.matrix) : ''}${record.office ? ' · Oficio ' + escape(record.office) : ''}</small>
      <small>${escape(nameOf(record.person))} · Plazo ${formatDate(record.due)}</small>
      <small>${escape(typeOf(record)?.name)}${record.department ? ' · ' + escape(entryOf('departments', record.department)?.name) : ''}</small>
      ${record.researcher ? `<small>Investigación · ${escape(entryOf('researchers', record.researcher)?.name)}</small>` : ''}
      ${record.origin ? `<small>Oficio de la matriz enviada · ${escape(record.origin)}</small>` : ''}</button>
      <span class="pill ${tone}">${label}</span></article>`;
  }).join('');
}
function dashboard() {
  const open = data.cases.filter(record => !record.closed);
  const closed = data.cases.filter(record => record.closed);
  const remaining = open.filter(record => record.due);
  const todayDate = today();
  const currentMonth = todayDate.slice(0,7);
  const upcoming = remaining.filter(record => daysLeft(record.due) >= 0 && daysLeft(record.due) <= 7);
  const overdue = remaining.filter(record => record.due < todayDate);
  const measurable = closed.filter(record => record.due && record.closedAt);
  const onTime = measurable.filter(record => record.closedAt <= record.due).length;
  const elapsed = closed.filter(record => record.closedAt && record.assigned && record.closedAt >= record.assigned)
    .map(record => (Date.parse(record.closedAt) - Date.parse(record.assigned)) / 86400000);
  const counts = [
    ['Total de casos', data.cases.length], ['Abiertos', open.length], ['Cerrados', closed.length],
    ['Vencen en 7 días', upcoming.length], ['Vencidos', overdue.length], ['Abiertos sin plazo', open.length - remaining.length],
    ['Cerrados este mes', closed.filter(record => record.closedAt?.startsWith(currentMonth)).length],
    ['Cerrados a tiempo', measurable.length ? onTime + ' / ' + measurable.length : '—'],
    ['Promedio de cierre (días calendario)', elapsed.length ? new Intl.NumberFormat('es-GT', {maximumFractionDigits:1}).format(elapsed.reduce((a,b) => a+b,0) / elapsed.length) : '—']
  ];
  const breakdown = (title, column, labelOf) => {
    const groups = new Map();
    for (const record of data.cases) {
      const label = labelOf(record);
      const values = groups.get(label) ?? [0,0,0];
      values[record.closed ? 1 : 0]++;
      if (!record.closed && record.due && record.due < todayDate) values[2]++;
      groups.set(label, values);
    }
    return `<section class="card dashboard-table"><h2>${title}</h2>${groups.size ? `<div class="table-scroll"><table>
      <thead><tr><th>${column}</th><th>Abiertos</th><th>Cerrados</th><th>Vencidos</th></tr></thead><tbody>
      ${[...groups].sort(([a],[b]) => a.localeCompare(b,'es')).map(([label, values]) =>
        `<tr><th scope="row">${escape(label)}</th>${values.map(value => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` :
      '<p class="empty">Sin casos registrados.</p>'}</section>`;
  };
  return `<div class="stats">${counts.map(([label, count]) => `<div class="card stat"><span>${label}</span><strong>${count}</strong></div>`).join('')}</div>
    <div class="dashboard-grid">
    ${breakdown('Carga por analista', 'Analista', record => nameOf(record.person))}
    ${breakdown('Casos por tipo', 'Tipo', record => typeOf(record)?.name ?? 'Sin tipo')}
    ${breakdown('Casos por dependencia', 'Dependencia', record => entryOf('departments', record.department)?.name ?? 'Sin dependencia registrada')}
    </div>
    <section class="card"><h2 class="section-title">Plazos pendientes</h2>${caseRows(remaining.sort(sortDue).slice(0, 8), 'Aquí aparecerán los plazos de los casos abiertos.')}</section>`;
}
function filteredCases() {
  const matches = data.cases.filter(record => (!filter || record.person === filter) &&
    normalize([record.topic, record.number, record.matrix, record.office, record.responseOffice, nameOf(record.person), typeOf(record)?.name, entryOf('departments', record.department)?.name].join(' ')).includes(normalize(query.trim())));
  main.querySelector('#case-results').innerHTML = caseRows(matches.sort(sortDue), 'No hay casos que coincidan.');
}
function cases() {
  return `<section class="card"><div class="toolbar"><input id="search" type="search" aria-label="Buscar casos" placeholder="Buscar por caso, oficio o tema" value="${escape(query)}">
    <select id="filter" aria-label="Filtrar por analista"><option value="">Todos los analistas</option>${data.people.map(person =>
    `<option value="${escape(person.id)}" ${filter === person.id ? 'selected' : ''}>${escape(person.name)}</option>`).join('')}</select></div><div id="case-results"></div></section>`;
}
function calendar() {
  const first = new Date(month + '-01T00:00:00Z');
  const leading = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const monthCases = data.cases.filter(record => record.due?.slice(0, 7) === month);
  const entries = record => {
    const mode = typeOf(record)?.mode ?? 'matrix';
    return `<button class="event event-${mode}" data-edit-case="${escape(record.id)}">
      <strong>${record.office ? 'Oficio ' + escape(record.office) : escape(record.matrix || record.number || 'Sin oficio de ingreso')}</strong><span>${escape(nameOf(record.person))}</span>
      <small>${escape(typeOf(record)?.name)}</small></button>`;
  };
  const cells = Array.from({ length: count }, (_, index) => {
    const day = month + '-' + String(index + 1).padStart(2, '0');
    const records = monthCases.filter(record => record.due === day).sort(sortDue);
    return `<div class="calendar-cell"><button class="day ${day === today() ? 'today' : ''}" data-day="${day}" aria-pressed="${day === selected}"
      aria-label="${formatDate(day)}, ${records.length} casos">${index + 1}
      <span class="day-count">${records.length || ''}</span></button><div class="events">${records.map(entries).join('')}</div></div>`;
  }).join('');
  return `<section class="card"><div class="row"><h2>${monthFormat.format(first)}</h2><div class="calendar-actions">
    <button class="action" data-month="-1" aria-label="Mes anterior">‹</button><button class="action" data-today>Hoy</button>
    <button class="action" data-month="1" aria-label="Mes siguiente">›</button></div></div>
    <div class="legend">${Object.entries(typeDetails).map(([mode, label]) =>
    `<span class="event-${mode}">${label}</span>`).join('')}</div>
    <div class="calendar">${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(day => `<span class="weekday">${day}</span>`).join('')}
    ${'<span></span>'.repeat(leading)}${cells}</div><h2 class="section-title">${formatDate(selected)}</h2>
    ${caseRows(monthCases.filter(record => record.due === selected), 'Sin plazos para este día.')}
    <div class="mobile-agenda"><h2>Plazos del mes</h2>${monthCases.length ?
      [...new Set(monthCases.map(record => record.due))].sort().map(day =>
        `<section><h3>${formatDate(day)}</h3>${monthCases.filter(record => record.due === day).sort(sortDue).map(entries).join('')}</section>`).join('') :
      '<p class="empty">Sin plazos para este mes.</p>'}</div></section>`;
}
function people() {
  return `<div class="catalog-grid">${Object.entries(catalogLabels).map(([group, label]) =>
    `<section class="card"><div class="row section-title"><h2>${label}</h2>
      <button class="action" data-catalog="${group}" data-entry="">Añadir</button></div>
      ${data[group].map(entry => `<article class="person row"><div><strong>${escape(entry.name)}</strong>
        <small>${entry.active ? 'Activo' : 'Inactivo'}${entry.mode ? ' · ' + typeDetails[entry.mode] : ''}</small></div>
        <button class="action" data-catalog="${group}" data-entry="${escape(entry.id)}" aria-label="Editar ${escape(entry.name)}">Editar</button></article>`).join('')}</section>`).join('')}</div>`;
}
function render() {
  if (!ready) return;
  shell.hidden = false;
  sessionBar.hidden = false;
  main.classList.remove('gated');
  sessionBar.querySelector('span').textContent = account.email ?? '';
  shell.classList.toggle('analyst-nav', !canManage());
  const importButton = canManage() && localData && revision === null
    ? '<div class="card import-card"><p>Hay datos de una versión anterior en este dispositivo.</p><button class="action" data-import>Importar a esta cuenta</button></div>'
    : '';
  document.querySelectorAll('nav button').forEach(button => {
    button.hidden = !canManage() && !['cases', 'calendar'].includes(button.dataset.view);
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const [title, description] = !canManage() && view === 'cases'
    ? ['Mis casos', 'Consulta tus asignaciones y fechas de plazo.'] : views[view];
  const action = !canManage() || view === 'people' ? '' :
    '<button class="action primary" data-edit-case="">+ Nuevo caso</button>' + (view === 'cases' ? ' <button class="action" data-csv>Importar Excel</button>' : '');
  main.innerHTML = `<header><div><div class="eyebrow">Gestión de Riesgos</div><h1>${title}</h1><p>${description}</p></div>${action}</header>
    ${importButton}
    ${({ dashboard, cases, calendar, people })[view]()}`;
  if (view === 'cases') filteredCases();
}
function showCase(id) {
  const record = data.cases.find(item => item.id === id);
  if (!record) return;
  const fields = [
    ['Oficio de ingreso', record.office], ['Número de caso', record.number], ['Número de matriz', record.matrix],
    ['Tipo de caso', typeOf(record)?.name], ['Dependencia solicitante', entryOf('departments', record.department)?.name],
    ['Analista de riesgos', nameOf(record.person)],
    ['Responsable de investigación', entryOf('researchers', record.researcher)?.name],
    ['Oficio de la matriz enviada', record.origin],
    ['Fecha de asignación', formatDate(record.assigned)], ['Fecha de plazo', formatDate(record.due)],
    ['Estado', status(record)[0]], ['Fecha de cierre', record.closedAt ? formatDate(record.closedAt) : ''],
    ['Oficio de respuesta', record.responseOffice], ['Observaciones', record.notes]
  ];
  dialog.innerHTML = `<div class="row"><h2 id="dialog-title">${escape(record.topic)}</h2>
    <button type="button" class="action" data-cancel aria-label="Cerrar">×</button></div>
    <dl class="case-detail">${fields.filter(([, value]) => value).map(([label, value]) =>
      `<dt>${label}</dt><dd>${escape(value)}</dd>`).join('')}</dl>`;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  if (!dialog.open) dialog.showModal();
}
function openForm(title, fields, submit, deleteAttrs = '') {
  dialog.innerHTML = `<div class="row"><h2 id="dialog-title">${title}</h2><button type="button" class="action" data-cancel aria-label="Cerrar">×</button></div>
    <form>${fields}<div class="error" role="alert"></div><div class="buttons">${deleteAttrs}
    <button type="button" class="action" data-cancel>Cancelar</button><button class="action primary">Guardar</button></div></form>`;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  dialog.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    submit(event.currentTarget, Object.fromEntries(new FormData(event.currentTarget)));
  });
  if (!dialog.open) dialog.showModal();
}
function caseEditor(id) {
  const existing = data.cases.find(record => record.id === id);
  const record = existing ?? { assigned: today() };
  const currentType = existing ? record.type ?? 'matrix' : '';
  const options = data.people.filter(person => person.active || person.id === record.person);
  if (!options.length) {
    notify('Activa o añade un analista antes de asignar un caso.');
    return;
  }
  const field = (key, label, limit, required = true) => `<label>${label}<input name="${key}" value="${escape(record[key])}" maxlength="${limit}" ${required ? 'required' : ''}></label>`;
  openForm(existing ? 'Editar caso' : 'Nuevo caso', `
    <div class="fields">${field('office', 'Oficio de ingreso', 100, !record.historical)}${field('number', 'Número de caso', 100, !record.historical)}</div>
    ${field('matrix', 'Número de matriz', 100, false)}
    ${field('topic', 'Tema', 300)}
    <label>Tipo de caso<select name="type" required><option value="">Seleccionar tipo</option>${catalogOptions('types', currentType)}</select></label>
    <label>Dependencia solicitante<select name="department" ${record.historical ? '' : 'required'}><option value="">Seleccionar dependencia</option>${catalogOptions('departments', record.department)}</select></label>
    <label id="research-field" hidden>Responsable de investigación<select name="researcher"><option value="">Seleccionar responsable</option>${catalogOptions('researchers', record.researcher)}</select></label>
    <label id="followup-field" hidden>Oficio de la matriz enviada
      <input name="origin" list="matrix-offices" maxlength="100" value="${escape(record.origin)}" placeholder="Seleccionar o escribir el oficio">
      <datalist id="matrix-offices">${[...new Set(data.cases.filter(item => item.id !== id && typeOf(item)?.mode !== 'followup').map(item => item.office))]
      .map(office => `<option value="${escape(office)}"></option>`).join('')}</datalist></label>
    <label>Analista<select name="person" required><option value="">Seleccionar analista</option>${options.map(person =>
    `<option value="${escape(person.id)}" ${record.person === person.id ? 'selected' : ''}>${escape(person.name)}${person.active ? '' : ' (inactivo)'}</option>`).join('')}</select></label>
    <div class="fields"><label>Fecha de asignación<input name="assigned" type="date" required value="${escape(record.assigned)}"></label>
    <label>Fecha de plazo<input name="due" type="date" ${record.historical ? '' : 'required'} value="${escape(record.due)}"></label></div>
    <label>Estado<select name="state"><option value="open">En seguimiento</option><option value="closed" ${record.closed ? 'selected' : ''}>Cerrado</option></select></label>
    <div id="close-fields" class="fields" hidden>
      <label>Fecha de cierre<input name="closedAt" type="date" value="${escape(record.closedAt)}"></label>
      ${field('responseOffice', 'Oficio de respuesta', 100, false)}
    </div>
    <label>Observaciones<textarea name="notes" rows="2">${escape(record.notes)}</textarea></label>`,
    (form, values) => {
      const { person, assigned, due, state, type, department } = values;
      const mode = entryOf('types', type)?.mode;
      const researcher = mode === 'research' ? values.researcher : '';
      const origin = mode === 'followup' ? values.origin?.trim() : '';
      const [office, number, topic] = ['office','number','topic'].map(key => values[key].trim());
      const error = form.querySelector('.error');
      const matrix = values.matrix.trim();
      const closed = state === 'closed';
      const closedAt = closed ? values.closedAt : '';
      const responseOffice = closed ? values.responseOffice.trim() : '';
      const unchangedClose = existing?.closed && (existing.closedAt ?? '') === closedAt && (existing.responseOffice ?? '') === responseOffice;
      if (closed && !unchangedClose && (!closedAt || !actualOffice(responseOffice) || !/\d/.test(responseOffice))) {
        error.textContent = 'Para cerrar el caso, ingresa la fecha de cierre y el número de oficio de respuesta.'; return;
      }
      if (closedAt && (closedAt < assigned || (!unchangedClose && closedAt > today()))) {
        error.textContent = 'La fecha de cierre debe estar entre la asignación y hoy.'; return;
      }
      if ((!record.historical && (!office || !number)) || !topic) { error.textContent = 'Completa el oficio, el número de caso y el tema.'; return; }
      if (!mode || ((department || !record.historical) && !entryOf('departments', department))) { error.textContent = 'Selecciona el tipo de caso y la dependencia solicitante.'; return; }
      if (mode === 'research' && !entryOf('researchers', researcher)) { error.textContent = 'Selecciona el responsable de investigación.'; return; }
      if (mode === 'followup' && !origin) { error.textContent = 'Indica el oficio de la matriz enviada.'; return; }
      if (due && due < assigned) { error.textContent = 'El plazo debe ser igual o posterior a la asignación.'; return; }
      if (matrix && data.cases.some(item => item.id !== id && normalize(item.matrix ?? '') === normalize(matrix))) {
        error.textContent = 'Ya existe un registro con ese número de matriz.'; return;
      }
      if (!record.historical && number && data.cases.some(item => item.id !== id && normalize(item.number ?? '') === normalize(number) &&
        (mode === 'followup' ? normalize(item.office) === normalize(office) : typeOf(item)?.mode !== 'followup' || normalize(item.office) === normalize(office)))) {
        error.textContent = 'Ya existe un registro con el mismo número de caso para esta asignación.'; return;
      }
      const item = { ...record, id: id || crypto.randomUUID(), office, number, matrix, topic, person, assigned, due,
        type, department, researcher, origin, closed, closedAt, responseOffice, notes: values.notes.trim() };
      save({ ...data, cases: existing ? data.cases.map(entry => entry.id === id ? item : entry) : [...data.cases, item] }, 'Caso guardado.');
    }, existing ? `<button type="button" class="action danger" data-delete-case="${escape(id)}">Eliminar</button>` : '');
  const typeSelect = dialog.querySelector('[name="type"]');
  const updateFields = () => {
    const mode = entryOf('types', typeSelect.value)?.mode;
    for (const [selector, name, condition] of [
      ['#research-field', 'researcher', mode === 'research'],
      ['#followup-field', 'origin', mode === 'followup']
    ]) {
      const field = dialog.querySelector(selector);
      const control = field.querySelector(`[name="${name}"]`);
      field.hidden = !condition;
      control.disabled = !condition;
      control.required = condition;
    }
  };
  const stateSelect = dialog.querySelector('[name="state"]');
  const closeFields = dialog.querySelector('#close-fields');
  const dateInput = closeFields.querySelector('[name="closedAt"]');
  const responseInput = closeFields.querySelector('[name="responseOffice"]');
  const updateClose = () => {
    const closing = stateSelect.value === 'closed';
    closeFields.hidden = !closing;
    for (const input of [dateInput, responseInput]) input.disabled = !closing;
    if (closing && !dateInput.value && !existing?.closed) dateInput.value = today();
  };
  stateSelect.addEventListener('change', updateClose);
  updateClose();
  typeSelect.addEventListener('change', updateFields);
  updateFields();
}
function csvRows(text) {
  const source = text.replace(/^\uFEFF/, '');
  const header = source.split(/\r?\n/, 1)[0];
  const delimiter = [';', ',', '\t'].sort((a,b) => header.split(b).length - header.split(a).length)[0];
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { value += '"'; i++; }
      else if (quoted || !value) quoted = !quoted;
      else value += c;
    } else if (!quoted && (c === delimiter || c === '\n' || c === '\r')) {
      row.push(value.trim());
      value = '';
      if (c !== delimiter) {
        if (c === '\r' && source[i + 1] === '\n') i++;
        rows.push(row);
        row = [];
      }
    } else value += c;
  }
  if (quoted) throw new Error('El CSV contiene comillas sin cerrar.');
  if (value || row.length) rows.push([...row, value.trim()]);
  return rows;
}
function importDate(value) {
  if (!value) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!iso && !local) return null;
  const date = iso ? value : [local[3], local[2].padStart(2,'0'), local[1].padStart(2,'0')].join('-');
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0,10) === date ? date : null;
}
const missingValue = value => /^(?:n\/?a|no aplica|-)$/i.test(value) ? '' : value;
const actualOffice = value => Boolean(value && missingValue(value.trim()) && normalize(value.trim()) !== 'correo');
function prepareImport(text) {
  const [header, ...rows] = csvRows(text);
  const key = value => normalize(value).replace(/[^a-z0-9]/g,'');
  const keys = (header ?? []).map(key);
  const columns = {
    assigned:['fecha ingreso'], number:['# de caso','número de caso'], matrix:['no. matriz','número de matriz'],
    topic:['nombre de la matriz de riesgo','tema'], closedAt:['respuesta','fecha de respuesta','fecha de cierre'],
    responseOffice:['oficio de respuesta'], analyst:['designado principal','analista'], state:['estado'],
    office:['oficio de ingreso'], due:['fecha de plazo','plazo'], department:['dependencia solicitante'], notes:['observaciones']
  };
  const positions = Object.fromEntries(Object.entries(columns).map(([name, labels]) => [name, keys.findIndex(value => labels.map(key).includes(value))]));
  if (positions.responseOffice < 0) {
    const adjacent = positions.closedAt + 1;
    if (positions.closedAt >= 0 && keys[adjacent] === 'oficio') positions.responseOffice = adjacent;
  }
  const required = ['assigned','number','matrix','topic','closedAt','responseOffice','analyst','state'];
  const absent = required.filter(name => positions[name] < 0);
  if (absent.length) throw new Error('Faltan columnas: ' + absent.map(name => columns[name][0]).join(', ') + '.');
  const seen = new Set(data.cases.map(record => normalize(record.matrix ?? '')).filter(Boolean));
  const accepted = [], issues = [];
  let duplicates = 0, historicalWithoutOffice = 0;
  rows.forEach((row, index) => {
    const get = name => row[positions[name]]?.trim() ?? '';
    const matrix = get('matrix');
    const topic = get('topic');
    const analyst = get('analyst');
    if (!matrix && !topic && !analyst) return;
    const assigned = importDate(get('assigned'));
    const closedAt = importDate(get('closedAt'));
    const due = importDate(get('due'));
    const person = data.people.find(item => normalize(item.name) === normalize(analyst));
    const dependency = missingValue(get('department'));
    const department = data.departments.find(item => normalize(item.name) === normalize(dependency));
    const state = normalize(get('state'));
    const closed = ['entregado','cerrado','finalizado'].includes(state) || (!state && Boolean(closedAt));
    const error = !matrix || !topic || !assigned ? 'Completa el número de matriz, el tema y la fecha de ingreso.'
      : !person ? 'El analista «' + (analyst || 'sin nombre') + '» no coincide con Catálogos.'
      : dependency && !department ? 'La dependencia «' + dependency + '» no coincide con Catálogos.'
      : due === null || closedAt === null || (due && due < assigned) || (closedAt && closedAt < assigned) ? 'Revisa las fechas.'
      : state && !['entregado','cerrado','finalizado','en proceso','en seguimiento','abierto','pendiente'].includes(state) ? 'Estado desconocido.'
      : closed && !closedAt ? 'Completa la fecha de respuesta del caso entregado.'
      : !closed && (closedAt || actualOffice(get('responseOffice'))) ? 'El caso está abierto y contiene datos de respuesta.'
      : '';
    if (seen.has(normalize(matrix))) { duplicates++; return; }
    if (error) { issues.push('Fila ' + (index + 2) + (matrix ? ' (' + matrix + ')' : '') + ' · ' + error); return; }
    seen.add(normalize(matrix));
    const responseOffice = closed ? get('responseOffice') : '';
    if (closed && !actualOffice(responseOffice)) historicalWithoutOffice++;
    accepted.push({ id: crypto.randomUUID(), matrix, number: missingValue(get('number')), topic, person: person.id,
      assigned, due, department: department?.id ?? '', office: missingValue(get('office')), type:'matrix',
      closed, closedAt: closed ? closedAt : '', responseOffice, notes: get('notes'), historical: true });
  });
  return { accepted, issues, duplicates, historicalWithoutOffice };
}
function openCsvImport() {
  openForm('Importar Excel', `
    <p>Guarda tu hoja como CSV UTF-8 en Excel. Revisa el resultado antes de importar.</p>
    <label>Archivo CSV<input name="csv" type="file" accept=".csv,text/csv" required></label>
    <div id="csv-preview" aria-live="polite"></div>`, (form) => {
      if (!preview?.accepted.length) return;
      void save({ ...data, cases: [...data.cases, ...preview.accepted] }, `${preview.accepted.length} casos importados.`);
    });
  const form = dialog.querySelector('form');
  const input = form.elements.csv;
  const result = form.querySelector('#csv-preview');
  const submit = form.querySelector('.primary');
  submit.textContent = 'Importar casos válidos';
  submit.disabled = true;
  let preview;
  input.addEventListener('change', async () => {
    const file = input.files[0];
    preview = undefined;
    submit.disabled = true;
    result.textContent = '';
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('El CSV supera 5 MB. Divide el archivo en varios bloques.');
      const text = await file.text();
      if (input.files[0] !== file) return;
      preview = prepareImport(text);
      const { accepted, duplicates, issues, historicalWithoutOffice } = preview;
      result.innerHTML = `<p>${accepted.length} listos · ${duplicates} matrices repetidas · ${issues.length} filas para corregir</p>
        ${historicalWithoutOffice ? `<p>${historicalWithoutOffice} cierres históricos carecen de número de oficio.</p>` : ''}
        ${issues.length ? `<ul class="import-errors">${issues.map(issue => `<li>${escape(issue)}</li>`).join('')}</ul>` : ''}`;
      submit.disabled = !accepted.length;
    } catch (error) {
      result.textContent = error.message;
    }
  });
}

function catalogEditor(group, id) {
  const entry = entryOf(group, id);
  const modeField = group === 'types' ? `<label>Comportamiento<select name="mode" ${entry ? 'disabled' : ''}>
    ${Object.entries(typeDetails).map(([mode, label]) =>
      `<option value="${mode}" ${entry?.mode === mode ? 'selected' : ''}>${label}</option>`).join('')}</select></label>` : '';
  openForm(entry ? 'Editar opción' : 'Añadir opción', `
    <label>Nombre<input name="name" required maxlength="150" value="${escape(entry?.name)}"></label>
    ${modeField}
    <label>Disponibilidad<select name="active"><option value="yes">Activo</option><option value="no" ${entry?.active === false ? 'selected' : ''}>Inactivo</option></select></label>`,
    (form, values) => {
      const name = values.name.trim();
      if (!name || data[group].some(item => item.id !== id && normalize(item.name) === normalize(name))) {
        form.querySelector('.error').textContent = 'Ingresa un nombre válido que no esté en este catálogo.';
        return;
      }
      const item = { id: id || crypto.randomUUID(), name, active: values.active === 'yes' };
      if (group === 'types') item.mode = entry?.mode ?? values.mode;
      save({ ...data, [group]: entry ? data[group].map(option => option.id === id ? item : option) : [...data[group], item] }, 'Opción guardada.');
    });
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const { dataset } = button;
  if ('reload' in dataset) void loadWorkspace();
  if ('logout' in dataset) {
    client.auth.signOut({ scope: 'local' }).then(({error}) => {
      if (error) notify('No se pudo cerrar la sesión. Intenta de nuevo.');
      else if (account) activateSession(null);
    });
  }
  if ('import' in dataset && ready && canManage() && localData && revision === null &&
      confirm('¿Importar los casos y catálogos de este dispositivo a tu cuenta actual?')) {
    void save(localData, 'Datos importados a Supabase.');
  }
  if (!ready) return;
  if ('view' in dataset && (canManage() || ['cases','calendar'].includes(dataset.view))) { view = dataset.view; render(); window.scrollTo(0, 0); }
  if ('editCase' in dataset) (canManage() ? caseEditor : showCase)(dataset.editCase);
  if (canManage() && 'csv' in dataset) openCsvImport();
  if (canManage() && 'catalog' in dataset) catalogEditor(dataset.catalog, dataset.entry);
  if ('cancel' in dataset) dialog.close();
  if (canManage() && 'deleteCase' in dataset && confirm('¿Eliminar este caso permanentemente?')) {
    save({ ...data, cases: data.cases.filter(record => record.id !== dataset.deleteCase) }, 'Caso eliminado.');
  }
  if ('day' in dataset) {
    selected = dataset.day;
    render();
    main.querySelector('[aria-pressed="true"]').focus();
  }
  if ('today' in dataset) { selected = today(); month = selected.slice(0, 7); render(); }
  if ('month' in dataset) {
    const cursor = new Date(month + '-01T00:00:00Z');
    cursor.setUTCMonth(cursor.getUTCMonth() + Number(dataset.month));
    selected = cursor.toISOString().slice(0, 10);
    month = selected.slice(0, 7);
    render();
  }
});
main.addEventListener('input', event => {
  if (event.target.id === 'search') { query = event.target.value; filteredCases(); }
});
main.addEventListener('change', event => {
  if (event.target.id === 'filter') { filter = event.target.value; filteredCases(); }
});
document.addEventListener('submit', async event => {
  if (event.target.id !== 'login-form') return;
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button');
  const errorText = form.querySelector('.error');
  const { email, password } = Object.fromEntries(new FormData(form));
  button.disabled = true;
  errorText.textContent = '';
  try {
    const { data: auth, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      errorText.textContent = error.status >= 500 || !error.status
        ? 'No se pudo conectar. Intenta de nuevo.'
        : 'No se pudo iniciar sesión. Revisa tu correo y contraseña.';
    } else if (auth.session?.user?.id !== account?.id) {
      activateSession(auth.session);
    }
  } catch {
    errorText.textContent = 'No se pudo conectar. Intenta de nuevo.';
  } finally {
    button.disabled = false;
  }
});
document.addEventListener('visibilitychange', () => {
  if (ready && !document.hidden) void loadWorkspace({ quiet: true });
});
async function start() {
  showGate('Gestión de Riesgos', 'Preparando el inicio de sesión…');
  try {
    const { projectUrl, publishableKey } = await import('./supabase-config.js?v=5');
    if (!projectUrl || !publishableKey) {
      showGate('Configurar Supabase', 'Completa supabase-config.js y ejecuta supabase.sql para habilitar el inicio de sesión.');
      return;
    }
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm');
    client = createClient(projectUrl, publishableKey);
    client.auth.onAuthStateChange((event, session) => {
      if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(event)) {
        setTimeout(() => {
          if (!session || session.user.id !== account?.id) activateSession(session);
        }, 0);
      }
    });
  } catch {
    showGate('Conexión no disponible', 'Revisa la configuración de Supabase y vuelve a cargar la página.');
  }
}
void start();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

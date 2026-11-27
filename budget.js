const formatMoney = amount => amount.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function localDate() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const monthSelector = document.getElementById('monthSelector');
let currentMonth = localDate().slice(0, 7);
monthSelector.value = currentMonth;

const defaultSchema = [
    { id: 'cat_debt', title: 'Deudas / Ahorros', color: 'blue', items: [ { id: 'cc_balance', label: 'Saldo Tarjeta de Crédito' }, { id: 'installments', label: 'Cuotas' } ]},
    { id: 'cat_fixed', title: 'Gastos Fijos', color: 'green', items: [ { id: 'university', label: 'Mensualidad Universidad' }, { id: 'house', label: 'Servicios de Casa' }]},
    { id: 'cat_trans', title: 'Transporte', color: 'yellow', items: [ { id: 'gasoline', label: 'Gasolina' }, { id: 'parking', label: 'Parqueo' }]},
    { id: 'cat_life', title: 'Estilo de Vida', color: 'red', items: [ { id: 'work_food', label: 'Comida del Trabajo' }]}
];

let schema;
let allValues;
let allActuals;
let allIncomes;
let budgetSession = 0;

function emptyBudget() {
    return { schema: structuredClone(defaultSchema), values: {}, actuals: {}, incomes: {} };
}

function setBudget(data) {
    ({ schema, values: allValues, actuals: allActuals, incomes: allIncomes } = data);
    changeMonth();
}

function currentBudget() {
    return { schema, values: allValues, actuals: allActuals, incomes: allIncomes };
}

function loadLocalBudget() {
    const stored = Object.fromEntries(budgetFields.map(key => [key, localStorage.getItem(`budget_${key}`)]));
    return parseBudget(stored, defaultSchema);
}

function monthDate() {
    const today = localDate();
    return today.startsWith(currentMonth) ? today : `${currentMonth}-01`;
}

// ----------- NAVEGACIÓN -----------
function switchTab(tabName, el) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(v => {
        v.classList.remove('active');
        v.removeAttribute('aria-current');
    });
    document.getElementById(`view-${tabName}`).classList.add('active');
    el.classList.add('active');
    el.setAttribute('aria-current', 'page');

    if(tabName === 'plan') renderPlanTab();
    if(tabName === 'income') {
        document.getElementById('incomeLogDate').value = monthDate();
        renderIncomeHistory();
    }
    if(tabName === 'log') {
        document.getElementById('logDate').value = monthDate();
        renderLogTab();
    }
    if(tabName === 'compare') renderCompareTab();

    updateGlobalHeader();
}

function changeMonth() {
    if (!monthPattern.test(monthSelector.value)) monthSelector.value = currentMonth;
    currentMonth = monthSelector.value;
    document.getElementById('incomeLogDate').value = monthDate();
    document.getElementById('logDate').value = monthDate();
    renderPlanTab();
    renderIncomeHistory();
    renderLogTab();
    renderCompareTab();
    updateGlobalHeader();
}

// ----------- DATOS -----------
function getBudgetVal(id) {
    if (!allValues[currentMonth]) allValues[currentMonth] = {};
    return allValues[currentMonth][id] || 0;
}

function getActualsForMonth() {
    return allActuals[currentMonth] ?? [];
}

function getIncomesForMonth() {
    return allIncomes[currentMonth] ?? [];
}

function saveAll() {
    const data = currentBudget();
    if (window.saveBudgetToCloud) {
        window.saveBudgetToCloud(structuredClone(data));
    } else {
        for (const key of budgetFields) localStorage.setItem(`budget_${key}`, JSON.stringify(data[key]));
    }
    updateGlobalHeader();
}

function openExpense() {
    switchTab('log', document.getElementById('nav-log'));
    document.getElementById('logAmount').focus();
}

// ----------- PESTAÑA: PLANIFICAR -----------
function renderPlanTab() {
    const container = document.getElementById('appContainer');
    let html = '';
    schema.forEach(cat => {
        html += `
        <div class="section ${budgetColor(cat.color)}-section">
            <div class="section-header">
                <div style="display: flex; align-items: center;"><span class="dot bg-${budgetColor(cat.color)}"></span> ${escapeHtml(cat.title)}</div>
                <div style="display:flex; align-items:center; gap:5px;">
                    <div id="total-${cat.id}" class="total-amount" style="margin-right: 10px;">Q 0</div>
                    <button class="icon-btn" style="font-size: 1rem;" onclick="editCategory('${cat.id}')">✏️</button>
                    <button class="icon-btn" onclick="deleteCategory('${cat.id}')">×</button>
                </div>
            </div>
            <div class="grid">`;

        cat.items.forEach(item => {
            const val = getBudgetVal(item.id);
            const sliderMax = Math.max(3000, Math.ceil(val / 1000) * 1000);
            html += `
                <div>
                    <div class="item-label-row">
                        <div class="item-label">${escapeHtml(item.label)}</div>
                        <div style="display:flex; gap: 5px;">
                            <button class="icon-btn" style="width: 24px; height: 24px; font-size: 0.85rem;" onclick="editItem('${cat.id}', '${item.id}')">✏️</button>
                            <button class="icon-btn" style="width: 24px; height: 24px;" onclick="deleteItem('${cat.id}', '${item.id}')">×</button>
                        </div>
                    </div>
                    <div class="slider-row">
                        <input type="range" class="slider" data-id="${item.id}" min="0" max="${sliderMax}" value="${val}">
                        <div class="input-prefix" style="width: 110px; flex-shrink: 0;">
                            <span>Q</span><input type="number" class="num-input" data-id="${item.id}" value="${val}">
                        </div>
                    </div>
                </div>`;
        });
        html += `</div>
                <div style="text-align:center; margin-top:20px;">
                    <button class="icon-btn" style="width:auto; height:auto; border:1px solid #444; border-radius:8px; padding:8px 16px; font-size:0.95rem; margin:0 auto;" onclick="addItem('${cat.id}')">+ Agregar Ítem</button>
                </div>
        </div>`;
    });
    container.innerHTML = html;

    document.getElementById('incomeInput').value = getBudgetVal('income');

    document.getElementById('incomeInput').oninput = e => {
        allValues[currentMonth]['income'] = parseFloat(e.target.value) || 0;
        saveAll();
    };

    document.querySelectorAll('.slider-row').forEach(group => {
        const slider = group.querySelector('.slider');
        const num = group.querySelector('.num-input');
        const id = num.getAttribute('data-id');
        const update = (val) => {
            allValues[currentMonth][id] = parseFloat(val) || 0;
            saveAll();
            updateCategoryTotals();
        };
        slider.addEventListener('input', (e) => { num.value = e.target.value; update(e.target.value); });
        num.addEventListener('input', (e) => {
            slider.value = e.target.value || 0;
            if (parseFloat(e.target.value) > parseFloat(slider.max)) slider.max = Math.ceil(e.target.value / 1000) * 1000;
            update(e.target.value);
        });
    });
    updateCategoryTotals();
}

function updateCategoryTotals() {
    schema.forEach(cat => {
        let catSum = 0;
        cat.items.forEach(item => { catSum += getBudgetVal(item.id); });
        const el = document.getElementById(`total-${cat.id}`);
        if(el) el.innerText = `Q ${formatMoney(catSum)}`;
    });
}

// ----------- PESTAÑA: INGRESOS -----------
function saveActualIncome() {
    const amount = parseFloat(document.getElementById('incomeLogAmount').value);
    const desc = document.getElementById('incomeLogDesc').value;
    const date = document.getElementById('incomeLogDate').value;

    if (!Number.isFinite(amount) || amount <= 0 || !date) return alert("Ingresa un monto mayor que cero y una fecha.");

    const newInc = { id: `inc_${crypto.randomUUID()}`, amount, desc: desc || 'Ingreso', date };
    recordMovement(allIncomes, newInc);

    document.getElementById('incomeLogAmount').value = '';
    document.getElementById('incomeLogDesc').value = '';
    renderIncomeHistory();
}

function renderIncomeHistory() {
    const container = document.getElementById('incomeHistoryContainer');
    const incomes = getIncomesForMonth();
    if(incomes.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding: 20px;">No hay ingresos registrados este mes.</div>';
        return;
    }
    let html = '';
    incomes.forEach(inc => {
        html += `
        <div class="log-item-card" style="border-left-color: var(--green)">
            <div class="log-info">
                <div class="log-desc">${escapeHtml(inc.desc)}</div>
                <div class="log-meta">${escapeHtml(inc.date)}</div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
                <div class="log-amount" style="color: var(--green)">+ Q ${formatMoney(inc.amount)}</div>
                <button class="icon-btn" onclick="deleteIncome('${inc.id}')">×</button>
            </div>
        </div>`;
    });
    container.innerHTML = html;
}

function deleteIncome(id) {
    allIncomes[currentMonth] = getIncomesForMonth().filter(i => i.id !== id);
    saveAll();
    renderIncomeHistory();
}

// ----------- PESTAÑA: GASTOS -----------
function renderLogTab() {
    const catSelect = document.getElementById('logCat');
    catSelect.innerHTML = '<option value="">-- Seleccionar Categoría --</option>';
    schema.forEach(cat => { catSelect.innerHTML += `<option value="${cat.id}">${escapeHtml(cat.title)}</option>`; });
    updateLogItems();
    renderLogHistory();
}

function updateLogItems() {
    const catId = document.getElementById('logCat').value;
    const itemSelect = document.getElementById('logItem');
    itemSelect.innerHTML = '<option value="">-- Seleccionar Ítem --</option>';
    const cat = schema.find(c => c.id === catId);
    if(cat) { cat.items.forEach(i => { itemSelect.innerHTML += `<option value="${i.id}">${escapeHtml(i.label)}</option>`; }); }
}

function saveActualExpense() {
    const amount = parseFloat(document.getElementById('logAmount').value);
    const desc = document.getElementById('logDesc').value;
    const catId = document.getElementById('logCat').value;
    const itemId = document.getElementById('logItem').value;
    const date = document.getElementById('logDate').value;

    if (!Number.isFinite(amount) || amount <= 0 || !catId || !itemId || !date) return alert("Completa el monto, la categoría, el ítem y la fecha.");

    const cat = schema.find(c => c.id === catId);
    const newTx = { id: `tx_${crypto.randomUUID()}`, amount, desc: desc || 'Sin título', catId, itemId, date, color: budgetColor(cat.color) };
    recordMovement(allActuals, newTx);
    document.getElementById('logAmount').value = '';
    document.getElementById('logDesc').value = '';
    renderLogHistory();
}

function recordMovement(months, movement) {
    const month = movement.date.slice(0, 7);
    (months[month] ??= []).unshift(movement);
    saveAll();
    if (month !== currentMonth) {
        monthSelector.value = month;
        changeMonth();
    }
}

function renderLogHistory() {
    const container = document.getElementById('logHistoryContainer');
    const actuals = getActualsForMonth();
    if(actuals.length === 0) { container.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding: 20px;">No hay gastos registrados este mes.</div>'; return; }
    let html = '';
    actuals.forEach(tx => {
        const cat = schema.find(c => c.id === tx.catId);
        const item = cat ? cat.items.find(i => i.id === tx.itemId) : null;
        const itemLabel = item ? item.label : 'Ítem Eliminado';
        html += `
        <div class="log-item-card" style="border-left-color: var(--${budgetColor(tx.color)})">
            <div class="log-info">
                <div class="log-desc">${escapeHtml(tx.desc)}</div>
                <div class="log-meta">${escapeHtml(itemLabel)} • ${escapeHtml(tx.date)}</div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
                <div class="log-amount">Q ${formatMoney(tx.amount)}</div>
                <button class="icon-btn" onclick="deleteActual('${tx.id}')">×</button>
            </div>
        </div>`;
    });
    container.innerHTML = html;
}

function deleteActual(txId) {
    allActuals[currentMonth] = getActualsForMonth().filter(tx => tx.id !== txId);
    saveAll();
    renderLogHistory();
}

// ----------- COMPARACIÓN Y ENCABEZADO -----------
function renderCompareTab() {
    const container = document.getElementById('compareContainer');
    const actuals = getActualsForMonth();
    const { limit: totalBudgeted, spent: totalActual, categories } = monthlySummary();
    let html = '';

    schema.forEach(cat => {
        const { limit: catBudget, spent: catActual } = categories.find(category => category.id === cat.id);
        let itemsHtml = '';
        cat.items.forEach(item => {
            const iBudget = getBudgetVal(item.id);
            const iActual = actuals.filter(tx => tx.catId === cat.id && tx.itemId === item.id).reduce((sum, tx) => sum + tx.amount, 0);
            if(iBudget > 0 || iActual > 0) {
                const iPct = iBudget > 0 ? Math.min((iActual / iBudget) * 100, 100) : 100;
                const isOver = iActual > iBudget;
                itemsHtml += `
                <div class="compare-row">
                    <div class="compare-labels">
                        <span>${escapeHtml(item.label)}</span>
                        <span class="text-muted" style="color: ${isOver ? 'var(--red)' : ''}">Q ${formatMoney(iActual)} / Q ${formatMoney(iBudget)}</span>
                    </div>
                    <div class="compare-bar-bg">
                        <div class="compare-bar-fill bg-${budgetColor(cat.color)} ${isOver ? 'over-budget' : ''}" style="width: ${iPct}%;"></div>
                    </div>
                </div>`;
            }
        });
        if (catBudget > 0 || catActual > 0) {
            html += `
            <div class="cat-compare-card">
                <div class="cat-compare-title"><span class="dot bg-${budgetColor(cat.color)}"></span> ${escapeHtml(cat.title)} <span class="text-muted" style="margin-left:auto; font-size:0.95rem; font-weight:normal;">Q ${formatMoney(catActual)} / Q ${formatMoney(catBudget)}</span></div>
                ${itemsHtml}
            </div>`;
        }
    });
    container.innerHTML = html;

    document.getElementById('overviewText').innerText = `Q ${formatMoney(totalActual)} Real / Q ${formatMoney(totalBudgeted)} Plan`;
    const overPct = totalBudgeted > 0 ? Math.min((totalActual / totalBudgeted) * 100, 100) : 0;
    const bar = document.getElementById('overviewBar');
    bar.style.width = `${overPct}%`;
    bar.className = `compare-bar-fill ${totalActual > totalBudgeted ? 'bg-red' : 'bg-blue'}`;
}

function monthlySummary() {
    const expenses = getActualsForMonth();
    const categories = schema.map(category => ({
        id: category.id,
        title: category.title,
        limit: category.items.reduce((total, item) => total + getBudgetVal(item.id), 0),
        spent: expenses.filter(entry => entry.catId === category.id).reduce((total, entry) => total + entry.amount, 0),
    }));
    const known = new Set(categories.map(category => category.id));
    const other = expenses.filter(entry => !known.has(entry.catId));
    if (other.length) categories.push({ title: 'Categorías eliminadas', limit: 0, spent: other.reduce((total, entry) => total + entry.amount, 0) });
    return {
        categories,
        income: getIncomesForMonth().reduce((total, entry) => total + entry.amount, 0),
        spent: expenses.reduce((total, entry) => total + entry.amount, 0),
        limit: categories.reduce((total, category) => total + category.limit, 0),
    };
}

function updateGlobalHeader() {
    const { income, spent, limit, categories } = monthlySummary();
    const balance = document.getElementById('surplusDisplay');
    balance.textContent = `Q ${formatMoney(income - spent)}`;
    balance.classList.toggle('negative', income < spent);
    document.getElementById('summaryIncome').textContent = `Q ${formatMoney(income)}`;
    document.getElementById('summaryExpense').textContent = `Q ${formatMoney(spent)}`;
    document.getElementById('summaryLimit').textContent = `Q ${formatMoney(limit)}`;
    const rows = categories.filter(category => category.limit || category.spent).map(category => {
        const ratio = category.limit > 0 ? category.spent / category.limit : 1;
        const tone = category.spent > category.limit ? 'over' : ratio >= 0.8 ? 'near' : 'normal';
        const percentage = Math.max(0, Math.min(100, Math.round(ratio * 100)));
        const label = category.limit <= 0 ? 'Sin presupuesto'
            : category.spent > category.limit ? 'Excedido' : `${Math.round(ratio * 100)} % utilizado`;
        return `<div class="category-summary-row ${tone}">
            <div><strong>${escapeHtml(category.title)}</strong><span>${label}</span></div>
            <progress max="100" value="${percentage}" aria-label="${escapeHtml(category.title)}"></progress>
            <small>Q ${formatMoney(category.spent)} de Q ${formatMoney(category.limit)}</small>
        </div>`;
    });
    document.getElementById('categorySummary').innerHTML = rows.join('') || '<p>Los límites y gastos de este mes aparecerán aquí.</p>';
}

function csvCell(value) {
    if (typeof value === 'number') return String(value);
    const text = String(value);
    const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
}

function downloadFile(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportToCSV() {
    const rows = [['Categoría', 'Ítem', 'Tipo', 'Monto (Q)', 'Fecha', 'Descripción']];
    for (const entry of getIncomesForMonth()) {
        rows.push(['Ingresos', 'Ingreso', 'Ingreso real', entry.amount, entry.date, entry.desc]);
    }
    for (const category of schema) {
        for (const item of category.items) {
            rows.push([category.title, item.label, 'Límite presupuestado', getBudgetVal(item.id), '', '']);
        }
    }
    for (const entry of getActualsForMonth()) {
        const category = schema.find(item => item.id === entry.catId);
        const item = category?.items.find(item => item.id === entry.itemId);
        rows.push([category?.title ?? 'Categoría eliminada', item?.label ?? 'Ítem eliminado', 'Gasto real', entry.amount, entry.date, entry.desc]);
    }
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    downloadFile(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }), `Presupuesto_${currentMonth}.csv`);
}

function exportToPDF() {
    window.print();
}

// ----------- EDICIÓN DE CATEGORÍAS E ÍTEMS -----------
function addCategory() {
    const title = prompt("Nombre de la nueva categoría:");
    if (!title) return;
    const color = budgetColor(prompt("Color (blue, green, yellow, red, purple, orange):", "purple"));
    schema.push({ id: `cat_${crypto.randomUUID()}`, title, color, items: [] });
    saveAll();
    renderPlanTab();
}

function addItem(catId) {
    const label = prompt("Nombre del nuevo ítem de gasto:");
    if (!label) return;
    const cat = schema.find(c => c.id === catId);
    cat.items.push({ id: `item_${crypto.randomUUID()}`, label });
    saveAll();
    renderPlanTab();
}

function editCategory(id) {
    const cat = schema.find(c => c.id === id);
    if(!cat) return;
    const newTitle = prompt("Editar nombre de la categoría:", cat.title);
    if (newTitle && newTitle.trim() !== "") {
        cat.title = newTitle.trim();
        saveAll();
        renderPlanTab();
    }
}

function editItem(catId, itemId) {
    const cat = schema.find(c => c.id === catId);
    if(!cat) return;
    const item = cat.items.find(i => i.id === itemId);
    if(!item) return;
    const newLabel = prompt("Editar nombre del ítem:", item.label);
    if (newLabel && newLabel.trim() !== "") {
        item.label = newLabel.trim();
        saveAll();
        renderPlanTab();
    }
}

function deleteCategory(id) {
    if(confirm("¿Eliminar categoría completa?")) { schema = schema.filter(c => c.id !== id); saveAll(); renderPlanTab(); }
}

function deleteItem(catId, itemId) {
    if(confirm("¿Eliminar este ítem?")) {
        const cat = schema.find(c => c.id === catId);
        cat.items = cat.items.filter(i => i.id !== itemId);
        saveAll();
        renderPlanTab();
    }
}

function exportBackup() {
    // Keep the serialized field format so an older version can also read the export.
    const snapshot = currentBudget();
    const data = Object.fromEntries(budgetFields.map(key => [key, JSON.stringify(snapshot[key])]));
    downloadFile(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `Presupuesto_Respaldo_${localDate()}.json`);
}

async function importBackup(event) {
    const input = event.target;
    const file = input.files[0];
    if (!file) return;
    const session = budgetSession;
    try {
        const data = parseBudget(JSON.parse(await file.text()), defaultSchema);
        if (session !== budgetSession) return;
        if (confirm('¿Reemplazar los datos de este presupuesto con los del respaldo?')) {
            setBudget(data);
            saveAll();
        }
    } catch (error) {
        alert(`No se pudo importar el archivo. ${error.message}`);
    } finally {
        input.value = '';
    }
}

const cloudConfigured = Boolean(window.budgetSupabaseConfig?.url || window.budgetSupabaseConfig?.publishableKey);
try {
    setBudget(cloudConfigured ? emptyBudget() : loadLocalBudget());
} catch {
    setBudget(emptyBudget());
    alert('No se pudieron leer los datos de este navegador. Puedes importar un respaldo desde Plan.');
}

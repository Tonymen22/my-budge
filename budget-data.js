const budgetColors = ['blue', 'green', 'yellow', 'red', 'purple', 'orange'];
const budgetFields = ['schema', 'values', 'actuals', 'incomes'];
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

function budgetObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function budgetId(value) {
    return typeof value === 'string' && /^[\w-]{1,100}$/.test(value)
        && !Object.hasOwn(Object.prototype, value) && value !== 'prototype';
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

function budgetColor(value) {
    return budgetColors.includes(value) ? value : 'purple';
}

function parseBudget(raw, fallbackSchema) {
    if (!budgetObject(raw) || !budgetFields.some(key => Object.hasOwn(raw, key))) {
        throw new Error('El archivo no contiene un respaldo de presupuesto.');
    }
    const [schema, values, actuals, incomes] = budgetFields.map(key => {
        const value = raw[key];
        return typeof value === 'string' ? JSON.parse(value) : value;
    });
    const data = {
        schema: schema ?? structuredClone(fallbackSchema),
        values: values ?? {},
        actuals: actuals ?? {},
        incomes: incomes ?? {},
    };
    const categoryIds = new Set();
    const itemIds = new Set();
    const validSchema = Array.isArray(data.schema) && data.schema.every(category => {
        if (!budgetObject(category) || !budgetId(category.id) || categoryIds.has(category.id)
            || typeof category.title !== 'string' || !Array.isArray(category.items)) return false;
        categoryIds.add(category.id);
        return category.items.every(item => {
            if (!budgetObject(item) || !budgetId(item.id) || item.id === 'income' || itemIds.has(item.id)
                || typeof item.label !== 'string') return false;
            itemIds.add(item.id);
            return true;
        });
    });
    const validMonths = (months, validator) => budgetObject(months)
        && Object.entries(months).every(([month, entries]) => monthPattern.test(month) && validator(entries));
    const validValues = validMonths(data.values, entries => budgetObject(entries)
        && Object.entries(entries).every(([id, amount]) => budgetId(id) && Number.isFinite(amount)));
    const validEntries = (months, expenses) => validMonths(months, entries => Array.isArray(entries)
        && new Set(entries.map(entry => entry?.id)).size === entries.length
        && entries.every(entry => budgetObject(entry) && budgetId(entry.id) && Number.isFinite(entry.amount)
            && typeof entry.desc === 'string' && typeof entry.date === 'string'
            && (!expenses || (budgetId(entry.catId) && budgetId(entry.itemId)))));
    if (!validSchema || !validValues || !validEntries(data.actuals, true) || !validEntries(data.incomes, false)) {
        throw new Error('El respaldo contiene categorías o movimientos con un formato inválido.');
    }
    return data;
}

const AccountingModel = require('../models/accountingModel');
const RequestModel = require('../models/requestModel');
const logger = require('../config/logger');

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Paleta de colores de marca para los segmentos de los gráficos circulares
const CHART_PALETTE = [
    '#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899',
    '#14b8a6', '#eab308', '#f97316', '#6366f1', '#84cc16', '#06b6d4'
];

// Sanea un año recibido por query; por defecto, el año en curso
function resolveYear(raw) {
    const year = parseInt(raw, 10);
    const current = new Date().getFullYear();
    if (Number.isInteger(year) && year >= 2000 && year <= current + 1) {
        return year;
    }
    return current;
}

// Construye el conjunto financiero (año y mes en curso) a partir de las series mensuales
function buildFinancials(series, year) {
    const ingresosAnio = series.income.reduce((a, v) => a + v, 0);
    const gastosAnio = series.expense.reduce((a, v) => a + v, 0);
    const beneficioAnio = ingresosAnio - gastosAnio;
    const margenAnio = ingresosAnio > 0 ? (beneficioAnio / ingresosAnio) * 100 : 0;

    const now = new Date();
    const monthIndex = (year === now.getFullYear()) ? now.getMonth() : 11;
    const ingresosMes = series.income[monthIndex];
    const gastosMes = series.expense[monthIndex];
    const beneficioMes = ingresosMes - gastosMes;

    return {
        ingresosAnio, gastosAnio, beneficioAnio, margenAnio,
        ingresosMes, gastosMes, beneficioMes,
        mesActualNombre: MESES[monthIndex]
    };
}

const AccountingController = {

    // Dashboard principal (KPIs + gráficos + tabla de solicitudes)
    async showDashboard(req, res) {
        try {
            const year = resolveYear(req.query.year);

            const [counts, series, catData, requests] = await Promise.all([
                AccountingModel.getCounts(),
                AccountingModel.getMonthlySeries(year),
                AccountingModel.getExpensesByCategory(year),
                RequestModel.getAll()
            ]);

            const financials = buildFinancials(series, year);

            const monthlyChart = {
                labels: MESES,
                series: [
                    { name: 'Ingresos', color: '#10b981', values: series.income.map(v => Math.round(v)) },
                    { name: 'Gastos', color: '#ef4444', values: series.expense.map(v => Math.round(v)) }
                ]
            };

            const categoryChart = {
                centerLabel: 'Gastos',
                segments: catData.map((r, i) => ({
                    label: AccountingModel.CATEGORY_LABELS[r.categoria] || r.categoria,
                    value: Math.round(r.total),
                    color: CHART_PALETTE[i % CHART_PALETTE.length]
                }))
            };

            const statusChart = {
                centerLabel: 'Vehículos',
                segments: [
                    { label: 'Disponibles', value: counts.disponibles, color: '#10b981' },
                    { label: 'Reservados', value: counts.reservados, color: '#3b82f6' },
                    { label: 'Vendidos', value: counts.vendidos, color: '#6b7280' }
                ]
            };

            res.render('admin/dashboard', {
                title: 'Dashboard de Administración y Finanzas',
                adminUser: req.session.adminUser,
                year,
                counts,
                financials,
                requests,
                monthlyChart,
                categoryChart,
                statusChart
            });
        } catch (err) {
            logger.error('Error al cargar dashboard: ' + err.message, { error: err });
            res.status(500).render('error', {
                message: 'Error al recuperar métricas del panel.',
                title: 'Error de Panel'
            });
        }
    },

    // Página de Contabilidad (libros de ingresos/gastos + rentabilidad + gráficos)
    async showAccounting(req, res) {
        try {
            const year = resolveYear(req.query.year);

            const expenseFilters = {
                categoria: req.query.catGasto || null,
                desde: req.query.desde || null,
                hasta: req.query.hasta || null
            };
            const incomeFilters = { tipo: req.query.tipoIngreso || null };

            const [series, catData, profitability, generalExpenses, generalIncomes] = await Promise.all([
                AccountingModel.getMonthlySeries(year),
                AccountingModel.getExpensesByCategory(year),
                AccountingModel.getVehicleProfitability(),
                AccountingModel.getGeneralExpenses(expenseFilters),
                AccountingModel.getGeneralIncomes(incomeFilters)
            ]);

            const financials = buildFinancials(series, year);

            const monthlyChart = {
                labels: MESES,
                series: [
                    { name: 'Ingresos', color: '#10b981', values: series.income.map(v => Math.round(v)) },
                    { name: 'Gastos', color: '#ef4444', values: series.expense.map(v => Math.round(v)) }
                ]
            };

            const categoryChart = {
                centerLabel: 'Gastos',
                segments: catData.map((r, i) => ({
                    label: AccountingModel.CATEGORY_LABELS[r.categoria] || r.categoria,
                    value: Math.round(r.total),
                    color: CHART_PALETTE[i % CHART_PALETTE.length]
                }))
            };

            res.render('admin/accounting', {
                title: 'Contabilidad - Luxe Imports',
                adminUser: req.session.adminUser,
                year,
                financials,
                monthlyChart,
                categoryChart,
                profitability,
                generalExpenses,
                generalIncomes,
                expenseFilters,
                incomeFilters,
                categoriasGasto: AccountingModel.CATEGORIAS_GASTO_GENERAL,
                tiposIngreso: AccountingModel.TIPOS_INGRESO,
                categoryLabels: AccountingModel.CATEGORY_LABELS,
                incomeLabels: AccountingModel.INCOME_LABELS
            });
        } catch (err) {
            logger.error('Error al cargar contabilidad: ' + err.message, { error: err });
            res.status(500).render('error', {
                message: 'Error al cargar el módulo de contabilidad.',
                title: 'Error de Panel'
            });
        }
    },

    // Registrar un gasto general
    async addGeneralExpense(req, res) {
        try {
            const { categoria, concepto, monto, fecha, notas } = req.body;
            const validationError = validateLedgerEntry({
                categoria, concepto, monto, fecha,
                allowedCategories: AccountingModel.CATEGORIAS_GASTO_GENERAL,
                categoryField: 'Categoría'
            });
            if (validationError) {
                return res.status(400).render('error', { title: 'Error de Validación', message: validationError });
            }

            await AccountingModel.addGeneralExpense({
                categoria, concepto: concepto.trim(), monto, fecha,
                notas: notas ? notas.trim() : null,
                creadoPor: req.session.adminUser
            });
            logger.info(`Administrador '${req.session.adminUser}' registró gasto general '${concepto}' de ${monto}€`);
            res.redirect('/admin/contabilidad');
        } catch (err) {
            logger.error('Error al añadir gasto general: ' + err.message, { error: err });
            res.status(500).render('error', { message: 'No se pudo registrar el gasto.', title: 'Error' });
        }
    },

    // Eliminar un gasto general
    async deleteGeneralExpense(req, res) {
        try {
            const id = parseInt(req.params.id, 10);
            if (isNaN(id)) {
                return res.status(400).send('ID inválido');
            }
            await AccountingModel.deleteGeneralExpense(id);
            logger.info(`Administrador '${req.session.adminUser}' eliminó gasto general ID ${id}`);
            res.redirect('/admin/contabilidad');
        } catch (err) {
            logger.error(`Error al eliminar gasto general ${req.params.id}: ` + err.message, { error: err });
            res.status(500).render('error', { message: 'No se pudo eliminar el gasto.', title: 'Error' });
        }
    },

    // Registrar un ingreso general
    async addGeneralIncome(req, res) {
        try {
            const { tipo, concepto, monto, fecha, notas } = req.body;
            const validationError = validateLedgerEntry({
                categoria: tipo, concepto, monto, fecha,
                allowedCategories: AccountingModel.TIPOS_INGRESO,
                categoryField: 'Tipo'
            });
            if (validationError) {
                return res.status(400).render('error', { title: 'Error de Validación', message: validationError });
            }

            await AccountingModel.addGeneralIncome({
                tipo, concepto: concepto.trim(), monto, fecha,
                notas: notas ? notas.trim() : null,
                creadoPor: req.session.adminUser
            });
            logger.info(`Administrador '${req.session.adminUser}' registró ingreso general '${concepto}' de ${monto}€`);
            res.redirect('/admin/contabilidad');
        } catch (err) {
            logger.error('Error al añadir ingreso general: ' + err.message, { error: err });
            res.status(500).render('error', { message: 'No se pudo registrar el ingreso.', title: 'Error' });
        }
    },

    // Eliminar un ingreso general
    async deleteGeneralIncome(req, res) {
        try {
            const id = parseInt(req.params.id, 10);
            if (isNaN(id)) {
                return res.status(400).send('ID inválido');
            }
            await AccountingModel.deleteGeneralIncome(id);
            logger.info(`Administrador '${req.session.adminUser}' eliminó ingreso general ID ${id}`);
            res.redirect('/admin/contabilidad');
        } catch (err) {
            logger.error(`Error al eliminar ingreso general ${req.params.id}: ` + err.message, { error: err });
            res.status(500).render('error', { message: 'No se pudo eliminar el ingreso.', title: 'Error' });
        }
    },

    // Exportar un libro (gastos | ingresos) a CSV
    async exportLedger(req, res) {
        try {
            const tipo = req.query.tipo === 'ingresos' ? 'ingresos' : 'gastos';
            let filename;
            let header;
            let rows;

            if (tipo === 'ingresos') {
                const data = await AccountingModel.getGeneralIncomes({});
                filename = 'libro_ingresos.csv';
                header = ['ID', 'Fecha', 'Tipo', 'Concepto', 'Importe', 'Notas', 'Registrado por'];
                rows = data.map(r => [
                    r.id, formatDate(r.fecha),
                    AccountingModel.INCOME_LABELS[r.tipo] || r.tipo,
                    r.concepto, formatAmount(r.monto), r.notas || '', r.creado_por || ''
                ]);
            } else {
                const data = await AccountingModel.getGeneralExpenses({});
                filename = 'libro_gastos.csv';
                header = ['ID', 'Fecha', 'Categoría', 'Concepto', 'Importe', 'Notas', 'Registrado por'];
                rows = data.map(r => [
                    r.id, formatDate(r.fecha),
                    AccountingModel.CATEGORY_LABELS[r.categoria] || r.categoria,
                    r.concepto, formatAmount(r.monto), r.notas || '', r.creado_por || ''
                ]);
            }

            const csv = buildCsv(header, rows);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            // BOM UTF-8 para que Excel respete los acentos
            res.send('﻿' + csv);
            logger.info(`Administrador '${req.session.adminUser}' exportó el libro de ${tipo} a CSV`);
        } catch (err) {
            logger.error('Error al exportar libro contable: ' + err.message, { error: err });
            res.status(500).render('error', { message: 'No se pudo generar la exportación.', title: 'Error' });
        }
    }
};

// --- Utilidades internas ---

// Valida una entrada de libro (gasto o ingreso). Devuelve un mensaje de error o null si es válida.
function validateLedgerEntry({ categoria, concepto, monto, fecha, allowedCategories, categoryField }) {
    if (!categoria || !allowedCategories.includes(categoria)) {
        return `${categoryField} no válida.`;
    }
    if (!concepto || !concepto.trim()) {
        return 'El concepto es obligatorio.';
    }
    if (concepto.trim().length > 150) {
        return 'El concepto es demasiado largo (máx. 150 caracteres).';
    }
    const montoNum = parseFloat(monto);
    if (isNaN(montoNum) || montoNum <= 0 || montoNum > 100000000) {
        return 'El importe no es válido.';
    }
    // Fecha en formato ISO (YYYY-MM-DD) y real
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || isNaN(new Date(fecha).getTime())) {
        return 'La fecha no es válida.';
    }
    return null;
}

function formatDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toISOString().slice(0, 10);
}

function formatAmount(value) {
    return parseFloat(value).toFixed(2);
}

// Construye un CSV escapando comillas y envolviendo cada campo entre comillas
function buildCsv(header, rows) {
    const escape = (field) => `"${String(field).replace(/"/g, '""')}"`;
    const lines = [header.map(escape).join(';')];
    rows.forEach(row => lines.push(row.map(escape).join(';')));
    return lines.join('\r\n');
}

module.exports = AccountingController;

const db = require('../config/db');
const logger = require('../config/logger');

// --- CATÁLOGOS DE CATEGORÍAS ---
// Valores en ASCII (estables en BD); las etiquetas visibles llevan acentos.

// Categorías válidas para gastos imputados a un vehículo (gastos_pedido)
const CATEGORIAS_GASTO_VEHICULO = [
    'compra', 'transporte', 'aduanas', 'itv', 'matriculacion',
    'reparaciones', 'limpieza', 'combustible', 'publicidad', 'comisiones', 'otros'
];

// Categorías válidas para gastos generales/operativos (gastos_generales)
const CATEGORIAS_GASTO_GENERAL = [
    'alquiler', 'sueldos', 'electricidad', 'internet', 'seguros', 'herramientas',
    'publicidad', 'material', 'transporte', 'aduanas', 'itv', 'reparaciones', 'otros'
];

// Tipos válidos para ingresos generales (ingresos_generales)
const TIPOS_INGRESO = ['venta', 'reserva', 'senal', 'cobro', 'transferencia', 'otros'];

// Etiquetas legibles para mostrar en la interfaz y gráficos
const CATEGORY_LABELS = {
    compra: 'Compra vehículo', transporte: 'Transporte', aduanas: 'Aduanas', itv: 'ITV',
    matriculacion: 'Matriculación', reparaciones: 'Reparaciones', limpieza: 'Limpieza',
    combustible: 'Combustible', publicidad: 'Publicidad', comisiones: 'Comisiones',
    alquiler: 'Alquiler', sueldos: 'Sueldos', electricidad: 'Electricidad',
    internet: 'Internet', seguros: 'Seguros', herramientas: 'Herramientas',
    material: 'Material', otros: 'Otros'
};

const INCOME_LABELS = {
    venta: 'Venta', reserva: 'Reserva', senal: 'Señal',
    cobro: 'Cobro', transferencia: 'Transferencia', otros: 'Otros'
};

const AccountingModel = {
    CATEGORIAS_GASTO_VEHICULO,
    CATEGORIAS_GASTO_GENERAL,
    TIPOS_INGRESO,
    CATEGORY_LABELS,
    INCOME_LABELS,

    /**
     * Recuentos operativos de vehículos y solicitudes (para KPIs del panel).
     * @returns {Promise<object>}
     */
    async getCounts() {
        try {
            const query = `
                SELECT
                    (SELECT COUNT(*) FROM coches WHERE estado = 'disponible') AS disponibles,
                    (SELECT COUNT(*) FROM coches WHERE estado = 'reservado')  AS reservados,
                    (SELECT COUNT(*) FROM coches WHERE estado = 'vendido')    AS vendidos,
                    (SELECT COUNT(*) FROM solicitudes_importacion WHERE estado = 'pendiente') AS solicitudes_pendientes,
                    (SELECT COUNT(*) FROM solicitudes_busqueda WHERE estado = 'pendiente') AS busquedas_pendientes,
                    (SELECT COUNT(*) FROM coches) AS total_vehiculos
            `;
            const [rows] = await db.execute(query);
            return rows[0];
        } catch (err) {
            logger.error('Error en AccountingModel.getCounts: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Series mensuales de ingresos y gastos para un año dado (12 posiciones).
     * Ingresos = ventas de vehículos (aprobado/completado) + ingresos generales.
     * Gastos   = gastos por vehículo + gastos generales.
     * @param {number} year
     * @returns {Promise<{income: number[], expense: number[]}>}
     */
    async getMonthlySeries(year) {
        try {
            const [sales] = await db.execute(
                `SELECT MONTH(creado_en) AS m, COALESCE(SUM(precio_venta), 0) AS t
                 FROM solicitudes_importacion
                 WHERE estado IN ('aprobado', 'completado') AND precio_venta IS NOT NULL AND YEAR(creado_en) = ?
                 GROUP BY MONTH(creado_en)`, [year]);

            const [genInc] = await db.execute(
                `SELECT MONTH(fecha) AS m, COALESCE(SUM(monto), 0) AS t
                 FROM ingresos_generales WHERE YEAR(fecha) = ? GROUP BY MONTH(fecha)`, [year]);

            const [vehExp] = await db.execute(
                `SELECT MONTH(creado_en) AS m, COALESCE(SUM(monto), 0) AS t
                 FROM gastos_pedido WHERE YEAR(creado_en) = ? GROUP BY MONTH(creado_en)`, [year]);

            const [genExp] = await db.execute(
                `SELECT MONTH(fecha) AS m, COALESCE(SUM(monto), 0) AS t
                 FROM gastos_generales WHERE YEAR(fecha) = ? GROUP BY MONTH(fecha)`, [year]);

            const income = Array(12).fill(0);
            const expense = Array(12).fill(0);
            sales.forEach(r => { income[r.m - 1] += parseFloat(r.t); });
            genInc.forEach(r => { income[r.m - 1] += parseFloat(r.t); });
            vehExp.forEach(r => { expense[r.m - 1] += parseFloat(r.t); });
            genExp.forEach(r => { expense[r.m - 1] += parseFloat(r.t); });

            return { income, expense };
        } catch (err) {
            logger.error('Error en AccountingModel.getMonthlySeries: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Desglose de gastos por categoría (vehículo + generales) en un año.
     * @param {number} year
     * @returns {Promise<Array<{categoria: string, total: number}>>}
     */
    async getExpensesByCategory(year) {
        try {
            const query = `
                SELECT categoria, SUM(monto) AS total FROM (
                    SELECT categoria, monto FROM gastos_pedido   WHERE YEAR(creado_en) = ?
                    UNION ALL
                    SELECT categoria, monto FROM gastos_generales WHERE YEAR(fecha) = ?
                ) AS combinados
                GROUP BY categoria
                ORDER BY total DESC
            `;
            const [rows] = await db.execute(query, [year, year]);
            return rows.map(r => ({ categoria: r.categoria, total: parseFloat(r.total) }));
        } catch (err) {
            logger.error('Error en AccountingModel.getExpensesByCategory: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Rentabilidad por vehículo/pedido con precio de venta definido.
     * Calcula coste total, beneficio, margen (%) y ROI (%).
     * @returns {Promise<Array>}
     */
    async getVehicleProfitability() {
        try {
            const query = `
                SELECT si.id, si.nombre_cliente, si.estado, si.precio_venta,
                       c.marca, c.modelo,
                       COALESCE((SELECT SUM(monto) FROM gastos_pedido WHERE solicitud_id = si.id), 0) AS coste
                FROM solicitudes_importacion si
                LEFT JOIN coches c ON si.coche_id = c.id
                WHERE si.precio_venta IS NOT NULL
                ORDER BY si.creado_en DESC
            `;
            const [rows] = await db.execute(query);
            return rows.map(r => {
                const precioVenta = parseFloat(r.precio_venta);
                const coste = parseFloat(r.coste);
                const beneficio = precioVenta - coste;
                const margen = precioVenta > 0 ? (beneficio / precioVenta) * 100 : 0;
                const roi = coste > 0 ? (beneficio / coste) * 100 : null;
                return {
                    id: r.id,
                    cliente: r.nombre_cliente,
                    estado: r.estado,
                    vehiculo: r.marca ? `${r.marca} ${r.modelo}` : 'A la carta',
                    precioVenta, coste, beneficio, margen, roi
                };
            });
        } catch (err) {
            logger.error('Error en AccountingModel.getVehicleProfitability: ' + err.message, { error: err });
            throw err;
        }
    },

    // --- LIBRO DE GASTOS GENERALES ---

    async getGeneralExpenses(filters = {}) {
        try {
            let query = 'SELECT * FROM gastos_generales WHERE 1=1';
            const params = [];
            if (filters.categoria && CATEGORIAS_GASTO_GENERAL.includes(filters.categoria)) {
                query += ' AND categoria = ?';
                params.push(filters.categoria);
            }
            if (filters.desde) {
                query += ' AND fecha >= ?';
                params.push(filters.desde);
            }
            if (filters.hasta) {
                query += ' AND fecha <= ?';
                params.push(filters.hasta);
            }
            query += ' ORDER BY fecha DESC, id DESC';
            const [rows] = await db.execute(query, params);
            return rows;
        } catch (err) {
            logger.error('Error en AccountingModel.getGeneralExpenses: ' + err.message, { error: err });
            throw err;
        }
    },

    async addGeneralExpense({ categoria, concepto, monto, fecha, notas, creadoPor }) {
        try {
            const query = `INSERT INTO gastos_generales (categoria, concepto, monto, fecha, notas, creado_por)
                           VALUES (?, ?, ?, ?, ?, ?)`;
            const [result] = await db.execute(query, [
                categoria, concepto, parseFloat(monto), fecha, notas || null, creadoPor || null
            ]);
            return result.insertId;
        } catch (err) {
            logger.error('Error en AccountingModel.addGeneralExpense: ' + err.message, { error: err });
            throw err;
        }
    },

    async deleteGeneralExpense(id) {
        try {
            const [result] = await db.execute('DELETE FROM gastos_generales WHERE id = ?', [id]);
            return result.affectedRows > 0;
        } catch (err) {
            logger.error('Error en AccountingModel.deleteGeneralExpense: ' + err.message, { error: err });
            throw err;
        }
    },

    // --- LIBRO DE INGRESOS GENERALES ---

    async getGeneralIncomes(filters = {}) {
        try {
            let query = 'SELECT * FROM ingresos_generales WHERE 1=1';
            const params = [];
            if (filters.tipo && TIPOS_INGRESO.includes(filters.tipo)) {
                query += ' AND tipo = ?';
                params.push(filters.tipo);
            }
            if (filters.desde) {
                query += ' AND fecha >= ?';
                params.push(filters.desde);
            }
            if (filters.hasta) {
                query += ' AND fecha <= ?';
                params.push(filters.hasta);
            }
            query += ' ORDER BY fecha DESC, id DESC';
            const [rows] = await db.execute(query, params);
            return rows;
        } catch (err) {
            logger.error('Error en AccountingModel.getGeneralIncomes: ' + err.message, { error: err });
            throw err;
        }
    },

    async addGeneralIncome({ tipo, concepto, monto, fecha, notas, creadoPor }) {
        try {
            const query = `INSERT INTO ingresos_generales (tipo, concepto, monto, fecha, notas, creado_por)
                           VALUES (?, ?, ?, ?, ?, ?)`;
            const [result] = await db.execute(query, [
                tipo, concepto, parseFloat(monto), fecha, notas || null, creadoPor || null
            ]);
            return result.insertId;
        } catch (err) {
            logger.error('Error en AccountingModel.addGeneralIncome: ' + err.message, { error: err });
            throw err;
        }
    },

    async deleteGeneralIncome(id) {
        try {
            const [result] = await db.execute('DELETE FROM ingresos_generales WHERE id = ?', [id]);
            return result.affectedRows > 0;
        } catch (err) {
            logger.error('Error en AccountingModel.deleteGeneralIncome: ' + err.message, { error: err });
            throw err;
        }
    }
};

module.exports = AccountingModel;

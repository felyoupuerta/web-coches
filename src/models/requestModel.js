const db = require('../config/db');
const logger = require('../config/logger');

const RequestModel = {
    /**
     * Registra una nueva solicitud de importación (pedido)
     * @param {object} reqData 
     * @returns {Promise<number>} ID de la solicitud creada
     */
    async create(reqData) {
        try {
            const query = `
                INSERT INTO solicitudes_importacion 
                (coche_id, nombre_cliente, telefono_cliente, email_cliente, mensaje, estado) 
                VALUES (?, ?, ?, ?, ?, 'pendiente')
            `;
            const params = [
                reqData.coche_id || null,
                reqData.nombre_cliente,
                reqData.telefono_cliente,
                reqData.email_cliente,
                reqData.mensaje || null
            ];
            const [result] = await db.execute(query, params);
            return result.insertId;
        } catch (err) {
            logger.error('Error en RequestModel.create: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Obtiene todas las solicitudes con datos básicos del coche asociado
     * @returns {Promise<Array>}
     */
    async getAll() {
        try {
            const query = `
                SELECT si.*, c.marca, c.modelo, c.precio as precio_catalogo,
                       COALESCE((SELECT SUM(monto) FROM gastos_pedido WHERE solicitud_id = si.id), 0) as total_gastos
                FROM solicitudes_importacion si
                LEFT JOIN coches c ON si.coche_id = c.id
                ORDER BY si.creado_en DESC
            `;
            const [rows] = await db.execute(query);
            return rows;
        } catch (err) {
            logger.error('Error en RequestModel.getAll: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Obtiene una solicitud por su ID
     * @param {number} id 
     * @returns {Promise<object|null>}
     */
    async getById(id) {
        try {
            const query = `
                SELECT si.*, c.marca, c.modelo, c.precio as precio_catalogo
                FROM solicitudes_importacion si
                LEFT JOIN coches c ON si.coche_id = c.id
                WHERE si.id = ?
            `;
            const [rows] = await db.execute(query, [id]);
            return rows.length > 0 ? rows[0] : null;
        } catch (err) {
            logger.error('Error en RequestModel.getById: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Actualiza el estado de una solicitud
     * @param {number} id 
     * @param {string} estado 
     * @returns {Promise<boolean>}
     */
    async updateStatus(id, estado) {
        try {
            const query = 'UPDATE solicitudes_importacion SET estado = ? WHERE id = ?';
            const [result] = await db.execute(query, [estado, id]);
            return result.affectedRows > 0;
        } catch (err) {
            logger.error('Error en RequestModel.updateStatus: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Actualiza el precio de venta acordado para un pedido
     * @param {number} id 
     * @param {number} precioVenta 
     * @returns {Promise<boolean>}
     */
    async updatePrice(id, precioVenta) {
        try {
            const query = 'UPDATE solicitudes_importacion SET precio_venta = ? WHERE id = ?';
            const [result] = await db.execute(query, [precioVenta, id]);
            return result.affectedRows > 0;
        } catch (err) {
            logger.error('Error en RequestModel.updatePrice: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Obtiene el desglose de gastos para una solicitud
     * @param {number} solicitudId 
     * @returns {Promise<Array>}
     */
    async getExpenses(solicitudId) {
        try {
            const query = 'SELECT * FROM gastos_pedido WHERE solicitud_id = ? ORDER BY creado_en ASC';
            const [rows] = await db.execute(query, [solicitudId]);
            return rows;
        } catch (err) {
            logger.error('Error en RequestModel.getExpenses: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Añade un gasto individual a una solicitud/pedido
     * @param {number} solicitudId
     * @param {string} concepto
     * @param {number} monto
     * @param {string} [categoria='otros']
     * @returns {Promise<number>}
     */
    async addExpense(solicitudId, concepto, monto, categoria = 'otros') {
        try {
            const query = 'INSERT INTO gastos_pedido (solicitud_id, concepto, categoria, monto) VALUES (?, ?, ?, ?)';
            const [result] = await db.execute(query, [solicitudId, concepto, categoria, parseFloat(monto)]);
            return result.insertId;
        } catch (err) {
            logger.error('Error en RequestModel.addExpense: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Elimina un gasto de una solicitud/pedido.
     * Se exige también el solicitudId para evitar que un ID de pedido
     * manipulado permita borrar gastos que pertenecen a otro pedido (IDOR).
     * @param {number} gastoId
     * @param {number} solicitudId
     * @returns {Promise<boolean>}
     */
    async deleteExpense(gastoId, solicitudId) {
        try {
            const query = 'DELETE FROM gastos_pedido WHERE id = ? AND solicitud_id = ?';
            const [result] = await db.execute(query, [gastoId, solicitudId]);
            return result.affectedRows > 0;
        } catch (err) {
            logger.error('Error en RequestModel.deleteExpense: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Genera el informe consolidado financiero global.
     * Solo tiene en cuenta pedidos aprobados o completados (negocios reales).
     * @returns {Promise<object>}
     */
    async getFinancialSummary() {
        try {
            // 1. Ingresos totales (Suma de precios de venta acordados en pedidos 'aprobado' o 'completado')
            const queryIngresos = `
                SELECT COALESCE(SUM(precio_venta), 0) as ingresos_totales 
                FROM solicitudes_importacion 
                WHERE estado IN ('aprobado', 'completado')
            `;
            const [rowsIngresos] = await db.execute(queryIngresos);

            // 2. Gastos totales (Suma de los gastos individuales asociados a pedidos 'aprobado' o 'completado')
            const queryGastos = `
                SELECT COALESCE(SUM(gp.monto), 0) as gastos_totales
                FROM gastos_pedido gp
                INNER JOIN solicitudes_importacion si ON gp.solicitud_id = si.id
                WHERE si.estado IN ('aprobado', 'completado')
            `;
            const [rowsGastos] = await db.execute(queryGastos);

            const ingresos = parseFloat(rowsIngresos[0].ingresos_totales);
            const gastos = parseFloat(rowsGastos[0].gastos_totales);
            const beneficioNeto = ingresos - gastos;

            return {
                ingresos,
                gastos,
                beneficioNeto
            };
        } catch (err) {
            logger.error('Error en RequestModel.getFinancialSummary: ' + err.message, { error: err });
            throw err;
        }
    }
};

module.exports = RequestModel;

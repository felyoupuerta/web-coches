const db = require('../config/db');
const logger = require('../config/logger');

const SearchRequestModel = {
    /**
     * Registra una nueva solicitud de búsqueda "a la carta" (lead del wizard)
     * @param {object} data
     * @returns {Promise<number>} ID de la solicitud creada
     */
    async create(data) {
        try {
            const query = `
                INSERT INTO solicitudes_busqueda
                (marca_modelo, ano_minimo, combustible, km_maximo, presupuesto, extras,
                 nombre_cliente, telefono_cliente, email_cliente, estado)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')
            `;
            const params = [
                data.marca_modelo,
                data.ano_minimo || null,
                data.combustible || null,
                data.km_maximo || null,
                data.presupuesto || null,
                data.extras || null,
                data.nombre_cliente,
                data.telefono_cliente,
                data.email_cliente
            ];
            const [result] = await db.execute(query, params);
            return result.insertId;
        } catch (err) {
            logger.error('Error en SearchRequestModel.create: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Obtiene todas las solicitudes de búsqueda, más recientes primero
     * @returns {Promise<Array>}
     */
    async getAll() {
        try {
            const query = 'SELECT * FROM solicitudes_busqueda ORDER BY creado_en DESC';
            const [rows] = await db.execute(query);
            return rows;
        } catch (err) {
            logger.error('Error en SearchRequestModel.getAll: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Obtiene una solicitud de búsqueda por su ID
     * @param {number} id
     * @returns {Promise<object|null>}
     */
    async getById(id) {
        try {
            const query = 'SELECT * FROM solicitudes_busqueda WHERE id = ?';
            const [rows] = await db.execute(query, [id]);
            return rows.length > 0 ? rows[0] : null;
        } catch (err) {
            logger.error('Error en SearchRequestModel.getById: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Actualiza el estado de seguimiento de una solicitud de búsqueda
     * @param {number} id
     * @param {string} estado
     * @returns {Promise<boolean>}
     */
    async updateStatus(id, estado) {
        try {
            const query = 'UPDATE solicitudes_busqueda SET estado = ? WHERE id = ?';
            const [result] = await db.execute(query, [estado, id]);
            return result.affectedRows > 0;
        } catch (err) {
            logger.error('Error en SearchRequestModel.updateStatus: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Cuenta las solicitudes de búsqueda pendientes de gestionar (para KPIs)
     * @returns {Promise<number>}
     */
    async getPendingCount() {
        try {
            const query = "SELECT COUNT(*) as total FROM solicitudes_busqueda WHERE estado = 'pendiente'";
            const [rows] = await db.execute(query);
            return rows[0].total;
        } catch (err) {
            logger.error('Error en SearchRequestModel.getPendingCount: ' + err.message, { error: err });
            throw err;
        }
    }
};

module.exports = SearchRequestModel;

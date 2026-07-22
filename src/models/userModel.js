const db = require('../config/db');
const logger = require('../config/logger');

const UserModel = {
    /**
     * Busca un usuario administrador por su nombre de usuario
     * @param {string} username 
     * @returns {Promise<object|null>}
     */
    async findByUsername(username) {
        try {
            const query = 'SELECT id, usuario, password_hash, creado_en FROM usuarios_admin WHERE usuario = ?';
            const [rows] = await db.execute(query, [username]);
            return rows.length > 0 ? rows[0] : null;
        } catch (err) {
            logger.error('Error en UserModel.findByUsername: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Registra un nuevo administrador en el sistema
     * @param {string} username 
     * @param {string} passwordHash 
     * @returns {Promise<number>} ID del administrador creado
     */
    async create(username, passwordHash) {
        try {
            const query = 'INSERT INTO usuarios_admin (usuario, password_hash) VALUES (?, ?)';
            const [result] = await db.execute(query, [username, passwordHash]);
            return result.insertId;
        } catch (err) {
            logger.error('Error en UserModel.create: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Obtiene todos los usuarios administradores
     * @returns {Promise<Array>}
     */
    async findAll() {
        try {
            const query = 'SELECT id, usuario, creado_en FROM usuarios_admin ORDER BY creado_en DESC';
            const [rows] = await db.execute(query);
            return rows;
        } catch (err) {
            logger.error('Error en UserModel.findAll: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Elimina un usuario administrador por su ID
     * @param {number} id 
     * @returns {Promise<boolean>}
     */
    async deleteById(id) {
        try {
            const query = 'DELETE FROM usuarios_admin WHERE id = ?';
            const [result] = await db.execute(query, [id]);
            return result.affectedRows > 0;
        } catch (err) {
            logger.error('Error en UserModel.deleteById: ' + err.message, { error: err });
            throw err;
        }
    }
};

module.exports = UserModel;

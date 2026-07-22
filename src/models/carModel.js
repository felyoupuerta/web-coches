const db = require('../config/db');
const logger = require('../config/logger');

const CarModel = {
    /**
     * Obtiene el listado de coches con filtros de búsqueda dinámicos y seguros.
     * @param {object} filters 
     * @returns {Promise<Array>}
     */
    async getAll(filters = {}) {
        try {
            let query = `
                SELECT c.*, 
                (SELECT ruta_imagen FROM coche_imagenes WHERE coche_id = c.id LIMIT 1) as imagen_principal 
                FROM coches c 
                WHERE 1=1
            `;
            const params = [];

            if (filters.marca) {
                query += ' AND c.marca = ?';
                params.push(filters.marca);
            }
            if (filters.modelo) {
                query += ' AND c.modelo LIKE ?';
                params.push(`%${filters.modelo}%`);
            }
            if (filters.minPrecio) {
                query += ' AND c.precio >= ?';
                params.push(parseFloat(filters.minPrecio));
            }
            if (filters.maxPrecio) {
                query += ' AND c.precio <= ?';
                params.push(parseFloat(filters.maxPrecio));
            }
            if (filters.combustible) {
                query += ' AND c.combustible = ?';
                params.push(filters.combustible);
            }
            if (filters.estado) {
                query += ' AND c.estado = ?';
                params.push(filters.estado);
            } else if (filters.soloDisponibles) {
                query += " AND c.estado = 'disponible'";
            }

            query += ' ORDER BY c.creado_en DESC';

            const [rows] = await db.execute(query, params);
            return rows;
        } catch (err) {
            logger.error('Error en CarModel.getAll: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Obtiene los detalles de un coche por su ID.
     * @param {number} id 
     * @returns {Promise<object|null>}
     */
    async getById(id) {
        try {
            const query = 'SELECT * FROM coches WHERE id = ?';
            const [rows] = await db.execute(query, [id]);
            return rows.length > 0 ? rows[0] : null;
        } catch (err) {
            logger.error('Error en CarModel.getById: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Obtiene todas las imágenes de un coche por su ID.
     * @param {number} carId 
     * @returns {Promise<Array>}
     */
    async getImages(carId) {
        try {
            const query = 'SELECT id, ruta_imagen FROM coche_imagenes WHERE coche_id = ?';
            const [rows] = await db.execute(query, [carId]);
            return rows;
        } catch (err) {
            logger.error('Error en CarModel.getImages: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Crea un nuevo coche y asocia sus imágenes dentro de una transacción.
     * @param {object} carData 
     * @param {Array<string>} imageUrls 
     * @returns {Promise<number>} ID del coche creado
     */
    async create(carData, imageUrls) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const carQuery = `
                INSERT INTO coches 
                (marca, modelo, ano, kilometros, precio, motor, potencia, combustible, transmision, descripcion, estado) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const carParams = [
                carData.marca,
                carData.modelo,
                parseInt(carData.ano, 10),
                parseInt(carData.kilometros, 10),
                parseFloat(carData.precio),
                carData.motor || null,
                carData.potencia || null,
                carData.combustible || null,
                carData.transmision || null,
                carData.descripcion || null,
                carData.estado || 'disponible'
            ];

            const [carResult] = await connection.execute(carQuery, carParams);
            const carId = carResult.insertId;

            if (imageUrls && imageUrls.length > 0) {
                const imgQuery = 'INSERT INTO coche_imagenes (coche_id, ruta_imagen) VALUES (?, ?)';
                for (const url of imageUrls) {
                    await connection.execute(imgQuery, [carId, url]);
                }
            }

            await connection.commit();
            return carId;
        } catch (err) {
            await connection.rollback();
            logger.error('Error en CarModel.create (transacción revertida): ' + err.message, { error: err });
            throw err;
        } finally {
            connection.release();
        }
    },

    /**
     * Actualiza el estado de disponibilidad del coche.
     * @param {number} id 
     * @param {string} estado 
     * @returns {Promise<boolean>}
     */
    async updateStatus(id, estado) {
        try {
            const query = 'UPDATE coches SET estado = ? WHERE id = ?';
            const [result] = await db.execute(query, [estado, id]);
            return result.affectedRows > 0;
        } catch (err) {
            logger.error('Error en CarModel.updateStatus: ' + err.message, { error: err });
            throw err;
        }
    },

    /**
     * Elimina un coche y sus imágenes asociadas (en cascada por FK).
     * @param {number} id 
     * @returns {Promise<boolean>}
     */
    async delete(id) {
        try {
            const query = 'DELETE FROM coches WHERE id = ?';
            const [result] = await db.execute(query, [id]);
            return result.affectedRows > 0;
        } catch (err) {
            logger.error('Error en CarModel.delete: ' + err.message, { error: err });
            throw err;
        }
    }
};

module.exports = CarModel;

const mysql = require('mysql2/promise');
const logger = require('./logger');

// Configuración del pool de conexión
const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'web_coches_alemania',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4_unicode_ci'
});

// Comprobar la conexión inicial
(async () => {
    try {
        const connection = await pool.getConnection();
        logger.info('Conexión exitosa a la base de datos MariaDB.');
        connection.release();
    } catch (err) {
        logger.error('Error crítico al conectar a la base de datos MariaDB: ' + err.message, { error: err });
    }
})();

module.exports = pool;

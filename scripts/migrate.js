// Runner de migraciones idempotente.
// Ejecuta en orden los ficheros .sql de db/migrations que aún no se hayan
// aplicado, registrando cada uno en la tabla de control `_migraciones`.
// Uso: npm run migrate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function run() {
    const dir = path.join(__dirname, '..', 'db', 'migrations');
    const files = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
        : [];

    if (files.length === 0) {
        console.log('No hay migraciones que aplicar.');
        return;
    }

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT, 10) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASS || '',
        database: process.env.DB_NAME || 'db_luxe_imports',
        multipleStatements: true,
        charset: 'utf8mb4_unicode_ci'
    });

    try {
        await connection.query(
            `CREATE TABLE IF NOT EXISTS _migraciones (
                nombre VARCHAR(255) PRIMARY KEY,
                aplicada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB`
        );

        for (const file of files) {
            const [rows] = await connection.query('SELECT nombre FROM _migraciones WHERE nombre = ?', [file]);
            if (rows.length > 0) {
                console.log(`= ${file} (ya aplicada, se omite)`);
                continue;
            }

            const sql = fs.readFileSync(path.join(dir, file), 'utf8');
            console.log(`+ Aplicando ${file}...`);
            await connection.query(sql);
            await connection.query('INSERT INTO _migraciones (nombre) VALUES (?)', [file]);
            console.log('  OK');
        }

        console.log('Migraciones completadas correctamente.');
    } catch (err) {
        console.error('Error aplicando migraciones:', err.message);
        process.exitCode = 1;
    } finally {
        await connection.end();
    }
}

run();

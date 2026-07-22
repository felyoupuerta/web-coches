const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.CHATBOT_DB_USER,       // chatbot_ro
    password: process.env.CHATBOT_DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 5,
    connectTimeout: 5000
});

// Columnas y valores permitidos: única fuente de verdad para el filtro
const COLUMNAS_PERMITIDAS = ['marca', 'modelo', 'ano', 'combustible', 'transmision'];
const COMBUSTIBLES_VALIDOS = ['Gasolina', 'Diésel', 'Híbrido', 'Eléctrico'];
const TRANSMISIONES_VALIDAS = ['Manual', 'Automático'];

function sanitizarFiltros(filtros) {
    const limpio = {};

    if (typeof filtros.marca === 'string') limpio.marca = filtros.marca.slice(0, 50);
    if (typeof filtros.modelo === 'string') limpio.modelo = filtros.modelo.slice(0, 50);

    if (Number.isInteger(filtros.ano_min) && filtros.ano_min > 1990 && filtros.ano_min < 2100) {
        limpio.ano_min = filtros.ano_min;
    }
    if (Number.isInteger(filtros.precio_max) && filtros.precio_max > 0) {
        limpio.precio_max = Math.min(filtros.precio_max, 500000);
    }
    if (Number.isInteger(filtros.km_max) && filtros.km_max > 0) {
        limpio.km_max = Math.min(filtros.km_max, 500000);
    }
    if (COMBUSTIBLES_VALIDOS.includes(filtros.combustible)) {
        limpio.combustible = filtros.combustible;
    }
    if (TRANSMISIONES_VALIDAS.includes(filtros.transmision)) {
        limpio.transmision = filtros.transmision;
    }

    return limpio;
}

exports.buscarCoches = async (filtrosCrudos) => {
    const filtros = sanitizarFiltros(filtrosCrudos);

    // Consulta base: SIEMPRE solo coches disponibles, nunca toda la tabla
    let sql = `SELECT marca, modelo, ano, kilometros, precio, motor, potencia, combustible, transmision
               FROM coches WHERE estado = 'disponible'`;
    const params = [];

    if (filtros.marca) { sql += ' AND marca LIKE ?'; params.push(`%${filtros.marca}%`); }
    if (filtros.modelo) { sql += ' AND modelo LIKE ?'; params.push(`%${filtros.modelo}%`); }
    if (filtros.ano_min) { sql += ' AND ano >= ?'; params.push(filtros.ano_min); }
    if (filtros.precio_max) { sql += ' AND precio <= ?'; params.push(filtros.precio_max); }
    if (filtros.km_max) { sql += ' AND kilometros <= ?'; params.push(filtros.km_max); }
    if (filtros.combustible) { sql += ' AND combustible = ?'; params.push(filtros.combustible); }
    if (filtros.transmision) { sql += ' AND transmision = ?'; params.push(filtros.transmision); }

    sql += ' ORDER BY precio ASC LIMIT 5'; // límite fijo: nunca vuelca la tabla entera

    const [rows] = await pool.execute(sql, params);
    return rows;
};

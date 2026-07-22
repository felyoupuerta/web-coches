// Script para sembrar (seed) un usuario administrador en la base de datos
// Ejecución: npm run seed-admin <usuario> <password>
require('dotenv').config();
const UserModel = require('../src/models/userModel');
const { HashUtil } = require('../src/controllers/authController');
const db = require('../src/config/db');

async function seed() {
    const args = process.argv.slice(2);
    const usuario = args[0] || 'admin';
    const password = args[1] || 'AlemaniaCoches2026_Secure$';

    console.log('--- SEMBRADOR DE USUARIO ADMINISTRADOR ---');
    console.log(`Usuario: ${usuario}`);
    console.log(`Contraseña: ${password}`);
    console.log('Guardando en la base de datos...');

    try {
        // Verificar si el usuario ya existe
        const existing = await UserModel.findByUsername(usuario);
        if (existing) {
            console.error(`Error: El usuario administrador '${usuario}' ya existe en la base de datos.`);
            process.exit(1);
        }

        // Generar hash e insertar
        const passwordHash = HashUtil.hash(password);
        const adminId = await UserModel.create(usuario, passwordHash);

        console.log(`¡Éxito! Administrador '${usuario}' creado con ID: ${adminId}`);
    } catch (err) {
        console.error('Error al crear el administrador:', err.message);
    } finally {
        // Cerrar pool de base de datos
        await db.end();
        process.exit(0);
    }
}

seed();

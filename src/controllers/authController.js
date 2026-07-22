const crypto = require('crypto');
const UserModel = require('../models/userModel');
const logger = require('../config/logger');

// Utilidades criptográficas nativas de Node.js para evitar problemas de compilación binaria
const HashUtil = {
    /**
     * Hashea una contraseña usando scrypt
     * @param {string} password 
     * @returns {string} salt:hash
     */
    hash(password) {
        const salt = crypto.randomBytes(16).toString('hex');
        const derivedKey = crypto.scryptSync(password, salt, 64);
        return `${salt}:${derivedKey.toString('hex')}`;
    },

    /**
     * Verifica si una contraseña coincide con el hash guardado
     * @param {string} password 
     * @param {string} storedHash 
     * @returns {boolean}
     */
    verify(password, storedHash) {
        try {
            const parts = storedHash.split(':');
            if (parts.length !== 2) return false;
            const [salt, originalHash] = parts;
            const derivedKey = crypto.scryptSync(password, salt, 64);
            return crypto.timingSafeEqual(
                Buffer.from(originalHash, 'hex'),
                Buffer.from(derivedKey.toString('hex'), 'hex')
            );
        } catch (err) {
            logger.error('Error durante verificación de contraseña: ' + err.message);
            return false;
        }
    }
};

const AuthController = {
    // Renderizar la vista de Login
    showLogin(req, res) {
        if (req.session.adminId) {
            return res.redirect('/admin/dashboard');
        }
        res.render('login', { error: null, title: 'Acceso Admin - Luxe Imports' });
    },

    // Procesar el Login
    async login(req, res) {
        const { usuario, password } = req.body;

        try {
            if (!usuario || !password) {
                return res.render('login', { 
                    error: 'Por favor, rellene todos los campos.', 
                    title: 'Acceso Admin - Luxe Imports' 
                });
            }

            const user = await UserModel.findByUsername(usuario);
            if (!user) {
                // Prevenir timing attacks y enumeración de usuarios
                HashUtil.verify(password, 'dummy_salt:dummy_hash');
                return res.render('login', { 
                    error: 'Credenciales inválidas.', 
                    title: 'Acceso Admin - Luxe Imports' 
                });
            }

            const isMatch = HashUtil.verify(password, user.password_hash);
            if (!isMatch) {
                return res.render('login', { 
                    error: 'Credenciales inválidas.', 
                    title: 'Acceso Admin - Luxe Imports' 
                });
            }

            // Guardar sesión del administrador
            req.session.adminId = user.id;
            req.session.adminUser = user.usuario;

            logger.info(`Administrador '${user.usuario}' inició sesión exitosamente.`);
            res.redirect('/admin/dashboard');
        } catch (err) {
            logger.error('Fallo en el proceso de autenticación de admin: ' + err.message, { error: err });
            res.render('login', { 
                error: 'Ocurrió un error inesperado. Por favor, intente de nuevo.', 
                title: 'Acceso Admin - Luxe Imports' 
            });
        }
    },

    // Cerrar sesión
    logout(req, res) {
        const adminUser = req.session.adminUser;
        req.session.destroy((err) => {
            if (err) {
                logger.error('Error destruyendo sesión al cerrar sesión: ' + err.message);
            } else {
                logger.info(`Administrador '${adminUser || 'Desconocido'}' cerró sesión.`);
            }
            res.redirect('/admin/login');
        });
    },

    // Middleware para proteger rutas de administración
    requireAdmin(req, res, next) {
        if (req.session && req.session.adminId) {
            return next();
        }
        res.redirect('/admin/login');
    },

    // --- GESTIÓN DE USUARIOS ADMINISTRADORES ---

    // Mostrar la página de gestión de usuarios
    async showUsersPage(req, res) {
        try {
            const usuarios = await UserModel.findAll();
            res.render('admin/usuarios', {
                title: 'Gestionar Usuarios - Luxe Imports',
                usuarios,
                adminUser: req.session.adminUser
            });
        } catch (err) {
            logger.error('Error al listar usuarios admin: ' + err.message, { error: err });
            res.status(500).render('error', {
                message: 'Error al cargar la gestión de usuarios.',
                title: 'Error de Panel'
            });
        }
    },

    // Crear un nuevo usuario administrador
    async createUser(req, res) {
        try {
            const { usuario, password, password_confirm } = req.body;

            // Validar campos obligatorios y que coincidan las contraseñas
            if (!usuario || !password || !password_confirm) {
                return res.status(400).render('error', {
                    title: 'Error de Validación',
                    message: 'Todos los campos son obligatorios.'
                });
            }

            if (password !== password_confirm) {
                return res.status(400).render('error', {
                    title: 'Error de Validación',
                    message: 'Las contraseñas no coinciden.'
                });
            }

            if (password.length < 8) {
                return res.status(400).render('error', {
                    title: 'Error de Validación',
                    message: 'La contraseña debe tener al menos 8 caracteres.'
                });
            }

            // Verificar que no exista ya ese nombre de usuario
            const existing = await UserModel.findByUsername(usuario);
            if (existing) {
                return res.status(400).render('error', {
                    title: 'Usuario Duplicado',
                    message: 'Ya existe un administrador con ese nombre de usuario.'
                });
            }

            // Hashear con scrypt (mismo sistema que el login y el seeder)
            const passwordHash = HashUtil.hash(password);
            await UserModel.create(usuario, passwordHash);

            logger.info(`Administrador '${req.session.adminUser}' creó nuevo usuario admin: '${usuario}'`);
            res.redirect('/admin/usuarios');
        } catch (err) {
            logger.error('Error al crear usuario admin: ' + err.message, { error: err });
            res.status(500).render('error', {
                message: 'No se pudo crear el usuario administrador.',
                title: 'Error'
            });
        }
    },

    // Eliminar un usuario administrador
    async deleteUser(req, res) {
        try {
            const userId = parseInt(req.params.id, 10);
            if (isNaN(userId)) {
                return res.status(400).send('ID inválido');
            }

            // SEGURIDAD: No permitir que un admin se borre a sí mismo
            if (userId === req.session.adminId) {
                return res.status(400).render('error', {
                    title: 'Acción No Permitida',
                    message: 'No puedes eliminar tu propio usuario. Pide a otro administrador que lo haga.'
                });
            }

            await UserModel.deleteById(userId);
            logger.info(`Administrador '${req.session.adminUser}' eliminó usuario admin ID: ${userId}`);
            res.redirect('/admin/usuarios');
        } catch (err) {
            logger.error(`Error al eliminar usuario admin ID ${req.params.id}: ` + err.message, { error: err });
            res.status(500).render('error', {
                message: 'No se pudo eliminar el usuario.',
                title: 'Error'
            });
        }
    },

    // Exportar la utilidad de hash para el seeder
    HashUtil
};

module.exports = AuthController;

const { body, validationResult } = require('express-validator');
const RequestModel = require('../models/requestModel');
const CarModel = require('../models/carModel');
const logger = require('../config/logger');

const RequestController = {
    
    // Reglas de validación para el formulario de contacto (seguridad XSS)
    validateRequest: [
        body('nombre_cliente')
            .trim()
            .notEmpty().withMessage('El nombre es requerido.')
            .isLength({ min: 2, max: 100 }).withMessage('El nombre debe tener entre 2 y 100 caracteres.')
            .escape(),
        body('telefono_cliente')
            .trim()
            .notEmpty().withMessage('El teléfono es requerido.')
            .isLength({ min: 8, max: 20 }).withMessage('El teléfono debe tener entre 8 y 20 caracteres.')
            .escape(),
        body('email_cliente')
            .trim()
            .notEmpty().withMessage('El correo electrónico es requerido.')
            .isEmail().withMessage('El formato del correo electrónico no es válido.')
            .normalizeEmail(),
        body('mensaje')
            .optional()
            .trim()
            .isLength({ max: 1000 }).withMessage('El mensaje no puede superar los 1000 caracteres.')
            .escape(),
        body('coche_id')
            .optional()
            .custom(value => {
                if (value && isNaN(parseInt(value, 10))) {
                    throw new Error('ID de coche inválido.');
                }
                return true;
            })
    ],

    // --- ACCIONES PÚBLICAS ---

    // Mostrar formulario de solicitud
    async showRequestForm(req, res) {
        try {
            const cocheId = req.query.coche_id ? parseInt(req.query.coche_id, 10) : null;
            let coche = null;

            if (cocheId) {
                coche = await CarModel.getById(cocheId);
            }

            res.render('request-form', { 
                coche, 
                errors: [], 
                formData: {}, 
                title: 'Solicitud de Importación de Coche' 
            });
        } catch (err) {
            logger.error('Error al mostrar formulario de importación: ' + err.message, { error: err });
            res.status(500).render('error', { 
                message: 'No pudimos cargar el formulario. Intente de nuevo más tarde.',
                title: 'Error de Servidor'
            });
        }
    },

    // Enviar solicitud (Proceso)
    async submitRequest(req, res) {
        const errors = validationResult(req);
        const { coche_id, nombre_cliente, telefono_cliente, email_cliente, mensaje } = req.body;

        let coche = null;
        try {
            if (coche_id) {
                coche = await CarModel.getById(parseInt(coche_id, 10));
            }

            if (!errors.isEmpty()) {
                return res.render('request-form', {
                    coche,
                    errors: errors.array(),
                    formData: req.body,
                    title: 'Solicitud de Importación de Coche'
                });
            }

            // Crear solicitud
            await RequestModel.create({
                coche_id: coche_id ? parseInt(coche_id, 10) : null,
                nombre_cliente,
                telefono_cliente,
                email_cliente,
                mensaje
            });

            logger.info(`Nueva solicitud de importación recibida de ${nombre_cliente} (${email_cliente})`);
            res.render('request-form', {
                coche: null,
                errors: [],
                formData: {},
                success: true,
                title: '¡Solicitud Recibida!'
            });
        } catch (err) {
            logger.error('Error al enviar solicitud de importación: ' + err.message, { error: err });
            res.status(500).render('error', {
                message: 'Error al procesar su solicitud de importación. Inténtelo de nuevo más tarde.',
                title: 'Error de Solicitud'
            });
        }
    },

    // --- ACCIONES ADMINISTRATIVAS ---

    // Dashboard General (Resumen de beneficios y listado de solicitudes)
    async showDashboard(req, res) {
        try {
            const stats = await RequestModel.getFinancialSummary();
            const requests = await RequestModel.getAll();
            
            res.render('admin/dashboard', {
                stats,
                requests,
                title: 'Dashboard de Administración y Finanzas',
                adminUser: req.session.adminUser
            });
        } catch (err) {
            logger.error('Error al cargar dashboard: ' + err.message, { error: err });
            res.status(500).render('error', {
                message: 'Error al recuperar métricas del panel.',
                title: 'Error de Panel'
            });
        }
    },

    // Gestión detallada de un pedido y sus gastos
    async showRequestDetails(req, res) {
        try {
            const requestId = parseInt(req.params.id, 10);
            if (isNaN(requestId)) {
                return res.redirect('/admin/dashboard');
            }

            const request = await RequestModel.getById(requestId);
            if (!request) {
                return res.status(404).render('error', { 
                    message: 'El pedido solicitado no existe.', 
                    title: 'Pedido No Encontrado' 
                });
            }

            const expenses = await RequestModel.getExpenses(requestId);
            const totalExpenses = expenses.reduce((sum, exp) => sum + parseFloat(exp.monto), 0);
            const profit = request.precio_venta ? (parseFloat(request.precio_venta) - totalExpenses) : null;

            res.render('admin/requests', {
                request,
                expenses,
                totalExpenses,
                profit,
                title: `Pedido #${request.id} - Gestión`,
                adminUser: req.session.adminUser
            });
        } catch (err) {
            logger.error(`Error mostrando gestión de pedido ${req.params.id}: ` + err.message, { error: err });
            res.status(500).render('error', {
                message: 'Error al cargar detalles del pedido.',
                title: 'Error'
            });
        }
    },

    // Actualizar estado de aprobación del pedido
    async updateRequestStatus(req, res) {
        try {
            const requestId = parseInt(req.params.id, 10);
            const { estado } = req.body; // 'pendiente', 'aprobado', 'rechazado', 'completado'

            if (isNaN(requestId) || !['pendiente', 'aprobado', 'rechazado', 'completado'].includes(estado)) {
                return res.status(400).send('Parámetros inválidos');
            }

            const request = await RequestModel.getById(requestId);
            if (!request) {
                return res.status(404).send('Pedido no encontrado');
            }

            // Actualizar estado del pedido
            await RequestModel.updateStatus(requestId, estado);

            // Cambiar dinámicamente el estado del coche si está asociado
            if (request.coche_id) {
                let cocheEstado = 'disponible';
                if (estado === 'aprobado') {
                    cocheEstado = 'reservado';
                } else if (estado === 'completado') {
                    cocheEstado = 'vendido';
                } else if (estado === 'rechazado') {
                    cocheEstado = 'disponible';
                }
                await CarModel.updateStatus(request.coche_id, cocheEstado);
            }

            logger.info(`Administrador '${req.session.adminUser}' cambió estado de Pedido #${requestId} a '${estado}'`);
            res.redirect(`/admin/requests/${requestId}`);
        } catch (err) {
            logger.error(`Error al actualizar estado del pedido ${req.params.id}: ` + err.message, { error: err });
            res.status(500).render('error', { message: 'No se pudo actualizar el estado.', title: 'Error' });
        }
    },

    // Establecer precio de venta acordado
    async updateSalePrice(req, res) {
        try {
            const requestId = parseInt(req.params.id, 10);
            const { precio_venta } = req.body;

            if (isNaN(requestId) || isNaN(parseFloat(precio_venta))) {
                return res.status(400).send('Precio de venta inválido');
            }

            await RequestModel.updatePrice(requestId, parseFloat(precio_venta));
            logger.info(`Administrador '${req.session.adminUser}' actualizó precio de venta del Pedido #${requestId} a ${precio_venta}€`);
            res.redirect(`/admin/requests/${requestId}`);
        } catch (err) {
            logger.error(`Error al actualizar precio de venta en pedido ${req.params.id}: ` + err.message, { error: err });
            res.status(500).render('error', { message: 'No se pudo guardar el precio de venta.', title: 'Error' });
        }
    },

    // Añadir gasto al pedido
    async addExpense(req, res) {
        try {
            const requestId = parseInt(req.params.id, 10);
            const { concepto, monto } = req.body;

            if (isNaN(requestId) || !concepto || isNaN(parseFloat(monto))) {
                return res.status(400).send('Datos de gasto inválidos');
            }

            await RequestModel.addExpense(requestId, concepto.trim(), parseFloat(monto));
            logger.info(`Administrador '${req.session.adminUser}' añadió gasto '${concepto}' de ${monto}€ al Pedido #${requestId}`);
            res.redirect(`/admin/requests/${requestId}`);
        } catch (err) {
            logger.error(`Error al añadir gasto al pedido ${req.params.id}: ` + err.message, { error: err });
            res.status(500).render('error', { message: 'No se pudo añadir el gasto.', title: 'Error' });
        }
    },

    // Eliminar gasto
    async deleteExpense(req, res) {
        try {
            const requestId = parseInt(req.params.requestId, 10);
            const expenseId = parseInt(req.params.expenseId, 10);

            if (isNaN(requestId) || isNaN(expenseId)) {
                return res.status(400).send('Parámetros inválidos');
            }

            await RequestModel.deleteExpense(expenseId);
            logger.info(`Administrador '${req.session.adminUser}' eliminó gasto ID ${expenseId} del Pedido #${requestId}`);
            res.redirect(`/admin/requests/${requestId}`);
        } catch (err) {
            logger.error(`Error al eliminar gasto ${req.params.expenseId}: ` + err.message, { error: err });
            res.status(500).render('error', { message: 'No se pudo eliminar el gasto.', title: 'Error' });
        }
    }
};

module.exports = RequestController;

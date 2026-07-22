const { body, validationResult } = require('express-validator');
const SearchRequestModel = require('../models/searchRequestModel');
const logger = require('../config/logger');

const currentYear = new Date().getFullYear();
const ESTADOS_VALIDOS = ['pendiente', 'contactado', 'descartado', 'convertido'];

const SearchRequestController = {

    // Reglas de validación del wizard "Búsqueda a la Carta".
    // No se usa .escape() a propósito: EJS ya escapa en el render y aplicarlo
    // aquí además provocaría doble-codificación (ver mismo criterio en
    // requestController.js).
    validateSearchRequest: [
        body('marca_modelo')
            .trim()
            .notEmpty().withMessage('Indica la marca y modelo que buscas.')
            .isLength({ max: 150 }).withMessage('La marca/modelo es demasiado larga.'),
        body('ano_minimo')
            .optional({ checkFalsy: true })
            .trim()
            .isInt({ min: 1950, max: currentYear + 1 }).withMessage(`El año mínimo debe estar entre 1950 y ${currentYear + 1}.`),
        body('combustible')
            .optional({ checkFalsy: true })
            .trim()
            .isIn(['Gasolina', 'Diésel', 'Híbrido', 'Eléctrico']).withMessage('Combustible no válido.'),
        body('km_maximo')
            .optional({ checkFalsy: true })
            .trim()
            .isInt({ min: 0, max: 2000000 }).withMessage('El kilometraje máximo no es válido.'),
        body('presupuesto')
            .optional({ checkFalsy: true })
            .trim()
            .isFloat({ min: 0, max: 10000000 }).withMessage('El presupuesto no es válido.'),
        body('extras')
            .optional({ checkFalsy: true })
            .trim()
            .isLength({ max: 500 }).withMessage('Los extras no pueden superar los 500 caracteres.'),
        body('nombre_cliente')
            .trim()
            .notEmpty().withMessage('El nombre es requerido.')
            .isLength({ min: 2, max: 100 }).withMessage('El nombre debe tener entre 2 y 100 caracteres.'),
        body('telefono_cliente')
            .trim()
            .notEmpty().withMessage('El teléfono es requerido.')
            .isLength({ min: 8, max: 20 }).withMessage('El teléfono debe tener entre 8 y 20 caracteres.')
            .matches(/^[0-9+\s()-]+$/).withMessage('El teléfono contiene caracteres no válidos.'),
        body('email_cliente')
            .trim()
            .notEmpty().withMessage('El correo electrónico es requerido.')
            .isEmail().withMessage('El formato del correo electrónico no es válido.')
            .normalizeEmail()
    ],

    // --- ACCIONES PÚBLICAS ---

    async submitSearchRequest(req, res) {
        const errors = validationResult(req);

        try {
            if (!errors.isEmpty()) {
                return res.render('home', {
                    errors: errors.array(),
                    formData: req.body,
                    searchSuccess: false,
                    title: 'Luxe Imports - Importación de Coches a la Carta desde Alemania'
                });
            }

            const {
                marca_modelo, ano_minimo, combustible, km_maximo, presupuesto, extras,
                nombre_cliente, telefono_cliente, email_cliente
            } = req.body;

            await SearchRequestModel.create({
                marca_modelo,
                ano_minimo: ano_minimo ? parseInt(ano_minimo, 10) : null,
                combustible,
                km_maximo: km_maximo ? parseInt(km_maximo, 10) : null,
                presupuesto: presupuesto ? parseFloat(presupuesto) : null,
                extras,
                nombre_cliente,
                telefono_cliente,
                email_cliente
            });

            logger.info(`Nueva solicitud de búsqueda a la carta recibida de ${nombre_cliente} (${email_cliente})`);
            res.render('home', {
                errors: [],
                formData: {},
                searchSuccess: true,
                title: '¡Solicitud Recibida! - Luxe Imports'
            });
        } catch (err) {
            logger.error('Error al enviar solicitud de búsqueda a la carta: ' + err.message, { error: err });
            res.status(500).render('error', {
                message: 'Error al procesar su solicitud de búsqueda. Inténtelo de nuevo más tarde.',
                title: 'Error de Solicitud'
            });
        }
    },

    // --- ACCIONES ADMINISTRATIVAS ---

    async showAdminList(req, res) {
        try {
            const solicitudes = await SearchRequestModel.getAll();
            res.render('admin/search-requests', {
                solicitudes,
                title: 'Búsquedas a la Carta - Admin',
                adminUser: req.session.adminUser
            });
        } catch (err) {
            logger.error('Error al listar búsquedas a la carta en el admin: ' + err.message, { error: err });
            res.status(500).render('error', {
                message: 'Error al cargar el listado de búsquedas a la carta.',
                title: 'Error de Panel'
            });
        }
    },

    async updateStatus(req, res) {
        try {
            const solicitudId = parseInt(req.params.id, 10);
            const { estado } = req.body;

            if (isNaN(solicitudId) || !ESTADOS_VALIDOS.includes(estado)) {
                return res.status(400).send('Parámetros inválidos');
            }

            const updated = await SearchRequestModel.updateStatus(solicitudId, estado);
            if (!updated) {
                return res.status(404).send('Solicitud no encontrada');
            }

            logger.info(`Administrador '${req.session.adminUser}' cambió estado de Búsqueda #${solicitudId} a '${estado}'`);
            res.redirect('/admin/busquedas');
        } catch (err) {
            logger.error(`Error al actualizar estado de búsqueda ${req.params.id}: ` + err.message, { error: err });
            res.status(500).render('error', { message: 'No se pudo actualizar el estado.', title: 'Error' });
        }
    }
};

module.exports = SearchRequestController;

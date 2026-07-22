const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const CarModel = require('../models/carModel');
const logger = require('../config/logger');

// Firmas binarias ("magic bytes") de los formatos de imagen permitidos.
// La extensión y el MIME type declarados por el navegador son fácilmente
// falsificables; esta comprobación lee los primeros bytes reales del
// archivo ya guardado en disco para confirmar que es realmente una imagen
// del tipo declarado antes de aceptarlo (evita subir un script/webshell
// renombrado con extensión .jpg).
const FILE_SIGNATURES = [
    { ext: '.jpg', bytes: [0xff, 0xd8, 0xff] },
    { ext: '.jpeg', bytes: [0xff, 0xd8, 0xff] },
    { ext: '.png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { ext: '.webp', bytes: [0x52, 0x49, 0x46, 0x46] } // RIFF (WEBP se confirma en offset 8, comprobado aparte)
];

function isValidImageSignature(filePath, ext) {
    const signature = FILE_SIGNATURES.find(s => s.ext === ext);
    if (!signature) return false;

    const fd = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(12);
        const bytesRead = fs.readSync(fd, buffer, 0, 12, 0);
        if (bytesRead < signature.bytes.length) return false;

        const matchesHeader = signature.bytes.every((byte, i) => buffer[i] === byte);
        if (!matchesHeader) return false;

        if (ext === '.webp') {
            // RIFF....WEBP: confirmar la marca "WEBP" en el offset 8
            return buffer.toString('ascii', 8, 12) === 'WEBP';
        }
        return true;
    } finally {
        fs.closeSync(fd);
    }
}

function resolveWritableDirectory(candidatePaths) {
    for (const candidatePath of candidatePaths) {
        try {
            fs.mkdirSync(candidatePath, { recursive: true });
            fs.accessSync(candidatePath, fs.constants.W_OK);
            return candidatePath;
        } catch (err) {
            // Intentar con la siguiente ruta si no se puede escribir
        }
    }

    return candidatePaths[0];
}

const appRoot = path.resolve(__dirname, '..', '..');
const uploadDir = resolveWritableDirectory([
    path.join(appRoot, 'public', 'uploads'),
    path.join(process.cwd(), 'public', 'uploads'),
    '/tmp/luxe-imports-uploads'
]);

// Configuración de Multer Segura
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Nombre criptográfico aleatorio para evitar enumeración y Path Traversal
        const randomName = crypto.randomBytes(16).toString('hex');
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${randomName}${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    // Validar extensión
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    // Validar tipo MIME
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const mime = file.mimetype;

    if (allowedExtensions.includes(ext) && allowedMimeTypes.includes(mime)) {
        cb(null, true);
    } else {
        cb(new Error('Archivo no permitido. Solo se permiten imágenes (.jpg, .jpeg, .png, .webp).'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB por archivo
        files: 10 // Máximo 10 archivos por subida
    }
});

const currentYear = new Date().getFullYear();

const CarController = {
    // Exportar middleware de Multer
    uploadMiddleware: upload.array('imagenes', 10),

    // Reglas de validación para el alta de vehículos en el catálogo.
    // No se usa .escape() aquí por el mismo motivo que en RequestController:
    // EJS ya escapa en el render y aplicarlo dos veces corrompería el texto.
    validateCar: [
        body('marca').trim().notEmpty().withMessage('La marca es obligatoria.').isLength({ max: 50 }).withMessage('La marca es demasiado larga.'),
        body('modelo').trim().notEmpty().withMessage('El modelo es obligatorio.').isLength({ max: 50 }).withMessage('El modelo es demasiado largo.'),
        body('ano').trim().isInt({ min: 1950, max: currentYear + 1 }).withMessage(`El año debe estar entre 1950 y ${currentYear + 1}.`),
        body('kilometros').trim().isInt({ min: 0, max: 2000000 }).withMessage('Los kilómetros no son válidos.'),
        body('precio').trim().isFloat({ min: 0, max: 10000000 }).withMessage('El precio no es válido.'),
        body('motor').optional({ checkFalsy: true }).trim().isLength({ max: 50 }).withMessage('El motor es demasiado largo.'),
        body('potencia').optional({ checkFalsy: true }).trim().isLength({ max: 30 }).withMessage('La potencia es demasiado larga.'),
        body('combustible').optional({ checkFalsy: true }).trim().isIn(['Gasolina', 'Diésel', 'Híbrido', 'Eléctrico']).withMessage('Combustible no válido.'),
        body('transmision').optional({ checkFalsy: true }).trim().isIn(['Automático', 'Manual']).withMessage('Transmisión no válida.'),
        body('descripcion').optional({ checkFalsy: true }).trim().isLength({ max: 2000 }).withMessage('La descripción no puede superar los 2000 caracteres.')
    ],

    // --- VISTAS PÚBLICAS ---

    // Catálogo público con filtros
    async listCars(req, res) {
        try {
            const filters = {
                marca: req.query.marca || null,
                modelo: req.query.modelo || null,
                minPrecio: req.query.minPrecio || null,
                maxPrecio: req.query.maxPrecio || null,
                combustible: req.query.combustible || null,
                soloDisponibles: true // Clientes solo ven disponibles
            };

            const cars = await CarModel.getAll(filters);
            res.render('catalog', { 
                cars, 
                filters: req.query, 
                title: 'Catálogo Luxe Imports - Vehículos Premium de Alemania' 
            });
        } catch (err) {
            logger.error('Error al listar coches públicos: ' + err.message, { error: err });
            res.status(500).render('error', { 
                message: 'No pudimos cargar el catálogo. Intente de nuevo más tarde.',
                title: 'Error de Catálogo'
            });
        }
    },

    // Detalle de un coche
    async showCarDetails(req, res) {
        try {
            const carId = parseInt(req.params.id, 10);
            if (isNaN(carId)) {
                return res.status(400).render('error', { 
                    message: 'ID de coche inválido.', 
                    title: 'Coche No Encontrado' 
                });
            }

            const car = await CarModel.getById(carId);
            if (!car) {
                return res.status(404).render('error', { 
                    message: 'El coche solicitado no existe en nuestro catálogo.', 
                    title: 'Coche No Encontrado' 
                });
            }

            const images = await CarModel.getImages(carId);
            res.render('detail', { 
                car, 
                images, 
                title: `${car.marca} ${car.modelo} (${car.ano}) - Luxe Imports` 
            });
        } catch (err) {
            logger.error(`Error mostrando detalle del coche ${req.params.id}: ` + err.message, { error: err });
            res.status(500).render('error', { 
                message: 'Ha ocurrido un error al obtener la ficha técnica.',
                title: 'Error'
            });
        }
    },

    // --- VISTAS ADMINISTRATIVAS ---

    // Listado de coches en panel admin
    async showAdminCars(req, res) {
        try {
            const cars = await CarModel.getAll({ soloDisponibles: false });
            res.render('admin/cars', { 
                cars, 
                title: 'Gestionar Catálogo de Coches - Admin',
                adminUser: req.session.adminUser 
            });
        } catch (err) {
            logger.error('Error al mostrar coches en el admin: ' + err.message, { error: err });
            res.status(500).render('error', { 
                message: 'Error al cargar panel administrativo.',
                title: 'Error de Panel'
            });
        }
    },

    // Crear un coche en el catálogo
    async createCar(req, res) {
        // Utilidad local para limpiar del disco todos los archivos subidos
        // en esta petición si la validación falla en cualquier punto.
        const cleanupUploadedFiles = () => {
            if (req.files) {
                req.files.forEach(f => {
                    if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
                });
            }
        };

        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                cleanupUploadedFiles();
                return res.status(400).render('error', {
                    message: errors.array()[0].msg,
                    title: 'Error de Validación'
                });
            }

            if (!req.files || req.files.length === 0) {
                return res.status(400).render('error', {
                    message: 'Debes subir al menos una imagen del vehículo.',
                    title: 'Error de Validación'
                });
            }

            // Confirmar que cada archivo subido es realmente una imagen del
            // tipo declarado (defensa en profundidad frente a extensión/MIME falsificados).
            for (const file of req.files) {
                const ext = path.extname(file.filename).toLowerCase();
                if (!isValidImageSignature(file.path, ext)) {
                    cleanupUploadedFiles();
                    logger.warn(`Archivo con firma inválida rechazado (admin: ${req.session.adminUser}): ${file.originalname}`);
                    return res.status(400).render('error', {
                        message: 'Uno de los archivos subidos no es una imagen válida.',
                        title: 'Error de Validación'
                    });
                }
            }

            const {
                marca, modelo, ano, kilometros, precio,
                motor, potencia, combustible, transmision, descripcion
            } = req.body;

            // Mapear rutas de imágenes relativas
            const imageUrls = req.files.map(f => `/uploads/${f.filename}`);

            const carData = {
                marca,
                modelo,
                ano,
                kilometros,
                precio,
                motor,
                potencia,
                combustible,
                transmision,
                descripcion,
                estado: 'disponible'
            };

            await CarModel.create(carData, imageUrls);
            logger.info(`Administrador '${req.session.adminUser}' registró un coche: ${marca} ${modelo}`);
            res.redirect('/admin/cars');
        } catch (err) {
            logger.error('Error al crear coche desde panel admin: ' + err.message, { error: err });
            res.status(500).render('error', { 
                message: 'No se pudo guardar el coche en el catálogo.',
                title: 'Error'
            });
        }
    },

    // Eliminar un coche del catálogo
    async deleteCar(req, res) {
        try {
            const carId = parseInt(req.params.id, 10);
            if (isNaN(carId)) {
                return res.status(400).send('ID inválido');
            }

            // Obtener imágenes antes de borrar de base de datos para borrarlas del disco
            const images = await CarModel.getImages(carId);

            const deleted = await CarModel.delete(carId);
            if (deleted) {
                // Eliminar archivos del disco
                images.forEach(img => {
                    const relativeImagePath = (img.ruta_imagen || '').replace(/^\/+/, '');
                    const filePath = path.join(appRoot, 'public', relativeImagePath);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                });
                logger.info(`Administrador '${req.session.adminUser}' eliminó el coche ID: ${carId}`);
            }

            res.redirect('/admin/cars');
        } catch (err) {
            logger.error(`Error eliminando coche ID ${req.params.id}: ` + err.message, { error: err });
            res.status(500).render('error', { 
                message: 'No se pudo eliminar el coche.',
                title: 'Error'
            });
        }
    }
};

module.exports = CarController;

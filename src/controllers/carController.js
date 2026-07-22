const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const CarModel = require('../models/carModel');
const logger = require('../config/logger');

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
    '/tmp/web-coches-uploads'
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

const CarController = {
    // Exportar middleware de Multer
    uploadMiddleware: upload.array('imagenes', 10),

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
                title: 'Catálogo de Coches de Importación - Alemania a España' 
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
                title: `${car.marca} ${car.modelo} (${car.ano}) - Importación de Coches` 
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
        try {
            const { 
                marca, modelo, ano, kilometros, precio, 
                motor, potencia, combustible, transmision, descripcion 
            } = req.body;

            // Validar campos obligatorios
            if (!marca || !modelo || !ano || !kilometros || !precio) {
                // Borrar archivos subidos si falla la validación inicial
                if (req.files) {
                    req.files.forEach(f => fs.unlinkSync(f.path));
                }
                return res.status(400).render('error', { 
                    message: 'Faltan campos obligatorios para registrar el coche.',
                    title: 'Error de Validación'
                });
            }

            // Mapear rutas de imágenes relativas
            const imageUrls = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];

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

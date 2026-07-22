const logger = require('./config/logger');

function requireWithMessage(moduleName) {
    try {
        return require(moduleName);
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
            throw new Error(`Dependencia faltante: ${moduleName}. Ejecuta npm install en la carpeta del proyecto.`);
        }
        throw err;
    }
}

try {
    requireWithMessage('dotenv').config();
} catch (err) {
    logger.warn(err.message);
}

const express = requireWithMessage('express');
const path = require('path');
const fs = require('fs');
const session = requireWithMessage('express-session');
const helmet = requireWithMessage('helmet');
const rateLimit = requireWithMessage('express-rate-limit');
const crypto = require('crypto');
const CarController = require('./controllers/carController');
const RequestController = require('./controllers/requestController');
const AuthController = require('./controllers/authController');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';

// SEGURIDAD: en producción es obligatorio definir un SESSION_SECRET propio.
// Un valor por defecto embebido en el código permitiría a cualquiera que
// lea el repositorio falsificar sesiones de administrador.
if (isProduction && !process.env.SESSION_SECRET) {
    logger.error('SESSION_SECRET no está definido en producción. Abortando arranque por seguridad.');
    process.exit(1);
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Configurar trust proxy por estar tras un proxy inverso (Nginx) en LXC
app.set('trust proxy', 1);

// --- MEDIDAS DE SEGURIDAD ---

// 1. Cabeceras de seguridad HTTP con Helmet (CSP estricta, sin 'unsafe-inline':
//    todo el JS/CSS vive en archivos externos versionados, ver public/js/main.js)
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "https://unpkg.com"],
                styleSrc: ["'self'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                imgSrc: ["'self'", "data:", "blob:"],
                connectSrc: ["'self'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                frameAncestors: ["'self'"],
                upgradeInsecureRequests: [],
            },
        },
        xPoweredBy: false // Eliminar cabecera que delata tecnología Express
    })
);

// 2. Parsers de petición (con límite de tamaño explícito contra abuso de payloads)
app.use(express.urlencoded({ extended: true, limit: '200kb' }));
app.use(express.json({ limit: '200kb' }));

// 3. Servir archivos estáticos (Apuntando a la raíz fuera de /src)
app.use(express.static(path.join(__dirname, '..', 'public')));

// 4. Configurar motor de vistas (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 5. Configurar Sesiones de Express
app.use(
    session({
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        name: isProduction ? '__Secure-sess-id' : 'sess-id',
        cookie: {
            httpOnly: true, // Impedir lectura de cookies por JS del lado del cliente (mitiga XSS)
            secure: isProduction, // Solo HTTPS en producción
            sameSite: 'lax', // Protección ante ataques CSRF
            maxAge: 3 * 60 * 60 * 1000 // Expira en 3 horas
        }
    })
);

// 6. Generación y Exposición de Token CSRF
app.use((req, res, next) => {
    // Generar token CSRF para la sesión si no existe
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }

    // Exponer token y sesión en res.locals para que EJS los acceda directamente
    res.locals.csrfToken = req.session.csrfToken;
    res.locals.adminUser = req.session.adminUser || null;
    next();
});

// Middleware de verificación de CSRF en peticiones de modificación de estado (POST)
// Comparación en tiempo constante para evitar fugas de información por timing.
const csrfCheck = (req, res, next) => {
    if (req.method === 'POST') {
        // Aceptar token de body, query params (útil en multipart/form-data) o headers
        const tokenReceived = req.body?._csrf || req.query?._csrf || req.headers['x-csrf-token'];
        const tokenSession = req.session?.csrfToken;

        let valid = false;
        if (typeof tokenReceived === 'string' && typeof tokenSession === 'string' && tokenReceived.length === tokenSession.length) {
            valid = crypto.timingSafeEqual(Buffer.from(tokenReceived), Buffer.from(tokenSession));
        }

        if (!valid) {
            logger.warn(`Intento de violación CSRF detectado desde IP: ${req.ip}`);
            return res.status(403).render('error', {
                message: 'Petición rechazada debido a fallo de seguridad CSRF. Inténtelo de nuevo.',
                title: 'Error de Seguridad (CSRF)'
            });
        }
    }
    next();
};

// 7. Límites de frecuencia (rate limiting) a nivel de aplicación.
//    Complementan al límite de Nginx: protegen también en despliegues sin
//    proxy inverso delante (p. ej. entornos de desarrollo o pruebas directas).
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Demasiados intentos de acceso. Inténtalo de nuevo en unos minutos.',
    handler: (req, res, next, options) => {
        logger.warn(`Rate limit de login superado desde IP: ${req.ip}`);
        res.status(429).render('error', {
            message: options.message,
            title: 'Demasiados Intentos'
        });
    }
});

const formLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Has enviado demasiadas solicitudes. Inténtalo de nuevo más tarde.',
    handler: (req, res, next, options) => {
        logger.warn(`Rate limit de formulario público superado desde IP: ${req.ip}`);
        res.status(429).render('error', {
            message: options.message,
            title: 'Demasiadas Solicitudes'
        });
    }
});

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false
});
app.use(globalLimiter);

// --- DECLARACIÓN DE RUTAS ---

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'luxe-imports' });
});

// Rutas Públicas de Catálogo de Coches
app.get('/', CarController.listCars);
app.get('/coches/:id', CarController.showCarDetails);

// Rutas Públicas de Solicitudes (Pedidos)
app.get('/importar', RequestController.showRequestForm);
app.post('/importar', formLimiter, csrfCheck, RequestController.validateRequest, RequestController.submitRequest);

// Rutas de Autenticación Admin
app.get('/admin/login', AuthController.showLogin);
app.post('/admin/login', loginLimiter, csrfCheck, AuthController.login);
app.get('/admin/logout', AuthController.logout);

// Rutas de Panel de Administración Protegidas
app.get('/admin/dashboard', AuthController.requireAdmin, RequestController.showDashboard);

// Rutas de Gestión Financiera y Estados de Pedidos
app.get('/admin/requests/:id', AuthController.requireAdmin, RequestController.showRequestDetails);
app.post('/admin/requests/:id/status', AuthController.requireAdmin, csrfCheck, RequestController.updateRequestStatus);
app.post('/admin/requests/:id/price', AuthController.requireAdmin, csrfCheck, RequestController.updateSalePrice);
app.post('/admin/requests/:id/expenses', AuthController.requireAdmin, csrfCheck, RequestController.addExpense);
app.post('/admin/requests/:requestId/expenses/:expenseId/delete', AuthController.requireAdmin, csrfCheck, RequestController.deleteExpense);

// Rutas de Administración del Catálogo de Coches
app.get('/admin/cars', AuthController.requireAdmin, CarController.showAdminCars);

// Importante: uploadMiddleware va antes de csrfCheck para procesar multipart/form-data
app.post('/admin/cars', AuthController.requireAdmin, CarController.uploadMiddleware, csrfCheck, CarController.validateCar, CarController.createCar);

app.post('/admin/cars/:id/delete', AuthController.requireAdmin, csrfCheck, CarController.deleteCar);

// Rutas de Gestión de Usuarios Administradores
app.get('/admin/usuarios', AuthController.requireAdmin, AuthController.showUsersPage);
app.post('/admin/usuarios', AuthController.requireAdmin, csrfCheck, AuthController.createUser);
app.post('/admin/usuarios/:id/delete', AuthController.requireAdmin, csrfCheck, AuthController.deleteUser);

// --- MANEJO DE ERRORES GLOBAL ---

// Manejar 404 (No Encontrado)
app.use((req, res, next) => {
    res.status(404).render('error', {
        message: 'La página que busca no existe.',
        title: 'Página No Encontrada'
    });
});

// Manejador centralizado de errores
app.use((err, req, res, next) => {
    // Registrar el error real con detalles técnicos en logs/error.log
    logger.error(`${req.method} ${req.url} - Error interno: ${err.message}`, { 
        url: req.url,
        method: req.method,
        error: err,
        ip: req.ip 
    });

    // Enviar respuesta genérica sin fugar trazas de base de datos o sistema
    res.status(500).render('error', {
        message: 'Ha ocurrido un error inesperado en el servidor. Por favor, inténtelo de nuevo más tarde.',
        title: 'Error Interno del Servidor'
    });
});

// --- INICIO DEL SERVIDOR ---
const server = app.listen(PORT, HOST, () => {
    logger.info(`Servidor levantado en ${HOST}:${PORT} (entorno: ${process.env.NODE_ENV || 'production'})`);
});

server.on('error', (err) => {
    logger.error(`No se pudo iniciar el servidor en ${HOST}:${PORT}: ${err.message}`, { error: err });
    process.exit(1);
});

module.exports = app;

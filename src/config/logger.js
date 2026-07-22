let winston;
try {
    winston = require('winston');
} catch (err) {
    winston = null;
}

const path = require('path');
const fs = require('fs');

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
const logDir = resolveWritableDirectory([
    path.join(appRoot, 'logs'),
    path.join(process.cwd(), 'logs'),
    '/tmp/luxe-imports-logs'
]);

function createLoggerFallback() {
    return {
        info: (...args) => console.log(...args),
        warn: (...args) => console.warn(...args),
        error: (...args) => console.error(...args)
    };
}

const logger = winston ? winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            maxsize: 5242880,
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: path.join(logDir, 'combined.log'),
            maxsize: 5242880,
            maxFiles: 5,
        })
    ]
}) : createLoggerFallback();

if (winston && process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

module.exports = logger;

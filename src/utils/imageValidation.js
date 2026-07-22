const fs = require('fs');
const path = require('path');

// Firmas binarias ("magic bytes") de los formatos de imagen permitidos.
// La extensión y el MIME type declarados son fácilmente falsificables; esta
// comprobación lee los primeros bytes reales del archivo ya guardado en
// disco para confirmar que es realmente una imagen del tipo declarado
// (evita subir/importar un script/webshell renombrado con extensión .jpg).
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

module.exports = {
    FILE_SIGNATURES,
    isValidImageSignature,
    resolveWritableDirectory,
    uploadDir
};

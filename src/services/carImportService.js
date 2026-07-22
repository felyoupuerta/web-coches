const dns = require('dns').promises;
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const logger = require('../config/logger');
const { isValidImageSignature, uploadDir } = require('../utils/imageValidation');

// Portales de origen soportados para la importación de fichas de vehículo.
// Cualquier otro dominio se rechaza: es la primera barrera contra SSRF
// (el admin no puede hacer que el servidor pida una URL arbitraria).
const ALLOWED_LISTING_HOSTS = new Set([
    'www.autoscout24.de',
    'autoscout24.de',
    'www.autoscout24.com',
    'www.mobile.de',
    'mobile.de',
    'suchen.mobile.de'
]);

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 10000;
const MAX_HTML_BYTES = 6 * 1024 * 1024; // 6 MB
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_IMAGES = 8;
const MAX_REDIRECTS = 5;

const ALLOWED_IMAGE_CONTENT_TYPES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp'
};

class ImportError extends Error {}

// --- Protección SSRF: nunca hacer la petición contra una IP privada/interna,
// incluso si el hostname parece público (mitiga DNS rebinding). ---

function ipv4ToLong(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isPrivateIPv4(ip) {
    const long = ipv4ToLong(ip);
    const ranges = [
        ['0.0.0.0', '0.255.255.255'],
        ['10.0.0.0', '10.255.255.255'],
        ['100.64.0.0', '100.127.255.255'], // CGNAT
        ['127.0.0.0', '127.255.255.255'],
        ['169.254.0.0', '169.254.255.255'],
        ['172.16.0.0', '172.31.255.255'],
        ['192.0.0.0', '192.0.0.255'],
        ['192.168.0.0', '192.168.255.255'],
        ['198.18.0.0', '198.19.255.255'],
        ['224.0.0.0', '255.255.255.255'] // multicast / reservado
    ];
    return ranges.some(([start, end]) => long >= ipv4ToLong(start) && long <= ipv4ToLong(end));
}

function isPrivateIP(ip) {
    if (net.isIPv4(ip)) return isPrivateIPv4(ip);
    if (net.isIPv6(ip)) {
        const lower = ip.toLowerCase();
        if (lower === '::1') return true;
        if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
        if (lower.startsWith('::ffff:')) {
            const embedded = lower.split(':').pop();
            if (net.isIPv4(embedded)) return isPrivateIPv4(embedded);
        }
        return false;
    }
    return true; // formato desconocido: rechazar por precaución
}

async function assertPublicHost(hostname) {
    if (net.isIP(hostname)) {
        if (isPrivateIP(hostname)) {
            throw new ImportError('No se permiten direcciones IP privadas o internas.');
        }
        return;
    }
    let records;
    try {
        records = await dns.lookup(hostname, { all: true });
    } catch (err) {
        throw new ImportError(`No se pudo resolver el dominio ${hostname}.`);
    }
    if (records.length === 0 || records.some(r => isPrivateIP(r.address))) {
        throw new ImportError(`El dominio ${hostname} no es accesible públicamente.`);
    }
}

// Descarga con límite de tamaño, timeout, redirecciones re-validadas y
// cabeceras de navegador real (los portales de origen bloquean clientes
// HTTP "no-navegador" mediante protección anti-bot).
async function safeFetch(urlString, { maxBytes, requireAllowedHost }) {
    let current;
    try {
        current = new URL(urlString);
    } catch (err) {
        throw new ImportError('La URL proporcionada no es válida.');
    }

    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
        if (current.protocol !== 'https:') {
            throw new ImportError('Solo se permiten URLs HTTPS.');
        }
        const hostname = current.hostname.toLowerCase();
        if (requireAllowedHost && !ALLOWED_LISTING_HOSTS.has(hostname)) {
            throw new ImportError(`Portal no soportado (${hostname}). Portales admitidos: AutoScout24, mobile.de.`);
        }
        await assertPublicHost(hostname);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let response;
        try {
            response = await fetch(current.toString(), {
                redirect: 'manual',
                signal: controller.signal,
                headers: {
                    'User-Agent': BROWSER_UA,
                    'Accept-Language': 'de-DE,de;q=0.9,es;q=0.8'
                }
            });
        } catch (err) {
            throw new ImportError('No se pudo contactar con el sitio de origen (tiempo de espera agotado o dominio inaccesible).');
        } finally {
            clearTimeout(timer);
        }

        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (!location) throw new ImportError('Redirección sin destino recibida del sitio de origen.');
            current = new URL(location, current);
            continue;
        }

        if (!response.ok) {
            throw new ImportError(`El sitio de origen respondió con error (HTTP ${response.status}).`);
        }

        const declaredLength = parseInt(response.headers.get('content-length') || '0', 10);
        if (declaredLength && declaredLength > maxBytes) {
            throw new ImportError('La respuesta del sitio de origen supera el tamaño máximo permitido.');
        }

        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > maxBytes) {
                await reader.cancel();
                throw new ImportError('La respuesta del sitio de origen supera el tamaño máximo permitido.');
            }
            chunks.push(value);
        }

        return {
            buffer: Buffer.concat(chunks.map(c => Buffer.from(c))),
            contentType: response.headers.get('content-type') || '',
            finalUrl: current.toString()
        };
    }

    throw new ImportError('Demasiadas redirecciones al obtener la página de origen.');
}

// --- Extracción de datos estructurados (JSON-LD schema.org) ---

function collectLdJsonNodes(html) {
    const nodes = [];
    const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim());
            nodes.push(...(Array.isArray(parsed) ? parsed : [parsed]));
        } catch (err) {
            // Bloque JSON-LD no parseable: se ignora, no es crítico
        }
    }
    return nodes;
}

function hasType(node, typeName) {
    const t = node && node['@type'];
    if (!t) return false;
    const types = Array.isArray(t) ? t : [t];
    return types.some(x => String(x).toLowerCase() === typeName.toLowerCase());
}

function walkFind(node, predicate, depth = 0, seen = new Set()) {
    if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return null;
    seen.add(node);
    if (predicate(node)) return node;
    for (const key of Object.keys(node)) {
        const value = node[key];
        if (Array.isArray(value)) {
            for (const item of value) {
                const found = walkFind(item, predicate, depth + 1, seen);
                if (found) return found;
            }
        } else if (value && typeof value === 'object') {
            const found = walkFind(value, predicate, depth + 1, seen);
            if (found) return found;
        }
    }
    return null;
}

function mapCombustible(raw) {
    if (!raw) return null;
    const v = String(raw).toLowerCase();
    if (v.includes('elektro') || v.includes('electric')) return 'Eléctrico';
    if (v.includes('hybrid') || v.includes('híbrid')) return 'Híbrido';
    if (v.includes('diesel') || v.includes('diésel')) return 'Diésel';
    if (v.includes('benzin') || v.includes('gasolin') || v.includes('petrol') || v.includes('normal')) return 'Gasolina';
    return null;
}

function mapTransmision(raw) {
    if (!raw) return null;
    const v = String(raw).toLowerCase();
    if (v.includes('automat')) return 'Automático';
    if (v.includes('manual') || v.includes('schalt')) return 'Manual';
    return null;
}

function firstString(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return firstString(value[0]);
    if (typeof value === 'object' && value.name) return value.name;
    return null;
}

function extractYear(vehicleNode) {
    const raw = vehicleNode.productionDate || vehicleNode.vehicleModelDate || vehicleNode.releaseDate;
    if (!raw) return null;
    const match = String(raw).match(/(\d{4})/);
    return match ? parseInt(match[1], 10) : null;
}

function extractMileageKm(vehicleNode) {
    const odo = vehicleNode.mileageFromOdometer;
    if (!odo || typeof odo !== 'object' || odo.value == null) return null;
    const value = parseFloat(odo.value);
    if (isNaN(value)) return null;
    const unit = (odo.unitText || odo.unitCode || '').toLowerCase();
    if (unit.includes('mi') && !unit.includes('km')) return Math.round(value * 1.60934);
    return Math.round(value);
}

function extractEngine(vehicleNode) {
    let engine = vehicleNode.vehicleEngine;
    if (Array.isArray(engine)) engine = engine[0];
    if (!engine || typeof engine !== 'object') return { motor: null, potencia: null, combustible: null };

    let motor = null;
    if (engine.engineDisplacement && engine.engineDisplacement.value) {
        const liters = parseFloat(engine.engineDisplacement.value) / 1000;
        if (!isNaN(liters)) motor = `${liters.toFixed(1)}L`;
    }

    let potencia = null;
    let powerList = engine.enginePower;
    if (powerList && !Array.isArray(powerList)) powerList = [powerList];
    if (Array.isArray(powerList)) {
        const ps = powerList.find(p => ['PS', 'BHP', 'HP'].includes((p.unitCode || '').toUpperCase()));
        if (ps) potencia = `${Math.round(ps.value)} CV`;
    }

    const combustible = mapCombustible(engine.fuelType);
    return { motor, potencia, combustible };
}

// Dedupe de la galería por foto (no por listado): distintas URLs de la misma
// foto solo difieren en el sufijo de resolución "/AxB.ext" al final; se usa
// el resto de la URL como identidad y se conserva la variante de mayor
// resolución cuando hay varias (miniatura vs. foto grande).
function extractGalleryImages(html, seedUrls) {
    const byId = new Map();
    const consider = (url) => {
        if (typeof url !== 'string') return;
        const sizeMatch = url.match(/\/(\d{2,4})x(\d{2,4})\.(?:jpg|jpeg|webp|png)$/i);
        const key = sizeMatch ? url.slice(0, sizeMatch.index) : url;
        const score = sizeMatch ? parseInt(sizeMatch[1], 10) * parseInt(sizeMatch[2], 10) : 1;
        const existing = byId.get(key);
        if (!existing || score > existing.score) byId.set(key, { url, score });
    };

    seedUrls.filter(Boolean).forEach(consider);

    if (seedUrls.length > 0) {
        try {
            const host = new URL(seedUrls[0]).hostname.replace(/\./g, '\\.');
            const re = new RegExp(`https://${host}/[^"'\\s\\\\]+?\\.(?:jpg|jpeg|webp|png)`, 'gi');
            let match;
            while ((match = re.exec(html)) !== null && byId.size < MAX_IMAGES * 4) {
                consider(match[0]);
            }
        } catch (err) {
            // URL semilla inválida: nos quedamos solo con las imágenes del JSON-LD
        }
    }

    return Array.from(byId.values())
        .sort((a, b) => b.score - a.score)
        .map(v => v.url)
        .slice(0, MAX_IMAGES);
}

async function downloadAndStoreImage(imageUrl) {
    const { buffer, contentType } = await safeFetch(imageUrl, { maxBytes: MAX_IMAGE_BYTES, requireAllowedHost: false });
    const normalizedType = (contentType || '').split(';')[0].trim().toLowerCase();
    const ext = ALLOWED_IMAGE_CONTENT_TYPES[normalizedType];
    if (!ext) return null;

    const fileName = `${crypto.randomBytes(16).toString('hex')}${ext}`;
    const filePath = path.join(uploadDir, fileName);
    fs.writeFileSync(filePath, buffer);

    if (!isValidImageSignature(filePath, ext)) {
        fs.unlinkSync(filePath);
        return null;
    }
    return `/uploads/${fileName}`;
}

async function importFromUrl(sourceUrl) {
    const { buffer, finalUrl } = await safeFetch(sourceUrl, { maxBytes: MAX_HTML_BYTES, requireAllowedHost: true });
    const html = buffer.toString('utf-8');

    const roots = collectLdJsonNodes(html);
    let vehicleNode = null;
    let offerNode = null;
    for (const root of roots) {
        if (!vehicleNode) vehicleNode = walkFind(root, n => hasType(n, 'Car') || hasType(n, 'Vehicle'));
        if (!offerNode) offerNode = walkFind(root, n => hasType(n, 'Offer'));
    }

    if (!vehicleNode) {
        throw new ImportError('No se pudieron reconocer los datos del vehículo en esa página. Rellena el formulario manualmente.');
    }

    const marca = firstString(vehicleNode.manufacturer) || firstString(vehicleNode.brand);
    let modelo = firstString(vehicleNode.model);
    if (!modelo) {
        const name = firstString(vehicleNode.name) || '';
        modelo = marca ? name.replace(marca, '').trim() : name.trim();
    }

    const { motor, potencia, combustible: combustibleMotor } = extractEngine(vehicleNode);

    let precio = null;
    if (offerNode && offerNode.price != null) {
        const currency = (offerNode.priceCurrency || 'EUR').toUpperCase();
        if (currency === 'EUR') {
            const parsedPrice = parseFloat(offerNode.price);
            if (!isNaN(parsedPrice)) precio = parsedPrice;
        }
    }

    const descripcionPartes = [];
    if (vehicleNode.bodyType) descripcionPartes.push(`Carrocería: ${vehicleNode.bodyType}.`);
    if (vehicleNode.color) descripcionPartes.push(`Color exterior: ${vehicleNode.color}.`);
    if (vehicleNode.vehicleInteriorColor || vehicleNode.vehicleInteriorType) {
        descripcionPartes.push(`Interior: ${[vehicleNode.vehicleInteriorType, vehicleNode.vehicleInteriorColor].filter(Boolean).join(', ')}.`);
    }
    if (vehicleNode.numberOfDoors) descripcionPartes.push(`${vehicleNode.numberOfDoors} puertas.`);
    if (vehicleNode.seatingCapacity) descripcionPartes.push(`${vehicleNode.seatingCapacity} plazas.`);
    descripcionPartes.push(`Datos importados automáticamente el ${new Date().toLocaleDateString('es-ES')} desde: ${finalUrl}. Verifica todos los campos antes de publicar.`);

    const seedImages = [vehicleNode.image, offerNode && offerNode.itemOffered && offerNode.itemOffered.image]
        .flat()
        .filter(Boolean);
    const galleryUrls = extractGalleryImages(html, seedImages);

    const imagenes = [];
    for (const imgUrl of galleryUrls) {
        try {
            const saved = await downloadAndStoreImage(imgUrl);
            if (saved) imagenes.push(saved);
        } catch (err) {
            logger.warn(`No se pudo descargar imagen importada (${imgUrl}): ${err.message}`);
        }
    }

    return {
        marca: marca || null,
        modelo: modelo || null,
        ano: extractYear(vehicleNode),
        kilometros: extractMileageKm(vehicleNode),
        precio,
        motor,
        potencia,
        combustible: combustibleMotor,
        transmision: mapTransmision(vehicleNode.vehicleTransmission),
        descripcion: descripcionPartes.join(' '),
        imagenes,
        fuenteUrl: finalUrl
    };
}

module.exports = { importFromUrl, ImportError };

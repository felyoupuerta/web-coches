const logger = require('../config/logger');
const ChatbotModel = require('../models/chatbotModel');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.1.149:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

async function llamarOllama(prompt, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const resp = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, format: 'json' }),
            signal: controller.signal
        });
        if (!resp.ok) throw new Error(`Ollama respondió ${resp.status}`);
        const data = await resp.json();
        return data.response;
    } finally {
        clearTimeout(timer);
    }
}

const PROMPT_EXTRACCION = (pregunta) => `Eres un extractor de filtros de búsqueda de coches. 
Analiza la pregunta del cliente y responde ÚNICAMENTE con un JSON, sin texto adicional, con estas claves (omite las que no apliquen):
marca, modelo, ano_min (entero), precio_max (entero, euros), km_max (entero), combustible (Gasolina/Diésel/Híbrido/Eléctrico), transmision (Manual/Automático).
Pregunta del cliente: "${pregunta}"
JSON:`;

const PROMPT_RESPUESTA = (pregunta, coches) => `Eres el asistente de Luxe Imports, importadora de coches premium desde Alemania.
Responde en español, en 2-4 frases, de forma cercana y profesional, usando SOLO los datos del siguiente listado JSON. 
Si el listado está vacío, dilo con amabilidad y sugiere contactar para una "Búsqueda a la Carta".
No inventes coches ni datos que no estén en el listado.
Pregunta del cliente: "${pregunta}"
Coches disponibles: ${JSON.stringify(coches)}
Respuesta:`;

exports.chat = async (req, res) => {
    const { pregunta } = req.body;

    if (!pregunta || typeof pregunta !== 'string' || pregunta.length > 300) {
        return res.status(400).json({ error: 'Pregunta inválida.' });
    }

    try {
        // Paso 1: extraer filtros estructurados (nunca SQL)
        const jsonExtraido = await llamarOllama(PROMPT_EXTRACCION(pregunta));
        let filtros = {};
        try {
            filtros = JSON.parse(jsonExtraido);
        } catch {
            logger.warn(`Ollama devolvió JSON no parseable: ${jsonExtraido}`);
        }

        // Paso 2: consulta parametrizada contra tabla whitelisteada
        const coches = await ChatbotModel.buscarCoches(filtros);

        // Paso 3: redactar respuesta natural con los datos reales
        const respuesta = await llamarOllama(PROMPT_RESPUESTA(pregunta, coches));

        res.json({ respuesta: respuesta.trim(), resultados: coches.length });
    } catch (err) {
        logger.error(`Error en chatbot: ${err.message}`, { error: err });
        res.status(502).json({ error: 'El asistente no está disponible en este momento. Inténtalo de nuevo.' });
    }
};

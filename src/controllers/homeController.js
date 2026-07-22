const logger = require('../config/logger');

const HomeController = {
    // Landing de captación "Importación a la Carta"
    async showHome(req, res) {
        try {
            res.render('home', {
                errors: [],
                formData: {},
                searchSuccess: false,
                title: 'Luxe Imports - Importación de Coches a la Carta desde Alemania'
            });
        } catch (err) {
            logger.error('Error al mostrar la página de inicio: ' + err.message, { error: err });
            res.status(500).render('error', {
                message: 'No pudimos cargar la página de inicio. Intente de nuevo más tarde.',
                title: 'Error de Servidor'
            });
        }
    }
};

module.exports = HomeController;

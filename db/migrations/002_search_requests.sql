-- Migración: Solicitudes de Búsqueda "A la Carta"
-- Leads capturados desde el wizard de la landing (home.ejs), independientes
-- de solicitudes_importacion (que es para contactar sobre un coche ya
-- publicado en el catálogo).

CREATE TABLE IF NOT EXISTS `solicitudes_busqueda` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `marca_modelo` VARCHAR(150) NOT NULL,
    `ano_minimo` INT DEFAULT NULL,
    `combustible` VARCHAR(30) DEFAULT NULL,
    `km_maximo` INT DEFAULT NULL,
    `presupuesto` DECIMAL(12, 2) DEFAULT NULL,
    `extras` TEXT DEFAULT NULL,
    `nombre_cliente` VARCHAR(100) NOT NULL,
    `telefono_cliente` VARCHAR(30) NOT NULL,
    `email_cliente` VARCHAR(100) NOT NULL,
    `estado` VARCHAR(30) NOT NULL DEFAULT 'pendiente', -- 'pendiente', 'contactado', 'descartado', 'convertido'
    `creado_en` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE INDEX `idx_busqueda_estado` ON `solicitudes_busqueda` (`estado`);
CREATE INDEX `idx_busqueda_creado_en` ON `solicitudes_busqueda` (`creado_en`);

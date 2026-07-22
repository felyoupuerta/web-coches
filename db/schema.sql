-- Script de Inicialización de Base de Datos para MariaDB
-- Proyecto: Importación de Coches Alemania -> España
-- Creado: 2026-07-20

CREATE DATABASE IF NOT EXISTS `db_coches_matriz` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `db_coches_matriz`;

-- 1. Tabla de Usuarios Administradores
CREATE TABLE IF NOT EXISTS `usuarios_admin` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `usuario` VARCHAR(50) NOT NULL UNIQUE,
    `password_hash` VARCHAR(255) NOT NULL,
    `creado_en` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Tabla de Coches en Catálogo
CREATE TABLE IF NOT EXISTS `coches` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `marca` VARCHAR(50) NOT NULL,
    `modelo` VARCHAR(50) NOT NULL,
    `ano` INT NOT NULL,
    `kilometros` INT NOT NULL,
    `precio` DECIMAL(12, 2) NOT NULL,
    `motor` VARCHAR(50) DEFAULT NULL,
    `potencia` VARCHAR(30) DEFAULT NULL, -- Ej: '150 CV'
    `combustible` VARCHAR(30) DEFAULT NULL, -- Ej: 'Gasolina', 'Diésel', 'Híbrido'
    `transmision` VARCHAR(30) DEFAULT NULL, -- Ej: 'Manual', 'Automático'
    `descripcion` TEXT DEFAULT NULL,
    `estado` VARCHAR(30) DEFAULT 'disponible', -- 'disponible', 'reservado', 'vendido'
    `creado_en` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 3. Tabla de Imágenes Múltiples por Coche
CREATE TABLE IF NOT EXISTS `coche_imagenes` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `coche_id` INT NOT NULL,
    `ruta_imagen` VARCHAR(255) NOT NULL,
    `creado_en` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_coche_imagenes_coche` 
        FOREIGN KEY (`coche_id`) 
        REFERENCES `coches` (`id`) 
        ON DELETE CASCADE
) ENGINE=InnoDB;

-- 4. Tabla de Solicitudes de Importación (Pedidos)
CREATE TABLE IF NOT EXISTS `solicitudes_importacion` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `coche_id` INT DEFAULT NULL,
    `nombre_cliente` VARCHAR(100) NOT NULL,
    `telefono_cliente` VARCHAR(30) NOT NULL,
    `email_cliente` VARCHAR(100) NOT NULL,
    `mensaje` TEXT DEFAULT NULL,
    `estado` VARCHAR(30) DEFAULT 'pendiente', -- 'pendiente', 'aprobado', 'rechazado', 'completado'
    `precio_venta` DECIMAL(12, 2) DEFAULT NULL, -- Precio final acordado por el admin para el cliente
    `creado_en` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_solicitudes_coche` 
        FOREIGN KEY (`coche_id`) 
        REFERENCES `coches` (`id`) 
        ON DELETE SET NULL
) ENGINE=InnoDB;

-- 5. Tabla de Gastos por Pedido de Importación
CREATE TABLE IF NOT EXISTS `gastos_pedido` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `solicitud_id` INT NOT NULL,
    `concepto` VARCHAR(150) NOT NULL,
    `monto` DECIMAL(12, 2) NOT NULL,
    `creado_en` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_gastos_solicitud` 
        FOREIGN KEY (`solicitud_id`) 
        REFERENCES `solicitudes_importacion` (`id`) 
        ON DELETE CASCADE
) ENGINE=InnoDB;

-- Índices de Optimización de Búsqueda
CREATE INDEX `idx_coches_marca_modelo` ON `coches` (`marca`, `modelo`);
CREATE INDEX `idx_coches_precio` ON `coches` (`precio`);
CREATE INDEX `idx_coches_estado` ON `coches` (`estado`);
CREATE INDEX `idx_imagenes_coche` ON `coche_imagenes` (`coche_id`);
CREATE INDEX `idx_solicitudes_estado` ON `solicitudes_importacion` (`estado`);
CREATE INDEX `idx_gastos_solicitud` ON `gastos_pedido` (`solicitud_id`);

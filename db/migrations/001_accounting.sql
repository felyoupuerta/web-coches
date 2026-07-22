-- Migración 001: Módulo de Contabilidad
-- Añade libros de gastos e ingresos generales (no ligados a un vehículo)
-- y categoriza los gastos por pedido. 100% compatible hacia atrás:
-- las filas existentes de gastos_pedido reciben la categoría 'otros'.

-- 1. Categorizar los gastos por vehículo/pedido existentes
ALTER TABLE `gastos_pedido`
    ADD COLUMN IF NOT EXISTS `categoria` VARCHAR(30) NOT NULL DEFAULT 'otros' AFTER `concepto`;

-- 2. Libro de Gastos Generales (operativos, no imputables a un vehículo concreto)
CREATE TABLE IF NOT EXISTS `gastos_generales` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `categoria` VARCHAR(30) NOT NULL DEFAULT 'otros',
    `concepto` VARCHAR(150) NOT NULL,
    `monto` DECIMAL(12, 2) NOT NULL,
    `fecha` DATE NOT NULL,
    `notas` VARCHAR(255) DEFAULT NULL,
    `creado_por` VARCHAR(50) DEFAULT NULL,
    `creado_en` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 3. Libro de Ingresos Generales (señales, cobros y otros no derivados de una venta de catálogo)
CREATE TABLE IF NOT EXISTS `ingresos_generales` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `tipo` VARCHAR(30) NOT NULL DEFAULT 'otros',
    `concepto` VARCHAR(150) NOT NULL,
    `monto` DECIMAL(12, 2) NOT NULL,
    `fecha` DATE NOT NULL,
    `notas` VARCHAR(255) DEFAULT NULL,
    `creado_por` VARCHAR(50) DEFAULT NULL,
    `creado_en` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 4. Índices de optimización para los informes financieros
CREATE INDEX IF NOT EXISTS `idx_gastos_pedido_categoria` ON `gastos_pedido` (`categoria`);
CREATE INDEX IF NOT EXISTS `idx_gastos_generales_fecha` ON `gastos_generales` (`fecha`);
CREATE INDEX IF NOT EXISTS `idx_gastos_generales_categoria` ON `gastos_generales` (`categoria`);
CREATE INDEX IF NOT EXISTS `idx_ingresos_generales_fecha` ON `ingresos_generales` (`fecha`);
CREATE INDEX IF NOT EXISTS `idx_ingresos_generales_tipo` ON `ingresos_generales` (`tipo`);

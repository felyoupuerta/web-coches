#!/bin/bash

# ==============================================================================
# Script de despliegue automático para Luxe Imports
# ==============================================================================

# Detener el script si ocurre algún error no controlado
set -e

APP_DIR="/var/www/web-coches"
APP_NAME="luxe-imports"
DB_HOST="U-DBCO-01.edf.org"
DB_USER="atdb"
DB_NAME="db_luxe_imports"

echo "🚀 Iniciando despliegue de $APP_NAME..."
cd "$APP_DIR" || exit 1

# 1. Obtener cambios de Git
echo "📥 Descargando cambios desde origin/main..."
GIT_OUTPUT=$(git pull origin main)
echo "$GIT_OUTPUT"

# 2. Verificar e instalar dependencias si package.json cambió
if echo "$GIT_OUTPUT" | grep -q "package.json"; then
    echo "📦 Cambios detectados en package.json. Instalando dependencias..."
    npm install --omit=dev
else
    echo "📦 Sin cambios en package.json. Omitiendo npm install."
fi

# 3. Aplicar migración SQL si schema.sql cambió
if echo "$GIT_OUTPUT" | grep -q "db/schema.sql"; then
    echo "🗄️ Cambios detectados en db/schema.sql. Aplicando migración a MariaDB..."
    
    # Cargar DB_PASS desde el archivo .env si existe
    if [ -f .env ]; then
        DB_PASS=$(grep '^DB_PASS=' .env | cut -d '=' -f2-)
    fi

    if [ -n "$DB_PASS" ]; then
        mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < db/schema.sql
        echo "✅ Base de datos actualizada con éxito."
    else
        echo "⚠️ No se encontró DB_PASS en el .env. Aplica la migración manualmente."
    fi
fi

# 4. Comprobar y liberar el puerto 3000 si hay procesos huérfanos
echo "🔍 Verificando estado del proceso en PM2..."
if pm2 list | grep -q "$APP_NAME"; then
    echo "🔄 Reiniciando aplicación con PM2..."
    pm2 reload "$APP_NAME" || pm2 restart "$APP_NAME"
else
    echo "▶️ Iniciando aplicación por primera vez en PM2..."
    pm2 start src/app.js --name "$APP_NAME"
fi

# 5. Guardar estado de PM2
pm2 save > /dev/null 2>&1

echo "✨ ¡Despliegue completado con éxito para $APP_NAME!"
echo "📋 Mostrando últimos logs:"
pm2 logs "$APP_NAME" --lines 15 --raw | tail -n 15


#!/usr/bin/env bash
# ==============================================================================
# Script de Despliegue Automatizado - Luxe Imports - Portal Web
# Diseñado para Ubuntu Server 20.04 / 22.04 LTS
# ==============================================================================

# Colores para salida en consola
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # Sin color

echo -e "${BLUE}=======================================================${NC}"
echo -e "${BLUE}   INSTALACIÓN Y CONFIGURACIÓN AUTOMÁTICA DE LA WEB    ${NC}"
echo -e "${BLUE}=======================================================${NC}"

# 1. Comprobar que se está ejecutando en Linux
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo -e "Entorno compatible: ${GREEN}Linux detectado.${NC}"
else
    echo -e "${RED}Error: Este script debe ser ejecutado en un entorno Linux (Ubuntu Server).${NC}"
    exit 1
fi

# Obtener ruta absoluta de la aplicación
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR" || exit 1
echo -e "Directorio de la aplicación: ${YELLOW}$APP_DIR${NC}"

# 2. Actualizar paquetes del sistema
echo -e "\n${BLUE}[1/6] Actualizando listas de paquetes del sistema...${NC}"
sudo apt-get update -y

# 3. Instalar herramientas de compilación básicas si faltasen
echo -e "\n${BLUE}[2/6] Instalando dependencias del sistema (curl, build-essential)...${NC}"
sudo apt-get install -y curl build-essential git

# 4. Instalar Node.js v20 (LTS) desde NodeSource
if ! command -v node &> /dev/null; then
    echo -e "\n${BLUE}[3/6] Node.js no detectado. Instalando Node.js v20 LTS...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo -e "Instalación de Node.js completada: ${GREEN}$(node -v)${NC}"
else
    echo -e "\n${YELLOW}[3/6] Node.js ya está instalado en el sistema ($(node -v)). Omitiendo instalación.${NC}"
fi

# 5. Instalar PM2 (Process Manager) de forma global
if ! command -v pm2 &> /dev/null; then
    echo -e "\n${BLUE}[4/6] Instalando PM2 globalmente...${NC}"
    sudo npm install -g pm2
    echo -e "PM2 instalado correctamente: ${GREEN}$(pm2 -v)${NC}"
else
    echo -e "\n${YELLOW}[4/6] PM2 ya está instalado en el sistema ($(pm2 -v)). Omitiendo instalación.${NC}"
fi

# 6. Configurar la aplicación y dependencias
echo -e "\n${BLUE}[5/6] Instalando dependencias de producción de Node.js...${NC}"
npm install --only=production

# Asegurar la existencia de directorios necesarios con permisos adecuados
mkdir -p logs
mkdir -p public/uploads
chmod 755 logs
chmod 755 public/uploads

# Copiar .env si no existe
if [ ! -f .env ]; then
    echo -e "${YELLOW}Creando archivo de configuración .env a partir de .env.example...${NC}"
    cp .env.example .env
    echo -e "${RED}ATENCIÓN: Se ha creado un archivo .env por defecto.${NC}"
    echo -e "${RED}Por favor, edítalo con 'nano .env' para poner la IP de tu base de datos (10.0.30.50) y contraseña real.${NC}"
else
    echo -e "${GREEN}Archivo de configuración .env existente detectado. Manteniendo configuración.${NC}"
fi

# 7. Levantar la aplicación con PM2
echo -e "\n${BLUE}[6/6] Levantando el servicio en segundo plano con PM2...${NC}"

# Eliminar proceso PM2 anterior si existiese para evitar duplicados
pm2 delete luxe-imports &> /dev/null

# Iniciar aplicación
pm2 start src/app.js --name "luxe-imports"

# Configurar PM2 para que se levante tras reiniciar el sistema
pm2 save
PM2_STARTUP_CMD=$(pm2 startup | tail -n 1)

echo -e "\n${GREEN}=======================================================${NC}"
echo -e "${GREEN}      ¡INSTALACIÓN Y DESPLIEGUE INICIAL COMPLETADO!    ${NC}"
echo -e "${GREEN}=======================================================${NC}"
echo -e "El servidor web está corriendo internamente en el puerto ${YELLOW}3000${NC}."
echo -e "\nPara habilitar el inicio automático de la web al arrancar el servidor Ubuntu, ejecuta:"
echo -e "${YELLOW}$PM2_STARTUP_CMD${NC}"
echo -e "\n${BLUE}Siguientes pasos recomendados:${NC}"
echo -e "1. Modifica tus credenciales en el archivo de entorno: ${YELLOW}nano .env${NC}"
echo -e "2. Crea tu usuario administrador inicial con: ${YELLOW}npm run seed-admin <usuario> <contraseña>${NC}"
echo -e "3. Reinicia la aplicación tras configurar el .env: ${YELLOW}pm2 restart luxe-imports${NC}"
echo -e "4. Revisa los logs en caso de fallos: ${YELLOW}pm2 logs luxe-imports${NC} o ${YELLOW}cat logs/error.log${NC}"
echo -e "======================================================="

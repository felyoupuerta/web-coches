
 pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "Este script está pensado para Ubuntu/Debian en Linux." >&2
    exit 1
fi

if [[ ! -f .env ]]; then
    echo "No se encontró el archivo .env en $APP_DIR" >&2
    echo "Crea un .env con las variables necesarias" >&2
    exit 1
fi

echo "[1/8] Leyendo configuración desde .env..."
export $(grep -v '^#' .env | xargs)

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-atdb}"
DB_PASS="${DB_PASS:-}"
DB_NAME="${DB_NAME:-db_coches_matriz}"
PORT="${PORT:-3000}"
NODE_ENV="${NODE_ENV:-production}"
HOST="${HOST:-0.0.0.0}"
SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32 2>/dev/null || echo 'changeme')}"

export DEBIAN_FRONTEND=noninteractive

echo "[2/8] Actualizando paquetes del sistema..."
sudo apt-get update -y

echo "[3/8] Instalando dependencias base (Node.js, build tools, cliente MySQL)..."
sudo apt-get install -y ca-certificates curl gnupg git build-essential wget ufw mysql-client

if ! command -v node >/dev/null 2>&1; then
    echo "Instalando Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
    echo "Instalando PM2 globalmente..."
    sudo npm install -g pm2
fi

echo "[4/8] Verificando conexión a la base de datos remota..."
echo "Intentando conectar a ${DB_HOST}:${DB_PORT}..."
if mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASS}" -e "SELECT 1" >/dev/null 2>&1; then
    echo "✅ Conexión a la base de datos exitosa!"
else
    echo "⚠️  ADVERTENCIA: No se pudo conectar a la base de datos remota"
    echo "   Host: ${DB_HOST}"
    echo "   Puerto: ${DB_PORT}"
    echo "   Usuario: ${DB_USER}"
    echo "   Base de datos: ${DB_NAME}"
    echo ""
    echo "   Verifica que:"
    echo "   1. El servidor de BD esté encendido"
    echo "   2. El firewall permita conexiones en el puerto 3306"
    echo "   3. El usuario tenga permisos desde esta IP"
    echo "   4. Las credenciales sean correctas"
    echo ""
    read -p "¿Continuar de todas formas? (s/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Ss]$ ]]; then
        exit 1
    fi
fi

echo "[5/8] Instalando dependencias de Node.js..."
if [[ -f package.json ]]; then
    npm install --omit=dev
else
    echo "⚠️  No se encontró package.json en $APP_DIR"
    exit 1
fi

mkdir -p logs public/uploads
chmod 755 logs public/uploads

echo "[6/8] Importando esquema SQL (si existe)..."
if [[ -f db/schema.sql ]]; then
    echo "Importando esquema desde db/schema.sql..."
    if mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASS}" "${DB_NAME}" < db/schema.sql 2>/dev/null; then
        echo "✅ Esquema importado correctamente"
    else
        echo "⚠️  No se pudo importar el esquema SQL"
        echo "   Puedes importarlo manualmente con:"
        echo "   mysql -h ${DB_HOST} -u ${DB_USER} -p ${DB_NAME} < db/schema.sql"
    fi
fi

echo "[7/8] Verificando estructura del proyecto..."
if [[ ! -f src/app.js ]]; then
    echo "❌ ERROR: No se encuentra src/app.js"
    echo "   Asegúrate de estar en el directorio correcto"
    echo "   Directorio actual: $APP_DIR"
    ls -la
    exit 1
fi

echo "[8/8] Levantando la aplicación con PM2..."
pm2 delete web-coches >/dev/null 2>&1 || true

# Iniciar la aplicación con variables de entorno
PORT="$PORT" \
HOST="$HOST" \
NODE_ENV="$NODE_ENV" \
SESSION_SECRET="$SESSION_SECRET" \
DB_HOST="$DB_HOST" \
DB_PORT="$DB_PORT" \
DB_USER="$DB_USER" \
DB_PASS="$DB_PASS" \
DB_NAME="$DB_NAME" \
pm2 start src/app.js --name web-coches --cwd "$APP_DIR"

pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME" || true

if command -v ufw >/dev/null 2>&1; then
    echo "Configurando firewall..."
    sudo ufw allow 22/tcp
    sudo ufw allow ${PORT}/tcp
    sudo ufw --force enable
    sudo ufw status
fi

SERVER_IP="$(hostname -I | awk '{print $1}')"
if [[ -z "$SERVER_IP" ]]; then
    SERVER_IP="localhost"
fi

echo ""
echo "============================================================"
echo "¡Despliegue completado!"
echo ""
echo "📊 Información de la aplicación:"
echo "   URL de acceso: http://${SERVER_IP}:${PORT}"
echo "   URL local: http://localhost:${PORT}"
echo "   Health check: http://${SERVER_IP}:${PORT}/health"
echo ""
echo "📁 Base de datos remota:"
echo "   Host: ${DB_HOST}:${DB_PORT}"
echo "   Base de datos: ${DB_NAME}"
echo "   Usuario: ${DB_USER}"
echo ""
echo "🛠️  Comandos útiles:"
echo "   Ver logs: pm2 logs web-coches"
echo "   Reiniciar: pm2 restart web-coches"
echo "   Parar: pm2 stop web-coches"
echo "   Estado: pm2 status"
echo ""
echo "👤 Crear usuario administrador:"
echo "   npm run seed-admin <usuario> <contraseña>"
echo "============================================================"

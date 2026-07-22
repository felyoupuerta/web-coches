#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "Este script está pensado para Ubuntu/Debian en Linux." >&2
    exit 1
fi

if [[ ! -f .env ]]; then
    echo "No se encontró el archivo .env en $APP_DIR" >&2
    exit 1
fi

echo "[1/8] Leyendo configuración desde .env..."
eval "$(python3 - <<'PY'
import pathlib, shlex
env_path = pathlib.Path('.env')
data = {}
for raw in env_path.read_text(encoding='utf-8').splitlines():
    line = raw.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    data[key.strip()] = value.strip().strip('"').strip("'")
for key in ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASS', 'DB_NAME', 'PORT', 'NODE_ENV', 'SESSION_SECRET', 'HOST']:
    if key in data:
        print(f"{key}={shlex.quote(data[key])}")
PY
)"

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

echo "[3/8] Instalando dependencias base (Node.js, MariaDB, build tools)..."
sudo apt-get install -y ca-certificates curl gnupg git build-essential lsb-release wget mariadb-server ufw

if ! command -v node >/dev/null 2>&1; then
    echo "Instalando Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
    echo "Instalando PM2 globalmente..."
    sudo npm install -g pm2
fi

echo "[4/8] Habilitando y arrancando MariaDB..."
sudo systemctl enable mariadb >/dev/null 2>&1 || true
sudo systemctl start mariadb >/dev/null 2>&1 || true

echo "[5/8] Creando base de datos y usuario desde los valores del .env..."
sudo mariadb -e "CREATE DATABASE IF NOT EXISTS \\`${DB_NAME}\\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mariadb -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';"
sudo mariadb -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';"
sudo mariadb -e "GRANT ALL PRIVILEGES ON \\`${DB_NAME}\\`.* TO '${DB_USER}'@'localhost';"
sudo mariadb -e "GRANT ALL PRIVILEGES ON \\`${DB_NAME}\\`.* TO '${DB_USER}'@'127.0.0.1';"
sudo mariadb -e "FLUSH PRIVILEGES;"

if [[ -f db/schema.sql ]]; then
    echo "[6/8] Importando esquema SQL..."
    sudo mariadb "${DB_NAME}" < db/schema.sql
fi

mkdir -p logs public/uploads
chmod 755 logs public/uploads

echo "[7/8] Instalando dependencias de Node.js..."
npm install --omit=dev

echo "[8/8] Levantando la web con PM2 y habilitando reinicios..."
pm2 delete web-coches >/dev/null 2>&1 || true
PORT="$PORT" HOST="$HOST" NODE_ENV="$NODE_ENV" SESSION_SECRET="$SESSION_SECRET" pm2 start src/app.js --name web-coches --cwd "$APP_DIR"
pm2 save >/dev/null 2>&1 || true
pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null 2>&1 || true

if command -v ufw >/dev/null 2>&1; then
    sudo ufw allow 3000/tcp >/dev/null 2>&1 || true
    sudo ufw --force enable >/dev/null 2>&1 || true
fi

SERVER_IP="$(hostname -I | awk '{print $1}')"
if [[ -z "$SERVER_IP" ]]; then
    SERVER_IP="localhost"
fi

echo
echo "============================================================"
echo "¡Despliegue completado!"
echo "URL de acceso: http://${SERVER_IP}:${PORT}"
echo "URL local: http://localhost:${PORT}"
echo "Health check: http://${SERVER_IP}:${PORT}/health"
echo "Logs: pm2 logs web-coches"
echo "Reiniciar: pm2 restart web-coches"
echo "Parar: pm2 stop web-coches"
echo "Creadr Admin con: npm run seed-admin <usu> <pass>
echo "============================================================"

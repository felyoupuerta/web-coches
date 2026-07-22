# Guía de Despliegue Seguro: Luxe Imports - Portal de Importación Premium de Vehículos

Esta guía detalla la configuración y despliegue en producción de la aplicación web sobre un entorno **Ubuntu Server** en contenedores **LXC en Proxmox**, utilizando una arquitectura de red segmentada para máxima seguridad informática.

## 0. Resumen de Medidas de Seguridad Implementadas

- **CSRF**: token de 32 bytes por sesión, comparado en tiempo constante en cada `POST`.
- **Contraseñas**: hash `scrypt` con verificación en tiempo constante (`crypto.timingSafeEqual`); nunca en texto plano.
- **Sesiones**: cookies `httpOnly`, `secure` en producción, `sameSite=lax`, expiración a las 3 horas.
- **CSP estricta**: sin `'unsafe-inline'` en `script-src` ni `style-src` (todo el JS/CSS vive en archivos externos versionados).
- **SQL**: consultas 100% parametrizadas (`mysql2` con placeholders `?`), sin concatenación de strings.
- **Subida de archivos**: nombre aleatorio, validación de extensión, MIME **y firma binaria real** del archivo (para detectar extensiones falsificadas).
- **Rate limiting**: límites de intentos en `/admin/login` y en el formulario público `/importar`, además del límite general de Nginx.
- **Arranque seguro**: la app se niega a iniciar en producción si falta `SESSION_SECRET`.
- **Registro (logging)**: los errores técnicos van al log interno (`logs/error.log`); el usuario final nunca ve trazas de base de datos ni del sistema.

---

## 1. Arquitectura de Red en Proxmox

Para cumplir con las directrices de seguridad (aislamiento de datos), se configuran dos contenedores LXC segmentados mediante VLANs o puentes de red virtuales en Proxmox VE:

1. **LXC Web Server (Público/DMZ)**:
   - IP Pública o IP interna tras un proxy inverso expuesto (`10.0.30.10` en red local).
   - Acceso a internet para instalar dependencias y resolver nombres.
   - Aloja la aplicación Node.js en puerto `3000`.

2. **LXC Database Server (Red Interna Aislada)**:
   - IP fija interna en el rango privado (`10.0.30.50`).
   - **Sin acceso a internet (sin pasarela/gateway configurada)** y bloqueado en el firewall de Proxmox para tráfico entrante y saliente externo.
   - Solo acepta tráfico TCP entrante en el puerto `3306` originado desde la IP del Servidor Web (`10.0.30.10`).

---

## 2. Preparación del LXC de Base de Datos (MariaDB)

Acceda a la consola del contenedor MariaDB (IP `10.0.30.50`) y ejecute:

### Instalar MariaDB
```bash
sudo apt update && sudo apt install -y mariadb-server
```

### Configurar Enlace de Red
Edite el archivo `/etc/mysql/mariadb.conf.d/50-server.cnf` para que MariaDB escuche en su interfaz interna:
```ini
bind-address = 10.0.30.50
```

### Inicializar y Asegurar la DB
Ejecute el script de seguridad inicial:
```bash
sudo mysql_secure_installation
```
*(Siga los pasos para establecer clave de root, deshabilitar logins remotos de root, eliminar base de datos de test y usuarios anónimos).*

### Crear Base de Datos y Credenciales para el Servidor Web
Acceda a la consola SQL:
```bash
sudo mysql -u root -p
```
Ejecute las siguientes sentencias SQL para crear la DB y el usuario con acceso exclusivo desde el LXC Web (`10.0.30.10`):
```sql
CREATE DATABASE db_luxe_imports CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Crear usuario con permisos limitados y enlazado a la IP del Servidor Web
CREATE USER 'luxe_user'@'10.0.30.10' IDENTIFIED BY 'UnPasswordAltamenteSeguro123$!';

-- Otorgar privilegios mínimos necesarios para la aplicación
GRANT SELECT, INSERT, UPDATE, DELETE ON db_luxe_imports.* TO 'luxe_user'@'10.0.30.10';

FLUSH PRIVILEGES;
EXIT;
```

### Cargar la Estructura Inicial (Schema)
Copie el contenido del archivo `db/schema.sql` y ejecútelo para inicializar las tablas:
```bash
mysql -u root -p db_luxe_imports < db/schema.sql
```

---

## 3. Preparación del LXC del Servidor Web (Node.js)

Acceda a la consola del contenedor del Servidor Web (IP `10.0.30.10`).

### Instalar Node.js y Git
Instale la versión activa de Node.js (LTS):
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git build-essential
```

### Clonar la Aplicación
Clone el código fuente en el directorio `/var/www/luxe-imports`:
```bash
sudo mkdir -p /var/www/luxe-imports
sudo chown -R $USER:$USER /var/www/luxe-imports
cd /var/www/luxe-imports
# Copiar el código fuente del proyecto a este directorio
```

### Instalar Dependencias de Producción
```bash
npm install --only=production
```

### Configurar Variables de Entorno
Copie la plantilla de configuración y edítela:
```bash
cp .env.example .env
nano .env
```
Establezca las credenciales reales que configuró en el LXC de la base de datos:
```env
PORT=3000
NODE_ENV=production
LOG_LEVEL=error

DB_HOST=10.0.30.50
DB_PORT=3306
DB_USER=luxe_user
DB_PASS=UnPasswordAltamenteSeguro123$!
DB_NAME=db_luxe_imports

SESSION_SECRET=un_secreto_largo_y_aleatorio_generado_con_openssl_rand_hex_32
```
> **Importante:** en `NODE_ENV=production` la aplicación se niega a arrancar si `SESSION_SECRET` no está definido (evita el uso accidental de un secreto por defecto embebido en el código). Genera uno real con `openssl rand -hex 32`.

### Aplicar Migraciones de Base de Datos
Sobre una base de datos ya existente (por ejemplo, al actualizar una instalación anterior), aplique las migraciones pendientes. El runner es idempotente y registra cada migración aplicada en la tabla `_migraciones`, por lo que puede ejecutarse con seguridad tantas veces como haga falta:
```bash
npm run migrate
```
> En instalaciones nuevas cargadas con `db/schema.sql` no es necesario: el esquema ya incluye las tablas del módulo de contabilidad (`gastos_generales`, `ingresos_generales`) y la columna `categoria` de `gastos_pedido`.

### Crear el Usuario Administrador Inicial
Ejecute el script de sembrado para crear las credenciales seguras de acceso al panel de control:
```bash
npm run seed-admin admin MiPasswordAdminSeguro2026$
```

---

## 4. Persistencia del Servicio (PM2 o Systemd)

Para garantizar que la aplicación Node.js siga activa tras reinicios del servidor LXC, elija una de las dos opciones siguientes:

### Opción A: Despliegue con PM2 (Recomendado por simplicidad)
Instale el gestor de procesos globalmente:
```bash
sudo npm install -g pm2
```
Inicie la aplicación y configure el reinicio automático del sistema:
```bash
pm2 start src/app.js --name "luxe-imports"
pm2 save
pm2 startup
```
*(Copie y ejecute el comando en pantalla que genere `pm2 startup` para activar el servicio de systemd).*

### Opción B: Servicio Nativo de Systemd
Cree un archivo de servicio en `/etc/systemd/system/luxe-imports.service`:
```ini
[Unit]
Description=Servidor Web Importacion de Coches
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/luxe-imports
ExecStart=/usr/bin/node src/app.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```
Habilite e inicie el servicio:
```bash
sudo systemctl daemon-reload
sudo systemctl enable luxe-imports
sudo systemctl start luxe-imports
```

---

## 5. Configuración de Seguridad en el Proxy Inverso (Nginx)

El proxy inverso se coloca en la frontera de la DMZ (puede ser el mismo LXC Web expuesto o un gateway específico).

Instale Nginx y certbot para SSL:
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Cree un archivo de configuración del sitio en `/etc/nginx/sites-available/coches` (y enlácelo a `sites-enabled`):
```nginx
# Limitación de peticiones para mitigar ataques DDoS y fuerza bruta (Rate Limiting)
limit_req_zone $binary_remote_addr zone=ddos_limit:10m rate=15r/s;
limit_req_zone $binary_remote_addr zone=login_limit:10m rate=3r/m;

server {
    listen 80;
    server_name tu-dominio-importacion.com www.tu-dominio-importacion.com;
    
    # Redirigir todo el tráfico HTTP a HTTPS seguro
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name tu-dominio-importacion.com www.tu-dominio-importacion.com;

    # Directorio Raíz de Archivos Estáticos (CSS, JS, Imágenes)
    root /var/www/luxe-imports/public;

    # Certificados SSL (Generados por Let's Encrypt Certbot)
    ssl_certificate /etc/letsencrypt/live/tu-dominio-importacion.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tu-dominio-importacion.com/privkey.pem;
    
    # Configuración SSL fuerte (Seguridad OWASP)
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384';
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # Cabeceras de Seguridad Nginx complementarias
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    # Nota: la aplicación Node ya envía su propia CSP estricta vía Helmet
    # (ver src/app.js). Esta cabecera de Nginx debe mantenerse alineada con
    # esa política -sin 'unsafe-inline'- para evitar configuraciones
    # contradictorias entre capas.
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:;" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    # Directorio de subida de imágenes - BLOQUEAR EJECUCIÓN DE SCRIPTS
    # Evita que se ejecuten scripts inyectados (ej. webshells en php o js) en el servidor
    location ~* ^/uploads/.*\.(php|pl|py|jsp|sh|cgi|asp|aspx|js)$ {
        deny all;
        access_log off;
        log_not_found off;
    }

    # Servir archivos subidos (Imágenes) directamente por Nginx para mayor eficiencia
    location /uploads/ {
        alias /var/www/luxe-imports/public/uploads/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }

    # Proxy de peticiones al servidor Express Node.js
    location / {
        limit_req zone=ddos_limit burst=30 nodelay;
        
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Límite más estricto para el login de administración
    location /admin/login {
        limit_req zone=login_limit burst=5;
        proxy_pass http://127.0.0.1:3000;
        # Resto de configuraciones del proxy
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Habilite la configuración y reinicie Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/coches /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```
Obtenga el certificado Let's Encrypt automáticamente:
```bash
sudo certbot --nginx -d tu-dominio-importacion.com -d www.tu-dominio-importacion.com
```

---

## 6. Mantenimiento y Logs Internos

La aplicación no muestra fallos de base de datos a los usuarios en pantalla (muestra una página amigable genérica). Para diagnosticar problemas o comprobar ataques, consulte el archivo de logs:

- Ver logs detallados del servidor Node:
  ```bash
  cat /var/www/luxe-imports/logs/error.log
  ```
- Ver logs de PM2:
  ```bash
  pm2 logs luxe-imports
  ```
- Ver logs del servicio Systemd:
  ```bash
  journalctl -u luxe-imports -n 100 --no-pager
  ```

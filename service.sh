#!/bin/bash

# ==============================================================================
# Script de gestión de servicio para Luxe Imports
# Uso: ./service.sh {start|stop|restart|reload|status|logs}
# ==============================================================================

APP_DIR="/var/www/web-coches"
APP_NAME="luxe-imports"
PORT=3000

cd "$APP_DIR" || exit 1

check_port() {
    # Liberar puerto 3000 si hay procesos huérfanos
    PID=$(lsof -t -i:$PORT 2>/dev/null)
    if [ -n "$PID" ]; then
        echo "⚠️ El puerto $PORT está ocupado por el PID $PID. Liberando..."
        kill -9 "$PID" 2>/dev/null || true
    fi
}

case "$1" in
    start)
        echo "▶️ Iniciando $APP_NAME..."
        check_port
        pm2 start "$APP_DIR/src/app.js" --name "$APP_NAME"
        pm2 save > /dev/null 2>&1
        echo "✅ Servicio iniciado correctamente."
        ;;

    stop)
        echo "⏹️ Deteniendo $APP_NAME..."
        pm2 stop "$APP_NAME" 2>/dev/null || true
        pm2 delete "$APP_NAME" 2>/dev/null || true
        check_port
        pm2 save > /dev/null 2>&1
        echo "🛑 Servicio detenido."
        ;;

    restart)
        echo "🔄 Reiniciando $APP_NAME..."
        pm2 delete "$APP_NAME" 2>/dev/null || true
        check_port
        pm2 start "$APP_DIR/src/app.js" --name "$APP_NAME"
        pm2 save > /dev/null 2>&1
        echo "✅ Servicio reiniciado."
        ;;

    reload)
        echo "♻️ Realizando reload Zero-Downtime para $APP_NAME..."
        if pm2 list | grep -q "$APP_NAME"; then
            pm2 reload "$APP_NAME"
        else
            $0 start
        fi
        ;;

    status)
        echo "📊 Estado de PM2:"
        pm2 list
        echo ""
        echo "🔍 Verificando respuesta en puerto $PORT:"
        curl -I http://127.0.0.1:$PORT 2>/dev/null | head -n 5 || echo "❌ No hay respuesta en el puerto $PORT (posible 502 Bad Gateway)"
        ;;

    logs)
        pm2 logs "$APP_NAME" --lines 30
        ;;

    *)
        echo "Uso: $0 {start|stop|restart|reload|status|logs}"
        exit 1
        ;;
esac

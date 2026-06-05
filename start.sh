#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$SCRIPT_DIR/backend"
FRONTEND="$SCRIPT_DIR/frontend"

echo "========================================"
echo "  Dashboard de Inteligencia de Inversiones"
echo "========================================"

# Kill existing processes on our ports
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

echo "→ Iniciando backend en puerto 8000..."
cd "$BACKEND"
PATH="$HOME/Library/Python/3.9/bin:$PATH" python3 main.py &
BACKEND_PID=$!

sleep 3

echo "→ Iniciando frontend en puerto 3000..."
cd "$FRONTEND"
npx vite &
FRONTEND_PID=$!

echo ""
echo "✅ Dashboard disponible en: http://localhost:3000"
echo "   Backend API:             http://localhost:8000"
echo ""
echo "Presiona Ctrl+C para detener todos los servicios."

trap "echo 'Deteniendo servicios...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM

wait

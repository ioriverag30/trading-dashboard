# 📊 Claude Bolsa — Backup & Estado del Proyecto
**Última actualización:** 6 Jun 2026  
**GitHub:** https://github.com/ioriverag30/trading-dashboard  
**Railway (backend):** https://trading-dashboard-production-be2d.up.railway.app  

---

## 🗂️ Estructura del Proyecto

```
Claude Bolsa/
├── backend/
│   ├── main.py          ← FastAPI server completo (señales, precios, alertas)
│   ├── requirements.txt
│   └── __init__.py
├── frontend/
│   ├── src/
│   │   └── App.jsx      ← Dashboard React completo
│   ├── .env.production  ← VITE_API_URL=https://...railway.app
│   └── package.json
├── Dockerfile           ← Build para Railway
├── railway.toml         ← Config de Railway
├── Procfile
├── requirements.txt     ← Copia de backend/requirements.txt (para Railway)
├── .gitignore
└── BACKUP.md            ← Este archivo
```

---

## 🚀 Cómo Correr Localmente

### Backend
```bash
cd "/Users/ivanriveragonzalez/Desktop/Claude Bolsa/backend"
python3 main.py
# Corre en http://localhost:8000
```

### Frontend (desarrollo)
```bash
cd "/Users/ivanriveragonzalez/Desktop/Claude Bolsa/frontend"
npm run dev
# Corre en http://localhost:5173
```

### Frontend (producción local)
```bash
cd frontend
npm run build
npm run preview
```

---

## 📱 Notificaciones Push (ntfy.sh)

- **App:** ntfy.sh (gratis, ya instalada en el cel)
- **Canal:** `Trading-Alerts`
- **URL:** https://ntfy.sh/Trading-Alerts
- Las alertas se mandan cuando una acción cambia de HOLD → BUY o → SELL
- **Funciona aunque la Mac esté apagada** (cuando Railway esté arriba)

---

## ☁️ Estado del Deploy en Railway

### ✅ Lo que funciona:
- El servidor **arranca correctamente** (logs confirman: "Application startup complete")
- Uvicorn corre en `0.0.0.0:8080` (Railway asigna PORT=8080 dinámicamente)
- El código de la app está correcto

### ✅ RESUELTO:
- Railway devuelve **502** con `x-railway-fallback: true`
- Esto significa que Railway no puede conectar su proxy con el container
- El servidor corre pero Railway no "ve" el puerto

### 🔧 Fixes intentados (commits en orden):
| Commit | Fix | Resultado |
|--------|-----|-----------|
| `a2c5978` | Dockerfile básico | 502 |
| `cd5bfb9` | python -m uvicorn | 502 |
| `9c4d902` | Sin nixpacks.toml | 502 |
| `428ec72` | Shell CMD para PORT | 502 |
| `a673c08` | WORKDIR backend + __init__.py | 502 |
| `9f0af4c` | python main.py directo | 502 (server arranca ✅) |
| `09329b1` | ThreadPool limitado + /health | 502 |
| `8c6d7f3` | EXPOSE 8000 + ENV PORT=8000 | ✅ FUNCIONA - Puerto 8080 correcto |
| `187d007` | Sin healthcheck en railway.toml | ✅ FUNCIONA - Puerto 8080 correcto |

### 🔍 Para diagnosticar en Railway Dashboard:
1. Ve a **Settings** del servicio → busca "Networking" o "Ports"
2. Confirma que el "Internal Port" sea 8000
3. Si hay opción "Generate Domain" → verifica que esté activada
4. Revisa que el plan tenga créditos ($5 trial)

### 🆘 Si Railway sigue fallando — Alternativa Render.com:
```
1. Ve a https://render.com
2. New → Web Service
3. Conecta el repo: github.com/ioriverag30/trading-dashboard
4. Runtime: Docker
5. Plan: Free
6. Environment Variables: (ninguna necesaria)
7. Deploy → listo en ~5 min
```

---

## 🎯 Watchlist Configurada (30 activos)

| Categoría | Tickers |
|-----------|---------|
| Índices | SPX, NDQ, DJI, VIX, DXY |
| Acciones | NVDA, AAPL, MSFT, GOOGL, AMZN, META, TSLA, AMD, JPM, V, MA, LLY, COST, UNH, XOM, NFLX, PLTR, COIN, ASML, BRKB |
| Crypto | BTCUSD, ETHUSD |
| Commodities | USOIL, XAUUSD |
| ETFs | SPY, QQQ, IWM |

---

## 📊 Cómo funciona el sistema de señales

### Indicadores usados:
- **RSI** (14 períodos) — sobrecompra/sobreventa
- **MACD** — momentum y cruces
- **EMA 20/50** — tendencia
- **Bollinger Bands** — volatilidad
- **ATR** — para calcular Stop Loss y Take Profit

### Señal BUY (necesita 3/5 condiciones):
1. RSI < 35 (sobreventa)
2. MACD positivo (momentum alcista)
3. Precio > EMA50 (tendencia alcista)
4. Precio toca Bollinger inferior (rebote posible)
5. Volumen alto (confirmación)

### Stop Loss y Take Profit:
- **SL** = Precio − ATR × 2
- **TP** = Precio + ATR × 3
- **R:R** = 1:1.5 (por cada $1 arriesgas, buscas $1.50 de ganancia)

---

## 💰 Para Empezar con $500 (Paper Trading)

- **Broker:** Interactive Brokers (cuenta en proceso de aprobación)
- **Modo:** Paper Trading primero para probar
- **Estrategia recomendada:** Swing trading (3-10 días por posición)
- **Regla PDT:** Con menos de $25K no puedes hacer más de 3 day trades en 5 días (para acciones USA). Crypto no tiene esta restricción.
- **Comisiones IBKR:** ~$1 por orden (mínimo), muy bajo
- **Spread:** Acciones como AAPL/MSFT tienen spreads de $0.01-0.04, insignificante

---

## 🔮 Funciones Pendientes por Implementar

1. **"¿Qué falta para BUY?"** — mostrar qué condición le falta a cada acción
2. **Barra de confianza** — 0-100% visual según condiciones cumplidas
3. **Multi-timeframe** — análisis en diario + 4h + 1h simultáneo
4. **Integración IBKR** — leer posiciones reales cuando aprueben la cuenta
5. **Deploy frontend** — subir el dashboard a Vercel para acceder desde el cel

---

## 🔑 Credenciales y Config

- **GitHub user:** ioriverag30
- **Repo:** https://github.com/ioriverag30/trading-dashboard
- **Railway domain:** trading-dashboard-production-be2d.up.railway.app
- **ntfy canal:** Trading-Alerts
- **Backend port local:** 8000
- **Frontend port local:** 5173

---

## 📝 Comandos útiles

```bash
# Ver estado del backend local
curl http://localhost:8000/health

# Ver señal de una acción específica
curl http://localhost:8000/api/signal/AAPL

# Ver todas las señales
curl http://localhost:8000/api/signals

# Ver precios
curl http://localhost:8000/api/prices

# Push manual a Railway
cd "/Users/ivanriveragonzalez/Desktop/Claude Bolsa"
git add -A && git commit -m "mensaje" && git push origin main

# Rebuild frontend
cd frontend && npm run build
```

---

*Generado automáticamente por Claude — Proyecto en desarrollo activo 🚀*

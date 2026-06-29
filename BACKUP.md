# 📊 Claude Bolsa — Backup & Estado del Proyecto
**Última actualización:** 6 Jun 2026 (commit 3340ef6)
**GitHub:** https://github.com/ioriverag30/trading-dashboard  
**Railway (backend):** https://trading-dashboard-production-be2d.up.railway.app  

---

## ✅ Estado Actual — TODO FUNCIONA

| Componente | Estado |
|------------|--------|
| Railway backend | ✅ Online (port 8080) |
| yfinance datos | ✅ Browser User-Agent bypass activo |
| ntfy alertas | ✅ Canal Trading-Alerts |
| market_monitor | ✅ Activo (SPX -2%, VIX ≥25) |
| daily_summary | ✅ 9am ET push notification |
| Frontend nuevas features | ✅ Commiteado y deployando |

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
│   │   └── App.jsx      ← Dashboard React completo con nuevas features
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
- Alertas cuando una acción cambia de HOLD → BUY o → SELL
- **market_monitor:** alerta automática si SPX cae ≥2% o VIX ≥25 (cada 5 min)
- **daily_summary:** resumen de BUYs activos cada día a las 9am ET (14:00 UTC)
- **Funciona aunque la Mac esté apagada** (Railway siempre corre)

---

## ☁️ Railway — Problema 502 RESUELTO

### Causa raíz:
Railway inyecta `PORT=8080` como variable de sistema oculta, pero la configuración de Networking tenía "Custom port: 8000". El app escuchaba en 8080, Railway enrutaba al 8000 → 502.

### Fix:
Railway Dashboard → Settings → Networking → cambiar Custom port de 8000 a **8080**.

### Historial de commits del debugging:
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
| `187d007` | Sin healthcheck en railway.toml | ✅ FUNCIONA |
| `d109092` | Full rewrite + yfinance bypass | ✅ FUNCIONA |
| `3340ef6` | market_monitor + daily_summary + UI overhaul | ✅ FUNCIONA |

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

## 📊 Sistema de Señales

### Indicadores:
- **RSI** (14 períodos) — sobrecompra/sobreventa
- **MACD** — momentum y cruces
- **EMA 20/50** — tendencia
- **Bollinger Bands** — volatilidad
- **ATR** — para Stop Loss y Take Profit

### BUY (necesita 3/5 condiciones):
1. RSI < 35 (sobreventa)
2. MACD positivo (momentum alcista)
3. Precio > EMA50 (tendencia alcista)
4. Precio toca Bollinger inferior (rebote posible)
5. Volumen alto (confirmación)

### Stop Loss y Take Profit:
- **SL** = Precio − ATR × 2
- **TP** = Precio + ATR × 3
- **R:R** = 1:1.5

---

## 🆕 Features Implementadas (commit 3340ef6)

### Backend (`backend/main.py`):
- **`market_monitor()`** — monitorea SPX y VIX cada 5 min, envía ntfy si SPX cae ≥2% o VIX ≥25
- **`daily_summary()`** — envía resumen matutino a las 9am ET con todos los BUYs activos
- **`_yf_ticker(sym)`** — browser User-Agent para bypasear bloqueo de Yahoo Finance en datacenters
- **`@contextmanager db_conn()`** — conexiones DB con auto-commit/rollback/close
- **`check_all_price_alerts(price_snapshot)`** — 1 sola query DB para todos los tickers (antes eran 30)
- **`missing_buy_conditions`** — campo nuevo en cada señal: qué condiciones faltan para BUY
- **`/health`** — endpoint de health con info de port y tickers en cache

### Frontend (`frontend/src/App.jsx`):
- **`ConfidenceBar`** — barra 0-100% con 5 dots mostrando condiciones cumplidas
- **`SignalHeatmap`** — grid 4×5 de top 20 acciones con colores por señal
- **`MarketAlert`** — banner automático si SPX cae ≥2% o VIX ≥25
- **"Falta para COMPRAR"** — panel lateral con condiciones que faltan para BUY
- **Mini dots** en cada fila del watchlist
- **Sparkline fix** — filtra valores cero que hacían el gráfico siempre verde
- **Toggle heatmap** — botón en header para mostrar/ocultar el heatmap

---

## 🔮 Funciones Pendientes

1. **Deploy frontend a Vercel** — acceder al dashboard desde el cel
2. **Multi-timeframe** — análisis en diario + 4h + 1h simultáneo
3. **Integración IBKR** — leer posiciones reales cuando aprueben la cuenta
4. **Backtesting** — probar la estrategia con datos históricos

---

## 💰 Para Empezar con $500 (Paper Trading)

- **Broker:** Interactive Brokers (cuenta en proceso de aprobación)
- **Modo:** Paper Trading primero para probar
- **Estrategia recomendada:** Swing trading (3-10 días por posición)
- **Regla PDT:** Con menos de $25K no puedes hacer más de 3 day trades en 5 días (acciones USA). Crypto no tiene esta restricción.
- **Comisiones IBKR:** ~$1 por orden (mínimo)

---

## 🔑 Credenciales y Config

- **GitHub user:** ioriverag30
- **Repo:** https://github.com/ioriverag30/trading-dashboard
- **Railway domain:** trading-dashboard-production-be2d.up.railway.app
- **Railway port:** 8080 (IMPORTANTE — no cambiar)
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

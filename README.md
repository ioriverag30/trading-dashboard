# 📊 Dashboard de Inteligencia de Inversiones

Terminal de trading profesional con señales automáticas, alertas de precio y seguimiento de portafolio en tiempo real.

---

## ⚙️ Instalación de dependencias

### Requisitos previos
- Python 3.9 o superior
- Node.js 18 o superior
- Conexión a Internet

### Backend (Python)

```bash
pip3 install tradingview-ta requests pandas numpy fastapi uvicorn websockets python-dotenv
```

### Frontend (React)

```bash
cd frontend
npm install
```

---

## 🚀 Cómo ejecutar la aplicación

### Opción 1 — Script automático (recomendado)

```bash
cd "Claude Bolsa"
bash start.sh
```

### Opción 2 — Manual (dos terminales)

**Terminal 1 — Backend:**
```bash
cd "Claude Bolsa/backend"
python3 main.py
```

**Terminal 2 — Frontend:**
```bash
cd "Claude Bolsa/frontend"
npx vite
```

Luego abre tu navegador en: **http://localhost:3000**

---

## 📈 Lista de seguimiento preconfigurada

| Categoría | Activos |
|-----------|---------|
| Índices | SPX, NDQ, DJI, VIX, DXY |
| Acciones | AAPL, TSLA, NFLX |
| Cripto | BTCUSD, ETHUSD |
| Materias Primas | USOIL, XAUUSD |
| ETFs | SPY, QQQ, IWM |

---

## 🧠 Cómo funcionan las señales

Las señales se calculan usando indicadores técnicos de TradingView (datos en tiempo real).

### 🟢 COMPRAR — se activa con 3 o más condiciones:
1. RSI < 40 (activo sobrevendido)
2. MACD cruza por encima de la línea de señal (momentum alcista)
3. Precio en o por debajo de la Banda de Bollinger inferior (precio extremo bajo)
4. Precio por encima de la EMA 200 (tendencia alcista de largo plazo)
5. Volumen > 150% del promedio de 20 días (confirmación por volumen)

### 🔴 VENDER — se activa con 3 o más condiciones:
1. RSI > 65 (activo sobrecomprado)
2. MACD cruza por debajo de la línea de señal (momentum bajista)
3. Precio en o por encima de la Banda de Bollinger superior (precio extremo alto)
4. Precio cae por debajo de la EMA 50 (pérdida de soporte de mediano plazo)
5. Vela bajista con volumen alto (presión de venta confirmada)

### 🟡 MANTENER — cuando no se cumplen suficientes condiciones de compra o venta.

---

## 🔔 Sistema de alertas

1. En el panel izquierdo, ve a la pestaña **"Alertas"**
2. Haz clic en **"Nueva Alerta"**
3. Selecciona el activo, el precio objetivo y la dirección (por encima / por debajo)
4. Cuando el precio alcance el objetivo, recibirás una **notificación del navegador**
5. Las alertas se guardan en SQLite y persisten entre sesiones

---

## 💼 Portafolio

1. Ve a la pestaña **"Portafolio"** en el panel izquierdo
2. Haz clic en **"Agregar Posición"**
3. Introduce el activo, precio de entrada, cantidad y fecha
4. El dashboard calcula automáticamente P&L no realizado, % de cambio y valor total
5. La barra superior muestra el valor total del portafolio y P&L acumulado

---

## 🔑 Variables de entorno (.env)

```
ALPHA_VANTAGE_API_KEY=0BGGNPILKPXZR7TT   # API key para precios de acciones
APP_PORT=8000                              # Puerto del backend
```

---

## 🌐 Fuentes de datos

| Fuente | Datos |
|--------|-------|
| TradingView-TA | Indicadores técnicos, precios, señales |
| Alpha Vantage | Precios de acciones e índices (respaldo) |
| CoinGecko | Precios de criptomonedas (sin API key) |

---

## ⚠️ Aviso de riesgo

> **Esta herramienta es solo para fines informativos. No constituye asesoramiento financiero.**
>
> Invertir en mercados financieros conlleva riesgos significativos, incluyendo la pérdida total del capital invertido. Las señales generadas son puramente técnicas y no garantizan resultados futuros. Consulta siempre a un asesor financiero certificado antes de tomar decisiones de inversión.

---

## 🗂️ Estructura del proyecto

```
Claude Bolsa/
├── .env                  # Variables de entorno
├── start.sh              # Script de inicio automático
├── README.md             # Esta guía
├── backend/
│   ├── main.py           # Servidor FastAPI + WebSocket + señales
│   └── dashboard.db      # Base de datos SQLite (auto-generada)
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx       # Dashboard principal
        ├── api.js        # Llamadas al backend
        └── useWebSocket.js
```

import os
import time
import asyncio
import sqlite3
import logging
from datetime import datetime
from typing import Optional
from contextlib import asynccontextmanager

import requests
import yfinance as yf
import pandas as pd
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

APP_PORT = int(os.getenv("PORT", os.getenv("APP_PORT", "8000")))  # Railway uses PORT
DB_PATH = os.path.join(os.path.dirname(__file__), "dashboard.db")

WATCHLIST = {
    "indices":     ["SPX", "NDQ", "DJI", "VIX", "DXY"],
    "stocks":      ["NVDA","AAPL","MSFT","GOOGL","AMZN","META","TSLA","AMD",
                    "JPM","V","MA","LLY","COST","UNH","XOM","NFLX","PLTR","COIN","ASML","BRKB"],
    "crypto":      ["BTCUSD", "ETHUSD"],
    "commodities": ["USOIL", "XAUUSD"],
    "etfs":        ["SPY", "QQQ", "IWM"],
}
ALL_TICKERS = [t for g in WATCHLIST.values() for t in g]

# yfinance symbol map
YF_SYMBOLS = {
    # Índices
    "SPX":  "^GSPC", "NDQ": "^NDX",  "DJI": "^DJI",
    "VIX":  "^VIX",  "DXY": "DX-Y.NYB",
    # Top 20 acciones
    "NVDA": "NVDA",  "AAPL": "AAPL",  "MSFT": "MSFT",  "GOOGL": "GOOGL",
    "AMZN": "AMZN",  "META": "META",  "TSLA": "TSLA",  "AMD":  "AMD",
    "JPM":  "JPM",   "V":    "V",     "MA":   "MA",    "LLY":  "LLY",
    "COST": "COST",  "UNH":  "UNH",  "XOM":  "XOM",   "NFLX": "NFLX",
    "PLTR": "PLTR",  "COIN": "COIN", "ASML": "ASML",  "BRKB": "BRK-B",
    # Cripto
    "BTCUSD": "BTC-USD", "ETHUSD": "ETH-USD",
    # Materias primas
    "USOIL": "CL=F", "XAUUSD": "GC=F",
    # ETFs
    "SPY": "SPY", "QQQ": "QQQ", "IWM": "IWM",
}

# CoinGecko IDs for real-time crypto
COINGECKO_IDS = {"BTCUSD": "bitcoin", "ETHUSD": "ethereum"}

price_cache: dict = {}   # ticker -> {price, change_pct, ts}
indic_cache: dict = {}   # ticker -> full signal dict with ts
signal_prev: dict = {}   # ticker -> last known signal string (for change detection)

PRICE_TTL = 60
INDIC_TTL = 300

# ─── Database ────────────────────────────────────────────────────────────────

def init_db():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.executescript("""
        CREATE TABLE IF NOT EXISTS portfolio (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            entry_price REAL NOT NULL,
            quantity REAL NOT NULL,
            entry_date TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            alert_type TEXT NOT NULL DEFAULT 'price',
            target_price REAL,
            direction TEXT,
            triggered INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS signal_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            signal TEXT NOT NULL,
            buy_count INTEGER,
            sell_count INTEGER,
            price REAL,
            ts TEXT NOT NULL
        );
    """)
    # migrate: add alert_type column if missing
    try:
        cur.execute("ALTER TABLE alerts ADD COLUMN alert_type TEXT NOT NULL DEFAULT 'price'")
    except Exception:
        pass
    con.commit()
    con.close()

def db_conn():
    return sqlite3.connect(DB_PATH)

# ─── Price fetching ───────────────────────────────────────────────────────────

def fetch_crypto_realtime() -> dict:
    ids = ",".join(COINGECKO_IDS.values())
    url = f"https://api.coingecko.com/api/v3/simple/price?ids={ids}&vs_currencies=usd&include_24hr_change=true"
    try:
        r = requests.get(url, timeout=10)
        data = r.json()
        return {
            ticker: {"price": data[cg_id]["usd"], "change_pct": data[cg_id].get("usd_24h_change", 0)}
            for ticker, cg_id in COINGECKO_IDS.items()
            if cg_id in data
        }
    except Exception as e:
        logger.warning(f"CoinGecko error: {e}")
        return {}

def fetch_yfinance_price(ticker: str) -> Optional[dict]:
    yf_sym = YF_SYMBOLS.get(ticker)
    if not yf_sym:
        return None
    try:
        info = yf.Ticker(yf_sym).fast_info
        price = float(info.last_price)
        prev  = float(info.previous_close)
        if price != price or price <= 0:   # NaN / zero guard
            return None
        change_pct = ((price - prev) / prev * 100) if prev else 0
        return {"price": round(price, 4), "change_pct": round(change_pct, 4)}
    except Exception as e:
        logger.warning(f"yfinance price error {ticker}: {e}")
        return None

def refresh_price(ticker: str):
    data = None
    if ticker in COINGECKO_IDS:
        data = fetch_crypto_realtime().get(ticker)
    if not data:
        data = fetch_yfinance_price(ticker)
    if data:
        price_cache[ticker] = {**data, "ticker": ticker, "ts": time.time()}

# ─── Technical indicators (yfinance + pandas) ────────────────────────────────

# Condition labels shown in the UI
BUY_LABELS = [
    "RSI < 40 (sobreventa)",
    "MACD cruza ↑ señal (momentum alcista)",
    "Precio ≤ Banda Bollinger inferior",
    "Precio > EMA 200 (tendencia alcista)",
    "Pico de volumen > 150% promedio",
]
SELL_LABELS = [
    "RSI > 65 (sobrecompra)",
    "MACD cruza ↓ señal (momentum bajista)",
    "Precio ≥ Banda Bollinger superior",
    "Precio < EMA 50 (pérdida de soporte)",
    "Vela bajista con volumen alto",
]

def compute_signal(ticker: str) -> dict:
    now = time.time()
    cached = indic_cache.get(ticker)
    if cached and (now - cached["ts"]) < INDIC_TTL:
        return cached

    yf_sym = YF_SYMBOLS.get(ticker)
    if not yf_sym:
        return _empty_signal(ticker)

    try:
        df = yf.Ticker(yf_sym).history(period="1y", interval="1d", auto_adjust=True)
        if df is None or len(df) < 30:
            return _empty_signal(ticker)

        close  = df["Close"].dropna()
        high   = df["High"].dropna()
        low    = df["Low"].dropna()
        volume = df["Volume"].dropna()

        # ── EMAs ──────────────────────────────────────────────────────
        ema20  = float(close.ewm(span=20,  adjust=False).mean().iloc[-1])
        ema50  = float(close.ewm(span=50,  adjust=False).mean().iloc[-1])
        ema200 = float(close.ewm(span=200, adjust=False).mean().iloc[-1]) if len(close) >= 200 else 0.0

        # ── RSI (14) ──────────────────────────────────────────────────
        delta = close.diff()
        gain  = delta.clip(lower=0).rolling(14).mean()
        loss  = (-delta.clip(upper=0)).rolling(14).mean()
        rs    = gain / loss.replace(0, float("nan"))
        rsi   = float(100 - (100 / (1 + rs)).iloc[-1])

        # ── MACD (12, 26, 9) ──────────────────────────────────────────
        ema12       = close.ewm(span=12, adjust=False).mean()
        ema26       = close.ewm(span=26, adjust=False).mean()
        macd_line   = ema12 - ema26
        sig_line    = macd_line.ewm(span=9, adjust=False).mean()
        macd        = float(macd_line.iloc[-1])
        macd_sig    = float(sig_line.iloc[-1])
        prev_macd   = float(macd_line.iloc[-2])
        prev_sig    = float(sig_line.iloc[-2])

        # ── Bollinger Bands (20, 2σ) ──────────────────────────────────
        ma20     = close.rolling(20).mean()
        std20    = close.rolling(20).std()
        bb_upper = float((ma20 + 2 * std20).iloc[-1])
        bb_lower = float((ma20 - 2 * std20).iloc[-1])

        # ── ATR (14) for stop loss ────────────────────────────────────
        tr = pd.concat([
            high - low,
            (high - close.shift()).abs(),
            (low  - close.shift()).abs(),
        ], axis=1).max(axis=1)
        atr = float(tr.rolling(14).mean().iloc[-1])

        # ── Volume ────────────────────────────────────────────────────
        vol_now = float(volume.iloc[-1])
        vol_avg = float(volume.rolling(20).mean().iloc[-1])
        volume_spike = vol_now > vol_avg * 1.5 if vol_avg else False

        price_now    = float(close.iloc[-1])
        macd_cross_up   = prev_macd <= prev_sig and macd > macd_sig
        macd_cross_down = prev_macd >= prev_sig and macd < macd_sig

        # ── Signal conditions ─────────────────────────────────────────
        buy_conds = [
            rsi < 40,
            macd_cross_up,
            price_now <= bb_lower and bb_lower > 0,
            price_now > ema200 and ema200 > 0,
            volume_spike,
        ]
        sell_conds = [
            rsi > 65,
            macd_cross_down,
            price_now >= bb_upper and bb_upper > 0,
            price_now < ema50 and ema50 > 0,
            volume_spike and macd < 0,
        ]
        buy_count  = sum(buy_conds)
        sell_count = sum(sell_conds)

        if buy_count >= 3:
            signal = "BUY"
        elif sell_count >= 3:
            signal = "SELL"
        else:
            signal = "HOLD"

        # ── Stop loss & take profit ───────────────────────────────────
        # Stop loss: ATR × 2 below price for buy, above for sell
        stop_loss_buy  = round(price_now - 2 * atr, 4)
        stop_loss_sell = round(price_now + 2 * atr, 4)
        # Take profit: ATR × 3 above price for buy, below for sell (1.5 R:R)
        take_profit_buy  = round(price_now + 3 * atr, 4)
        take_profit_sell = round(price_now - 3 * atr, 4)
        # Key support / resistance from BB and EMA
        support    = round(max(bb_lower, ema50 if ema50 > 0 else bb_lower), 2)
        resistance = round(min(bb_upper, ema20 * 1.02), 2)

        # ── Active condition descriptions ─────────────────────────────
        active_buy_reasons  = [BUY_LABELS[i]  for i, v in enumerate(buy_conds)  if v]
        active_sell_reasons = [SELL_LABELS[i] for i, v in enumerate(sell_conds) if v]

        result = {
            "ticker": ticker,
            "signal": signal,
            "buy_count": buy_count,
            "sell_count": sell_count,
            "active_buy_reasons": active_buy_reasons,
            "active_sell_reasons": active_sell_reasons,
            "stop_loss_buy": stop_loss_buy,
            "stop_loss_sell": stop_loss_sell,
            "take_profit_buy": take_profit_buy,
            "take_profit_sell": take_profit_sell,
            "support": support,
            "resistance": resistance,
            "atr": round(atr, 4),
            "indicators": {
                "rsi": round(rsi, 2),
                "macd": round(macd, 4),
                "macd_signal": round(macd_sig, 4),
                "bb_upper": round(bb_upper, 2),
                "bb_lower": round(bb_lower, 2),
                "ema20": round(ema20, 2),
                "ema50": round(ema50, 2),
                "ema200": round(ema200, 2),
                "volume": vol_now,
                "volume_avg": vol_avg,
                "atr": round(atr, 4),
            },
            "ts": time.time(),
        }
        indic_cache[ticker] = result

        # ── Detect signal change → save history + auto-alert ──────────
        prev_sig_str = signal_prev.get(ticker)
        if prev_sig_str is not None and prev_sig_str != signal and signal in ("BUY", "SELL"):
            _save_signal_event(ticker, signal, buy_count, sell_count, price_now)
            _save_auto_alert(ticker, signal, price_now,
                             stop_loss_buy if signal == "BUY" else stop_loss_sell,
                             take_profit_buy if signal == "BUY" else take_profit_sell,
                             active_buy_reasons if signal == "BUY" else active_sell_reasons)
        signal_prev[ticker] = signal

        return result

    except Exception as e:
        logger.warning(f"Indicator error for {ticker}: {e}")
        return _empty_signal(ticker)

NTFY_TOPIC = "Trading-Alerts"

def _send_ntfy(ticker, signal, price, stop_loss, take_profit, reasons, buy_count):
    """Send push notification via ntfy.sh — free, no account needed."""
    try:
        is_buy = signal == "BUY"
        emoji  = "🟢" if is_buy else "🔴"
        label  = "COMPRAR" if is_buy else "VENDER"
        sl_lbl = "Stop Loss" if is_buy else "Stop Loss"
        tp_lbl = "Objetivo"  if is_buy else "Objetivo"
        reasons_str = " | ".join(reasons[:2]) if reasons else ""

        title = f"{emoji} {label} — {ticker}  ({buy_count}/5 condiciones)"
        body  = (
            f"Precio: ${round(price, 2)}\n"
            f"{sl_lbl}: ${round(stop_loss, 2)}\n"
            f"{tp_lbl}: ${round(take_profit, 2)}\n"
        )
        if reasons_str:
            body += f"\n{reasons_str}"

        requests.post(
            f"https://ntfy.sh/{NTFY_TOPIC}",
            data=body.encode("utf-8"),
            headers={
                "Title":    title.encode("utf-8"),
                "Priority": "high" if buy_count >= 4 else "default",
                "Tags":     "chart_with_upwards_trend" if is_buy else "chart_with_downwards_trend",
            },
            timeout=8,
        )
        logger.info(f"📲 ntfy enviado: {ticker} {label}")
    except Exception as e:
        logger.warning(f"ntfy error: {e}")

def _save_auto_alert(ticker, signal, price, stop_loss, take_profit, reasons):
    """Save auto-generated BUY/SELL signal as a persistent alert."""
    try:
        label = "COMPRAR" if signal == "BUY" else "VENDER"
        reasons_str = " | ".join(reasons[:3]) if reasons else ""
        note = f"Señal automática: {label} @ ${round(price,2)} | Stop: ${round(stop_loss,2)} | Objetivo: ${round(take_profit,2)}"
        if reasons_str:
            note += f" | {reasons_str}"
        con = db_conn()
        con.execute(
            "INSERT INTO alerts (ticker, alert_type, target_price, direction, created_at) VALUES (?,?,?,?,?)",
            (ticker, f"signal_{signal.lower()}", round(price, 2), note, datetime.utcnow().isoformat())
        )
        con.commit()
        con.close()
    except Exception as e:
        logger.warning(f"Auto-alert save error: {e}")

def _save_signal_event(ticker, signal, buy_count, sell_count, price):
    try:
        con = db_conn()
        con.execute(
            "INSERT INTO signal_history (ticker, signal, buy_count, sell_count, price, ts) VALUES (?,?,?,?,?,?)",
            (ticker, signal, buy_count, sell_count, price, datetime.utcnow().isoformat())
        )
        con.commit()
        con.close()
        logger.info(f"🔔 SEÑAL NUEVA: {ticker} → {signal} @ ${price}")
    except Exception as e:
        logger.warning(f"Signal history save error: {e}")

def _empty_signal(ticker: str) -> dict:
    return {
        "ticker": ticker, "signal": "HOLD",
        "buy_count": 0, "sell_count": 0,
        "active_buy_reasons": [], "active_sell_reasons": [],
        "stop_loss_buy": 0, "stop_loss_sell": 0,
        "take_profit_buy": 0, "take_profit_sell": 0,
        "support": 0, "resistance": 0, "atr": 0,
        "indicators": {
            "rsi": 50, "macd": 0, "macd_signal": 0,
            "bb_upper": 0, "bb_lower": 0,
            "ema20": 0, "ema50": 0, "ema200": 0,
            "volume": 0, "volume_avg": 0, "atr": 0,
        },
        "ts": time.time(),
    }

# ─── Alert checker ────────────────────────────────────────────────────────────

def check_price_alerts(ticker: str, price: float) -> list:
    con = db_conn()
    cur = con.cursor()
    cur.execute(
        "SELECT id, target_price, direction FROM alerts WHERE ticker=? AND alert_type='price' AND triggered=0",
        (ticker,)
    )
    triggered = []
    for aid, target, direction in cur.fetchall():
        hit = (direction == "above" and price >= target) or (direction == "below" and price <= target)
        if hit:
            con.execute("UPDATE alerts SET triggered=1 WHERE id=?", (aid,))
            triggered.append({"id": aid, "ticker": ticker, "type": "price",
                               "target": target, "direction": direction, "price": price})
    con.commit()
    con.close()
    return triggered

# ─── WebSocket manager ────────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, data: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.active.remove(ws)

manager = ConnectionManager()

# ─── Background updaters ──────────────────────────────────────────────────────

async def price_updater():
    await asyncio.sleep(3)
    loop = asyncio.get_event_loop()
    i = 0
    while True:
        ticker = ALL_TICKERS[i % len(ALL_TICKERS)]
        try:
            await loop.run_in_executor(None, refresh_price, ticker)
        except Exception as e:
            logger.warning(f"Price updater {ticker}: {e}")
        i += 1
        await asyncio.sleep(4)

async def signal_updater():
    await asyncio.sleep(20)
    loop = asyncio.get_event_loop()
    i = 0
    while True:
        ticker = ALL_TICKERS[i % len(ALL_TICKERS)]
        try:
            old_sig = indic_cache.get(ticker, {}).get("signal", "HOLD")
            result  = await loop.run_in_executor(None, compute_signal, ticker)
            new_sig = result.get("signal", "HOLD")
            # Broadcast signal change alert to all connected clients
            if old_sig != new_sig and new_sig in ("BUY", "SELL"):
                price      = price_cache.get(ticker, {}).get("price", 0)
                reasons    = result.get("active_buy_reasons" if new_sig == "BUY" else "active_sell_reasons", [])
                stop_loss  = result.get("stop_loss_buy"  if new_sig == "BUY" else "stop_loss_sell",  0)
                take_profit= result.get("take_profit_buy" if new_sig == "BUY" else "take_profit_sell", 0)
                buy_count  = result.get("buy_count", 0)
                await manager.broadcast({
                    "type": "signal_alert",
                    "ticker": ticker, "signal": new_sig, "price": price,
                    "reasons": reasons, "stop_loss": stop_loss,
                    "take_profit": take_profit,
                    "timestamp": datetime.utcnow().isoformat(),
                })
                # 📲 Push notification to phone
                await loop.run_in_executor(
                    None, _send_ntfy,
                    ticker, new_sig, price, stop_loss, take_profit, reasons, buy_count
                )
        except Exception as e:
            logger.warning(f"Signal updater {ticker}: {e}")
        i += 1
        await asyncio.sleep(5)

async def price_broadcast_loop():
    await asyncio.sleep(15)
    while True:
        try:
            updates = []
            triggered_alerts = []
            for ticker in ALL_TICKERS:
                p = price_cache.get(ticker, {})
                price = p.get("price", 0)
                updates.append({
                    "ticker": ticker,
                    "price": price,
                    "change_pct": p.get("change_pct", 0),
                })
                if price > 0:
                    triggered_alerts.extend(check_price_alerts(ticker, price))

            await manager.broadcast({
                "type": "prices",
                "data": updates,
                "triggered_alerts": triggered_alerts,
                "timestamp": datetime.utcnow().isoformat(),
            })
        except Exception as e:
            logger.error(f"Broadcast loop: {e}")
        await asyncio.sleep(30)

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    asyncio.create_task(price_updater())
    asyncio.create_task(signal_updater())
    asyncio.create_task(price_broadcast_loop())
    yield

# ─── App ─────────────────────────────────────────────────────────────────────

app = FastAPI(title="Investment Intelligence Dashboard", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── REST endpoints ───────────────────────────────────────────────────────────

@app.get("/api/watchlist")
def get_watchlist():
    return {"watchlist": WATCHLIST, "all": ALL_TICKERS}

@app.get("/api/prices")
def get_all_prices():
    return {"prices": [
        {"ticker": t, **{k: price_cache.get(t, {}).get(k, 0) for k in ("price", "change_pct")}}
        for t in ALL_TICKERS
    ]}

@app.get("/api/signal/{ticker}")
def get_signal(ticker: str):
    t = ticker.upper()
    return indic_cache.get(t) or _empty_signal(t)

@app.get("/api/signals")
def get_all_signals():
    results = []
    for ticker in ALL_TICKERS:
        sig   = indic_cache.get(ticker) or _empty_signal(ticker)
        price = price_cache.get(ticker, {})
        results.append({**sig, "price": price.get("price", 0), "change_pct": price.get("change_pct", 0)})
    return {"signals": results}

@app.get("/api/signal_history")
def get_signal_history(limit: int = 50):
    con = db_conn()
    cur = con.cursor()
    cur.execute("SELECT ticker, signal, buy_count, sell_count, price, ts FROM signal_history ORDER BY ts DESC LIMIT ?", (limit,))
    rows = cur.fetchall()
    con.close()
    return {"history": [
        {"ticker": r[0], "signal": r[1], "buy_count": r[2], "sell_count": r[3], "price": r[4], "ts": r[5]}
        for r in rows
    ]}

# Portfolio
class PositionIn(BaseModel):
    ticker: str
    entry_price: float
    quantity: float
    entry_date: str

@app.get("/api/portfolio")
def get_portfolio():
    con = db_conn()
    cur = con.cursor()
    cur.execute("SELECT id, ticker, entry_price, quantity, entry_date FROM portfolio")
    rows = cur.fetchall()
    con.close()
    positions = []
    total_value = total_cost = 0
    for pid, ticker, entry_price, quantity, entry_date in rows:
        p = price_cache.get(ticker, {})
        current_price = p.get("price", entry_price)
        cost  = entry_price * quantity
        value = current_price * quantity
        pnl   = value - cost
        sig   = indic_cache.get(ticker, _empty_signal(ticker))
        positions.append({
            "id": pid, "ticker": ticker, "entry_price": entry_price,
            "quantity": quantity, "entry_date": entry_date,
            "current_price": current_price,
            "value": round(value, 2), "cost": round(cost, 2),
            "pnl": round(pnl, 2), "pnl_pct": round((pnl/cost*100) if cost else 0, 2),
            "signal": sig["signal"],
            "stop_loss": sig.get("stop_loss_buy", 0),
            "take_profit": sig.get("take_profit_buy", 0),
        })
        total_value += value
        total_cost  += cost
    total_pnl = total_value - total_cost
    return {
        "positions": positions,
        "total_value": round(total_value, 2),
        "total_cost": round(total_cost, 2),
        "total_pnl": round(total_pnl, 2),
        "total_pnl_pct": round((total_pnl/total_cost*100) if total_cost else 0, 2),
    }

@app.post("/api/portfolio")
def add_position(pos: PositionIn):
    con = db_conn()
    cur = con.cursor()
    cur.execute(
        "INSERT INTO portfolio (ticker, entry_price, quantity, entry_date) VALUES (?,?,?,?)",
        (pos.ticker.upper(), pos.entry_price, pos.quantity, pos.entry_date)
    )
    con.commit()
    new_id = cur.lastrowid
    con.close()
    return {"id": new_id}

@app.delete("/api/portfolio/{pid}")
def delete_position(pid: int):
    con = db_conn()
    con.execute("DELETE FROM portfolio WHERE id=?", (pid,))
    con.commit()
    con.close()
    return {"ok": True}

# Alerts
class AlertIn(BaseModel):
    ticker: str
    alert_type: str = "price"   # "price" | "signal"
    target_price: Optional[float] = None
    direction: Optional[str] = None  # "above" | "below"

@app.get("/api/alerts")
def get_alerts():
    con = db_conn()
    cur = con.cursor()
    cur.execute("SELECT id, ticker, alert_type, target_price, direction, triggered, created_at FROM alerts ORDER BY created_at DESC")
    rows = cur.fetchall()
    con.close()
    return {"alerts": [
        {"id": r[0], "ticker": r[1], "alert_type": r[2], "target_price": r[3],
         "direction": r[4], "triggered": bool(r[5]), "created_at": r[6]}
        for r in rows
    ]}

@app.post("/api/alerts")
def create_alert(a: AlertIn):
    con = db_conn()
    cur = con.cursor()
    cur.execute(
        "INSERT INTO alerts (ticker, alert_type, target_price, direction, created_at) VALUES (?,?,?,?,?)",
        (a.ticker.upper(), a.alert_type, a.target_price, a.direction, datetime.utcnow().isoformat())
    )
    con.commit()
    new_id = cur.lastrowid
    con.close()
    return {"id": new_id}

@app.delete("/api/alerts/{aid}")
def delete_alert(aid: int):
    con = db_conn()
    con.execute("DELETE FROM alerts WHERE id=?", (aid,))
    con.commit()
    con.close()
    return {"ok": True}

@app.get("/api/history/{ticker}")
def get_price_history(ticker: str, days: int = 30):
    """Return OHLC daily history for chart rendering."""
    t = ticker.upper()
    yf_sym = YF_SYMBOLS.get(t)
    if not yf_sym:
        return {"history": []}
    try:
        period = "3mo" if days <= 90 else "1y"
        df = yf.Ticker(yf_sym).history(period=period)
        if df.empty:
            return {"history": []}
        df = df.tail(days)
        result = []
        for ts, row in df.iterrows():
            result.append({
                "date": ts.strftime("%d %b"),
                "open":  round(float(row["Open"]),  2),
                "high":  round(float(row["High"]),  2),
                "low":   round(float(row["Low"]),   2),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"]),
                "v": round(float(row["Close"]), 2),  # alias for area chart
            })
        return {"history": result, "ticker": t}
    except Exception as e:
        logger.warning(f"History {t}: {e}")
        return {"history": []}

# WebSocket
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        # Send full snapshot on connect
        snapshot_prices = [
            {"ticker": t, "price": price_cache.get(t, {}).get("price", 0),
             "change_pct": price_cache.get(t, {}).get("change_pct", 0)}
            for t in ALL_TICKERS
        ]
        snapshot_signals = [
            {**(indic_cache.get(t) or _empty_signal(t)),
             "price": price_cache.get(t, {}).get("price", 0),
             "change_pct": price_cache.get(t, {}).get("change_pct", 0)}
            for t in ALL_TICKERS
        ]
        await ws.send_json({"type": "snapshot", "prices": snapshot_prices, "signals": snapshot_signals,
                             "timestamp": datetime.utcnow().isoformat()})
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=APP_PORT, reload=False)

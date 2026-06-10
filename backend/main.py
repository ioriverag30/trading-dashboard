import os
import time
import asyncio
import sqlite3
import logging
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime
from typing import Optional

import requests
import pandas as pd
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# ─── Setup ───────────────────────────────────────────────────────────────────

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

APP_PORT        = int(os.getenv("PORT", os.getenv("APP_PORT", "8000")))
FINNHUB_TOKEN    = os.getenv("FINNHUB_TOKEN", "")
TWELVEDATA_TOKEN = os.getenv("TWELVEDATA_TOKEN", "")
_executor       = ThreadPoolExecutor(max_workers=3)
DB_PATH         = os.path.join(os.path.dirname(__file__), "dashboard.db")

_session = requests.Session()
_session.headers.update({"User-Agent": "Mozilla/5.0 (compatible; TradingDashboard/1.0)"})

# ─── Finnhub data layer ───────────────────────────────────────────────────────

# Finnhub symbol map — works from any IP, no rate limit issues
FINNHUB_SYMBOLS = {
    # US Stocks
    "NVDA":"NVDA","AAPL":"AAPL","MSFT":"MSFT","GOOGL":"GOOGL","AMZN":"AMZN",
    "META":"META","TSLA":"TSLA","AMD":"AMD","JPM":"JPM","V":"V","MA":"MA",
    "LLY":"LLY","COST":"COST","UNH":"UNH","XOM":"XOM","NFLX":"NFLX",
    "PLTR":"PLTR","COIN":"COIN","ASML":"ASML","BRKB":"BRK.B",
    # ETFs
    "SPY":"SPY","QQQ":"QQQ","IWM":"IWM",
    # Indices via ETF proxy (candles only available for ETFs in free tier)
    "SPX":"SPY","NDQ":"QQQ","DJI":"DIA","VIX":None,"DXY":None,
    # Crypto via Finnhub/Binance
    "BTCUSD":"BINANCE:BTCUSDT","ETHUSD":"BINANCE:ETHUSDT",
    # Commodities via Finnhub forex
    "USOIL":"OANDA:BCOUSD","XAUUSD":"OANDA:XAU_USD",
}

def _finnhub_quote(symbol: str) -> Optional[dict]:
    """Fetch real-time quote from Finnhub. Returns {price, change_pct} or None."""
    if not FINNHUB_TOKEN or not symbol:
        return None
    try:
        r = _session.get(
            "https://finnhub.io/api/v1/quote",
            params={"symbol": symbol, "token": FINNHUB_TOKEN},
            timeout=8,
        )
        if r.status_code != 200:
            return None
        d = r.json()
        price = d.get("c", 0)
        prev  = d.get("pc", 0)
        if not price or price <= 0:
            return None
        change_pct = ((price - prev) / prev * 100) if prev else 0
        return {"price": round(price, 4), "change_pct": round(change_pct, 4)}
    except Exception as e:
        logger.warning(f"Finnhub quote {symbol}: {e}")
        return None

# Twelve Data symbol map — candles (Finnhub free tier doesn't include candles)
TD_SYMBOLS = {
    "NVDA":"NVDA","AAPL":"AAPL","MSFT":"MSFT","GOOGL":"GOOGL","AMZN":"AMZN",
    "META":"META","TSLA":"TSLA","AMD":"AMD","JPM":"JPM","V":"V","MA":"MA",
    "LLY":"LLY","COST":"COST","UNH":"UNH","XOM":"XOM","NFLX":"NFLX",
    "PLTR":"PLTR","COIN":"COIN","ASML":"ASML","BRKB":"BRK.B",
    "SPY":"SPY","QQQ":"QQQ","IWM":"IWM",
    "SPX":"SPY","NDQ":"QQQ","DJI":"DIA","VIX":None,"DXY":None,
    "BTCUSD":"BTC/USD","ETHUSD":"ETH/USD",
    "USOIL":None,"XAUUSD":"XAU/USD",
}

_candle_cache: dict = {}   # ticker -> {"df": DataFrame, "ts": float}
CANDLE_TTL = 7200          # 2h — daily candles barely change intraday; keeps Twelve Data under 800 req/day

def _twelvedata_candles(symbol: str, days: int = 365) -> Optional[pd.DataFrame]:
    """Fetch daily OHLCV candles from Twelve Data. Returns DataFrame or None."""
    if not TWELVEDATA_TOKEN or not symbol:
        return None
    try:
        r = _session.get(
            "https://api.twelvedata.com/time_series",
            params={"symbol": symbol, "interval": "1day",
                    "outputsize": min(days, 5000), "apikey": TWELVEDATA_TOKEN},
            timeout=12,
        )
        if r.status_code != 200:
            return None
        d = r.json()
        vals = d.get("values")
        if d.get("status") != "ok" or not vals:
            logger.warning(f"TwelveData {symbol}: {d.get('message', 'no values')}")
            return None
        vals = vals[::-1]  # API returns newest first
        df = pd.DataFrame({
            "Open":   [float(v["open"])  for v in vals],
            "Close":  [float(v["close"]) for v in vals],
            "High":   [float(v["high"])  for v in vals],
            "Low":    [float(v["low"])   for v in vals],
            "Volume": [float(v.get("volume") or 0) for v in vals],
        }, index=pd.to_datetime([v["datetime"] for v in vals], utc=True))
        df = df.dropna(subset=["Close"])
        return df if len(df) >= 10 else None
    except Exception as e:
        logger.warning(f"TwelveData candles {symbol}: {e}")
        return None

def fetch_candles(ticker: str, days: int = 365) -> Optional[pd.DataFrame]:
    """Cached daily candles for a watchlist ticker: Twelve Data first, Finnhub fallback."""
    now    = time.time()
    cached = _candle_cache.get(ticker)
    if cached and (now - cached["ts"]) < CANDLE_TTL:
        return cached["df"]
    df = _twelvedata_candles(TD_SYMBOLS.get(ticker), days)
    if df is None:
        df = _finnhub_candles(FINNHUB_SYMBOLS.get(ticker), days)
    if df is not None:
        _candle_cache[ticker] = {"df": df, "ts": now}
        return df
    return cached["df"] if cached else None  # stale data beats no data

def _finnhub_candles(symbol: str, days: int = 365) -> Optional[pd.DataFrame]:
    """Fetch daily OHLCV candles from Finnhub. Returns DataFrame or None."""
    if not FINNHUB_TOKEN or not symbol:
        return None
    try:
        to_   = int(time.time())
        from_ = to_ - days * 86400
        # Choose endpoint based on symbol type
        if ":" in symbol:   # crypto like BINANCE:BTCUSDT
            endpoint = "https://finnhub.io/api/v1/crypto/candle"
        else:
            endpoint = "https://finnhub.io/api/v1/stock/candle"
        r = _session.get(
            endpoint,
            params={"symbol": symbol, "resolution": "D", "from": from_, "to": to_, "token": FINNHUB_TOKEN},
            timeout=12,
        )
        if r.status_code != 200:
            return None
        d = r.json()
        if d.get("s") != "ok" or not d.get("c"):
            return None
        df = pd.DataFrame({
            "Open":   d.get("o", d["c"]),
            "Close":  d["c"], "High": d["h"], "Low": d["l"],
            "Volume": d.get("v", [0]*len(d["c"])),
        }, index=pd.to_datetime(d["t"], unit="s", utc=True))
        df = df.dropna(subset=["Close"])
        return df if len(df) >= 10 else None
    except Exception as e:
        logger.warning(f"Finnhub candles {symbol}: {e}")
        return None

# ─── Watchlist & symbol maps ──────────────────────────────────────────────────

WATCHLIST = {
    "indices":     ["SPX", "NDQ", "DJI", "VIX", "DXY"],
    "stocks":      ["NVDA","AAPL","MSFT","GOOGL","AMZN","META","TSLA","AMD",
                    "JPM","V","MA","LLY","COST","UNH","XOM","NFLX","PLTR","COIN","ASML","BRKB"],
    "crypto":      ["BTCUSD", "ETHUSD"],
    "commodities": ["USOIL", "XAUUSD"],
    "etfs":        ["SPY", "QQQ", "IWM"],
}
ALL_TICKERS = [t for g in WATCHLIST.values() for t in g]

YF_SYMBOLS = {
    "SPX":  "^GSPC", "NDQ": "^NDX",  "DJI": "^DJI",
    "VIX":  "^VIX",  "DXY": "DX-Y.NYB",
    "NVDA": "NVDA",  "AAPL": "AAPL",  "MSFT": "MSFT",  "GOOGL": "GOOGL",
    "AMZN": "AMZN",  "META": "META",  "TSLA": "TSLA",  "AMD":  "AMD",
    "JPM":  "JPM",   "V":    "V",     "MA":   "MA",    "LLY":  "LLY",
    "COST": "COST",  "UNH":  "UNH",  "XOM":  "XOM",   "NFLX": "NFLX",
    "PLTR": "PLTR",  "COIN": "COIN", "ASML": "ASML",  "BRKB": "BRK-B",
    "BTCUSD": "BTC-USD", "ETHUSD": "ETH-USD",
    "USOIL": "CL=F", "XAUUSD": "GC=F",
    "SPY": "SPY", "QQQ": "QQQ", "IWM": "IWM",
}
COINGECKO_IDS = {"BTCUSD": "bitcoin", "ETHUSD": "ethereum"}

# ─── In-memory caches ────────────────────────────────────────────────────────

price_cache: dict = {}   # ticker -> {price, change_pct, ts}
indic_cache: dict = {}   # ticker -> full signal dict
signal_prev: dict = {}   # ticker -> last known signal (for change detection)

PRICE_TTL = 60
INDIC_TTL = 300

# ─── Database ─────────────────────────────────────────────────────────────────

@contextmanager
def db_conn():
    """Context manager — always closes the connection even on error."""
    con = sqlite3.connect(DB_PATH)
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()

def init_db():
    with db_conn() as con:
        con.executescript("""
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
            con.execute("ALTER TABLE alerts ADD COLUMN alert_type TEXT NOT NULL DEFAULT 'price'")
        except Exception:
            pass

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

def refresh_price(ticker: str):
    """Fetch price for one ticker: CoinGecko for crypto, Finnhub for everything else."""
    data = None
    if ticker in COINGECKO_IDS:
        data = fetch_crypto_realtime().get(ticker)
    if not data:
        fh_sym = FINNHUB_SYMBOLS.get(ticker)
        if fh_sym:
            data = _finnhub_quote(fh_sym)
    if data:
        price_cache[ticker] = {**data, "ticker": ticker, "ts": time.time()}

# ─── Technical indicators ─────────────────────────────────────────────────────

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
    now    = time.time()
    cached = indic_cache.get(ticker)
    if cached and (now - cached["ts"]) < INDIC_TTL:
        return cached

    try:
        df = fetch_candles(ticker, days=365)
        if df is None or len(df) < 30:
            return _empty_signal(ticker)

        close  = df["Close"].dropna()
        high   = df["High"].dropna()
        low    = df["Low"].dropna()
        volume = df["Volume"].fillna(0)

        # EMAs
        ema20  = float(close.ewm(span=20,  adjust=False).mean().iloc[-1])
        ema50  = float(close.ewm(span=50,  adjust=False).mean().iloc[-1])
        ema200 = float(close.ewm(span=200, adjust=False).mean().iloc[-1]) if len(close) >= 200 else 0.0

        # RSI (14)
        delta = close.diff()
        gain  = delta.clip(lower=0).rolling(14).mean()
        loss  = (-delta.clip(upper=0)).rolling(14).mean()
        rs    = gain / loss.replace(0, float("nan"))
        rsi   = float(100 - (100 / (1 + rs)).iloc[-1])

        # MACD (12, 26, 9)
        ema12       = close.ewm(span=12, adjust=False).mean()
        ema26       = close.ewm(span=26, adjust=False).mean()
        macd_line   = ema12 - ema26
        sig_line    = macd_line.ewm(span=9, adjust=False).mean()
        macd        = float(macd_line.iloc[-1])
        macd_sig    = float(sig_line.iloc[-1])
        prev_macd   = float(macd_line.iloc[-2])
        prev_sig    = float(sig_line.iloc[-2])

        # Bollinger Bands (20, 2σ)
        ma20     = close.rolling(20).mean()
        std20    = close.rolling(20).std()
        bb_upper = float((ma20 + 2 * std20).iloc[-1])
        bb_lower = float((ma20 - 2 * std20).iloc[-1])

        # ATR (14)
        tr = pd.concat([
            high - low,
            (high - close.shift()).abs(),
            (low  - close.shift()).abs(),
        ], axis=1).max(axis=1)
        atr = float(tr.rolling(14).mean().iloc[-1])

        # Volume
        vol_now      = float(volume.iloc[-1])
        vol_avg      = float(volume.rolling(20).mean().iloc[-1])
        volume_spike = vol_now > vol_avg * 1.5 if vol_avg else False

        price_now       = float(close.iloc[-1])
        macd_cross_up   = prev_macd <= prev_sig and macd > macd_sig
        macd_cross_down = prev_macd >= prev_sig and macd < macd_sig

        # Signal conditions
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

        signal = "BUY" if buy_count >= 3 else ("SELL" if sell_count >= 3 else "HOLD")

        # Stop loss & take profit (ATR-based)
        stop_loss_buy    = round(price_now - 2 * atr, 4)
        stop_loss_sell   = round(price_now + 2 * atr, 4)
        take_profit_buy  = round(price_now + 3 * atr, 4)
        take_profit_sell = round(price_now - 3 * atr, 4)
        support          = round(max(bb_lower, ema50 if ema50 > 0 else bb_lower), 2)
        resistance       = round(min(bb_upper, ema20 * 1.02), 2)

        # Missing conditions for BUY (for "what's needed" feature)
        missing_buy = [BUY_LABELS[i] for i, v in enumerate(buy_conds) if not v]

        active_buy_reasons  = [BUY_LABELS[i]  for i, v in enumerate(buy_conds)  if v]
        active_sell_reasons = [SELL_LABELS[i] for i, v in enumerate(sell_conds) if v]

        result = {
            "ticker": ticker, "signal": signal,
            "buy_count": buy_count, "sell_count": sell_count,
            "active_buy_reasons":  active_buy_reasons,
            "active_sell_reasons": active_sell_reasons,
            "missing_buy_conditions": missing_buy,
            "stop_loss_buy":    stop_loss_buy,  "stop_loss_sell":    stop_loss_sell,
            "take_profit_buy":  take_profit_buy,"take_profit_sell":  take_profit_sell,
            "support": support, "resistance": resistance, "atr": round(atr, 4),
            "indicators": {
                "rsi": round(rsi, 2), "macd": round(macd, 4),
                "macd_signal": round(macd_sig, 4),
                "bb_upper": round(bb_upper, 2), "bb_lower": round(bb_lower, 2),
                "ema20": round(ema20, 2), "ema50": round(ema50, 2), "ema200": round(ema200, 2),
                "volume": vol_now, "volume_avg": vol_avg, "atr": round(atr, 4),
            },
            "ts": time.time(),
        }
        indic_cache[ticker] = result

        # Detect signal change → save history + push notification
        prev_sig_str = signal_prev.get(ticker)
        if prev_sig_str is not None and prev_sig_str != signal and signal in ("BUY", "SELL"):
            _save_signal_event(ticker, signal, buy_count, sell_count, price_now)
            _save_auto_alert(ticker, signal, price_now,
                             stop_loss_buy  if signal == "BUY" else stop_loss_sell,
                             take_profit_buy if signal == "BUY" else take_profit_sell,
                             active_buy_reasons if signal == "BUY" else active_sell_reasons)
        signal_prev[ticker] = signal

        return result

    except Exception as e:
        logger.warning(f"Indicator error for {ticker}: {e}")
        return _empty_signal(ticker)

# ─── Notifications & persistence ─────────────────────────────────────────────

NTFY_TOPIC = os.getenv("NTFY_TOPIC", "Trading-Alerts")

def _send_ntfy(ticker, signal, price, stop_loss, take_profit, reasons, buy_count):
    """Send push notification via ntfy.sh — free, no account needed."""
    try:
        is_buy = signal == "BUY"
        emoji  = "🟢" if is_buy else "🔴"
        label  = "COMPRAR" if is_buy else "VENDER"
        title  = f"{emoji} {label} — {ticker}  ({buy_count}/5 condiciones)"
        body   = (
            f"Precio: ${round(price, 2)}\n"
            f"Stop Loss: ${round(stop_loss, 2)}\n"
            f"Objetivo: ${round(take_profit, 2)}\n"
        )
        if reasons:
            body += "\n" + " | ".join(reasons[:2])
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
        logger.info(f"📲 ntfy sent: {ticker} {label}")
    except Exception as e:
        logger.warning(f"ntfy error: {e}")

def _save_auto_alert(ticker, signal, price, stop_loss, take_profit, reasons):
    try:
        label = "COMPRAR" if signal == "BUY" else "VENDER"
        note  = (f"Señal automática: {label} @ ${round(price,2)} "
                 f"| Stop: ${round(stop_loss,2)} | Objetivo: ${round(take_profit,2)}")
        if reasons:
            note += " | " + " | ".join(reasons[:3])
        with db_conn() as con:
            con.execute(
                "INSERT INTO alerts (ticker, alert_type, target_price, direction, created_at) VALUES (?,?,?,?,?)",
                (ticker, f"signal_{signal.lower()}", round(price, 2), note, datetime.utcnow().isoformat())
            )
    except Exception as e:
        logger.warning(f"Auto-alert save error: {e}")

def _save_signal_event(ticker, signal, buy_count, sell_count, price):
    try:
        with db_conn() as con:
            con.execute(
                "INSERT INTO signal_history (ticker, signal, buy_count, sell_count, price, ts) VALUES (?,?,?,?,?,?)",
                (ticker, signal, buy_count, sell_count, price, datetime.utcnow().isoformat())
            )
        logger.info(f"🔔 NUEVA SEÑAL: {ticker} → {signal} @ ${price}")
    except Exception as e:
        logger.warning(f"Signal history save error: {e}")

def _empty_signal(ticker: str) -> dict:
    return {
        "ticker": ticker, "signal": "HOLD",
        "buy_count": 0, "sell_count": 0,
        "active_buy_reasons": [], "active_sell_reasons": [],
        "missing_buy_conditions": [],
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

# ─── Alert checker (single DB query for all tickers) ─────────────────────────

def check_all_price_alerts(price_snapshot: dict) -> list:
    """Check all untriggered price alerts in a single DB query."""
    triggered = []
    try:
        with db_conn() as con:
            cur = con.execute(
                "SELECT id, ticker, target_price, direction FROM alerts "
                "WHERE alert_type='price' AND triggered=0"
            )
            for aid, ticker, target, direction in cur.fetchall():
                price = price_snapshot.get(ticker, 0)
                if price <= 0:
                    continue
                hit = (direction == "above" and price >= target) or \
                      (direction == "below" and price <= target)
                if hit:
                    con.execute("UPDATE alerts SET triggered=1 WHERE id=?", (aid,))
                    triggered.append({"id": aid, "ticker": ticker, "type": "price",
                                      "target": target, "direction": direction, "price": price})
    except Exception as e:
        logger.warning(f"Alert check error: {e}")
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

# ─── Background tasks ─────────────────────────────────────────────────────────

async def price_updater():
    await asyncio.sleep(30)
    loop = asyncio.get_event_loop()
    i = 0
    while True:
        ticker = ALL_TICKERS[i % len(ALL_TICKERS)]
        try:
            await loop.run_in_executor(_executor, refresh_price, ticker)
        except Exception as e:
            logger.warning(f"Price updater {ticker}: {e}")
        i += 1
        await asyncio.sleep(6)

async def signal_updater():
    await asyncio.sleep(60)
    loop = asyncio.get_event_loop()
    i = 0
    while True:
        ticker = ALL_TICKERS[i % len(ALL_TICKERS)]
        try:
            old_sig = indic_cache.get(ticker, {}).get("signal", "HOLD")
            result  = await loop.run_in_executor(_executor, compute_signal, ticker)
            new_sig = result.get("signal", "HOLD")

            if old_sig != new_sig and new_sig in ("BUY", "SELL"):
                # Use price from the computed result, not from cache (avoids $0 alerts)
                price       = result.get("indicators", {}).get("ema20", 0)  # fallback
                cached_price = price_cache.get(ticker, {}).get("price", 0)
                if cached_price > 0:
                    price = cached_price
                reasons     = result.get("active_buy_reasons" if new_sig == "BUY" else "active_sell_reasons", [])
                stop_loss   = result.get("stop_loss_buy"   if new_sig == "BUY" else "stop_loss_sell",   0)
                take_profit = result.get("take_profit_buy" if new_sig == "BUY" else "take_profit_sell", 0)
                buy_count   = result.get("buy_count", 0)
                await manager.broadcast({
                    "type": "signal_alert", "ticker": ticker, "signal": new_sig,
                    "price": price, "reasons": reasons,
                    "stop_loss": stop_loss, "take_profit": take_profit,
                    "timestamp": datetime.utcnow().isoformat(),
                })
                await loop.run_in_executor(
                    _executor, _send_ntfy,
                    ticker, new_sig, price, stop_loss, take_profit, reasons, buy_count
                )
        except Exception as e:
            logger.warning(f"Signal updater {ticker}: {e}")
        i += 1
        await asyncio.sleep(10)  # Twelve Data free tier: max 8 req/min

async def market_monitor():
    """Monitor SPX and VIX — send alert if market drops >2% or VIX spikes."""
    await asyncio.sleep(120)  # wait for prices to populate
    loop = asyncio.get_event_loop()
    last_spx_alert = 0
    last_vix_alert = 0
    while True:
        try:
            spx = price_cache.get("SPX", {})
            vix = price_cache.get("VIX", {})
            spx_chg = spx.get("change_pct", 0)
            vix_val = vix.get("price", 0)
            now = time.time()

            # SPX caída > 2%
            if spx_chg <= -2 and (now - last_spx_alert) > 3600:
                last_spx_alert = now
                def _send_market_alert():
                    requests.post(
                        f"https://ntfy.sh/{NTFY_TOPIC}",
                        data=f"S&P 500 cae {round(spx_chg,2)}% hoy\nEvita abrir nuevas posiciones en mercado bajista.".encode(),
                        headers={"Title": "⚠️ MERCADO EN ROJO".encode(), "Priority": "high", "Tags": "warning"},
                        timeout=8
                    )
                await loop.run_in_executor(_executor, _send_market_alert)
                logger.info(f"🚨 Market alert sent: SPX {spx_chg}%")

            # VIX > 25
            if vix_val >= 25 and (now - last_vix_alert) > 7200:
                last_vix_alert = now
                def _send_vix_alert():
                    requests.post(
                        f"https://ntfy.sh/{NTFY_TOPIC}",
                        data=f"VIX en {round(vix_val,1)} — Alta volatilidad\nReducir tamaño de posiciones y ajustar Stop Loss.".encode(),
                        headers={"Title": "🔥 ALTA VOLATILIDAD (VIX)".encode(), "Priority": "default", "Tags": "fire"},
                        timeout=8
                    )
                await loop.run_in_executor(_executor, _send_vix_alert)
                logger.info(f"🔥 VIX alert sent: {vix_val}")

        except Exception as e:
            logger.warning(f"Market monitor error: {e}")
        await asyncio.sleep(300)  # check every 5 min

async def daily_summary():
    """Send a morning summary at 9:00 AM ET with best BUY signals."""
    while True:
        try:
            now_et = datetime.utcnow()
            # 9am ET = 14:00 UTC (approximate, ignores DST for simplicity)
            target_h, target_m = 14, 0
            secs_until = ((target_h * 60 + target_m) - (now_et.hour * 60 + now_et.minute)) * 60 - now_et.second
            if secs_until < 0:
                secs_until += 86400  # next day
            await asyncio.sleep(secs_until)

            # Build summary
            buys  = [(t, indic_cache[t]) for t in ALL_TICKERS
                     if t in indic_cache and indic_cache[t].get("signal") == "BUY"]
            sells = [(t, indic_cache[t]) for t in ALL_TICKERS
                     if t in indic_cache and indic_cache[t].get("signal") == "SELL"]
            buys.sort(key=lambda x: x[1].get("buy_count", 0), reverse=True)

            if not buys and not sells:
                await asyncio.sleep(60)
                continue

            lines = ["📊 RESUMEN MATUTINO — Dashboard de Inversiones\n"]
            if buys:
                lines.append(f"🟢 COMPRAR ({len(buys)}):")
                for t, s in buys[:5]:
                    price = price_cache.get(t, {}).get("price", 0)
                    lines.append(f"  • {t}: ${round(price,2)} ({s['buy_count']}/5 condiciones)")
            if sells:
                lines.append(f"\n🔴 VENDER ({len(sells)}):")
                for t, s in sells[:3]:
                    price = price_cache.get(t, {}).get("price", 0)
                    lines.append(f"  • {t}: ${round(price,2)}")

            spx_chg = price_cache.get("SPX", {}).get("change_pct", 0)
            vix_val = price_cache.get("VIX", {}).get("price", 0)
            lines.append(f"\nMercado: S&P 500 {'+' if spx_chg>=0 else ''}{round(spx_chg,2)}% | VIX {round(vix_val,1)}")

            loop = asyncio.get_event_loop()
            body = "\n".join(lines)
            def _send_summary():
                requests.post(
                    f"https://ntfy.sh/{NTFY_TOPIC}",
                    data=body.encode("utf-8"),
                    headers={"Title": "☀️ Resumen Matutino".encode(), "Priority": "default", "Tags": "calendar"},
                    timeout=10
                )
            await loop.run_in_executor(_executor, _send_summary)
            logger.info("📊 Daily summary sent")

        except Exception as e:
            logger.warning(f"Daily summary error: {e}")
        await asyncio.sleep(60)  # prevent double-send

async def price_broadcast_loop():
    await asyncio.sleep(15)
    while True:
        try:
            updates = []
            price_snapshot = {}
            for ticker in ALL_TICKERS:
                p     = price_cache.get(ticker, {})
                price = p.get("price", 0)
                price_snapshot[ticker] = price
                updates.append({"ticker": ticker, "price": price, "change_pct": p.get("change_pct", 0)})

            # Single DB query for all alerts instead of one per ticker
            triggered_alerts = check_all_price_alerts(price_snapshot)

            await manager.broadcast({
                "type": "prices", "data": updates,
                "triggered_alerts": triggered_alerts,
                "timestamp": datetime.utcnow().isoformat(),
            })
        except Exception as e:
            logger.error(f"Broadcast loop: {e}")
        await asyncio.sleep(30)

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        init_db()
        logger.info("DB initialized OK")
    except Exception as e:
        logger.error(f"DB init failed (non-fatal): {e}")
    try:
        asyncio.create_task(price_updater())
        asyncio.create_task(signal_updater())
        asyncio.create_task(price_broadcast_loop())
        asyncio.create_task(market_monitor())
        asyncio.create_task(daily_summary())
        logger.info("Background tasks started OK")
    except Exception as e:
        logger.error(f"Background task start failed (non-fatal): {e}")
    yield

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(title="Investment Intelligence Dashboard", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health_check():
    return {"status": "ok", "port": APP_PORT, "tickers_cached": len(price_cache)}

@app.get("/debug/yf")
def debug_yf():
    """Debug: test Finnhub data fetch from Railway."""
    token_set = bool(FINNHUB_TOKEN)
    results = {"token_configured": token_set, "token_prefix": FINNHUB_TOKEN[:6] + "..." if token_set else "MISSING"}
    if token_set:
        for ticker in ["AAPL", "NVDA"]:
            q = _finnhub_quote(FINNHUB_SYMBOLS.get(ticker, ticker))
            results[ticker] = q if q else "failed"
    results["twelvedata_configured"] = bool(TWELVEDATA_TOKEN)
    if TWELVEDATA_TOKEN:
        df = _twelvedata_candles("AAPL", days=60)
        results["candles_AAPL"] = f"{len(df)} días OK" if df is not None else "failed"
    return results

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
    return {"signals": [
        {**(indic_cache.get(t) or _empty_signal(t)),
         "price": price_cache.get(t, {}).get("price", 0),
         "change_pct": price_cache.get(t, {}).get("change_pct", 0)}
        for t in ALL_TICKERS
    ]}

@app.get("/api/signal_history")
def get_signal_history(limit: int = 50):
    with db_conn() as con:
        cur = con.execute(
            "SELECT ticker, signal, buy_count, sell_count, price, ts "
            "FROM signal_history ORDER BY ts DESC LIMIT ?", (limit,)
        )
        rows = cur.fetchall()
    return {"history": [
        {"ticker": r[0], "signal": r[1], "buy_count": r[2],
         "sell_count": r[3], "price": r[4], "ts": r[5]}
        for r in rows
    ]}

@app.get("/api/signal_performance")
def get_signal_performance(capital_per_trade: float = 1000.0):
    """Paper trading scoreboard: signals as trades (BUY opens, SELL closes).

    Each trade simulates investing `capital_per_trade` USD at the BUY signal.
    Open trades are valued at the current cached price.
    """
    with db_conn() as con:
        cur = con.execute(
            "SELECT ticker, signal, buy_count, sell_count, price, ts "
            "FROM signal_history ORDER BY ts ASC LIMIT 1000"
        )
        rows = cur.fetchall()

    # raw entries (newest first) for the compact side list
    entries = []
    for ticker, signal, buy_count, sell_count, sig_price, ts in reversed(rows):
        current = price_cache.get(ticker, {}).get("price", 0)
        pct = None
        if sig_price and sig_price > 0 and current > 0:
            raw = (current - sig_price) / sig_price * 100
            pct = round(raw if signal == "BUY" else -raw, 2)
        entries.append({
            "ticker": ticker, "signal": signal,
            "buy_count": buy_count, "sell_count": sell_count,
            "signal_price": sig_price, "current_price": current,
            "pct_since": pct, "ts": ts,
        })

    # pair BUY -> SELL into trades per ticker
    open_pos: dict = {}   # ticker -> {entry_price, entry_ts}
    trades = []
    for ticker, signal, _, _, sig_price, ts in rows:
        if not sig_price or sig_price <= 0:
            continue
        if signal == "BUY" and ticker not in open_pos:
            open_pos[ticker] = {"entry_price": sig_price, "entry_ts": ts}
        elif signal == "SELL" and ticker in open_pos:
            pos = open_pos.pop(ticker)
            trades.append({"ticker": ticker, "status": "closed",
                           "entry_price": pos["entry_price"], "entry_ts": pos["entry_ts"],
                           "exit_price": sig_price, "exit_ts": ts})
    now_iso = datetime.utcnow().isoformat()
    for ticker, pos in open_pos.items():
        current = price_cache.get(ticker, {}).get("price", 0)
        trades.append({"ticker": ticker, "status": "open",
                       "entry_price": pos["entry_price"], "entry_ts": pos["entry_ts"],
                       "exit_price": current if current > 0 else None, "exit_ts": None})

    def _days(a: str, b: str) -> float:
        try:
            return round((datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds() / 86400, 1)
        except Exception:
            return 0.0

    for t in trades:
        t["days_held"] = _days(t["entry_ts"], t["exit_ts"] or now_iso)
        if t["exit_price"]:
            pct = (t["exit_price"] - t["entry_price"]) / t["entry_price"] * 100
            t["pct"] = round(pct, 2)
            t["pnl_usd"] = round(capital_per_trade * pct / 100, 2)
        else:
            t["pct"] = None
            t["pnl_usd"] = None
    trades.sort(key=lambda t: t["entry_ts"], reverse=True)

    # aggregate stats (overall + per ticker)
    def _agg(ts_):
        scored = [t for t in ts_ if t["pct"] is not None]
        closed = [t for t in ts_ if t["status"] == "closed"]
        wins   = [t for t in scored if t["pct"] > 0]
        return {
            "trades": len(ts_), "closed": len(closed), "open": len(ts_) - len(closed),
            "win_rate": round(len(wins) / len(scored) * 100, 1) if scored else None,
            "avg_pct": round(sum(t["pct"] for t in scored) / len(scored), 2) if scored else None,
            "total_pnl_usd": round(sum(t["pnl_usd"] for t in scored), 2) if scored else 0,
            "avg_days": round(sum(t["days_held"] for t in ts_) / len(ts_), 1) if ts_ else None,
        }

    per_ticker = {}
    for t in trades:
        per_ticker.setdefault(t["ticker"], []).append(t)

    return {
        "entries": entries,
        "trades": trades,
        "stats": {**_agg(trades), "total_signals": len(entries),
                  "capital_per_trade": capital_per_trade},
        "per_ticker": {k: _agg(v) for k, v in per_ticker.items()},
    }

# ── Portfolio ─────────────────────────────────────────────────────────────────

class PositionIn(BaseModel):
    ticker: str
    entry_price: float
    quantity: float
    entry_date: str

@app.get("/api/portfolio")
def get_portfolio():
    with db_conn() as con:
        cur = con.execute("SELECT id, ticker, entry_price, quantity, entry_date FROM portfolio")
        rows = cur.fetchall()
    positions, total_value, total_cost = [], 0, 0
    for pid, ticker, entry_price, quantity, entry_date in rows:
        p             = price_cache.get(ticker, {})
        current_price = p.get("price", entry_price)
        cost, value   = entry_price * quantity, current_price * quantity
        pnl           = value - cost
        sig           = indic_cache.get(ticker) or _empty_signal(ticker)
        positions.append({
            "id": pid, "ticker": ticker, "entry_price": entry_price,
            "quantity": quantity, "entry_date": entry_date,
            "current_price": current_price,
            "value": round(value, 2), "cost": round(cost, 2),
            "pnl": round(pnl, 2), "pnl_pct": round((pnl/cost*100) if cost else 0, 2),
            "signal": sig["signal"],
            "stop_loss":   sig.get("stop_loss_buy", 0),
            "take_profit": sig.get("take_profit_buy", 0),
        })
        total_value += value
        total_cost  += cost
    total_pnl = total_value - total_cost
    return {
        "positions": positions,
        "total_value":   round(total_value, 2),
        "total_cost":    round(total_cost,  2),
        "total_pnl":     round(total_pnl,   2),
        "total_pnl_pct": round((total_pnl / total_cost * 100) if total_cost else 0, 2),
    }

@app.post("/api/portfolio")
def add_position(pos: PositionIn):
    with db_conn() as con:
        cur = con.execute(
            "INSERT INTO portfolio (ticker, entry_price, quantity, entry_date) VALUES (?,?,?,?)",
            (pos.ticker.upper(), pos.entry_price, pos.quantity, pos.entry_date)
        )
        return {"id": cur.lastrowid}

@app.delete("/api/portfolio/{pid}")
def delete_position(pid: int):
    with db_conn() as con:
        con.execute("DELETE FROM portfolio WHERE id=?", (pid,))
    return {"ok": True}

# ── Alerts ────────────────────────────────────────────────────────────────────

class AlertIn(BaseModel):
    ticker: str
    alert_type: str = "price"
    target_price: Optional[float] = None
    direction: Optional[str] = None

@app.get("/api/alerts")
def get_alerts():
    with db_conn() as con:
        cur = con.execute(
            "SELECT id, ticker, alert_type, target_price, direction, triggered, created_at "
            "FROM alerts ORDER BY created_at DESC"
        )
        rows = cur.fetchall()
    return {"alerts": [
        {"id": r[0], "ticker": r[1], "alert_type": r[2], "target_price": r[3],
         "direction": r[4], "triggered": bool(r[5]), "created_at": r[6]}
        for r in rows
    ]}

@app.post("/api/alerts")
def create_alert(a: AlertIn):
    with db_conn() as con:
        cur = con.execute(
            "INSERT INTO alerts (ticker, alert_type, target_price, direction, created_at) VALUES (?,?,?,?,?)",
            (a.ticker.upper(), a.alert_type, a.target_price, a.direction, datetime.utcnow().isoformat())
        )
        return {"id": cur.lastrowid}

@app.delete("/api/alerts/{aid}")
def delete_alert(aid: int):
    with db_conn() as con:
        con.execute("DELETE FROM alerts WHERE id=?", (aid,))
    return {"ok": True}

# ── History ───────────────────────────────────────────────────────────────────

@app.get("/api/history/{ticker}")
def get_price_history(ticker: str, days: int = 30):
    """Return OHLC daily history for chart rendering."""
    t = ticker.upper()
    try:
        df = fetch_candles(t, days=365)
        if df is None or df.empty:
            return {"history": []}
        df = df.tail(days)
        result = []
        for ts, row in df.iterrows():
            result.append({
                "date":   ts.strftime("%d %b"),
                "open":   round(float(row["Open"]),  2),
                "high":   round(float(row["High"]),  2),
                "low":    round(float(row["Low"]),   2),
                "close":  round(float(row["Close"]), 2),
                "volume": int(row["Volume"]),
                "v":      round(float(row["Close"]), 2),
            })
        return {"history": result, "ticker": t}
    except Exception as e:
        logger.warning(f"History {t}: {e}")
        return {"history": []}

# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        snapshot_prices  = [
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
        await ws.send_json({
            "type": "snapshot", "prices": snapshot_prices,
            "signals": snapshot_signals, "timestamp": datetime.utcnow().isoformat()
        })
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)

# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    logger.info(f"Starting on port {port}")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)

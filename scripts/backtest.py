"""
Backtest de la lógica de señales EXACTA de backend/main.py (compute_signal):
  BUY  si >= 3 de: RSI<40, cruce MACD arriba, precio<=BB inferior, precio>EMA200, pico volumen
  SELL si >= 3 de: RSI>65, cruce MACD abajo, precio>=BB superior, precio<EMA50, pico vol & MACD<0
Gestión: entra en BUY, sale en stop (precio - 2*ATR), objetivo (precio + 3*ATR) o señal SELL.
Compara contra Buy & Hold en el mismo período.
"""
import warnings
warnings.filterwarnings("ignore")
import numpy as np
import pandas as pd
import yfinance as yf

TICKERS = ["SPY", "QQQ", "NVDA", "AAPL", "MSFT", "TSLA", "AMD", "META", "JPM", "XOM"]
YEARS = 5


def indicators(df: pd.DataFrame) -> pd.DataFrame:
    close, high, low, vol = df["Close"], df["High"], df["Low"], df["Volume"]
    out = pd.DataFrame(index=df.index)
    out["close"] = close
    out["ema20"] = close.ewm(span=20, adjust=False).mean()
    out["ema50"] = close.ewm(span=50, adjust=False).mean()
    out["ema200"] = close.ewm(span=200, adjust=False).mean()
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    rs = gain / loss.replace(0, np.nan)
    out["rsi"] = 100 - 100 / (1 + rs)
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    out["macd"] = ema12 - ema26
    out["macd_sig"] = out["macd"].ewm(span=9, adjust=False).mean()
    ma20 = close.rolling(20).mean()
    std20 = close.rolling(20).std()
    out["bb_up"] = ma20 + 2 * std20
    out["bb_lo"] = ma20 - 2 * std20
    tr = pd.concat([high - low, (high - close.shift()).abs(), (low - close.shift()).abs()], axis=1).max(axis=1)
    out["atr"] = tr.rolling(14).mean()
    out["vol"] = vol
    out["vol_avg"] = vol.rolling(20).mean()
    return out


def signals(ind: pd.DataFrame) -> pd.DataFrame:
    p = ind["close"]
    cross_up = (ind["macd"].shift() <= ind["macd_sig"].shift()) & (ind["macd"] > ind["macd_sig"])
    cross_dn = (ind["macd"].shift() >= ind["macd_sig"].shift()) & (ind["macd"] < ind["macd_sig"])
    vol_spike = ind["vol"] > ind["vol_avg"] * 1.5
    buy = (
        (ind["rsi"] < 40).astype(int)
        + cross_up.astype(int)
        + (p <= ind["bb_lo"]).astype(int)
        + (p > ind["ema200"]).astype(int)
        + vol_spike.astype(int)
    )
    sell = (
        (ind["rsi"] > 65).astype(int)
        + cross_dn.astype(int)
        + (p >= ind["bb_up"]).astype(int)
        + (p < ind["ema50"]).astype(int)
        + (vol_spike & (ind["macd"] < 0)).astype(int)
    )
    out = ind.copy()
    out["buy_n"], out["sell_n"] = buy, sell
    out["signal"] = np.where(buy >= 3, "BUY", np.where(sell >= 3, "SELL", "HOLD"))
    return out


def backtest(df: pd.DataFrame) -> dict:
    s = signals(indicators(df)).dropna(subset=["ema200", "atr", "rsi"])
    cash, pos, entry, stop, target = 10_000.0, 0.0, 0.0, 0.0, 0.0
    trades, wins = [], 0
    for i in range(1, len(s)):
        row, prev = s.iloc[i], s.iloc[i - 1]
        price = float(row["close"])
        if pos > 0:
            exit_price = None
            if float(row["close"]) <= stop:
                exit_price = stop  # aprox: ejecuta en el stop
            elif float(row["close"]) >= target:
                exit_price = target
            elif prev["signal"] == "SELL":  # señal de ayer -> sale hoy
                exit_price = price
            if exit_price:
                cash = pos * exit_price
                trades.append(exit_price / entry - 1)
                if exit_price > entry:
                    wins += 1
                pos = 0.0
        elif prev["signal"] == "BUY":  # señal de ayer -> compra hoy
            entry = price
            stop = entry - 2 * float(prev["atr"])
            target = entry + 3 * float(prev["atr"])
            pos = cash / entry
            cash = 0.0
    final = cash if pos == 0 else pos * float(s["close"].iloc[-1])
    bh = 10_000 * float(s["close"].iloc[-1]) / float(s["close"].iloc[0])
    return {
        "strategy_final": final,
        "buyhold_final": bh,
        "n_trades": len(trades),
        "win_rate": wins / len(trades) * 100 if trades else 0,
        "avg_trade_pct": np.mean(trades) * 100 if trades else 0,
    }


def main():
    print(f"{'Ticker':<7}{'Estrategia':>12}{'Buy&Hold':>12}{'Dif':>9}{'Trades':>8}{'Win%':>7}{'AvgTrade%':>11}")
    print("-" * 66)
    tot_s = tot_b = 0
    for t in TICKERS:
        df = yf.download(t, period=f"{YEARS}y", interval="1d", progress=False, auto_adjust=True)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        if df.empty:
            print(f"{t:<7}  sin datos")
            continue
        r = backtest(df)
        diff = (r["strategy_final"] / r["buyhold_final"] - 1) * 100
        tot_s += r["strategy_final"]; tot_b += r["buyhold_final"]
        print(f"{t:<7}{r['strategy_final']:>11,.0f}${r['buyhold_final']:>11,.0f}${diff:>8.1f}%"
              f"{r['n_trades']:>8}{r['win_rate']:>6.0f}%{r['avg_trade_pct']:>10.2f}%")
    print("-" * 66)
    print(f"{'TOTAL':<7}{tot_s:>11,.0f}${tot_b:>11,.0f}${(tot_s/tot_b-1)*100:>8.1f}%")
    print(f"\n(Inversión: $10,000 por ticker, {YEARS} años, sin comisiones ni impuestos)")


if __name__ == "__main__":
    main()

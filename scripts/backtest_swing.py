"""
Backtest de estrategias SWING (días a ~2 semanas) orientadas a cash flow.
Compara:
  V1 = sistema actual del dashboard (3-de-5 condiciones)
  V2 = reversión a la media: comprar caída en tendencia alcista, salida rápida
       (RSI<35 y precio>EMA200 -> entra; sale en +1.5*ATR, RSI>55, o 10 días; stop 1.5*ATR)
  V3 = igual que V2 pero más selectivo (RSI<30) y salida en RSI>50 o 7 días
Métricas: retorno anual, trades/año, duración promedio, win rate, peor racha.
"""
import warnings
warnings.filterwarnings("ignore")
import numpy as np
import pandas as pd
import yfinance as yf

TICKERS = ["SPY", "QQQ", "NVDA", "AAPL", "MSFT", "TSLA", "AMD", "META", "JPM", "XOM"]
YEARS = 5
CAPITAL = 10_000.0


def indicators(df):
    close, high, low, vol = df["Close"], df["High"], df["Low"], df["Volume"]
    o = pd.DataFrame(index=df.index)
    o["close"], o["high"], o["low"] = close, high, low
    o["ema50"] = close.ewm(span=50, adjust=False).mean()
    o["ema200"] = close.ewm(span=200, adjust=False).mean()
    d = close.diff()
    gain = d.clip(lower=0).rolling(14).mean()
    loss = (-d.clip(upper=0)).rolling(14).mean()
    o["rsi"] = 100 - 100 / (1 + gain / loss.replace(0, np.nan))
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    o["macd"] = ema12 - ema26
    o["macd_sig"] = o["macd"].ewm(span=9, adjust=False).mean()
    ma20 = close.rolling(20).mean()
    sd = close.rolling(20).std()
    o["bb_up"], o["bb_lo"] = ma20 + 2 * sd, ma20 - 2 * sd
    tr = pd.concat([high - low, (high - close.shift()).abs(), (low - close.shift()).abs()], axis=1).max(axis=1)
    o["atr"] = tr.rolling(14).mean()
    o["vol"], o["vol_avg"] = vol, vol.rolling(20).mean()
    return o.dropna()


def run(ind, entry_fn, exit_fn, stop_mult, target_mult, max_hold):
    cash, pos = CAPITAL, 0.0
    entry = stop = target = 0.0
    held = 0
    trades, durations = [], []
    equity = []
    for i in range(1, len(ind)):
        row, prev = ind.iloc[i], ind.iloc[i - 1]
        price = float(row["close"])
        if pos > 0:
            held += 1
            ex = None
            if float(row["low"]) <= stop:
                ex = stop
            elif target and float(row["high"]) >= target:
                ex = target
            elif exit_fn(prev) or held >= max_hold:
                ex = price
            if ex:
                cash = pos * ex
                trades.append(ex / entry - 1)
                durations.append(held)
                pos = 0.0
        elif entry_fn(prev):
            entry = price
            stop = entry - stop_mult * float(prev["atr"])
            target = entry + target_mult * float(prev["atr"]) if target_mult else 0.0
            pos = cash / entry
            held = 0
        equity.append(cash if pos == 0 else pos * price)
    eq = pd.Series(equity, dtype=float)
    dd = ((eq - eq.cummax()) / eq.cummax()).min() * 100 if len(eq) else 0
    final = eq.iloc[-1] if len(eq) else CAPITAL
    n = len(trades)
    return {
        "final": final,
        "annual": ((final / CAPITAL) ** (1 / YEARS) - 1) * 100,
        "trades_yr": n / YEARS,
        "avg_days": np.mean(durations) if durations else 0,
        "win": sum(1 for t in trades if t > 0) / n * 100 if n else 0,
        "maxdd": dd,
    }


# ── Definición de variantes ──────────────────────────────────────────────────

def v1(ind):  # sistema actual
    cross_up = (ind["macd"].shift() <= ind["macd_sig"].shift()) & (ind["macd"] > ind["macd_sig"])
    cross_dn = (ind["macd"].shift() >= ind["macd_sig"].shift()) & (ind["macd"] < ind["macd_sig"])
    spike = ind["vol"] > ind["vol_avg"] * 1.5
    buy = ((ind["rsi"] < 40).astype(int) + cross_up.astype(int)
           + (ind["close"] <= ind["bb_lo"]).astype(int)
           + (ind["close"] > ind["ema200"]).astype(int) + spike.astype(int))
    sell = ((ind["rsi"] > 65).astype(int) + cross_dn.astype(int)
            + (ind["close"] >= ind["bb_up"]).astype(int)
            + (ind["close"] < ind["ema50"]).astype(int)
            + (spike & (ind["macd"] < 0)).astype(int))
    ind = ind.copy()
    ind["_buy"], ind["_sell"] = buy >= 3, sell >= 3
    return run(ind, lambda r: bool(r["_buy"]), lambda r: bool(r["_sell"]), 2, 3, 10**9)


def v2(ind):
    return run(
        ind,
        lambda r: r["rsi"] < 35 and r["close"] > r["ema200"],
        lambda r: r["rsi"] > 55,
        1.5, 1.5, 10,
    )


def v3(ind):
    return run(
        ind,
        lambda r: r["rsi"] < 30 and r["close"] > r["ema200"],
        lambda r: r["rsi"] > 50,
        1.5, 0, 7,
    )


def main():
    agg = {k: [] for k in ("V1 actual", "V2 swing", "V3 selectivo")}
    print(f"{'Ticker':<7}", end="")
    for name in agg:
        print(f"{name:>22}", end="")
    print("\n" + " " * 7 + f"{'anual% tr/añ win%':>22}" * 3)
    print("-" * 73)
    for t in TICKERS:
        df = yf.download(t, period=f"{YEARS}y", interval="1d", progress=False, auto_adjust=True)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        ind = indicators(df)
        print(f"{t:<7}", end="")
        for name, fn in zip(agg, (v1, v2, v3)):
            r = fn(ind)
            agg[name].append(r)
            print(f"{r['annual']:>8.1f} {r['trades_yr']:>5.1f} {r['win']:>5.0f}%", end=" ")
        print()
    print("-" * 73)
    print("\nPROMEDIO CARTERA (10 tickers, $10k c/u):")
    for name, rs in agg.items():
        annual = np.mean([r["annual"] for r in rs])
        tr = np.mean([r["trades_yr"] for r in rs])
        days = np.mean([r["avg_days"] for r in rs])
        win = np.mean([r["win"] for r in rs])
        dd = np.mean([r["maxdd"] for r in rs])
        monthly_cash = 100_000 * ((1 + annual / 100) ** (1 / 12) - 1)
        print(f"  {name:<13} {annual:>5.1f}%/año | {tr:>4.1f} trades/año/ticker | "
              f"{days:>4.1f} días/trade | win {win:.0f}% | DD prom {dd:.0f}% | "
              f"~${monthly_cash:,.0f}/mes sobre $100k")
    print("\nReferencia Buy&Hold SPY mismo período: ~12.8%/año (~$1,010/mes sobre $100k)")


if __name__ == "__main__":
    main()

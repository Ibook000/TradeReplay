"""K-line fetchers — Binance, OKX, Bybit with fallback chain."""

import httpx

# ─── Interval mapping ────────────────────────────────────────────────────
_OKX_BAR = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D"}
_BYBIT_INTERVAL = {"1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D"}
_BITGET_GRANULARITY = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D"}


def pick_interval(hours: float) -> str:
    """Auto-select K-line interval based on time span."""
    if hours < 2:   return "1m"
    if hours < 6:   return "5m"
    if hours < 24:  return "15m"
    if hours < 72:  return "1h"
    return "4h"


# ─── Symbol → instrument ID ─────────────────────────────────────────────
def okx_inst(symbol: str) -> str:
    return f"{symbol.upper()}-USDT-SWAP"

def bybit_sym(symbol: str) -> str:
    return f"{symbol.upper()}USDT"

def bitget_sym(symbol: str) -> str:
    return f"{symbol.upper()}USDT"

def binance_sym(symbol: str) -> str:
    return f"{symbol.upper()}USDT"


# ─── Unified K-line format ──────────────────────────────────────────────
def _to_kline(time_ms, o, h, l, c, v) -> dict:
    return {"time": int(time_ms) // 1000, "open": float(o), "high": float(h),
            "low": float(l), "close": float(c), "volume": float(v)}


# ─── Binance ────────────────────────────────────────────────────────────
async def fetch_binance(symbol: str, interval: str, start_ms: int, end_ms: int) -> list[dict]:
    """Fetch from Binance public API. symbol = 'BTCUSDT'."""
    url = "https://api.binance.com/api/v3/klines"
    all_klines = []
    cur = start_ms
    async with httpx.AsyncClient() as client:
        while cur < end_ms:
            params = {"symbol": symbol, "interval": interval,
                      "startTime": cur, "endTime": end_ms, "limit": 1000}
            try:
                resp = await client.get(url, params=params, timeout=10)
                if resp.status_code != 200:
                    break
                data = resp.json()
            except Exception:
                break
            if not data:
                break
            all_klines.extend(_to_kline(k[0], k[1], k[2], k[3], k[4], k[5]) for k in data)
            cur = data[-1][0] + 1
            if len(data) < 1000:
                break
    return all_klines


# ─── OKX ────────────────────────────────────────────────────────────────
async def fetch_okx(symbol: str, interval: str, start_ms: int, end_ms: int) -> list[dict]:
    """Fetch from OKX public API. symbol = 'BTC-USDT-SWAP'.
    Uses history-candles for older data, candles for recent."""
    bar = _OKX_BAR.get(interval, interval)
    raw = []

    async with httpx.AsyncClient() as client:
        for endpoint in ["market/history-candles", "market/candles"]:
            url = f"https://www.okx.com/api/v5/{endpoint}"
            after = str(end_ms)
            for _ in range(100):
                params = {"instId": symbol, "bar": bar, "limit": "100", "after": after}
                try:
                    resp = await client.get(url, params=params, timeout=10)
                    data = resp.json()
                except Exception:
                    break
                if data.get("code") != "0":
                    break
                rows = data.get("data", [])
                if not rows:
                    break
                for r in rows:
                    ts = int(r[0])
                    if start_ms <= ts <= end_ms:
                        raw.append(r)
                    if ts < start_ms:
                        break
                else:
                    after = rows[-1][0]
                    if int(rows[-1][0]) > start_ms:
                        continue
                break

    # Deduplicate by timestamp
    seen = set()
    unique = []
    for k in raw:
        ts = int(k[0])
        if ts not in seen:
            seen.add(ts)
            unique.append(k)

    unique.sort(key=lambda r: int(r[0]))
    return [_to_kline(k[0], k[1], k[2], k[3], k[4], k[5]) for k in unique]


# ─── Bybit ──────────────────────────────────────────────────────────────
async def fetch_bybit(symbol: str, interval: str, start_ms: int, end_ms: int) -> list[dict]:
    """Fetch from Bybit public API. symbol = 'BTCUSDT'."""
    bybit_iv = _BYBIT_INTERVAL.get(interval, "60")
    url = "https://api.bybit.com/v5/market/kline"
    all_klines = []
    cur = start_ms
    async with httpx.AsyncClient() as client:
        for _ in range(50):
            params = {"category": "linear", "symbol": symbol,
                      "interval": bybit_iv, "start": str(cur), "end": str(end_ms), "limit": "1000"}
            try:
                resp = await client.get(url, params=params, timeout=10)
                data = resp.json()
            except Exception:
                break
            if data.get("retCode") != 0:
                break
            rows = data.get("result", {}).get("list", [])
            if not rows:
                break
            rows.sort(key=lambda r: int(r[0]))
            all_klines.extend(_to_kline(r[0], r[1], r[2], r[3], r[4], r[5]) for r in rows)
            cur = int(rows[-1][0]) + 1
            if len(rows) < 1000:
                break
    return all_klines


# ─── Bitget ─────────────────────────────────────────────────────────────
async def fetch_bitget(symbol: str, interval: str, start_ms: int, end_ms: int) -> list[dict]:
    """Fetch from Bitget public API. symbol = 'BTCUSDT'."""
    granularity = _BITGET_GRANULARITY.get(interval, "1H")
    url = "https://api.bitget.com/api/v2/mix/market/candles"
    all_klines = []
    cur = end_ms
    async with httpx.AsyncClient() as client:
        for _ in range(50):
            params = {"symbol": symbol, "productType": "USDT-FUTURES",
                      "granularity": granularity, "startTime": str(start_ms),
                      "endTime": str(cur), "limit": "200"}
            try:
                resp = await client.get(url, params=params, timeout=10)
                data = resp.json()
            except Exception:
                break
            if data.get("code") != "00000":
                break
            rows = data.get("data", [])
            if not rows:
                break
            for r in rows:
                ts = int(r[0])
                if start_ms <= ts <= end_ms:
                    all_klines.append(_to_kline(r[0], r[1], r[2], r[3], r[4], r[5]))
            # Bitget returns newest first, paginate backward
            oldest_ts = int(rows[-1][0])
            if oldest_ts <= start_ms:
                break
            cur = oldest_ts - 1

    # Deduplicate by timestamp
    seen = set()
    unique = []
    for k in all_klines:
        if k["time"] not in seen:
            seen.add(k["time"])
            unique.append(k)
    unique.sort(key=lambda k: k["time"])
    return unique


# ─── Unified fetch with fallback ────────────────────────────────────────
async def fetch_klines(symbol: str, interval: str, start_ms: int, end_ms: int,
                        exchange: str = "") -> list[dict]:
    """Fetch K-lines based on trade's exchange. Falls back across sources."""
    sym = symbol.upper()

    if exchange == "OKX":
        klines = await fetch_okx(okx_inst(sym), interval, start_ms, end_ms)
        if klines:
            return klines
        return await fetch_binance(binance_sym(sym), interval, start_ms, end_ms)

    elif exchange == "Bybit":
        klines = await fetch_bybit(bybit_sym(sym), interval, start_ms, end_ms)
        if klines:
            return klines
        return await fetch_binance(binance_sym(sym), interval, start_ms, end_ms)

    elif exchange == "Bitget":
        klines = await fetch_bitget(bitget_sym(sym), interval, start_ms, end_ms)
        if klines:
            return klines
        return await fetch_binance(binance_sym(sym), interval, start_ms, end_ms)

    else:
        klines = await fetch_binance(binance_sym(sym), interval, start_ms, end_ms)
        if klines:
            return klines
        return await fetch_okx(okx_inst(sym), interval, start_ms, end_ms)

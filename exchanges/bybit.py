"""Bybit exchange — fetch all contract closed PnL (multi-symbol)."""

import hashlib
import hmac
import time

import httpx
from .keys import BYBIT_API_KEY, BYBIT_SECRET_KEY

# ─── Config ───────────────────────────────────────────────────────────────
API_KEY = BYBIT_API_KEY
SECRET = BYBIT_SECRET_KEY
BASE_URL = "https://api.bybit.com"


# ─── Auth ─────────────────────────────────────────────────────────────────
def _sign(timestamp: str, recv_window: str, query_string: str) -> str:
    sign_str = timestamp + API_KEY + recv_window + query_string
    return hmac.new(SECRET.encode(), sign_str.encode(), hashlib.sha256).hexdigest()


def _headers(query_string: str = "") -> dict:
    ts = str(int(time.time() * 1000))
    rw = "5000"
    return {
        "X-BAPI-API-KEY": API_KEY,
        "X-BAPI-TIMESTAMP": ts,
        "X-BAPI-SIGN": _sign(ts, rw, query_string),
        "X-BAPI-RECV-WINDOW": rw,
        "Content-Type": "application/json",
    }


def _extract_symbol(raw_symbol: str) -> str:
    """Extract base symbol from Bybit symbol like 'BTCUSDT' → 'BTC'."""
    if raw_symbol.endswith("USDT"):
        return raw_symbol[:-4]
    return raw_symbol


# ─── Test Connection ──────────────────────────────────────────────────────
async def test_connection() -> dict:
    """Test Bybit API connection."""
    try:
        path = "/v5/account/wallet-balance"
        params = "accountType=UNIFIED"
        query = params
        headers = _headers(query)
        
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{BASE_URL}{path}?{query}", headers=headers, timeout=10)
            data = resp.json()
        
        if data.get("retCode") == 0:
            return {"status": "ok", "message": "Bybit connection successful"}
        else:
            return {"status": "error", "message": f"Bybit error: {data.get('retMsg', 'Unknown error')}"}
    except Exception as e:
        return {"status": "error", "message": f"Bybit connection failed: {str(e)}"}


# ─── Fetch ────────────────────────────────────────────────────────────────
async def fetch_bybit_trades(days: int = 30) -> list[dict]:
    """Fetch all closed PnL records from Bybit V5 API (multi-symbol, 7-day chunks).

    Returns list of unified trade dicts with 'symbol' field.
    """
    now_ms = int(time.time() * 1000)
    start_ms = now_ms - days * 86400 * 1000
    path = "/v5/position/closed-pnl"
    all_records = []
    chunk_ms = 7 * 86400 * 1000

    chunk_start = start_ms
    while chunk_start < now_ms:
        chunk_end = min(chunk_start + chunk_ms - 1, now_ms)
        cursor = ""

        for _ in range(100):
            params = {
                "category": "linear",
                "startTime": str(chunk_start),
                "endTime": str(chunk_end),
                "limit": "200",
            }
            if cursor:
                params["cursor"] = cursor

            query = "&".join(f"{k}={v}" for k, v in params.items())
            url = f"{BASE_URL}{path}?{query}"
            headers = _headers(query)

            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.get(url, headers=headers, timeout=15)
                    data = resp.json()
            except Exception:
                break

            if data.get("retCode") != 0:
                break

            result = data.get("result", {})
            records = result.get("list", [])
            if not records:
                break

            all_records.extend(records)
            cursor = result.get("nextPageCursor", "")
            if not cursor:
                break

        chunk_start = chunk_end + 1

    # Convert to unified format
    trades = []
    for p in all_records:
        open_ms = int(p.get("createdTime", "0") or "0")
        close_ms = int(p.get("updatedTime", "0") or "0")
        if not close_ms or close_ms <= open_ms:
            close_ms = open_ms

        hold_hours = (close_ms - open_ms) / 3600000 if close_ms > open_ms else 0
        side = p.get("side", "")
        pnl = float(p.get("closedPnl", "0") or "0")
        fee = float(p.get("cumEntryFee", "0") or "0") + float(p.get("cumExitFee", "0") or "0")

        trades.append({
            "id": f"bybit_{p.get('orderId', '')}",
            "exchange": "Bybit",
            "symbol": _extract_symbol(p.get("symbol", "")),
            "direction": "short" if side == "Buy" else "long",  # side=closing order direction, NOT opening
            "open_ms": open_ms,
            "close_ms": close_ms,
            "open_price": float(p.get("avgEntryPrice", "0") or "0"),
            "close_price": float(p.get("avgExitPrice", "0") or "0"),
            "size": p.get("qty", "0"),
            "leverage": p.get("leverage", "1"),
            "pnl": round(pnl, 2),
            "fee": round(fee, 2),
            "hold_hours": round(hold_hours, 2),
        })

    return trades

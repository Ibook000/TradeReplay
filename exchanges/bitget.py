"""Bitget exchange — fetch all contract closed orders (multi-symbol)."""

import hashlib
import hmac
import base64
import time

import httpx
from .keys import BITGET_API_KEY, BITGET_SECRET_KEY, BITGET_PASSPHRASE

# ─── Config ───────────────────────────────────────────────────────────────
API_KEY = BITGET_API_KEY
SECRET = BITGET_SECRET_KEY
PASSPHRASE = BITGET_PASSPHRASE
BASE_URL = "https://api.bitget.com"


# ─── Auth ─────────────────────────────────────────────────────────────────
def _sign(timestamp: str, method: str, path: str, body: str = "") -> str:
    sign_str = timestamp + method.upper() + path + body
    mac = hmac.new(SECRET.encode(), sign_str.encode(), hashlib.sha256)
    return base64.b64encode(mac.digest()).decode()


def _headers(method: str, path: str, body: str = "") -> dict:
    ts = str(int(time.time() * 1000))
    return {
        "ACCESS-KEY": API_KEY,
        "ACCESS-SIGN": _sign(ts, method, path, body),
        "ACCESS-TIMESTAMP": ts,
        "ACCESS-PASSPHRASE": PASSPHRASE,
        "Content-Type": "application/json",
    }


def _extract_symbol(raw_symbol: str) -> str:
    """Extract base symbol from Bitget symbol like 'BTCUSDT' → 'BTC'."""
    if raw_symbol.endswith("USDT"):
        return raw_symbol[:-4]
    return raw_symbol


# ─── Test Connection ──────────────────────────────────────────────────────
async def test_connection() -> dict:
    """Test Bitget API connection."""
    try:
        path = "/api/v2/mix/account/accounts"
        query = "productType=USDT-FUTURES"
        full_path = f"{path}?{query}"
        headers = _headers("GET", full_path)

        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{BASE_URL}{full_path}", headers=headers, timeout=10)
            data = resp.json()

        if data.get("code") == "00000":
            return {"status": "ok", "message": "Bitget connection successful"}
        else:
            return {"status": "error", "message": f"Bitget error: {data.get('msg', 'Unknown error')}"}
    except Exception as e:
        return {"status": "error", "message": f"Bitget connection failed: {str(e)}"}


# ─── Fetch ────────────────────────────────────────────────────────────────
async def fetch_bitget_trades(days: int = 30) -> list[dict]:
    """Fetch all filled close orders from Bitget V2 API (multi-symbol).

    Returns list of unified trade dicts with 'symbol' field.
    """
    now_ms = int(time.time() * 1000)
    start_ms = now_ms - days * 86400 * 1000
    path = "/api/v2/mix/order/orders-history"
    all_records = []
    # Bitget API limits startTime-endTime interval to 90 days
    chunk_ms = 89 * 86400 * 1000

    chunk_start = start_ms
    while chunk_start < now_ms:
        chunk_end = min(chunk_start + chunk_ms, now_ms)
        end_id = ""

        for _ in range(100):
            query = f"productType=USDT-FUTURES&limit=100&startTime={chunk_start}&endTime={chunk_end}"
            if end_id:
                query += f"&idLessThan={end_id}"

            full_path = f"{path}?{query}"
            headers = _headers("GET", full_path)

            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.get(f"{BASE_URL}{full_path}", headers=headers, timeout=15)
                    data = resp.json()
            except Exception:
                break

            if data.get("code") != "00000":
                break

            result = data.get("data", {})
            records = result.get("entrustedList", [])
            end_id = result.get("endId", "")

            if not records:
                break

            all_records.extend(records)
            if len(records) < 100 or not end_id:
                break

        chunk_start = chunk_end + 1

    # Filter: filled close orders only
    close_orders = [
        r for r in all_records
        if r.get("tradeSide") == "close" and r.get("status") == "filled"
    ]

    # Convert to unified format
    trades = []
    for p in close_orders:
        close_ms = int(p.get("cTime", "0") or "0")
        entry_price = float(p.get("posAvg", "0") or "0")
        exit_price = float(p.get("priceAvg", "0") or "0")
        size = float(p.get("size", "0") or "0")
        leverage = p.get("leverage", "1")
        pnl = float(p.get("totalProfits", "0") or "0")
        fee = abs(float(p.get("fee", "0") or "0"))
        direction = p.get("posSide", "")  # "long" or "short"

        # Bitget doesn't provide open_ms from close orders
        # Use 0 as placeholder (K-line will use price-based entry finding)
        open_ms = 0

        trades.append({
            "id": f"bitget_{p.get('orderId', '')}",
            "exchange": "Bitget",
            "symbol": _extract_symbol(p.get("symbol", "")),
            "direction": direction,
            "open_ms": open_ms,
            "close_ms": close_ms,
            "open_price": entry_price,
            "close_price": exit_price,
            "size": str(size),
            "leverage": str(leverage),
            "pnl": round(pnl, 2),
            "fee": round(fee, 2),
            "hold_hours": 0,  # Cannot determine from close orders alone
        })

    return trades

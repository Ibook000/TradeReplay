"""Bitget exchange — fetch all contract closed orders (multi-symbol)."""

import hashlib
import hmac
import base64
import os
import time

import httpx

# ─── Config ───────────────────────────────────────────────────────────────
API_KEY = os.getenv("BITGET_API_KEY", "").strip()
SECRET = os.getenv("BITGET_SECRET_KEY", "").strip()
PASSPHRASE = os.getenv("BITGET_PASSPHRASE", "").strip()
BASE_URL = "https://api.bitget.com"


def _is_configured() -> bool:
    return bool(API_KEY and SECRET and PASSPHRASE)


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
    if not _is_configured():
        return {"status": "error", "message": "Bitget API credentials are not configured"}

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
    """Fetch all closed positions from Bitget V2 position history API.

    Uses /api/v2/mix/position/history-position which provides
    real openTime and closeTime for each position.

    Returns list of unified trade dicts with 'symbol' field.
    """
    if not _is_configured():
        return []

    now_ms = int(time.time() * 1000)
    # Bitget position history API only supports max 90 days
    actual_days = min(days, 89)
    start_ms = now_ms - actual_days * 86400 * 1000
    path = "/api/v2/mix/position/history-position"
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
            records = result.get("list", [])
            end_id = result.get("endId", "")

            if not records:
                break

            all_records.extend(records)
            if len(records) < 100 or not end_id:
                break

        chunk_start = chunk_end + 1

    # Convert to unified format
    trades = []
    for p in all_records:
        open_ms = int(p.get("ctime", "0") or "0")
        close_ms = int(p.get("utime", "0") or "0")
        entry_price = float(p.get("openAvgPrice", "0") or "0")
        exit_price = float(p.get("closeAvgPrice", "0") or "0")
        size = float(p.get("openTotalPos", "0") or "0")
        leverage = p.get("leverage", "1")
        pnl = float(p.get("netProfit", "0") or "0")
        fee = abs(float(p.get("openFee", "0") or "0")) + abs(float(p.get("closeFee", "0") or "0"))
        direction = p.get("holdSide", "")  # "long" or "short"

        hold_hours = (close_ms - open_ms) / 3600000 if open_ms and close_ms else 0

        trades.append({
            "id": f"bitget_{p.get('positionId', '')}",
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
            "hold_hours": round(hold_hours, 1),
        })

    return trades


# ─── Fetch Current Positions ─────────────────────────────────────────────
async def fetch_bitget_positions() -> list[dict]:
    """Fetch current open positions from Bitget."""
    if not _is_configured():
        return []

    path = "/api/v2/mix/position/all-position"
    params = "productType=USDT-FUTURES"
    full_path = f"{path}?{params}"
    headers = _headers("GET", full_path)

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{BASE_URL}{full_path}", headers=headers, timeout=15)
            data = resp.json()

        if data.get("code") != "00000":
            print(f"[Bitget] Positions error: {data.get('msg', 'Unknown')}")
            return []

        positions = []
        for p in data.get("data", []):
            size = float(p.get("total", "0") or "0")
            if size == 0:
                continue

            direction = p.get("holdSide", "")  # "long" or "short"
            entry_price = float(p.get("openPriceAvg", "0") or "0")
            mark_price = float(p.get("markPrice", "0") or "0")
            leverage = p.get("leverage", "1")
            unrealized_pnl = float(p.get("unrealizedPL", "0") or "0")
            margin = float(p.get("marginSize", "0") or "0")

            positions.append({
                "exchange": "Bitget",
                "symbol": _extract_symbol(p.get("symbol", "")),
                "direction": direction,
                "size": size,
                "leverage": str(leverage),
                "entry_price": entry_price,
                "mark_price": mark_price,
                "unrealized_pnl": round(unrealized_pnl, 2),
                "margin": round(margin, 2),
                "liquidation_price": float(p.get("liquidationPrice", "0") or "0"),
                "margin_mode": p.get("marginMode", "cross"),
            })

        return positions
    except Exception as e:
        print(f"[Bitget] Positions fetch failed: {e}")
        return []

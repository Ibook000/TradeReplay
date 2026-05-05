"""OKX exchange — fetch all contract closed positions (multi-symbol)."""

import hashlib
import hmac
import base64
import time
from datetime import datetime, timezone

import httpx
from .keys import OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE

# ─── Config ───────────────────────────────────────────────────────────────
API_KEY = OKX_API_KEY
SECRET = OKX_SECRET_KEY
PASSPHRASE = OKX_PASSPHRASE
BASE_URL = "https://www.okx.com"


# ─── Auth ─────────────────────────────────────────────────────────────────
def _sign(timestamp: str, method: str, path: str, body: str = "") -> str:
    message = timestamp + method.upper() + path + body
    mac = hmac.new(SECRET.encode(), message.encode(), hashlib.sha256)
    return base64.b64encode(mac.digest()).decode()


def _headers(method: str, path: str, body: str = "") -> dict:
    now_utc = datetime.now(timezone.utc)
    ts = now_utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now_utc.microsecond // 1000:03d}Z"
    return {
        "OK-ACCESS-KEY": API_KEY,
        "OK-ACCESS-SIGN": _sign(ts, method, path, body),
        "OK-ACCESS-TIMESTAMP": ts,
        "OK-ACCESS-PASSPHRASE": PASSPHRASE,
        "Content-Type": "application/json",
    }


def _extract_symbol(inst_id: str) -> str:
    """Extract base symbol from OKX instId like 'BTC-USDT-SWAP' → 'BTC'."""
    parts = inst_id.split("-")
    return parts[0] if parts else inst_id


# ─── Test Connection ──────────────────────────────────────────────────────
async def test_connection() -> dict:
    """Test OKX API connection."""
    try:
        path = "/api/v5/account/balance"
        headers = _headers("GET", path)
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{BASE_URL}{path}", headers=headers, timeout=10)
            data = resp.json()
        
        if data.get("code") == "0":
            return {"status": "ok", "message": "OKX connection successful"}
        else:
            return {"status": "error", "message": f"OKX error: {data.get('msg', 'Unknown error')}"}
    except Exception as e:
        return {"status": "error", "message": f"OKX connection failed: {str(e)}"}


# ─── Fetch ────────────────────────────────────────────────────────────────
async def fetch_okx_trades(days: int = 30) -> list[dict]:
    """Fetch all closed SWAP positions from OKX (multi-symbol).

    Returns list of unified trade dicts with 'symbol' field.
    """
    path = "/api/v5/account/positions-history"
    all_positions = []
    after = ""

    for _ in range(100):
        params = {"instType": "SWAP", "limit": "100"}
        if after:
            params["after"] = after

        query = "&".join(f"{k}={v}" for k, v in params.items())
        url = f"{BASE_URL}{path}?{query}"
        headers = _headers("GET", f"{path}?{query}")

        async with httpx.AsyncClient() as client:
            resp = await client.get(url, headers=headers, timeout=15)
            data = resp.json()

        if data.get("code") != "0":
            break

        positions = data.get("data", [])
        if not positions:
            break

        all_positions.extend(positions)
        after = positions[-1].get("posId", "")
        if len(positions) < 100:
            break

    now_ms = int(time.time() * 1000)
    cutoff_ms = now_ms - days * 86400 * 1000

    trades = []
    for p in all_positions:
        close_ms = int(p.get("uTime", "0") or "0")
        if close_ms < cutoff_ms:
            continue

        open_ms = int(p.get("cTime", "0") or "0")
        hold_hours = (close_ms - open_ms) / 3600000 if close_ms > open_ms else 0

        trades.append({
            "id": f"okx_{p.get('posId', '')}_{close_ms}",
            "exchange": "OKX",
            "symbol": _extract_symbol(p.get("instId", "")),
            "direction": p.get("direction", ""),
            "open_ms": open_ms,
            "close_ms": close_ms,
            "open_price": float(p.get("openAvgPx", "0") or "0"),
            "close_price": float(p.get("closeAvgPx", "0") or "0"),
            "size": p.get("closeTotalPos", "0"),
            "leverage": p.get("lever", "1"),
            "pnl": round(float(p.get("realizedPnl", "0") or "0"), 2),
            "fee": round(float(p.get("fee", "0") or "0"), 2),
            "hold_hours": round(hold_hours, 2),
        })

    return trades

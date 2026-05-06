"""Trade Replay — Multi-exchange, multi-symbol trades on K-line chart."""

import os
import time
import json
from pathlib import Path
from collections import Counter
from urllib.parse import urlparse, urlunparse

from dotenv import load_dotenv, set_key
load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
import httpx

from cache import get_cached, get_store_count, maybe_refresh, force_refresh, load_from_disk, start_daily_scheduler, start_weekly_ai_scheduler, _run_weekly_ai_analysis
from klines import fetch_klines, pick_interval
from database import get_ai_analysis, save_ai_analysis, get_ai_history, get_trades as db_get_trades

# ─── App ────────────────────────────────────────────────────────────────
app = FastAPI(title="Trade Replay")
app.mount("/static", StaticFiles(directory=str(Path(__file__).parent / "static")), name="static")


class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path == "/" or path.endswith((".js", ".css")):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

app.add_middleware(NoCacheMiddleware)

load_from_disk()
start_daily_scheduler()
start_weekly_ai_scheduler()


def _validate_config_value(field: str, value) -> str:
    """Validate a submitted config value before writing it to .env."""
    if value is None:
        return ""
    if not isinstance(value, str):
        raise HTTPException(status_code=400, detail=f"{field} must be a string")
    if "\n" in value or "\r" in value:
        raise HTTPException(status_code=400, detail=f"{field} must not contain newline characters")
    return value.strip()


def _normalize_ai_base_url(value: str) -> str:
    """Validate and normalize the AI base URL."""
    if not value:
        return ""

    parsed = urlparse(value)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="AI_BASE_URL must be an absolute http(s) URL")
    if parsed.params or parsed.query or parsed.fragment:
        raise HTTPException(status_code=400, detail="AI_BASE_URL must not include params, query, or fragment")

    normalized_path = parsed.path.rstrip("/")
    return urlunparse((parsed.scheme.lower(), parsed.netloc, normalized_path, "", "", ""))


def _mask_key(key: str) -> str:
    """Mask API key for display."""
    if not key:
        return ""
    if len(key) > 8:
        return key[:4] + "..." + key[-4:]
    return "***"


# ─── API Endpoints ───────────────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
async def index():
    return (Path(__file__).parent / "static" / "index.html").read_text()


@app.get("/api/symbols")
async def get_symbols(days: int = Query(default=90, ge=1, le=365)):
    maybe_refresh()
    trades = get_cached(days)
    counter = Counter(t.get("symbol", "BTC") for t in trades)
    symbols = [{"symbol": s, "count": c} for s, c in counter.most_common()]
    return {"symbols": symbols, "cached": get_store_count()}


@app.get("/api/trades")
async def get_trades(
    days: int = Query(default=30, ge=1, le=365),
    symbol: str = Query(default="", description="Filter by symbol"),
    exchange: str = Query(default="", description="Filter by exchange (OKX, Bybit, Bitget)"),
):
    trades = get_cached(days)
    if symbol:
        symbol = symbol.upper()
        trades = [t for t in trades if t.get("symbol", "BTC") == symbol]
    if exchange:
        exchange = exchange.capitalize()
        trades = [t for t in trades if t.get("exchange", "").capitalize() == exchange]
    return {"trades": trades, "count": len(trades)}


@app.post("/api/refresh")
async def api_force_refresh():
    force_refresh()
    return {"status": "refreshing", "cached": get_store_count()}


@app.get("/api/klines")
async def get_klines(
    start_ms: int = Query(...),
    end_ms: int = Query(...),
    interval: str = Query(default="auto"),
    symbol: str = Query(default="BTC"),
    exchange: str = Query(default="", description="OKX, Bybit, or Bitget"),
):
    """Fetch K-lines for a specific trade. Exchange determines source."""
    if interval == "auto":
        hours = (end_ms - start_ms) / 3600000
        interval = pick_interval(hours)
    klines = await fetch_klines(symbol, interval, start_ms, end_ms, exchange)
    return {"klines": klines, "interval": interval, "count": len(klines)}


@app.get("/api/klines_range")
async def get_klines_range(
    days: int = Query(default=7, ge=1, le=365),
    interval: str = Query(default="1h"),
    symbol: str = Query(default="BTC"),
):
    """Fetch overview K-lines. Tries Binance first, then OKX."""
    now_ms = int(time.time() * 1000)
    start_ms = now_ms - days * 86400 * 1000
    klines = await fetch_klines(symbol, interval, start_ms, now_ms)
    return {"klines": klines, "interval": interval, "count": len(klines)}


@app.get("/api/config")
async def get_config():
    """Get all configuration (masked keys)."""
    # Reload keys from env
    from exchanges import keys
    import importlib
    importlib.reload(keys)
    
    return {
        "okx": {
            "api_key": _mask_key(keys.OKX_API_KEY),
            "secret_key": _mask_key(keys.OKX_SECRET_KEY),
            "passphrase": _mask_key(keys.OKX_PASSPHRASE),
            "configured": bool(keys.OKX_API_KEY)
        },
        "bybit": {
            "api_key": _mask_key(keys.BYBIT_API_KEY),
            "secret_key": _mask_key(keys.BYBIT_SECRET_KEY),
            "configured": bool(keys.BYBIT_API_KEY)
        },
        "bitget": {
            "api_key": _mask_key(keys.BITGET_API_KEY),
            "secret_key": _mask_key(keys.BITGET_SECRET_KEY),
            "configured": bool(keys.BITGET_API_KEY)
        },
        "ai": {
            "base_url": os.getenv("AI_BASE_URL", "https://api.deepseek.com/v1"),
            "model": os.getenv("AI_MODEL", "deepseek-chat"),
            "api_key": _mask_key(os.getenv("AI_API_KEY", "")),
            "configured": bool(os.getenv("AI_API_KEY", ""))
        }
    }


@app.post("/api/config")
async def update_config(request: Request):
    """Update configuration."""
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Configuration payload must be a JSON object")
    for field, value in body.items():
        _validate_config_value(str(field), value)
    
    env_path = Path(__file__).parent / ".env"
    env_path.touch(exist_ok=True)
    
    # Define and validate all possible config keys. Empty values mean "keep existing".
    config_map = {
        # OKX
        "OKX_API_KEY": _validate_config_value("okx_api_key", body.get("okx_api_key", "")),
        "OKX_SECRET_KEY": _validate_config_value("okx_secret_key", body.get("okx_secret_key", "")),
        "OKX_PASSPHRASE": _validate_config_value("okx_passphrase", body.get("okx_passphrase", "")),
        # Bybit
        "BYBIT_API_KEY": _validate_config_value("bybit_api_key", body.get("bybit_api_key", "")),
        "BYBIT_SECRET_KEY": _validate_config_value("bybit_secret_key", body.get("bybit_secret_key", "")),
        # Bitget
        "BITGET_API_KEY": body.get("bitget_api_key", ""),
        "BITGET_SECRET_KEY": body.get("bitget_secret_key", ""),
        "BITGET_PASSPHRASE": body.get("bitget_passphrase", ""),
        # AI
        "AI_BASE_URL": _normalize_ai_base_url(_validate_config_value("ai_base_url", body.get("ai_base_url", ""))),
        "AI_API_KEY": _validate_config_value("ai_api_key", body.get("ai_api_key", "")),
        "AI_MODEL": _validate_config_value("ai_model", body.get("ai_model", "")),
    }
    
    # Safely update provided values in .env using python-dotenv quoting.
    for key, value in config_map.items():
        if value:
            set_key(env_path, key, value, quote_mode="always")
    
    # Reload environment
    load_dotenv(env_path, override=True)
    
    # Reinitialize exchange connections
    from exchanges import reinit_exchanges
    reinit_exchanges()
    
    return {"status": "ok", "message": "Configuration updated"}


@app.get("/api/ai_analysis")
async def ai_analysis(week: str = Query("", description="Week start date YYYY-MM-DD, empty for latest")):
    """Get AI analysis for a specific week, or the latest one."""
    if week:
        result = get_ai_analysis("ALL", week)
        if result:
            return {"found": True, **result}
        return {"found": False, "week": week}
    else:
        history = get_ai_history("ALL", limit=1)
        if history:
            return {"found": True, **history[0]}
        return {"found": False, "reason": "no_analysis_yet"}


@app.get("/api/ai_history")
async def ai_history(limit: int = Query(12, ge=1, le=52)):
    """Get AI analysis history, newest first."""
    history = get_ai_history("ALL", limit=limit)
    return {"history": history, "count": len(history)}


@app.post("/api/test_ai")
async def test_ai():
    """Test AI connection with the current OpenAI-compatible configuration."""
    api_key = os.getenv("AI_API_KEY", "").strip()
    base_url = os.getenv("AI_BASE_URL", "https://api.deepseek.com/v1").strip().rstrip("/")
    model = os.getenv("AI_MODEL", "deepseek-chat").strip()

    if not api_key:
        return {"status": "error", "message": "AI API key is not configured"}
    if not base_url:
        return {"status": "error", "message": "AI Base URL is not configured"}
    if not model:
        return {"status": "error", "message": "AI model is not configured"}

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "user", "content": "Reply with OK."},
                    ],
                    "temperature": 0,
                    "max_tokens": 8,
                },
            )

        if resp.status_code == 200:
            return {"status": "ok", "message": f"Connected to {model}"}

        error_detail = resp.text[:200].strip() or resp.reason_phrase
        return {
            "status": "error",
            "message": f"AI test failed ({resp.status_code}): {error_detail}",
        }
    except Exception as e:
        return {"status": "error", "message": f"AI test failed: {e}"}


@app.post("/api/ai_trigger")
async def ai_trigger():
    """Manually trigger a weekly AI analysis (for testing)."""
    import threading
    threading.Thread(target=_run_weekly_ai_analysis, daemon=True).start()
    return {"status": "triggered", "message": "Weekly AI analysis started in background"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=80)

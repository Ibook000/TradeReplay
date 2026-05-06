"""Trade Replay — Multi-exchange, multi-symbol trades on K-line chart."""

import os
import time
import json
from pathlib import Path
from collections import Counter

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI, Query, Request
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
    exchange: str = Query(default="", description="Filter by exchange (OKX, Bybit)"),
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
    exchange: str = Query(default="", description="OKX or Bybit"),
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
    
    env_path = Path(__file__).parent / ".env"
    
    # Read existing .env content
    env_content = ""
    if env_path.exists():
        env_content = env_path.read_text()
    
    # Define all possible config keys
    config_map = {
        # OKX
        "OKX_API_KEY": body.get("okx_api_key", ""),
        "OKX_SECRET_KEY": body.get("okx_secret_key", ""),
        "OKX_PASSPHRASE": body.get("okx_passphrase", ""),
        # Bybit
        "BYBIT_API_KEY": body.get("bybit_api_key", ""),
        "BYBIT_SECRET_KEY": body.get("bybit_secret_key", ""),
        # AI
        "AI_BASE_URL": body.get("ai_base_url", ""),
        "AI_API_KEY": body.get("ai_api_key", ""),
        "AI_MODEL": body.get("ai_model", ""),
    }
    
    # Update or add config
    lines = env_content.split("\n")
    new_lines = []
    updated_keys = set()
    
    for line in lines:
        key = line.split("=")[0].strip() if "=" in line else ""
        if key in config_map:
            if config_map[key]:  # Only update if value is provided
                new_lines.append(f"{key}={config_map[key]}")
                updated_keys.add(key)
            else:
                new_lines.append(line)  # Keep existing value
        else:
            new_lines.append(line)
    
    # Add any new keys that weren't in the file
    for key, value in config_map.items():
        if key not in updated_keys and value:
            new_lines.append(f"{key}={value}")
    
    # Write back to .env
    env_path.write_text("\n".join(new_lines))
    
    # Reload environment
    load_dotenv(env_path, override=True)
    
    # Reinitialize exchange connections
    from exchanges import reinit_exchanges
    reinit_exchanges()
    
    return {"status": "ok", "message": "Configuration updated"}


@app.post("/api/test_exchange")
async def test_exchange(request: Request):
    """Test exchange connection."""
    body = await request.json()
    exchange = body.get("exchange", "").lower()
    
    try:
        if exchange == "okx":
            from exchanges.okx import test_connection
            result = await test_connection()
            return result
        elif exchange == "bybit":
            from exchanges.bybit import test_connection
            result = await test_connection()
            return result
        else:
            return {"status": "error", "message": "Unknown exchange"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


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


@app.post("/api/ai_trigger")
async def ai_trigger():
    """Manually trigger a weekly AI analysis (for testing)."""
    import threading
    threading.Thread(target=_run_weekly_ai_analysis, daemon=True).start()
    return {"status": "triggered", "message": "Weekly AI analysis started in background"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=80)

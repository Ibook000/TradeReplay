"""Trade Replay — Multi-exchange, multi-symbol trades on K-line chart."""

import time
from pathlib import Path
from collections import Counter

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from cache import get_cached, get_store_count, maybe_refresh, force_refresh, load_from_disk, start_daily_scheduler
from klines import fetch_klines, pick_interval

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
):
    trades = get_cached(days)
    if symbol:
        symbol = symbol.upper()
        trades = [t for t in trades if t.get("symbol", "BTC") == symbol]
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=80)

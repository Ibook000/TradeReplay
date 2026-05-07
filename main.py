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
from database import get_ai_analysis, save_ai_analysis, get_ai_history, get_trade_review, save_trade_review, get_trades as db_get_trades

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
    direction: str = Query(default="", description="Filter by direction (long/short)"),
    pnl: str = Query(default="", description="Filter by PnL (win/loss)"),
    leverage: int = Query(default=0, ge=0, description="Min leverage filter"),
):
    trades = get_cached(days)
    if symbol:
        symbol = symbol.upper()
        trades = [t for t in trades if t.get("symbol", "BTC") == symbol]
    if exchange:
        exchange = exchange.capitalize()
        trades = [t for t in trades if t.get("exchange", "").capitalize() == exchange]
    if direction:
        trades = [t for t in trades if t.get("direction") == direction]
    if pnl == "win":
        trades = [t for t in trades if t.get("pnl", 0) > 0]
    elif pnl == "loss":
        trades = [t for t in trades if t.get("pnl", 0) <= 0]
    if leverage > 0:
        trades = [t for t in trades if (t.get("leverage") or 0) >= leverage]
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
    okx_api_key = os.getenv("OKX_API_KEY", "")
    okx_secret_key = os.getenv("OKX_SECRET_KEY", "")
    okx_passphrase = os.getenv("OKX_PASSPHRASE", "")
    bybit_api_key = os.getenv("BYBIT_API_KEY", "")
    bybit_secret_key = os.getenv("BYBIT_SECRET_KEY", "")
    bitget_api_key = os.getenv("BITGET_API_KEY", "")
    bitget_secret_key = os.getenv("BITGET_SECRET_KEY", "")
    bitget_passphrase = os.getenv("BITGET_PASSPHRASE", "")

    return {
        "okx": {
            "api_key": _mask_key(okx_api_key),
            "secret_key": _mask_key(okx_secret_key),
            "passphrase": _mask_key(okx_passphrase),
            "configured": bool(okx_api_key and okx_secret_key and okx_passphrase)
        },
        "bybit": {
            "api_key": _mask_key(bybit_api_key),
            "secret_key": _mask_key(bybit_secret_key),
            "configured": bool(bybit_api_key and bybit_secret_key)
        },
        "bitget": {
            "api_key": _mask_key(bitget_api_key),
            "secret_key": _mask_key(bitget_secret_key),
            "configured": bool(bitget_api_key and bitget_secret_key and bitget_passphrase)
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


@app.post("/api/review_trade")
async def review_trade(request: Request):
    """AI review for a single trade. Returns cached result if available."""
    import re as _re
    body = await request.json()
    trade_id = body.get("trade_id", "")
    if not trade_id:
        raise HTTPException(status_code=400, detail="trade_id required")

    # Check cache first
    cached = get_trade_review(trade_id)
    if cached:
        return {"found": True, "cached": True, **cached}

    # Find the trade in cache
    trades = get_cached(days=365)
    trade = next((t for t in trades if t.get("id") == trade_id), None)
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")

    # Fetch K-lines for context
    symbol = trade.get("symbol", "BTC")
    exchange = trade.get("exchange", "")
    no_open_time = exchange == "Bybit"
    padding = 30 * 86400 * 1000 if no_open_time else 12 * 3600 * 1000
    start_ms = (trade.get("close_ms", 0) if no_open_time else trade.get("open_ms", 0)) - padding
    end_ms = trade.get("close_ms", 0) + (12 * 3600 * 1000 if no_open_time else padding)
    klines = await fetch_klines(symbol, "5m", start_ms, end_ms, exchange)

    # Build simplified K-line summary around the trade window
    open_ms = trade.get("open_ms", 0)
    close_ms = trade.get("close_ms", 0)
    trade_start = min(open_ms, close_ms) // 1000 if open_ms else close_ms // 1000
    trade_end = close_ms // 1000
    # Filter K-lines within trade window (with some context)
    context_start = trade_start - 3600  # 1h before
    context_end = trade_end + 3600      # 1h after
    relevant = [k for k in klines if k.get("time", 0) >= context_start and k.get("time", 0) <= context_end]

    # Simplify: take every Nth candle to keep prompt small
    if len(relevant) > 40:
        step = len(relevant) // 30
        relevant = relevant[::step][:30]

    kline_text = ""
    for k in relevant:
        ts = k.get("time", 0)
        from datetime import datetime, timezone, timedelta
        dt = datetime.fromtimestamp(ts, tz=timezone(timedelta(hours=8)))
        kline_text += f"  {dt.strftime('%m-%d %H:%M')} O:{k['open']:.2f} H:{k['high']:.2f} L:{k['low']:.2f} C:{k['close']:.2f}\n"

    direction = trade.get("direction", "long")
    entry = trade.get("open_price", 0)
    exit_p = trade.get("close_price", 0)
    hold = trade.get("hold_hours", 0)
    lev = trade.get("leverage", 1)
    pnl = trade.get("pnl", 0)
    fee = trade.get("fee", 0)

    # Calculate price change %
    price_chg = ((exit_p - entry) / entry * 100) if entry else 0
    if direction == "short":
        price_chg = -price_chg

    prompt = f"""分析以下单笔合约交易，用犀利的毒舌风格点评。

交易信息:
- 币种: {symbol} ({exchange})
- 方向: {direction.upper()} {lev}x
- 入场价: {entry:.4f}
- 出场价: {exit_p:.4f}
- 价格变动: {price_chg:+.2f}%
- 持仓时间: {hold:.1f} 小时
- 盈亏: {pnl:+.2f} USDT
- 手续费: {fee:.2f} USDT

K线数据 (5分钟, UTC+8):
{kline_text}

严格按以下JSON格式输出，不要输出任何其他内容:
{{
  "summary": "一句话毒舌总评，20字以内",
  "score": 0到100的整数评分,
  "entry_analysis": "入场时机分析，用数据说话，50字以内",
  "exit_analysis": "出场时机分析，用数据说话，50字以内",
  "top_issues": [
    {{"title": "问题标题", "detail": "用K线数据说明", "severity": "high或medium或low"}}
  ],
  "action_items": [
    {{"action": "具体改进建议", "priority": 1到5}}
  ]
}}

要求:
1. top_issues 最多3个
2. action_items 最多3个
3. 语气犀利毒舌，直接骂，不要客套
4. 引用具体K线价格数据"""

    api_key = os.getenv("AI_API_KEY", "").strip()
    base_url = os.getenv("AI_BASE_URL", "https://api.deepseek.com/v1").strip().rstrip("/")
    model = os.getenv("AI_MODEL", "deepseek-chat").strip()

    if not api_key:
        raise HTTPException(status_code=500, detail="AI API key not configured")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "你是犀利的合约交易教练。必须严格输出合法JSON，不要输出任何其他文本、markdown或代码块标记。"},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.7,
                    "max_tokens": 2000
                }
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"AI API error: {resp.status_code}")

        raw = resp.json()["choices"][0]["message"]["content"].strip()
        # Strip markdown code block if present
        if raw.startswith("```"):
            raw = _re.sub(r'^```(?:json)?\s*', '', raw)
            raw = _re.sub(r'\s*```$', '', raw)

        # Validate JSON
        try:
            parsed = json.loads(raw)
            review_text = json.dumps(parsed, ensure_ascii=False)
        except json.JSONDecodeError:
            review_text = raw

        # Save to DB
        save_trade_review(trade_id, exchange, symbol, direction, pnl, review_text)

        return {"found": True, "cached": False, "trade_id": trade_id, "review": review_text}

    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"AI request failed: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "80")))

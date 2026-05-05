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
            "passphrase": keys.OKX_PASSPHRASE,
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


@app.post("/api/ai_analyze")
async def ai_analyze(request: Request):
    """AI analyzes trade data and provides harsh but constructive feedback."""
    body = await request.json()
    trades = body.get("trades", [])
    symbol = body.get("symbol", "BTC")
    days = body.get("days", 30)
    
    if not trades:
        return {"error": "No trades to analyze"}
    
    # Get AI config
    api_key = os.getenv("AI_API_KEY", "")
    base_url = os.getenv("AI_BASE_URL", "https://api.deepseek.com/v1")
    model = os.getenv("AI_MODEL", "deepseek-chat")
    
    if not api_key:
        return {"error": "AI not configured. Please set AI_API_KEY in Settings."}
    
    # Prepare trade summary for AI
    total_pnl = sum(t.get("pnl", 0) for t in trades)
    win_trades = [t for t in trades if t.get("pnl", 0) > 0]
    lose_trades = [t for t in trades if t.get("pnl", 0) <= 0]
    win_rate = len(win_trades) / len(trades) * 100 if trades else 0
    
    # Calculate average win/loss
    avg_win = sum(t.get("pnl", 0) for t in win_trades) / len(win_trades) if win_trades else 0
    avg_loss = sum(t.get("pnl", 0) for t in lose_trades) / len(lose_trades) if lose_trades else 0
    
    # Find biggest win and loss
    biggest_win = max((t.get("pnl", 0) for t in trades), default=0)
    biggest_loss = min((t.get("pnl", 0) for t in trades), default=0)
    
    # Calculate average hold time
    avg_hold = sum(t.get("hold_hours", 0) for t in trades) / len(trades) if trades else 0
    
    # Find repeated mistakes (losing trades with same direction)
    long_losses = [t for t in lose_trades if t.get("direction") == "long"]
    short_losses = [t for t in lose_trades if t.get("direction") == "short"]
    
    # Prepare trade details for AI
    trade_summary = f"""
=== {symbol} 交易数据分析 ({days}天) ===

总交易数: {len(trades)}
总盈亏: {total_pnl:.2f} USDT
胜率: {win_rate:.1f}%
平均盈利: {avg_win:.2f} USDT
平均亏损: {avg_loss:.2f} USDT
最大单笔盈利: {biggest_win:.2f} USDT
最大单笔亏损: {biggest_loss:.2f} USDT
平均持仓时间: {avg_hold:.1f} 小时

亏损交易分析:
- 做多亏损: {len(long_losses)} 笔
- 做空亏损: {len(short_losses)} 笔

最近5笔交易:
"""
    
    # Add recent trades
    recent_trades = trades[-5:] if len(trades) > 5 else trades
    for i, t in enumerate(recent_trades, 1):
        pnl = t.get("pnl", 0)
        direction = t.get("direction", "unknown")
        entry = t.get("open_price", 0)
        exit_price = t.get("close_price", 0)
        hold = t.get("hold_hours", 0)
        leverage = t.get("leverage", 1)
        
        trade_summary += f"""
{i}. {direction.upper()} {leverage}x | Entry: {entry:.2f} → Exit: {exit_price:.2f} | Hold: {hold:.1f}h | PnL: {pnl:+.2f} USDT
"""
    
    prompt = f"""你是一个犀利的交易教练，专门分析合约交易数据，用直接、尖锐的语言指出问题，鞭策交易者改进。

请分析以下交易数据，用中文回答，要求：
1. 直接指出最严重的问题，不要客套
2. 用数据说话，引用具体数字
3. 指出重复犯的错误
4. 给出可执行的改进建议
5. 语气要犀利，像教练骂醒学员一样

{trade_summary}

请开始你的毒舌分析："""

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "你是一个犀利的交易教练，专门分析合约交易数据，用直接、尖锐的语言指出问题，鞭策交易者改进。"},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.7,
                    "max_tokens": 1500
                },
                timeout=30.0
            )
            
            if response.status_code == 200:
                result = response.json()
                analysis = result["choices"][0]["message"]["content"]
                return {"analysis": analysis, "symbol": symbol, "days": days}
            else:
                return {"error": f"API request failed: {response.status_code} - {response.text}"}
                
    except Exception as e:
        return {"error": f"AI analysis failed: {str(e)}"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=80)

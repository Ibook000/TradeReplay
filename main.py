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


@app.post("/api/ai_analyze")
async def ai_analyze(request: Request):
    """AI analyzes trade data and provides harsh but constructive feedback."""
    body = await request.json()
    trades = body.get("trades", [])
    symbol = body.get("symbol", "BTC")
    days = body.get("days", 30)
    
    if not trades:
        return {"error": "No trades to analyze"}
    
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
    
    # Call DeepSeek API
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        return {"error": "DEEPSEEK_API_KEY not configured"}
    
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
                "https://api.deepseek.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "deepseek-chat",
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
                return {"error": f"API request failed: {response.status_code}"}
                
    except Exception as e:
        return {"error": f"AI analysis failed: {str(e)}"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=80)

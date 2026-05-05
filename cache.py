"""Trade data cache — PostgreSQL persistence, background refresh."""

import time
import threading
from pathlib import Path

from exchanges import get_all_trades
from database import init_db, upsert_trades, get_trades, get_symbol_counts, get_total_count, migrate_from_json

# ─── Config ───────────────────────────────────────────────────────────────
DATA_DIR = Path(__file__).parent / "data"
TRADES_FILE = DATA_DIR / "all_trades.json"
REFRESH_INTERVAL = 300
DAILY_REFRESH_HOUR = 3  # 每天凌晨3点自动刷新

_lock = threading.Lock()
_last_refresh: float = 0


def load_from_disk():
    """Initialize database and migrate JSON data if exists."""
    init_db()
    
    # Migrate existing JSON data to PostgreSQL
    if TRADES_FILE.exists():
        migrate_from_json(str(TRADES_FILE))
        # Rename JSON file to avoid re-migration
        TRADES_FILE.rename(TRADES_FILE.with_suffix(".json.migrated"))
        print(f"[CACHE] Migrated JSON data to PostgreSQL", flush=True)
    
    total = get_total_count()
    print(f"[CACHE] Database ready with {total} trades", flush=True)


def get_cached(days: int) -> list[dict]:
    """Return trades closed within the last N days."""
    return get_trades(days=days)


def get_store_count() -> int:
    """Total trades in store."""
    return get_total_count()


def do_refresh():
    """Fetch new trades from all exchanges and merge into database."""
    global _last_refresh
    try:
        import asyncio
        loop = asyncio.new_event_loop()
        new_trades = loop.run_until_complete(get_all_trades(days=180))
        loop.close()
        
        new_count = upsert_trades(new_trades)
        _last_refresh = time.time()
        total = get_total_count()
        print(f"[CACHE] Refresh done: +{new_count} new, total {total}", flush=True)
    except Exception as e:
        print(f"[CACHE] Refresh failed: {e}", flush=True)


def maybe_refresh():
    """Trigger background refresh if stale."""
    global _last_refresh
    if time.time() - _last_refresh < REFRESH_INTERVAL:
        return
    _last_refresh = time.time()
    t = threading.Thread(target=do_refresh, daemon=True)
    t.start()
    print("[CACHE] Background refresh started", flush=True)


def force_refresh():
    """Force immediate background refresh."""
    global _last_refresh
    _last_refresh = 0
    maybe_refresh()


def _daily_refresh_loop():
    """Background loop that runs do_refresh() once per day."""
    while True:
        from datetime import datetime, timedelta
        now = datetime.now()
        # 计算下一次刷新时间
        next_refresh = now.replace(hour=DAILY_REFRESH_HOUR, minute=0, second=0, microsecond=0)
        if now >= next_refresh:
            next_refresh += timedelta(days=1)
        
        wait_seconds = (next_refresh - now).total_seconds()
        print(f"[CACHE] Next daily refresh at {next_refresh.strftime('%Y-%m-%d %H:%M:%S')}", flush=True)
        
        time.sleep(wait_seconds)
        print(f"[CACHE] Daily refresh triggered", flush=True)
        do_refresh()


def start_daily_scheduler():
    """Start the daily refresh background thread."""
    t = threading.Thread(target=_daily_refresh_loop, daemon=True)
    t.start()
    print(f"[CACHE] Daily scheduler started (refresh at {DAILY_REFRESH_HOUR}:00)", flush=True)


# ─── Weekly AI Analysis Scheduler ───────────────────────────────────────
def _get_week_range():
    """Get previous week's Monday-Sunday date range (as strings YYYY-MM-DD)."""
    from datetime import datetime, timedelta
    today = datetime.now().date()
    # Days since Monday (0=Mon, 6=Sun)
    days_since_monday = today.weekday()
    # This Monday
    this_monday = today - timedelta(days=days_since_monday)
    # Last Monday
    last_monday = this_monday - timedelta(days=7)
    return str(last_monday), str(this_monday)


def _run_weekly_ai_analysis():
    """Run AI analysis for the previous week's trades."""
    import os
    import httpx
    from database import get_trades as db_get_trades, save_ai_analysis
    from datetime import datetime, timedelta

    week_start, week_end = _get_week_range()
    print(f"[AI] Weekly analysis for {week_start} ~ {week_end}", flush=True)

    api_key = os.getenv("AI_API_KEY", "")
    base_url = os.getenv("AI_BASE_URL", "https://api.deepseek.com/v1")
    model = os.getenv("AI_MODEL", "deepseek-chat")
    if not api_key:
        print("[AI] No API key configured, skipping", flush=True)
        return

    # Calculate days to cover the week
    d_start = datetime.strptime(week_start, "%Y-%m-%d").date()
    d_end = datetime.strptime(week_end, "%Y-%m-%d").date()
    days = (d_end - d_start).days + 1  # 8 days to be safe

    trades = db_get_trades(days=days, symbol="")
    # Filter to only trades within the week
    start_ms = int(datetime.strptime(week_start, "%Y-%m-%d").timestamp() * 1000)
    end_ms = int(datetime.strptime(week_end, "%Y-%m-%d").timestamp() * 1000)
    week_trades = [t for t in trades if t.get("close_ms", 0) >= start_ms and t.get("close_ms", 0) < end_ms]

    if not week_trades:
        print(f"[AI] No trades for week {week_start}, skipping", flush=True)
        return

    total_pnl = sum(t.get("pnl", 0) for t in week_trades)
    win_trades = [t for t in week_trades if t.get("pnl", 0) > 0]
    lose_trades = [t for t in week_trades if t.get("pnl", 0) <= 0]
    win_rate = len(win_trades) / len(week_trades) * 100 if week_trades else 0
    avg_win = sum(t.get("pnl", 0) for t in win_trades) / len(win_trades) if win_trades else 0
    avg_loss = sum(t.get("pnl", 0) for t in lose_trades) / len(lose_trades) if lose_trades else 0
    biggest_win = max((t.get("pnl", 0) for t in week_trades), default=0)
    biggest_loss = min((t.get("pnl", 0) for t in week_trades), default=0)
    avg_hold = sum(t.get("hold_hours", 0) for t in week_trades) / len(week_trades) if week_trades else 0
    long_losses = [t for t in lose_trades if t.get("direction") == "long"]
    short_losses = [t for t in lose_trades if t.get("direction") == "short"]

    trade_summary = f"""
=== 周报 ({week_start} ~ {week_end}) ===

总交易数: {len(week_trades)}
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
    recent = week_trades[-5:] if len(week_trades) > 5 else week_trades
    for i, t in enumerate(recent, 1):
        pnl = t.get("pnl", 0)
        d = t.get("direction", "?")
        entry = t.get("open_price", 0)
        exit_p = t.get("close_price", 0)
        hold = t.get("hold_hours", 0)
        lev = t.get("leverage", 1)
        trade_summary += f"{i}. {d.upper()} {lev}x | Entry: {entry:.2f} -> Exit: {exit_p:.2f} | Hold: {hold:.1f}h | PnL: {pnl:+.2f} USDT\n"
    prompt = f"""你是一个犀利的交易教练，专门分析合约交易数据，用直接、尖锐的语言指出问题，鞭策交易者改进。

请分析以下一周的交易数据，用中文回答，要求：
1. 直接指出最严重的问题，不要客套
2. 用数据说话，引用具体数字
3. 指出重复犯的错误
4. 给出可执行的改进建议
5. 语气要犀利，像教练骂醒学员一样

{trade_summary}

请开始你的毒舌分析："""

    try:
        import httpx as _httpx
        with _httpx.Client(timeout=60.0) as client:
            resp = client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "你是一个犀利的交易教练，专门分析合约交易数据，用直接、尖锐的语言指出问题，鞭策交易者改进。"},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.7,
                    "max_tokens": 1500
                }
            )
            if resp.status_code == 200:
                analysis = resp.json()["choices"][0]["message"]["content"]
                save_ai_analysis("ALL", week_start, week_end,
                                 len(week_trades), total_pnl, win_rate, analysis)
                print(f"[AI] Weekly analysis saved for {week_start}", flush=True)
            else:
                print(f"[AI] API error: {resp.status_code} {resp.text[:200]}", flush=True)
    except Exception as e:
        print(f"[AI] Weekly analysis failed: {e}", flush=True)


def _weekly_ai_loop():
    """Background loop that runs AI analysis every Monday at 00:00."""
    while True:
        from datetime import datetime, timedelta
        now = datetime.now()
        # Calculate next Monday 00:00
        days_until_monday = (7 - now.weekday()) % 7
        if days_until_monday == 0 and now.hour >= 0:
            days_until_monday = 7
        next_monday = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=days_until_monday)
        wait_seconds = (next_monday - now).total_seconds()
        print(f"[AI] Next weekly analysis at {next_monday.strftime('%Y-%m-%d %H:%M:%S')}", flush=True)
        time.sleep(wait_seconds)
        _run_weekly_ai_analysis()


def start_weekly_ai_scheduler():
    """Start the weekly AI analysis background thread."""
    t = threading.Thread(target=_weekly_ai_loop, daemon=True)
    t.start()
    print("[CACHE] Weekly AI scheduler started (Monday 00:00)", flush=True)

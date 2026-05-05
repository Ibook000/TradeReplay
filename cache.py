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

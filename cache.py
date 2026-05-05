"""Trade data cache — disk persistence, background refresh."""

import json
import time
import threading
from pathlib import Path
from datetime import datetime, timedelta

from exchanges import get_all_trades

# ─── Config ───────────────────────────────────────────────────────────────
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
TRADES_FILE = DATA_DIR / "all_trades.json"
REFRESH_INTERVAL = 300
DAILY_REFRESH_HOUR = 3  # 每天凌晨3点自动刷新

_lock = threading.Lock()
_trade_store: dict[str, dict] = {}
_last_refresh: float = 0


def load_from_disk():
    """Load cached trades from JSON file."""
    global _trade_store
    if TRADES_FILE.exists():
        try:
            trades = json.loads(TRADES_FILE.read_text())
            with _lock:
                _trade_store = {t["id"]: t for t in trades}
            print(f"[CACHE] Loaded {len(_trade_store)} trades from disk", flush=True)
        except Exception as e:
            print(f"[CACHE] Load failed: {e}", flush=True)


def save_to_disk():
    """Persist current trade store to JSON file."""
    with _lock:
        trades = sorted(_trade_store.values(), key=lambda t: t["close_ms"])
    TRADES_FILE.write_text(json.dumps(trades, indent=2))


def get_cached(days: int) -> list[dict]:
    """Return trades closed within the last N days."""
    now_ms = int(time.time() * 1000)
    cutoff = now_ms - days * 86400 * 1000
    with _lock:
        trades = [t for t in _trade_store.values() if t["close_ms"] >= cutoff]
    trades.sort(key=lambda t: t["close_ms"])
    return trades


def get_store_count() -> int:
    """Total trades in store."""
    return len(_trade_store)


def do_refresh():
    """Fetch new trades from all exchanges and merge into store."""
    global _last_refresh
    try:
        import asyncio
        loop = asyncio.new_event_loop()
        new_trades = loop.run_until_complete(get_all_trades(days=180))
        loop.close()
        new_count = 0
        with _lock:
            for t in new_trades:
                tid = t["id"]
                if tid not in _trade_store:
                    new_count += 1
                _trade_store[tid] = t
        save_to_disk()
        _last_refresh = time.time()
        print(f"[CACHE] Refresh done: +{new_count} new, total {len(_trade_store)}", flush=True)
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

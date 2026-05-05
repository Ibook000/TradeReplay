"""
Exchange module — unified interface for fetching trade data.

Usage:
    from exchanges import get_all_trades
    trades = await get_all_trades(days=30)

To add a new exchange:
    1. Create exchanges/newexchange.py
    2. Implement the fetch_trades(days) function
    3. Register in EXCHANGES dict below
"""

from .okx import fetch_okx_trades
from .bybit import fetch_bybit_trades

# ─── Registry ─────────────────────────────────────────────────────────────
# Add new exchanges here: "Name": fetch_function
EXCHANGES = {
    "OKX": fetch_okx_trades,
    "Bybit": fetch_bybit_trades,
}


def reinit_exchanges():
    """Reinitialize exchange connections after config change."""
    import importlib
    from . import okx, bybit
    importlib.reload(okx)
    importlib.reload(bybit)
    # Update the registry with reloaded functions
    EXCHANGES["OKX"] = okx.fetch_okx_trades
    EXCHANGES["Bybit"] = bybit.fetch_bybit_trades


async def get_all_trades(days: int = 30) -> list[dict]:
    """Fetch trades from all registered exchanges in parallel."""
    import asyncio

    results = await asyncio.gather(
        *[fetch_fn(days) for fetch_fn in EXCHANGES.values()],
        return_exceptions=True
    )

    all_trades = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            name = list(EXCHANGES.keys())[i]
            print(f"[WARN] {name} fetch failed: {result}")
            continue
        all_trades.extend(result)

    # Sort by close time
    all_trades.sort(key=lambda t: t["close_ms"])
    return all_trades

"""
Exchange module — unified interface for fetching trade data and positions.

Usage:
    from exchanges import get_all_trades, get_all_positions
    trades = await get_all_trades(days=30)
    positions = await get_all_positions()

To add a new exchange:
    1. Create exchanges/newexchange.py
    2. Implement the fetch_trades(days) and fetch_positions() functions
    3. Register in EXCHANGES dict below
"""

from .okx import fetch_okx_trades, fetch_okx_positions
from .bybit import fetch_bybit_trades, fetch_bybit_positions
from .bitget import fetch_bitget_trades, fetch_bitget_positions

# ─── Registry ─────────────────────────────────────────────────────────────
# Add new exchanges here: "Name": (fetch_trades_fn, fetch_positions_fn)
EXCHANGES = {
    "OKX": fetch_okx_trades,
    "Bybit": fetch_bybit_trades,
    "Bitget": fetch_bitget_trades,
}

POSITION_FETCHERS = {
    "OKX": fetch_okx_positions,
    "Bybit": fetch_bybit_positions,
    "Bitget": fetch_bitget_positions,
}


def reinit_exchanges():
    """Reinitialize exchange connections after config change."""
    import importlib
    from . import okx, bybit, bitget
    importlib.reload(okx)
    importlib.reload(bybit)
    importlib.reload(bitget)
    # Update the registry with reloaded functions
    EXCHANGES["OKX"] = okx.fetch_okx_trades
    EXCHANGES["Bybit"] = bybit.fetch_bybit_trades
    EXCHANGES["Bitget"] = bitget.fetch_bitget_trades
    POSITION_FETCHERS["OKX"] = okx.fetch_okx_positions
    POSITION_FETCHERS["Bybit"] = bybit.fetch_bybit_positions
    POSITION_FETCHERS["Bitget"] = bitget.fetch_bitget_positions


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


async def get_all_positions() -> list[dict]:
    """Fetch current positions from all registered exchanges in parallel."""
    import asyncio

    results = await asyncio.gather(
        *[fetch_fn() for fetch_fn in POSITION_FETCHERS.values()],
        return_exceptions=True
    )

    all_positions = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            name = list(POSITION_FETCHERS.keys())[i]
            print(f"[WARN] {name} positions fetch failed: {result}")
            continue
        if result:
            all_positions.extend(result)

    # Sort by unrealized PnL (highest first)
    all_positions.sort(key=lambda p: p.get("unrealized_pnl", 0), reverse=True)
    return all_positions

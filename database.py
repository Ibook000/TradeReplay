"""PostgreSQL database operations for TradeReplay."""

import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from pathlib import Path

# Database connection parameters
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "port": os.getenv("DB_PORT", "5432"),
    "database": os.getenv("DB_NAME", "tradereplay"),
    "user": os.getenv("DB_USER", "tradereplay"),
    "password": os.getenv("DB_PASSWORD", "tradereplay123"),
}


def get_connection():
    """Get a new database connection."""
    return psycopg2.connect(**DB_CONFIG)


def init_db():
    """Initialize database schema from schema.sql."""
    schema_file = Path(__file__).parent / "schema.sql"
    if not schema_file.exists():
        return

    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(schema_file.read_text())
        conn.commit()
        print("[DB] Schema initialized", flush=True)
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"[DB] Schema init error: {e}", flush=True)
    finally:
        if conn:
            conn.close()


def upsert_trades(trades: list[dict]) -> int:
    """Insert or update trades. Returns count of new trades."""
    if not trades:
        return 0
    
    conn = None
    new_count = 0
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            for t in trades:
                # Check if trade exists
                cur.execute("SELECT id FROM trades WHERE id = %s", (t["id"],))
                exists = cur.fetchone()
                
                if not exists:
                    new_count += 1
                
                # Upsert trade
                cur.execute("""
                    INSERT INTO trades (id, exchange, symbol, direction, open_ms, close_ms,
                                       open_price, close_price, quantity, leverage, pnl, hold_hours, raw_data)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        exchange = EXCLUDED.exchange,
                        symbol = EXCLUDED.symbol,
                        direction = EXCLUDED.direction,
                        open_ms = EXCLUDED.open_ms,
                        close_ms = EXCLUDED.close_ms,
                        open_price = EXCLUDED.open_price,
                        close_price = EXCLUDED.close_price,
                        quantity = EXCLUDED.quantity,
                        leverage = EXCLUDED.leverage,
                        pnl = EXCLUDED.pnl,
                        hold_hours = EXCLUDED.hold_hours,
                        raw_data = EXCLUDED.raw_data
                """, (
                    t["id"],
                    t.get("exchange", ""),
                    t.get("symbol", "BTC"),
                    t.get("direction", ""),
                    t.get("open_ms", 0),
                    t.get("close_ms", 0),
                    t.get("open_price", 0),
                    t.get("close_price", 0),
                    t.get("quantity"),
                    t.get("leverage"),
                    t.get("pnl"),
                    t.get("hold_hours"),
                    json.dumps(t.get("raw_data", {}))
                ))
        conn.commit()
        print(f"[DB] Upserted {len(trades)} trades, {new_count} new", flush=True)
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"[DB] Upsert error: {e}", flush=True)
    finally:
        if conn:
            conn.close()
    
    return new_count


def get_trades(days: int = 30, symbol: str = "") -> list[dict]:
    """Get trades from the last N days, optionally filtered by symbol."""
    import time
    now_ms = int(time.time() * 1000)
    cutoff_ms = now_ms - days * 86400 * 1000
    
    conn = None
    try:
        conn = get_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            query = """
                SELECT id, exchange, symbol, direction, open_ms, close_ms,
                       open_price, close_price, quantity, leverage, pnl, hold_hours
                FROM trades
                WHERE close_ms >= %s
            """
            params = [cutoff_ms]
            
            if symbol:
                query += " AND symbol = %s"
                params.append(symbol.upper())
            
            query += " ORDER BY close_ms ASC"
            
            cur.execute(query, params)
            rows = cur.fetchall()
            
            # Convert to list of dicts
            trades = []
            for row in rows:
                trade = dict(row)
                # Convert Decimal to float for JSON serialization
                for key in ["open_price", "close_price", "quantity", "leverage", "pnl", "hold_hours"]:
                    if trade[key] is not None:
                        trade[key] = float(trade[key])
                trades.append(trade)
            
            return trades
    except Exception as e:
        print(f"[DB] Query error: {e}", flush=True)
        return []
    finally:
        if conn:
            conn.close()


def get_symbol_counts(days: int = 90) -> list[dict]:
    """Get symbol counts for the dropdown."""
    import time
    now_ms = int(time.time() * 1000)
    cutoff_ms = now_ms - days * 86400 * 1000
    
    conn = None
    try:
        conn = get_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT symbol, COUNT(*) as count
                FROM trades
                WHERE close_ms >= %s
                GROUP BY symbol
                ORDER BY count DESC
            """, (cutoff_ms,))
            return [dict(row) for row in cur.fetchall()]
    except Exception as e:
        print(f"[DB] Symbol count error: {e}", flush=True)
        return []
    finally:
        if conn:
            conn.close()


def get_total_count() -> int:
    """Get total number of trades in database."""
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM trades")
            return cur.fetchone()[0]
    except Exception as e:
        print(f"[DB] Count error: {e}", flush=True)
        return 0
    finally:
        if conn:
            conn.close()


def get_ai_analysis(symbol: str, week_start: str) -> dict | None:
    """Get cached AI analysis for a specific week. Returns dict or None."""
    conn = None
    try:
        conn = get_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, symbol, week_start, week_end, trade_count,
                       total_pnl, win_rate, analysis, created_at
                FROM ai_analyses
                WHERE symbol = %s AND week_start = %s
            """, (symbol.upper(), week_start))
            row = cur.fetchone()
            if row:
                d = dict(row)
                for k in ('total_pnl', 'win_rate'):
                    if d[k] is not None:
                        d[k] = float(d[k])
                return d
            return None
    except Exception as e:
        print(f"[DB] AI cache read error: {e}", flush=True)
        return None
    finally:
        if conn:
            conn.close()


def save_ai_analysis(symbol: str, week_start: str, week_end: str,
                     trade_count: int, total_pnl: float, win_rate: float,
                     analysis: str):
    """Save AI analysis to cache (upsert by symbol+week_start)."""
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO ai_analyses (symbol, week_start, week_end, trade_count,
                                         total_pnl, win_rate, analysis)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (symbol, week_start) DO UPDATE SET
                    trade_count = EXCLUDED.trade_count,
                    total_pnl = EXCLUDED.total_pnl,
                    win_rate = EXCLUDED.win_rate,
                    analysis = EXCLUDED.analysis,
                    created_at = CURRENT_TIMESTAMP
            """, (symbol.upper(), week_start, week_end, trade_count,
                  total_pnl, win_rate, analysis))
        conn.commit()
        print(f"[DB] Saved AI analysis for {symbol} week {week_start}", flush=True)
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"[DB] AI cache save error: {e}", flush=True)
    finally:
        if conn:
            conn.close()


def get_trade_review(trade_id: str) -> dict | None:
    """Get cached AI review for a single trade. Returns dict or None."""
    conn = None
    try:
        conn = get_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT trade_id, exchange, symbol, direction, pnl, review, created_at
                FROM trade_reviews WHERE trade_id = %s
            """, (trade_id,))
            row = cur.fetchone()
            if row:
                d = dict(row)
                if d.get("pnl") is not None:
                    d["pnl"] = float(d["pnl"])
                return d
            return None
    except Exception as e:
        print(f"[DB] Trade review read error: {e}", flush=True)
        return None
    finally:
        if conn:
            conn.close()


def save_trade_review(trade_id: str, exchange: str, symbol: str,
                      direction: str, pnl: float, review: str):
    """Save AI review for a single trade (upsert by trade_id)."""
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO trade_reviews (trade_id, exchange, symbol, direction, pnl, review)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (trade_id) DO UPDATE SET
                    review = EXCLUDED.review,
                    created_at = CURRENT_TIMESTAMP
            """, (trade_id, exchange, symbol, direction, pnl, review))
        conn.commit()
        print(f"[DB] Saved trade review for {trade_id}", flush=True)
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"[DB] Trade review save error: {e}", flush=True)
    finally:
        if conn:
            conn.close()


def get_ai_history(symbol: str = 'ALL', limit: int = 12) -> list[dict]:
    """Get AI analysis history, newest first."""
    conn = None
    try:
        conn = get_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, symbol, week_start, week_end, trade_count,
                       total_pnl, win_rate, analysis, created_at
                FROM ai_analyses
                WHERE symbol = %s
                ORDER BY week_start DESC
                LIMIT %s
            """, (symbol.upper(), limit))
            rows = cur.fetchall()
            result = []
            for row in rows:
                d = dict(row)
                for k in ('total_pnl', 'win_rate'):
                    if d[k] is not None:
                        d[k] = float(d[k])
                result.append(d)
            return result
    except Exception as e:
        print(f"[DB] AI history error: {e}", flush=True)
        return []
    finally:
        if conn:
            conn.close()

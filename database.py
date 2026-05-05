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
    if schema_file.exists():
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(schema_file.read_text())
            conn.commit()
            print("[DB] Schema initialized", flush=True)
        except Exception as e:
            print(f"[DB] Schema init error: {e}", flush=True)
        finally:
            conn.close()


def upsert_trades(trades: list[dict]) -> int:
    """Insert or update trades. Returns count of new trades."""
    if not trades:
        return 0
    
    conn = get_connection()
    new_count = 0
    try:
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
        conn.rollback()
        print(f"[DB] Upsert error: {e}", flush=True)
    finally:
        conn.close()
    
    return new_count


def get_trades(days: int = 30, symbol: str = "") -> list[dict]:
    """Get trades from the last N days, optionally filtered by symbol."""
    import time
    now_ms = int(time.time() * 1000)
    cutoff_ms = now_ms - days * 86400 * 1000
    
    conn = get_connection()
    try:
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
        conn.close()


def get_symbol_counts(days: int = 90) -> list[dict]:
    """Get symbol counts for the dropdown."""
    import time
    now_ms = int(time.time() * 1000)
    cutoff_ms = now_ms - days * 86400 * 1000
    
    conn = get_connection()
    try:
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
        conn.close()


def get_total_count() -> int:
    """Get total number of trades in database."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM trades")
            return cur.fetchone()[0]
    except Exception as e:
        print(f"[DB] Count error: {e}", flush=True)
        return 0
    finally:
        conn.close()


def migrate_from_json(json_file: str):
    """Migrate trades from JSON file to PostgreSQL."""
    import json
    from pathlib import Path
    
    if not Path(json_file).exists():
        print(f"[DB] JSON file not found: {json_file}", flush=True)
        return
    
    try:
        trades = json.loads(Path(json_file).read_text())
        new_count = upsert_trades(trades)
        print(f"[DB] Migrated {len(trades)} trades from JSON ({new_count} new)", flush=True)
    except Exception as e:
        print(f"[DB] Migration error: {e}", flush=True)


def get_ai_analysis(symbol: str, days: int, latest_close_ms: int) -> str | None:
    """Get cached AI analysis. Returns analysis text or None if stale/missing."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT analysis FROM ai_analyses
                WHERE symbol = %s AND days = %s AND latest_close_ms = %s
                ORDER BY created_at DESC LIMIT 1
            """, (symbol.upper(), days, latest_close_ms))
            row = cur.fetchone()
            return row[0] if row else None
    except Exception as e:
        print(f"[DB] AI cache read error: {e}", flush=True)
        return None
    finally:
        conn.close()


def save_ai_analysis(symbol: str, days: int, trade_count: int,
                     latest_close_ms: int, analysis: str):
    """Save AI analysis to cache."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO ai_analyses (symbol, days, trade_count, latest_close_ms, analysis)
                VALUES (%s, %s, %s, %s, %s)
            """, (symbol.upper(), days, trade_count, latest_close_ms, analysis))
        conn.commit()
        print(f"[DB] Saved AI analysis for {symbol}/{days}d", flush=True)
    except Exception as e:
        conn.rollback()
        print(f"[DB] AI cache save error: {e}", flush=True)
    finally:
        conn.close()

"""Trade data cache — PostgreSQL persistence, background refresh."""

import time
import threading
import re

from exchanges import get_all_trades
from database import init_db, upsert_trades, get_trades, get_symbol_counts, get_total_count

# ─── Config ───────────────────────────────────────────────────────────────
REFRESH_INTERVAL = 300
DAILY_REFRESH_HOUR = 3  # 每天凌晨3点自动刷新

_lock = threading.Lock()
_last_refresh: float = 0


def load_from_disk():
    """Initialize database."""
    init_db()
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
    prompt = f"""你是一个犀利的交易教练，专门分析合约交易数据。请用JSON格式输出分析结果。
分析以下一周的交易数据：
{trade_summary}

严格按以下JSON格式输出，不要输出任何其他内容：
{{
  "summary": "一句话总评，20字以内，要犀利",
  "score": 0到100的整数评分,
  "top_issues": [
    {{"title": "问题标题", "detail": "用数据说明这个问题，引用具体数字", "severity": "high或medium或low"}}
  ],
  "repeated_mistakes": [
    {{"pattern": "错误模式名称", "evidence": "具体交易数据证据"}}
  ],
  "action_items": [
    {{"action": "可执行的具体建议", "priority": 1到5的优先级}}
  ]
}}

要求：
1. top_issues 最多5个，按严重程度排序
2. repeated_mistakes 最多3个
3. action_items 最多5个，按优先级排序
4. 语气犀利直接，不要客套
"""
    try:
        import httpx as _httpx
        with _httpx.Client(timeout=60.0) as client:
            resp = client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "你是一个犀利的交易教练。必须严格输出合法JSON，不要输出任何其他文本、markdown或代码块标记。"},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.7,
                    "max_tokens": 2000
                }
            )
            if resp.status_code == 200:
                import json as _json
                raw = resp.json()["choices"][0]["message"]["content"].strip()
                # Strip markdown code block if present
                if raw.startswith("```"):
                    raw = re.sub(r'^```(?:json)?\s*', '', raw)
                    raw = re.sub(r'\s*```$', '', raw)
                # Validate JSON
                try:
                    parsed = _json.loads(raw)
                    analysis = _json.dumps(parsed, ensure_ascii=False)
                except _json.JSONDecodeError:
                    print(f"[AI] Response is not valid JSON, saving as-is", flush=True)
                    analysis = raw
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


# ─── Position Monitor Scheduler (every 15 min) ──────────────────────

POS_MONITOR_INTERVAL = 900  # 15 minutes in seconds


def _run_position_analysis(position: dict):
    """Run AI analysis for a single position and save to DB."""
    import os
    import asyncio
    import httpx
    import json
    import time
    from database import save_position_analysis
    from klines import fetch_klines

    exchange = position.get("exchange", "")
    symbol = position.get("symbol", "").replace("/", "-").upper()
    direction = position.get("direction", "long")
    leverage = position.get("leverage", 1)
    entry_price = position.get("entry_price", 0)
    mark_price = position.get("mark_price", 0)
    size = position.get("size", 0)
    margin = position.get("margin", 0)
    liq_price = position.get("liquidation_price", 0)
    unrealized_pnl = position.get("unrealized_pnl", 0)

    api_key = os.getenv("AI_API_KEY", "").strip()
    base_url = os.getenv("AI_BASE_URL", "https://api.deepseek.com/v1").strip().rstrip("/")
    model = os.getenv("AI_MODEL", "deepseek-chat").strip()

    if not api_key:
        print(f"[POS-MON] No AI API key, skip {symbol}", flush=True)
        return

    try:
        # Fetch K-lines
        now_ms = int(time.time() * 1000)
        start_ms = now_ms - 24 * 3600 * 1000
        loop = asyncio.new_event_loop()
        klines = loop.run_until_complete(fetch_klines(symbol, "5m", start_ms, now_ms, exchange))
        loop.close()

        if not klines:
            print(f"[POS-MON] No K-lines for {symbol}, skip", flush=True)
            return

        if len(klines) > 48:
            step = len(klines) // 48
            klines = klines[::step][:48]

        kline_text = ""
        for k in klines:
            ts = k.get("time", 0)
            from datetime import datetime, timezone, timedelta
            dt = datetime.fromtimestamp(ts, tz=timezone(timedelta(hours=8)))
            kline_text += f"  {dt.strftime('%m-%d %H:%M')} O:{k['open']:.4f} H:{k['high']:.4f} L:{k['low']:.4f} C:{k['close']:.4f}\n"

        pnl_pct = 0
        if entry_price > 0:
            pnl_pct = (mark_price - entry_price) / entry_price * 100
            if direction == "short":
                pnl_pct = -pnl_pct

        prompt = f"""分析以下当前持仓的行情，给出持仓建议，并明确预测下一阶段更偏多还是偏空。

当前持仓信息:
- 交易所: {exchange}
- 币种: {symbol}
- 当前持仓方向: {direction.upper()} {leverage}x
- 入场价: {entry_price:.4f}
- 当前标记价: {mark_price:.4f}
- 浮动盈亏: {unrealized_pnl:+.2f} USDT ({pnl_pct:+.2f}%)
- 仓位大小: {size}
- 保证金: {margin:.2f} USDT
- 强平价: {liq_price:.4f}

最近24小时K线数据 (5分钟, UTC+8):
{kline_text}

严格按以下JSON格式输出，不要输出任何其他内容:
{{
  "summary": "一句话行情判断，20字以内",
  "score": 0到100的持仓健康度评分(100=非常健康),
  "prediction": {{
    "side": "long或short",
    "confidence": 0到100的整数,
    "reason": "为什么判断偏多或偏空，引用K线和关键价位，40字以内"
  }},
  "trend": [
    "趋势分析点1，引用具体K线价格，30字以内",
    "趋势分析点2，30字以内"
  ],
  "risks": [
    {{"text": "风险描述，引用具体价格数据", "severity": "high或medium或low"}},
    {{"text": "风险描述", "severity": "medium"}}
  ],
  "actions": [
    {{"type": "hold或add或reduce或stoploss", "text": "具体操作建议，包含价格点位", "price": "建议价格或空字符串"}},
    {{"type": "stoploss", "text": "止损建议", "price": "止损价格"}}
  ]
}}

要求:
1. prediction.side 只能是 long 或 short，必须给方向判断
2. prediction.confidence 必须是 0-100 整数
3. trend 2-3条，分析当前K线形态和趋势方向
4. risks 最多3条，必须包含强平风险评估
5. actions 2-3条，必须包含明确的操作建议和价格点位
6. actions.type 只能是 hold/add/reduce/stoploss 四种
7. 语气犀利直接，引用具体K线价格数据"""

        with httpx.Client(timeout=60.0) as client:
            resp = client.post(
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
            print(f"[POS-MON] AI API error for {symbol}: {resp.status_code}", flush=True)
            return

        raw = resp.json()["choices"][0]["message"]["content"].strip()
        if raw.startswith("```"):
            raw = re.sub(r'^```(?:json)?\s*', '', raw)
            raw = re.sub(r'\s*```$', '', raw)

        try:
            parsed = json.loads(raw)
            prediction = parsed.get("prediction") or {}
            side = str(prediction.get("side", "")).strip().lower()
            if side not in {"long", "short"}:
                side = direction if direction in {"long", "short"} else "long"
            try:
                confidence = int(prediction.get("confidence", 0))
            except Exception:
                confidence = 0
            confidence = max(0, min(100, confidence))
            reason = str(prediction.get("reason", "")).strip()
            parsed["prediction"] = {"side": side, "confidence": confidence, "reason": reason}

            risks = parsed.get("risks") or []
            risks_text = "; ".join(r.get("text", "") for r in risks if isinstance(r, dict))
            save_position_analysis({
                "exchange": exchange, "symbol": symbol, "direction": direction,
                "entry_price": entry_price, "mark_price": mark_price,
                "unrealized_pnl": unrealized_pnl, "leverage": leverage,
                "margin": margin, "liquidation_price": liq_price, "size": size,
                "score": parsed.get("score"), "summary": parsed.get("summary"),
                "risks": risks_text,
                "predicted_side": side,
                "predicted_confidence": confidence,
                "prediction_reason": reason,
                "analysis": parsed,
            })
            print(f"[POS-MON] Analysis saved for {symbol} (score={parsed.get('score')})", flush=True)
        except json.JSONDecodeError:
            print(f"[POS-MON] Invalid JSON for {symbol}, skip save", flush=True)

    except Exception as e:
        print(f"[POS-MON] Analysis failed for {symbol}: {e}", flush=True)


def _position_monitor_loop():
    """Background loop that runs position analysis every 15 minutes."""
    import asyncio
    while True:
        time.sleep(POS_MONITOR_INTERVAL)
        try:
            from database import get_enabled_monitors, init_monitor_settings_for_symbol
            from exchanges import get_all_positions

            # Get enabled symbols
            enabled = get_enabled_monitors()
            if not enabled:
                continue
            enabled_symbols = {r["symbol"].upper() for r in enabled}

            # Get current positions
            loop = asyncio.new_event_loop()
            positions = loop.run_until_complete(get_all_positions())
            loop.close()

            if not positions:
                continue

            # Auto-register new symbols (disabled by default)
            for p in positions:
                sym = p.get("symbol", "").replace("/", "-").upper()
                init_monitor_settings_for_symbol(sym)

            # Filter to enabled symbols
            to_analyze = [p for p in positions if p.get("symbol", "").replace("/", "-").upper() in enabled_symbols]

            if not to_analyze:
                continue

            print(f"[POS-MON] Analyzing {len(to_analyze)} positions: {[p.get('symbol') for p in to_analyze]}", flush=True)
            for p in to_analyze:
                _run_position_analysis(p)

        except Exception as e:
            print(f"[POS-MON] Monitor loop error: {e}", flush=True)


def start_position_monitor_scheduler():
    """Start the position monitor background thread."""
    t = threading.Thread(target=_position_monitor_loop, daemon=True)
    t.start()
    print("[CACHE] Position monitor scheduler started (every 15 min)", flush=True)

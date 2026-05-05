#!/usr/bin/env python3
"""Generate AI analysis for all historical weeks that don't have one yet."""

import os
import re
import json
import psycopg2
from datetime import datetime, timedelta

DB_CONFIG = {
    "host": "127.0.0.1",
    "port": "5432",
    "database": "tradereplay",
    "user": "tradereplay",
    "password": "tradereplay123",
}

def get_connection():
    return psycopg2.connect(**DB_CONFIG)

def get_week_ranges():
    """Get all Monday-Sunday week ranges from trades data."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT MIN(close_ms), MAX(close_ms) FROM trades")
    min_ms, max_ms = cur.fetchone()
    conn.close()

    start_date = datetime.fromtimestamp(min_ms / 1000).date()
    end_date = datetime.fromtimestamp(max_ms / 1000).date()

    # Align to Monday
    start_monday = start_date - timedelta(days=start_date.weekday())
    end_monday = end_date - timedelta(days=end_date.weekday()) + timedelta(days=7)

    weeks = []
    current = start_monday
    while current < end_monday:
        week_end = current + timedelta(days=7)
        weeks.append((str(current), str(week_end)))
        current = week_end
    return weeks

def get_existing_analyses():
    """Get weeks that already have analyses."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT week_start FROM ai_analyses WHERE symbol='ALL'")
    rows = cur.fetchall()
    conn.close()
    return {str(r[0]) for r in rows}

def get_week_trades(week_start, week_end):
    """Get trades for a specific week."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM trades WHERE close_ms >= %s AND close_ms < %s",
                (int(datetime.strptime(week_start, "%Y-%m-%d").timestamp() * 1000),
                 int(datetime.strptime(week_end, "%Y-%m-%d").timestamp() * 1000)))
    columns = [desc[0] for desc in cur.description]
    rows = cur.fetchall()
    conn.close()
    return [dict(zip(columns, row)) for row in rows]

def build_prompt(week_start, week_end, trades):
    """Build the analysis prompt for a week's trades."""
    total_pnl = sum(t.get("pnl", 0) for t in trades)
    win_trades = [t for t in trades if t.get("pnl", 0) > 0]
    lose_trades = [t for t in trades if t.get("pnl", 0) <= 0]
    win_rate = len(win_trades) / len(trades) * 100 if trades else 0
    avg_win = sum(t.get("pnl", 0) for t in win_trades) / len(win_trades) if win_trades else 0
    avg_loss = sum(t.get("pnl", 0) for t in lose_trades) / len(lose_trades) if lose_trades else 0
    biggest_win = max((t.get("pnl", 0) for t in trades), default=0)
    biggest_loss = min((t.get("pnl", 0) for t in trades), default=0)
    avg_hold = sum(t.get("hold_hours", 0) for t in trades) / len(trades) if trades else 0
    long_losses = [t for t in lose_trades if t.get("direction") == "long"]
    short_losses = [t for t in lose_trades if t.get("direction") == "short"]

    summary = f"""
=== 周报 ({week_start} ~ {week_end}) ===

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
    recent = trades[-5:] if len(trades) > 5 else trades
    for i, t in enumerate(recent, 1):
        pnl = t.get("pnl", 0)
        d = t.get("direction", "?")
        entry = t.get("open_price", 0)
        exit_p = t.get("close_price", 0)
        hold = t.get("hold_hours", 0)
        lev = t.get("leverage", 1)
        summary += f"{i}. {d.upper()} {lev}x | Entry: {entry:.2f} -> Exit: {exit_p:.2f} | Hold: {hold:.1f}h | PnL: {pnl:+.2f} USDT\n"

    prompt = f"""你是一个犀利的交易教练，专门分析合约交易数据。请用JSON格式输出分析结果。
分析以下一周的交易数据：
{summary}

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
    return prompt, total_pnl, win_rate

def call_ai(prompt):
    """Call the AI API and return parsed JSON."""
    import httpx

    api_key = os.getenv("AI_API_KEY", "")
    base_url = os.getenv("AI_BASE_URL", "https://api.deepseek.com/v1")
    model = os.getenv("AI_MODEL", "deepseek-chat")

    if not api_key:
        print("[AI] No API key configured!")
        return None

    with httpx.Client(timeout=60.0) as client:
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
            raw = resp.json()["choices"][0]["message"]["content"].strip()
            if raw.startswith("```"):
                raw = re.sub(r'^```(?:json)?\s*', '', raw)
                raw = re.sub(r'\s*```$', '', raw)
            try:
                parsed = json.loads(raw)
                return json.dumps(parsed, ensure_ascii=False)
            except json.JSONDecodeError:
                print(f"[AI] Response is not valid JSON, saving as-is")
                return raw
        else:
            print(f"[AI] API error: {resp.status_code} {resp.text[:200]}")
            return None

def save_analysis(week_start, week_end, trade_count, total_pnl, win_rate, analysis):
    """Save analysis to database (skip if already exists)."""
    conn = get_connection()
    cur = conn.cursor()
    # Check if already exists
    cur.execute("SELECT id FROM ai_analyses WHERE symbol='ALL' AND week_start=%s", (week_start,))
    if cur.fetchone():
        conn.close()
        return False
    cur.execute("""
        INSERT INTO ai_analyses (symbol, week_start, week_end, trade_count, total_pnl, win_rate, analysis)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    """, ("ALL", week_start, week_end, trade_count, total_pnl, win_rate, analysis))
    conn.commit()
    conn.close()
    return True

def main():
    weeks = get_week_ranges()
    existing = get_existing_analyses()
    print(f"Total weeks: {len(weeks)}, Already analyzed: {len(existing)}")

    pending = [(ws, we) for ws, we in weeks if ws not in existing]
    print(f"Pending: {len(pending)} weeks")

    for week_start, week_end in pending:
        trades = get_week_trades(week_start, week_end)
        if not trades:
            print(f"[SKIP] {week_start}: no trades")
            continue

        print(f"\n[PROCESSING] {week_start} ~ {week_end}: {len(trades)} trades")
        prompt, total_pnl, win_rate = build_prompt(week_start, week_end, trades)
        analysis = call_ai(prompt)

        if analysis:
            save_analysis(week_start, week_end, len(trades), total_pnl, win_rate, analysis)
            print(f"[SAVED] {week_start} analysis saved")
        else:
            print(f"[FAILED] {week_start} analysis failed")

    print("\nDone!")

if __name__ == "__main__":
    main()

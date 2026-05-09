# TRADE REPLAY

TRADE REPLAY is a self-hosted, multi-exchange contract trade replay and review tool. It imports closed positions from exchange APIs, stores them in PostgreSQL, and visualizes entries, exits, live positions, replay playback, statistics, and AI coaching on K-line charts.

## Screenshots

### Overview — K-line chart with trade markers
![Overview](screenshots/overview.png)

### Trade Detail — Entry/exit price lines on K-lines
![Detail](screenshots/detail.png)

### Statistics — Equity curve, daily PnL, distribution
![Stats](screenshots/stats.png)

### AI Analysis — AI Trading Coach
![AI Analysis](screenshots/ai-analysis.png)

## Architecture

![Architecture](screenshots/architecture.png)

## Features

### Trade history review

- Multi-exchange closed-position import for OKX, Bybit, and Bitget with a unified trade format.
- PostgreSQL persistence with cached reads and manual/daily refresh support.
- Server-side filters for symbol, exchange, date range, direction, PnL result, and minimum leverage.
- Multi-symbol selector with trade counts.
- Responsive dark UI with collapsible sidebar and mobile-friendly layout.
- UTC+8-oriented display for trading review workflows.

### K-line visualization and replay

- LightweightCharts-powered candlestick and volume charts.
- Automatic K-line source fallback across Binance, OKX, and Bybit where applicable.
- Exchange-aware K-line fetching for trade details and live positions.
- Adaptive price precision when switching between high-price and low-price symbols.
- Entry matching by price with timestamp fallback, plus exit alignment by close timestamp.
- Direction-aware markers:
  - Long entry: green arrow up below the candle.
  - Long exit: green arrow down above the candle.
  - Short entry: red arrow down above the candle.
  - Short exit: red arrow up below the candle.
- Single-trade replay mode that plays candles forward from before entry to exit.
- Replay controls for play/pause, 1x/2x/5x/10x speeds, progress, and close.
- Replay keeps the user zoom context and pins the replay price range to avoid distracting Y-axis jumps.

### Open positions

- Live open-position view for OKX, Bybit, and Bitget.
- Auto-polls current positions every 10 seconds while the Positions view is active.
- Auto-refreshes the active position chart every 5 seconds.
- Position cards share the same visual structure as historical trade cards: exchange badge, direction, symbol, PnL, leverage, size, margin, entry, mark price, and liquidation price when available.
- Dedicated position analysis panel with trend, risk, and action sections.

### AI coaching

- Weekly AI Trading Coach analysis stored in PostgreSQL.
- Background weekly AI scheduler runs every Monday at 00:00 and analyzes the previous completed week.
- Manual AI trigger from the UI/API for testing.
- AI history panel for previous weekly analyses.
- Single-trade AI Review with database caching.
- Open-position AI analysis based on current position data and recent 5-minute K-lines.
- OpenAI-compatible AI configuration: `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL`.
- Built-in AI connection test endpoint and settings UI.

### Settings and security basics

- Settings panel for OKX, Bybit, Bitget, and AI credentials.
- API keys are masked when read back through the config endpoint.
- `.env` updates use `python-dotenv` quoting.
- Submitted config values reject newline characters, and AI base URLs must be absolute `http(s)` URLs without query/fragment parts.

## Quick Start (Linux Servers)

### 1. Prerequisites

```bash
# CentOS / OpenCloudOS / RHEL
sudo yum install -y python3 python3-pip postgresql-server postgresql-devel
sudo postgresql-setup --initdb
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Ubuntu / Debian
sudo apt install -y python3 python3-pip postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### 2. Clone and install

```bash
git clone https://github.com/Ibook000/TradeReplay.git
cd TradeReplay
pip3 install -r requirements.txt
```

### 3. Set up PostgreSQL

```bash
# Create user and database
sudo -u postgres psql <<'SQL'
CREATE USER tradereplay WITH PASSWORD 'your_password';
CREATE DATABASE tradereplay OWNER tradereplay;
\q
SQL

# Import schema
psql -U tradereplay -d tradereplay -h localhost -f schema.sql
```

If password authentication fails, edit `pg_hba.conf`:

```bash
# Find config location
sudo -u postgres psql -c "SHOW hba_file;"

# Change local authentication from ident/peer to md5 or scram-sha-256, then restart
sudo systemctl restart postgresql
```

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```dotenv
DB_HOST=localhost
DB_PORT=5432
DB_NAME=tradereplay
DB_USER=tradereplay
DB_PASSWORD=your_password

OKX_API_KEY=your_okx_api_key
OKX_SECRET_KEY=your_okx_secret_key
OKX_PASSPHRASE=your_okx_passphrase

BYBIT_API_KEY=your_bybit_api_key
BYBIT_SECRET_KEY=your_bybit_secret_key

BITGET_API_KEY=your_bitget_api_key
BITGET_SECRET_KEY=your_bitget_secret_key
BITGET_PASSPHRASE=your_bitget_passphrase

AI_BASE_URL=https://api.deepseek.com/v1
AI_API_KEY=your_ai_api_key
AI_MODEL=deepseek-chat
```

Exchange adapters read credentials from environment variables directly, so no separate Python credentials file is required.

### 5. Run

```bash
python3 main.py
```

Open `http://your-server-ip:80` in a browser.

### 6. Run as a systemd service (recommended)

Adjust `WorkingDirectory`, `User`, and `Environment=PORT=...` for your server.

```bash
sudo tee /etc/systemd/system/trade-replay.service <<'SERVICE'
[Unit]
Description=Trade Replay - Multi-exchange trade history viewer
After=postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/root/TradeReplay
Environment=PORT=80
ExecStart=/usr/bin/python3 main.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl start trade-replay
sudo systemctl enable trade-replay

# Check status and logs
sudo systemctl status trade-replay
sudo journalctl -u trade-replay -f
```

### 7. Update

```bash
cd TradeReplay
git pull
pip3 install -r requirements.txt
psql -U tradereplay -d tradereplay -h localhost -f schema.sql
sudo systemctl restart trade-replay
```

Re-importing `schema.sql` is safe for normal updates because tables and indexes are created with `IF NOT EXISTS` where applicable.

## Configuration reference

### Database

Default database config is read from environment variables:

| Variable | Default |
|----------|---------|
| `DB_HOST` | `127.0.0.1` |
| `DB_PORT` | `5432` |
| `DB_NAME` | `tradereplay` |
| `DB_USER` | `tradereplay` |
| `DB_PASSWORD` | `tradereplay123` |

### Exchange API keys

| Exchange | Variables | Notes |
|----------|-----------|-------|
| OKX | `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` | Read-only permission is sufficient. |
| Bybit | `BYBIT_API_KEY`, `BYBIT_SECRET_KEY` | Read-only permission is sufficient. |
| Bitget | `BITGET_API_KEY`, `BITGET_SECRET_KEY`, `BITGET_PASSPHRASE` | Read-only permission is sufficient. |

### AI provider

Trade Replay uses an OpenAI-compatible chat completions API.

| Variable | Example | Notes |
|----------|---------|-------|
| `AI_BASE_URL` | `https://api.deepseek.com/v1` | Must be an absolute `http(s)` URL. |
| `AI_API_KEY` | `sk-...` | Optional. Required for AI Coach, AI Review, and position analysis. |
| `AI_MODEL` | `deepseek-chat` | Any compatible chat model exposed by your provider. |

## API overview

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/symbols` | List symbols and trade counts. |
| `GET` | `/api/trades` | List cached closed trades with filters. |
| `POST` | `/api/refresh` | Force background trade refresh. |
| `GET` | `/api/positions` | Fetch current open positions from all configured exchanges. |
| `GET` | `/api/klines` | Fetch K-lines for a specific trade or position range. |
| `GET` | `/api/klines_range` | Fetch overview K-lines for a symbol. |
| `GET` | `/api/config` | Read masked config status. |
| `POST` | `/api/config` | Update `.env` configuration. |
| `GET` | `/api/ai_analysis` | Read the latest or selected weekly AI analysis. |
| `GET` | `/api/ai_history` | Read historical weekly AI analyses. |
| `POST` | `/api/test_ai` | Test the configured AI provider. |
| `POST` | `/api/ai_trigger` | Manually trigger weekly AI analysis. |
| `POST` | `/api/review_trade` | Generate or read cached single-trade AI review. |
| `POST` | `/api/analyze_position` | Generate AI analysis for an open position. |

## Data model

`schema.sql` creates these main tables:

- `trades` — normalized closed trades from all exchanges.
- `ai_analyses` — cached weekly AI coach reports.
- `trade_reviews` — cached single-trade AI reviews.

## Project structure

```text
TradeReplay/
├── main.py              # FastAPI routes, config, AI endpoints, app startup
├── database.py          # PostgreSQL operations
├── cache.py             # Trade cache, daily refresh, weekly AI scheduler
├── klines.py            # K-line fetchers and interval selection
├── generate_history.py  # Historical data import helper
├── schema.sql           # Database schema
├── .env.example         # Environment template
├── requirements.txt     # Python dependencies
├── exchanges/
│   ├── __init__.py      # Unified trade and position fetching
│   ├── okx.py           # OKX adapter
│   ├── bybit.py         # Bybit adapter
│   ├── bitget.py        # Bitget adapter
│   └── keys.py.example  # Env var reference
├── static/
│   ├── index.html       # SPA frontend
│   ├── logo.png         # App icon
│   ├── logo.svg         # Vector logo
│   ├── css/style.css    # Dark theme, layout, panels, mobile styles
│   └── js/
│       ├── app.js       # Main UI logic, settings, positions, replay, AI panels
│       ├── api.js       # API client helpers
│       ├── chart.js     # K-line rendering, markers, price lines
│       ├── trades.js    # Trade list and statistics rendering
│       └── utils.js     # Formatting and escaping helpers
├── screenshots/         # README screenshots
└── docs/architecture.html
```

## License

MIT

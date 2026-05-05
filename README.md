# TradeReplay

Multi-exchange contract trade replay tool — visualize your closed positions on K-line charts with entry/exit markers.

## Screenshots

### Overview — K-line chart with trade markers
![Overview](screenshots/overview.png)

### Trade Detail — Entry/exit price lines on 5m K-lines
![Detail](screenshots/detail.png)

### Statistics — Equity curve, daily PnL, distribution
![Stats](screenshots/stats.png)

## Architecture

![Architecture](screenshots/architecture.png)

## Features

- Multi-exchange support (OKX, Bybit) with unified data format
- K-line chart with entry/exit markers (LightweightCharts)
- Price-based entry detection for Bybit trades
- Auto fallback across K-line data sources (Binance → OKX → Bybit)
- Statistics panel with equity curve, daily PnL, PnL distribution
- Multi-symbol support with dropdown selector
- Dark theme, mobile responsive
- Beijing time (UTC+8) display
- PostgreSQL database for persistent storage
- Daily auto-refresh scheduler (03:00)

## Architecture Details

### Frontend Layer
- Single Page Application (SPA)
- LightweightCharts.js for K-line rendering
- Real-time trade markers with entry/exit arrows
- Responsive dark theme UI
- Multi-symbol dropdown selector

### Backend Layer
- FastAPI (Python) REST API
- Modular design: main.py, cache.py, klines.py
- Exchange adapters with unified interface
- Background scheduler (daily refresh at 03:00)
- Auto-merge new trades without duplicates

### Data Layer
- PostgreSQL 15 for persistent storage
- OKX + Bybit for trade data
- Binance as K-line fallback source
- Price-based entry K-line matching
- Timestamp-based exit K-line alignment

## Project Structure

```
TradeReplay/
├── main.py              # FastAPI routes
├── cache.py             # Trade data persistence & background refresh
├── klines.py            # K-line fetchers (Binance, OKX, Bybit)
├── database.py          # PostgreSQL database operations
├── schema.sql           # Database schema
├── exchanges/
│   ├── __init__.py      # Unified trade fetching interface
│   ├── keys.py.example  # API key template
│   ├── okx.py           # OKX closed PnL fetcher
│   └── bybit.py         # Bybit closed PnL fetcher
├── static/
│   ├── index.html       # Single page app
│   ├── css/style.css    # Dark theme styles
│   └── js/
│       ├── utils.js     # Formatters & helpers
│       ├── api.js       # API client
│       ├── chart.js     # LightweightCharts K-line + markers
│       ├── trades.js    # Trade list & stats rendering
│       └── app.js       # Main app logic
├── docs/
│   └── architecture.html  # Architecture diagram source
└── screenshots/         # Project screenshots
```

## Setup

1. Clone the repo:

```bash
git clone https://github.com/Ibook000/TradeReplay.git
cd TradeReplay
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Configure API keys:

```bash
cp .env.example .env
cp exchanges/keys.py.example exchanges/keys.py
# Edit .env with your actual API keys
```

4. Setup PostgreSQL:

```bash
# Install PostgreSQL
sudo apt install postgresql postgresql-contrib

# Create database and user
sudo -u postgres psql
CREATE USER tradereplay WITH PASSWORD 'your_password';
CREATE DATABASE tradereplay OWNER tradereplay;
\q

# Run schema
psql -U tradereplay -d tradereplay -f schema.sql
```

5. Run:

```bash
python main.py
```

Open http://localhost:80 in your browser.

## API Keys

| Exchange | Key | Description |
|----------|-----|-------------|
| OKX | `OKX_API_KEY` | API key |
| OKX | `OKX_SECRET_KEY` | Secret key |
| OKX | `OKX_PASSPHRASE` | Passphrase |
| Bybit | `BYBIT_API_KEY` | API key |
| Bybit | `BYBIT_SECRET_KEY` | Secret key |

## Tech Stack

- **Backend**: Python, FastAPI, httpx, asyncpg
- **Frontend**: Vanilla JS, LightweightCharts, Chart.js
- **Database**: PostgreSQL 15
- **Data Sources**: OKX API, Bybit API, Binance API (K-lines)

## License

MIT

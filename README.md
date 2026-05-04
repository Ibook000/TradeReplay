# TradeReplay

Multi-exchange contract trade replay tool — visualize your closed positions on K-line charts with entry/exit markers.

## Features

- Multi-exchange support (OKX, Bybit) with unified data format
- K-line chart with entry/exit markers (LightweightCharts)
- Price-based entry detection for Bybit trades
- Auto fallback across K-line data sources (Binance → OKX → Bybit)
- Statistics panel with PnL, win rate, hold time analysis
- Multi-symbol support with dropdown selector
- Dark theme, mobile responsive
- Beijing time (UTC+8) display

## Architecture

```
TradeReplay/
├── main.py              # FastAPI routes
├── cache.py             # Trade data persistence & background refresh
├── klines.py            # K-line fetchers (Binance, OKX, Bybit)
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
└── data/                # Cached trade data (auto-generated)
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

4. Run:

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

- **Backend**: Python, FastAPI, httpx
- **Frontend**: Vanilla JS, LightweightCharts, Chart.js
- **Data Sources**: OKX API, Bybit API, Binance API (K-lines)

## License

MIT

// ─── App (Main Entry) ───────────────────────────────────────────────────────

const App = {
    currentSymbol: '',  // Active symbol (e.g. 'BTC')
    allSymbols: [],      // Available symbols from API

    /**
     * Initialize the application
     */
    async init() {
        KlineChart.init(document.getElementById('chart'));
        this.bindEvents();
        await this.loadSymbols();
    },

    /**
     * Bind DOM events
     */
    bindEvents() {
        document.getElementById('refreshBtn').addEventListener('click', () => this.loadTrades());
        document.getElementById('daysSelect').addEventListener('change', () => this.loadTrades());

        // Stats panel toggle
        document.getElementById('statsBtn').addEventListener('click', () => this.toggleStatsPanel());
        document.getElementById('closeStatsBtn').addEventListener('click', () => this.closeStatsPanel());
    },

    /**
     * Load available symbols and render dropdown
     */
    async loadSymbols() {
        const sel = document.getElementById('symbolSelect');
        sel.innerHTML = '<option>Loading...</option>';

        try {
            const days = document.getElementById('daysSelect').value;
            const data = await API.fetchSymbols(180);
            this.allSymbols = data.symbols || [];

            if (this.allSymbols.length === 0) {
                sel.innerHTML = '<option>No trades</option>';
                return;
            }

            // Default to first symbol
            this.currentSymbol = this.allSymbols[0].symbol;

            // Update total badge
            const totalTrades = this.allSymbols.reduce((s, x) => s + x.count, 0);
            document.getElementById('totalBadge').textContent = `${totalTrades} trades`;

            // Render select options
            sel.innerHTML = this.allSymbols.map(s =>
                `<option value="${s.symbol}" ${s.symbol === this.currentSymbol ? 'selected' : ''}>
                    ${s.symbol} (${s.count})
                </option>`
            ).join('');

            // Bind change event
            sel.onchange = () => this.switchSymbol(sel.value);

            // Load trades for default symbol
            await this.loadTrades();
        } catch (e) {
            sel.innerHTML = '<option>Error loading</option>';
        }
    },

    /**
     * Switch to a different symbol
     */
    async switchSymbol(symbol) {
        if (symbol === this.currentSymbol) return;
        this.currentSymbol = symbol;

        // Update select value
        document.getElementById('symbolSelect').value = symbol;

        // Close stats panel if open
        this.closeStatsPanel();

        // Reload trades
        await this.loadTrades();
    },

    /**
     * Toggle stats panel visibility
     */
    toggleStatsPanel() {
        const panel = document.getElementById('statsPanel');
        panel.classList.toggle('open');

        if (panel.classList.contains('open')) {
            Trades.renderDetailedStats(Trades.allTrades);
        }
    },

    /**
     * Close stats panel
     */
    closeStatsPanel() {
        document.getElementById('statsPanel').classList.remove('open');
    },

    /**
     * Load trades and render overview
     */
    async loadTrades() {
        const days = document.getElementById('daysSelect').value;
        const tradeList = document.getElementById('tradeList');
        tradeList.innerHTML = '<div class="loading"><div class="spinner"></div>Loading trades...</div>';

        try {
            const data = await API.fetchTrades(days, this.currentSymbol);
            Trades.allTrades = data.trades;

            Trades.renderStats(Trades.allTrades);
            Trades.renderList(Trades.allTrades);

            if (Trades.allTrades.length > 0) {
                await this.loadOverview(days);
            } else {
                tradeList.innerHTML = `<div class="empty"><div class="icon">--</div>No ${this.currentSymbol} trades found</div>`;
                // Clear chart
                KlineChart.setData([]);
                this.updateHeader(null);
            }
        } catch (e) {
            tradeList.innerHTML = `<div class="empty"><div class="icon">!</div>Error: ${e.message}</div>`;
        }
    },

    /**
     * Load overview chart with all trades
     */
    async loadOverview(days) {
        const data = await API.fetchKlinesRange(days, '1h', this.currentSymbol);
        KlineChart.setData(data.klines);
        KlineChart.setMarkers(KlineChart.buildOverviewMarkers(Trades.allTrades, data.klines));
        KlineChart.fitContent();
        this.updateHeader(null);
    },

    /**
     * Select a trade and show detail view
     */
    async selectTrade(idx) {
        const t = Trades.allTrades[idx];
        Trades.activeTradeId = idx;
        Trades.highlightCard(idx);
        KlineChart.clearPriceLines();

        // Fetch fine 5m K-lines for accurate markers
        // Bybit: open_ms is actually close time, need wider window to find entry price
        const isBybit = t.exchange === 'Bybit';
        const padding = isBybit ? 30 * 86400 * 1000 : 12 * 3600 * 1000;
        const startMs = (isBybit ? t.close_ms : t.open_ms) - padding;
        const endMs = t.close_ms + (isBybit ? 12 * 3600 * 1000 : padding);
        const sym = t.symbol || this.currentSymbol;
        const ex = t.exchange || '';
        const data = await API.fetchKlines(startMs, endMs, '5m', sym, ex);

        KlineChart.setData(data.klines);
        KlineChart.setMarkers(KlineChart.buildTradeMarkers(t, data.klines));

        // Price lines
        const isLong = t.direction === 'long';
        const lineColor = isLong ? '#00e676' : '#ff5252';

        KlineChart.addPriceLine({
            price: t.open_price,
            color: lineColor,
            lineWidth: 2,
            lineStyle: 2,  // dashed
            axisLabelVisible: true,
            title: `Entry ${fmtPrice(t.open_price)}`,
        });
        KlineChart.addPriceLine({
            price: t.close_price,
            color: lineColor,
            lineWidth: 2,
            lineStyle: 0,  // solid
            axisLabelVisible: true,
            title: `Exit ${fmtPrice(t.close_price)}`,
        });

        // Zoom to trade window
        KlineChart.setVisibleRange(
            Math.floor(startMs / 1000),
            Math.floor(endMs / 1000)
        );

        this.updateHeader(t);
    },

    /**
     * Back to overview chart
     */
    async backToOverview() {
        Trades.activeTradeId = -1;
        Trades.highlightCard(-1);
        KlineChart.clearPriceLines();
        const days = document.getElementById('daysSelect').value;
        await this.loadOverview(days);
    },

    /**
     * Update chart header info
     */
    updateHeader(trade) {
        const el = document.getElementById('chartHeader');
        if (!trade) {
            el.innerHTML = `<span class="info"><strong>${this.currentSymbol}</strong> Overview</span><span class="info">${Trades.allTrades.length} trades</span>`;
            return;
        }
        const isLong = trade.direction === 'long';
        const pnlClass = trade.pnl >= 0 ? 'positive' : 'negative';
        const sym = trade.symbol || this.currentSymbol;
        el.innerHTML = `
            <span class="info">
                <button class="back-btn" onclick="App.backToOverview()">&larr; Overview</button>
                <strong>${sym} ${isLong ? 'LONG' : 'SHORT'} ${trade.leverage}x</strong> &nbsp;|&nbsp;
                Entry <strong>${fmtPrice(trade.open_price)}</strong> &nbsp;|&nbsp;
                Exit <strong>${fmtPrice(trade.close_price)}</strong> &nbsp;|&nbsp;
                Hold <strong>${trade.hold_hours.toFixed(1)}h</strong>
            </span>
            <span class="info ${pnlClass}" style="font-weight:700;font-size:14px">${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)} USDT</span>
        `;
    },
};

// ─── Start ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());

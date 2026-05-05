// ─── App (Main Entry) ───────────────────────────────────────────────────────

const App = {
    currentSymbol: '',  // Active symbol (e.g. 'BTC')
    currentExchange: '',  // Active exchange filter ('' = all, 'OKX', 'Bybit')
    allSymbols: [],      // Available symbols from API

    /**
     * Initialize the application
     */
    async init() {
        KlineChart.init(document.getElementById('chart'));
        this.bindEvents();
        await this.loadSymbols();
        this.loadAiConfig();
    },

    /**
     * Bind DOM events
     */
    bindEvents() {
        document.getElementById('refreshBtn').addEventListener('click', () => this.loadTrades());
        document.getElementById('daysSelect').addEventListener('change', () => this.loadTrades());
        document.getElementById('exchangeSelect').addEventListener('change', () => this.onExchangeChange());

        // Stats panel toggle
        document.getElementById('statsBtn').addEventListener('click', () => this.toggleStatsPanel());
        document.getElementById('closeStatsBtn').addEventListener('click', () => this.closeStatsPanel());
        
        // AI analysis
        document.getElementById('aiAnalyzeBtn').addEventListener('click', () => this.runAiAnalysis());
        document.getElementById('closeAiPanel').addEventListener('click', () => this.closeAiPanel());
        
        // Settings
        document.getElementById('settingsBtn').addEventListener('click', () => this.openSettings());
        document.getElementById('closeSettingsBtn').addEventListener('click', () => this.closeSettings());
        document.getElementById('saveSettingsBtn').addEventListener('click', () => this.saveSettings());
        document.getElementById('testSettingsBtn').addEventListener('click', () => this.testSettings());
        
        // Example items click
        document.querySelectorAll('.example-item').forEach(item => {
            item.addEventListener('click', () => {
                document.getElementById('aiBaseUrl').value = item.dataset.url;
                document.getElementById('aiModel').value = item.dataset.model;
            });
        });
    },

    /**
     * Handle exchange filter change
     */
    onExchangeChange() {
        this.currentExchange = document.getElementById('exchangeSelect').value;
        this.loadTrades();
    },

    /**
     * Load AI configuration
     */
    async loadAiConfig() {
        try {
            const resp = await fetch('/api/ai_config');
            const data = await resp.json();
            document.getElementById('aiBaseUrl').value = data.base_url || '';
            document.getElementById('aiModel').value = data.model || '';
            document.getElementById('apiKeyMasked').textContent = data.api_key_masked || '未配置';
        } catch (e) {
            console.error('Failed to load AI config:', e);
        }
    },

    /**
     * Open settings panel
     */
    openSettings() {
        document.getElementById('settingsPanel').classList.add('open');
        this.loadAiConfig();
    },

    /**
     * Close settings panel
     */
    closeSettings() {
        document.getElementById('settingsPanel').classList.remove('open');
    },

    /**
     * Save AI settings
     */
    async saveSettings() {
        const baseUrl = document.getElementById('aiBaseUrl').value.trim();
        const apiKey = document.getElementById('aiApiKey').value.trim();
        const model = document.getElementById('aiModel').value.trim();
        const status = document.getElementById('settingsStatus');
        
        try {
            const resp = await fetch('/api/ai_config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ base_url: baseUrl, api_key: apiKey, model: model })
            });
            
            const data = await resp.json();
            
            if (data.status === 'ok') {
                status.textContent = '✓ 配置已保存';
                status.className = 'settings-status success';
                // Clear the API key input for security
                document.getElementById('aiApiKey').value = '';
                // Reload config to show masked key
                this.loadAiConfig();
            } else {
                status.textContent = '✗ 保存失败';
                status.className = 'settings-status error';
            }
        } catch (e) {
            status.textContent = '✗ 保存失败: ' + e.message;
            status.className = 'settings-status error';
        }
    },

    /**
     * Test AI connection
     */
    async testSettings() {
        const status = document.getElementById('settingsStatus');
        const btn = document.getElementById('testSettingsBtn');
        
        btn.disabled = true;
        btn.textContent = '测试中...';
        status.textContent = '';
        
        try {
            // Save first
            await this.saveSettings();
            
            // Then test with a simple request
            const resp = await fetch('/api/ai_analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trades: [{ pnl: 1.0, direction: 'long', open_price: 100, close_price: 101, hold_hours: 1, leverage: 10 }],
                    symbol: 'TEST',
                    days: 1
                })
            });
            
            const data = await resp.json();
            
            if (data.error) {
                status.textContent = '✗ 连接失败: ' + data.error;
                status.className = 'settings-status error';
            } else {
                status.textContent = '✓ 连接成功！AI 正常工作';
                status.className = 'settings-status success';
            }
        } catch (e) {
            status.textContent = '✗ 测试失败: ' + e.message;
            status.className = 'settings-status error';
        } finally {
            btn.disabled = false;
            btn.textContent = '测试连接';
        }
    },

    /**
     * Load available symbols and render dropdown
     */
    async loadSymbols() {
        const sel = document.getElementById('symbolSelect');
        sel.innerHTML = '<option>Loading...</option>';

        try {
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
        this.closeAiPanel();

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
     * Close AI panel
     */
    closeAiPanel() {
        document.getElementById('aiPanel').classList.remove('open');
    },

    /**
     * Run AI analysis on current trades
     */
    async runAiAnalysis() {
        const btn = document.getElementById('aiAnalyzeBtn');
        const panel = document.getElementById('aiPanel');
        const loading = document.getElementById('aiLoading');
        const result = document.getElementById('aiResult');
        
        // Check if we have trades
        if (!Trades.allTrades || Trades.allTrades.length === 0) {
            alert('No trades to analyze');
            return;
        }
        
        // Show panel and loading state
        panel.classList.add('open');
        loading.style.display = 'flex';
        result.style.display = 'none';
        btn.disabled = true;
        btn.textContent = '分析中...';
        
        try {
            const days = document.getElementById('daysSelect').value;
            const response = await fetch('/api/ai_analyze', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    trades: Trades.allTrades,
                    symbol: this.currentSymbol,
                    days: parseInt(days)
                })
            });
            
            const data = await response.json();
            
            if (data.error) {
                result.innerHTML = `<div class="highlight">${data.error}</div>`;
            } else {
                // Parse and render the AI analysis
                result.innerHTML = this.formatAiAnalysis(data.analysis);
            }
            
            loading.style.display = 'none';
            result.style.display = 'block';
            
        } catch (e) {
            result.innerHTML = `<div class="highlight">Failed to get AI analysis: ${e.message}</div>`;
            loading.style.display = 'none';
            result.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = 'AI分析';
        }
    },

    /**
     * Format AI analysis text to HTML
     */
    formatAiAnalysis(text) {
        // Convert markdown-like formatting to HTML
        let html = text
            // Headers
            .replace(/^### (.*$)/gm, '<h3>$1</h3>')
            .replace(/^## (.*$)/gm, '<h3>$1</h3>')
            .replace(/^# (.*$)/gm, '<h3>$1</h3>')
            // Bold
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // Lists
            .replace(/^\- (.*$)/gm, '<li>$1</li>')
            .replace(/^\* (.*$)/gm, '<li>$1</li>')
            // Paragraphs
            .replace(/\n\n/g, '</p><p>')
            // Line breaks
            .replace(/\n/g, '<br>');
        
        // Wrap in paragraph if not starting with a tag
        if (!html.startsWith('<')) {
            html = '<p>' + html + '</p>';
        }
        
        // Wrap lists
        html = html.replace(/(<li>.*?<\/li>)+/gs, '<ul>$&</ul>');
        
        // Highlight negative numbers
        html = html.replace(/(-\d+\.?\d*)/g, '<span class="highlight">$1</span>');
        
        // Highlight positive numbers with +
        html = html.replace(/(\+\d+\.?\d*)/g, '<span class="positive">$1</span>');
        
        return html;
    },

    /**
     * Load trades and render overview
     */
    async loadTrades() {
        const days = document.getElementById('daysSelect').value;
        const tradeList = document.getElementById('tradeList');
        tradeList.innerHTML = '<div class="loading"><div class="spinner"></div>Loading trades...</div>';

        try {
            const data = await API.fetchTrades(days, this.currentSymbol, this.currentExchange);
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

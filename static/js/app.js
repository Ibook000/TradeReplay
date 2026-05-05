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
        this.loadConfig();
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
    },

    /**
     * Handle exchange filter change
     */
    onExchangeChange() {
        this.currentExchange = document.getElementById('exchangeSelect').value;
        this.loadTrades();
    },

    /**
     * Load all configuration
     */
    async loadConfig() {
        try {
            const resp = await fetch('/api/config');
            const data = await resp.json();
            
            // OKX
            document.getElementById('okxKeyMasked').textContent = data.okx.api_key || '未配置';
            document.getElementById('okxSecretMasked').textContent = data.okx.secret_key || '未配置';
            
            // Bybit
            document.getElementById('bybitKeyMasked').textContent = data.bybit.api_key || '未配置';
            document.getElementById('bybitSecretMasked').textContent = data.bybit.secret_key || '未配置';
            
            // AI
            document.getElementById('aiBaseUrl').value = data.ai.base_url || '';
            document.getElementById('aiModel').value = data.ai.model || '';
            document.getElementById('aiKeyMasked').textContent = data.ai.api_key || '未配置';
        } catch (e) {
            console.error('Failed to load config:', e);
        }
    },

    /**
     * Open settings panel
     */
    openSettings() {
        document.getElementById('settingsPanel').classList.add('open');
        this.loadConfig();
    },

    /**
     * Close settings panel
     */
    closeSettings() {
        document.getElementById('settingsPanel').classList.remove('open');
    },

    /**
     * Save exchange configuration
     */
    async saveExchangeConfig(exchange) {
        const status = document.getElementById(`${exchange}Status`);
        
        const body = {};
        if (exchange === 'okx') {
            body.okx_api_key = document.getElementById('okxApiKey').value.trim();
            body.okx_secret_key = document.getElementById('okxSecretKey').value.trim();
            body.okx_passphrase = document.getElementById('okxPassphrase').value.trim();
        } else if (exchange === 'bybit') {
            body.bybit_api_key = document.getElementById('bybitApiKey').value.trim();
            body.bybit_secret_key = document.getElementById('bybitSecretKey').value.trim();
        }
        
        try {
            const resp = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            
            const data = await resp.json();
            
            if (data.status === 'ok') {
                status.textContent = '✓ 配置已保存';
                status.className = 'settings-status success';
                // Clear inputs for security
                if (exchange === 'okx') {
                    document.getElementById('okxApiKey').value = '';
                    document.getElementById('okxSecretKey').value = '';
                    document.getElementById('okxPassphrase').value = '';
                } else {
                    document.getElementById('bybitApiKey').value = '';
                    document.getElementById('bybitSecretKey').value = '';
                }
                this.loadConfig();
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
     * Save AI configuration
     */
    async saveAiConfig() {
        const status = document.getElementById('aiStatus');
        
        const body = {
            ai_base_url: document.getElementById('aiBaseUrl').value.trim(),
            ai_api_key: document.getElementById('aiApiKey').value.trim(),
            ai_model: document.getElementById('aiModel').value.trim(),
        };
        
        try {
            const resp = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            
            const data = await resp.json();
            
            if (data.status === 'ok') {
                status.textContent = '✓ 配置已保存';
                status.className = 'settings-status success';
                document.getElementById('aiApiKey').value = '';
                this.loadConfig();
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
     * Test exchange connection
     */
    async testExchange(exchange) {
        const status = document.getElementById(`${exchange}Status`);
        status.textContent = '测试中...';
        status.className = 'settings-status';
        
        try {
            const resp = await fetch('/api/test_exchange', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ exchange })
            });
            
            const data = await resp.json();
            
            if (data.status === 'ok') {
                status.textContent = '✓ ' + data.message;
                status.className = 'settings-status success';
            } else {
                status.textContent = '✗ ' + data.message;
                status.className = 'settings-status error';
            }
        } catch (e) {
            status.textContent = '✗ 测试失败: ' + e.message;
            status.className = 'settings-status error';
        }
    },

    /**
     * Test AI connection
     */
    async testAi() {
        const status = document.getElementById('aiStatus');
        status.textContent = '测试中...';
        status.className = 'settings-status';
        
        try {
            // Save first
            await this.saveAiConfig();
            
            // Test with a simple request
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
        }
    },

    /**
     * Fill AI example values
     */
    fillAiExample(url, model) {
        document.getElementById('aiBaseUrl').value = url;
        document.getElementById('aiModel').value = model;
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
        document.getElementById('symbolSelect').value = symbol;
        this.closeStatsPanel();
        this.closeAiPanel();
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
        
        if (!Trades.allTrades || Trades.allTrades.length === 0) {
            alert('No trades to analyze');
            return;
        }
        
        panel.classList.add('open');
        loading.style.display = 'flex';
        result.style.display = 'none';
        btn.disabled = true;
        btn.textContent = '分析中...';
        
        try {
            const days = document.getElementById('daysSelect').value;
            const response = await fetch('/api/ai_analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
        let html = text
            .replace(/^### (.*$)/gm, '<h3>$1</h3>')
            .replace(/^## (.*$)/gm, '<h3>$1</h3>')
            .replace(/^# (.*$)/gm, '<h3>$1</h3>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/^\- (.*$)/gm, '<li>$1</li>')
            .replace(/^\* (.*$)/gm, '<li>$1</li>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');
        
        if (!html.startsWith('<')) html = '<p>' + html + '</p>';
        html = html.replace(/(<li>.*?<\/li>)+/gs, '<ul>$&</ul>');
        html = html.replace(/(-\d+\.?\d*)/g, '<span class="highlight">$1</span>');
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

        const isBybit = t.exchange === 'Bybit';
        const padding = isBybit ? 30 * 86400 * 1000 : 12 * 3600 * 1000;
        const startMs = (isBybit ? t.close_ms : t.open_ms) - padding;
        const endMs = t.close_ms + (isBybit ? 12 * 3600 * 1000 : padding);
        const sym = t.symbol || this.currentSymbol;
        const ex = t.exchange || '';
        const data = await API.fetchKlines(startMs, endMs, '5m', sym, ex);

        KlineChart.setData(data.klines);
        KlineChart.setMarkers(KlineChart.buildTradeMarkers(t, data.klines));

        const isLong = t.direction === 'long';
        const lineColor = isLong ? '#00e676' : '#ff5252';

        KlineChart.addPriceLine({
            price: t.open_price,
            color: lineColor,
            lineWidth: 2,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `Entry ${fmtPrice(t.open_price)}`,
        });
        KlineChart.addPriceLine({
            price: t.close_price,
            color: lineColor,
            lineWidth: 2,
            lineStyle: 0,
            axisLabelVisible: true,
            title: `Exit ${fmtPrice(t.close_price)}`,
        });

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

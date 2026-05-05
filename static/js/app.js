const App = {
    currentSymbol: '',
    currentExchange: '',
    allSymbols: [],

    async init() {
        KlineChart.init(document.getElementById('chart'));
        this.bindEvents();
        await this.loadSymbols();
        this.loadConfig();
    },

    bindEvents() {
        document.getElementById('refreshBtn').addEventListener('click', () => this.loadTrades());
        document.getElementById('daysSelect').addEventListener('change', () => this.loadTrades());
        document.getElementById('exchangeSelect').addEventListener('change', () => {
            this.currentExchange = document.getElementById('exchangeSelect').value;
            this.loadTrades();
        });
        document.getElementById('statsBtn').addEventListener('click', () => this.togglePanel('statsPanel'));
        document.getElementById('closeStatsBtn').addEventListener('click', () => this.closePanel('statsPanel'));
        document.getElementById('aiAnalyzeBtn').addEventListener('click', () => this.runAiAnalysis());
        document.getElementById('closeAiPanel').addEventListener('click', () => this.closePanel('aiPanel'));
        document.getElementById('settingsBtn').addEventListener('click', () => this.openSettings());
        document.getElementById('closeSettingsBtn').addEventListener('click', () => this.closePanel('settingsPanel'));
    },

    togglePanel(id) {
        document.getElementById(id).classList.toggle('open');
        if (id === 'statsPanel' && document.getElementById(id).classList.contains('open')) {
            Trades.renderDetailedStats(Trades.allTrades);
        }
    },

    closePanel(id) {
        document.getElementById(id).classList.remove('open');
    },

    async openSettings() {
        document.getElementById('settingsPanel').classList.add('open');
        await this.loadConfig();
    },

    togglePassword(inputId) {
        const input = document.getElementById(inputId);
        input.type = input.type === 'password' ? 'text' : 'password';
    },

    async loadConfig() {
        try {
            const resp = await fetch('/api/config');
            const data = await resp.json();
            
            // Status dots
            document.getElementById('okxStatusDot').classList.toggle('active', data.okx.configured);
            document.getElementById('bybitStatusDot').classList.toggle('active', data.bybit.configured);
            document.getElementById('aiStatusDot').classList.toggle('active', data.ai.configured);
            
            // OKX
            document.getElementById('okxKeyMasked').textContent = data.okx.api_key || '--';
            document.getElementById('okxSecretMasked').textContent = data.okx.secret_key || '--';
            
            // Bybit
            document.getElementById('bybitKeyMasked').textContent = data.bybit.api_key || '--';
            document.getElementById('bybitSecretMasked').textContent = data.bybit.secret_key || '--';
            
            // AI
            document.getElementById('aiBaseUrl').value = data.ai.base_url || '';
            document.getElementById('aiModel').value = data.ai.model || '';
            document.getElementById('aiKeyMasked').textContent = data.ai.api_key || '--';
        } catch (e) {
            console.error('Failed to load config:', e);
        }
    },

    async saveExchangeConfig(exchange) {
        const status = document.getElementById(`${exchange}Status`);
        const body = {};
        
        if (exchange === 'okx') {
            body.okx_api_key = document.getElementById('okxApiKey').value.trim();
            body.okx_secret_key = document.getElementById('okxSecretKey').value.trim();
            body.okx_passphrase = document.getElementById('okxPassphrase').value.trim();
        } else {
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
                status.textContent = 'Saved';
                status.className = 'form-status success';
                this.clearInputs(exchange);
                await this.loadConfig();
            } else {
                status.textContent = 'Failed';
                status.className = 'form-status error';
            }
        } catch (e) {
            status.textContent = e.message;
            status.className = 'form-status error';
        }
    },

    async saveAiConfig() {
        const status = document.getElementById('aiStatus');
        try {
            const resp = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ai_base_url: document.getElementById('aiBaseUrl').value.trim(),
                    ai_api_key: document.getElementById('aiApiKey').value.trim(),
                    ai_model: document.getElementById('aiModel').value.trim()
                })
            });
            const data = await resp.json();
            
            if (data.status === 'ok') {
                status.textContent = 'Saved';
                status.className = 'form-status success';
                document.getElementById('aiApiKey').value = '';
                await this.loadConfig();
            } else {
                status.textContent = 'Failed';
                status.className = 'form-status error';
            }
        } catch (e) {
            status.textContent = e.message;
            status.className = 'form-status error';
        }
    },

    clearInputs(exchange) {
        if (exchange === 'okx') {
            document.getElementById('okxApiKey').value = '';
            document.getElementById('okxSecretKey').value = '';
            document.getElementById('okxPassphrase').value = '';
        } else {
            document.getElementById('bybitApiKey').value = '';
            document.getElementById('bybitSecretKey').value = '';
        }
    },

    async testExchange(exchange) {
        const status = document.getElementById(`${exchange}Status`);
        status.textContent = 'Testing...';
        status.className = 'form-status';
        
        try {
            const resp = await fetch('/api/test_exchange', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ exchange })
            });
            const data = await resp.json();
            
            status.textContent = data.status === 'ok' ? data.message : data.message;
            status.className = `form-status ${data.status === 'ok' ? 'success' : 'error'}`;
        } catch (e) {
            status.textContent = e.message;
            status.className = 'form-status error';
        }
    },

    async testAi() {
        const status = document.getElementById('aiStatus');
        status.textContent = 'Testing...';
        status.className = 'form-status';
        
        try {
            await this.saveAiConfig();
            const resp = await fetch('/api/ai_analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trades: [{ pnl: 1, direction: 'long', open_price: 100, close_price: 101, hold_hours: 1, leverage: 10 }],
                    symbol: 'TEST', days: 1
                })
            });
            const data = await resp.json();
            
            status.textContent = data.error ? data.error : 'Connected';
            status.className = `form-status ${data.error ? 'error' : 'success'}`;
        } catch (e) {
            status.textContent = e.message;
            status.className = 'form-status error';
        }
    },

    fillAiExample(url, model) {
        document.getElementById('aiBaseUrl').value = url;
        document.getElementById('aiModel').value = model;
    },

    async runAiAnalysis() {
        const btn = document.getElementById('aiAnalyzeBtn');
        const panel = document.getElementById('aiPanel');
        const loading = document.getElementById('aiLoading');
        const result = document.getElementById('aiResult');
        
        if (!Trades.allTrades?.length) return alert('No trades');
        
        panel.classList.add('open');
        loading.style.display = 'flex';
        result.style.display = 'none';
        btn.disabled = true;
        
        try {
            const resp = await fetch('/api/ai_analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trades: Trades.allTrades,
                    symbol: this.currentSymbol,
                    days: parseInt(document.getElementById('daysSelect').value)
                })
            });
            const data = await resp.json();
            
            result.innerHTML = data.error 
                ? `<div class="highlight">${data.error}</div>`
                : this.formatAi(data.analysis);
            
            loading.style.display = 'none';
            result.style.display = 'block';
        } catch (e) {
            result.innerHTML = `<div class="highlight">${e.message}</div>`;
            loading.style.display = 'none';
            result.style.display = 'block';
        } finally {
            btn.disabled = false;
        }
    },

    formatAi(text) {
        return text
            .replace(/^###? (.*$)/gm, '<h3>$1</h3>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/^\- (.*$)/gm, '<li>$1</li>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/(<li>.*<\/li>)+/gs, '<ul>$&</ul>')
            .replace(/(-\d+\.?\d*)/g, '<span class="highlight">$1</span>')
            .replace(/(\+\d+\.?\d*)/g, '<span class="positive">$1</span>');
    },

    async loadSymbols() {
        const sel = document.getElementById('symbolSelect');
        sel.innerHTML = '<option>Loading...</option>';

        try {
            const data = await API.fetchSymbols(180);
            this.allSymbols = data.symbols || [];

            if (!this.allSymbols.length) {
                sel.innerHTML = '<option>No trades</option>';
                return;
            }

            this.currentSymbol = this.allSymbols[0].symbol;
            document.getElementById('totalBadge').textContent = `${this.allSymbols.reduce((s, x) => s + x.count, 0)} trades`;

            sel.innerHTML = this.allSymbols.map(s =>
                `<option value="${s.symbol}" ${s.symbol === this.currentSymbol ? 'selected' : ''}>${s.symbol} (${s.count})</option>`
            ).join('');

            sel.onchange = () => this.switchSymbol(sel.value);
            await this.loadTrades();
        } catch (e) {
            sel.innerHTML = '<option>Error</option>';
        }
    },

    async switchSymbol(symbol) {
        if (symbol === this.currentSymbol) return;
        this.currentSymbol = symbol;
        document.getElementById('symbolSelect').value = symbol;
        this.closePanel('statsPanel');
        this.closePanel('aiPanel');
        await this.loadTrades();
    },

    async loadTrades() {
        const days = document.getElementById('daysSelect').value;
        const tradeList = document.getElementById('tradeList');
        tradeList.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';

        try {
            const data = await API.fetchTrades(days, this.currentSymbol, this.currentExchange);
            Trades.allTrades = data.trades;
            Trades.renderStats(Trades.allTrades);
            Trades.renderList(Trades.allTrades);

            if (Trades.allTrades.length > 0) {
                await this.loadOverview(days);
            } else {
                tradeList.innerHTML = `<div class="empty">No ${this.currentSymbol} trades</div>`;
                KlineChart.setData([]);
                this.updateHeader(null);
            }
        } catch (e) {
            tradeList.innerHTML = `<div class="empty">Error: ${e.message}</div>`;
        }
    },

    async loadOverview(days) {
        const data = await API.fetchKlinesRange(days, '1h', this.currentSymbol);
        KlineChart.setData(data.klines);
        KlineChart.setMarkers(KlineChart.buildOverviewMarkers(Trades.allTrades, data.klines));
        KlineChart.fitContent();
        this.updateHeader(null);
    },

    async selectTrade(idx) {
        const t = Trades.allTrades[idx];
        Trades.activeTradeId = idx;
        Trades.highlightCard(idx);
        KlineChart.clearPriceLines();

        const isBybit = t.exchange === 'Bybit';
        const padding = isBybit ? 30 * 86400 * 1000 : 12 * 3600 * 1000;
        const startMs = (isBybit ? t.close_ms : t.open_ms) - padding;
        const endMs = t.close_ms + (isBybit ? 12 * 3600 * 1000 : padding);
        const data = await API.fetchKlines(startMs, endMs, '5m', t.symbol || this.currentSymbol, t.exchange || '');

        KlineChart.setData(data.klines);
        KlineChart.setMarkers(KlineChart.buildTradeMarkers(t, data.klines));

        const color = t.direction === 'long' ? '#00c853' : '#ff3d3d';
        KlineChart.addPriceLine({ price: t.open_price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `Entry ${fmtPrice(t.open_price)}` });
        KlineChart.addPriceLine({ price: t.close_price, color, lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: `Exit ${fmtPrice(t.close_price)}` });
        KlineChart.setVisibleRange(Math.floor(startMs / 1000), Math.floor(endMs / 1000));
        this.updateHeader(t);
    },

    async backToOverview() {
        Trades.activeTradeId = -1;
        Trades.highlightCard(-1);
        KlineChart.clearPriceLines();
        await this.loadOverview(document.getElementById('daysSelect').value);
    },

    updateHeader(trade) {
        const el = document.getElementById('chartHeader');
        if (!trade) {
            el.innerHTML = `<span class="info"><strong>${this.currentSymbol}</strong> Overview</span><span class="info">${Trades.allTrades.length} trades</span>`;
            return;
        }
        const cls = trade.pnl >= 0 ? 'positive' : 'negative';
        el.innerHTML = `
            <span class="info">
                <button class="back-btn" onclick="App.backToOverview()">&larr; Overview</button>
                <strong>${trade.symbol || this.currentSymbol} ${trade.direction === 'long' ? 'LONG' : 'SHORT'} ${trade.leverage}x</strong> |
                Entry <strong>${fmtPrice(trade.open_price)}</strong> |
                Exit <strong>${fmtPrice(trade.close_price)}</strong> |
                Hold <strong>${trade.hold_hours.toFixed(1)}h</strong>
            </span>
            <span class="info ${cls}" style="font-weight:600;font-size:12px">${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}</span>
        `;
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());

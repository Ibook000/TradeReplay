function escapeHtml(value) {
    const htmlEscapes = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '/': '&#x2F;',
    };

    return String(value ?? '').replace(/[&<>"'\/]/g, ch => htmlEscapes[ch]);
}

const App = {
    currentSymbol: '',
    currentExchange: '',
    allSymbols: [],
    currentView: 'history',  // 'history' or 'positions'
    _positionPollTimer: null,
    _positionData: [],
    _activePositionIdx: -1,
    _positionKlineTimer: null,

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
        document.getElementById('directionSelect').addEventListener('change', () => { this._updateFilterUI(); this.loadTrades(); });
        document.getElementById('pnlSelect').addEventListener('change', () => { this._updateFilterUI(); this.loadTrades(); });
        document.getElementById('leverageSelect').addEventListener('change', () => { this._updateFilterUI(); this.loadTrades(); });
        document.getElementById('clearFiltersBtn').addEventListener('click', () => this._clearFilters());
        document.getElementById('statsBtn').addEventListener('click', () => this.togglePanel('statsPanel'));
        document.getElementById('closeStatsBtn').addEventListener('click', () => this.closePanel('statsPanel'));
        document.getElementById('aiAnalyzeBtn').addEventListener('click', () => this.runAiAnalysis());
        document.getElementById('closeAiPanel').addEventListener('click', () => this.closePanel('aiPanel'));
        document.getElementById('settingsBtn').addEventListener('click', () => this.openSettings());
        document.getElementById('closeSettingsBtn').addEventListener('click', () => this.closePanel('settingsPanel'));
        document.getElementById('closeReviewBtn').addEventListener('click', () => this.closePanel('reviewPanel'));
    },

    /**
     * Switch between History and Positions views
     */
    switchView(view) {
        this.currentView = view;
        
        // Update tab buttons
        document.querySelectorAll('.view-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.view === view);
        });
        
        // Show/hide history controls
        const historyControls = document.getElementById('historyControls');
        historyControls.style.display = view === 'history' ? 'block' : 'none';
        
        // Show/hide trade list vs positions list
        const tradeList = document.getElementById('tradeList');
        const positionsList = document.getElementById('positionsList');
        
        if (view === 'history') {
            tradeList.style.display = 'block';
            positionsList.style.display = 'none';
            this._stopPositionPoll();
            this._stopPositionKlineRefresh();
        } else {
            tradeList.style.display = 'none';
            positionsList.style.display = 'block';
            this.loadPositions();
            this._startPositionPoll();
        }
    },

    /**
     * Start auto-polling positions every 10 seconds
     */
    _startPositionPoll() {
        this._stopPositionPoll();
        this._positionPollTimer = setInterval(() => {
            if (this.currentView === 'positions') {
                this.loadPositions(true);
            }
        }, 10000);
    },

    /**
     * Stop position polling
     */
    _stopPositionPoll() {
        if (this._positionPollTimer) {
            clearInterval(this._positionPollTimer);
            this._positionPollTimer = null;
        }
    },

    /**
     * Start auto-refreshing K-line for active position every 5 seconds
     */
    _startPositionKlineRefresh() {
        this._stopPositionKlineRefresh();
        this._positionKlineTimer = setInterval(() => {
            if (this._activePositionIdx >= 0 && this._positionData[this._activePositionIdx]) {
                this._refreshPositionKline(this._positionData[this._activePositionIdx]);
            }
        }, 5000);
    },

    /**
     * Stop K-line auto-refresh
     */
    _stopPositionKlineRefresh() {
        if (this._positionKlineTimer) {
            clearInterval(this._positionKlineTimer);
            this._positionKlineTimer = null;
        }
    },

    /**
     * Load current positions from all exchanges
     */
    async loadPositions(isPoll = false) {
        const positionsList = document.getElementById('positionsList');
        if (!isPoll) {
            positionsList.innerHTML = '<div class="loading"><div class="spinner"></div>Loading positions...</div>';
        }
        
        try {
            const resp = await fetch('/api/positions');
            const data = await resp.json();
            const positions = data.positions || [];
            this._positionData = positions;
            
            if (positions.length === 0) {
                positionsList.innerHTML = '<div class="empty">No open positions</div>';
                this._activePositionIdx = -1;
                return;
            }
            
            this.renderPositions(positions);
        } catch (e) {
            if (!isPoll) {
                positionsList.innerHTML = `<div class="empty">Error: ${escapeHtml(e.message)}</div>`;
            }
        }
    },

    /**
     * Render position cards
     */
    renderPositions(positions) {
        const positionsList = document.getElementById('positionsList');
        const escape = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value ?? '');
        
        // Summary stats
        const totalPnl = positions.reduce((s, p) => s + p.unrealized_pnl, 0);
        const totalMargin = positions.reduce((s, p) => s + p.margin, 0);
        
        let html = `
            <div class="positions-summary">
                <div class="pos-stat">
                    <div class="label">Unrealized PnL</div>
                    <div class="value ${totalPnl >= 0 ? 'positive' : 'negative'}">${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} USDT</div>
                </div>
                <div class="pos-stat">
                    <div class="label">Total Margin</div>
                    <div class="value">${totalMargin.toFixed(2)} USDT</div>
                </div>
                <div class="pos-stat">
                    <div class="label">Positions</div>
                    <div class="value">${positions.length}</div>
                </div>
            </div>
        `;
        
        // Position cards
        positions.forEach((p, i) => {
            const isLong = p.direction === 'long';
            const pnlClass = p.unrealized_pnl >= 0 ? 'positive' : 'negative';
            const exClass = p.exchange === 'OKX' ? 'okx' : p.exchange === 'Bybit' ? 'bybit' : 'bitget';
            const pnlPct = p.entry_price > 0 ? ((p.mark_price - p.entry_price) / p.entry_price * 100 * (isLong ? 1 : -1)) : 0;
            const isActive = i === this._activePositionIdx;
            
            html += `
                <div class="position-card ${isActive ? 'active' : ''}" data-pos-idx="${i}" onclick="App.selectPosition(${i})">
                    <div class="pos-header">
                        <span class="exchange ${exClass}">${escape(p.exchange)}</span>
                        <span class="dir ${isLong ? 'long' : 'short'}">${isLong ? 'LONG' : 'SHORT'}</span>
                        <span class="pos-symbol">${escape(p.symbol)}</span>
                        <span class="pos-lev">${p.leverage}x</span>
                    </div>
                    <div class="pos-pnl ${pnlClass}">
                        <span class="pnl-value">${p.unrealized_pnl >= 0 ? '+' : ''}${p.unrealized_pnl.toFixed(2)} USDT</span>
                        <span class="pnl-pct">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</span>
                    </div>
                    <div class="pos-details">
                        <div class="pos-detail">
                            <span class="label">Entry</span>
                            <span class="val">${fmtPrice(p.entry_price)}</span>
                        </div>
                        <div class="pos-detail">
                            <span class="label">Mark</span>
                            <span class="val">${fmtPrice(p.mark_price)}</span>
                        </div>
                        <div class="pos-detail">
                            <span class="label">Size</span>
                            <span class="val">${p.size}</span>
                        </div>
                        <div class="pos-detail">
                            <span class="label">Margin</span>
                            <span class="val">${p.margin.toFixed(2)}</span>
                        </div>
                        ${p.liquidation_price > 0 ? `
                        <div class="pos-detail liq-price">
                            <span class="label">Liq Price</span>
                            <span class="val">${fmtPrice(p.liquidation_price)}</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;
        });
        
        positionsList.innerHTML = html;
        // Re-highlight active card
        if (this._activePositionIdx >= 0) {
            const activeCard = positionsList.querySelector(`.position-card[data-pos-idx="${this._activePositionIdx}"]`);
            if (activeCard) activeCard.classList.add('active');
        }
    },

    /**
     * Select a position to view its K-line chart
     */
    async selectPosition(idx) {
        const p = this._positionData[idx];
        if (!p) return;

        this._activePositionIdx = idx;

        // Highlight card
        document.querySelectorAll('.position-card').forEach(c => c.classList.remove('active'));
        const card = document.querySelector(`.position-card[data-pos-idx="${idx}"]`);
        if (card) card.classList.add('active');

        // Update header
        const isLong = p.direction === 'long';
        const color = p.unrealized_pnl >= 0 ? '#00c853' : '#ff3d3d';
        document.getElementById('chartHeader').innerHTML = `
            <span class="info">
                <span class="exchange ${p.exchange === 'OKX' ? 'okx' : p.exchange === 'Bybit' ? 'bybit' : 'bitget'}" style="font-size:10px;padding:2px 6px;border-radius:3px;margin-right:6px;">${escapeHtml(p.exchange)}</span>
                <strong>${escapeHtml(p.symbol)}</strong>
                <span class="dir ${isLong ? 'long' : 'short'}" style="font-size:10px;padding:2px 6px;border-radius:3px;margin:0 6px;">${isLong ? 'LONG' : 'SHORT'}</span>
                ${p.leverage}x |
                Entry <strong>${fmtPrice(p.entry_price)}</strong> |
                Mark <strong>${fmtPrice(p.mark_price)}</strong>
            </span>
            <span style="display:flex;align-items:center;gap:8px;">
                <span class="info" style="font-weight:600;font-size:12px;color:${color};">${p.unrealized_pnl >= 0 ? '+' : ''}${p.unrealized_pnl.toFixed(2)} USDT</span>
                <span style="font-size:10px;color:#5a5a6e;">LIVE</span>
                <button class="ai-review-btn" id="posAiBtn" onclick="App.analyzePosition()">AI</button>
                <button class="back-btn" onclick="App.backFromPosition()">&larr; Overview</button>
            </span>
        `;

        // Load K-line chart
        await this._loadPositionKline(p);
        this._startPositionKlineRefresh();
    },

    /**
     * Fetch and render K-line for a position (last 24h, 5m interval)
     */
    async _loadPositionKline(p) {
        const now = Date.now();
        const startMs = now - 24 * 3600 * 1000;
        const symbol = p.symbol.replace(/[-\/]/g, '').replace(/USDT$/, '').replace(/USD$/, '');

        try {
            const data = await API.fetchKlines(startMs, now, '5m', symbol, p.exchange);
            if (!data.klines || data.klines.length === 0) return;

            KlineChart.setDataAdaptive(data.klines);
            KlineChart.clearMarkers();
            KlineChart.clearPriceLines();

            // Entry price line
            KlineChart.addPriceLine({
                price: p.entry_price,
                color: p.direction === 'long' ? '#00e676' : '#ff5252',
                lineWidth: 1,
                lineStyle: 2,
                axisLabelVisible: true,
                title: `Entry ${fmtPrice(p.entry_price)}`
            });

            // Mark price line
            KlineChart.addPriceLine({
                price: p.mark_price,
                color: '#5e6ad2',
                lineWidth: 1,
                lineStyle: 0,
                axisLabelVisible: true,
                title: `Mark ${fmtPrice(p.mark_price)}`
            });

            // Liquidation price line
            if (p.liquidation_price > 0) {
                KlineChart.addPriceLine({
                    price: p.liquidation_price,
                    color: '#ff3d3d',
                    lineWidth: 1,
                    lineStyle: 1,
                    axisLabelVisible: true,
                    title: `Liq ${fmtPrice(p.liquidation_price)}`
                });
            }

        } catch (e) {
            console.error('Failed to load position kline:', e);
        }
    },

    /**
     * Refresh K-line data for the active position (called by polling timer)
     */
    async _refreshPositionKline(p) {
        const now = Date.now();
        const startMs = now - 24 * 3600 * 1000;
        const symbol = p.symbol.replace(/[-\/]/g, '').replace(/USDT$/, '').replace(/USD$/, '');

        try {
            const data = await API.fetchKlines(startMs, now, '5m', symbol, p.exchange);
            if (!data.klines || data.klines.length === 0) return;

            KlineChart.setData(data.klines);

            // Update price lines
            KlineChart.clearPriceLines();
            KlineChart.addPriceLine({
                price: p.entry_price,
                color: p.direction === 'long' ? '#00e676' : '#ff5252',
                lineWidth: 1,
                lineStyle: 2,
                axisLabelVisible: true,
                title: `Entry ${fmtPrice(p.entry_price)}`
            });
            KlineChart.addPriceLine({
                price: p.mark_price,
                color: '#5e6ad2',
                lineWidth: 1,
                lineStyle: 0,
                axisLabelVisible: true,
                title: `Mark ${fmtPrice(p.mark_price)}`
            });
            if (p.liquidation_price > 0) {
                KlineChart.addPriceLine({
                    price: p.liquidation_price,
                    color: '#ff3d3d',
                    lineWidth: 1,
                    lineStyle: 1,
                    axisLabelVisible: true,
                    title: `Liq ${fmtPrice(p.liquidation_price)}`
                });
            }
        } catch (e) {
            // Silent fail on poll refresh
        }
    },

    /**
     * Go back from position view to history overview
     */
    backFromPosition() {
        this._activePositionIdx = -1;
        this._stopPositionKlineRefresh();
        this.switchView('history');
    },

    /**
     * Run AI analysis on the current position
     */
    async analyzePosition() {
        const p = this._positionData[this._activePositionIdx];
        if (!p) return;

        const btn = document.getElementById('posAiBtn');
        const content = document.getElementById('reviewContent');

        // Open side-panel, close others
        this.togglePanel('reviewPanel');
        btn.disabled = true;
        btn.textContent = '...';
        content.innerHTML = '<div class="ai-loading"><div class="spinner"></div><span>Analyzing position...</span></div>';

        try {
            const resp = await fetch('/api/analyze_position', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    exchange: p.exchange,
                    symbol: p.symbol,
                    direction: p.direction,
                    leverage: p.leverage,
                    entry_price: p.entry_price,
                    mark_price: p.mark_price,
                    size: p.size,
                    margin: p.margin,
                    liquidation_price: p.liquidation_price,
                    unrealized_pnl: p.unrealized_pnl
                })
            });
            const data = await resp.json();

            if (data.found) {
                content.innerHTML = this.formatTradeReview(data.review);
                btn.textContent = 'Done';
                btn.classList.add('done');
            } else {
                content.innerHTML = `<div class="highlight">Error: ${escapeHtml(data.detail || 'Unknown')}</div>`;
                btn.textContent = 'Retry';
            }
        } catch (e) {
            content.innerHTML = `<div class="highlight">Failed: ${escapeHtml(e.message)}</div>`;
            btn.textContent = 'Retry';
        }
        btn.disabled = false;
    },

    togglePanel(id) {
        const panel = document.getElementById(id);
        const wasOpen = panel.classList.contains('open');
        // Close all other panels first
        document.querySelectorAll('.side-panel.open').forEach(p => {
            if (p.id !== id) p.classList.remove('open');
        });
        panel.classList.toggle('open', !wasOpen);
        if (id === 'statsPanel' && !wasOpen) {
            Trades.renderDetailedStats(Trades.allTrades);
        }
        // Trigger chart resize after panel transition
        setTimeout(() => KlineChart.resize(), 50);
    },

    closePanel(id) {
        document.getElementById(id).classList.remove('open');
        setTimeout(() => KlineChart.resize(), 50);
    },

    async openSettings() {
        // Close other panels
        document.querySelectorAll('.side-panel.open').forEach(p => {
            if (p.id !== 'settingsPanel') p.classList.remove('open');
        });
        document.getElementById('settingsPanel').classList.add('open');
        await this.loadConfig();
        setTimeout(() => KlineChart.resize(), 50);
    },

    togglePassword(inputId) {
        const input = document.getElementById(inputId);
        input.type = input.type === 'password' ? 'text' : 'password';
    },

    toggleSection(sectionId) {
        const section = document.querySelector(`.settings-section:has(#${sectionId}Body)`);
        if (section) {
            section.classList.toggle('collapsed');
        }
    },

    async loadConfig() {
        try {
            const resp = await fetch('/api/config');
            const data = await resp.json();
            
            // Status dots
            document.getElementById('okxStatusDot').classList.toggle('active', data.okx.configured);
            document.getElementById('bybitStatusDot').classList.toggle('active', data.bybit.configured);
            document.getElementById('bitgetStatusDot').classList.toggle('active', data.bitget?.configured || false);
            document.getElementById('aiStatusDot').classList.toggle('active', data.ai.configured);
            
            // OKX
            document.getElementById('okxKeyMasked').textContent = data.okx.api_key || '--';
            document.getElementById('okxSecretMasked').textContent = data.okx.secret_key || '--';
            document.getElementById('okxPassphraseMasked').textContent = data.okx.passphrase || '--';
            
            // Bybit
            document.getElementById('bybitKeyMasked').textContent = data.bybit.api_key || '--';
            document.getElementById('bybitSecretMasked').textContent = data.bybit.secret_key || '--';
            
            // Bitget
            if (data.bitget) {
                document.getElementById('bitgetKeyMasked').textContent = data.bitget.api_key || '--';
                document.getElementById('bitgetSecretMasked').textContent = data.bitget.secret_key || '--';
            }
            
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
        } else if (exchange === 'bybit') {
            body.bybit_api_key = document.getElementById('bybitApiKey').value.trim();
            body.bybit_secret_key = document.getElementById('bybitSecretKey').value.trim();
        } else if (exchange === 'bitget') {
            body.bitget_api_key = document.getElementById('bitgetApiKey').value.trim();
            body.bitget_secret_key = document.getElementById('bitgetSecretKey').value.trim();
            body.bitget_passphrase = document.getElementById('bitgetPassphrase').value.trim();
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
        } else if (exchange === 'bybit') {
            document.getElementById('bybitApiKey').value = '';
            document.getElementById('bybitSecretKey').value = '';
        } else if (exchange === 'bitget') {
            document.getElementById('bitgetApiKey').value = '';
            document.getElementById('bitgetSecretKey').value = '';
            document.getElementById('bitgetPassphrase').value = '';
        }
    },

    async testAi() {
        const status = document.getElementById('aiStatus');
        status.textContent = 'Testing...';
        status.className = 'form-status';
        
        try {
            await this.saveAiConfig();
            const resp = await fetch('/api/test_ai', { method: 'POST' });
            const data = await resp.json();
            
            status.textContent = data.message;
            status.className = `form-status ${data.status === 'ok' ? 'success' : 'error'}`;
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
        const weekHeader = document.getElementById('aiWeekHeader');
        const weekLabel = document.getElementById('aiWeekLabel');
        const weekStats = document.getElementById('aiWeekStats');
        const historySection = document.getElementById('aiHistorySection');
        const historyList = document.getElementById('aiHistoryList');
        panel.classList.add('open');
        loading.style.display = 'flex';
        result.style.display = 'none';
        weekHeader.style.display = 'none';
        historySection.style.display = 'none';
        try {
            // Load latest analysis + history in parallel
            const [analysisResp, historyResp] = await Promise.all([
                fetch('/api/ai_analysis'),
                fetch('/api/ai_history?limit=12')
            ]);
            const analysisData = await analysisResp.json();
            const historyData = await historyResp.json();

            if (analysisData.found) {
                weekLabel.textContent = `${analysisData.week_start} ~ ${analysisData.week_end}`;
                weekStats.textContent = `| ${analysisData.trade_count} trades | ${analysisData.total_pnl >= 0 ? '+' : ''}${analysisData.total_pnl?.toFixed(2)} USDT | ${analysisData.win_rate?.toFixed(1)}% WR`;
                weekHeader.style.display = 'block';
                result.innerHTML = this.formatAi(analysisData.analysis);
            } else {
                result.innerHTML = `<div style="color:#5a5a6e;text-align:center;padding:20px;">No analysis yet. Runs every Monday at 00:00.</div>`;
            }
            loading.style.display = 'none';
            result.style.display = 'block';

            // Render history
            if (historyData.history?.length > 1) {
                historyList.innerHTML = historyData.history.slice(1).map(h => {
                    const weekStart = escapeHtml(h.week_start);
                    const weekEnd = escapeHtml(h.week_end);
                    const totalPnl = Number(h.total_pnl) || 0;
                    return `<div class="trade-card ai-history-item" data-week-start="${weekStart}" style="cursor:pointer;padding:6px 10px;margin-bottom:4px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span style="font-size:10px;color:#8a8a9a;">${weekStart} ~ ${weekEnd}</span>
                            <span style="font-size:10px;font-family:monospace;color:${totalPnl >= 0 ? '#00c853' : '#ff3d3d'};">${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}</span>
                        </div>
                    </div>`;
                }).join('');
                historyList.querySelectorAll('.ai-history-item').forEach(item => {
                    item.addEventListener('click', () => this.loadWeekAnalysis(item.dataset.weekStart));
                });
                historySection.style.display = 'block';
            }
        } catch (e) {
            result.innerHTML = `<div class="highlight">Failed to load: ${escapeHtml(e.message)}</div>`;
            loading.style.display = 'none';
            result.style.display = 'block';
        }
    },

    async loadWeekAnalysis(weekStart) {
        const result = document.getElementById('aiResult');
        const weekHeader = document.getElementById('aiWeekHeader');
        const weekLabel = document.getElementById('aiWeekLabel');
        const weekStats = document.getElementById('aiWeekStats');
        const loading = document.getElementById('aiLoading');

        loading.style.display = 'flex';
        result.style.display = 'none';
        try {
            const resp = await fetch(`/api/ai_analysis?week=${encodeURIComponent(weekStart)}`);
            const data = await resp.json();
            if (data.found) {
                weekLabel.textContent = `${data.week_start} ~ ${data.week_end}`;
                weekStats.textContent = `| ${data.trade_count} trades | ${data.total_pnl >= 0 ? '+' : ''}${data.total_pnl?.toFixed(2)} USDT | ${data.win_rate?.toFixed(1)}% WR`;
                weekHeader.style.display = 'block';
                result.innerHTML = this.formatAi(data.analysis);
            }
            loading.style.display = 'none';
            result.style.display = 'block';
        } catch (e) {
            loading.style.display = 'none';
            result.style.display = 'block';
            result.innerHTML = `<div class="highlight">Failed to load: ${escapeHtml(e.message)}</div>`;
        }
    },

    formatAi(text) {
        // Try JSON parse first
        try {
            const d = JSON.parse(text);
            return this.renderAiJson(d);
        } catch (e) { /* not JSON, fall through to plain text */ }
        // Plain text fallback
        return escapeHtml(text)
            .replace(/^###? (.*$)/gm, '<h3>$1</h3>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/^\- (.*$)/gm, '<li>$1</li>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/(<li>.*<\/li>)+/gs, '<ul>$&</ul>')
            .replace(/(-\d+\.?\d*)/g, '<span class="highlight">$1</span>')
            .replace(/(\+\d+\.?\d*)/g, '<span class="positive">$1</span>');
    },

    renderAiJson(d) {
        const sevColor = { high: '#ff3d3d', medium: '#fbbf24', low: '#5a5a6e' };
        const sevLabel = { high: 'HIGH', medium: 'MED', low: 'LOW' };
        let html = '';

        // Summary + Score
        if (d.summary) {
            const rawScore = Number(d.score);
            const score = Number.isFinite(rawScore) ? rawScore : '--';
            const scoreColor = rawScore >= 60 ? '#00c853' : rawScore >= 40 ? '#fbbf24' : '#ff3d3d';
            const summary = escapeHtml(d.summary);
            html += `<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
                <div style="font-size:28px;font-weight:700;font-family:monospace;color:${scoreColor};">${score}</div>
                <div style="flex:1;">
                    <div style="font-size:13px;font-weight:600;color:#e1e1e6;">${summary}</div>
                    <div style="font-size:9px;color:#5a5a6e;margin-top:2px;">WEEKLY SCORE</div>
                </div>
            </div>`;
        }

        // Top Issues
        if (d.top_issues?.length) {
            html += `<h3 style="font-size:10px;color:#ff3d3d;margin:16px 0 8px;text-transform:uppercase;letter-spacing:1px;">Top Issues</h3>`;
            for (const issue of d.top_issues) {
                const severity = escapeHtml(issue.severity);
                const c = sevColor[issue.severity] || '#5a5a6e';
                const label = escapeHtml(sevLabel[issue.severity] || issue.severity);
                const title = escapeHtml(issue.title);
                const detail = escapeHtml(issue.detail);
                html += `<div style="background:rgba(255,61,61,0.06);border-left:3px solid ${c};padding:8px 10px;margin-bottom:6px;border-radius:0 4px 4px 0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:11px;font-weight:600;color:#e1e1e6;">${title}</span>
                        <span title="${severity}" style="font-size:8px;font-weight:700;color:${c};background:${c}22;padding:1px 5px;border-radius:2px;">${label}</span>
                    </div>
                    <div style="font-size:10px;color:#8a8a9a;margin-top:4px;line-height:1.5;">${detail}</div>
                </div>`;
            }
        }

        // Repeated Mistakes
        if (d.repeated_mistakes?.length) {
            html += `<h3 style="font-size:10px;color:#fbbf24;margin:16px 0 8px;text-transform:uppercase;letter-spacing:1px;">Repeated Mistakes</h3>`;
            for (const m of d.repeated_mistakes) {
                const pattern = escapeHtml(m.pattern);
                const evidence = escapeHtml(m.evidence);
                html += `<div style="background:rgba(251,191,36,0.06);border-left:3px solid #fbbf24;padding:8px 10px;margin-bottom:6px;border-radius:0 4px 4px 0;">
                    <div style="font-size:11px;font-weight:600;color:#e1e1e6;">${pattern}</div>
                    <div style="font-size:10px;color:#8a8a9a;margin-top:4px;line-height:1.5;">${evidence}</div>
                </div>`;
            }
        }

        // Action Items
        if (d.action_items?.length) {
            html += `<h3 style="font-size:10px;color:#00c853;margin:16px 0 8px;text-transform:uppercase;letter-spacing:1px;">Action Items</h3>`;
            const sorted = [...d.action_items].sort((a, b) => (a.priority || 99) - (b.priority || 99));
            for (const item of sorted) {
                const p = escapeHtml(item.priority || '-');
                const action = escapeHtml(item.action);
                html += `<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;">
                    <span style="font-size:9px;font-weight:700;color:#0f172a;background:#00c853;padding:1px 5px;border-radius:2px;min-width:16px;text-align:center;">P${p}</span>
                    <span style="font-size:11px;color:#e1e1e6;line-height:1.5;">${action}</span>
                </div>`;
            }
        }

        return html || escapeHtml(JSON.stringify(d));
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

            sel.innerHTML = this.allSymbols.map(s => {
                const symbol = escapeHtml(s.symbol);
                return `<option value="${symbol}" ${s.symbol === this.currentSymbol ? 'selected' : ''}>${symbol} (${Number(s.count) || 0})</option>`;
            }).join('');

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
        const direction = document.getElementById('directionSelect').value;
        const pnl = document.getElementById('pnlSelect').value;
        const leverage = document.getElementById('leverageSelect').value;
        const tradeList = document.getElementById('tradeList');
        tradeList.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';

        try {
            const data = await API.fetchTrades(days, this.currentSymbol, this.currentExchange, direction, pnl, Number(leverage));
            Trades.allTrades = data.trades;
            Trades.renderStats(Trades.allTrades);
            Trades.renderList(Trades.allTrades);

            if (Trades.allTrades.length > 0) {
                await this.loadOverview(days);
            } else {
                tradeList.innerHTML = `<div class="empty">No ${escapeHtml(this.currentSymbol)} trades</div>`;
                KlineChart.setData([]);
                this.updateHeader(null);
            }
        } catch (e) {
            tradeList.innerHTML = `<div class="empty">Error: ${escapeHtml(e.message)}</div>`;
        }
    },

    async loadOverview(days) {
        const data = await API.fetchKlinesRange(days, '1h', this.currentSymbol);
        KlineChart.setDataAdaptive(data.klines);
        KlineChart.setMarkers(KlineChart.buildOverviewMarkers(Trades.allTrades, data.klines));
        this.updateHeader(null);
    },

    async selectTrade(idx) {
        const t = Trades.allTrades[idx];
        Trades.activeTradeId = idx;
        Trades.highlightCard(idx);
        KlineChart.clearPriceLines();

        const noOpenTime = t.exchange === 'Bybit';
        const padding = noOpenTime ? 30 * 86400 * 1000 : 12 * 3600 * 1000;
        const startMs = (noOpenTime ? t.close_ms : t.open_ms) - padding;
        const endMs = t.close_ms + (noOpenTime ? 12 * 3600 * 1000 : padding);
        const data = await API.fetchKlines(startMs, endMs, '5m', t.symbol || this.currentSymbol, t.exchange || '');

        KlineChart.setDataAdaptive(data.klines);
        KlineChart.clearMarkers();
        KlineChart.setMarkers(KlineChart.buildTradeMarkers(t, data.klines));

        const color = t.direction === 'long' ? '#00c853' : '#ff3d3d';
        KlineChart.addPriceLine({ price: t.open_price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `Entry ${fmtPrice(t.open_price)}` });
        KlineChart.addPriceLine({ price: t.close_price, color, lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: `Exit ${fmtPrice(t.close_price)}` });
        KlineChart.setVisibleRange(Math.floor(startMs / 1000), Math.floor(endMs / 1000));
        this.updateHeader(t);
    },

    async backToOverview() {
        this.replay.stop();
        Trades.activeTradeId = -1;
        Trades.highlightCard(-1);
        KlineChart.clearPriceLines();
        await this.loadOverview(document.getElementById('daysSelect').value);
    },

    updateHeader(trade) {
        const el = document.getElementById('chartHeader');
        if (!trade) {
            el.innerHTML = `<span class="info"><strong>${escapeHtml(this.currentSymbol)}</strong> Overview</span><span class="info">${Trades.allTrades.length} trades</span>`;
            this.closePanel('reviewPanel');
            return;
        }
        const cls = trade.pnl >= 0 ? 'positive' : 'negative';
        const symbol = escapeHtml(trade.symbol || this.currentSymbol);
        const direction = trade.direction === 'long' ? 'LONG' : 'SHORT';
        const leverage = escapeHtml(trade.leverage);
        el.innerHTML = `
            <span class="info">
                <button class="back-btn" onclick="App.backToOverview()">&larr; Overview</button>
                <strong>${symbol} ${direction} ${leverage}x</strong> |
                Entry <strong>${fmtPrice(trade.open_price)}</strong> |
                Exit <strong>${fmtPrice(trade.close_price)}</strong> |
                Hold <strong>${trade.hold_hours.toFixed(1)}h</strong>
            </span>
            <span style="display:flex;align-items:center;gap:8px;">
                <span class="info ${cls}" style="font-weight:600;font-size:12px">${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}</span>
                <button class="ai-review-btn" id="aiReviewBtn" onclick="App.runTradeReview()">AI Review</button>
                <button class="replay-trigger" onclick="App.startReplay()">Replay</button>
            </span>
        `;
        // Hide review panel when switching trades
        this.closePanel('reviewPanel');
    },

    async runTradeReview() {
        const t = Trades.allTrades[Trades.activeTradeId];
        if (!t) return;

        const btn = document.getElementById('aiReviewBtn');
        const content = document.getElementById('reviewContent');

        // Open side-panel, close others
        this.togglePanel('reviewPanel');
        btn.disabled = true;
        btn.textContent = '...';
        content.innerHTML = '<div class="ai-loading"><div class="spinner"></div><span>Analyzing...</span></div>';

        try {
            const resp = await fetch('/api/review_trade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trade_id: t.id })
            });
            const data = await resp.json();

            if (data.found) {
                content.innerHTML = this.formatTradeReview(data.review);
                btn.textContent = data.cached ? 'Cached' : 'Done';
                btn.classList.add('done');
            } else {
                content.innerHTML = `<div class="highlight">Error: ${escapeHtml(data.detail || 'Unknown')}</div>`;
                btn.textContent = 'Retry';
            }
        } catch (e) {
            content.innerHTML = `<div class="highlight">Failed: ${escapeHtml(e.message)}</div>`;
            btn.textContent = 'Retry';
        }
        btn.disabled = false;
    },

    formatTradeReview(text) {
        // Try JSON parse first
        try {
            const d = JSON.parse(text);
            return this.renderReviewJson(d);
        } catch (e) { /* not JSON */ }
        // Plain text fallback
        return `<div style="font-size:11px;color:#e1e1e6;line-height:1.6;white-space:pre-wrap;">${escapeHtml(text)}</div>`;
    },

    renderReviewJson(d) {
        const sevColor = { high: '#ff3d3d', medium: '#fbbf24', low: '#5a5a6e' };
        const sevLabel = { high: 'HIGH', medium: 'MED', low: 'LOW' };
        let html = '';

        // Summary + Score
        if (d.summary) {
            const rawScore = Number(d.score);
            const score = Number.isFinite(rawScore) ? rawScore : '--';
            const scoreColor = rawScore >= 60 ? '#00c853' : rawScore >= 40 ? '#fbbf24' : '#ff3d3d';
            html += `<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
                <div style="font-size:32px;font-weight:700;font-family:monospace;color:${scoreColor};">${score}</div>
                <div style="flex:1;">
                    <div style="font-size:13px;font-weight:600;color:#e1e1e6;">${escapeHtml(d.summary)}</div>
                    <div style="font-size:9px;color:#5a5a6e;margin-top:2px;">TRADE SCORE</div>
                </div>
            </div>`;
        }

        // Entry/Exit analysis
        if (d.entry_analysis) {
            html += `<div style="background:rgba(0,200,83,0.06);border-left:3px solid #00c853;padding:8px 10px;margin-bottom:6px;border-radius:0 4px 4px 0;">
                <div style="font-size:9px;color:#00c853;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Entry</div>
                <div style="font-size:11px;color:#e1e1e6;margin-top:4px;line-height:1.5;">${escapeHtml(d.entry_analysis)}</div>
            </div>`;
        }
        if (d.exit_analysis) {
            html += `<div style="background:rgba(255,61,61,0.06);border-left:3px solid #ff3d3d;padding:8px 10px;margin-bottom:6px;border-radius:0 4px 4px 0;">
                <div style="font-size:9px;color:#ff3d3d;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Exit</div>
                <div style="font-size:11px;color:#e1e1e6;margin-top:4px;line-height:1.5;">${escapeHtml(d.exit_analysis)}</div>
            </div>`;
        }

        // Issues
        if (d.top_issues?.length) {
            html += `<div style="font-size:9px;color:#ff3d3d;font-weight:700;margin:12px 0 6px;text-transform:uppercase;letter-spacing:1px;">Issues</div>`;
            for (const issue of d.top_issues) {
                const c = sevColor[issue.severity] || '#5a5a6e';
                const label = sevLabel[issue.severity] || issue.severity;
                html += `<div style="background:rgba(255,61,61,0.06);border-left:3px solid ${c};padding:8px 10px;margin-bottom:6px;border-radius:0 4px 4px 0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:11px;font-weight:600;color:#e1e1e6;">${escapeHtml(issue.title)}</span>
                        <span style="font-size:8px;font-weight:700;color:${c};background:${c}22;padding:1px 5px;border-radius:2px;">${escapeHtml(label)}</span>
                    </div>
                    <div style="font-size:10px;color:#8a8a9a;margin-top:4px;line-height:1.5;">${escapeHtml(issue.detail)}</div>
                </div>`;
            }
        }

        // Action items
        if (d.action_items?.length) {
            html += `<div style="font-size:9px;color:#00c853;font-weight:700;margin:12px 0 6px;text-transform:uppercase;letter-spacing:1px;">Action Items</div>`;
            const sorted = [...d.action_items].sort((a, b) => (a.priority || 99) - (b.priority || 99));
            for (const item of sorted) {
                html += `<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;">
                    <span style="font-size:9px;font-weight:700;color:#0f172a;background:#00c853;padding:1px 5px;border-radius:2px;min-width:16px;text-align:center;">P${escapeHtml(item.priority || '-')}</span>
                    <span style="font-size:11px;color:#e1e1e6;line-height:1.5;">${escapeHtml(item.action)}</span>
                </div>`;
            }
        }

        return html || escapeHtml(JSON.stringify(d));
    },

    _updateFilterUI() {
        const pills = ['directionSelect', 'pnlSelect', 'leverageSelect'];
        let hasActive = false;
        pills.forEach(id => {
            const el = document.getElementById(id);
            const isActive = el.value !== '';
            el.classList.toggle('active', isActive);
            if (isActive) hasActive = true;
        });
        document.getElementById('clearFiltersBtn').classList.toggle('hidden', !hasActive);
    },

    _clearFilters() {
        document.getElementById('directionSelect').value = '';
        document.getElementById('pnlSelect').value = '';
        document.getElementById('leverageSelect').value = '';
        this._updateFilterUI();
        this.loadTrades();
    },

    // ─── Replay ─────────────────────────────────────────────────────────
    replay: {
        _timer: null,
        _klines: [],
        _markers: [],
        _idx: 0,
        _entryIdx: -1,
        _exitIdx: -1,
        _speed: 1,
        _playing: false,
        _trade: null,
        _baseInterval: 400, // ms per candle at 1x

        async start(trade) {
            this.stop();
            this._trade = trade;
            this._playing = false;
            this._speed = 1;

            // Fetch K-lines for the trade window
            const noOpenTime = trade.exchange === 'Bybit';
            const padding = noOpenTime ? 30 * 86400 * 1000 : 12 * 3600 * 1000;
            const startMs = (noOpenTime ? trade.close_ms : trade.open_ms) - padding;
            const endMs = trade.close_ms + (noOpenTime ? 12 * 3600 * 1000 : padding);
            const data = await API.fetchKlines(startMs, endMs, '5m', trade.symbol || App.currentSymbol, trade.exchange || '');
            this._klines = data.klines;
            if (!this._klines.length) return;

            // Find entry/exit candle indices
            const entrySec = Math.floor(trade.open_ms / 1000);
            const exitSec = Math.floor(trade.close_ms / 1000);
            this._entryIdx = this._klines.findIndex(k => k.time >= entrySec);
            this._exitIdx = this._klines.findIndex(k => k.time >= exitSec);
            if (this._entryIdx < 0) this._entryIdx = this._klines.length - 1;
            if (this._exitIdx < 0) this._exitIdx = this._klines.length - 1;

            // Start from 20 candles before entry (or 0)
            this._idx = Math.max(0, this._entryIdx - 20);

            // Pre-calculate full price range to fix Y-axis
            let priceMin = Infinity, priceMax = -Infinity;
            for (const k of this._klines) {
                if (k.low < priceMin) priceMin = k.low;
                if (k.high > priceMax) priceMax = k.high;
            }
            const pricePad = (priceMax - priceMin) * 0.05;
            this._priceMin = priceMin - pricePad;
            this._priceMax = priceMax + pricePad;

            // Set initial data (context before entry)
            const initData = this._klines.slice(0, this._idx + 1);
            KlineChart.setData(initData);
            KlineChart.clearMarkers();
            KlineChart.clearPriceLines();

            // Pin price scale with invisible anchor lines
            this._anchorLow = KlineChart.candleSeries.createPriceLine({
                price: this._priceMin, color: 'transparent', lineWidth: 1,
                lineStyle: 0, axisVisible: false, title: '',
            });
            this._anchorHigh = KlineChart.candleSeries.createPriceLine({
                price: this._priceMax, color: 'transparent', lineWidth: 1,
                lineStyle: 0, axisVisible: false, title: '',
            });

            KlineChart.fitContent();

            // Show replay bar
            document.getElementById('replayBar').style.display = 'flex';
            this._markers = [];
            this._updateUI();
            this.setSpeed(1);
        },

        toggle() {
            if (this._playing) this.pause();
            else this.play();
        },

        play() {
            if (this._idx >= this._klines.length - 1) {
                // Restart if at end
                this._idx = Math.max(0, this._entryIdx - 20);
                const initData = this._klines.slice(0, this._idx + 1);
                KlineChart.setData(initData);
                this._markers = [];
                KlineChart.clearMarkers();
            }
            this._playing = true;
            document.getElementById('replayPlayBtn').textContent = 'Pause';
            this._tick();
        },

        pause() {
            this._playing = false;
            document.getElementById('replayPlayBtn').textContent = 'Play';
            if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        },

        stop() {
            this.pause();
            document.getElementById('replayBar').style.display = 'none';
            // Remove anchor lines
            if (this._anchorLow) { KlineChart.candleSeries.removePriceLine(this._anchorLow); this._anchorLow = null; }
            if (this._anchorHigh) { KlineChart.candleSeries.removePriceLine(this._anchorHigh); this._anchorHigh = null; }
            this._klines = [];
            this._trade = null;
        },

        setSpeed(s) {
            this._speed = s;
            document.querySelectorAll('.replay-speed').forEach(b => {
                b.classList.toggle('active', Number(b.dataset.speed) === s);
            });
        },

        _tick() {
            if (!this._playing || this._idx >= this._klines.length - 1) {
                if (this._idx >= this._klines.length - 1) this.pause();
                return;
            }

            this._idx++;
            const candle = this._klines[this._idx];

            // Update chart with new candle
            KlineChart.candleSeries.update(candle);
            KlineChart.volumeSeries.update({
                time: candle.time,
                value: candle.volume,
                color: candle.close >= candle.open ? '#00e67630' : '#ff525230',
            });

            // Scroll to keep latest candle visible (don't force zoom level)
            KlineChart.instance.timeScale().scrollToPosition(-5, false);

            // Add markers at entry/exit
            const markers = [];
            const t = this._trade;
            const isLong = t.direction === 'long';
            const color = isLong ? '#00e676' : '#ff5252';

            if (this._idx === this._entryIdx) {
                markers.push({
                    time: candle.time,
                    position: isLong ? 'belowBar' : 'aboveBar',
                    color: color,
                    shape: isLong ? 'arrowUp' : 'arrowDown',
                    text: `ENTRY ${fmtPrice(t.open_price)}`,
                });
            }
            if (this._idx === this._exitIdx) {
                markers.push({
                    time: candle.time,
                    position: isLong ? 'aboveBar' : 'belowBar',
                    color: color,
                    shape: isLong ? 'arrowDown' : 'arrowUp',
                    text: `EXIT ${fmtPrice(t.close_price)}  ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}`,
                });
            }
            if (markers.length) {
                this._markers.push(...markers);
                KlineChart.candleSeries.setMarkers([...this._markers].sort((a, b) => a.time - b.time));
            }

            this._updateUI();

            // Schedule next tick
            const delay = this._baseInterval / this._speed;
            this._timer = setTimeout(() => this._tick(), delay);
        },

        _updateUI() {
            const total = this._klines.length;
            const current = this._idx;
            document.getElementById('replayCounter').textContent = `${current}/${total}`;
            document.getElementById('replayProgress').style.width = `${(current / total * 100).toFixed(1)}%`;
        },
    },

    async startReplay() {
        const t = Trades.allTrades[Trades.activeTradeId];
        if (!t) return;
        await this.replay.start(t);
    },
};

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
}

// Restore sidebar state on load
document.addEventListener('DOMContentLoaded', () => {
    App.init();
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
        document.getElementById('sidebar').classList.add('collapsed');
    }
});

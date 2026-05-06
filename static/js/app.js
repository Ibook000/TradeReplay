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
        KlineChart.clearMarkers();
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
            el.innerHTML = `<span class="info"><strong>${escapeHtml(this.currentSymbol)}</strong> Overview</span><span class="info">${Trades.allTrades.length} trades</span>`;
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
            <span class="info ${cls}" style="font-weight:600;font-size:12px">${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}</span>
        `;
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());

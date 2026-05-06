// ─── Trades Module ──────────────────────────────────────────────────────────

const Trades = {
    allTrades: [],
    activeTradeId: null,
    charts: {},

    /**
     * Render stats bar (PnL, count, win rate)
     */
    renderStats(trades) {
        const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
        const wins = trades.filter(t => t.pnl > 0).length;
        const winRate = trades.length ? (wins / trades.length * 100) : 0;

        document.getElementById('stats').innerHTML = `
            <div class="stat"><div class="label">PnL</div><div class="value ${totalPnl >= 0 ? 'positive' : 'negative'}">${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}</div></div>
            <div class="stat"><div class="label">Trades</div><div class="value">${trades.length}</div></div>
            <div class="stat"><div class="label">Win Rate</div><div class="value">${winRate.toFixed(0)}%</div></div>
        `;
    },

    /**
     * Destroy existing charts
     */
    destroyCharts() {
        Object.values(this.charts).forEach(chart => {
            if (chart && typeof chart.destroy === 'function') {
                chart.destroy();
            }
        });
        this.charts = {};
    },

    /**
     * Render detailed statistics panel with charts
     */
    renderDetailedStats(trades) {
        this.destroyCharts();
        
        if (!trades.length) {
            document.getElementById('statsContent').innerHTML = '<div class="empty">No trades to analyze</div>';
            return;
        }

        // ─── Basic Stats ───────────────────────────────────────────────
        const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
        const totalFee = trades.reduce((s, t) => s + (t.fee || 0), 0);
        const netPnl = totalPnl - totalFee;
        
        const wins = trades.filter(t => t.pnl > 0);
        const losses = trades.filter(t => t.pnl <= 0);
        const winRate = (wins.length / trades.length * 100);
        
        const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
        const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
        const profitFactor = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;
        
        const bestTrade = trades.reduce((best, t) => t.pnl > best.pnl ? t : best, trades[0]);
        const worstTrade = trades.reduce((worst, t) => t.pnl < worst.pnl ? t : worst, trades[0]);
        
        const avgHoldHours = trades.reduce((s, t) => s + t.hold_hours, 0) / trades.length;
        
        // ─── Long/Short Stats ──────────────────────────────────────────
        const longs = trades.filter(t => t.direction === 'long');
        const shorts = trades.filter(t => t.direction === 'short');
        const longPnl = longs.reduce((s, t) => s + t.pnl, 0);
        const shortPnl = shorts.reduce((s, t) => s + t.pnl, 0);
        const longWins = longs.filter(t => t.pnl > 0).length;
        const shortWins = shorts.filter(t => t.pnl > 0).length;
        const longWinRate = longs.length ? (longWins / longs.length * 100) : 0;
        const shortWinRate = shorts.length ? (shortWins / shorts.length * 100) : 0;
        
        // ─── Exchange Stats ────────────────────────────────────────────
        const exchangeStats = {};
        trades.forEach(t => {
            if (!exchangeStats[t.exchange]) {
                exchangeStats[t.exchange] = { count: 0, pnl: 0, wins: 0 };
            }
            exchangeStats[t.exchange].count++;
            exchangeStats[t.exchange].pnl += t.pnl;
            if (t.pnl > 0) exchangeStats[t.exchange].wins++;
        });
        
        // ─── Drawdown Calculation ──────────────────────────────────────
        let peak = 0;
        let maxDrawdown = 0;
        let cumPnl = 0;
        trades.forEach(t => {
            cumPnl += t.pnl;
            if (cumPnl > peak) peak = cumPnl;
            const dd = peak - cumPnl;
            if (dd > maxDrawdown) maxDrawdown = dd;
        });
        
        // ─── Consecutive Wins/Losses ───────────────────────────────────
        let maxConsecWins = 0;
        let maxConsecLosses = 0;
        let consecWins = 0;
        let consecLosses = 0;
        trades.forEach(t => {
            if (t.pnl > 0) {
                consecWins++;
                consecLosses = 0;
                if (consecWins > maxConsecWins) maxConsecWins = consecWins;
            } else {
                consecLosses++;
                consecWins = 0;
                if (consecLosses > maxConsecLosses) maxConsecLosses = consecLosses;
            }
        });
        
        // ─── Prepare Chart Data ────────────────────────────────────────
        
        // Equity curve data
        let equity = 0;
        const equityData = trades.map((t, i) => {
            equity += t.pnl;
            return { x: i + 1, y: equity };
        });
        
        // Daily PnL
        const dailyPnl = {};
        trades.forEach(t => {
            const date = new Date(t.close_ms).toLocaleDateString('zh-CN', { 
                month: '2-digit', 
                day: '2-digit',
                timeZone: 'Asia/Shanghai'
            });
            dailyPnl[date] = (dailyPnl[date] || 0) + t.pnl;
        });
        const dailyLabels = Object.keys(dailyPnl);
        const dailyValues = Object.values(dailyPnl);
        
        // Win/Loss distribution
        const pnlBuckets = { '<-10': 0, '-10~-5': 0, '-5~-2': 0, '-2~0': 0, '0~2': 0, '2~5': 0, '5~10': 0, '>10': 0 };
        trades.forEach(t => {
            const p = t.pnl;
            if (p < -10) pnlBuckets['<-10']++;
            else if (p < -5) pnlBuckets['-10~-5']++;
            else if (p < -2) pnlBuckets['-5~-2']++;
            else if (p < 0) pnlBuckets['-2~0']++;
            else if (p < 2) pnlBuckets['0~2']++;
            else if (p < 5) pnlBuckets['2~5']++;
            else if (p < 10) pnlBuckets['5~10']++;
            else pnlBuckets['>10']++;
        });
        
        // ─── Render HTML ───────────────────────────────────────────────
        const escape = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value ?? '');
        const html = `
            <!-- Charts Section -->
            <div class="stats-section">
                <div class="stats-section-title">Charts</div>
                
                <!-- Equity Curve -->
                <div class="chart-wrapper">
                    <div class="chart-title">Equity Curve</div>
                    <canvas id="equityChart" height="150"></canvas>
                </div>
                
                <!-- Daily PnL -->
                <div class="chart-wrapper">
                    <div class="chart-title">Daily PnL</div>
                    <canvas id="dailyPnlChart" height="120"></canvas>
                </div>
                
                <!-- Win/Loss Distribution -->
                <div class="chart-wrapper">
                    <div class="chart-title">PnL Distribution</div>
                    <canvas id="pnlDistChart" height="120"></canvas>
                </div>
                
                <!-- Long vs Short -->
                <div class="chart-wrapper">
                    <div class="chart-title">Long vs Short PnL</div>
                    <canvas id="longShortChart" height="100"></canvas>
                </div>
            </div>
            
            <!-- Overview -->
            <div class="stats-section">
                <div class="stats-section-title">Overview</div>
                <div class="stats-grid">
                    <div class="stats-item">
                        <div class="label">Total PnL</div>
                        <div class="value ${totalPnl >= 0 ? 'positive' : 'negative'}">${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} USDT</div>
                    </div>
                    <div class="stats-item">
                        <div class="label">Net PnL (after fees)</div>
                        <div class="value ${netPnl >= 0 ? 'positive' : 'negative'}">${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)} USDT</div>
                    </div>
                    <div class="stats-item">
                        <div class="label">Total Fees</div>
                        <div class="value neutral">${totalFee.toFixed(2)} USDT</div>
                    </div>
                    <div class="stats-item">
                        <div class="label">Total Trades</div>
                        <div class="value neutral">${trades.length}</div>
                    </div>
                </div>
            </div>
            
            <!-- Win/Loss -->
            <div class="stats-section">
                <div class="stats-section-title">Win / Loss</div>
                <div class="stats-grid">
                    <div class="stats-item">
                        <div class="label">Win Rate</div>
                        <div class="value ${winRate >= 50 ? 'positive' : 'negative'}">${winRate.toFixed(1)}%</div>
                        <div class="progress-bar">
                            <div class="fill ${winRate >= 50 ? 'green' : 'red'}" style="width: ${winRate}%"></div>
                        </div>
                    </div>
                    <div class="stats-item">
                        <div class="label">Profit Factor</div>
                        <div class="value ${profitFactor >= 1 ? 'positive' : 'negative'}">${profitFactor.toFixed(2)}</div>
                    </div>
                    <div class="stats-item">
                        <div class="label">Avg Win</div>
                        <div class="value positive">+${avgWin.toFixed(2)}</div>
                    </div>
                    <div class="stats-item">
                        <div class="label">Avg Loss</div>
                        <div class="value negative">${avgLoss.toFixed(2)}</div>
                    </div>
                    <div class="stats-item">
                        <div class="label">Best Trade</div>
                        <div class="value positive">+${bestTrade.pnl.toFixed(2)}</div>
                    </div>
                    <div class="stats-item">
                        <div class="label">Worst Trade</div>
                        <div class="value negative">${worstTrade.pnl.toFixed(2)}</div>
                    </div>
                    <div class="stats-item">
                        <div class="label">Max Consec Wins</div>
                        <div class="value neutral">${maxConsecWins}</div>
                    </div>
                    <div class="stats-item">
                        <div class="label">Max Consec Losses</div>
                        <div class="value neutral">${maxConsecLosses}</div>
                    </div>
                    <div class="stats-item full-width">
                        <div class="label">Max Drawdown</div>
                        <div class="value negative">-${maxDrawdown.toFixed(2)} USDT</div>
                    </div>
                </div>
            </div>
            
            <!-- Long vs Short -->
            <div class="stats-section">
                <div class="stats-section-title">Long vs Short</div>
                <div class="stats-grid">
                    <div class="stats-item">
                        <div class="label">Long Trades</div>
                        <div class="value neutral">${longs.length}</div>
                    </div>
                    <div class="stats-item">
                        <div class="label">Short Trades</div>
                        <div class="value neutral">${shorts.length}</div>
                    </div>
                    <div class="stats-item">
                        <div class="label">Long PnL</div>
                        <div class="value ${longPnl >= 0 ? 'positive' : 'negative'}">${longPnl >= 0 ? '+' : ''}${longPnl.toFixed(2)}</div>
                    </div>
                    <div class="stats-item">
                        <div class="label">Short PnL</div>
                        <div class="value ${shortPnl >= 0 ? 'positive' : 'negative'}">${shortPnl >= 0 ? '+' : ''}${shortPnl.toFixed(2)}</div>
                    </div>
                    <div class="stats-item">
                        <div class="label">Long Win Rate</div>
                        <div class="value ${longWinRate >= 50 ? 'positive' : 'negative'}">${longWinRate.toFixed(1)}%</div>
                    </div>
                    <div class="stats-item">
                        <div class="label">Short Win Rate</div>
                        <div class="value ${shortWinRate >= 50 ? 'positive' : 'negative'}">${shortWinRate.toFixed(1)}%</div>
                    </div>
                </div>
            </div>
            
            <!-- Exchange Breakdown -->
            <div class="stats-section">
                <div class="stats-section-title">By Exchange</div>
                <div class="stats-grid">
                    ${Object.entries(exchangeStats).map(([ex, s]) => `
                        <div class="stats-item">
                            <div class="label">${escape(ex)} Trades</div>
                            <div class="value neutral">${s.count}</div>
                        </div>
                        <div class="stats-item">
                            <div class="label">${escape(ex)} PnL</div>
                            <div class="value ${s.pnl >= 0 ? 'positive' : 'negative'}">${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <!-- Time Analysis -->
            <div class="stats-section">
                <div class="stats-section-title">Time Analysis</div>
                <div class="stats-grid">
                    <div class="stats-item full-width">
                        <div class="label">Avg Hold Time</div>
                        <div class="value neutral">${avgHoldHours.toFixed(1)} hours</div>
                    </div>
                </div>
                <table class="stats-table" style="margin-top: 10px;">
                    <tr><td>Best Trade</td><td class="positive">+${bestTrade.pnl.toFixed(2)} (${escape(bestTrade.exchange)} ${escape(bestTrade.direction)})</td></tr>
                    <tr><td>Worst Trade</td><td class="negative">${worstTrade.pnl.toFixed(2)} (${escape(worstTrade.exchange)} ${escape(worstTrade.direction)})</td></tr>
                </table>
            </div>
        `;
        
        document.getElementById('statsContent').innerHTML = html;
        
        // ─── Render Charts ─────────────────────────────────────────────
        setTimeout(() => this.renderCharts(trades, equityData, dailyLabels, dailyValues, pnlBuckets, longPnl, shortPnl), 100);
    },

    /**
     * Render all charts
     */
    renderCharts(trades, equityData, dailyLabels, dailyValues, pnlBuckets, longPnl, shortPnl) {
        const chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
            },
            scales: {
                x: {
                    grid: { color: '#1a1a25' },
                    ticks: { color: '#8888a0', font: { size: 10 } }
                },
                y: {
                    grid: { color: '#1a1a25' },
                    ticks: { color: '#8888a0', font: { size: 10 } }
                }
            }
        };

        // Equity Curve
        const equityCtx = document.getElementById('equityChart');
        if (equityCtx) {
            this.charts.equity = new Chart(equityCtx, {
                type: 'line',
                data: {
                    labels: equityData.map(d => d.x),
                    datasets: [{
                        data: equityData.map(d => d.y),
                        borderColor: equityData[equityData.length - 1].y >= 0 ? '#00e676' : '#ff5252',
                        backgroundColor: equityData[equityData.length - 1].y >= 0 ? 'rgba(0, 230, 118, 0.1)' : 'rgba(255, 82, 82, 0.1)',
                        fill: true,
                        tension: 0.4,
                        borderWidth: 2,
                        pointRadius: 0,
                    }]
                },
                options: {
                    ...chartOptions,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => `PnL: ${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y.toFixed(2)} USDT`
                            }
                        }
                    }
                }
            });
        }

        // Daily PnL
        const dailyCtx = document.getElementById('dailyPnlChart');
        if (dailyCtx) {
            this.charts.daily = new Chart(dailyCtx, {
                type: 'bar',
                data: {
                    labels: dailyLabels,
                    datasets: [{
                        data: dailyValues,
                        backgroundColor: dailyValues.map(v => v >= 0 ? 'rgba(0, 230, 118, 0.7)' : 'rgba(255, 82, 82, 0.7)'),
                        borderColor: dailyValues.map(v => v >= 0 ? '#00e676' : '#ff5252'),
                        borderWidth: 1,
                    }]
                },
                options: {
                    ...chartOptions,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => `${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y.toFixed(2)} USDT`
                            }
                        }
                    }
                }
            });
        }

        // PnL Distribution
        const distCtx = document.getElementById('pnlDistChart');
        if (distCtx) {
            const distLabels = Object.keys(pnlBuckets);
            const distValues = Object.values(pnlBuckets);
            this.charts.dist = new Chart(distCtx, {
                type: 'bar',
                data: {
                    labels: distLabels,
                    datasets: [{
                        data: distValues,
                        backgroundColor: distLabels.map(l => {
                            if (l.includes('-') || l.includes('<')) return 'rgba(255, 82, 82, 0.7)';
                            return 'rgba(0, 230, 118, 0.7)';
                        }),
                        borderColor: distLabels.map(l => {
                            if (l.includes('-') || l.includes('<')) return '#ff5252';
                            return '#00e676';
                        }),
                        borderWidth: 1,
                    }]
                },
                options: {
                    ...chartOptions,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => `${ctx.parsed.y} trades`
                            }
                        }
                    }
                }
            });
        }

        // Long vs Short
        const lsCtx = document.getElementById('longShortChart');
        if (lsCtx) {
            this.charts.longShort = new Chart(lsCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Long PnL', 'Short PnL'],
                    datasets: [{
                        data: [Math.abs(longPnl), Math.abs(shortPnl)],
                        backgroundColor: ['rgba(0, 230, 118, 0.7)', 'rgba(255, 82, 82, 0.7)'],
                        borderColor: ['#00e676', '#ff5252'],
                        borderWidth: 2,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: { color: '#8888a0', font: { size: 11 } }
                        },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => {
                                    const val = ctx.label === 'Long PnL' ? longPnl : shortPnl;
                                    return `${ctx.label}: ${val >= 0 ? '+' : ''}${val.toFixed(2)} USDT`;
                                }
                            }
                        }
                    }
                }
            });
        }
    },

    /**
     * Render trade card list
     */
    renderList(trades) {
        const list = document.getElementById('tradeList');
        if (!trades.length) {
            list.innerHTML = '<div class="empty"><div class="icon">--</div>No trades</div>';
            return;
        }

        const escape = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value ?? '');
        list.innerHTML = trades.map((t, i) => {
            const isLong = t.direction === 'long';
            const pnlClass = t.pnl >= 0 ? 'positive' : 'negative';
            const exClass = t.exchange === 'OKX' ? 'okx' : 'bybit';
            const exchange = escape(t.exchange);
            const leverage = escape(t.leverage);

            return `<div class="trade-card" data-idx="${i}" onclick="App.selectTrade(${i})">
                <div class="top">
                    <span class="exchange ${exClass}">${exchange}</span>
                    <span class="dir ${isLong ? 'long' : 'short'}">${isLong ? 'LONG' : 'SHORT'}</span>
                    <span class="pnl ${pnlClass}">${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)} USDT</span>
                </div>
                <div class="details">
                    <span>Entry <span class="val">${fmtPrice(t.open_price)}</span></span>
                    <span>Exit <span class="val">${fmtPrice(t.close_price)}</span></span>
                    <span>Lev <span class="val">${leverage}x</span></span>
                    <span>Hold <span class="val">${t.hold_hours.toFixed(1)}h</span></span>
                    <span>Open <span class="val">${formatTime(t.open_ms)}</span></span>
                    <span>Close <span class="val">${formatTime(t.close_ms)}</span></span>
                </div>
            </div>`;
        }).reverse().join('');
    },

    /**
     * Highlight a trade card and scroll into view
     */
    highlightCard(idx) {
        document.querySelectorAll('.trade-card').forEach(c => c.classList.remove('active'));
        const card = document.querySelector(`.trade-card[data-idx="${idx}"]`);
        if (card) {
            card.classList.add('active');
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    },
};

// ─── Chart Module (K-line) ──────────────────────────────────────────────────

const KlineChart = {
    instance: null,
    candleSeries: null,
    volumeSeries: null,
    activePriceLines: [],
    containerEl: null,

    init(containerEl) {
        this.containerEl = containerEl;
        this.instance = LightweightCharts.createChart(containerEl, {
            layout: {
                background: { type: 'solid', color: '#0a0a0f' },
                textColor: '#8888a0',
                fontSize: 11,
            },
            grid: {
                vertLines: { color: '#1a1a25' },
                horzLines: { color: '#1a1a25' },
            },
            crosshair: { mode: 0 },
            rightPriceScale: {
                borderColor: '#232333',
                priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
            },
            timeScale: {
                borderColor: '#232333',
                timeVisible: true,
                secondsVisible: false,
            },
            localization: {
                timeFormatter: (time) => formatTime(time * 1000),
            },
        });

        this.candleSeries = this.instance.addCandlestickSeries({
            upColor: '#00e676',
            downColor: '#ff5252',
            borderUpColor: '#00e676',
            borderDownColor: '#ff5252',
            wickUpColor: '#00e67680',
            wickDownColor: '#ff525280',
            priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
        });

        this.volumeSeries = this.instance.addHistogramSeries({
            color: '#448aff40',
            priceFormat: { type: 'volume' },
            priceScaleId: '',
        });
        this.volumeSeries.priceScale().applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 },
        });

        new ResizeObserver(() => this.resize()).observe(containerEl);
        window.addEventListener('resize', () => this.resize());
        window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 100));
        setTimeout(() => this.resize(), 100);
        setTimeout(() => this.resize(), 500);
    },

    resize() {
        if (!this.containerEl || !this.instance) return;
        const w = this.containerEl.clientWidth;
        const h = this.containerEl.clientHeight;
        if (w > 0 && h > 0) {
            this.instance.applyOptions({ width: w, height: h });
        }
    },

    setData(klines) {
        this.candleSeries.setData(klines);
        this.volumeSeries.setData(klines.map(k => ({
            time: k.time,
            value: k.volume,
            color: k.close >= k.open ? '#00e67630' : '#ff525230',
        })));
        setTimeout(() => this.resize(), 50);
    },

    setMarkers(markers) {
        markers.sort((a, b) => a.time - b.time);
        // Force clear first to prevent any residual markers
        this.candleSeries.setMarkers([]);
        this.candleSeries.setMarkers(markers);
    },

    clearMarkers() {
        this.candleSeries.setMarkers([]);
    },

    clearPriceLines() {
        for (const pl of this.activePriceLines) {
            this.candleSeries.removePriceLine(pl);
        }
        this.activePriceLines = [];
    },

    addPriceLine(options) {
        const pl = this.candleSeries.createPriceLine(options);
        this.activePriceLines.push(pl);
        return pl;
    },

    fitContent() {
        this.instance.timeScale().fitContent();
        setTimeout(() => this.resize(), 50);
    },

    setVisibleRange(from, to) {
        this.instance.timeScale().setVisibleRange({ from, to });
        setTimeout(() => this.resize(), 50);
    },

    _nearestCandleTime(targetSec, klines) {
        if (!klines || klines.length === 0) return targetSec;
        // Binary search for nearest candle time
        let lo = 0, hi = klines.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (klines[mid].time < targetSec) lo = mid + 1;
            else hi = mid;
        }
        // lo is the first candle >= targetSec; compare with lo-1
        if (lo > 0) {
            const diffLo = Math.abs(klines[lo].time - targetSec);
            const diffPrev = Math.abs(klines[lo - 1].time - targetSec);
            return diffPrev < diffLo ? klines[lo - 1].time : klines[lo].time;
        }
        return klines[lo].time;
    },

    buildOverviewMarkers(trades, klines) {
        const markers = [];
        const usedTimes = new Set();  // Track used times to avoid stacking

        for (const t of trades) {
            const closeSec = Math.floor(t.close_ms / 1000);
            const isLong = t.direction === 'long';

            // Find exit candle by time (close_ms is accurate for all exchanges)
            let exitTime = this._nearestCandleTime(closeSec, klines);

            // Find entry candle by PRICE (backward from close time)
            let anchorIdx = klines.length - 1;
            for (let i = 0; i < klines.length; i++) {
                if (klines[i].time >= closeSec) { anchorIdx = i; break; }
            }
            const entryByPrice = this._findCandleByPrice(t.open_price, klines, anchorIdx);
            let entryTime = entryByPrice || this._nearestCandleTime(Math.floor(t.open_ms / 1000), klines);

            // Dedup: avoid stacking on same time as other markers
            if (usedTimes.has(entryTime)) {
                const idx = klines.findIndex(k => k.time === entryTime);
                if (idx > 0) entryTime = klines[idx - 1].time;
            }
            if (usedTimes.has(exitTime)) {
                const idx = klines.findIndex(k => k.time === exitTime);
                if (idx >= 0 && idx < klines.length - 1) exitTime = klines[idx + 1].time;
            }
            if (entryTime === exitTime && klines.length > 1) {
                const idx = klines.findIndex(k => k.time === exitTime);
                if (idx >= 0 && idx < klines.length - 1) exitTime = klines[idx + 1].time;
            }

            usedTimes.add(entryTime);
            usedTimes.add(exitTime);

            // 入场：多单下方↑，空单上方↓
            markers.push({
                time: entryTime,
                position: isLong ? 'belowBar' : 'aboveBar',
                color: isLong ? '#00e676' : '#ff5252',
                shape: isLong ? 'arrowUp' : 'arrowDown',
                text: `${isLong ? 'L' : 'S'} ${t.leverage}x`,
            });
            // 出场：多单上方↓，空单下方↑
            markers.push({
                time: exitTime,
                position: isLong ? 'aboveBar' : 'belowBar',
                color: t.pnl >= 0 ? '#00e676' : '#ff5252',
                shape: t.pnl >= 0 ? 'arrowUp' : 'arrowDown',
                text: `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(0)}`,
            });
        }
        return markers;
    },

    /**
     * Find candle by price — search backward from anchor for candle containing targetPrice.
     * Two-pass: exact match first, then relaxed tolerance. Returns candle.time or null.
     */
    _findCandleByPrice(targetPrice, klines, anchorIdx) {
        if (!klines || klines.length === 0) return null;
        const start = Math.min(anchorIdx, klines.length - 1);
        // Pass 1: exact range match
        for (let i = start; i >= 0; i--) {
            const k = klines[i];
            if (k.low <= targetPrice && targetPrice <= k.high) {
                return k.time;
            }
        }
        // Pass 2: relaxed tolerance (0.1% of price)
        const tol = Math.max(targetPrice * 0.001, 0.01);
        for (let i = start; i >= 0; i--) {
            const k = klines[i];
            if (k.low - tol <= targetPrice && targetPrice <= k.high + tol) {
                return k.time;
            }
        }
        return null;
    },

    buildTradeMarkers(trade, klines) {
        const isLong = trade.direction === 'long';
        const color = isLong ? '#00e676' : '#ff5252';
        const closeSec = Math.floor(trade.close_ms / 1000);

        // Find exit candle (by time — close_ms is accurate)
        let exitTime = this._nearestCandleTime(closeSec, klines);

        // Find anchor index for backward search
        let anchorIdx = klines.length - 1;
        for (let i = 0; i < klines.length; i++) {
            if (klines[i].time >= closeSec) { anchorIdx = i; break; }
        }

        // Find entry candle by PRICE (backward from close time)
        const entryByPrice = this._findCandleByPrice(trade.open_price, klines, anchorIdx);
        let entryTime = entryByPrice || this._nearestCandleTime(Math.floor(trade.open_ms / 1000), klines);

        // Dedup: if entry and exit land on same candle, shift exit to next candle
        if (entryTime === exitTime && klines.length > 1) {
            const idx = klines.findIndex(k => k.time === exitTime);
            if (idx >= 0 && idx < klines.length - 1) {
                exitTime = klines[idx + 1].time;
            } else if (idx > 0) {
                entryTime = klines[idx - 1].time;
            }
        }

        return [
            {
                time: entryTime,
                position: isLong ? 'belowBar' : 'aboveBar',
                color: color,
                shape: isLong ? 'arrowUp' : 'arrowDown',
                text: `${isLong ? 'LONG' : 'SHORT'} ${trade.leverage}x @ ${fmtPrice(trade.open_price)}`,
            },
            {
                time: exitTime,
                position: isLong ? 'aboveBar' : 'belowBar',
                color: color,
                shape: isLong ? 'arrowDown' : 'arrowUp',
                text: `${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)} @ ${fmtPrice(trade.close_price)}`,
            },
        ];
    },
};

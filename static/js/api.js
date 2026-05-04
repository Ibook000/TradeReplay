// ─── API Functions ──────────────────────────────────────────────────────────

const API = {
    /**
     * Fetch available symbols with trade counts
     * @param {number} days
     * @returns {Promise<{symbols: Array}>}
     */
    async fetchSymbols(days = 90) {
        const resp = await fetch(`/api/symbols?days=${days}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
    },

    /**
     * Fetch closed trades, optionally filtered by symbol
     * @param {number} days
     * @param {string} symbol - e.g. 'BTC', 'ETH', '' for all
     * @returns {Promise<{trades: Array, count: number}>}
     */
    async fetchTrades(days, symbol = '') {
        let url = `/api/trades?days=${days}`;
        if (symbol) url += `&symbol=${symbol}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
    },

    /**
     * Fetch K-lines for a specific time range
     * @param {number} startMs
     * @param {number} endMs
     * @param {string} interval
     * @param {string} symbol - e.g. 'BTC'
     * @returns {Promise<{klines: Array, interval: string, count: number}>}
     */
    async fetchKlines(startMs, endMs, interval = 'auto', symbol = 'BTC', exchange = '') {
        let url = `/api/klines?start_ms=${startMs}&end_ms=${endMs}&interval=${interval}&symbol=${symbol}`;
        if (exchange) url += `&exchange=${exchange}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
    },

    /**
     * Fetch K-lines for overview chart
     * @param {number} days
     * @param {string} interval
     * @param {string} symbol
     * @returns {Promise<{klines: Array, interval: string, count: number}>}
     */
    async fetchKlinesRange(days, interval = '1h', symbol = 'BTC') {
        const resp = await fetch(`/api/klines_range?days=${days}&interval=${interval}&symbol=${symbol}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
    },
};

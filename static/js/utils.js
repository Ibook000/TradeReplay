// ─── Utility Functions ──────────────────────────────────────────────────────

/**
 * Format price with adaptive decimal places
 */
function fmtPrice(p) {
    if (p >= 1000) return p.toFixed(1);
    if (p >= 1) return p.toFixed(2);
    return p.toFixed(4);
}

/**
 * Format timestamp to Beijing time string
 */
function formatTime(ms) {
    return new Date(ms).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Shanghai',
    });
}

/**
 * Snap timestamp to candle boundary
 */
function snapToCandle(ms, intervalSec) {
    return Math.floor(ms / 1000 / intervalSec) * intervalSec;
}

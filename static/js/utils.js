// ─── Utility Functions ──────────────────────────────────────────────────────

/**
 * Format price with adaptive decimal places
 */
function fmtPrice(p) {
    if (p >= 1000) return p.toFixed(2);
    if (p >= 100) return p.toFixed(3);
    if (p >= 1) return p.toFixed(4);
    if (p >= 0.1) return p.toFixed(5);
    return p.toFixed(6);
}

/**
 * Format timestamp to UTC time string
 */
function formatTime(ms) {
    return new Date(ms).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
    });
}

/**
 * Snap timestamp to candle boundary
 */
function snapToCandle(ms, intervalSec) {
    return Math.floor(ms / 1000 / intervalSec) * intervalSec;
}

-- TradeReplay Database Schema
-- Run this script to create the trades table

CREATE TABLE IF NOT EXISTS trades (
    id VARCHAR(64) PRIMARY KEY,
    exchange VARCHAR(16) NOT NULL,
    symbol VARCHAR(16) NOT NULL,
    direction VARCHAR(8) NOT NULL,
    open_ms BIGINT NOT NULL,
    close_ms BIGINT NOT NULL,
    open_price NUMERIC(20,8) NOT NULL,
    close_price NUMERIC(20,8) NOT NULL,
    quantity NUMERIC(20,8),
    leverage NUMERIC(10,2),
    pnl NUMERIC(20,8),
    hold_hours NUMERIC(10,2),
    raw_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_exchange ON trades(exchange);
CREATE INDEX IF NOT EXISTS idx_trades_close_ms ON trades(close_ms);
CREATE INDEX IF NOT EXISTS idx_trades_direction ON trades(direction);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_trades_updated_at ON trades;
CREATE TRIGGER update_trades_updated_at
    BEFORE UPDATE ON trades
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- AI Analysis cache table (weekly schedule)
CREATE TABLE IF NOT EXISTS ai_analyses (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(16) NOT NULL DEFAULT 'ALL',
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    trade_count INT NOT NULL,
    total_pnl NUMERIC(20,8),
    win_rate NUMERIC(5,2),
    analysis TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_week ON ai_analyses(symbol, week_start);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_unique_week ON ai_analyses(symbol, week_start);

-- Single-trade AI review cache table
CREATE TABLE IF NOT EXISTS trade_reviews (
    trade_id VARCHAR(64) PRIMARY KEY REFERENCES trades(id),
    exchange VARCHAR(16) NOT NULL,
    symbol VARCHAR(16) NOT NULL,
    direction VARCHAR(8) NOT NULL,
    pnl NUMERIC(20,8),
    review TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trade_reviews_symbol ON trade_reviews(symbol);

-- Position monitor history (15-minute auto analysis)
CREATE TABLE IF NOT EXISTS position_analyses (
    id SERIAL PRIMARY KEY,
    exchange VARCHAR(16) NOT NULL,
    symbol VARCHAR(16) NOT NULL,
    direction VARCHAR(8) NOT NULL,
    entry_price NUMERIC(20,8),
    mark_price NUMERIC(20,8),
    unrealized_pnl NUMERIC(20,8),
    leverage NUMERIC(10,2),
    margin NUMERIC(20,8),
    liquidation_price NUMERIC(20,8),
    size NUMERIC(20,8),
    score INT,
    summary TEXT,
    risks TEXT,
    predicted_side VARCHAR(8),
    predicted_confidence INT,
    prediction_reason TEXT,
    analysis JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pos_analysis_symbol ON position_analyses(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_analysis_time ON position_analyses(created_at DESC);

-- Per-symbol position monitor settings
CREATE TABLE IF NOT EXISTS position_monitor_settings (
    symbol VARCHAR(16) PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    paused BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_monitor_settings_updated_at ON position_monitor_settings;
CREATE TRIGGER update_monitor_settings_updated_at
    BEFORE UPDATE ON position_monitor_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

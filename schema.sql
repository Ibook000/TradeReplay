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

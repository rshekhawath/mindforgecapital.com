"""
shared/config.py
================
Single source of truth for all strategy parameters, factor weights,
and backtest constants. Import from here instead of hardcoding values
in individual strategy scripts.

Usage
-----
    from shared.config import LARGEMIDCAP, SMALLMICRO, MULTIASSET, RISK_FREE
"""

# ─────────────────────────────────────────────────────────────────────────────
# COMMON
# ─────────────────────────────────────────────────────────────────────────────
RISK_FREE = 0.065   # annual risk-free rate (65bps = approx India 91-day T-bill)

# ─────────────────────────────────────────────────────────────────────────────
# BENCHMARKS — static, fixed-CAGR public index references
# ─────────────────────────────────────────────────────────────────────────────
# Each strategy is compared against a fixed-CAGR benchmark index. The CAGR
# values are sourced from public 5Y historical data (NSE / Screener / NSE
# Indices factsheets) and are NOT recomputed from market data at runtime.
# The backtest engine constructs a smooth exponential equity curve at this
# CAGR over the backtest period — this is the single source of truth for the
# benchmark in all charts, summary stats, and the website.
#
# Update these constants here (centrally) to refresh the benchmark across the
# entire stack — no changes needed in individual backtest scripts.
#   `cagr`     : annualised 5Y return (decimal)
#   `vol`      : annualised standard deviation of monthly returns (decimal)
#   `max_dd`   : worst peak-to-trough drawdown over the 5Y window (decimal, negative)
#   `best_month`: best calendar-month return over the period (decimal)
#   The vol / max_dd / best_month figures below are sourced from NSE Indices
#   factsheets and public 5Y reference data (Screener / Investing.com / NSE).
BENCHMARKS = {
    "multiasset": {
        "name":       "Nifty 50 Index",
        "short":      "Nifty 50",
        "cagr":       0.1013,   # 10.13%
        "vol":        0.1400,   # ~14% annualised
        "max_dd":    -0.1500,   # ~-15% (2024-25 correction)
        "best_month": 0.0830,   # ~+8.3% (Nov 2023 cycle)
    },
    "largemidcap": {
        "name":       "Nifty LargeMidcap 250 Index",
        "short":      "LargeMidcap 250",
        "cagr":       0.1537,   # 15.37%
        "vol":        0.1650,   # ~16.5% annualised
        "max_dd":    -0.1800,   # ~-18%
        "best_month": 0.1010,   # ~+10.1%
    },
    "smallmicro": {
        "name":       "Nifty Smallcap 250 + Microcap 250",
        "short":      "Smallcap 250 + Microcap 250",
        "cagr":       0.1914,   # 19.14%
        "vol":        0.2200,   # ~22% annualised
        "max_dd":    -0.2500,   # ~-25% (2025 smallcap correction)
        "best_month": 0.1240,   # ~+12.4%
    },
}

# ─────────────────────────────────────────────────────────────────────────────
# LARGEMIDCAP 250
# ─────────────────────────────────────────────────────────────────────────────
LARGEMIDCAP = {
    # Portfolio construction
    "TOP_N": 25,
    "MAX_PER_SECTOR": 3,
    "UNIVERSE_SHEET": "Master Universe",

    # Factor weights (must sum to 1.0)
    # Empirically optimised for large & midcap Indian equities
    "W_MOMENTUM": 0.45,   # (12-1m return + 6m return) / 2
    "W_TREND":    0.45,   # SMA200 ratio + annualised linreg slope (63-day)
    "W_LOWVOL":   0.05,   # −252-day realised volatility
    "W_HIGH52":   0.03,   # price / 52-week high
    "W_AMIHUD":   0.02,   # −Amihud illiquidity (60-day avg |ret|/₹turnover)

    # Backtest
    "BACKTEST_YEARS":   5,
    "TRANSACTION_COST": 0.001,  # 10bps per trade (one-way)
}

# ─────────────────────────────────────────────────────────────────────────────
# SMALLMICRO 500
# ─────────────────────────────────────────────────────────────────────────────
SMALLMICRO = {
    # Portfolio construction
    "TOP_N": 50,
    "MAX_PER_SECTOR": 3,
    "UNIVERSE_SHEET": "Master Universe",

    # Factor weights (must sum to 1.0)
    # Tuned for small/microcap: thin liquidity, harder momentum crashes,
    # stronger anchoring dynamics, relative-vol regime filter
    "W_MOMENTUM": 0.30,   # (12-1m return + 6m return) / 2
    "W_TREND":    0.25,   # SMA200 ratio + annualised linreg slope (63-day)
    "W_VOLUME":   0.20,   # 20-day avg vol / 60-day avg vol (volume breakout)
    "W_HIGH52":   0.15,   # price / 52-week high
    "W_RELVOL":   0.10,   # −(21-day vol / 252-day vol)

    # Backtest
    "BACKTEST_YEARS":   5,
    "TRANSACTION_COST": 0.002,  # 20bps per trade (one-way, wider spread)
}

# ─────────────────────────────────────────────────────────────────────────────
# MULTIASSET
# ─────────────────────────────────────────────────────────────────────────────
MULTIASSET = {
    # ETF universe
    "ASSETS": {
        "Nifty 50 ETF":         "NIFTYBEES.NS",
        "Nifty Next 50 ETF":    "JUNIORBEES.NS",
        "Nifty Midcap 150 ETF": "MID150BEES.NS",
        "Gold ETF":             "GOLDBEES.NS",
        "Bharat Bond ETF":      "EBBETF0431.NS",
        "NASDAQ ETF":           "MON100.NS",
    },

    # Momentum lookback windows (in weeks)
    "WEEKS_3M":  13,
    "WEEKS_6M":  26,
    "WEEKS_12M": 52,

    # Trend / volatility adjustments
    "MA_WEEKS":      40,
    "VOL_PENALTY":   0.5,
    "VOL_ADJ_FLOOR": 0.2,
    "TREND_PENALTY": 0.5,

    # Backtest
    "INITIAL_AUM": 1_000_000,
}

# ─────────────────────────────────────────────────────────────────────────────
# RUNNER (mindforge_runner.py)
# ─────────────────────────────────────────────────────────────────────────────
RUNNER = {
    # Override these in mindforge_runner.py via environment variable
    # MINDFORGE_APPS_SCRIPT_URL  (set in .env or export before running)
    "LARGEMIDCAP_TOP_N":        25,
    "LARGEMIDCAP_MAX_SECTOR":    3,
    "SMALLMICRO_TOP_N":         50,
    "SMALLMICRO_MAX_SECTOR":     3,
}

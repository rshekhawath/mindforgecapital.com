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

"""
shared/backtest_engine.py
=========================
MindForge Capital — shared quantitative backtest utilities.

Functions used across the LargeMidcap and SmallMicro backtests.
MultiAsset uses a different (weekly) data structure and is self-contained.

Usage
-----
    from shared.backtest_engine import (
        safe_zscore,
        extract_field,
        build_rebalancing_dates,
        period_return,
        compute_performance_stats,
    )
"""

import numpy as np
import pandas as pd
from scipy.stats import zscore
from dateutil.relativedelta import relativedelta

from shared.config import RISK_FREE


# ─────────────────────────────────────────────────────────────────────────────
# FACTOR HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def safe_zscore(series: pd.Series) -> pd.Series:
    """
    Robust z-score with winsorisation and NaN handling.

    Steps:
      1. Coerce to numeric; replace ±inf → NaN
      2. Winsorise at median ± 3σ  (tames outliers common in small/microcap)
      3. Fill remaining NaN with median
      4. Z-score the cleaned series

    Returns a Series of the same index with dtype float64.
    All-NaN or zero-std inputs return a zero Series.
    """
    s = pd.to_numeric(series, errors="coerce").replace([np.inf, -np.inf], np.nan)
    if s.isna().all():
        return pd.Series(0.0, index=s.index)
    med = s.median()
    std = s.std()
    if std == 0 or pd.isna(std):
        return pd.Series(0.0, index=s.index)
    s = s.clip(med - 3 * std, med + 3 * std).fillna(med)
    return pd.Series(zscore(s.values, nan_policy="omit"), index=s.index)


# ─────────────────────────────────────────────────────────────────────────────
# DATA HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def extract_field(raw_df: pd.DataFrame, field: str) -> pd.DataFrame:
    """
    Pull a single price field (e.g. 'Close', 'Volume') from a yfinance
    multi-ticker download result that may have a MultiIndex column layout.
    """
    if isinstance(raw_df.columns, pd.MultiIndex):
        lvl0 = raw_df.columns.get_level_values(0).unique().tolist()
        if field in lvl0:
            return raw_df.xs(field, level=0, axis=1)
    # Single-ticker download or already flat
    return raw_df if field == "Close" else pd.DataFrame(index=raw_df.index)


def build_rebalancing_dates(prices: pd.DataFrame,
                            start_date,
                            lookback_months: int = 13) -> list:
    """
    Build a list of month-end business-day rebalancing dates from a price
    DataFrame, leaving *lookback_months* of warm-up history before the
    first rebalancing date.

    Parameters
    ----------
    prices          : DataFrame with DatetimeIndex (daily frequency)
    start_date      : datetime — the date price history begins
    lookback_months : int — warm-up period before first rebalance

    Returns
    -------
    list of Timestamps
    """
    idx            = prices.index
    backtest_start = idx[idx >= (start_date + relativedelta(months=lookback_months))][0]
    monthly        = pd.date_range(start=backtest_start, end=idx[-1], freq="BME")
    rebal_dates    = [idx[idx <= d][-1]
                      for d in monthly if len(idx[idx <= d]) > 0]
    return sorted(set(rebal_dates))


# ─────────────────────────────────────────────────────────────────────────────
# RETURN HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def period_return(prices: pd.DataFrame,
                  ticker_list: list,
                  start,
                  end) -> float:
    """
    Equal-weight average return of *ticker_list* between *start* and *end*.
    Returns 0.0 if price data is insufficient.
    """
    cols = [t for t in ticker_list if t in prices.columns]
    sub  = prices.loc[start:end, cols]
    if sub.empty or len(sub) < 2:
        return 0.0
    p0   = sub.iloc[0]
    p1   = sub.iloc[-1]
    mask = p0.notna() & p1.notna() & (p0 != 0)
    if mask.sum() == 0:
        return 0.0
    return float(((p1[mask] / p0[mask]) - 1).mean())


# ─────────────────────────────────────────────────────────────────────────────
# PERFORMANCE METRICS
# ─────────────────────────────────────────────────────────────────────────────

def sharpe(monthly_returns, rf: float = RISK_FREE) -> float:
    """Annualised Sharpe ratio from a series of monthly returns (fractions)."""
    rf_m = (1 + rf) ** (1 / 12) - 1
    exc  = pd.Series(monthly_returns) - rf_m
    return float((exc.mean() / exc.std()) * np.sqrt(12)) if exc.std() > 0 else 0.0


def cagr(equity: pd.Series, n_months: int) -> float:
    """CAGR from an equity curve indexed to 100 over *n_months* months."""
    return float((equity.iloc[-1] / equity.iloc[0]) ** (12 / n_months) - 1)


def max_dd(equity: pd.Series) -> float:
    """Maximum drawdown (negative fraction) of an equity curve."""
    return float(((equity - equity.cummax()) / equity.cummax()).min())


def compute_performance_stats(port_rets: pd.Series,
                               bench_rets: pd.Series,
                               port_equity: pd.Series,
                               bench_equity: pd.Series,
                               rf: float = RISK_FREE) -> dict:
    """
    Compute a full set of performance statistics for reporting.

    Parameters — all return series are monthly fractions (e.g. 0.05 = 5 %).
    Equity series are indexed to 100 at inception.

    Returns a dict with keys used by the chart summary scorecard.
    """
    n            = len(port_rets)
    p_cagr       = cagr(port_equity, n)
    b_cagr       = cagr(bench_equity, n)
    p_sharpe     = sharpe(port_rets, rf)
    b_sharpe     = sharpe(bench_rets, rf)
    p_dd         = max_dd(port_equity)
    b_dd         = max_dd(bench_equity)
    alpha        = p_cagr - b_cagr
    beat_pct     = float((port_rets > bench_rets).mean())
    p_total      = port_equity.iloc[-1] / 100 - 1
    b_total      = bench_equity.iloc[-1] / 100 - 1
    port_pct     = port_rets * 100
    bench_pct    = bench_rets * 100
    excess_pct   = port_pct - bench_pct
    var_95       = float(np.percentile(port_pct, 5))
    cvar_95      = float(port_pct[port_pct <= var_95].mean())
    p_vol        = float(port_pct.std() * np.sqrt(12) / 100)
    b_vol        = float(bench_pct.std() * np.sqrt(12) / 100)
    p_win        = float((port_rets > 0).mean())
    b_win        = float((bench_rets > 0).mean())
    calmar_p     = p_cagr / abs(p_dd) if p_dd != 0 else float("nan")
    calmar_b     = b_cagr / abs(b_dd) if b_dd != 0 else float("nan")

    return {
        "p_cagr": p_cagr,   "b_cagr": b_cagr,
        "p_sharpe": p_sharpe, "b_sharpe": b_sharpe,
        "p_dd": p_dd,       "b_dd": b_dd,
        "alpha": alpha,     "beat_pct": beat_pct,
        "p_total": p_total, "b_total": b_total,
        "p_vol": p_vol,     "b_vol": b_vol,
        "p_win": p_win,     "b_win": b_win,
        "calmar_p": calmar_p, "calmar_b": calmar_b,
        "var_95": var_95,   "cvar_95": cvar_95,
        "port_pct": port_pct, "bench_pct": bench_pct,
        "excess_pct": excess_pct,
    }

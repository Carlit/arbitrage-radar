from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import json
import math
import os
import random
from typing import Any

import numpy as np
import polars as pl
from supabase import Client, create_client


@dataclass(frozen=True)
class Venue:
    name: str
    fee_bps: float
    spread_bps: float
    liquidity_score: float
    latency_ms: int
    bias_bps: float


VENUES = [
    Venue("alpha_ex", fee_bps=7.0, spread_bps=3.0, liquidity_score=0.95, latency_ms=18, bias_bps=0.0),
    Venue("beta_flow", fee_bps=9.0, spread_bps=5.0, liquidity_score=0.75, latency_ms=32, bias_bps=2.0),
    Venue("gamma_book", fee_bps=6.0, spread_bps=4.0, liquidity_score=0.82, latency_ms=24, bias_bps=-1.0),
    Venue("delta_swap", fee_bps=11.0, spread_bps=7.0, liquidity_score=0.60, latency_ms=45, bias_bps=4.0),
]

ASSETS = {
    "ETH-USD": 3200.0,
    "SOL-USD": 145.0,
    "ARB-USD": 1.15,
}

SEED = 42

ASSET_METADATA = {
    "ETH-USD": {
        "base_currency": "ETH",
        "quote_currency": "USD",
        "canonical_name": "Ethereum / US Dollar",
        "asset_class": "spot",
    },
    "SOL-USD": {
        "base_currency": "SOL",
        "quote_currency": "USD",
        "canonical_name": "Solana / US Dollar",
        "asset_class": "spot",
    },
    "ARB-USD": {
        "base_currency": "ARB",
        "quote_currency": "USD",
        "canonical_name": "Arbitrum / US Dollar",
        "asset_class": "spot",
    },
}


def get_supabase_admin_client() -> Client:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not supabase_key:
        raise RuntimeError(
            "Les variables SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requises pour écrire dans Supabase."
        )

    return create_client(supabase_url, supabase_key)


def chunked(items: list[dict[str, Any]], size: int = 250) -> list[list[dict[str, Any]]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def seed_reference_data(supabase: Client) -> dict[str, dict]:
    """Insère le référentiel simulé dans Supabase et retourne les IDs utiles."""
    asset_rows = [
        {
            "symbol": symbol,
            "base_currency": metadata["base_currency"],
            "quote_currency": metadata["quote_currency"],
            "canonical_name": metadata["canonical_name"],
            "asset_class": metadata["asset_class"],
            "is_active": True,
        }
        for symbol, metadata in ASSET_METADATA.items()
    ]

    venue_rows = [
        {
            "code": venue.name,
            "name": venue.name.replace("_", " ").title(),
            "venue_type": "exchange",
            "country_code": "ZZ",
            "is_active": True,
        }
        for venue in VENUES
    ]

    supabase.table("assets").upsert(asset_rows, on_conflict="symbol").execute()
    supabase.table("venues").upsert(venue_rows, on_conflict="code").execute()

    assets = supabase.table("assets").select("id,symbol").in_("symbol", list(ASSET_METADATA.keys())).execute().data
    venues = supabase.table("venues").select("id,code").in_("code", [venue.name for venue in VENUES]).execute().data

    asset_by_symbol = {row["symbol"]: row["id"] for row in assets}
    venue_by_code = {row["code"]: row["id"] for row in venues}
    venue_config = {venue.name: venue for venue in VENUES}

    listing_rows = []
    for symbol in ASSET_METADATA.keys():
        for venue_name, venue in venue_config.items():
            listing_rows.append(
                {
                    "asset_id": asset_by_symbol[symbol],
                    "venue_id": venue_by_code[venue_name],
                    "external_symbol": symbol,
                    "fee_bps": venue.fee_bps,
                    "maker_fee_bps": max(venue.fee_bps - 2.0, 0.0),
                    "taker_fee_bps": venue.fee_bps,
                    "is_active": True,
                }
            )

    supabase.table("asset_listings").upsert(listing_rows, on_conflict="asset_id,venue_id").execute()

    listings = (
        supabase.table("asset_listings")
        .select("id,asset_id,venue_id,external_symbol")
        .in_("asset_id", list(asset_by_symbol.values()))
        .execute()
        .data
    )

    listing_by_asset_and_venue: dict[tuple[str, str], str] = {}
    reverse_asset = {value: key for key, value in asset_by_symbol.items()}
    reverse_venue = {value: key for key, value in venue_by_code.items()}
    for listing in listings:
        symbol = reverse_asset[listing["asset_id"]]
        venue_name = reverse_venue[listing["venue_id"]]
        listing_by_asset_and_venue[(symbol, venue_name)] = listing["id"]

    return {
        "asset_by_symbol": asset_by_symbol,
        "venue_by_code": venue_by_code,
        "listing_by_asset_and_venue": listing_by_asset_and_venue,
    }


def generate_market_history(minutes: int = 360) -> pl.DataFrame:
    """Simule un historique multi-venues avec anomalies injectées."""
    rng = np.random.default_rng(SEED)
    random.seed(SEED)
    start = datetime.utcnow().replace(second=0, microsecond=0) - timedelta(minutes=minutes)
    timestamps = [start + timedelta(minutes=i) for i in range(minutes)]

    records: list[dict] = []

    # Anomalies forcées pour créer des opportunités d'arbitrage crédibles.
    anomaly_windows = [
        {"asset": "ETH-USD", "minute_range": range(150, 165), "venue": "beta_flow", "shift_bps": 48},
        {"asset": "SOL-USD", "minute_range": range(220, 240), "venue": "gamma_book", "shift_bps": -62},
        {"asset": "ARB-USD", "minute_range": range(280, 295), "venue": "delta_swap", "shift_bps": 74},
    ]

    for asset, base_price in ASSETS.items():
        latent_price = base_price
        drift = rng.normal(0.00005, 0.00018, size=minutes)
        shock = rng.normal(0.0, 0.0025, size=minutes)

        for i, ts in enumerate(timestamps):
            latent_price *= 1 + drift[i] + shock[i]
            latent_price = max(latent_price, base_price * 0.25)

            for venue in VENUES:
                anomaly_shift_bps = 0.0
                for window in anomaly_windows:
                    if (
                        window["asset"] == asset
                        and venue.name == window["venue"]
                        and i in window["minute_range"]
                    ):
                        anomaly_shift_bps = float(window["shift_bps"])
                        break

                micro_noise_bps = rng.normal(0, 7.5)
                venue_price = latent_price * (
                    1 + (venue.bias_bps + micro_noise_bps + anomaly_shift_bps) / 10_000
                )
                volume = max(
                    1.0,
                    base_price
                    * venue.liquidity_score
                    * rng.lognormal(mean=-6.5, sigma=0.55),
                )
                notional_usd = volume * venue_price
                slippage_bps = max(
                    1.0,
                    (18.0 / venue.liquidity_score)
                    + (math.log10(notional_usd + 10) * 0.8)
                    + rng.normal(0, 0.7),
                )

                records.append(
                    {
                        "timestamp": ts,
                        "asset": asset,
                        "venue": venue.name,
                        "price": float(venue_price),
                        "volume": float(volume),
                        "notional_usd": float(notional_usd),
                        "fee_bps": venue.fee_bps,
                        "spread_bps": venue.spread_bps,
                        "liquidity_score": venue.liquidity_score,
                        "latency_ms": venue.latency_ms,
                        "slippage_bps": float(slippage_bps),
                    }
                )

    return pl.DataFrame(records)


def build_fair_value(quotes: pl.DataFrame) -> pl.DataFrame:
    """Construit une cote dynamique robuste par actif et timestamp."""
    weighted = quotes.with_columns(
        (
            pl.col("liquidity_score")
            * (1 / (1 + pl.col("latency_ms") / 40))
            * (1 / (1 + pl.col("spread_bps") / 8))
            * (1 / (1 + pl.col("slippage_bps") / 20))
        ).alias("quality_weight")
    )

    fair = (
        weighted.group_by(["timestamp", "asset"])
        .agg(
            [
                ((pl.col("price") * pl.col("quality_weight")).sum() / pl.col("quality_weight").sum()).alias(
                    "fair_price"
                ),
                pl.col("price").median().alias("median_price"),
                pl.col("price").std().fill_null(0.0).alias("cross_venue_vol"),
                pl.col("quality_weight").sum().alias("quality_weight_sum"),
            ]
        )
        .with_columns(
            [
                ((pl.col("fair_price") - pl.col("median_price")) / pl.col("median_price") * 10000).alias(
                    "fair_vs_median_bps"
                ),
                (pl.col("cross_venue_vol") / pl.col("fair_price")).fill_nan(0.0).fill_null(0.0).alias(
                    "cross_venue_vol_pct"
                ),
            ]
        )
    )
    return fair


def detect_arbitrage(quotes: pl.DataFrame, fair: pl.DataFrame) -> pl.DataFrame:
    """Détecte les opportunités nettes après frais, spread et slippage."""
    enriched = quotes.join(fair, on=["timestamp", "asset"], how="left").with_columns(
        [
            ((pl.col("price") - pl.col("fair_price")) / pl.col("fair_price") * 10000).alias("mispricing_bps"),
            (
                pl.col("price")
                * (1 + (pl.col("fee_bps") + pl.col("spread_bps") / 2 + pl.col("slippage_bps")) / 10000)
            ).alias("effective_buy_price"),
            (
                pl.col("price")
                * (1 - (pl.col("fee_bps") + pl.col("spread_bps") / 2 + pl.col("slippage_bps")) / 10000)
            ).alias("effective_sell_price"),
        ]
    )

    buys = enriched.select(
        [
            "timestamp",
            "asset",
            "fair_price",
            "cross_venue_vol_pct",
            pl.col("venue").alias("buy_venue"),
            pl.col("price").alias("buy_raw_price"),
            pl.col("effective_buy_price").alias("buy_net_price"),
            pl.col("mispricing_bps").alias("buy_mispricing_bps"),
            pl.col("liquidity_score").alias("buy_liquidity"),
            pl.col("fee_bps").alias("buy_fee_bps"),
        ]
    )
    sells = enriched.select(
        [
            "timestamp",
            "asset",
            pl.col("venue").alias("sell_venue"),
            pl.col("price").alias("sell_raw_price"),
            pl.col("effective_sell_price").alias("sell_net_price"),
            pl.col("mispricing_bps").alias("sell_mispricing_bps"),
            pl.col("liquidity_score").alias("sell_liquidity"),
            pl.col("fee_bps").alias("sell_fee_bps"),
        ]
    )

    pairs = (
        buys.join(sells, on=["timestamp", "asset"], how="inner")
        .filter(pl.col("buy_venue") != pl.col("sell_venue"))
        .with_columns(
            [
                (pl.col("sell_net_price") - pl.col("buy_net_price")).alias("gross_edge_usd"),
                ((pl.col("sell_net_price") / pl.col("buy_net_price")) - 1).alias("edge_pct"),
                (
                    (
                        (-pl.col("buy_mispricing_bps")).clip(lower_bound=0)
                        + pl.col("sell_mispricing_bps").clip(lower_bound=0)
                    )
                ).alias("directional_signal_bps"),
                pl.min_horizontal("buy_liquidity", "sell_liquidity").alias("executable_liquidity"),
            ]
        )
    )

    stats = pairs.group_by("asset").agg(
        [
            pl.col("edge_pct").mean().alias("asset_edge_mean"),
            pl.col("edge_pct").std().fill_null(0.0).alias("asset_edge_std"),
            pl.col("gross_edge_usd").quantile(0.9).alias("asset_p90_edge_usd"),
        ]
    )

    scored = (
        pairs.join(stats, on="asset", how="left")
        .with_columns(
            [
                (
                    (pl.col("edge_pct") - pl.col("asset_edge_mean"))
                    / (pl.col("asset_edge_std") + 1e-9)
                ).alias("edge_zscore"),
                (
                    pl.col("edge_pct") * 10000
                    * pl.col("executable_liquidity")
                    * (1 - pl.col("cross_venue_vol_pct").clip(upper_bound=0.03) * 12)
                ).alias("expected_value_score"),
            ]
        )
        .filter(
            (pl.col("gross_edge_usd") > 0)
            & (pl.col("edge_pct") > 0.0012)
            & (pl.col("directional_signal_bps") > 18)
            & (pl.col("edge_zscore") > 1.25)
        )
        .with_columns(
            [
                (pl.col("edge_pct") * 100).alias("edge_pct_display"),
                (pl.col("cross_venue_vol_pct") * 100).alias("cross_venue_vol_display"),
                (
                    0.45 * pl.col("edge_zscore")
                    + 0.30 * (pl.col("directional_signal_bps") / 25)
                    + 0.25 * (pl.col("executable_liquidity") / pl.col("executable_liquidity").max())
                ).alias("confidence_score"),
            ]
        )
        .sort(["confidence_score", "gross_edge_usd"], descending=True)
    )

    return scored


def choose_subscription_tier(edge_pct: float, confidence_score: float) -> str:
    if edge_pct >= 0.0022 or confidence_score >= 4.1:
        return "elite"
    return "pro"


def build_market_alert_rows(opportunities: pl.DataFrame, seed_maps: dict[str, dict]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    for opportunity in opportunities.to_dicts():
        asset_symbol = opportunity["asset"]
        buy_venue = opportunity["buy_venue"]
        sell_venue = opportunity["sell_venue"]

        asset_id = seed_maps["asset_by_symbol"][asset_symbol]
        buy_listing_id = seed_maps["listing_by_asset_and_venue"][(asset_symbol, buy_venue)]
        sell_listing_id = seed_maps["listing_by_asset_and_venue"][(asset_symbol, sell_venue)]

        gross_edge_bps = ((opportunity["sell_raw_price"] / opportunity["buy_raw_price"]) - 1) * 10_000
        net_edge_bps = opportunity["edge_pct"] * 10_000
        min_subscription_tier = choose_subscription_tier(
            edge_pct=float(opportunity["edge_pct"]),
            confidence_score=float(opportunity["confidence_score"]),
        )

        payload = {
            "buy_venue": buy_venue,
            "sell_venue": sell_venue,
            "buy_net_price": opportunity["buy_net_price"],
            "sell_net_price": opportunity["sell_net_price"],
            "gross_edge_usd": opportunity["gross_edge_usd"],
            "expected_value_score": opportunity["expected_value_score"],
            "directional_signal_bps": opportunity["directional_signal_bps"],
            "edge_zscore": opportunity["edge_zscore"],
            "cross_venue_vol_pct": opportunity["cross_venue_vol_pct"],
        }

        rows.append(
            {
                "asset_id": asset_id,
                "buy_listing_id": buy_listing_id,
                "sell_listing_id": sell_listing_id,
                "min_subscription_tier": min_subscription_tier,
                "status": "open",
                "headline": f"{asset_symbol} arbitrage {buy_venue} -> {sell_venue}",
                "anomaly_kind": "cross_venue_arbitrage",
                "fair_price": float(opportunity["fair_price"]),
                "buy_price": float(opportunity["buy_raw_price"]),
                "sell_price": float(opportunity["sell_raw_price"]),
                "gross_edge_bps": float(gross_edge_bps),
                "net_edge_bps": float(net_edge_bps),
                "net_edge_pct": float(opportunity["edge_pct"]),
                "confidence_score": float(min(opportunity["confidence_score"] * 20, 100.0)),
                "liquidity_score": float(min(opportunity["executable_liquidity"], 100.0)),
                "payload": payload,
                "observed_at": opportunity["timestamp"].isoformat(),
                "expires_at": (opportunity["timestamp"] + timedelta(minutes=15)).isoformat(),
            }
        )

    return rows


def persist_market_alerts(supabase: Client, alert_rows: list[dict[str, Any]]) -> int:
    if not alert_rows:
        return 0

    default_tenant_id = os.environ.get("DEFAULT_TENANT_ID")
    if not default_tenant_id:
        print("⚠️ DEFAULT_TENANT_ID non défini. Les alertes seront insérées globalement mais inaccessibles par RLS.")

    inserted = 0
    for batch in chunked(alert_rows, size=200):
        # Insert market alerts and get the generated records back (to have their IDs)
        response = supabase.table("market_alerts").insert(batch).execute()
        inserted_alerts = response.data
        inserted += len(inserted_alerts)

        # Create access rows for the default tenant if configured
        if default_tenant_id and inserted_alerts:
            access_rows = [
                {
                    "tenant_id": default_tenant_id,
                    "alert_id": alert["id"],
                    "entitled_via_tier": alert["min_subscription_tier"],
                }
                for alert in inserted_alerts
            ]
            supabase.table("tenant_alert_access").insert(access_rows).execute()

    return inserted


def summarize(quotes: pl.DataFrame, fair: pl.DataFrame, opportunities: pl.DataFrame) -> None:
    print("\n=== Radar d'arbitrage POC ===")
    print(f"Ticks simulés      : {quotes.height:,}")
    print(f"Cotes dynamiques   : {fair.height:,}")
    print(f"Anomalies retenues : {opportunities.height:,}")

    if opportunities.is_empty():
        print("\nAucune opportunité nette détectée. Relancez avec un autre seed ou augmentez les fenêtres d'anomalie.")
        return

    top = opportunities.select(
        [
            "timestamp",
            "asset",
            "buy_venue",
            "sell_venue",
            pl.col("buy_raw_price").round(4),
            pl.col("sell_raw_price").round(4),
            pl.col("fair_price").round(4),
            pl.col("gross_edge_usd").round(4),
            pl.col("edge_pct_display").round(3),
            pl.col("directional_signal_bps").round(2),
            pl.col("edge_zscore").round(2),
            pl.col("confidence_score").round(2),
        ]
    ).head(20)

    print("\nTop 20 opportunités")
    print(top)

    by_asset = (
        opportunities.group_by("asset")
        .agg(
            [
                pl.len().alias("signals"),
                pl.col("gross_edge_usd").mean().round(4).alias("avg_edge_usd"),
                pl.col("gross_edge_usd").max().round(4).alias("best_edge_usd"),
                pl.col("edge_pct_display").max().round(3).alias("best_edge_pct"),
            ]
        )
        .sort("best_edge_usd", descending=True)
    )

    print("\nRésumé par actif")
    print(by_asset)


def main() -> None:
    supabase = get_supabase_admin_client()
    seed_maps = seed_reference_data(supabase)
    quotes = generate_market_history(minutes=360)
    fair = build_fair_value(quotes)
    opportunities = detect_arbitrage(quotes, fair)
    alert_rows = build_market_alert_rows(opportunities, seed_maps)
    inserted_alerts = persist_market_alerts(supabase, alert_rows)
    summarize(quotes, fair, opportunities)
    print(f"\nActifs seedés       : {len(seed_maps['asset_by_symbol'])}")
    print(f"Venues seedées      : {len(seed_maps['venue_by_code'])}")
    print(f"Alertes insérées    : {inserted_alerts}")
    if inserted_alerts:
        print("\nExemple payload alerte")
        print(json.dumps(alert_rows[0], indent=2, default=str))


if __name__ == "__main__":
    main()

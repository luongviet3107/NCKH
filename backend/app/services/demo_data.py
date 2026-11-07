"""Deterministic, clearly-labelled demo retail dataset for AutoDS.

The generated file is only used as demo data and is always presented as such in the
UI. It intentionally includes seasonality, product trends, churn and inventory edge
cases so that every analysis module can be exercised end-to-end.
"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

DEMO_FILENAME = "autods_demo_sales.csv"


PRODUCTS = [
    ("SKU-1001", "Pulse Wireless Earbuds", "Audio", 79.0, 0.42, 3.4, 2.4),
    ("SKU-1002", "Nimbus Smart Speaker", "Audio", 129.0, 0.44, 2.3, 1.5),
    ("SKU-1003", "Vertex 4K Monitor", "Electronics", 379.0, 0.60, 1.4, 1.15),
    ("SKU-1004", "Aurora Mechanical Keyboard", "Accessories", 109.0, 0.41, 2.5, 1.9),
    ("SKU-1005", "Flux USB-C Hub", "Accessories", 59.0, 0.36, 2.2, 1.45),
    ("SKU-1006", "Orbit Gaming Mouse", "Accessories", 69.0, 0.35, 2.0, 0.65),
    ("SKU-1007", "Lumen LED Desk Lamp", "Home", 49.0, 0.31, 2.1, 0.30),
    ("SKU-1008", "Aero Laptop Stand", "Home", 39.0, 0.30, 2.4, -0.55),
    ("SKU-1009", "Halo Ring Light", "Home", 89.0, 0.36, 1.5, 0.45),
    ("SKU-1010", "Terra Insulated Bottle", "Lifestyle", 29.0, 0.27, 1.8, -0.25),
    ("SKU-1011", "Trail Running Shoes", "Sports", 119.0, 0.43, 1.6, 0.95),
    ("SKU-1012", "Pulse Fitness Band", "Sports", 99.0, 0.41, 2.1, 0.15),
    ("SKU-1013", "Echo Mini Drone", "Electronics", 249.0, 0.58, 1.1, -1.10),
    ("SKU-1014", "Solstice Coffee Grinder", "Home", 119.0, 0.50, 1.3, -0.05),
    ("SKU-1015", "Nova Tablet Sleeve", "Accessories", 34.0, 0.32, 1.8, -0.80),
    ("SKU-1016", "Drift Portable Speaker", "Audio", 89.0, 0.40, 1.9, 0.55),
]

REGIONS = ["North", "Central", "South", "West"]


def build_demo_dataset(path: Path | str, seed: int = 20261106) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    end_date = date.today() - timedelta(days=1)
    start_date = end_date - timedelta(days=539)

    n_customers = 260
    customers: list[dict] = []
    for index in range(n_customers):
        customer_id = f"CUST-{1001 + index}"
        if index < 24:
            first_days_ago = int(rng.integers(20, 70))
        elif index < 48:
            first_days_ago = int(rng.integers(70, 160))
        else:
            first_days_ago = int(rng.integers(180, 535))

        inactive_bucket = rng.random()
        if index % 17 == 0:
            inactive_days = int(rng.integers(190, 390))
            first_days_ago = max(first_days_ago, inactive_days + 30)
        elif inactive_bucket < 0.14:
            inactive_days = int(rng.integers(95, 175))
        elif inactive_bucket < 0.26:
            inactive_days = int(rng.integers(55, 95))
        else:
            inactive_days = int(rng.integers(0, 55))

        loyalty = int(rng.integers(1, 9))
        if index < 18:
            loyalty = int(rng.integers(8, 13))
        customers.append(
            {
                "customer_id": customer_id,
                "first_days_ago": first_days_ago,
                "inactive_days": min(inactive_days, first_days_ago - 1),
                "loyalty": loyalty,
                "region": REGIONS[int(rng.integers(0, len(REGIONS)))],
            }
        )

    product_weights = np.array([product[5] for product in PRODUCTS], dtype=float)
    order_records: list[dict] = []
    total_span = (end_date - start_date).days + 1

    for customer in customers:
        first_date = end_date - timedelta(days=customer["first_days_ago"])
        last_date = end_date - timedelta(days=customer["inactive_days"])
        if first_date > last_date:
            last_date = first_date
        active_span = max(1, (last_date - first_date).days)
        n_orders = int(np.clip(rng.poisson(customer["loyalty"] * 1.6 + 1.2), 1, 42))
        if customer["loyalty"] >= 9:
            n_orders = int(np.clip(n_orders * 1.35, 6, 55))

        for _ in range(n_orders):
            progress = rng.random()
            day_offset = int(progress * active_span)
            order_date = first_date + timedelta(days=day_offset)
            if order_date > end_date:
                continue

            day_fraction = (order_date - start_date).days / total_span
            weekday_factor = 1.12 if order_date.weekday() >= 5 else 1.0
            season_phase = (order_date.timetuple().tm_yday / 365.25) * 2 * np.pi
            seasonal = 0.92 + 0.30 * np.exp(-((season_phase - 5.6) ** 2) / 0.3)
            drift = np.array([product[6] for product in PRODUCTS])
            weights = product_weights * (1 + drift * (day_fraction - 0.5) * 0.8)
            weights = np.clip(weights, 0.05, None)
            if order_date > end_date - timedelta(days=120):
                weights[13] = 0.0
                weights[14] = 0.0
            if weights.sum() <= 0:
                continue

            basket_size = int(rng.choice([1, 1, 1, 2, 2, 3], p=[0.35, 0.2, 0.15, 0.15, 0.1, 0.05]))
            chosen = rng.choice(len(PRODUCTS), size=basket_size, replace=False, p=weights / weights.sum())
            order_records.append(
                {
                    "customer_id": customer["customer_id"],
                    "region": customer["region"],
                    "order_date": order_date,
                    "items": chosen.tolist(),
                    "weekday_factor": weekday_factor,
                    "seasonal": seasonal,
                }
            )

    order_records.sort(key=lambda row: (row["order_date"], row["customer_id"]))
    rows: list[dict] = []
    for order_index, order in enumerate(order_records):
        order_id = f"ORD-{200000 + order_index}"
        for product_index in order["items"]:
            sku, name, category, price, cost_ratio, _, trend = PRODUCTS[product_index]
            price_factor = 1.0 + rng.normal(0, 0.04)
            unit_price = round(max(5.0, price * price_factor), 2)
            price_sensitivity = 1.0 + 0.08 * (unit_price > 100) - 0.05 * (unit_price > 250)
            qty_factor = order["seasonal"] * order["weekday_factor"] * price_sensitivity
            qty = int(np.clip(np.round(rng.poisson(1.25 * qty_factor)), 1, 6))
            discount = float(rng.choice([0.0, 0.0, 0.0, 0.05, 0.10, 0.15, 0.20], p=[0.42, 0.12, 0.08, 0.15, 0.12, 0.07, 0.04]))
            revenue = round(qty * unit_price * (1 - discount), 2)
            unit_cost = round(unit_price * cost_ratio * (1 + rng.normal(0, 0.015)), 2)
            rows.append(
                {
                    "Order ID": order_id,
                    "Customer ID": order["customer_id"],
                    "Product ID": sku,
                    "Product Name": name,
                    "Category": category,
                    "Order Date": order["order_date"].isoformat(),
                    "Quantity": qty,
                    "Unit Price": unit_price,
                    "Discount": discount,
                    "Revenue": revenue,
                    "Unit Cost": unit_cost,
                    "Stock Quantity": 0,
                    "Region": order["region"],
                }
            )

    df = pd.DataFrame(rows)
    df["Order Date"] = pd.to_datetime(df["Order Date"])
    max_date = df["Order Date"].max()
    recent = df[df["Order Date"] > max_date - pd.Timedelta(days=30)].groupby("Product ID")["Quantity"].sum()
    stock_multipliers = {
        "SKU-1001": 0.10,
        "SKU-1002": 1.15,
        "SKU-1003": 0.35,
        "SKU-1004": 2.9,
        "SKU-1005": 1.20,
        "SKU-1006": 1.35,
        "SKU-1007": 2.4,
        "SKU-1008": 3.1,
        "SKU-1009": 1.10,
        "SKU-1010": 3.4,
        "SKU-1011": 0.45,
        "SKU-1012": 1.20,
        "SKU-1013": 3.7,
        "SKU-1014": 0.0,
        "SKU-1015": 0.0,
        "SKU-1016": 1.25,
    }
    stock_values: dict[str, int] = {}
    for sku, _, _, _, _, _, _ in PRODUCTS:
        demand = float(recent.get(sku, 0))
        multiplier = stock_multipliers.get(sku, 1.0)
        if sku in {"SKU-1014", "SKU-1015"}:
            stock_values[sku] = int(rng.integers(140, 280))
        elif demand <= 0:
            stock_values[sku] = int(rng.integers(10, 60))
        else:
            stock_values[sku] = max(0, int(round(demand * multiplier)))
    df["Stock Quantity"] = df["Product ID"].map(stock_values).fillna(0).astype(int)
    df["Order Date"] = df["Order Date"].dt.date
    df = df.sort_values(["Order Date", "Order ID", "Product Name"]).reset_index(drop=True)
    df.to_csv(target, index=False, encoding="utf-8-sig")
    return target

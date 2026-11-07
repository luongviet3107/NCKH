r"""Smoke test for the actual API analytics surface.

Run from the repository root:
    .\.venv\Scripts\python.exe backend/tests/smoke_test.py
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(ROOT / "backend"))

from app.main import app  # noqa: E402


def main() -> None:
    with TestClient(app) as client:
        health = client.get("/api/health")
        health.raise_for_status()
        print("health:", health.json()["data"])

        datasets = client.get("/api/data/datasets").json()["data"]
        assert datasets["items"], "Demo dataset was not seeded"
        dataset_id = datasets["active_dataset_id"]
        print("dataset:", dataset_id)

        overview = client.get("/api/dashboard/overview", params={"dataset_id": dataset_id})
        overview.raise_for_status()
        payload = overview.json()["data"]
        print("overview KPIs:", payload["kpis"])
        assert payload["kpis"]["total_revenue"] > 0

        products = client.post("/api/products/forecast", json={"dataset_id": dataset_id, "limit": 10})
        products.raise_for_status()
        product_payload = products.json()["data"]
        print("forecast products:", product_payload["summary"]["forecasted_products"])
        assert product_payload["products"]

        inventory = client.post("/api/inventory/forecast", json={"dataset_id": dataset_id, "limit": 20})
        inventory.raise_for_status()
        inv_payload = inventory.json()["data"]
        print("inventory:", inv_payload.get("summary"))
        assert inv_payload["available"]

        segments = client.post("/api/customers/segment", json={"dataset_id": dataset_id})
        segments.raise_for_status()
        segment_payload = segments.json()["data"]
        print("segmentation metrics:", segment_payload.get("metrics"))
        assert segment_payload["available"]

        churn = client.post("/api/customers/churn", json={"dataset_id": dataset_id})
        churn.raise_for_status()
        print("churn metrics:", churn.json()["data"].get("metrics"))
        assert churn.json()["data"]["available"]

        revenue = client.post("/api/revenue/analyze", json={"dataset_id": dataset_id})
        revenue.raise_for_status()
        print("revenue:", revenue.json()["data"]["kpis"])

        forecast = client.post("/api/revenue/forecast", json={"dataset_id": dataset_id, "horizon_days": 90})
        forecast.raise_for_status()
        print("revenue forecast:", forecast.json()["data"]["summary"])

        bench = client.post(
            "/api/models/benchmark",
            json={
                "dataset_id": dataset_id,
                "task": "revenue_forecast",
                "human_model": "linear_regression",
            },
        )
        bench.raise_for_status()
        bench_payload = bench.json()["data"]
        print("benchmark:", bench_payload["human"]["metrics"], bench_payload["ai"]["metrics"])
        assert bench_payload["split"]["test_observations"] >= 4

        report = client.post("/api/reports", json={"dataset_id": dataset_id})
        report.raise_for_status()
        report_id = report.json()["data"]["id"]
        pdf = client.post("/api/reports/export", json={"report_id": report_id, "format": "pdf"})
        pdf.raise_for_status()
        assert pdf.headers["content-type"].startswith("application/pdf")
        print("pdf bytes:", len(pdf.content))

        agent = client.post(
            "/api/agents/run",
            json={"dataset_id": dataset_id, "mode": "hitl", "objective": "Validate the human-in-the-loop workflow"},
        )
        agent.raise_for_status()
        agent_payload = agent.json()["data"]
        assert agent_payload["status"] == "awaiting_approval"
        approved = client.post(
            "/api/agents/approve",
            json={
                "run_id": agent_payload["id"],
                "approved": True,
                "selected_tasks": ["revenue"],
                "notes": "Smoke-test approval",
            },
        )
        approved.raise_for_status()
        run_id = agent_payload["id"]
        for _ in range(120):
            run = client.get(f"/api/agents/runs/{run_id}")
            run.raise_for_status()
            status = run.json()["data"]["status"]
            if status in {"completed", "failed", "cancelled", "rejected"}:
                break
            time.sleep(0.5)
        print("agent status:", status)
        assert status == "completed", run.json()["data"].get("error")

    print("SMOKE TEST PASSED")


if __name__ == "__main__":
    main()

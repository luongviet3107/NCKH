from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class DatasetRequest(BaseModel):
    dataset_id: str = Field(min_length=1)


class DataCleanRequest(BaseModel):
    drop_duplicates: bool = True
    drop_missing_dates: bool = True
    drop_invalid_values: bool = True
    fill_missing_category: bool = False


class ProductForecastRequest(DatasetRequest):
    horizon_days: int = Field(default=30, ge=7, le=365)
    limit: int = Field(default=100, ge=1, le=500)
    end_date: date | None = None


class ProductDetailRequest(DatasetRequest):
    product: str = Field(min_length=1)
    horizon_days: int = Field(default=90, ge=7, le=365)


class InventoryRequest(DatasetRequest):
    lead_time_days: int = Field(default=7, ge=1, le=180)
    service_level: float = Field(default=0.95, ge=0.5, le=0.999)
    ordering_cost: float = Field(default=500.0, ge=0)
    holding_rate: float = Field(default=0.20, ge=0.01, le=1.0)
    limit: int = Field(default=150, ge=1, le=500)


class InventoryRecommendationRequest(InventoryRequest):
    priority: str | None = None
    product: str | None = None


class CustomerSegmentRequest(DatasetRequest):
    limit: int = Field(default=100, ge=1, le=500)


class CustomerListRequest(DatasetRequest):
    segment: str | None = None
    search: str | None = None
    limit: int = Field(default=100, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


class CustomerRecommendRequest(DatasetRequest):
    customer_id: str = Field(min_length=1)
    top_n: int = Field(default=5, ge=1, le=20)


class ChurnRequest(DatasetRequest):
    inactive_days: int = Field(default=90, ge=30, le=365)


class RevenueAnalyzeRequest(DatasetRequest):
    start_date: date | None = None
    end_date: date | None = None
    granularity: Literal["day", "week", "month"] = "month"

    @field_validator("end_date")
    @classmethod
    def validate_end(cls, value: date | None) -> date | None:
        return value


class RevenueForecastRequest(DatasetRequest):
    horizon_days: int = Field(default=90, ge=7, le=365)


class AgentRunRequest(DatasetRequest):
    mode: Literal["auto", "hitl"] = "auto"
    objective: str = Field(default='Xác định những quyết định kinh doanh có tác động lớn nhất từ bộ dữ liệu này.', max_length=2000)
    agents: list[str] | None = None


class AgentApprovalRequest(BaseModel):
    run_id: str
    approved: bool = True
    selected_tasks: list[str] | None = None
    notes: str = Field(default="", max_length=4000)


class BenchmarkRequest(DatasetRequest):
    task: Literal["revenue_forecast", "demand_forecast", "churn_classification", "customer_clustering"] = "revenue_forecast"
    human_model: str = "linear_regression"
    test_ratio: float = Field(default=0.2, ge=0.1, le=0.4)


class ReportCreateRequest(DatasetRequest):
    title: str | None = Field(default=None, max_length=200)
    include_forecast: bool = True


class ReportExportRequest(BaseModel):
    report_id: str
    format: Literal["pdf", "xlsx"] = "pdf"

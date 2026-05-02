from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .dummy_operator import dummy_router
from .router import router
from .settlement_keeper import settlement_keeper
from .settings import settings


app = FastAPI(title=settings.gateway_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(dummy_router)


@app.on_event("startup")
async def start_settlement_keeper() -> None:
    settlement_keeper.start()


@app.on_event("shutdown")
async def stop_settlement_keeper() -> None:
    await settlement_keeper.stop()

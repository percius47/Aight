from __future__ import annotations

import asyncio
import contextlib
import logging
import time

from .contract_client import registry_client
from .settings import settings
from .state import gateway_state

logger = logging.getLogger(__name__)


class SettlementKeeper:
    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if not settings.settlement_keeper_enabled:
            return
        if not settings.settlement_keeper_private_key:
            logger.warning("Settlement keeper is enabled but AIGHT_SETTLEMENT_KEEPER_PRIVATE_KEY is not configured.")
            return
        if not registry_client.enabled:
            logger.warning("Settlement keeper is enabled but AIGHT_REGISTRY_ADDRESS is not configured.")
            return
        if self._task is not None:
            return

        self._task = asyncio.create_task(self._run(), name="aight-settlement-keeper")
        logger.info("Settlement keeper started.")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    async def _run(self) -> None:
        interval_seconds = max(10, int(settings.settlement_keeper_interval_seconds))
        while True:
            await self._release_due_escrows()
            await asyncio.sleep(interval_seconds)

    async def _release_due_escrows(self) -> None:
        rentals = gateway_state.list_settlement_rentals()
        for rental in rentals:
            try:
                escrow = await asyncio.to_thread(registry_client.get_escrow, rental.escrow_id)
                now_seconds = int(time.time())
                payment_due = now_seconds >= escrow.last_release_at + 3600
                fully_released = escrow.released_hours >= escrow.duration_hours
                if escrow.slashed or fully_released or not payment_due:
                    continue

                tx_hash = await asyncio.to_thread(
                    registry_client.release_hourly_payment,
                    rental.escrow_id,
                    settings.settlement_keeper_private_key or "",
                )
                logger.info("Released due escrow hour for escrow %s: %s", rental.escrow_id, tx_hash)
            except Exception:
                logger.exception("Settlement keeper failed for escrow %s", rental.escrow_id)


settlement_keeper = SettlementKeeper()

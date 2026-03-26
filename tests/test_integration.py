import pytest
from httpx import ASGITransport, AsyncClient

from src.server import app


@pytest.mark.asyncio
async def test_api_run_integration() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.get("/api/run")

    assert response.status_code == 200

    payload = response.json()
    steps = payload["steps"]
    assert steps, "Expected at least one step in /api/run response"

    assert steps[-1]["game_won"] is True

    inferred_total = sum(len(step["new_facts_from_inference"]) for step in steps)
    assert inferred_total >= 5

    actions = [
        step["action_taken"] for step in steps if step["action_taken"] is not None
    ]
    for previous, current in zip(actions, actions[1:], strict=False):
        assert previous != current

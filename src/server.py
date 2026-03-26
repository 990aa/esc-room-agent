from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse

from src.agent import EscapeRoomAgent, StepResult, fact_to_dict, run_full_game
from src.room_config import build_room


PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = PROJECT_ROOT / "static"

app = FastAPI(title="Escape Room Agent")


@app.get("/")
def get_index() -> FileResponse:
	index_file = STATIC_DIR / "index.html"
	if not index_file.exists():
		raise HTTPException(status_code=404, detail="index.html not found")
	return FileResponse(path=str(index_file))


@app.get("/static/{file_path:path}")
def get_static_file(file_path: str) -> FileResponse:
	root = STATIC_DIR.resolve()
	requested = (STATIC_DIR / file_path).resolve()
	if root not in requested.parents and requested != root:
		raise HTTPException(status_code=404, detail="File not found")
	if not requested.exists() or not requested.is_file():
		raise HTTPException(status_code=404, detail="File not found")
	return FileResponse(path=str(requested))


@app.get("/api/room")
def get_initial_room() -> dict[str, Any]:
	return build_room().to_dict()


@app.get("/api/run")
def run_agent_without_browser() -> JSONResponse:
	results = run_full_game()
	payload = {
		"steps": [_serialize_step_result(result) for result in results],
		"game_won": results[-1].game_won if results else False,
		"step_count": len(results),
	}
	return JSONResponse(content=payload)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
	await websocket.accept()
	agent = EscapeRoomAgent()
	await websocket.send_json(_build_initial_payload(agent))

	try:
		while True:
			message = await websocket.receive_json()
			command = message.get("command")

			if command == "step":
				step_result = agent.step()
				await websocket.send_json(_build_step_payload(agent, step_result))
				continue

			if command == "reset":
				agent = EscapeRoomAgent()
				await websocket.send_json(_build_initial_payload(agent))
				continue

			await websocket.send_json({"error": f"Unknown command: {command}"})
	except WebSocketDisconnect:
		return


def _build_initial_payload(agent: EscapeRoomAgent) -> dict[str, Any]:
	return {
		"room": agent.room.to_dict(),
		"observed_facts": [],
		"inferred_facts": [],
		"action_taken": None,
		"next_planned_action": None,
		"game_won": False,
		"step": 0,
		"this_step": {
			"new_facts_from_perception": [],
			"new_facts_from_inference": [],
		},
	}


def _build_step_payload(agent: EscapeRoomAgent, step_result: StepResult) -> dict[str, Any]:
	return {
		"room": agent.room.to_dict(),
		"observed_facts": [fact_to_dict(fact) for fact in agent.observed_facts],
		"inferred_facts": [
			{"rule_name": rule_name, "fact": fact_to_dict(fact)}
			for rule_name, fact in agent.inferred_facts
		],
		"action_taken": step_result.action_taken,
		"next_planned_action": step_result.next_planned_action,
		"game_won": step_result.game_won,
		"step": step_result.step_number,
		"this_step": {
			"new_facts_from_perception": [fact_to_dict(fact) for fact in step_result.new_facts_from_perception],
			"new_facts_from_inference": [fact_to_dict(fact) for fact in step_result.new_facts_from_inference],
		},
	}


def _serialize_step_result(step_result: StepResult) -> dict[str, Any]:
	result_dict = asdict(step_result)
	result_dict["new_facts_from_perception"] = [
		fact_to_dict(fact) for fact in step_result.new_facts_from_perception
	]
	result_dict["new_facts_from_inference"] = [
		fact_to_dict(fact) for fact in step_result.new_facts_from_inference
	]
	return result_dict

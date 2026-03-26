import json

import httpx
from websockets.sync.client import connect

BASE_URL = "http://127.0.0.1:8000"
WS_URL = "ws://127.0.0.1:8000/ws"


def verify_http_paths() -> None:
    routes = [
        "/",
        "/api/room",
        "/api/run",
        "/static/index.html",
        "/static/styles.css",
        "/static/app.js",
        "/static/missing.file",
        "/not-a-route",
    ]

    with httpx.Client(base_url=BASE_URL, timeout=10.0) as client:
        for route in routes:
            response = client.get(route)
            print("HTTP", route, response.status_code, response.headers.get("content-type", ""))

        html = client.get("/").text
        required_ids = [
            "step-btn",
            "slow-step-btn",
            "autoplay-toggle",
            "highlight-toggle",
            "speed-slider",
            "reset-btn",
            "room-map",
            "observed-facts",
            "inferred-facts",
            "this-step",
        ]
        controls_present = all(f'id="{item_id}"' in html for item_id in required_ids)
        print("HTML controls present:", controls_present)


def verify_websocket_paths() -> None:
    with connect(WS_URL) as ws:
        initial_payload = json.loads(ws.recv())
        print(
            "WS init",
            initial_payload.get("step"),
            len(initial_payload.get("observed_facts", [])),
            len(initial_payload.get("inferred_facts", [])),
        )

        ws.send(json.dumps({"command": "step"}))
        step_payload = json.loads(ws.recv())
        print(
            "WS step",
            step_payload.get("step"),
            bool(step_payload.get("action_taken")),
            len(step_payload.get("this_step", {}).get("new_facts_from_perception", [])),
            len(step_payload.get("this_step", {}).get("new_facts_from_inference", [])),
        )

        ws.send(json.dumps({"command": "unknown"}))
        unknown_payload = json.loads(ws.recv())
        print("WS unknown", unknown_payload.get("error"))

        ws.send(json.dumps({"command": "reset"}))
        reset_payload = json.loads(ws.recv())
        print(
            "WS reset",
            reset_payload.get("step"),
            len(reset_payload.get("observed_facts", [])),
            len(reset_payload.get("inferred_facts", [])),
        )

    with connect(WS_URL) as ws:
        _ = json.loads(ws.recv())
        won = False
        step_count = 0
        previous_action = None
        repeated_action = False
        last_payload = None

        while step_count < 20 and not won:
            ws.send(json.dumps({"command": "step"}))
            last_payload = json.loads(ws.recv())
            current_action = last_payload.get("action_taken")
            if previous_action is not None and current_action == previous_action:
                repeated_action = True
            previous_action = current_action
            step_count += 1
            won = bool(last_payload.get("game_won"))

        print(
            "WS full run",
            "steps=",
            step_count,
            "won=",
            won,
            "repeat_action=",
            repeated_action,
            "observed=",
            len(last_payload.get("observed_facts", [])) if last_payload else 0,
            "inferred=",
            len(last_payload.get("inferred_facts", [])) if last_payload else 0,
        )


if __name__ == "__main__":
    verify_http_paths()
    verify_websocket_paths()

# Escape Room Knowledge-Based Agent

A browser-rendered escape room demo where a knowledge-based AI agent reasons step-by-step to escape.

The key idea is observability:
- The room evolves as actions are executed.
- The knowledge base grows from both perception and inference.
- The UI shows exactly what was observed, what was inferred, and what is planned next.

## Project Structure

```text
src/
	knowledge.py      # Fact triples, KB, rules, forward chaining
	rules.py          # Rule set used by inference engine
	room.py           # RoomObject, Room, ClueDecoder
	room_config.py    # Concrete room layout and initial state
	agent.py          # Perception, Planner, ActionExecutor, EscapeRoomAgent
	server.py         # FastAPI + WebSocket API
tests/
	test_knowledge.py
	test_room.py
	test_agent.py
	test_integration.py
static/
	index.html
	styles.css
	app.ts            # Frontend source (TypeScript file)
	app.js            # Browser-loaded module
scripts/
	run_tests.sh      # Full test pass command
pyproject.toml
tsconfig.json
```

## Architecture Overview

The system has four layers:

1. Knowledge Engine
- Facts are triples: (subject, predicate, object).
- Rules are condition patterns plus a conclusion pattern.
- Inference is forward chaining until no new facts are produced.

2. Room Model
- Room state is plain data (JSON-serializable snapshot each step).
- Clues reveal new facts when examined.

3. Agent Loop
- Perceive room -> update KB.
- Infer derived facts.
- Plan highest-priority action.
- Execute action to mutate room and/or KB.

4. Visualization
- Browser room map and side panel render all agent state.
- WebSocket drives live updates.

## Knowledge and Inference

Implemented in src/knowledge.py and src/rules.py.

Core entities:
- Fact dataclass: subject, predicate, object.
- KnowledgeBase:
	- add_fact
	- has_fact
	- query with wildcard fields
	- all_facts sorted for stable output
- Rule dataclass
- InferenceEngine:
	- variable binding across multi-condition rules
	- run_forward_chaining until fixpoint
	- tracks last inference trace with rule name + inferred fact

Rules implemented:
- clue says code + panel needs code -> panel can be opened
- drawer contains clue + drawer open -> clue available
- key available + lock uses key -> lock can be opened
- exit requires lock + lock open -> exit reachable
- clue available + clue unread -> clue should be examined

## Room Model

Implemented in src/room.py and src/room_config.py.

Room contains:
- drawer_A, drawer_B
- panel_main
- clue_1, clue_2
- lock_A, lock_B, lock_panel
- exit_door

Room exposes:
- get_object
- set_state
- get_all_objects sorted
- to_dict snapshot for server/UI

ClueDecoder reads clue state["reveals"] triples and returns Fact objects.

## Agent Behavior

Implemented in src/agent.py.

Classes:
- Perception
	- observes visible objects and relevant state relations
	- writes observed facts into KB
- Planner
	- priority order:
		1) examine available unread clue
		2) open lock with known key
		3) enter known code into panel
		4) open reachable exit
	- avoids repeating the same action key
- ActionExecutor
	- examine_clue: marks read + decodes clue facts into KB
	- open_lock: opens lock + unlocks/opens target object
	- enter_code: validates and opens panel
	- open_exit: opens exit + asserts game won fact
- EscapeRoomAgent
	- owns room, KB, inference engine, planner, action executor
	- step() returns StepResult with full per-step reasoning data

Helpers:
- run_full_game(max_steps=20)

## Server API

Implemented in src/server.py.

HTTP routes:
- GET /
	- serves static/index.html
- GET /static/{path}
	- serves frontend assets
- GET /api/room
	- returns initial room snapshot
- GET /api/run
	- runs full game and returns step log JSON

WebSocket:
- WS /ws
	- sends initial payload on connect
	- supports commands:
		- {"command": "step"}
		- {"command": "reset"}
	- returns room snapshot, observed facts, inferred facts with rule names,
		action taken, next planned action, and game_won

## Frontend Features

Implemented in static/index.html, static/styles.css, static/app.js, static/app.ts.

Layout:
- Left: room map
- Right: agent mind panel
- Bottom: controls

Room visualization:
- object cards placed by x/y room coordinates
- relation lines (lock->target, clue->revealed subject)
- animations:
	- unlock pulse
	- clue read color shift
	- exit glow

Mind panel:
- observed facts (ordered by arrival)
- inferred facts (rule + fact)
- this-step summary
- narrative history strip

Auto-play:
- toggle + speed slider (300ms to 2000ms)

Win state:
- overlay and confetti

Demo polish features:
- Highlight inference mode
	- when new inferred fact appears, temporary arc(s) are drawn on map
	- rule name is shown above each arc
	- fades after 2 seconds
- Slow Step button
	- one step is staged as:
		- Perceiving...
		- Inferring...
		- Planning...
		- Acting...
	- 600ms delay between phases

UI overlap fix:
- introduced scrollable room-map viewport with fixed room canvas
- responsive card sizing with clamp()
- improved mobile breakpoints to prevent card collisions

## Setup

Python dependencies are managed with uv.

Install:

```bash
uv sync
```

If needed, install dependency set manually:

```bash
uv add fastapi "uvicorn[standard]" websockets pytest pytest-asyncio httpx
```

## Test Commands

Phase-level tests:

```bash
uv run pytest tests/test_knowledge.py -v
uv run pytest tests/test_room.py -v
uv run pytest tests/test_agent.py -v
uv run pytest tests/test_integration.py -v
```

Full pass:

```bash
uv run pytest tests/ -v --tb=short
```

Scripted full pass:

```bash
sh scripts/run_tests.sh
```

Note for PowerShell on Windows:
- If sh is unavailable, run:

```powershell
uv run pytest tests/ -v --tb=short
```

## Run the App

Start server:

```bash
uv run uvicorn src.server:app --port 8000
```

Open:
- http://127.0.0.1:8000/

Optional API checks:

```bash
uv run python -c "import httpx; print(httpx.get('http://127.0.0.1:8000/api/room').status_code)"
uv run python -c "import httpx; print(httpx.get('http://127.0.0.1:8000/api/run').json()['game_won'])"
```

## Teacher Demo Flow

Use this exact sequence:

1. Run all tests and show pass output:

```bash
uv run pytest tests/ -v
```

2. Start server:

```bash
uv run uvicorn src.server:app --port 8000
```

3. Open browser at http://127.0.0.1:8000/
4. Set speed to medium (around 900ms).
5. Toggle Auto-play on.
6. Narrate while it runs:
- Observed facts are direct perception from room state.
- Inferred facts are rule-derived knowledge.
- Inference arcs visualize why a conclusion appeared.
- This step panel shows current action and next plan.
7. At win overlay, call out step count and inference total.
8. Click Reset and replay with Slow Step to teach sub-phases.

## Integration Guarantee

test_integration.py validates the complete API run path:
- GET /api/run works through ASGI transport
- final step is game_won=True
- at least 5 inferred facts across the run
- no consecutive repeated actions


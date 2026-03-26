from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.knowledge import Fact, InferenceEngine, KnowledgeBase
from src.room import ClueDecoder, Room, RoomObject
from src.room_config import build_room
from src.rules import RULES


Action = dict[str, str]


@dataclass
class StepResult:
    step_number: int
    action_taken: Action | None
    new_facts_from_perception: list[Fact]
    new_facts_from_inference: list[Fact]
    next_planned_action: Action | None
    game_won: bool


class Perception:
    def __init__(self, kb: KnowledgeBase) -> None:
        self.kb = kb

    def observe(self, room: Room) -> list[Fact]:
        new_facts: list[Fact] = []

        for obj in room.get_all_objects():
            if not self._is_visible(room, obj):
                continue

            new_facts.extend(self._add_fact(Fact(obj.id, "kind", obj.kind)))
            new_facts.extend(self._observe_state(room, obj))

        return new_facts

    def _is_visible(self, room: Room, obj: RoomObject) -> bool:
        if obj.kind != "clue":
            return True

        if obj.state.get("visible", False):
            return True

        for candidate in room.get_all_objects():
            if candidate.kind != "drawer":
                continue
            if obj.id not in candidate.state.get("contains", []):
                continue
            if candidate.state.get("open", False):
                return True

        return False

    def _observe_state(self, room: Room, obj: RoomObject) -> list[Fact]:
        observed: list[Fact] = []

        if "locked" in obj.state:
            observed.extend(
                self._add_fact(
                    Fact(obj.id, "is", "locked" if obj.state["locked"] else "unlocked")
                )
            )

        if "open" in obj.state:
            observed.extend(
                self._add_fact(
                    Fact(obj.id, "is", "open" if obj.state["open"] else "closed")
                )
            )

        if "read" in obj.state:
            observed.extend(
                self._add_fact(
                    Fact(obj.id, "is", "read" if obj.state["read"] else "unread")
                )
            )

        if obj.kind == "drawer" and obj.state.get("open", False):
            for contained in sorted(obj.state.get("contains", [])):
                observed.extend(self._add_fact(Fact(obj.id, "contains", contained)))

        if obj.kind == "panel" and "needs_code" in obj.state:
            observed.extend(
                self._add_fact(Fact(obj.id, "needs_code", str(obj.state["needs_code"])))
            )

        if obj.kind == "lock" and "target" in obj.state:
            observed.extend(
                self._add_fact(Fact(obj.id, "is_on", str(obj.state["target"])))
            )

        if obj.kind == "lock" and "uses_key" in obj.state:
            key_name = str(obj.state["uses_key"])
            observed.extend(self._add_fact(Fact(obj.id, "uses_key", key_name)))
            if obj.state.get("key_visible", False):
                observed.extend(self._add_fact(Fact(key_name, "is", "available")))

        if obj.kind == "exit":
            for required_lock in sorted(obj.state.get("requires", [])):
                observed.extend(
                    self._add_fact(Fact(obj.id, "requires_lock", required_lock))
                )

        if obj.kind == "clue" and obj.state.get("visible", False):
            observed.extend(self._add_fact(Fact(obj.id, "is", "available")))

        return observed

    def _add_fact(self, fact: Fact) -> list[Fact]:
        return [fact] if self.kb.add_fact(fact) else []


class Planner:
    def __init__(self) -> None:
        self._taken_actions: set[tuple[str, str, str]] = set()

    def select_action(
        self, kb: KnowledgeBase, room: Room, record: bool = True
    ) -> Action | None:
        action = (
            self._next_clue_action(kb)
            or self._next_open_lock_action(kb)
            or self._next_enter_code_action(kb)
            or self._next_open_exit_action(kb, room)
        )

        if action is None:
            return None

        if record:
            self._taken_actions.add(self._action_key(action))

        return action

    def _next_clue_action(self, kb: KnowledgeBase) -> Action | None:
        clue_ids = {
            fact.subject for fact in kb.query(predicate="should", object="be_examined")
        }
        if not clue_ids:
            available = {
                fact.subject for fact in kb.query(predicate="is", object="available")
            }
            unread = {
                fact.subject for fact in kb.query(predicate="is", object="unread")
            }
            clue_ids = available.intersection(unread)

        for clue_id in sorted(clue_ids):
            action = {"action": "examine_clue", "target": clue_id}
            if self._action_key(action) not in self._taken_actions:
                return action

        return None

    def _next_open_lock_action(self, kb: KnowledgeBase) -> Action | None:
        known_keys = {
            fact.subject for fact in kb.query(predicate="is", object="available")
        }
        candidate_locks = sorted(
            kb.query(predicate="uses_key"), key=lambda fact: fact.subject
        )
        for lock_relation in candidate_locks:
            if lock_relation.object not in known_keys:
                continue
            if kb.has_fact(lock_relation.subject, "is", "open"):
                continue
            action = {"action": "open_lock", "target": lock_relation.subject}
            if self._action_key(action) not in self._taken_actions:
                return action

        return None

    def _next_enter_code_action(self, kb: KnowledgeBase) -> Action | None:
        code_facts = kb.query(predicate="says_code")
        known_codes = {fact.object for fact in code_facts}
        for panel_fact in sorted(
            kb.query(predicate="needs_code"), key=lambda fact: fact.subject
        ):
            if panel_fact.object not in known_codes:
                continue
            if kb.has_fact(panel_fact.subject, "is", "open"):
                continue
            action = {
                "action": "enter_code",
                "target": panel_fact.subject,
                "code": panel_fact.object,
            }
            if self._action_key(action) not in self._taken_actions:
                return action

        return None

    def _next_open_exit_action(self, kb: KnowledgeBase, room: Room) -> Action | None:
        for fact in sorted(
            kb.query(predicate="is", object="reachable"), key=lambda item: item.subject
        ):
            room_obj = room.get_object(fact.subject)
            if room_obj.kind != "exit":
                continue
            action = {"action": "open_exit", "target": fact.subject}
            if self._action_key(action) not in self._taken_actions:
                return action

        return None

    def _action_key(self, action: Action) -> tuple[str, str, str]:
        return (action["action"], action.get("target", ""), action.get("code", ""))


class ActionExecutor:
    def __init__(self) -> None:
        self.decoder = ClueDecoder()

    def execute(
        self, action: Action | None, room: Room, kb: KnowledgeBase
    ) -> list[Fact]:
        if action is None:
            return []

        action_name = action["action"]
        if action_name == "examine_clue":
            return self._execute_examine_clue(action, room, kb)

        if action_name == "open_lock":
            self._execute_open_lock(action, room)
            return []

        if action_name == "enter_code":
            self._execute_enter_code(action, room)
            return []

        if action_name == "open_exit":
            return self._execute_open_exit(action, room, kb)

        return []

    def _execute_examine_clue(
        self, action: Action, room: Room, kb: KnowledgeBase
    ) -> list[Fact]:
        clue_id = action["target"]
        room.set_state(clue_id, "read", True)
        clue_object = room.get_object(clue_id)
        new_facts: list[Fact] = []
        for fact in self.decoder.decode(clue_object):
            if kb.add_fact(fact):
                new_facts.append(fact)
        return new_facts

    def _execute_open_lock(self, action: Action, room: Room) -> None:
        lock_id = action["target"]
        lock = room.get_object(lock_id)
        room.set_state(lock_id, "open", True)

        target_id = lock.state.get("target")
        if not target_id:
            return

        room.set_state(target_id, "locked", False)
        room.set_state(target_id, "open", True)

        target = room.get_object(target_id)
        if target.kind == "drawer":
            for clue_id in target.state.get("contains", []):
                clue = room.get_object(clue_id)
                clue.state["visible"] = True

    def _execute_enter_code(self, action: Action, room: Room) -> None:
        panel_id = action["target"]
        panel = room.get_object(panel_id)
        entered_code = action.get("code")
        expected_code = str(panel.state.get("needs_code", ""))
        if entered_code != expected_code:
            return

        room.set_state(panel_id, "locked", False)
        room.set_state(panel_id, "open", True)

        for lock in room.get_all_objects():
            if lock.kind != "lock":
                continue
            if lock.state.get("target") == panel_id:
                lock.state["open"] = True

    def _execute_open_exit(
        self, action: Action, room: Room, kb: KnowledgeBase
    ) -> list[Fact]:
        exit_id = action["target"]
        room.set_state(exit_id, "locked", False)
        room.set_state(exit_id, "open", True)
        won_fact = Fact("game", "state", "won")
        return [won_fact] if kb.add_fact(won_fact) else []


class EscapeRoomAgent:
    def __init__(self, room: Room | None = None) -> None:
        self.room = room or build_room()
        self.kb = KnowledgeBase()
        self.inference_engine = InferenceEngine(self.kb, RULES)
        self.perception = Perception(self.kb)
        self.planner = Planner()
        self.action_executor = ActionExecutor()

        self.step_number = 0
        self.observed_facts: list[Fact] = []
        self.inferred_facts: list[tuple[str, Fact]] = []
        self._observed_fact_set: set[Fact] = set()
        self._inferred_fact_set: set[Fact] = set()

    def step(self) -> StepResult:
        self.step_number += 1

        perception_facts = self.perception.observe(self.room)
        self._record_observed(perception_facts)

        inference_facts = self.inference_engine.run_forward_chaining()
        self._record_inferred(self.inference_engine.last_inference_trace)

        action = self.planner.select_action(self.kb, self.room, record=True)
        action_facts = self.action_executor.execute(action, self.room, self.kb)
        self._record_observed(action_facts)

        next_planned_action = self.planner.select_action(
            self.kb, self.room, record=False
        )
        game_won = self.kb.has_fact("game", "state", "won")

        return StepResult(
            step_number=self.step_number,
            action_taken=action,
            new_facts_from_perception=perception_facts + action_facts,
            new_facts_from_inference=inference_facts,
            next_planned_action=next_planned_action,
            game_won=game_won,
        )

    def snapshot(self) -> dict[str, Any]:
        return {
            "room": self.room.to_dict(),
            "observed_facts": [fact_to_dict(fact) for fact in self.observed_facts],
            "inferred_facts": [
                {"rule_name": rule_name, "fact": fact_to_dict(fact)}
                for rule_name, fact in self.inferred_facts
            ],
            "step": self.step_number,
            "game_won": self.kb.has_fact("game", "state", "won"),
        }

    def _record_observed(self, facts: list[Fact]) -> None:
        for fact in facts:
            if fact not in self._observed_fact_set:
                self._observed_fact_set.add(fact)
                self.observed_facts.append(fact)

    def _record_inferred(self, trace: list[tuple[str, Fact]]) -> None:
        for rule_name, fact in trace:
            if fact in self._inferred_fact_set:
                continue
            self._inferred_fact_set.add(fact)
            self.inferred_facts.append((rule_name, fact))


def fact_to_dict(fact: Fact) -> dict[str, str]:
    return {"subject": fact.subject, "predicate": fact.predicate, "object": fact.object}


def run_full_game(max_steps: int = 20) -> list[StepResult]:
    agent = EscapeRoomAgent()
    results: list[StepResult] = []
    for _ in range(max_steps):
        result = agent.step()
        results.append(result)
        if result.game_won:
            break
    return results

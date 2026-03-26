from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Literal

from src.knowledge import Fact


RoomKind = Literal["drawer", "panel", "clue", "lock", "exit"]


@dataclass
class RoomObject:
    id: str
    kind: RoomKind
    state: dict[str, Any]
    position: dict[str, float]


class Room:
    def __init__(self, objects: list[RoomObject] | None = None) -> None:
        self._objects: dict[str, RoomObject] = {}
        for obj in objects or []:
            self._objects[obj.id] = obj

    def get_object(self, object_id: str) -> RoomObject:
        return self._objects[object_id]

    def set_state(self, object_id: str, key: str, value: Any) -> None:
        self._objects[object_id].state[key] = value

    def get_all_objects(self) -> list[RoomObject]:
        return [self._objects[obj_id] for obj_id in sorted(self._objects)]

    def to_dict(self) -> dict[str, Any]:
        return {
            "objects": [
                {
                    "id": obj.id,
                    "kind": obj.kind,
                    "state": deepcopy(obj.state),
                    "position": deepcopy(obj.position),
                }
                for obj in self.get_all_objects()
            ]
        }


class ClueDecoder:
    def decode(self, clue_object: RoomObject) -> list[Fact]:
        raw_facts = clue_object.state.get("reveals", [])
        decoded: list[Fact] = []

        for raw_fact in raw_facts:
            if len(raw_fact) != 3:
                raise ValueError("Each clue reveal entry must be a fact triple")
            subject, predicate, object = raw_fact
            decoded.append(Fact(subject, predicate, object))

        return decoded

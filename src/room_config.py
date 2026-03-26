from src.room import Room, RoomObject


def build_room() -> Room:
    objects = [
        RoomObject(
            id="drawer_A",
            kind="drawer",
            state={"locked": True, "open": False, "contains": ["clue_1"]},
            position={"x": 20.0, "y": 38.0},
        ),
        RoomObject(
            id="drawer_B",
            kind="drawer",
            state={"locked": True, "open": False, "contains": ["clue_2"]},
            position={"x": 42.0, "y": 38.0},
        ),
        RoomObject(
            id="panel_main",
            kind="panel",
            state={"locked": True, "open": False, "needs_code": "4829"},
            position={"x": 68.0, "y": 38.0},
        ),
        RoomObject(
            id="clue_1",
            kind="clue",
            state={
                "visible": False,
                "read": False,
                "reveals": [("lock_B", "uses_key", "key_red")],
            },
            position={"x": 20.0, "y": 58.0},
        ),
        RoomObject(
            id="clue_2",
            kind="clue",
            state={
                "visible": False,
                "read": False,
                "reveals": [("clue_2", "says_code", "4829")],
            },
            position={"x": 42.0, "y": 58.0},
        ),
        RoomObject(
            id="lock_A",
            kind="lock",
            state={
                "target": "drawer_A",
                "uses_key": "key_red",
                "open": False,
                "key_visible": True,
            },
            position={"x": 20.0, "y": 24.0},
        ),
        RoomObject(
            id="lock_B",
            kind="lock",
            state={"target": "drawer_B", "uses_key": "key_red", "open": False},
            position={"x": 42.0, "y": 24.0},
        ),
        RoomObject(
            id="lock_panel",
            kind="lock",
            state={"target": "panel_main", "uses_code": "4829", "open": False},
            position={"x": 68.0, "y": 24.0},
        ),
        RoomObject(
            id="exit_door",
            kind="exit",
            state={"locked": True, "requires": ["lock_panel"], "reachable": False},
            position={"x": 88.0, "y": 38.0},
        ),
    ]

    return Room(objects)

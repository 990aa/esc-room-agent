from src.knowledge import Rule


RULES = [
    Rule(
        name="panel_can_be_opened_when_code_matches",
        conditions=[
            ("?clue", "says_code", "?code"),
            ("?panel", "needs_code", "?code"),
        ],
        conclusion=("?panel", "can_be_opened", "true"),
    ),
    Rule(
        name="clue_available_when_container_open",
        conditions=[
            ("?drawer", "contains", "?clue"),
            ("?drawer", "is", "open"),
        ],
        conclusion=("?clue", "is", "available"),
    ),
    Rule(
        name="lock_openable_with_available_key",
        conditions=[
            ("?key", "is", "available"),
            ("?lock", "uses_key", "?key"),
        ],
        conclusion=("?lock", "can_be_opened", "true"),
    ),
    Rule(
        name="exit_reachable_when_required_lock_open",
        conditions=[
            ("?exit", "requires_lock", "?lock"),
            ("?lock", "is", "open"),
        ],
        conclusion=("?exit", "is", "reachable"),
    ),
    Rule(
        name="available_unread_clue_should_be_examined",
        conditions=[
            ("?clue", "is", "available"),
            ("?clue", "is", "unread"),
        ],
        conclusion=("?clue", "should", "be_examined"),
    ),
]

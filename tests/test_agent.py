from src.agent import EscapeRoomAgent, run_full_game


def test_step_adds_observable_room_facts_to_kb() -> None:
    agent = EscapeRoomAgent()

    agent.step()

    assert agent.kb.has_fact("lock_A", "is_on", "drawer_A")
    assert agent.kb.has_fact("lock_A", "uses_key", "key_red")
    assert agent.kb.has_fact("key_red", "is", "available")


def test_run_full_game_reaches_win_state() -> None:
    results = run_full_game()

    assert results
    assert results[-1].game_won is True


def test_run_full_game_step_count_is_deterministic() -> None:
    first_run = run_full_game()
    second_run = run_full_game()

    assert len(first_run) == len(second_run)


def test_planner_never_repeats_same_action_consecutively() -> None:
    results = run_full_game()
    action_sequence = [step.action_taken for step in results if step.action_taken is not None]

    for previous, current in zip(action_sequence, action_sequence[1:], strict=False):
        assert previous != current

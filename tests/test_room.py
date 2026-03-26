import json

from src.knowledge import Fact
from src.room import ClueDecoder
from src.room_config import build_room


def test_room_snapshot_is_json_serializable() -> None:
    room = build_room()
    snapshot = room.to_dict()

    dumped = json.dumps(snapshot)

    assert isinstance(dumped, str)
    assert "objects" in snapshot


def test_set_state_mutates_room_object() -> None:
    room = build_room()

    room.set_state("drawer_A", "locked", False)

    assert room.get_object("drawer_A").state["locked"] is False


def test_clue_decoder_decodes_both_clues() -> None:
    room = build_room()
    decoder = ClueDecoder()

    clue_1_facts = decoder.decode(room.get_object("clue_1"))
    clue_2_facts = decoder.decode(room.get_object("clue_2"))

    assert clue_1_facts == [Fact("lock_B", "uses_key", "key_red")]
    assert clue_2_facts == [Fact("clue_2", "says_code", "4829")]

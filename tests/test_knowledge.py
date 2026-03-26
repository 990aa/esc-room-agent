from src.knowledge import Fact, InferenceEngine, KnowledgeBase, Rule


def test_query_returns_expected_subset() -> None:
    kb = KnowledgeBase()
    fact_1 = Fact("drawer_A", "is", "locked")
    fact_2 = Fact("drawer_A", "contains", "clue_1")
    fact_3 = Fact("panel_main", "needs_code", "4829")

    kb.add_fact(fact_1)
    kb.add_fact(fact_2)
    kb.add_fact(fact_3)

    drawer_facts = kb.query(subject="drawer_A")
    code_facts = kb.query(predicate="needs_code", object="4829")

    assert set(drawer_facts) == {fact_1, fact_2}
    assert code_facts == [fact_3]


def test_forward_chaining_single_condition_rule() -> None:
    kb = KnowledgeBase([Fact("panel_main", "needs_code", "4829")])
    rule = Rule(
        name="panel_is_code_panel",
        conditions=[("panel_main", "needs_code", "4829")],
        conclusion=("panel_main", "is", "code_panel"),
    )

    engine = InferenceEngine(kb, [rule])
    inferred = engine.run_forward_chaining()

    assert Fact("panel_main", "is", "code_panel") in inferred
    assert kb.has_fact("panel_main", "is", "code_panel")


def test_forward_chaining_variable_binding_across_two_conditions() -> None:
    kb = KnowledgeBase(
        [
            Fact("drawer_A", "contains", "clue_1"),
            Fact("drawer_A", "is", "open"),
            Fact("drawer_B", "contains", "clue_2"),
        ]
    )
    rule = Rule(
        name="open_drawer_makes_its_clue_available",
        conditions=[("?drawer", "contains", "?clue"), ("?drawer", "is", "open")],
        conclusion=("?clue", "is", "available"),
    )

    engine = InferenceEngine(kb, [rule])
    engine.run_forward_chaining()

    assert kb.has_fact("clue_1", "is", "available")
    assert not kb.has_fact("clue_2", "is", "available")


def test_knowledge_base_does_not_store_duplicates() -> None:
    kb = KnowledgeBase()
    fact = Fact("lock_A", "uses_key", "key_red")

    first_add = kb.add_fact(fact)
    second_add = kb.add_fact(fact)

    assert first_add is True
    assert second_add is False
    assert len(kb.all_facts()) == 1

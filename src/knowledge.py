from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True, order=True)
class Fact:
    subject: str
    predicate: str
    object: str


FactPattern = tuple[str, str, str]


@dataclass(frozen=True)
class Rule:
    name: str
    conditions: list[FactPattern]
    conclusion: FactPattern


class KnowledgeBase:
    def __init__(self, facts: Iterable[Fact] | None = None) -> None:
        self._facts: set[Fact] = set(facts or [])

    def add_fact(self, fact: Fact) -> bool:
        if fact in self._facts:
            return False
        self._facts.add(fact)
        return True

    def has_fact(self, subject: str, predicate: str, object: str) -> bool:
        return Fact(subject, predicate, object) in self._facts

    def query(
        self,
        subject: str | None = None,
        predicate: str | None = None,
        object: str | None = None,
    ) -> list[Fact]:
        return sorted(
            fact
            for fact in self._facts
            if (subject is None or fact.subject == subject)
            and (predicate is None or fact.predicate == predicate)
            and (object is None or fact.object == object)
        )

    def all_facts(self) -> list[Fact]:
        return sorted(self._facts)


class InferenceEngine:
    def __init__(self, knowledge_base: KnowledgeBase, rules: list[Rule]) -> None:
        self.kb = knowledge_base
        self.rules = rules
        self.last_inference_trace: list[tuple[str, Fact]] = []

    def run_forward_chaining(self) -> list[Fact]:
        self.last_inference_trace = []
        inferred_facts: list[Fact] = []
        changed = True

        while changed:
            changed = False
            for rule in self.rules:
                for binding in self._find_bindings(rule.conditions, {}, 0):
                    conclusion = self._instantiate(rule.conclusion, binding)
                    if self.kb.add_fact(conclusion):
                        inferred_facts.append(conclusion)
                        self.last_inference_trace.append((rule.name, conclusion))
                        changed = True

        return inferred_facts

    def _find_bindings(
        self,
        conditions: list[FactPattern],
        binding: dict[str, str],
        index: int,
    ) -> list[dict[str, str]]:
        if index == len(conditions):
            return [binding]

        pattern = conditions[index]
        results: list[dict[str, str]] = []

        for fact in self.kb.all_facts():
            candidate = self._match_pattern(pattern, fact, binding)
            if candidate is not None:
                results.extend(self._find_bindings(conditions, candidate, index + 1))

        return results

    def _match_pattern(
        self,
        pattern: FactPattern,
        fact: Fact,
        binding: dict[str, str],
    ) -> dict[str, str] | None:
        updated_binding = dict(binding)
        for token, value in zip(
            pattern, (fact.subject, fact.predicate, fact.object), strict=True
        ):
            if token.startswith("?"):
                existing = updated_binding.get(token)
                if existing is None:
                    updated_binding[token] = value
                elif existing != value:
                    return None
            elif token != value:
                return None

        return updated_binding

    def _instantiate(self, pattern: FactPattern, binding: dict[str, str]) -> Fact:
        values: list[str] = []
        for token in pattern:
            if token.startswith("?"):
                if token not in binding:
                    raise ValueError(f"Unbound variable in conclusion: {token}")
                values.append(binding[token])
            else:
                values.append(token)

        return Fact(*values)

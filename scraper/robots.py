"""Minimal robots.txt matcher for the rules Lidl publishes."""

from __future__ import annotations

import re
from urllib.parse import urlparse


def _rule_to_regex(rule: str) -> re.Pattern[str]:
    # robots.txt: * is a wildcard, $ anchors the end. Match the path + query.
    escaped = re.escape(rule).replace(r"\*", ".*")
    if escaped.endswith(r"\$"):
        escaped = escaped[:-2] + "$"
    return re.compile(escaped)


class Robots:
    def __init__(self, rules: list[str]) -> None:
        self.rules = list(dict.fromkeys(rule for rule in rules if rule))
        self._rules = [_rule_to_regex(rule) for rule in self.rules]

    @classmethod
    def parse(cls, body: str) -> Robots:
        body = body.lstrip("\ufeff")
        rules: list[str] = []
        active = False
        for raw in body.splitlines():
            line = raw.split("#", 1)[0].strip()
            if not line or ":" not in line:
                continue
            key, value = line.split(":", 1)
            key = key.strip().lower()
            value = value.strip()
            if key == "user-agent":
                active = value == "*"
            elif key == "disallow" and active and value:
                rules.append(value)
        return cls(rules)

    def allowed(self, url: str) -> bool:
        parsed = urlparse(url)
        path = parsed.path or "/"
        target = path + (f"?{parsed.query}" if parsed.query else "")
        # Some shops publish disallow paths without a leading slash.
        candidates = [target]
        if target.startswith("/"):
            candidates.append(target[1:])
        return not any(
            rule.match(candidate) for candidate in candidates for rule in self._rules
        )

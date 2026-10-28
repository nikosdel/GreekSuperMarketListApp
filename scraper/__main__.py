import sys

from scraper.db import migrate
from scraper.lidl import run_lidl
from scraper.masoutis import run_masoutis


def _utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (OSError, ValueError):
            pass


def main(argv: list[str]) -> int:
    _utf8_stdio()
    if len(argv) != 2 or argv[1] not in {"migrate", "lidl", "masoutis"}:
        print("Usage: python -m scraper migrate | lidl | masoutis", file=sys.stderr)
        return 2
    if argv[1] == "migrate":
        migrate()
        return 0
    if argv[1] == "masoutis":
        return run_masoutis()
    return run_lidl()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

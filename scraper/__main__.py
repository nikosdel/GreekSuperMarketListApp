import sys

from scraper.db import migrate
from scraper.posokanei import run_posokanei


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
    if len(argv) != 2 or argv[1] not in {"migrate", "posokanei"}:
        print("Usage: python -m scraper migrate | posokanei", file=sys.stderr)
        return 2
    if argv[1] == "migrate":
        migrate()
        return 0
    return run_posokanei()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_dotenv() -> None:
    path = ROOT / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def database_url() -> str:
    load_dotenv()
    return os.environ.get(
        "DATABASE_URL",
        "postgresql://supermarket:supermarket@localhost:5433/supermarket",
    )


def lidl_delay_seconds() -> float:
    load_dotenv()
    raw = float(os.environ.get("LIDL_REQUEST_DELAY_SECONDS", "1.5"))
    return max(1.0, raw)


def masoutis_delay_seconds() -> float:
    load_dotenv()
    raw = float(os.environ.get("MASOUTIS_REQUEST_DELAY_SECONDS", "1.5"))
    return max(1.0, raw)


def lidl_fetch_size() -> int:
    load_dotenv()
    raw = int(os.environ.get("LIDL_FETCH_SIZE", "100"))
    return min(200, max(1, raw))

"""Create a demo API key and write it to .demo-key (gitignored).

Usage: .venv/bin/python scripts/seed.py [--force]
Without --force, an existing active "demo" key is kept and nothing is written.
"""

import argparse
import asyncio
import os
from pathlib import Path

from sqlalchemy import select

from tollgate.auth import create_api_key
from tollgate.config import get_settings
from tollgate.db import create_db_engine, create_session_factory
from tollgate.models import ApiKey

DEMO_NAME = "demo"
DEMO_RPM = 30
DEMO_FILE = Path(__file__).resolve().parent.parent / ".demo-key"


async def seed(force: bool) -> int:
    engine = create_db_engine(get_settings().database_url)
    factory = create_session_factory(engine)
    try:
        async with factory() as session:
            existing = await session.scalar(
                select(ApiKey.id).where(ApiKey.name == DEMO_NAME, ApiKey.revoked_at.is_(None))
            )
        if existing is not None and not force:
            print(f"Active '{DEMO_NAME}' key already exists ({existing}). Use --force for a new one.")
            return 0
        async with factory() as session, session.begin():
            key, plaintext = await create_api_key(
                session, name=DEMO_NAME, rpm=DEMO_RPM, cache_enabled=True
            )
    finally:
        await engine.dispose()

    fd = os.open(DEMO_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(plaintext + "\n")
    print(f"Created '{DEMO_NAME}' key {key.id} ({DEMO_RPM} rpm, cache on).")
    print(f"Key written to {DEMO_FILE} (mode 600, gitignored).")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Create a new demo key anyway.")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(seed(args.force)))


if __name__ == "__main__":
    main()

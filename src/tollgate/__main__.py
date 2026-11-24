"""Run the API server: python -m tollgate."""

import uvicorn

from tollgate.config import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run("tollgate.main:app", host=settings.api_host, port=settings.api_port)


if __name__ == "__main__":
    main()

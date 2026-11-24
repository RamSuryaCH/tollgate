"""Operator CLI: create-key, list-keys, revoke-key. Talks to the database directly."""

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Annotated

import typer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tollgate.auth import create_api_key
from tollgate.config import get_settings
from tollgate.db import create_db_engine, create_session_factory
from tollgate.models import ApiKey

app = typer.Typer(help="Tollgate operator commands.", no_args_is_help=True)


async def _run_with_db[T](
    fn: Callable[[async_sessionmaker[AsyncSession]], Awaitable[T]],
) -> T:
    engine = create_db_engine(get_settings().database_url)
    try:
        return await fn(create_session_factory(engine))
    finally:
        await engine.dispose()


@app.command("create-key")
def create_key(
    name: Annotated[str, typer.Option("--name", help="Label for the key.")],
    rpm: Annotated[int, typer.Option("--rpm", min=1, help="Requests per minute.")] = 60,
    no_cache: Annotated[bool, typer.Option("--no-cache", help="Disable response caching.")] = False,
) -> None:
    """Create an API key and print it once."""

    async def go(factory: async_sessionmaker[AsyncSession]) -> tuple[ApiKey, str]:
        async with factory() as session, session.begin():
            return await create_api_key(session, name=name, rpm=rpm, cache_enabled=not no_cache)

    key, plaintext = asyncio.run(_run_with_db(go))
    typer.echo(f"Created key {key.id} ({key.name}), {key.rate_limit_rpm} rpm.")
    typer.echo("Save this key now. It will not be shown again:")
    typer.echo(plaintext)


@app.command("list-keys")
def list_keys() -> None:
    """List keys (no secrets)."""

    async def go(factory: async_sessionmaker[AsyncSession]) -> list[ApiKey]:
        async with factory() as session:
            result = await session.execute(select(ApiKey).order_by(ApiKey.created_at))
            return list(result.scalars().all())

    keys = asyncio.run(_run_with_db(go))
    if not keys:
        typer.echo("No keys.")
        return
    typer.echo(f"{'ID':36}  {'PREFIX':10}  {'RPM':>5}  {'CACHE':5}  {'STATUS':8}  NAME")
    for k in keys:
        status = "revoked" if k.revoked_at else "active"
        cache = "on" if k.cache_enabled else "off"
        typer.echo(
            f"{k.id!s:36}  {k.prefix:10}  {k.rate_limit_rpm:>5}  {cache:5}  {status:8}  {k.name}"
        )


@app.command("revoke-key")
def revoke_key(key_id: Annotated[str, typer.Argument(help="UUID of the key.")]) -> None:
    """Revoke a key. Its requests fail with 401 from then on."""
    try:
        parsed = uuid.UUID(key_id)
    except ValueError as exc:
        raise typer.BadParameter("KEY_ID must be a UUID") from exc

    async def go(factory: async_sessionmaker[AsyncSession]) -> ApiKey | None:
        async with factory() as session, session.begin():
            key = await session.get(ApiKey, parsed)
            if key is not None and key.revoked_at is None:
                key.revoked_at = datetime.now(UTC)
            return key

    key = asyncio.run(_run_with_db(go))
    if key is None:
        typer.echo(f"No key with id {parsed}", err=True)
        raise typer.Exit(code=1)
    typer.echo(f"Revoked {key.id} ({key.name}).")


if __name__ == "__main__":
    app()

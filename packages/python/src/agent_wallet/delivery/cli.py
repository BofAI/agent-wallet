"""AgentWallet CLI — key management and signing operations."""

from __future__ import annotations

import asyncio
import json
import os
import stat
from pathlib import Path
from typing import Optional

import sys

import typer
from rich.console import Console
from rich.prompt import Confirm, Prompt
from rich.table import Table

from agent_wallet.core.base import COMMON_CHAINS, Eip712Capable, WalletType


def _interactive_select(prompt_text: str, choices: list[str]) -> str | None:
    """Try questionary arrow-key select; return None if unavailable."""
    if not sys.stdin.isatty():
        return None
    try:
        import questionary

        return questionary.select(prompt_text, choices=choices).unsafe_ask()
    except (ImportError, EOFError, OSError, ValueError):
        return None
from agent_wallet.core.errors import DecryptionError, WalletError
from agent_wallet.secret.kv_store import SecureKVStore
from agent_wallet.storage.config import (
    WalletConfig,
    WalletsTopology,
    load_config,
    save_config,
)

app = typer.Typer(
    name="agent-wallet",
    help="Universal multi-chain secure signing SDK.",
    no_args_is_help=True,
)
sign_app = typer.Typer(help="Sign transactions or messages.")
app.add_typer(sign_app, name="sign")

console = Console()

DEFAULT_DIR = os.environ.get(
    "AGENT_WALLET_DIR",
    os.path.join(Path.home(), ".agent-wallet"),
)


# --- Helpers ---


def _get_password(*, confirm: bool = False) -> str:
    """Get password from env var or interactive prompt."""
    pw = os.environ.get("AGENT_WALLET_PASSWORD")
    if pw:
        return pw
    pw = Prompt.ask("[bold]Master password[/bold]", password=True)
    if confirm:
        pw2 = Prompt.ask("[bold]Confirm password[/bold]", password=True)
        if pw != pw2:
            console.print("[red]Passwords do not match.[/red]")
            raise typer.Exit(1)
    return pw


def _load_config_safe(secrets_dir: str) -> WalletsTopology:
    """Load config, returning empty topology if file doesn't exist."""
    try:
        return load_config(secrets_dir)
    except FileNotFoundError:
        return WalletsTopology(wallets={})


def _derive_address(wallet_type: WalletType, private_key: bytes) -> str:
    """Derive address from private key based on wallet type."""
    if wallet_type == WalletType.EVM_LOCAL:
        from eth_account import Account

        return Account.from_key(private_key).address
    elif wallet_type == WalletType.TRON_LOCAL:
        from tronpy.keys import PrivateKey

        return PrivateKey(private_key).public_key.to_base58check_address()
    return ""


# --- Commands ---


@app.command()
def init(
    dir: str = typer.Option(DEFAULT_DIR, "--dir", "-d", help="Secrets directory path"),
) -> None:
    """Initialize secrets directory and set master password."""
    secrets_path = Path(dir)

    if (secrets_path / "master.json").exists():
        console.print(f"[yellow]Already initialized:[/yellow] {secrets_path}")
        raise typer.Exit(1)

    secrets_path.mkdir(parents=True, exist_ok=True)
    os.chmod(secrets_path, stat.S_IRWXU)  # 700

    pw = _get_password(confirm=True)

    kv_store = SecureKVStore(dir, pw)
    kv_store.init_master()

    # Create empty wallets config
    save_config(dir, WalletsTopology(wallets={}))

    console.print(f"[green]Initialized.[/green] Secrets directory: {secrets_path}")


@app.command()
def add(
    dir: str = typer.Option(DEFAULT_DIR, "--dir", "-d", help="Secrets directory path"),
) -> None:
    """Add a new wallet (interactive)."""
    pw = _get_password()
    kv_store = SecureKVStore(dir, pw)
    kv_store.verify_password()

    config = _load_config_safe(dir)

    # Wallet name
    name = Prompt.ask("[bold]Wallet name[/bold]")
    if name in config.wallets:
        console.print(f"[red]Wallet '{name}' already exists.[/red]")
        raise typer.Exit(1)

    # Wallet type
    type_choices = [t.value for t in WalletType]
    type_str = _interactive_select("Wallet type:", type_choices)
    if type_str is None:
        type_str = Prompt.ask("[bold]Wallet type[/bold]", choices=type_choices)
    wallet_type = WalletType(type_str)

    wallet_conf: dict = {"type": wallet_type.value}

    if wallet_type in (WalletType.EVM_LOCAL, WalletType.TRON_LOCAL):
        # Chain ID
        chain_choices = COMMON_CHAINS.get(wallet_type, [])
        chain_id = _interactive_select("Chain ID:", chain_choices + ["custom"])
        if chain_id == "custom":
            chain_id = Prompt.ask("[bold]Custom Chain ID[/bold]")
        elif chain_id is None:
            chain_id = Prompt.ask("[bold]Chain ID[/bold]", default=chain_choices[0])
        wallet_conf["chain_id"] = chain_id

        # Private key: generate or import
        action = _interactive_select("Private key:", ["generate", "import"])
        if action is None:
            action = Prompt.ask("[bold]Private key[/bold]", choices=["generate", "import"], default="generate")

        identity_file = name
        if action == "generate":
            private_key = kv_store.generate_key(identity_file)
            console.print("[green]Generated new private key.[/green]")
        else:
            key_hex = Prompt.ask("[bold]Paste private key (hex)[/bold]", password=True)
            key_hex = key_hex.strip().removeprefix("0x")
            try:
                private_key = bytes.fromhex(key_hex)
            except ValueError:
                console.print("[red]Invalid hex string.[/red]")
                raise typer.Exit(1)
            kv_store.save_private_key(identity_file, private_key)
            console.print("[green]Imported private key.[/green]")

        wallet_conf["identity_file"] = identity_file

        address = _derive_address(wallet_type, private_key)
        wallet_conf["address"] = address
        console.print(f"  Address: [cyan]{address}[/cyan]")
        console.print(f"  Saved:   [dim]id_{identity_file}.json[/dim]")

        # TronGrid API key for Tron
        if wallet_type == WalletType.TRON_LOCAL:
            api_key = Prompt.ask(
                "[bold]TronGrid API Key[/bold] (optional, press enter to skip)",
                default="",
                password=True,
            )
            if api_key:
                cred_name = name
                kv_store.save_credential(cred_name, api_key)
                wallet_conf["cred_file"] = cred_name
                console.print(f"  Saved:   [dim]cred_{cred_name}.json[/dim]")

    else:
        console.print(f"[yellow]Wallet type '{wallet_type}' is not yet fully supported.[/yellow]")
        raise typer.Exit(1)

    # Update config
    config.wallets[name] = WalletConfig.model_validate(wallet_conf)
    save_config(dir, config)
    console.print(f"[green]Wallet '{name}' added.[/green] Config updated.")


@app.command("list")
def list_wallets(
    dir: str = typer.Option(DEFAULT_DIR, "--dir", "-d", help="Secrets directory path"),
) -> None:
    """List all configured wallets."""
    config = _load_config_safe(dir)

    if not config.wallets:
        console.print("[dim]No wallets configured.[/dim]")
        return

    table = Table(title="Wallets")
    table.add_column("Name", style="cyan")
    table.add_column("Type", style="green")
    table.add_column("Chain", style="yellow")
    table.add_column("Address", style="dim")

    for wid, conf in config.wallets.items():
        table.add_row(wid, conf.type.value, conf.chain_id or "—", conf.address or "—")

    console.print(table)


@app.command()
def inspect(
    wallet_id: str = typer.Argument(help="Wallet ID to inspect"),
    dir: str = typer.Option(DEFAULT_DIR, "--dir", "-d", help="Secrets directory path"),
) -> None:
    """Show wallet details including address."""
    config = _load_config_safe(dir)
    if wallet_id not in config.wallets:
        console.print(f"[red]Wallet '{wallet_id}' not found.[/red]")
        raise typer.Exit(1)

    conf = config.wallets[wallet_id]
    secrets_path = Path(dir)
    id_status = "✓" if conf.identity_file and (secrets_path / f"id_{conf.identity_file}.json").exists() else "—"
    cred_status = "✓" if conf.cred_file and (secrets_path / f"cred_{conf.cred_file}.json").exists() else "—"

    table = Table(show_header=False, box=None, padding=(0, 2))
    table.add_column("Key", style="bold")
    table.add_column("Value")
    table.add_row("Wallet", wallet_id)
    table.add_row("Type", conf.type.value)
    table.add_row("Chain", conf.chain_id or "—")
    table.add_row("Address", conf.address or "—")
    table.add_row("Identity", f"id_{conf.identity_file}.json {id_status}" if conf.identity_file else "—")
    table.add_row("Credential", f"cred_{conf.cred_file}.json {cred_status}" if conf.cred_file else "—")

    console.print(table)


@app.command()
def remove(
    wallet_id: str = typer.Argument(help="Wallet ID to remove"),
    dir: str = typer.Option(DEFAULT_DIR, "--dir", "-d", help="Secrets directory path"),
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation"),
) -> None:
    """Remove a wallet and its associated files."""
    config = _load_config_safe(dir)
    if wallet_id not in config.wallets:
        console.print(f"[red]Wallet '{wallet_id}' not found.[/red]")
        raise typer.Exit(1)

    if not yes and not Confirm.ask(f"Remove wallet '{wallet_id}'?", default=False):
        console.print("[dim]Cancelled.[/dim]")
        raise typer.Exit(0)

    conf = config.wallets[wallet_id]
    secrets_path = Path(dir)

    # Delete associated files
    if conf.identity_file:
        id_path = secrets_path / f"id_{conf.identity_file}.json"
        if id_path.exists():
            id_path.unlink()
            console.print(f"  Deleted: [dim]{id_path.name}[/dim]")

    if conf.cred_file:
        cred_path = secrets_path / f"cred_{conf.cred_file}.json"
        if cred_path.exists():
            cred_path.unlink()
            console.print(f"  Deleted: [dim]{cred_path.name}[/dim]")

    del config.wallets[wallet_id]
    save_config(dir, config)
    console.print(f"[green]Wallet '{wallet_id}' removed.[/green]")


# --- Sign subcommands ---


@sign_app.command("tx")
def sign_tx(
    wallet: str = typer.Option(..., "--wallet", "-w", help="Wallet ID"),
    payload: str = typer.Option(..., "--payload", "-p", help="Transaction payload (JSON)"),
    dir: str = typer.Option(DEFAULT_DIR, "--dir", "-d", help="Secrets directory path"),
) -> None:
    """Sign a transaction."""
    pw = _get_password()

    from agent_wallet.core.provider import WalletFactory

    try:
        provider = WalletFactory(secrets_dir=dir, password=pw)
        w = asyncio.run(provider.get_wallet(wallet))
        tx_data = json.loads(payload)
        signed = asyncio.run(w.sign_transaction(tx_data))
        # Pretty-print if JSON, otherwise print as-is
        try:
            parsed = json.loads(signed)
            console.print("[green]Signed tx:[/green]")
            console.print_json(json.dumps(parsed))
        except (json.JSONDecodeError, TypeError):
            console.print(f"[green]Signed tx:[/green] {signed}")
    except (WalletError, json.JSONDecodeError) as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)


@sign_app.command("msg")
def sign_msg(
    wallet: str = typer.Option(..., "--wallet", "-w", help="Wallet ID"),
    message: str = typer.Option(..., "--message", "-m", help="Message to sign"),
    dir: str = typer.Option(DEFAULT_DIR, "--dir", "-d", help="Secrets directory path"),
) -> None:
    """Sign a message."""
    pw = _get_password()

    from agent_wallet.core.provider import WalletFactory

    try:
        provider = WalletFactory(secrets_dir=dir, password=pw)
        w = asyncio.run(provider.get_wallet(wallet))
        signature = asyncio.run(w.sign_message(message.encode()))
        console.print(f"[green]Signature:[/green] {signature}")
    except WalletError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)


@sign_app.command("typed-data")
def sign_typed_data(
    wallet: str = typer.Option(..., "--wallet", "-w", help="Wallet ID"),
    data: str = typer.Option(..., "--data", help="EIP-712 typed data (JSON)"),
    dir: str = typer.Option(DEFAULT_DIR, "--dir", "-d", help="Secrets directory path"),
) -> None:
    """Sign EIP-712 typed data."""
    pw = _get_password()

    from agent_wallet.core.provider import WalletFactory

    try:
        provider = WalletFactory(secrets_dir=dir, password=pw)
        w = asyncio.run(provider.get_wallet(wallet))
        if not isinstance(w, Eip712Capable):
            console.print("[red]This wallet does not support EIP-712 signing.[/red]")
            raise typer.Exit(1)
        typed_data = json.loads(data)
        signature = asyncio.run(w.sign_typed_data(typed_data))
        console.print(f"[green]Signature:[/green] {signature}")
    except (WalletError, json.JSONDecodeError) as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)


@app.command("change-password")
def change_password(
    dir: str = typer.Option(DEFAULT_DIR, "--dir", "-d", help="Secrets directory path"),
) -> None:
    """Change master password and re-encrypt all files."""
    console.print("[bold]Current password:[/bold]")
    old_pw = _get_password()

    # Verify old password
    kv_store_old = SecureKVStore(dir, old_pw)
    try:
        kv_store_old.verify_password()
    except (DecryptionError, FileNotFoundError) as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)

    console.print("[bold]New password:[/bold]")
    new_pw = Prompt.ask("[bold]New password[/bold]", password=True)
    new_pw2 = Prompt.ask("[bold]Confirm new password[/bold]", password=True)
    if new_pw != new_pw2:
        console.print("[red]Passwords do not match.[/red]")
        raise typer.Exit(1)

    secrets_path = Path(dir)
    kv_store_new = SecureKVStore(dir, new_pw)
    re_encrypted = 0

    # Re-encrypt master.json
    kv_store_new.init_master()
    console.print("  [green]✓[/green] master.json")
    re_encrypted += 1

    # Re-encrypt all id_*.json and cred_*.json
    for path in sorted(secrets_path.glob("id_*.json")):
        name = path.stem.removeprefix("id_")
        key = kv_store_old.load_private_key(name)
        kv_store_new.save_private_key(name, key)
        console.print(f"  [green]✓[/green] {path.name}")
        re_encrypted += 1

    for path in sorted(secrets_path.glob("cred_*.json")):
        name = path.stem.removeprefix("cred_")
        cred = kv_store_old.load_credential(name)
        kv_store_new.save_credential(name, cred)
        console.print(f"  [green]✓[/green] {path.name}")
        re_encrypted += 1

    console.print(f"\n[green]Password changed.[/green] Re-encrypted {re_encrypted} files.")


@app.command()
def serve() -> None:
    """Start MCP / HTTP server (not yet implemented)."""
    console.print("[yellow]Server is not yet implemented.[/yellow]")
    raise typer.Exit(1)

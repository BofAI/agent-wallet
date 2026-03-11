"""AgentWallet CLI — key management and signing operations."""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import stat
import string
from pathlib import Path
from typing import Optional

import sys

import typer
from rich.console import Console
from rich.prompt import Confirm, Prompt
from rich.table import Table

from agent_wallet.core.base import Eip712Capable, WalletType


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
from agent_wallet.local.kv_store import SecureKVStore
from agent_wallet.local.config import (
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

DEFAULT_DIR = os.path.expanduser(
    os.environ.get(
        "AGENT_WALLET_DIR",
        os.path.join("~", ".agent-wallet"),
    )
)


# --- Helpers ---


def _expand_dir(value: str) -> str:
    """Typer callback: expand ``~`` in --dir values."""
    return os.path.expanduser(value)


def _dir_option(help: str = "Secrets directory path") -> str:
    """Reusable --dir / -d option with tilde expansion."""
    return typer.Option(DEFAULT_DIR, "--dir", "-d", help=help, callback=_expand_dir)


def _password_option():
    """Reusable --password / -p option."""
    return typer.Option(None, "--password", "-p", help="Master password (skip prompt)")


def _validate_password_strength(password: str) -> list[str]:
    """Return list of unmet password requirements."""
    import re

    errors: list[str] = []
    if len(password) < 8:
        errors.append("at least 8 characters")
    if not re.search(r"[A-Z]", password):
        errors.append("at least 1 uppercase letter")
    if not re.search(r"[a-z]", password):
        errors.append("at least 1 lowercase letter")
    if not re.search(r"[0-9]", password):
        errors.append("at least 1 digit")
    if not re.search(r"[^A-Za-z0-9]", password):
        errors.append("at least 1 special character")
    return errors


def _format_password_error(errors: list[str]) -> str:
    return f"[red]Password too weak. Requirements: {', '.join(errors)}.[/red]\n  Example of a strong password: MyWallet#2024"


def _get_password(*, confirm: bool = False, explicit: str | None = None) -> str:
    """Get password from explicit flag, env var, or interactive prompt."""
    # Priority: explicit -p flag > AGENT_WALLET_PASSWORD env > interactive prompt
    pw = explicit or os.environ.get("AGENT_WALLET_PASSWORD")
    if pw:
        if confirm:
            errors = _validate_password_strength(pw)
            if errors:
                console.print(_format_password_error(errors))
                raise typer.Exit(1)
        return pw
    pw = Prompt.ask("[bold]Master password[/bold]", password=True)
    if confirm:
        errors = _validate_password_strength(pw)
        if errors:
            console.print(_format_password_error(errors))
            raise typer.Exit(1)
        pw2 = Prompt.ask("[bold]Confirm password[/bold]", password=True)
        if pw != pw2:
            console.print("[red]Passwords do not match.[/red]")
            raise typer.Exit(1)
    return pw


def _generate_password() -> str:
    """Generate a strong random password (16 chars)."""
    upper = string.ascii_uppercase
    lower = string.ascii_lowercase
    digits = string.digits
    special = "!@#$%^&*"

    chars: list[str] = []
    for charset, count in [(upper, 3), (lower, 3), (digits, 3), (special, 3)]:
        chars.extend(secrets.choice(charset) for _ in range(count))
    all_chars = upper + lower + digits + special
    chars.extend(secrets.choice(all_chars) for _ in range(4))

    # Fisher-Yates shuffle
    for i in range(len(chars) - 1, 0, -1):
        j = secrets.randbelow(i + 1)
        chars[i], chars[j] = chars[j], chars[i]
    return "".join(chars)


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


def _print_wallet_table(rows: list[tuple[str, str, str]]) -> None:
    """Print a table of wallets (Wallet ID, Type, Address)."""
    from rich.box import SQUARE

    table = Table(show_header=True, box=SQUARE, padding=(0, 1))
    table.add_column("Wallet ID", style="cyan")
    table.add_column("Type", style="green")
    table.add_column("Address", style="dim")
    for wid, wtype, addr in rows:
        table.add_row(wid, wtype, addr)
    console.print(table)


_START_TYPE_MAP: dict[str, WalletType] = {
    "tron": WalletType.TRON_LOCAL,
    "evm": WalletType.EVM_LOCAL,
    "tron_local": WalletType.TRON_LOCAL,
    "evm_local": WalletType.EVM_LOCAL,
}


# --- Commands ---


@app.command()
def start(
    dir: str = _dir_option(),
    password: Optional[str] = _password_option(),
    import_type: Optional[str] = typer.Option(None, "--import", "-i", help="Import wallet type (tron or evm)"),
) -> None:
    """Quick setup: initialize and create default wallets."""
    secrets_path = Path(dir)
    auto_generated = False

    if (secrets_path / "master.json").exists():
        # Already initialized — need existing password
        pw = _get_password(explicit=password)
        kv_store = SecureKVStore(dir, pw)
        try:
            kv_store.verify_password()
        except DecryptionError:
            console.print("[red]❌ Wrong password. Please try again.[/red]")
            raise typer.Exit(1)
        config = _load_config_safe(dir)
        console.print("\n🔐 Wallet already initialized.")
    else:
        # Fresh init
        if password:
            errors = _validate_password_strength(password)
            if errors:
                console.print(_format_password_error(errors))
                raise typer.Exit(1)
            pw = password
        else:
            pw = _generate_password()
            auto_generated = True

        secrets_path.mkdir(parents=True, exist_ok=True)
        os.chmod(secrets_path, stat.S_IRWXU)
        kv_store = SecureKVStore(dir, pw)
        kv_store.init_master()
        config = WalletsTopology(wallets={})
        save_config(dir, config)
        console.print("\n🔐 Wallet initialized!")

    if import_type:
        # Import mode: single wallet
        wallet_type = _START_TYPE_MAP.get(import_type)
        if not wallet_type:
            console.print(f"[red]Unknown wallet type: {import_type}. Use: tron, evm, tron_local, evm_local[/red]")
            raise typer.Exit(1)
        name = "default_tron" if wallet_type == WalletType.TRON_LOCAL else "default_evm"

        if name in config.wallets:
            # Already exists — just show info
            conf = config.wallets[name]
            console.print("\n🪙 Wallet already exists:")
            _print_wallet_table([(name, conf.type.value, conf.address or "")])
        else:
            key_hex = Prompt.ask("[bold]Paste private key (hex)[/bold]", password=True)
            key_hex = key_hex.strip().removeprefix("0x")
            try:
                private_key = bytes.fromhex(key_hex)
            except ValueError:
                console.print("[red]Invalid hex string.[/red]")
                raise typer.Exit(1)
            if len(private_key) != 32:
                console.print("[red]Invalid private key length. Expected 32 bytes.[/red]")
                raise typer.Exit(1)
            kv_store.save_private_key(name, private_key)

            address = _derive_address(wallet_type, private_key)
            config.wallets[name] = WalletConfig.model_validate(
                {"type": wallet_type.value, "identity_file": name, "address": address}
            )
            if not config.active_wallet:
                config.active_wallet = name
            save_config(dir, config)

            console.print("\n🪙 Imported wallet:")
            _print_wallet_table([(name, wallet_type.value, address)])
    else:
        # Default mode: create missing wallets
        rows: list[tuple[str, str, str]] = []
        changed = False

        if "default_tron" in config.wallets:
            c = config.wallets["default_tron"]
            rows.append(("default_tron", c.type.value, c.address or ""))
        else:
            tron_key = kv_store.generate_key("default_tron")
            tron_addr = _derive_address(WalletType.TRON_LOCAL, tron_key)
            config.wallets["default_tron"] = WalletConfig.model_validate(
                {"type": WalletType.TRON_LOCAL.value, "identity_file": "default_tron", "address": tron_addr}
            )
            rows.append(("default_tron", WalletType.TRON_LOCAL.value, tron_addr))
            changed = True

        if "default_evm" in config.wallets:
            c = config.wallets["default_evm"]
            rows.append(("default_evm", c.type.value, c.address or ""))
        else:
            evm_key = kv_store.generate_key("default_evm")
            evm_addr = _derive_address(WalletType.EVM_LOCAL, evm_key)
            config.wallets["default_evm"] = WalletConfig.model_validate(
                {"type": WalletType.EVM_LOCAL.value, "identity_file": "default_evm", "address": evm_addr}
            )
            rows.append(("default_evm", WalletType.EVM_LOCAL.value, evm_addr))
            changed = True

        if not config.active_wallet:
            config.active_wallet = "default_tron"
        if changed:
            save_config(dir, config)

        console.print("\n🪙 Wallets:")
        _print_wallet_table(rows)

    console.print(f"\n⭐ Active wallet: {config.active_wallet}")

    if auto_generated:
        console.print(f"\n🔑 Your master password: {pw}")
        console.print("   ⚠️  Save this password! You'll need it for signing and other operations.")

    console.print("\n💡 Quick guide:")
    console.print("   agent-wallet list              — View your wallets")
    console.print("   agent-wallet sign tx '{...}'   — Sign a transaction")
    console.print("   agent-wallet start -h          — See all options")
    console.print("")


@app.command()
def init(
    dir: str = _dir_option(),
    password: Optional[str] = _password_option(),
) -> None:
    """Initialize secrets directory and set master password."""
    secrets_path = Path(dir)

    if (secrets_path / "master.json").exists():
        console.print(f"[yellow]Already initialized:[/yellow] {secrets_path}")
        raise typer.Exit(1)

    secrets_path.mkdir(parents=True, exist_ok=True)
    os.chmod(secrets_path, stat.S_IRWXU)  # 700

    pw = _get_password(confirm=True, explicit=password)

    kv_store = SecureKVStore(dir, pw)
    kv_store.init_master()

    # Create empty wallets config
    save_config(dir, WalletsTopology(wallets={}))

    console.print(f"[green]Initialized.[/green] Secrets directory: {secrets_path}")


@app.command()
def add(
    dir: str = _dir_option(),
    password: Optional[str] = _password_option(),
) -> None:
    """Add a new wallet (interactive)."""
    pw = _get_password(explicit=password)
    kv_store = SecureKVStore(dir, pw)
    try:
        kv_store.verify_password()
    except DecryptionError:
        console.print("[red]❌ Wrong password. Please try again.[/red]")
        raise typer.Exit(1)
    except FileNotFoundError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)

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

    else:
        console.print(f"[yellow]Wallet type '{wallet_type}' is not yet fully supported.[/yellow]")
        raise typer.Exit(1)

    # Auto-set as active if no active wallet exists
    if not config.active_wallet:
        config.active_wallet = name

    # Update config
    config.wallets[name] = WalletConfig.model_validate(wallet_conf)
    save_config(dir, config)
    console.print(f"[green]Wallet '{name}' added.[/green] Config updated.")
    if config.active_wallet == name:
        console.print(f"  Active wallet set to '{name}'.")


@app.command("list")
def list_wallets(
    dir: str = _dir_option(),
) -> None:
    """List all configured wallets."""
    config = _load_config_safe(dir)

    if not config.wallets:
        console.print("[dim]No wallets configured.[/dim]")
        return

    from rich.box import SQUARE

    table = Table(title="Wallets", box=SQUARE)
    table.add_column("", style="bold yellow", width=2)
    table.add_column("Wallet ID", style="cyan")
    table.add_column("Type", style="green")
    table.add_column("Address", style="dim")

    for wid, conf in config.wallets.items():
        marker = "*" if wid == config.active_wallet else ""
        table.add_row(marker, wid, conf.type.value, conf.address or "—")

    console.print(table)


@app.command()
def inspect(
    wallet_id: str = typer.Argument(help="Wallet ID to inspect"),
    dir: str = _dir_option(),
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
    table.add_row("Address", conf.address or "—")
    table.add_row("Identity", f"id_{conf.identity_file}.json {id_status}" if conf.identity_file else "—")
    table.add_row("Credential", f"cred_{conf.cred_file}.json {cred_status}" if conf.cred_file else "—")

    console.print(table)


@app.command()
def remove(
    wallet_id: str = typer.Argument(help="Wallet ID to remove"),
    dir: str = _dir_option(),
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

    if config.active_wallet == wallet_id:
        config.active_wallet = None

    del config.wallets[wallet_id]
    save_config(dir, config)
    console.print(f"[green]Wallet '{wallet_id}' removed.[/green]")


@app.command()
def use(
    wallet_id: str = typer.Argument(help="Wallet ID to set as active"),
    dir: str = _dir_option(),
) -> None:
    """Set the active wallet."""
    config = _load_config_safe(dir)
    if wallet_id not in config.wallets:
        console.print(f"[red]Wallet '{wallet_id}' not found.[/red]")
        raise typer.Exit(1)

    config.active_wallet = wallet_id
    save_config(dir, config)
    console.print(f"Active wallet: {wallet_id} ({config.wallets[wallet_id].type.value})")


def _resolve_wallet_id(explicit: Optional[str], dir: str) -> str:
    """Resolve wallet ID from explicit flag, active wallet, or error."""
    if explicit:
        return explicit
    try:
        config = load_config(dir)
    except FileNotFoundError:
        console.print("[red]Wallet not initialized. Run 'agent-wallet init' first.[/red]")
        raise typer.Exit(1)
    if config.active_wallet:
        return config.active_wallet
    console.print("[red]No wallet specified and no active wallet set. Use '--wallet <id>' or 'agent-wallet use <id>'.[/red]")
    raise typer.Exit(1)


# --- Sign subcommands ---


@sign_app.command("tx")
def sign_tx(
    payload: str = typer.Argument(help="Transaction payload (JSON)"),
    wallet: Optional[str] = typer.Option(None, "--wallet", "-w", help="Wallet ID"),
    password: Optional[str] = _password_option(),
    dir: str = _dir_option(),
) -> None:
    """Sign a transaction."""
    wallet_id = _resolve_wallet_id(wallet, dir)
    pw = _get_password(explicit=password)

    from agent_wallet.core.provider import WalletFactory

    try:
        provider = WalletFactory(secrets_dir=dir, password=pw)
        w = asyncio.run(provider.get_wallet(wallet_id))
        tx_data = json.loads(payload)
        signed = asyncio.run(w.sign_transaction(tx_data))
        # Pretty-print if JSON, otherwise print as-is
        try:
            parsed = json.loads(signed)
            console.print("[green]Signed tx:[/green]")
            console.print_json(json.dumps(parsed))
        except (json.JSONDecodeError, TypeError):
            console.print(f"[green]Signed tx:[/green] {signed}")
    except DecryptionError:
        console.print("[red]❌ Wrong password. Please try again.[/red]")
        raise typer.Exit(1)
    except (WalletError, json.JSONDecodeError) as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)


@sign_app.command("msg")
def sign_msg(
    message: str = typer.Argument(help="Message to sign"),
    wallet: Optional[str] = typer.Option(None, "--wallet", "-w", help="Wallet ID"),
    password: Optional[str] = _password_option(),
    dir: str = _dir_option(),
) -> None:
    """Sign a message."""
    wallet_id = _resolve_wallet_id(wallet, dir)
    pw = _get_password(explicit=password)

    from agent_wallet.core.provider import WalletFactory

    try:
        provider = WalletFactory(secrets_dir=dir, password=pw)
        w = asyncio.run(provider.get_wallet(wallet_id))
        signature = asyncio.run(w.sign_message(message.encode()))
        console.print(f"[green]Signature:[/green] {signature}")
    except DecryptionError:
        console.print("[red]❌ Wrong password. Please try again.[/red]")
        raise typer.Exit(1)
    except WalletError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)


@sign_app.command("typed-data")
def sign_typed_data(
    data: str = typer.Argument(help="EIP-712 typed data (JSON)"),
    wallet: Optional[str] = typer.Option(None, "--wallet", "-w", help="Wallet ID"),
    password: Optional[str] = _password_option(),
    dir: str = _dir_option(),
) -> None:
    """Sign EIP-712 typed data."""
    wallet_id = _resolve_wallet_id(wallet, dir)
    pw = _get_password(explicit=password)

    from agent_wallet.core.provider import WalletFactory

    try:
        provider = WalletFactory(secrets_dir=dir, password=pw)
        w = asyncio.run(provider.get_wallet(wallet_id))
        if not isinstance(w, Eip712Capable):
            console.print("[red]This wallet does not support EIP-712 signing.[/red]")
            raise typer.Exit(1)
        typed_data = json.loads(data)
        signature = asyncio.run(w.sign_typed_data(typed_data))
        console.print(f"[green]Signature:[/green] {signature}")
    except DecryptionError:
        console.print("[red]❌ Wrong password. Please try again.[/red]")
        raise typer.Exit(1)
    except (WalletError, json.JSONDecodeError) as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)


@app.command("change-password")
def change_password(
    dir: str = _dir_option(),
    password: Optional[str] = _password_option(),
) -> None:
    """Change master password and re-encrypt all files."""
    old_pw = password or os.environ.get("AGENT_WALLET_PASSWORD") or Prompt.ask("[bold]Current password[/bold]", password=True)

    # Verify old password
    kv_store_old = SecureKVStore(dir, old_pw)
    try:
        kv_store_old.verify_password()
    except DecryptionError:
        console.print("[red]❌ Wrong password. Please try again.[/red]")
        raise typer.Exit(1)
    except FileNotFoundError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)

    new_pw = Prompt.ask("[bold]New password[/bold]", password=True)
    errors = _validate_password_strength(new_pw)
    if errors:
        console.print(_format_password_error(errors))
        raise typer.Exit(1)
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
def reset(
    dir: str = _dir_option(),
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation"),
) -> None:
    """Delete all wallet data (master key, wallets, credentials)."""
    secrets_path = Path(dir)
    if not (secrets_path / "master.json").exists():
        console.print("[yellow]⚠️  No wallet data found in:[/yellow] " + dir)
        raise typer.Exit(1)

    files = [f for f in secrets_path.iterdir() if f.suffix == ".json"]
    console.print(f"[yellow]⚠️  This will delete ALL wallet data in:[/yellow] {dir}")
    console.print(f"   {len(files)} file(s): {', '.join(f.name for f in files)}")
    console.print()

    if not yes:
        if not Confirm.ask("Are you sure you want to reset? This cannot be undone", default=False):
            console.print("[dim]Cancelled.[/dim]")
            raise typer.Exit(0)
        if not Confirm.ask("Really delete everything? Last chance!", default=False):
            console.print("[dim]Cancelled.[/dim]")
            raise typer.Exit(0)

    for f in files:
        f.unlink()
        console.print(f"  🗑️  Deleted: [dim]{f.name}[/dim]")
    console.print()
    console.print("[green]✅ Wallet data reset complete.[/green]")



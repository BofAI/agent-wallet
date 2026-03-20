"""AgentWallet CLI — key management and signing operations."""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import stat
import string
import sys
from pathlib import Path

import typer
from pydantic import ValidationError
from rich.console import Console
from rich.prompt import Confirm, Prompt
from rich.table import Table

from agent_wallet.core.base import Eip712Capable, WalletType
from agent_wallet.core.config import (
    LocalSecureWalletConfig,
    RawSecretMnemonicConfig,
    RawSecretPrivateKeyConfig,
    RawSecretWalletConfig,
)
from agent_wallet.core.constants import RUNTIME_SECRETS_FILENAME, WALLETS_CONFIG_FILENAME
from agent_wallet.core.errors import (
    DecryptionError,
    UnsupportedOperationError,
    WalletError,
    WalletNotFoundError,
)
from agent_wallet.core.providers.config_provider import ConfigWalletProvider
from agent_wallet.core.providers.wallet_builder import (
    decode_private_key,
    derive_key_from_mnemonic,
    parse_network_family,
)
from agent_wallet.local.kv_store import SecureKVStore
from agent_wallet.local.secret_loader import load_local_secret


def _interactive_select(
    prompt_text: str,
    choices: list[str],
    descriptions: dict[str, str] | None = None,
) -> str | None:
    """Try questionary arrow-key select; return None if unavailable."""
    if not sys.stdin.isatty():
        return None
    try:
        import questionary

        if descriptions:
            from questionary import Choice

            q_choices = [
                Choice(title=f"{c}  — {descriptions[c]}", value=c)
                if c in descriptions
                else Choice(title=c, value=c)
                for c in choices
            ]
            return questionary.select(prompt_text, choices=q_choices).unsafe_ask()
        return questionary.select(prompt_text, choices=choices).unsafe_ask()
    except (ImportError, EOFError, OSError, ValueError):
        return None


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


def _derive_as_option():
    """Reusable mnemonic derivation profile option."""
    return typer.Option(
        None,
        "--derive-as",
        help="Mnemonic derivation profile: eip155 or tron",
    )


def _save_runtime_secrets_option():
    """Reusable flag for persisting password to runtime secrets."""
    return typer.Option(
        False,
        "--save-runtime-secrets",
        help="Persist the password to runtime secrets when this command uses one",
    )


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


def _require_interactive(action: str) -> None:
    if sys.stdin.isatty():
        return
    console.print(
        f"[red]Cannot prompt for {action} in a non-interactive environment. "
        "Pass the required flags explicitly.[/red]"
    )
    raise typer.Exit(1)


def _prompt_password_value(label: str) -> str:
    _require_interactive(label.lower())
    value = Prompt.ask(f"[bold]{label}[/bold]", password=True)
    if not value:
        console.print("[red]Password cannot be empty.[/red]")
        raise typer.Exit(1)
    return value


def _get_password(
    *,
    provider: ConfigWalletProvider | None = None,
    confirm: bool = False,
    explicit: str | None = None,
    prompt_if_missing: bool = True,
) -> str | None:
    """Get password from explicit flag, runtime secrets, env var, or interactive prompt."""
    pw = explicit
    if not pw and provider is not None:
        try:
            pw = provider.load_runtime_secrets_password()
        except ValueError as exc:
            console.print(f"[red]Invalid runtime secrets: {exc}[/red]")
            raise typer.Exit(1) from exc
    if not pw:
        pw = os.environ.get("AGENT_WALLET_PASSWORD")
    if pw:
        if confirm:
            errors = _validate_password_strength(pw)
            if errors:
                console.print(_format_password_error(errors))
                raise typer.Exit(1)
        return pw
    if not prompt_if_missing:
        return None
    label = "Master password (min 8 chars, upper+lower+digit+special)" if confirm else "Master password"
    pw = _prompt_password_value(label)
    if confirm:
        errors = _validate_password_strength(pw)
        if errors:
            console.print(_format_password_error(errors))
            raise typer.Exit(1)
        pw2 = _prompt_password_value("Confirm password")
        if pw != pw2:
            console.print("[red]Passwords do not match.[/red]")
            raise typer.Exit(1)
    return pw


def _maybe_save_runtime_secrets(
    provider: ConfigWalletProvider,
    password: str | None,
    save_runtime_secrets: bool,
) -> None:
    """Persist password to runtime secrets when explicitly requested."""
    if not password:
        return
    if not save_runtime_secrets:
        return
    provider.save_runtime_secrets(password)


def _maybe_update_runtime_secrets_after_password_change(
    provider: ConfigWalletProvider,
    password: str,
    save_runtime_secrets: bool,
) -> None:
    if save_runtime_secrets or provider.has_runtime_secrets():
        provider.save_runtime_secrets(password)


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


def _print_wallet_table(rows: list[tuple[str, str]]) -> None:
    """Print a table of wallets (Wallet ID, Type)."""
    from rich.box import SQUARE

    table = Table(show_header=True, box=SQUARE, padding=(0, 1))
    table.add_column("Wallet ID", style="cyan")
    table.add_column("Type", style="green")
    for wid, wtype in rows:
        table.add_row(wid, wtype)
    console.print(table)


def _managed_json_files(secrets_path: Path) -> list[Path]:
    """Return agent-wallet managed JSON files inside the secrets directory."""
    files: list[Path] = []
    for filename in ("master.json", WALLETS_CONFIG_FILENAME, RUNTIME_SECRETS_FILENAME):
        path = secrets_path / filename
        if path.exists():
            files.append(path)
    files.extend(sorted(secrets_path.glob("secret_*.json")))
    return files


async def _sign_transaction_with_provider(
    provider: ConfigWalletProvider,
    wallet_id: str,
    network: str,
    tx_data: dict,
) -> str:
    wallet = await provider.get_wallet(wallet_id, network)
    return await wallet.sign_transaction(tx_data)


async def _sign_message_with_provider(
    provider: ConfigWalletProvider,
    wallet_id: str,
    network: str,
    message: bytes,
) -> str:
    wallet = await provider.get_wallet(wallet_id, network)
    return await wallet.sign_message(message)


async def _sign_typed_data_with_provider(
    provider: ConfigWalletProvider,
    wallet_id: str,
    network: str,
    typed_data: dict,
) -> str:
    wallet = await provider.get_wallet(wallet_id, network)
    if not isinstance(wallet, Eip712Capable):
        raise UnsupportedOperationError(
            "This wallet does not support EIP-712 signing."
        )
    return await wallet.sign_typed_data(typed_data)


def _get_provider(dir: str, pw: str | None = None):
    """Create a ConfigWalletProvider for the given dir."""
    try:
        return ConfigWalletProvider(dir, password=pw, secret_loader=load_local_secret)
    except (ValidationError, ValueError) as exc:
        console.print(
            f"[red]Invalid wallet config in {Path(dir) / WALLETS_CONFIG_FILENAME}: {exc}[/red]"
        )
        console.print(
            "[red]This wallet directory appears to use an unsupported or stale schema. "
            "Reset it or replace wallets_config.json with the current format.[/red]"
        )
        raise typer.Exit(1) from exc


def _select_start_type(explicit: str | None) -> WalletType:
    """Resolve quick-start type from argument or interactive prompt."""
    if explicit is not None:
        try:
            wtype = WalletType(explicit)
        except ValueError:
            console.print(
                f"[red]Unknown wallet type: {explicit}. Use: {', '.join(t.value for t in WalletType)}[/red]"
            )
            raise typer.Exit(1)
        return wtype

    choices = [t.value for t in WalletType]
    descriptions = {
        "local_secure": "Encrypted key stored locally (recommended)",
        "raw_secret": "Private key/mnemonic saved in plaintext config",
    }
    selected = _interactive_select("Quick start type:", choices, descriptions)
    if selected is None:
        selected = Prompt.ask("[bold]Quick start type[/bold]", choices=choices)
    return WalletType(selected)


def _select_import_source(
    *,
    generate: bool,
    private_key: str | None,
    mnemonic: str | None,
    allow_generate: bool,
) -> str:
    """Resolve import source from explicit flags or interactive prompt."""
    selected_count = sum(bool(value) for value in (generate, private_key, mnemonic))
    if selected_count > 1:
        console.print(
            "[red]Use only one of --generate, --private-key or --mnemonic.[/red]"
        )
        raise typer.Exit(1)

    if generate:
        if not allow_generate:
            console.print("[red]--generate is only valid for local_secure wallets.[/red]")
            raise typer.Exit(1)
        return "generate"
    if private_key:
        return "private_key"
    if mnemonic:
        return "mnemonic"

    choices = ["private_key", "mnemonic"]
    if allow_generate:
        choices.insert(0, "generate")

    descriptions = {
        "generate": "Generate a new random private key",
        "private_key": "Import an existing hex private key",
        "mnemonic": "Derive from a BIP-39 mnemonic phrase",
    }
    selected = _interactive_select("Import source:", choices, descriptions)
    if selected is None:
        selected = Prompt.ask("[bold]Import source[/bold]", choices=choices, default=choices[0])
    return selected


def _prompt_derivation_profile() -> str:
    """Prompt for mnemonic derivation profile."""
    _require_interactive("mnemonic derivation profile")
    choices = ["eip155", "tron"]
    descriptions = {
        "eip155": "EVM chains (Ethereum, BSC, Polygon, etc.)",
        "tron": "TRON network",
    }
    selected = _interactive_select("Derive mnemonic as:", choices, descriptions)
    if selected is None:
        selected = Prompt.ask("[bold]Derive mnemonic as[/bold]", choices=choices, default="eip155")
    return selected


def _resolve_private_key_input(
    *,
    explicit_generate: bool,
    explicit_private_key: str | None,
    explicit_mnemonic: str | None,
    derivation_profile: str | None,
    mnemonic_index: int,
    allow_generate: bool,
) -> bytes | None:
    """Resolve a private key from flags or interactive prompts."""
    if mnemonic_index and not explicit_mnemonic:
        console.print("[red]--mnemonic-index requires --mnemonic.[/red]")
        raise typer.Exit(1)

    source = _select_import_source(
        generate=explicit_generate,
        private_key=explicit_private_key,
        mnemonic=explicit_mnemonic,
        allow_generate=allow_generate,
    )
    if source == "generate":
        return None

    if source == "private_key":
        key_hex = explicit_private_key
        if key_hex is None:
            key_hex = Prompt.ask("[bold]Paste private key (hex)[/bold]", password=True)
        try:
            return decode_private_key(key_hex)
        except ValueError as exc:
            console.print(f"[red]{exc}[/red]")
            raise typer.Exit(1) from exc

    mnemonic = explicit_mnemonic
    if mnemonic is None:
        mnemonic = Prompt.ask("[bold]Paste mnemonic phrase[/bold]", password=True)
        index_value = Prompt.ask("[bold]Account index[/bold] (0 = first account)", default=str(mnemonic_index))
        try:
            mnemonic_index = int(index_value)
        except ValueError:
            console.print("[red]Invalid account index.[/red]")
            raise typer.Exit(1)

    network = parse_network_family(derivation_profile or _prompt_derivation_profile())
    return derive_key_from_mnemonic(network, mnemonic.strip(), mnemonic_index)


def _build_raw_secret_config(
    *,
    explicit_private_key: str | None,
    explicit_mnemonic: str | None,
    mnemonic_index: int,
) -> RawSecretWalletConfig:
    """Resolve and build a raw_secret config from flags or interactive input."""
    source = _select_import_source(
        generate=False,
        private_key=explicit_private_key,
        mnemonic=explicit_mnemonic,
        allow_generate=False,
    )

    if source == "private_key":
        key_hex = explicit_private_key
        if key_hex is None:
            key_hex = Prompt.ask("[bold]Paste private key (hex)[/bold]", password=True)
        try:
            normalized = "0x" + decode_private_key(key_hex).hex()
        except ValueError as exc:
            console.print(f"[red]{exc}[/red]")
            raise typer.Exit(1) from exc
        return RawSecretWalletConfig(
            type="raw_secret",
            material=RawSecretPrivateKeyConfig(
                source="private_key",
                private_key=normalized,
            ),
        )

    source_mnemonic = explicit_mnemonic
    if source_mnemonic is None:
        source_mnemonic = Prompt.ask("[bold]Paste mnemonic phrase[/bold]", password=True)
        index_value = Prompt.ask("[bold]Account index[/bold] (0 = first account)", default=str(mnemonic_index))
        try:
            mnemonic_index = int(index_value)
        except ValueError:
            console.print("[red]Invalid account index.[/red]")
            raise typer.Exit(1)

    return RawSecretWalletConfig(
        type="raw_secret",
        material=RawSecretMnemonicConfig(
            source="mnemonic",
            mnemonic=source_mnemonic.strip(),
            account_index=mnemonic_index,
        ),
    )


def _prompt_wallet_id(default: str) -> str:
    """Prompt for a wallet id with an interactive default."""
    return Prompt.ask("[bold]Wallet ID[/bold] (e.g. my_wallet_1)", default=default)


# --- Commands ---


@app.command()
def start(
    wallet_type: str | None = typer.Argument(None, help="Quick-start type: local_secure or raw_secret"),
    wallet_id: str | None = typer.Option(None, "--wallet-id", "-w", help="Wallet ID"),
    generate: bool = typer.Option(False, "--generate", "-g", help="Generate a new private key"),
    private_key: str | None = typer.Option(None, "--private-key", "-k", help="Import from private key"),
    mnemonic: str | None = typer.Option(None, "--mnemonic", "-m", help="Import from mnemonic"),
    derive_as: str | None = _derive_as_option(),
    mnemonic_index: int = typer.Option(0, "--mnemonic-index", "-mi", help="Mnemonic account index"),
    dir: str = _dir_option(),
    password: str | None = _password_option(),
    save_runtime_secrets: bool = _save_runtime_secrets_option(),
) -> None:
    """Quick setup: initialize and create default wallets."""
    wtype = _select_start_type(wallet_type)
    provider: ConfigWalletProvider | None = None

    secrets_path = Path(dir)
    auto_generated = False

    if wtype == WalletType.LOCAL_SECURE:
        target_name = wallet_id or _prompt_wallet_id("default")
        provider = _get_provider(dir)
        # Local secure mode: needs password and master key
        if (secrets_path / "master.json").exists():
            pw = _get_password(provider=provider, explicit=password)
            kv_store = SecureKVStore(dir, pw)
            try:
                kv_store.verify_password()
            except DecryptionError:
                console.print("[red]Wrong password. Please try again.[/red]")
                raise typer.Exit(1)
            console.print("\nWallet already initialized.")
        else:
            explicit_pw = password or os.environ.get("AGENT_WALLET_PASSWORD")
            if explicit_pw:
                errors = _validate_password_strength(explicit_pw)
                if errors:
                    console.print(_format_password_error(errors))
                    raise typer.Exit(1)
                pw = explicit_pw
            else:
                pw = _generate_password()
                auto_generated = True

            secrets_path.mkdir(parents=True, exist_ok=True)
            os.chmod(secrets_path, stat.S_IRWXU)
            kv_store = SecureKVStore(dir, pw)
            kv_store.init_master()
            provider.ensure_storage()
            console.print("\nWallet initialized!")
        _maybe_save_runtime_secrets(provider, pw, save_runtime_secrets)

        secret = _resolve_private_key_input(
            explicit_generate=generate,
            explicit_private_key=private_key,
            explicit_mnemonic=mnemonic,
            derivation_profile=derive_as,
            mnemonic_index=mnemonic_index,
            allow_generate=True,
        )

        rows: list[tuple[str, str]] = []

        try:
            c = provider.get_wallet_config(target_name)
            rows.append((target_name, c.type))
        except WalletNotFoundError:
            if secret is None:
                kv_store.generate_secret(target_name)
            else:
                kv_store.save_secret(target_name, secret)
            provider.add_wallet(
                target_name,
                LocalSecureWalletConfig(
                    type="local_secure",
                    secret_ref=target_name,
                ),
            )
            provider.set_active(target_name)
            rows.append((target_name, "local_secure"))

        console.print("\nWallets:")
        _print_wallet_table(rows)

        if auto_generated:
            console.print(f"\nYour master password: {pw}")
            console.print("   Save this password! You'll need it for signing and other operations.")

    elif wtype == WalletType.RAW_SECRET:
        if password:
            console.print("[red]--password is only valid for local_secure quick start.[/red]")
            raise typer.Exit(1)
        console.print("[yellow]Warning: Raw secret material will be stored in plaintext in wallets_config.json.[/yellow]")
        target_name = wallet_id or _prompt_wallet_id("raw_wallet")
        raw_secret_config = _build_raw_secret_config(
            explicit_private_key=private_key,
            explicit_mnemonic=mnemonic,
            mnemonic_index=mnemonic_index,
        )

        provider = _get_provider(dir)
        try:
            provider.add_wallet(target_name, raw_secret_config)
            provider.set_active(target_name)
        except ValueError as exc:
            console.print(f"[red]{exc}[/red]")
            raise typer.Exit(1) from exc

        console.print(f"\nWallet '{target_name}' created:")
        _print_wallet_table([(target_name, "raw_secret")])
    else:
        console.print(f"[red]Unsupported quick-start type: {wtype.value}[/red]")
        raise typer.Exit(1)

    assert provider is not None
    console.print(f"\nActive wallet: {provider.get_active_id()}")
    console.print("\nQuick guide:")
    console.print("   agent-wallet list              -- View your wallets")
    console.print("   agent-wallet sign tx '{...}'   -- Sign a transaction")
    console.print("   agent-wallet start -h          -- See all options")
    console.print("")


@app.command()
def init(
    dir: str = _dir_option(),
    password: str | None = _password_option(),
    save_runtime_secrets: bool = _save_runtime_secrets_option(),
) -> None:
    """Initialize secrets directory and set master password."""
    secrets_path = Path(dir)

    if (secrets_path / "master.json").exists():
        console.print(f"[yellow]Already initialized:[/yellow] {secrets_path}")
        raise typer.Exit(1)

    secrets_path.mkdir(parents=True, exist_ok=True)
    os.chmod(secrets_path, stat.S_IRWXU)  # 700

    provider = _get_provider(dir)
    pw = _get_password(provider=provider, confirm=True, explicit=password)

    kv_store = SecureKVStore(dir, pw)
    kv_store.init_master()

    provider = _get_provider(dir, pw)
    provider.ensure_storage()
    _maybe_save_runtime_secrets(provider, pw, save_runtime_secrets)

    console.print(f"[green]Initialized.[/green] Secrets directory: {secrets_path}")


@app.command()
def add(
    wallet_type: str = typer.Argument(..., help="Wallet type: local_secure or raw_secret"),
    wallet_id: str | None = typer.Option(None, "--wallet-id", "-w", help="Wallet ID"),
    generate: bool = typer.Option(False, "--generate", "-g", help="Generate a new private key"),
    private_key: str | None = typer.Option(None, "--private-key", "-k", help="Import from private key"),
    mnemonic: str | None = typer.Option(None, "--mnemonic", "-m", help="Import from mnemonic"),
    derive_as: str | None = _derive_as_option(),
    mnemonic_index: int = typer.Option(0, "--mnemonic-index", "-mi", help="Mnemonic account index"),
    dir: str = _dir_option(),
    password: str | None = _password_option(),
    save_runtime_secrets: bool = _save_runtime_secrets_option(),
) -> None:
    """Add a new wallet (interactive)."""
    try:
        wtype = WalletType(wallet_type)
    except ValueError:
        console.print(f"[red]Unknown wallet type: {wallet_type}. Use: {', '.join(t.value for t in WalletType)}[/red]")
        raise typer.Exit(1)

    provider = _get_provider(dir)
    if not provider.is_initialized():
        console.print("[red]Wallet not initialized. Run 'agent-wallet start' or 'agent-wallet init' first.[/red]")
        raise typer.Exit(1)

    target_name = wallet_id or _prompt_wallet_id("wallet")
    try:
        provider.get_wallet_config(target_name)
        console.print(f"[red]Wallet '{target_name}' already exists.[/red]")
        raise typer.Exit(1)
    except WalletNotFoundError:
        pass

    if wtype == WalletType.LOCAL_SECURE:
        pw = _get_password(provider=provider, explicit=password)
        secure_provider = _get_provider(dir, pw)
        _maybe_save_runtime_secrets(secure_provider, pw, save_runtime_secrets)
        kv_store = SecureKVStore(dir, pw)
        try:
            kv_store.verify_password()
        except DecryptionError:
            console.print("[red]Wrong password. Please try again.[/red]")
            raise typer.Exit(1)
        except FileNotFoundError as e:
            console.print(f"[red]Error: {e}[/red]")
            raise typer.Exit(1)

        secret = _resolve_private_key_input(
            explicit_generate=generate,
            explicit_private_key=private_key,
            explicit_mnemonic=mnemonic,
            derivation_profile=derive_as,
            mnemonic_index=mnemonic_index,
            allow_generate=True,
        )
        if secret is None:
            kv_store.generate_secret(target_name)
            console.print("[green]Generated new private key.[/green]")
        else:
            kv_store.save_secret(target_name, secret)
            console.print("[green]Imported secret material.[/green]")

        provider.add_wallet(
            target_name,
            LocalSecureWalletConfig(
                type="local_secure",
                secret_ref=target_name,
            ),
        )
        console.print(f"  Saved:   [dim]secret_{target_name}.json[/dim]")

    elif wtype == WalletType.RAW_SECRET:
        if password:
            console.print("[red]--password is only valid for local_secure wallets.[/red]")
            raise typer.Exit(1)
        console.print("[yellow]Warning: Raw secret material will be stored in plaintext in wallets_config.json.[/yellow]")
        provider.add_wallet(
            target_name,
            _build_raw_secret_config(
                explicit_private_key=private_key,
                explicit_mnemonic=mnemonic,
                mnemonic_index=mnemonic_index,
            ),
        )
    console.print(f"[green]Wallet '{target_name}' added.[/green] Config updated.")
    if provider.get_active_id() == target_name:
        console.print(f"  Active wallet set to '{target_name}'.")


@app.command("list")
def list_wallets(
    dir: str = _dir_option(),
) -> None:
    """List all configured wallets."""
    provider = _get_provider(dir)
    rows = provider.list_wallets()
    if not rows:
        console.print("[dim]No wallets configured.[/dim]")
        return

    from rich.box import SQUARE

    table = Table(title="Wallets", box=SQUARE)
    table.add_column("", style="bold yellow", width=2)
    table.add_column("Wallet ID", style="cyan")
    table.add_column("Type", style="green")

    for wid, conf, is_active in rows:
        marker = "*" if is_active else ""
        table.add_row(marker, wid, conf.type)

    console.print(table)


@app.command()
def inspect(
    wallet_id: str = typer.Argument(help="Wallet ID to inspect"),
    dir: str = _dir_option(),
) -> None:
    """Show wallet details."""
    provider = _get_provider(dir)
    try:
        conf = provider.get_wallet_config(wallet_id)
    except WalletNotFoundError:
        console.print(f"[red]Wallet '{wallet_id}' not found.[/red]")
        raise typer.Exit(1)

    table = Table(show_header=False, box=None, padding=(0, 2))
    table.add_column("Key", style="bold")
    table.add_column("Value")
    table.add_row("Wallet", wallet_id)
    table.add_row("Type", conf.type)

    if isinstance(conf, LocalSecureWalletConfig):
        secret_status = "ok" if provider.has_secret_file(wallet_id) else "-"
        table.add_row("Secret", f"secret_{conf.secret_ref}.json {secret_status}")
    elif isinstance(conf, RawSecretWalletConfig):
        table.add_row("Source Type", conf.material.source)
        if isinstance(conf.material, RawSecretPrivateKeyConfig):
            table.add_row("Private Key", "[redacted]")
        elif isinstance(conf.material, RawSecretMnemonicConfig):
            table.add_row("Mnemonic", "[redacted]")
            table.add_row("Account Index", str(conf.material.account_index))

    console.print(table)


@app.command()
def remove(
    wallet_id: str = typer.Argument(help="Wallet ID to remove"),
    dir: str = _dir_option(),
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation"),
) -> None:
    """Remove a wallet and its associated files."""
    provider = _get_provider(dir)
    try:
        conf = provider.get_wallet_config(wallet_id)
    except WalletNotFoundError:
        console.print(f"[red]Wallet '{wallet_id}' not found.[/red]")
        raise typer.Exit(1)

    if not yes and not Confirm.ask(f"Remove wallet '{wallet_id}'?", default=False):
        console.print("[dim]Cancelled.[/dim]")
        raise typer.Exit(0)

    if isinstance(conf, LocalSecureWalletConfig) and provider.has_secret_file(wallet_id):
        console.print(f"  Deleted: [dim]secret_{conf.secret_ref}.json[/dim]")
    provider.remove_wallet(wallet_id)
    console.print(f"[green]Wallet '{wallet_id}' removed.[/green]")


@app.command()
def use(
    wallet_id: str = typer.Argument(help="Wallet ID to set as active"),
    dir: str = _dir_option(),
) -> None:
    """Set the active wallet."""
    provider = _get_provider(dir)
    try:
        conf = provider.set_active(wallet_id)
    except WalletNotFoundError:
        console.print(f"[red]Wallet '{wallet_id}' not found.[/red]")
        raise typer.Exit(1)
    console.print(f"Active wallet: {wallet_id} ({conf.type})")


def _needs_password(dir: str, wallet_id: str) -> bool:
    """Check if the given wallet requires a password (i.e. is local_secure)."""
    try:
        provider = _get_provider(dir)
        conf = provider.get_wallet_config(wallet_id)
        return conf.type == "local_secure"
    except (WalletNotFoundError, SystemExit):
        return True  # default to requiring password if we can't determine


def _resolve_wallet_id(explicit: str | None, dir: str) -> str:
    """Resolve wallet ID from explicit flag, active wallet, or error."""
    if explicit:
        return explicit
    provider = _get_provider(dir)
    if not provider.is_initialized():
        console.print(
            "[red]Wallet not initialized. Run 'agent-wallet start' or 'agent-wallet init' first.[/red]"
        )
        raise typer.Exit(1)
    active_id = provider.get_active_id()
    if active_id:
        return active_id
    console.print("[red]No wallet specified and no active wallet set. Use '--wallet-id <id>' or 'agent-wallet use <id>'.[/red]")
    raise typer.Exit(1)


# --- Sign subcommands ---


@sign_app.command("tx")
def sign_tx(
    payload: str = typer.Argument(help="Transaction payload (JSON)"),
    wallet_id: str | None = typer.Option(None, "--wallet-id", "-w", help="Wallet ID"),
    network: str = typer.Option(..., "--network", "-n", help="Target network, e.g. eip155:1 or tron:nile"),
    password: str | None = _password_option(),
    save_runtime_secrets: bool = _save_runtime_secrets_option(),
    dir: str = _dir_option(),
) -> None:
    """Sign a transaction."""
    wallet_id = _resolve_wallet_id(wallet_id, dir)
    pw = _get_password(
        provider=_get_provider(dir),
        explicit=password,
        prompt_if_missing=_needs_password(dir, wallet_id),
    )
    provider = _get_provider(dir, pw)
    _maybe_save_runtime_secrets(provider, pw, save_runtime_secrets)

    try:
        tx_data = json.loads(payload)
        signed = asyncio.run(
            _sign_transaction_with_provider(provider, wallet_id, network, tx_data)
        )
        try:
            parsed = json.loads(signed)
            console.print("[green]Signed tx:[/green]")
            console.print_json(json.dumps(parsed))
        except (json.JSONDecodeError, TypeError):
            console.print(f"[green]Signed tx:[/green] {signed}")
    except DecryptionError:
        console.print("[red]Wrong password. Please try again.[/red]")
        raise typer.Exit(1)
    except ValueError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)
    except (WalletError, json.JSONDecodeError) as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)


@sign_app.command("msg")
def sign_msg(
    message: str = typer.Argument(help="Message to sign"),
    wallet_id: str | None = typer.Option(None, "--wallet-id", "-w", help="Wallet ID"),
    network: str = typer.Option(..., "--network", "-n", help="Target network, e.g. eip155:1 or tron:nile"),
    password: str | None = _password_option(),
    save_runtime_secrets: bool = _save_runtime_secrets_option(),
    dir: str = _dir_option(),
) -> None:
    """Sign a message."""
    wallet_id = _resolve_wallet_id(wallet_id, dir)
    pw = _get_password(
        provider=_get_provider(dir),
        explicit=password,
        prompt_if_missing=_needs_password(dir, wallet_id),
    )
    provider = _get_provider(dir, pw)
    _maybe_save_runtime_secrets(provider, pw, save_runtime_secrets)

    try:
        signature = asyncio.run(
            _sign_message_with_provider(provider, wallet_id, network, message.encode())
        )
        console.print(f"[green]Signature:[/green] {signature}")
    except DecryptionError:
        console.print("[red]Wrong password. Please try again.[/red]")
        raise typer.Exit(1)
    except ValueError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)
    except WalletError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)


@sign_app.command("typed-data")
def sign_typed_data(
    data: str = typer.Argument(help="EIP-712 typed data (JSON)"),
    wallet_id: str | None = typer.Option(None, "--wallet-id", "-w", help="Wallet ID"),
    network: str = typer.Option(..., "--network", "-n", help="Target network, e.g. eip155:1 or tron:nile"),
    password: str | None = _password_option(),
    save_runtime_secrets: bool = _save_runtime_secrets_option(),
    dir: str = _dir_option(),
) -> None:
    """Sign EIP-712 typed data."""
    wallet_id = _resolve_wallet_id(wallet_id, dir)
    pw = _get_password(
        provider=_get_provider(dir),
        explicit=password,
        prompt_if_missing=_needs_password(dir, wallet_id),
    )
    provider = _get_provider(dir, pw)
    _maybe_save_runtime_secrets(provider, pw, save_runtime_secrets)

    try:
        typed_data = json.loads(data)
        signature = asyncio.run(
            _sign_typed_data_with_provider(provider, wallet_id, network, typed_data)
        )
        console.print(f"[green]Signature:[/green] {signature}")
    except DecryptionError:
        console.print("[red]Wrong password. Please try again.[/red]")
        raise typer.Exit(1)
    except ValueError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)
    except (WalletError, json.JSONDecodeError) as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)


@app.command("change-password")
def change_password(
    dir: str = _dir_option(),
    password: str | None = _password_option(),
    save_runtime_secrets: bool = _save_runtime_secrets_option(),
) -> None:
    """Change master password and re-encrypt all files."""
    provider = _get_provider(dir)
    old_pw = _get_password(provider=provider, explicit=password)

    # Verify old password
    kv_store_old = SecureKVStore(dir, old_pw)
    try:
        kv_store_old.verify_password()
    except DecryptionError:
        console.print("[red]Wrong password. Please try again.[/red]")
        raise typer.Exit(1)
    except FileNotFoundError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)

    new_pw = Prompt.ask("[bold]New password[/bold] (min 8 chars, upper+lower+digit+special)", password=True)
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
    console.print("  [green]ok[/green] master.json")
    re_encrypted += 1

    # Re-encrypt all secret_*.json
    for path in sorted(secrets_path.glob("secret_*.json")):
        name = path.stem.removeprefix("secret_")
        secret = kv_store_old.load_secret(name)
        kv_store_new.save_secret(name, secret)
        console.print(f"  [green]ok[/green] {path.name}")
        re_encrypted += 1

    console.print(f"\n[green]Password changed.[/green] Re-encrypted {re_encrypted} files.")
    _maybe_update_runtime_secrets_after_password_change(
        _get_provider(dir, new_pw),
        new_pw,
        save_runtime_secrets,
    )


@app.command()
def reset(
    dir: str = _dir_option(),
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation"),
) -> None:
    """Delete all agent-wallet managed files in the secrets directory."""
    secrets_path = Path(dir)
    if not (secrets_path / "master.json").exists():
        console.print("[yellow]No wallet data found in:[/yellow] " + dir)
        raise typer.Exit(1)

    files = _managed_json_files(secrets_path)
    console.print(f"[yellow]This will delete ALL wallet data in:[/yellow] {dir}")
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
        console.print(f"  Deleted: [dim]{f.name}[/dim]")
    console.print()
    console.print("[green]Wallet data reset complete.[/green]")

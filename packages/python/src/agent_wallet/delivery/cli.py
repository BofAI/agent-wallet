"""AgentWallet CLI — key management and signing operations."""

from __future__ import annotations

import asyncio
import json
import os
import secrets
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
    LocalSecureWalletParams,
    PrivyWalletParams,
    RawSecretMnemonicParams,
    RawSecretPrivateKeyParams,
    WalletConfig,
)
from agent_wallet.core.constants import RUNTIME_SECRETS_FILENAME, WALLETS_CONFIG_FILENAME
from agent_wallet.core.errors import (
    DecryptionError,
    UnsupportedOperationError,
    WalletError,
    WalletNotFoundError,
)
from agent_wallet.core.providers.config_provider import ConfigWalletProvider
from agent_wallet.core.utils import safe_chmod
from agent_wallet.core.utils.keys import decode_private_key, derive_key_from_mnemonic
from agent_wallet.core.utils.network import parse_network_family
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
start_app = typer.Typer(
    help="Quick setup: initialize and create default wallets.",
    invoke_without_command=True,
)
add_app = typer.Typer(
    help="Add a new wallet.",
    invoke_without_command=True,
)
sign_app = typer.Typer(help="Sign transactions or messages.")
app.add_typer(start_app, name="start")
app.add_typer(add_app, name="add")
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


def _privy_app_id_option():
    return typer.Option(None, "--app-id", help="Privy app id")


def _privy_app_secret_option():
    return typer.Option(None, "--app-secret", help="Privy app secret")


def _privy_wallet_id_option():
    return typer.Option(None, "--privy-wallet-id", help="Privy wallet id")


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
    return f"[red]Password too weak. Requirements: {', '.join(errors)}.[/red]\n  Example of a strong password: Abc12345!@"


PASSWORD_REQUIREMENTS_HINT = (
    "Password requirements: at least 8 characters, with uppercase, lowercase, digit, and special character. "
    "e.g. Abc12345!@"
)
NEW_MASTER_PASSWORD_LABEL = "New Master Password"


def _require_interactive(action: str) -> None:
    if sys.stdin.isatty():
        return
    console.print(
        f"[red]Cannot prompt for {action} in a non-interactive environment. "
        "Pass the required flags explicitly.[/red]"
    )
    raise typer.Exit(1)


def _prompt_text(
    label: str,
    *,
    password: bool = False,
    choices: list[str] | None = None,
    default: str | None = None,
    action: str | None = None,
) -> str:
    _require_interactive(action or label.lower())
    value = Prompt.ask(f"[bold]{label}[/bold]", password=password, choices=choices, default=default)
    return value or ""


def _confirm_action(message: str, *, default: bool = False, action: str | None = None) -> bool:
    _require_interactive(action or message.lower())
    return Confirm.ask(message, default=default)


def _prompt_password_value(label: str, *, allow_empty: bool = False) -> str:
    while True:
        value = _prompt_text(label, password=True)
        if value or allow_empty:
            return value
        console.print("[red]Password cannot be empty.[/red]")


def _prompt_new_password(
    *,
    prompt_label: str = NEW_MASTER_PASSWORD_LABEL,
    confirm_label: str = "Confirm New Master Password",
    allow_empty: bool = False,
) -> str:
    while True:
        pw = _prompt_password_value(prompt_label, allow_empty=allow_empty)
        if not pw and allow_empty:
            return pw

        errors = _validate_password_strength(pw)
        if errors:
            console.print(_format_password_error(errors))
            continue

        pw2 = _prompt_password_value(confirm_label)
        if pw != pw2:
            console.print("[red]Passwords do not match.[/red]")
            continue
        return pw


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
    if confirm:
        return _prompt_new_password()
    return _prompt_password_value("Master Password (enter your existing password to unlock)")


def _get_verified_password(
    dir: str,
    *,
    provider: ConfigWalletProvider | None = None,
    explicit: str | None = None,
    prompt_if_missing: bool = True,
) -> tuple[str, SecureKVStore]:
    """Get password, verify it against master.json, and return (pw, kv_store).

    If the password came from -p flag, env, or runtime secrets, fail on wrong password.
    If the password was entered interactively, re-prompt up to 3 times.
    """
    pw = _get_password(
        provider=provider, explicit=explicit, prompt_if_missing=prompt_if_missing,
    )
    if pw is None:
        console.print("[red]Password required for local_secure wallets.[/red]")
        raise typer.Exit(1)

    was_interactive = (
        explicit is None
        and not (provider and provider.load_runtime_secrets_password())
        and not os.environ.get("AGENT_WALLET_PASSWORD")
    )

    kv_store = SecureKVStore(dir, pw)
    try:
        kv_store.verify_password()
        return pw, kv_store
    except DecryptionError:
        if not was_interactive:
            console.print("[red]Wrong password. Please try again.[/red]")
            raise typer.Exit(1)

    # Interactive retry loop
    for _attempt in range(2):  # 2 more attempts (3 total)
        console.print("[red]✖ Wrong password, please try again.[/red]")
        pw = _prompt_password_value("Master Password (enter your existing password to unlock)")
        kv_store = SecureKVStore(dir, pw)
        try:
            kv_store.verify_password()
            return pw, kv_store
        except DecryptionError:
            pass

    console.print("[red]Wrong password. 3 attempts failed.[/red]")
    raise typer.Exit(1)


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
    network: str | None,
    tx_data: dict,
) -> str:
    wallet = await provider.get_wallet(wallet_id, network)
    return await wallet.sign_transaction(tx_data)


async def _sign_message_with_provider(
    provider: ConfigWalletProvider,
    wallet_id: str,
    network: str | None,
    message: bytes,
) -> str:
    wallet = await provider.get_wallet(wallet_id, network)
    return await wallet.sign_message(message)


async def _sign_typed_data_with_provider(
    provider: ConfigWalletProvider,
    wallet_id: str,
    network: str | None,
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


def _select_wallet_type(explicit: str | None, *, prompt_text: str = "Quick start type") -> WalletType:
    """Resolve wallet type from argument or interactive prompt."""
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
        "privy": "Privy API-backed wallet",
    }
    selected = _interactive_select(f"{prompt_text}:", choices, descriptions)
    if selected is None:
        selected = _prompt_text(prompt_text, choices=choices, action=prompt_text.lower())
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
        selected = _prompt_text("Import source", choices=choices, default=choices[0], action="import source")
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
        selected = _prompt_text(
            "Derive mnemonic as",
            choices=choices,
            default="eip155",
            action="mnemonic derivation profile",
        )
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
        try:
            return _prompt_private_key_bytes(explicit_private_key)
        except ValueError as exc:
            console.print(f"[red]{exc}[/red]")
            raise typer.Exit(1) from exc

    network = parse_network_family(derivation_profile or _prompt_derivation_profile())
    while True:
        mnemonic, resolved_index = _prompt_mnemonic_with_index(explicit_mnemonic, mnemonic_index)
        try:
            return derive_key_from_mnemonic(network, mnemonic, resolved_index)
        except ValueError as exc:
            if explicit_mnemonic is not None:
                console.print(f"[red]{exc}[/red]")
                raise typer.Exit(1) from exc
            console.print(f"[red]{exc}[/red]")


def _build_raw_secret_config(
    *,
    explicit_private_key: str | None,
    explicit_mnemonic: str | None,
    derive_as: str | None,
    mnemonic_index: int,
) -> WalletConfig:
    """Resolve and build a raw_secret config from flags or interactive input."""
    source = _select_import_source(
        generate=False,
        private_key=explicit_private_key,
        mnemonic=explicit_mnemonic,
        allow_generate=False,
    )

    if source == "private_key":
        try:
            normalized = "0x" + _prompt_private_key_bytes(explicit_private_key).hex()
        except ValueError as exc:
            console.print(f"[red]{exc}[/red]")
            raise typer.Exit(1) from exc
        return WalletConfig(
            type="raw_secret",
            params=RawSecretPrivateKeyParams(
                source="private_key",
                private_key=normalized,
            ),
        )

    source_mnemonic, mnemonic_index = _prompt_mnemonic_with_index(explicit_mnemonic, mnemonic_index)

    parse_network_family(derive_as or _prompt_derivation_profile())

    return WalletConfig(
        type="raw_secret",
        params=RawSecretMnemonicParams(
            source="mnemonic",
            mnemonic=source_mnemonic.strip(),
            account_index=mnemonic_index,
        ),
    )


def _prompt_required(label: str, *, password: bool = False) -> str:
    while True:
        value = _prompt_text(label, password=password).strip()
        if value:
            return value
        console.print(f"[red]{label} is required.[/red]")


def _prompt_account_index(default: int) -> int:
    while True:
        value = _prompt_text(
            "Account index (0 = first account)",
            default=str(default),
            action="account index",
        )
        try:
            index = int(value)
        except ValueError:
            console.print("[red]Invalid account index.[/red]")
            continue
        if index < 0:
            console.print("[red]Invalid account index.[/red]")
            continue
        return index


def _prompt_private_key_bytes(explicit_private_key: str | None) -> bytes:
    if explicit_private_key is not None:
        return decode_private_key(explicit_private_key)

    while True:
        key_hex = _prompt_text("Paste private key (hex)", password=True, action="private key")
        try:
            return decode_private_key(key_hex)
        except ValueError as exc:
            console.print(f"[red]{exc}[/red]")


def _prompt_mnemonic_with_index(
    explicit_mnemonic: str | None,
    mnemonic_index: int,
) -> tuple[str, int]:
    if explicit_mnemonic is not None:
        return explicit_mnemonic.strip(), mnemonic_index

    while True:
        mnemonic = _prompt_required("Paste mnemonic phrase", password=True)
        return mnemonic, _prompt_account_index(mnemonic_index)


def _build_privy_config(
    provider: ConfigWalletProvider | None = None,
    *,
    explicit_app_id: str | None = None,
    explicit_app_secret: str | None = None,
    explicit_privy_wallet_id: str | None = None,
) -> WalletConfig:
    existing = []
    if provider is not None:
        existing = [
            wallet_id
            for wallet_id, conf, _ in provider.list_wallets()
            if conf.type == "privy"
        ]
    if existing and explicit_app_id is None and explicit_app_secret is None:
        reuse_choice = "Enter new Privy credentials"
        choices = [*existing, reuse_choice]
        selection = _interactive_select(
            "Select existing Privy wallet or enter new credentials",
            choices,
        ) or _prompt_text(
            "Select existing Privy wallet or enter new credentials",
            choices=choices,
            default=choices[0],
            action="privy wallet selection",
        )
        if selection != reuse_choice:
            conf = provider.get_wallet_config(selection)
            if conf.type != "privy":
                raise typer.Exit(1)
            params = conf.params
            wallet_id = explicit_privy_wallet_id or _prompt_required("Privy wallet id")
            return WalletConfig(
                type="privy",
                params=PrivyWalletParams(
                    app_id=params.app_id,
                    app_secret=params.app_secret,
                    wallet_id=wallet_id,
                ),
            )

    app_id = explicit_app_id or _prompt_required("Privy app id")
    app_secret = explicit_app_secret or _prompt_required("Privy app secret (input hidden)", password=True)
    wallet_id = explicit_privy_wallet_id or _prompt_required("Privy wallet id")

    return WalletConfig(
        type="privy",
        params=PrivyWalletParams(
            app_id=app_id,
            app_secret=app_secret,
            wallet_id=wallet_id,
        ),
    )


def _prompt_wallet_id(default: str, provider: ConfigWalletProvider | None = None) -> str:
    """Prompt for a wallet id with an interactive default. Re-prompts on duplicates."""
    while True:
        name = _prompt_text("Wallet ID (e.g. my_wallet_1)", default=default, action="wallet id")
        if provider is not None:
            try:
                provider.get_wallet_config(name)
                console.print(f"[yellow]Wallet '{name}' already exists. Please choose a different ID.[/yellow]")
                continue
            except WalletNotFoundError:
                pass
        return name


def _run_start(
    *,
    wallet_type: str | None,
    wallet_id: str | None,
    generate: bool,
    private_key: str | None,
    mnemonic: str | None,
    derive_as: str | None,
    mnemonic_index: int,
    dir: str,
    password: str | None,
    save_runtime_secrets: bool,
    override: bool,
    app_id: str | None = None,
    app_secret: str | None = None,
    privy_wallet_id: str | None = None,
) -> None:
    """Quick setup flow shared by start callback and typed subcommands."""
    if not override:
        try:
            existing = _get_provider(dir)
            rows = existing.list_wallets()
            if rows:
                active_id = existing.get_active_id()
                console.print(f"Already initialized with {len(rows)} wallet(s), active: [cyan]{active_id}[/cyan]")
                descriptions = {
                    "add": "Configure a new wallet",
                    "exit": "Exit without changes",
                }
                selected = _interactive_select("What would you like to do?", ["add", "exit"], descriptions)
                if selected is None:
                    selected = _prompt_text(
                        "Add a new wallet?",
                        choices=["add", "exit"],
                        default="exit",
                        action="existing wallet action",
                    )
                if selected == "exit":
                    raise typer.Exit(0)
        except (SystemExit, typer.Exit):
            raise
        except Exception:
            pass

    wtype = _select_wallet_type(wallet_type)
    provider: ConfigWalletProvider | None = None

    secrets_path = Path(dir)
    auto_generated = False

    if wtype == WalletType.LOCAL_SECURE:
        provider = _get_provider(dir)
        if wallet_id:
            try:
                provider.get_wallet_config(wallet_id)
                console.print(f"[red]Wallet '{wallet_id}' already exists.[/red]")
                raise typer.Exit(1)
            except WalletNotFoundError:
                pass
        if (secrets_path / "master.json").exists():
            pw, kv_store = _get_verified_password(dir, provider=provider, explicit=password)
            console.print("\nWallet already initialized.")
        else:
            explicit_pw = (
                password
                or provider.load_runtime_secrets_password()
                or os.environ.get("AGENT_WALLET_PASSWORD")
            )
            if explicit_pw:
                errors = _validate_password_strength(explicit_pw)
                if errors:
                    console.print(_format_password_error(errors))
                    raise typer.Exit(1)
                pw = explicit_pw
            else:
                console.print(PASSWORD_REQUIREMENTS_HINT)
                pw = _prompt_new_password(
                    prompt_label="New Master Password (press Enter to auto-generate a strong password)",
                    allow_empty=True,
                )
                if not pw:
                    pw = _generate_password()
                    auto_generated = True

            secrets_path.mkdir(parents=True, exist_ok=True)
            safe_chmod(secrets_path, 0o700)
            kv_store = SecureKVStore(dir, pw)
            kv_store.init_master()
            provider.ensure_storage()
            console.print("\nWallet initialized!")
        _maybe_save_runtime_secrets(provider, pw, save_runtime_secrets)
        target_name = wallet_id or _prompt_wallet_id("default_secure", provider)

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
        else:
            kv_store.save_secret(target_name, secret)
        provider.add_wallet(
            target_name,
            WalletConfig(
                type="local_secure",
                params=LocalSecureWalletParams(secret_ref=target_name),
            ),
        )
        provider.set_active(target_name)
        rows: list[tuple[str, str]] = [(target_name, "local_secure")]

        console.print("\nWallets:")
        _print_wallet_table(rows)

        if auto_generated:
            console.print(f"\n🔑 Your master password: {pw}")
            console.print(
                "[red]⚠️  Keep this password safe.[/red] You'll need it for signing and other operations."
            )

    elif wtype == WalletType.RAW_SECRET:
        if password:
            console.print("[red]--password is only valid for local_secure quick start.[/red]")
            raise typer.Exit(1)
        console.print("[yellow]Warning: Raw secret material will be stored in plaintext in wallets_config.json.[/yellow]")
        provider = _get_provider(dir)
        if wallet_id:
            try:
                provider.get_wallet_config(wallet_id)
                console.print(f"[red]Wallet '{wallet_id}' already exists.[/red]")
                raise typer.Exit(1)
            except WalletNotFoundError:
                pass
        target_name = wallet_id or _prompt_wallet_id("default_raw", provider)
        raw_secret_config = _build_raw_secret_config(
            explicit_private_key=private_key,
            explicit_mnemonic=mnemonic,
            derive_as=derive_as,
            mnemonic_index=mnemonic_index,
        )

        try:
            provider.add_wallet(target_name, raw_secret_config)
            provider.set_active(target_name)
        except ValueError as exc:
            console.print(f"[red]{exc}[/red]")
            raise typer.Exit(1) from exc

        console.print(f"\nWallet '{target_name}' created:")
        _print_wallet_table([(target_name, "raw_secret")])
    elif wtype == WalletType.PRIVY:
        if password:
            console.print("[red]--password is only valid for local_secure quick start.[/red]")
            raise typer.Exit(1)
        provider = _get_provider(dir)
        if wallet_id:
            try:
                provider.get_wallet_config(wallet_id)
                console.print(f"[red]Wallet '{wallet_id}' already exists.[/red]")
                raise typer.Exit(1)
            except WalletNotFoundError:
                pass
        target_name = wallet_id or _prompt_wallet_id("default_privy", provider)
        privy_config = _build_privy_config(
            provider,
            explicit_app_id=app_id,
            explicit_app_secret=app_secret,
            explicit_privy_wallet_id=privy_wallet_id,
        )

        try:
            provider.add_wallet(target_name, privy_config)
            provider.set_active(target_name)
        except ValueError as exc:
            console.print(f"[red]{exc}[/red]")
            raise typer.Exit(1) from exc

        console.print(f"\nWallet '{target_name}' created:")
        _print_wallet_table([(target_name, "privy")])
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


def _run_add(
    *,
    wallet_type: str | None,
    wallet_id: str | None,
    generate: bool,
    private_key: str | None,
    mnemonic: str | None,
    derive_as: str | None,
    mnemonic_index: int,
    dir: str,
    password: str | None,
    save_runtime_secrets: bool,
    app_id: str | None = None,
    app_secret: str | None = None,
    privy_wallet_id: str | None = None,
) -> None:
    """Add-wallet flow shared by add callback and typed subcommands."""
    try:
        wtype = _select_wallet_type(wallet_type, prompt_text="Wallet type")
    except ValueError:
        console.print(f"[red]Unknown wallet type: {wallet_type}. Use: {', '.join(t.value for t in WalletType)}[/red]")
        raise typer.Exit(1)

    provider = _get_provider(dir)
    if not provider.is_initialized():
        console.print("[red]Wallet not initialized. Run 'agent-wallet start' or 'agent-wallet init' first.[/red]")
        raise typer.Exit(1)

    if wallet_id:
        try:
            provider.get_wallet_config(wallet_id)
            console.print(f"[red]Wallet '{wallet_id}' already exists.[/red]")
            raise typer.Exit(1)
        except WalletNotFoundError:
            pass
    if wtype == WalletType.LOCAL_SECURE:
        try:
            pw, kv_store = _get_verified_password(dir, provider=provider, explicit=password)
        except FileNotFoundError as e:
            console.print(f"[red]Error: {e}[/red]")
            raise typer.Exit(1)
        secure_provider = _get_provider(dir, pw)
        _maybe_save_runtime_secrets(secure_provider, pw, save_runtime_secrets)
        target_name = wallet_id or _prompt_wallet_id("default_secure", provider)

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
            WalletConfig(
                type="local_secure",
                params=LocalSecureWalletParams(secret_ref=target_name),
            ),
        )
        console.print(f"  Saved:   [dim]secret_{target_name}.json[/dim]")

    elif wtype == WalletType.RAW_SECRET:
        if password:
            console.print("[red]--password is only valid for local_secure wallets.[/red]")
            raise typer.Exit(1)
        console.print("[yellow]Warning: Raw secret material will be stored in plaintext in wallets_config.json.[/yellow]")
        target_name = wallet_id or _prompt_wallet_id("default_raw", provider)
        provider.add_wallet(
            target_name,
            _build_raw_secret_config(
                explicit_private_key=private_key,
                explicit_mnemonic=mnemonic,
                derive_as=derive_as,
                mnemonic_index=mnemonic_index,
            ),
        )
    elif wtype == WalletType.PRIVY:
        if password:
            console.print("[red]--password is only valid for local_secure wallets.[/red]")
            raise typer.Exit(1)
        target_name = wallet_id or _prompt_wallet_id("default_privy", provider)
        provider.add_wallet(
            target_name,
            _build_privy_config(
                provider,
                explicit_app_id=app_id,
                explicit_app_secret=app_secret,
                explicit_privy_wallet_id=privy_wallet_id,
            ),
        )
    else:
        console.print(f"[red]Unknown wallet type: {wtype.value}. Use: {', '.join(t.value for t in WalletType)}[/red]")
        raise typer.Exit(1)
    console.print(f"[green]Wallet '{target_name}' added.[/green] Config updated.")
    if provider.get_active_id() == target_name:
        console.print(f"  Active wallet set to '{target_name}'.")


# --- Commands ---


@start_app.callback(invoke_without_command=True)
def start(
    ctx: typer.Context,
    wallet_id: str | None = typer.Option(None, "--wallet-id", "-w", help="Wallet ID"),
    dir: str = _dir_option(),
    save_runtime_secrets: bool = _save_runtime_secrets_option(),
    override: bool = typer.Option(False, "--override", help="Skip confirmation when wallets already exist"),
) -> None:
    """Quick setup: initialize and create default wallets."""
    if ctx.invoked_subcommand:
        return
    _run_start(
        wallet_type=None,
        wallet_id=wallet_id,
        generate=False,
        private_key=None,
        mnemonic=None,
        derive_as=None,
        mnemonic_index=0,
        dir=dir,
        password=None,
        save_runtime_secrets=save_runtime_secrets,
        override=override,
    )


@start_app.command("local_secure")
def start_local_secure(
    wallet_id: str | None = typer.Option(None, "--wallet-id", "-w", help="Wallet ID"),
    generate: bool = typer.Option(False, "--generate", "-g", help="Generate a new private key"),
    private_key: str | None = typer.Option(None, "--private-key", "-k", help="Import from private key"),
    mnemonic: str | None = typer.Option(None, "--mnemonic", "-m", help="Import from mnemonic"),
    derive_as: str | None = _derive_as_option(),
    mnemonic_index: int = typer.Option(0, "--mnemonic-index", "-mi", help="Mnemonic account index"),
    dir: str = _dir_option(),
    password: str | None = _password_option(),
    save_runtime_secrets: bool = _save_runtime_secrets_option(),
    override: bool = typer.Option(False, "--override", help="Skip confirmation when wallets already exist"),
) -> None:
    """Quick start with an encrypted local wallet."""
    _run_start(
        wallet_type=WalletType.LOCAL_SECURE.value,
        wallet_id=wallet_id,
        generate=generate,
        private_key=private_key,
        mnemonic=mnemonic,
        derive_as=derive_as,
        mnemonic_index=mnemonic_index,
        dir=dir,
        password=password,
        save_runtime_secrets=save_runtime_secrets,
        override=override,
    )


@start_app.command("raw_secret")
def start_raw_secret(
    wallet_id: str | None = typer.Option(None, "--wallet-id", "-w", help="Wallet ID"),
    private_key: str | None = typer.Option(None, "--private-key", "-k", help="Import from private key"),
    mnemonic: str | None = typer.Option(None, "--mnemonic", "-m", help="Import from mnemonic"),
    derive_as: str | None = _derive_as_option(),
    mnemonic_index: int = typer.Option(0, "--mnemonic-index", "-mi", help="Mnemonic account index"),
    dir: str = _dir_option(),
    save_runtime_secrets: bool = _save_runtime_secrets_option(),
    override: bool = typer.Option(False, "--override", help="Skip confirmation when wallets already exist"),
) -> None:
    """Quick start with a plaintext raw secret wallet."""
    _run_start(
        wallet_type=WalletType.RAW_SECRET.value,
        wallet_id=wallet_id,
        generate=False,
        private_key=private_key,
        mnemonic=mnemonic,
        derive_as=derive_as,
        mnemonic_index=mnemonic_index,
        dir=dir,
        password=None,
        save_runtime_secrets=save_runtime_secrets,
        override=override,
    )


@start_app.command("privy")
def start_privy(
    wallet_id: str | None = typer.Option(None, "--wallet-id", "-w", help="Wallet ID"),
    dir: str = _dir_option(),
    save_runtime_secrets: bool = _save_runtime_secrets_option(),
    override: bool = typer.Option(False, "--override", help="Skip confirmation when wallets already exist"),
    app_id: str | None = _privy_app_id_option(),
    app_secret: str | None = _privy_app_secret_option(),
    privy_wallet_id: str | None = _privy_wallet_id_option(),
) -> None:
    """Quick start with a Privy-backed wallet."""
    _run_start(
        wallet_type=WalletType.PRIVY.value,
        wallet_id=wallet_id,
        generate=False,
        private_key=None,
        mnemonic=None,
        derive_as=None,
        mnemonic_index=0,
        dir=dir,
        password=None,
        save_runtime_secrets=save_runtime_secrets,
        override=override,
        app_id=app_id,
        app_secret=app_secret,
        privy_wallet_id=privy_wallet_id,
    )


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
    safe_chmod(secrets_path, 0o700)

    provider = _get_provider(dir)
    console.print(PASSWORD_REQUIREMENTS_HINT)
    pw = _get_password(provider=provider, confirm=True, explicit=password)

    kv_store = SecureKVStore(dir, pw)
    kv_store.init_master()

    provider = _get_provider(dir, pw)
    provider.ensure_storage()
    _maybe_save_runtime_secrets(provider, pw, save_runtime_secrets)

    console.print(f"[green]Initialized.[/green] Secrets directory: {secrets_path}")


@add_app.callback(invoke_without_command=True)
def add(
    ctx: typer.Context,
    wallet_id: str | None = typer.Option(None, "--wallet-id", "-w", help="Wallet ID"),
    dir: str = _dir_option(),
    save_runtime_secrets: bool = _save_runtime_secrets_option(),
) -> None:
    """Add a new wallet (interactive)."""
    if ctx.invoked_subcommand:
        return
    _run_add(
        wallet_type=None,
        wallet_id=wallet_id,
        generate=False,
        private_key=None,
        mnemonic=None,
        derive_as=None,
        mnemonic_index=0,
        dir=dir,
        password=None,
        save_runtime_secrets=save_runtime_secrets,
    )


@add_app.command("local_secure")
def add_local_secure(
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
    """Add an encrypted local wallet."""
    _run_add(
        wallet_type=WalletType.LOCAL_SECURE.value,
        wallet_id=wallet_id,
        generate=generate,
        private_key=private_key,
        mnemonic=mnemonic,
        derive_as=derive_as,
        mnemonic_index=mnemonic_index,
        dir=dir,
        password=password,
        save_runtime_secrets=save_runtime_secrets,
    )


@add_app.command("raw_secret")
def add_raw_secret(
    wallet_id: str | None = typer.Option(None, "--wallet-id", "-w", help="Wallet ID"),
    private_key: str | None = typer.Option(None, "--private-key", "-k", help="Import from private key"),
    mnemonic: str | None = typer.Option(None, "--mnemonic", "-m", help="Import from mnemonic"),
    derive_as: str | None = _derive_as_option(),
    mnemonic_index: int = typer.Option(0, "--mnemonic-index", "-mi", help="Mnemonic account index"),
    dir: str = _dir_option(),
    save_runtime_secrets: bool = _save_runtime_secrets_option(),
) -> None:
    """Add a plaintext raw secret wallet."""
    _run_add(
        wallet_type=WalletType.RAW_SECRET.value,
        wallet_id=wallet_id,
        generate=False,
        private_key=private_key,
        mnemonic=mnemonic,
        derive_as=derive_as,
        mnemonic_index=mnemonic_index,
        dir=dir,
        password=None,
        save_runtime_secrets=save_runtime_secrets,
    )


@add_app.command("privy")
def add_privy(
    wallet_id: str | None = typer.Option(None, "--wallet-id", "-w", help="Wallet ID"),
    dir: str = _dir_option(),
    save_runtime_secrets: bool = _save_runtime_secrets_option(),
    app_id: str | None = _privy_app_id_option(),
    app_secret: str | None = _privy_app_secret_option(),
    privy_wallet_id: str | None = _privy_wallet_id_option(),
) -> None:
    """Add a Privy-backed wallet."""
    _run_add(
        wallet_type=WalletType.PRIVY.value,
        wallet_id=wallet_id,
        generate=False,
        private_key=None,
        mnemonic=None,
        derive_as=None,
        mnemonic_index=0,
        dir=dir,
        password=None,
        save_runtime_secrets=save_runtime_secrets,
        app_id=app_id,
        app_secret=app_secret,
        privy_wallet_id=privy_wallet_id,
    )


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

    if conf.type == "local_secure":
        secret_status = "ok" if provider.has_secret_file(wallet_id) else "-"
        table.add_row("Secret", f"secret_{conf.secret_ref}.json {secret_status}")
    elif conf.type == "raw_secret":
        params = conf.params
        table.add_row("Source Type", params.source)
        if isinstance(params, RawSecretPrivateKeyParams):
            table.add_row("Private Key", "[redacted]")
        elif isinstance(params, RawSecretMnemonicParams):
            table.add_row("Mnemonic", "[redacted]")
            table.add_row("Account Index", str(params.account_index))
    elif conf.type == "privy":
        table.add_row("Privy App ID", "[redacted]")
        table.add_row("Privy App Secret", "[redacted]")
        table.add_row("Privy Wallet ID", "[redacted]")

    console.print(table)


@app.command("resolve-address")
def resolve_address(
    wallet_id: str | None = typer.Argument(None, help="Wallet ID to resolve"),
    dir: str = _dir_option(),
    password: str | None = _password_option(),
) -> None:
    """Resolve wallet address output for display."""
    from agent_wallet.core.address_resolution import resolve_wallet_addresses

    provider = _get_provider(dir)
    target_id = wallet_id
    if target_id is None:
        rows = provider.list_wallets()
        if not rows:
            console.print("[red]No wallets configured.[/red]")
            raise typer.Exit(1)
        choices = [wid for wid, _conf, _is_active in rows]
        descriptions = {
            wid: f"{conf.type}{' (active)' if is_active else ''}"
            for wid, conf, is_active in rows
        }
        selected = _interactive_select("Select wallet to resolve", choices, descriptions)
        if selected is None:
            selected = _prompt_text(
                "Select wallet to resolve",
                choices=choices,
                default=choices[0],
                action="wallet selection",
            )
        target_id = selected
    try:
        conf = provider.get_wallet_config(target_id)
    except WalletNotFoundError:
        console.print(f"[red]Wallet '{target_id}' not found.[/red]")
        raise typer.Exit(1)

    resolved_password: str | None = None
    if conf.type == "local_secure":
        resolved_password, _kv_store = _get_verified_password(dir, provider=provider, explicit=password)
    elif password:
        console.print("[red]--password is only valid for local_secure wallets.[/red]")
        raise typer.Exit(1)

    result = asyncio.run(
        resolve_wallet_addresses(
            conf,
            config_dir=dir,
            password=resolved_password,
            secret_loader=load_local_secret,
        )
    )

    table = Table(show_header=False, box=None, padding=(0, 2))
    table.add_column("Key", style="bold")
    table.add_column("Value")
    table.add_row("Wallet", target_id)
    table.add_row("Type", conf.type)
    if result.mode == "single":
        entry = result.entries[0]
        table.add_row(entry.label, entry.address)
        console.print(table)
        return

    console.print(table)
    console.print()
    addr_table = Table(show_header=False, box=None, padding=(0, 2))
    addr_table.add_column("Label", style="bold cyan")
    addr_table.add_column("Address")
    for entry in result.entries:
        addr_table.add_row(entry.label, entry.address)
    console.print("[bold]Addresses[/bold]")
    console.print(addr_table)


@app.command()
def remove(
    wallet_id: str | None = typer.Argument(None, help="Wallet ID to remove"),
    dir: str = _dir_option(),
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation"),
) -> None:
    """Remove a wallet and its associated files."""
    provider = _get_provider(dir)
    active_before = provider.get_active_id()
    target_id = wallet_id
    warned_local_secure = False
    if target_id is None:
        rows = provider.list_wallets()
        if not rows:
            console.print("[red]No wallets configured.[/red]")
            raise typer.Exit(1)
        if any(conf.type == "local_secure" for _wid, conf, _is_active in rows):
            console.print(
                "[yellow]Warning:[/yellow] Transfer out any assets first. If this "
                "[bold]local_secure[/bold] wallet was generated by agent-wallet, removing it will "
                "permanently delete the only recoverable wallet record. The private key cannot be "
                "recovered after removal."
            )
            warned_local_secure = True
        choices = [wid for wid, _conf, _is_active in rows]
        descriptions = {
            wid: f"{conf.type}{' (active)' if is_active else ''}"
            for wid, conf, is_active in rows
        }
        target_id = _interactive_select("Select wallet to remove", choices, descriptions)
        if target_id is None:
            target_id = _prompt_text(
                "Select wallet to remove",
                choices=choices,
                default=choices[0],
                action="wallet removal selection",
            )
    try:
        conf = provider.get_wallet_config(target_id)
    except WalletNotFoundError:
        console.print(f"[red]Wallet '{target_id}' not found.[/red]")
        raise typer.Exit(1)

    if conf.type == "local_secure" and not warned_local_secure:
        console.print(
            "[yellow]Warning:[/yellow] Transfer out any assets first. If this "
            "[bold]local_secure[/bold] wallet was generated by agent-wallet, removing it will "
            "permanently delete the only recoverable wallet record. The private key cannot be "
            "recovered after removal."
        )

    if not yes and not _confirm_action(
        f"PERMANENTLY delete wallet '{target_id}'? This cannot be undone and the wallet configuration will be removed immediately.",
        default=False,
        action="wallet removal confirmation",
    ):
        console.print("[dim]Cancelled.[/dim]")
        raise typer.Exit(0)

    if conf.type == "local_secure" and provider.has_secret_file(target_id):
        console.print(f"  Deleted: [dim]secret_{conf.secret_ref}.json[/dim]")
    provider.remove_wallet(target_id)
    console.print(f"[green]Wallet '{target_id}' removed.[/green]")

    if active_before == target_id:
        rows = provider.list_wallets()
        if rows:
            prompt_reassign = _interactive_select(
                "Removed the active wallet. Select a new active wallet now?",
                ["yes", "no"],
                {
                    "yes": "Choose a replacement active wallet",
                    "no": "Leave active wallet unset",
                },
            )
            if prompt_reassign is None:
                try:
                    prompt_reassign = _prompt_text(
                        "Select a new active wallet now?",
                        choices=["yes", "no"],
                        default="yes",
                        action="active wallet reassignment",
                    )
                except typer.Exit:
                    prompt_reassign = None
            if prompt_reassign == "yes":
                choices = [wid for wid, _conf, _is_active in rows]
                descriptions = {
                    wid: conf.type
                    for wid, conf, _is_active in rows
                }
                new_active = _interactive_select("Select new active wallet", choices, descriptions)
                if new_active is None:
                    try:
                        new_active = _prompt_text(
                            "Select new active wallet",
                            choices=choices,
                            default=choices[0],
                            action="new active wallet selection",
                        )
                    except typer.Exit:
                        new_active = None
                if new_active is None:
                    return
                provider.set_active(new_active)
                console.print(f"[green]Active wallet: {new_active}[/green]")


@app.command()
def use(
    wallet_id: str | None = typer.Argument(None, help="Wallet ID to set as active"),
    dir: str = _dir_option(),
) -> None:
    """Set the active wallet."""
    provider = _get_provider(dir)
    target_id = wallet_id
    if target_id is None:
        rows = provider.list_wallets()
        if not rows:
            console.print("[red]No wallets configured.[/red]")
            raise typer.Exit(1)
        choices = [wid for wid, _conf, _is_active in rows]
        descriptions = {
            wid: f"{conf.type}{' (active)' if is_active else ''}"
            for wid, conf, is_active in rows
        }
        selected = _interactive_select("Select wallet:", choices, descriptions)
        if selected is None:
            selected = _prompt_text("Select wallet", choices=choices, default=choices[0], action="wallet selection")
        target_id = selected
    try:
        conf = provider.set_active(target_id)
    except WalletNotFoundError:
        console.print(f"[red]Wallet '{target_id}' not found.[/red]")
        raise typer.Exit(1)
    console.print(f"Active wallet: {target_id} ({conf.type})")


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
    network: str | None = typer.Option(None, "--network", "-n", help="Target network, e.g. eip155:1 or tron:nile"),
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
            _sign_transaction_with_provider(
                provider,
                wallet_id,
                network,
                tx_data,
            )
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
    network: str | None = typer.Option(None, "--network", "-n", help="Target network, e.g. eip155:1 or tron:nile"),
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
            _sign_message_with_provider(
                provider,
                wallet_id,
                network,
                message.encode(),
            )
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
    network: str | None = typer.Option(None, "--network", "-n", help="Target network, e.g. eip155:1 or tron:nile"),
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
            _sign_typed_data_with_provider(
                provider,
                wallet_id,
                network,
                typed_data,
            )
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
    new_password: str | None = typer.Option(None, "--new-password", help="New master password (skip prompt)"),
    save_runtime_secrets: bool = _save_runtime_secrets_option(),
) -> None:
    """Change master password and re-encrypt all files."""
    provider = _get_provider(dir)
    try:
        _old_pw, kv_store_old = _get_verified_password(dir, provider=provider, explicit=password)
    except FileNotFoundError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)

    if new_password is not None:
        errors = _validate_password_strength(new_password)
        if errors:
            console.print(_format_password_error(errors))
            raise typer.Exit(1)
        new_pw = new_password
    else:
        console.print(PASSWORD_REQUIREMENTS_HINT)
        new_pw = _prompt_new_password()

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
    files = _managed_json_files(secrets_path)
    if not files:
        console.print("[yellow]No wallet data found in:[/yellow] " + dir)
        raise typer.Exit(1)

    console.print(f"[yellow]This will delete ALL wallet data in:[/yellow] {dir}")
    console.print(f"   {len(files)} file(s): {', '.join(f.name for f in files)}")
    console.print()

    if not yes:
        if not _confirm_action(
            "Are you sure you want to reset? This cannot be undone",
            default=False,
            action="wallet reset confirmation",
        ):
            console.print("[dim]Cancelled.[/dim]")
            raise typer.Exit(0)
        if not _confirm_action(
            "Really delete everything? Last chance!",
            default=False,
            action="wallet reset confirmation",
        ):
            console.print("[dim]Cancelled.[/dim]")
            raise typer.Exit(0)

    for f in files:
        f.unlink()
        console.print(f"  Deleted: [dim]{f.name}[/dim]")
    console.print()
    console.print("[green]Wallet data reset complete.[/green]")

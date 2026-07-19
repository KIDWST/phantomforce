"""Hard-blocked action classifier for the autonomous agent engine.

Blocks only categories that destroy data/work irreversibly or create new
public network exposure/credential risk on a box that hosts live customer
sites. Everything else is allowed to run autonomously — see the design
spec's autonomy boundary section.

Commands are split into shell sub-command segments (on &&, ||, ;, |, &) so
a harmless prefix like "true && rm -rf /" cannot smuggle a blocked command
past detection. Each segment is tokenized with shlex (quote-aware) and
checked independently. A leading sudo/doas/env wrapper is unwrapped so the
real target binary is still recognized.
"""
import re
import shlex

_SEPARATOR_TOKENS = {"&&", "||", ";", "|", "&"}
_PRIVILEGE_WRAPPERS = {"sudo", "doas"}


def _tokenize(cmd):
    # punctuation_chars makes shlex split shell control operators (&&, ||,
    # ;, |, &) into their own tokens even when they're jammed up against a
    # word with no surrounding whitespace (e.g. "echo hi; rm -rf x" or
    # "true&&rm -rf x") — plain shlex.split(..., posix=False) with only
    # whitespace_split=True (its internal default) leaves "hi;" as one
    # token, which would let a semicolon/ampersand-glued compound command
    # slip past _split_compound undetected.
    try:
        lexer = shlex.shlex(cmd, posix=False, punctuation_chars=";&|")
        lexer.whitespace_split = True
        tokens = list(lexer)
    except ValueError:
        tokens = cmd.split()
    return [t.strip("\"'") for t in tokens]


def _split_compound(cmd):
    """Splits a command line into sub-command segments on shell control
    operators (&&, ||, ;, |, &) AND on physical newlines, respecting
    quoting via shlex within each line. Newlines are split first since
    shlex's default whitespace treats them as ordinary token separators,
    which would otherwise merge a multi-line command into one flat token
    list and let only the first line's binary be checked."""
    segments = []
    for line in cmd.splitlines():
        if not line.strip():
            continue
        tokens = _tokenize(line)
        current = []
        for t in tokens:
            if t in _SEPARATOR_TOKENS:
                if current:
                    segments.append(current)
                current = []
            else:
                current.append(t)
        if current:
            segments.append(current)
    return segments


def _unwrap_privilege(tokens):
    """Skips a leading sudo/doas (and any of their flags) and env (and any
    of its VAR=val assignments/flags) to find the real command tokens."""
    i = 0
    while i < len(tokens):
        head = tokens[i].lower()
        if head in _PRIVILEGE_WRAPPERS:
            i += 1
            while i < len(tokens) and tokens[i].startswith("-"):
                i += 1
            continue
        if head == "env":
            i += 1
            while i < len(tokens) and (tokens[i].startswith("-") or "=" in tokens[i]):
                i += 1
            continue
        break
    return tokens[i:]


def _binary_name(token):
    name = token.replace("\\", "/").rsplit("/", 1)[-1]
    return name.lower()


def _has_combined_or_separate_flags(tokens, short_letters, long_names):
    for t in tokens:
        if t.startswith("-") and not t.startswith("--"):
            letters = set(t[1:].lower())
            if all(c in letters for c in short_letters):
                return True
    if long_names and all(f"--{name}" in [x.lower() for x in tokens] for name in long_names):
        return True
    if all(f"-{c}" in [x.lower() for x in tokens] for c in short_letters):
        return True
    return False


def _is_rm_rf(tokens):
    if not tokens or _binary_name(tokens[0]) != "rm":
        return False
    return _has_combined_or_separate_flags(tokens[1:], "rf", ["recursive", "force"])


def _is_format(tokens):
    if not tokens or _binary_name(tokens[0]) != "format":
        return False
    return any(re.match(r"^[a-zA-Z]:$", t) for t in tokens[1:])


def _is_mkfs(tokens):
    return bool(tokens) and _binary_name(tokens[0]).startswith("mkfs")


def _is_git_force_push_or_hard_reset(tokens):
    if not tokens or _binary_name(tokens[0]) != "git":
        return False
    lowered = [t.lower() for t in tokens]
    if "push" in lowered[1:]:
        idx = lowered.index("push")
        rest = lowered[idx + 1:]
        if "--force" in rest or "-f" in rest or any(t.startswith("--force") for t in rest):
            return True
    if "reset" in lowered[1:]:
        idx = lowered.index("reset")
        rest = lowered[idx + 1:]
        if "--hard" in rest:
            return True
    return False


def _is_tailscale_funnel_or_serve(tokens):
    if not tokens or _binary_name(tokens[0]) != "tailscale":
        return False
    lowered = [t.lower() for t in tokens]
    return "funnel" in lowered[1:] or "serve" in lowered[1:]


def _is_docker_publish_or_privileged(tokens):
    if not tokens or _binary_name(tokens[0]) != "docker":
        return False
    lowered = [t.lower() for t in tokens]
    if not ("run" in lowered[1:] or "create" in lowered[1:]):
        return False
    for t in lowered[1:]:
        if t in ("-p", "--publish", "--privileged"):
            return True
        if t.startswith("--publish=") or t.startswith("--privileged="):
            return True
        if t.startswith("-p") and len(t) > 2 and t[2].isdigit():
            return True
    return False


def _is_reverse_listener(tokens):
    if not tokens:
        return False
    name = _binary_name(tokens[0])
    if name in ("nc", "ncat", "netcat"):
        return _has_combined_or_separate_flags(tokens[1:], "l", [])
    if name == "socat":
        return any("listen" in t.lower() for t in tokens[1:])
    return False


def _is_credential_exfiltration(raw_cmd):
    secret_markers = (".ssh/id_rsa", ".aws/credentials", ".env", "credentials.json", "id_ed25519")
    network_tools = ("curl", "wget", "nc ", "ncat", "scp ", "rsync ", "ftp ")
    low = raw_cmd.lower()
    return any(m in low for m in secret_markers) and any(nt in low for nt in network_tools)


_SEGMENT_CHECKS = (
    _is_rm_rf, _is_format, _is_mkfs, _is_git_force_push_or_hard_reset,
    _is_tailscale_funnel_or_serve, _is_docker_publish_or_privileged,
    _is_reverse_listener,
)


def is_protected(cmd):
    raw = str(cmd or "")
    for segment in _split_compound(raw):
        real_tokens = _unwrap_privilege(segment)
        if any(check(real_tokens) for check in _SEGMENT_CHECKS):
            return True
    return _is_credential_exfiltration(raw)


def protected_result(cmd, reason="This action is on the hard-blocked list and needs operator approval."):
    return {
        "ok": False,
        "approvalRequired": True,
        "reason": reason,
        "error": reason,
        "cmd": cmd,
    }

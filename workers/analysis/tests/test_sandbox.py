import io
import subprocess
import tarfile
from pathlib import Path

import pytest

from analysis.config import Settings
from analysis.sandbox import (
    LOG_LIMIT_BYTES,
    STARTED_MARKER,
    SandboxResult,
    build_tarball,
    docker_command,
    forge_passed,
    run_poc,
    truncate_log,
)

FIXTURES = Path(__file__).parent / "fixtures"
VAULT = (FIXTURES / "Vault.sol").read_bytes()
SETTINGS = Settings.from_env({})

PASS_OUTPUT = (
    f"{STARTED_MARKER}\n"
    "Ran 1 test for test/PoC.t.sol:PoCTest\n"
    "[PASS] test_reentrancyDrainsVault() (gas: 1)\n"
    "Suite result: ok. 1 passed; 0 failed; 0 skipped; finished in 1ms\n"
)
FAIL_OUTPUT = (
    f"{STARTED_MARKER}\n"
    "[FAIL: vault should be drained] test_plainWithdrawDrainsVault() (gas: 1)\n"
    "Suite result: FAILED. 0 passed; 1 failed; 0 skipped; finished in 1ms\n"
)


def _poc(name: str) -> bytes:
    return (FIXTURES / "pocs" / name).read_bytes()


def _members(tar: bytes) -> dict[str, bytes]:
    with tarfile.open(fileobj=io.BytesIO(tar)) as archive:
        return {m.name: archive.extractfile(m).read() for m in archive.getmembers() if m.isfile()}


class FakeRun:
    def __init__(self, *results):
        self.results = list(results)
        self.calls: list[tuple[list[str], dict]] = []

    def __call__(self, cmd, **kwargs):
        self.calls.append((cmd, kwargs))
        if cmd[:3] == ["docker", "rm", "-f"]:
            return subprocess.CompletedProcess(cmd, 0, stdout=b"", stderr=b"")
        result = self.results.pop(0)
        if isinstance(result, BaseException):
            raise result
        code, stdout, stderr = result
        return subprocess.CompletedProcess(cmd, code, stdout=stdout, stderr=stderr)


def test_docker_command_flags():
    cmd = docker_command("poc_1", SETTINGS)
    joined = " ".join(cmd)
    for flag in [
        "docker run --rm -i --name bbm-sandbox-poc_1",
        "--network none",
        "--memory 1g",
        "--memory-swap 1g",
        "--pull never",
        "--cpus 1",
        "--pids-limit 256",
        "--read-only",
        "--tmpfs /tmp:rw,exec,size=256m",
        "--cap-drop ALL",
        "--security-opt no-new-privileges",
        "--user 1000:1000",
        "bbm-sandbox:latest",
    ]:
        assert flag in joined
    assert cmd[-3:-1] == ["sh", "-c"]
    # The container enforces the limit itself, so it dies even if the worker does.
    assert "timeout -s KILL 120 forge test" in cmd[-1]
    # Started marker first; forge output is capped inside the container.
    assert cmd[-1].startswith(f"echo {STARTED_MARKER}")
    assert "tail -c 262144" in cmd[-1]


def test_tarball_layout_and_safe_name():
    members = _members(build_tarball("../../Vault.sol", VAULT, b"poc", "0.8.28"))
    assert set(members) == {"foundry.toml", "src/Vault.sol", "test/PoC.t.sol"}
    assert members["src/Vault.sol"] == VAULT
    assert members["test/PoC.t.sol"] == b"poc"
    toml = members["foundry.toml"].decode()
    assert "offline = true" in toml
    assert 'solc = "/opt/solc/solc-0.8.28"' in toml
    assert "ffi = false" in toml
    assert 'remappings = ["forge-std/=/opt/forge-std/src/"]' in toml


def test_tarball_keeps_the_displayed_filename():
    members = _members(build_tarball("My Vault.sol", VAULT, b"poc", "0.8.28"))
    assert "src/My Vault.sol" in members


def test_pass_output():
    assert forge_passed(PASS_OUTPUT)
    run = FakeRun((0, PASS_OUTPUT.encode(), b""))
    result = run_poc(b"tar", "poc_1", SETTINGS, run=run)
    # The started marker is stripped from the stored log.
    assert result == SandboxResult(
        status="Passed", log=PASS_OUTPUT.split("\n", 1)[1], infra_error=None
    )
    assert run.calls[0][0] == ["docker", "rm", "-f", "bbm-sandbox-poc_1"]
    assert run.calls[0][1]["timeout"] == 30
    assert run.calls[1][1]["input"] == b"tar"
    assert run.calls[1][1]["timeout"] > 120


def test_fail_output():
    assert not forge_passed(FAIL_OUTPUT)
    result = run_poc(b"tar", "poc_1", SETTINGS, run=FakeRun((1, FAIL_OUTPUT.encode(), b"")))
    assert result.status == "Failed" and result.infra_error is None


def test_zero_tests_is_fail():
    output = f"{STARTED_MARKER}\nNo tests found in project! Forge looks for functions that start with `test`.\n"
    assert not forge_passed(output)
    assert run_poc(b"t", "poc_1", SETTINGS, run=FakeRun((0, output.encode(), b""))).status == (
        "Failed"
    )


def test_mixed_pass_and_fail_suites_is_fail():
    assert not forge_passed(PASS_OUTPUT + FAIL_OUTPUT)


def test_exit_zero_without_passing_summary_is_fail():
    result = run_poc(
        b"t", "poc_1", SETTINGS, run=FakeRun((0, f"{STARTED_MARKER}\ncompiled\n".encode(), b""))
    )
    assert result.status == "Failed"


def test_in_container_kill_is_a_failure_naming_both_limits():
    run = FakeRun((137, f"{STARTED_MARKER}\nCompiling...\n".encode(), b""))
    result = run_poc(b"t", "poc_1", SETTINGS, run=run)
    assert result.status == "Failed"
    assert result.log.startswith(
        "Killed after reaching the time limit (120s) or the memory limit (1 GB)"
    )
    assert "Compiling..." in result.log


def test_compile_error_is_fail_with_log():
    stdout = f"{STARTED_MARKER}\nError: Compiler run failed:\nError (2314): Expected ';'\n".encode()
    result = run_poc(b"t", "poc_1", SETTINGS, run=FakeRun((1, stdout, b"")))
    assert result.status == "Failed"
    assert "Expected ';'" in result.log


def test_worker_side_timeout_kills_the_container_and_is_retried():
    # The in-container limit is the real one; the outer timeout only fires when
    # start-up or Docker itself is slow, which is our outage, not the auditor's.
    run = FakeRun(subprocess.TimeoutExpired(["docker"], 150), (0, b"", b""))
    result = run_poc(b"t", "poc_1", SETTINGS, run=run)
    assert run.calls[-1][0] == ["docker", "kill", "bbm-sandbox-poc_1"]
    assert run.calls[-1][1]["timeout"] == 30
    assert result.status is None
    assert result.infra_error == "Sandbox did not finish within 150s; Docker may be slow"


@pytest.mark.parametrize(
    ("code", "stderr"),
    [
        (1, b"Cannot connect to the Docker daemon at unix:///var/run/docker.sock.\n"),
        (126, b"permission denied while trying to connect to the Docker daemon socket\n"),
    ],
)
def test_docker_failure_without_the_started_marker_is_infra_error(code, stderr):
    result = run_poc(b"t", "poc_1", SETTINGS, run=FakeRun((code, b"", stderr)))
    assert result.status is None
    assert result.infra_error == stderr.decode().strip()


def test_docker_missing_is_infra_error():
    def run(cmd, **kwargs):
        raise FileNotFoundError("docker")

    result = run_poc(b"t", "poc_1", SETTINGS, run=run)
    assert result.status is None
    assert result.infra_error == "Docker CLI not found"


def test_daemon_down_is_infra_error():
    stderr = b"docker: Cannot connect to the Docker daemon at unix:///var/run/docker.sock.\n"
    result = run_poc(b"t", "poc_1", SETTINGS, run=FakeRun((125, b"", stderr)))
    assert result.status is None
    assert "Cannot connect to the Docker daemon" in result.infra_error


def test_huge_output_truncated_but_verdict_from_full_output():
    noise = ("x" * 99 + "\n") * 10_000
    run = FakeRun((0, (STARTED_MARKER + "\n" + noise + PASS_OUTPUT).encode(), b""))
    result = run_poc(b"t", "poc_1", SETTINGS, run=run)
    assert result.status == "Passed"
    assert len(result.log.encode()) <= LOG_LIMIT_BYTES + len("[truncated]\n")
    assert result.log.startswith("[truncated]\n")
    assert result.log.endswith(PASS_OUTPUT)


def test_truncate_log_keeps_short_logs():
    assert truncate_log("short") == "short"


def _run_real(poc_name: str, timeout_s: int = 120) -> SandboxResult:
    settings = Settings.from_env({"SANDBOX_TIMEOUT_SECONDS": str(timeout_s)})
    tar = build_tarball("Vault.sol", VAULT, _poc(poc_name), "0.8.28")
    return run_poc(tar, f"test_{poc_name.split('.')[0].lower()}", settings)


@pytest.mark.docker
def test_real_passing_poc_passes():
    result = _run_real("PoC_pass.t.sol")
    assert result.status == "Passed", result.log


@pytest.mark.docker
def test_real_failing_poc_fails():
    result = _run_real("PoC_fail.t.sol")
    assert result.status == "Failed", result.log
    assert "vault should be drained" in result.log


@pytest.mark.docker
def test_real_hanging_poc_is_killed_at_the_time_limit():
    result = _run_real("PoC_hang.t.sol", timeout_s=20)
    assert result.status == "Failed"
    # The in-container limit fires first; the worker's own timeout is the backstop.
    assert result.log.startswith("Killed after reaching the time limit (20s)")
    leftover = subprocess.run(
        ["docker", "ps", "-q", "--filter", "name=bbm-sandbox-test_poc_hang"],
        capture_output=True,
        text=True,
    )
    assert leftover.stdout.strip() == ""


@pytest.mark.docker
def test_real_network_poc_fails():
    result = _run_real("PoC_network.t.sol")
    assert result.status == "Failed", result.log


@pytest.mark.docker
def test_real_poc_importing_a_filename_with_spaces_passes():
    poc = _poc("PoC_pass.t.sol").replace(b'"../src/Vault.sol"', b'"../src/My Vault.sol"')
    tar = build_tarball("My Vault.sol", VAULT, poc, "0.8.28")
    result = run_poc(tar, "test_poc_spaces", SETTINGS)
    assert result.status == "Passed", result.log


@pytest.mark.docker
def test_real_run_replaces_a_leftover_container_with_the_same_name():
    name = "bbm-sandbox-test_poc_stale"
    subprocess.run(["docker", "rm", "-f", name], capture_output=True)
    started = subprocess.run(
        ["docker", "run", "-d", "--name", name, "bbm-sandbox:latest", "sleep", "300"],
        capture_output=True,
    )
    assert started.returncode == 0, started.stderr
    tar = build_tarball("Vault.sol", VAULT, _poc("PoC_pass.t.sol"), "0.8.28")
    result = run_poc(tar, "test_poc_stale", SETTINGS)
    assert result.status == "Passed", result.log


@pytest.mark.docker
def test_real_poc_with_a_pinned_pragma_uses_that_compiler():
    poc = _poc("PoC_pass.t.sol").replace(b"pragma solidity ^0.8.19;", b"pragma solidity 0.8.20;")
    tar = build_tarball("Vault.sol", VAULT, poc, "0.8.20")
    result = run_poc(tar, "test_poc_pinned", SETTINGS)
    assert result.status == "Passed", result.log


@pytest.mark.docker
def test_real_noisy_poc_output_is_capped_inside_the_container():
    noisy = b'import "forge-std/console.sol";\n' + _poc("PoC_fail.t.sol").replace(
        b"function test_plainWithdrawDrainsVault() public {",
        b"function test_plainWithdrawDrainsVault() public {\n"
        b'        for (uint256 i = 0; i < 20000; i++) console.log("noise noise noise noise noise noise noise");',
    )
    tar = build_tarball("Vault.sol", VAULT, noisy, "0.8.28")
    calls = []

    def recording_run(cmd, **kwargs):
        proc = subprocess.run(cmd, **kwargs)
        calls.append(len(proc.stdout or b""))
        return proc

    result = run_poc(tar, "test_poc_noisy", SETTINGS, run=recording_run)
    assert result.status == "Failed"
    assert max(calls) <= 262_144 + 1024  # capped before it reaches the worker

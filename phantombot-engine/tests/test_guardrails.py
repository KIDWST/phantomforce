import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import guardrails  # noqa: E402


def test_blocks_recursive_delete():
    assert guardrails.is_protected("rm -rf /home/kali/important") is True


def test_blocks_disk_format():
    assert guardrails.is_protected("format C:") is True


def test_blocks_git_force_push():
    assert guardrails.is_protected("git push --force origin main") is True


def test_blocks_git_hard_reset():
    assert guardrails.is_protected("git reset --hard HEAD~5") is True


def test_blocks_tailscale_funnel():
    assert guardrails.is_protected("tailscale funnel 443") is True


def test_blocks_tailscale_serve():
    assert guardrails.is_protected("tailscale serve https / 8080") is True


def test_blocks_docker_publish():
    assert guardrails.is_protected("docker run -p 80:80 nginx") is True


def test_blocks_docker_privileged():
    assert guardrails.is_protected("docker run --privileged alpine") is True


def test_blocks_reverse_listener():
    assert guardrails.is_protected("nc -l -p 4444 -e /bin/bash") is True


def test_blocks_socat_listener():
    assert guardrails.is_protected("socat tcp-listen:4444 exec:/bin/bash") is True


def test_allows_ordinary_commands():
    assert guardrails.is_protected("ls -la") is False
    assert guardrails.is_protected("docker ps") is False
    assert guardrails.is_protected("docker build -t myapp .") is False
    assert guardrails.is_protected("git commit -m 'fix'") is False
    assert guardrails.is_protected("python3 script.py") is False
    assert guardrails.is_protected("npm install") is False


def test_protected_result_shape():
    result = guardrails.protected_result("rm -rf /", "test reason")
    assert result["ok"] is False
    assert result["approvalRequired"] is True
    assert result["reason"] == "test reason"
    assert result["cmd"] == "rm -rf /"


# --- Regression tests for confirmed bypasses / false positives ---


def test_blocks_nc_combined_short_flags_reverse_shell():
    assert guardrails.is_protected("nc -lvp 4444 -e /bin/bash") is True


def test_blocks_netcat_binary_name_reverse_shell():
    assert guardrails.is_protected("netcat -l -p 4444 -e /bin/bash") is True


def test_blocks_rm_separated_short_flags():
    assert guardrails.is_protected("rm -r -f /home/x") is True


def test_blocks_rm_long_form_flags():
    assert guardrails.is_protected("rm --recursive --force /home/x") is True


def test_blocks_git_force_push_with_global_flag():
    assert guardrails.is_protected("git -C /repo push --force origin main") is True


def test_blocks_git_hard_reset_with_global_flag():
    assert guardrails.is_protected("git -C /repo reset --hard HEAD") is True


def test_blocks_docker_run_publish_no_space():
    assert guardrails.is_protected("docker run -p80:80 nginx") is True


def test_blocks_docker_create_publish():
    assert guardrails.is_protected("docker create -p 80:80 nginx") is True


def test_allows_npm_run_format_with_windows_path():
    assert guardrails.is_protected(r"npm run format C:\Users\jorda\file.js") is False


def test_allows_git_push_to_branch_named_feature_f():
    assert guardrails.is_protected("git push origin feature-f") is False


# --- Regression tests: compound commands / sudo unwrap / quoted flags ---


def test_blocks_compound_command_with_harmless_prefix():
    assert guardrails.is_protected("true && rm -rf /") is True
    assert guardrails.is_protected("echo hi; rm -rf /home/x") is True
    assert guardrails.is_protected("echo hi && git push --force origin main") is True
    assert guardrails.is_protected("cd /tmp && git reset --hard HEAD~5") is True
    assert guardrails.is_protected("true && nc -lvp 4444 -e /bin/bash") is True
    assert guardrails.is_protected("true && docker run --privileged alpine") is True
    assert guardrails.is_protected("true && tailscale funnel 443") is True
    assert guardrails.is_protected("ls && format C:") is True


def test_blocks_sudo_prefixed_reverse_listener():
    assert guardrails.is_protected("sudo nc -lvp 4444 -e /bin/bash") is True


def test_blocks_quoted_rm_rf_flag():
    assert guardrails.is_protected('rm "-rf" /home/x') is True


def test_blocks_docker_privileged_equals_form():
    assert guardrails.is_protected("docker run --privileged=true image") is True


def test_allows_unrelated_chained_force_flag():
    assert guardrails.is_protected("git push origin main && npm ci --force") is False


def test_allows_ordinary_compound_commands():
    assert guardrails.is_protected("cd /tmp && ls -la") is False
    assert guardrails.is_protected("git add . && git commit -m 'fix'") is False
    assert guardrails.is_protected("npm install && npm test") is False


def test_blocks_newline_separated_harmless_prefix():
    assert guardrails.is_protected("echo hi\ndocker run --privileged alpine") is True
    assert guardrails.is_protected("true\nrm -rf /home/x") is True
    assert guardrails.is_protected("ls -la\ngit push --force origin main") is True
    assert guardrails.is_protected("echo hi\r\nnc -lvp 4444 -e /bin/bash") is True


def test_allows_ordinary_multiline_commands():
    assert guardrails.is_protected("cd /tmp\nls -la") is False
    assert guardrails.is_protected("echo start\necho done") is False

from pathlib import Path

from agent.prompt_builder import DEFAULT_AGENT_IDENTITY
from agent.system_prompt import (
    PHANTOM_UNLEASHED_IDENTITY_GUARD,
    PHANTOM_USER_FACING_IDENTITY_GUARD,
    phantom_user_facing_identity_guard,
)


def test_default_identity_separates_model_from_product_name():
    assert "You are Phantom" in DEFAULT_AGENT_IDENTITY
    assert "answer 'I'm Phantom.'" in DEFAULT_AGENT_IDENTITY
    assert "host application, runtime, model family, or provider name" in DEFAULT_AGENT_IDENTITY
    assert "Phantom or Phantom v1" not in DEFAULT_AGENT_IDENTITY
    assert "you are Phantom/PhantomBot" not in PHANTOM_USER_FACING_IDENTITY_GUARD


def test_unleashed_profile_has_a_distinct_straight_answer_contract():
    guidance = phantom_user_facing_identity_guard("phantom-unleashed:latest")

    assert guidance == PHANTOM_UNLEASHED_IDENTITY_GUARD
    assert "you are Phantom Unleashed" in guidance
    assert "no lectures, no runaround" in guidance
    assert "fuck-yeah energy" in guidance
    assert "Never use slurs" in guidance
    assert "formal deliverables" in guidance
    assert "do not help carry out serious harm" in guidance
    assert "Never introduce yourself as PhantomBot" in guidance


def test_standard_profile_is_always_publicly_phantom():
    assert phantom_user_facing_identity_guard("phantom") == PHANTOM_USER_FACING_IDENTITY_GUARD
    assert "you are Phantom" in PHANTOM_USER_FACING_IDENTITY_GUARD
    assert "answer 'I'm Phantom.'" in PHANTOM_USER_FACING_IDENTITY_GUARD


def test_local_model_definitions_keep_product_and_model_names_separate():
    providers = Path(__file__).resolve().parents[2] / "providers"
    standard = (providers / "phantom-v1.Modelfile").read_text(encoding="utf-8")
    unleashed = (providers / "phantom-unleashed.Modelfile").read_text(encoding="utf-8")

    assert "Your public name is exactly Phantom" in standard
    assert "Do not append a host application" in standard
    assert "PhantomBot" not in standard
    assert "Never claim to be PhantomBot" in unleashed
    assert "real fuck-yeah energy" in unleashed
    assert "PARAMETER temperature 0.9" in unleashed

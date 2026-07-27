import json
import re

from hermes_cli.config import DEFAULT_CONFIG


def test_phantombot_auto_routing_defaults_are_non_secret_and_lane_specific():
    auto_routing = DEFAULT_CONFIG["phantombot"]["autoRouting"]

    assert auto_routing == {
        "version": 1,
        "routes": {
            "reasoning": {"option_id": "openrouter.glm-5.2"},
            "image": {"option_id": "openai.gpt-image-1"},
            "video": {"option_id": "higgsfield.subscription"},
        },
    }
    assert re.search(r"api[_-]?key|token|secret|password", json.dumps(auto_routing), re.IGNORECASE) is None

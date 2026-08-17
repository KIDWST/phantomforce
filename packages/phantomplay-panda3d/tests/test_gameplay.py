from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from phantomplay_native.gameplay import (
    CubeTownState,
    RESIDENT_QUESTS,
    VESPER_ROOMS,
    VesperCampaign,
    season_for_day,
    terrain_at,
    weather_for_day,
)
from phantomplay_native.state import SaveStore, read_enabled_mods


class VespergateCampaignTests(unittest.TestCase):
    def test_every_room_has_a_forward_progression_after_clear(self) -> None:
        campaign = VesperCampaign()
        visited: list[str] = []
        while True:
            visited.append(campaign.room.id)
            campaign.clear_room()
            self.assertTrue(campaign.room_cleared)
            self.assertTrue(campaign.advance())
            if campaign.finished:
                break
        self.assertEqual(visited, [room.id for room in VESPER_ROOMS])
        self.assertEqual(campaign.progress, 100)

    def test_uncleared_combat_room_cannot_be_skipped(self) -> None:
        campaign = VesperCampaign()
        self.assertFalse(campaign.advance())
        self.assertEqual(campaign.room_index, 0)

    def test_campaign_round_trip_clamps_unknown_rooms(self) -> None:
        campaign = VesperCampaign.from_dict(
            {"room_index": 999, "cleared_rooms": ["hollow1", "not-a-room"], "hp": 80}
        )
        self.assertEqual(campaign.room.id, "glassheart")
        self.assertEqual(campaign.cleared_rooms, ["hollow1"])
        self.assertEqual(campaign.hp, 80)


class CubeTownSimulationTests(unittest.TestCase):
    def test_world_generation_is_deterministic_and_has_resource_biomes(self) -> None:
        sample_a = [terrain_at(91, x, y) for x in range(-20, 21) for y in range(-20, 21)]
        sample_b = [terrain_at(91, x, y) for x in range(-20, 21) for y in range(-20, 21)]
        self.assertEqual(sample_a, sample_b)
        self.assertTrue({"grass", "water", "grove", "quarry", "reed"}.issubset(set(sample_a)))

    def test_season_and_weather_repeat_deterministically(self) -> None:
        self.assertEqual(season_for_day(1), "Spring")
        self.assertEqual(season_for_day(25), "Spring")
        values = [weather_for_day(422, day) for day in range(1, 50)]
        self.assertEqual(values, [weather_for_day(422, day) for day in range(1, 50)])
        self.assertTrue(set(values).issubset({"Clear", "Rain", "Fog", "Snow"}))

    def test_gather_build_and_resident_quest_change_persistent_state(self) -> None:
        state = CubeTownState()
        state.inventory["shale"] = 10
        build_at = next(
            (x, y)
            for x in range(5, 30)
            for y in range(5, 30)
            if terrain_at(state.seed, x, y) == "grass"
        )
        self.assertTrue(state.build(*build_at, "wall"))
        self.assertEqual(state.inventory["shale"], 8)
        quest = RESIDENT_QUESTS[0]
        state.inventory[quest.resource] = quest.amount
        self.assertTrue(state.turn_in(quest.id))
        self.assertIn(quest.id, state.quests_done)
        self.assertEqual(state.inventory["keystone"], 1)


class NativePersistenceTests(unittest.TestCase):
    def test_save_store_writes_valid_atomic_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SaveStore("cubetown", Path(directory))
            store.save({"day": 7, "buildings": [{"x": 1, "y": 2, "kind": "lamp"}]})
            self.assertEqual(store.load()["day"], 7)
            self.assertEqual(json.loads(store.path.read_text(encoding="utf-8"))["day"], 7)
            self.assertEqual(list(Path(directory).glob("*.tmp")), [])

    def test_native_mod_reader_uses_the_web_manifest_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mods = root / "app" / "games" / "vespergate" / "mods"
            mods.mkdir(parents=True)
            (root / "app" / "games" / "vespergate" / "index.html").write_text("", encoding="utf-8")
            (mods / ".enabled.json").write_text('["vg_god_mode", "vg_room_warp"]', encoding="utf-8")
            self.assertEqual(read_enabled_mods(root, "vespergate"), {"vg_god_mode", "vg_room_warp"})


if __name__ == "__main__":
    unittest.main()

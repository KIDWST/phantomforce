from __future__ import annotations

from dataclasses import asdict, dataclass, field
from math import hypot
from typing import Any


@dataclass(frozen=True)
class VesperRoom:
    id: str
    name: str
    chapter: str
    threats: int
    enemy_hp: int
    boss: bool = False
    restoration: bool = False


VESPER_ROOMS = (
    VesperRoom("hollow1", "The Hollow Geometry - Outer Measure", "THE SILENT BELL", 6, 34),
    VesperRoom("hollow2", "The Resonant Crossing", "THE SILENT BELL", 8, 42),
    VesperRoom("hollowboss", "The Bronze Choirloft", "THE SILENT BELL", 1, 360, boss=True),
    VesperRoom("bronzeheart", "The Heart of Bronze", "THE SILENT BELL", 0, 0, restoration=True),
    VesperRoom("ossuary1", "The Glass Ossuary - Memory Nave", "THE GLASS BELOW", 7, 48),
    VesperRoom("ossuary2", "The Mirror Processional", "THE GLASS BELOW", 9, 54),
    VesperRoom("ossuaryboss", "The Choir of Glass", "THE GLASS BELOW", 1, 480, boss=True),
    VesperRoom("glassheart", "The Heart of Glass", "EVENSONG", 0, 0, restoration=True),
)


@dataclass
class VesperCampaign:
    room_index: int = 0
    cleared_rooms: list[str] = field(default_factory=list)
    hp: int = 160
    max_hp: int = 160
    embers: int = 40
    souls: int = 0
    score: int = 0
    gates_unlocked: bool = True
    finished: bool = False

    @property
    def room(self) -> VesperRoom:
        return VESPER_ROOMS[min(self.room_index, len(VESPER_ROOMS) - 1)]

    @property
    def room_cleared(self) -> bool:
        return self.room.id in self.cleared_rooms or self.room.threats == 0

    @property
    def progress(self) -> int:
        return round(len(set(self.cleared_rooms)) / len(VESPER_ROOMS) * 100)

    def clear_room(self) -> None:
        if self.room.id not in self.cleared_rooms:
            self.cleared_rooms.append(self.room.id)
            self.score += 900 if self.room.boss else 250
            self.souls += 80 if self.room.boss else max(12, self.room.threats * 4)

    def advance(self) -> bool:
        if not self.room_cleared:
            return False
        if self.room_index >= len(VESPER_ROOMS) - 1:
            self.finished = True
            return True
        self.room_index += 1
        if self.room.restoration:
            self.hp = self.max_hp
        return True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "VesperCampaign":
        campaign = cls()
        for key in asdict(campaign):
            if key in value and isinstance(value[key], type(getattr(campaign, key))):
                setattr(campaign, key, value[key])
        campaign.room_index = max(0, min(campaign.room_index, len(VESPER_ROOMS) - 1))
        campaign.cleared_rooms = [room for room in campaign.cleared_rooms if room in {r.id for r in VESPER_ROOMS}]
        return campaign


SEASONS = ("Spring", "Summer", "Autumn", "Winter")
WEATHER = {
    "Spring": (("Clear", 50), ("Rain", 35), ("Fog", 15)),
    "Summer": (("Clear", 70), ("Rain", 20), ("Fog", 10)),
    "Autumn": (("Clear", 45), ("Rain", 30), ("Fog", 25)),
    "Winter": (("Clear", 40), ("Snow", 45), ("Fog", 15)),
}


def mix32(value: int) -> int:
    value &= 0xFFFFFFFF
    value ^= value >> 16
    value = (value * 0x7FEB352D) & 0xFFFFFFFF
    value ^= value >> 15
    value = (value * 0x846CA68B) & 0xFFFFFFFF
    value ^= value >> 16
    return value & 0xFFFFFFFF


def terrain_at(seed: int, x: int, y: int) -> str:
    if abs(x) <= 4 and abs(y) <= 4:
        return "grass"
    roll = mix32(seed ^ (x * 0x9E3779B1) ^ (y * 0x85EBCA77)) % 100
    if roll < 8:
        return "water"
    if roll < 21:
        return "grove"
    if roll < 31:
        return "quarry"
    if roll < 40:
        return "reed"
    return "grass"


def season_for_day(day: int) -> str:
    return SEASONS[((max(1, day) - 1) // 6) % len(SEASONS)]


def weather_for_day(seed: int, day: int) -> str:
    season = season_for_day(day)
    roll = mix32(seed ^ (day * 0x9E3779B1)) % 100
    cursor = 0
    for label, weight in WEATHER[season]:
        cursor += weight
        if roll < cursor:
            return label
    return WEATHER[season][-1][0]


@dataclass(frozen=True)
class ResidentQuest:
    id: str
    name: str
    resource: str
    amount: int
    reward: str


RESIDENT_QUESTS = (
    ResidentQuest("miro", "Miro the Mason", "shale", 5, "Sun Keystone"),
    ResidentQuest("tally", "Tally the Weaver", "loom", 4, "Moon Keystone"),
    ResidentQuest("bo", "Bo the Angler", "driftfish", 3, "Tide Keystone"),
    ResidentQuest("runa", "Runa the Ranger", "grain", 8, "Lumen"),
    ResidentQuest("ivy", "Ivy the Gardener", "grain", 5, "Lumen"),
)


@dataclass
class CubeTownState:
    seed: int = 0xC0B37A
    day: int = 1
    minutes: float = 470.0
    spark: int = 100
    inventory: dict[str, int] = field(
        default_factory=lambda: {"grain": 3, "shale": 2, "loom": 2, "driftfish": 0, "keystone": 0, "lumen": 0}
    )
    buildings: list[dict[str, Any]] = field(default_factory=list)
    quests_done: list[str] = field(default_factory=list)
    discovered: list[str] = field(default_factory=lambda: ["town-square"])
    defeated: list[str] = field(default_factory=list)
    score: int = 0

    @property
    def season(self) -> str:
        return season_for_day(self.day)

    @property
    def weather(self) -> str:
        return weather_for_day(self.seed, self.day)

    @property
    def progress(self) -> int:
        return round(len(self.quests_done) / len(RESIDENT_QUESTS) * 100)

    def tick_minutes(self, amount: float) -> bool:
        self.minutes += amount
        if self.minutes < 1440:
            return False
        self.minutes %= 1440
        self.day += 1
        decay = 1 if self.season == "Summer" else 3 if self.season == "Winter" else 2
        self.spark = max(0, self.spark - decay)
        return True

    def gather(self, terrain: str) -> tuple[str, int] | None:
        resource = {"grove": "grain", "quarry": "shale", "reed": "loom", "water": "driftfish"}.get(terrain)
        if not resource:
            return None
        amount = 1
        if resource == "grain" and self.weather == "Rain":
            amount = 2
        self.inventory[resource] = self.inventory.get(resource, 0) + amount
        self.score += 4 * amount
        return resource, amount

    def build(self, x: int, y: int, kind: str) -> bool:
        costs = {"floor": ("grain", 1), "wall": ("shale", 2), "lamp": ("loom", 1)}
        resource, cost = costs.get(kind, costs["floor"])
        if self.inventory.get(resource, 0) < cost:
            return False
        if any(item.get("x") == x and item.get("y") == y for item in self.buildings):
            return False
        if terrain_at(self.seed, x, y) != "grass":
            return False
        self.inventory[resource] -= cost
        self.buildings.append({"x": x, "y": y, "kind": kind})
        self.score += 8
        return True

    def demolish(self, x: int, y: int) -> bool:
        for index, item in enumerate(self.buildings):
            if item.get("x") == x and item.get("y") == y:
                self.buildings.pop(index)
                return True
        return False

    def turn_in(self, quest_id: str) -> bool:
        quest = next((item for item in RESIDENT_QUESTS if item.id == quest_id), None)
        if not quest or quest_id in self.quests_done:
            return False
        if self.inventory.get(quest.resource, 0) < quest.amount:
            return False
        self.inventory[quest.resource] -= quest.amount
        self.quests_done.append(quest_id)
        if "Keystone" in quest.reward:
            self.inventory["keystone"] = self.inventory.get("keystone", 0) + 1
        else:
            self.inventory["lumen"] = self.inventory.get("lumen", 0) + 1
        self.score += 55
        return True

    def nearest_building(self, x: float, y: float, radius: float = 1.7) -> dict[str, Any] | None:
        return next(
            (item for item in self.buildings if hypot(float(item["x"]) - x, float(item["y"]) - y) <= radius),
            None,
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "CubeTownState":
        state = cls()
        for key in asdict(state):
            if key in value and isinstance(value[key], type(getattr(state, key))):
                setattr(state, key, value[key])
        state.day = max(1, state.day)
        state.minutes %= 1440
        state.quests_done = [quest for quest in state.quests_done if quest in {q.id for q in RESIDENT_QUESTS}]
        return state

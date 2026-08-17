from __future__ import annotations

import math
from pathlib import Path

from panda3d.core import NodePath, Point3, Vec3

from .gameplay import CubeTownState, RESIDENT_QUESTS, mix32, terrain_at
from .runtime import NativeGame, apply_fog
from .state import SaveStore


TERRAIN_COLORS = {
    "grass": (0.20, 0.48, 0.29, 1),
    "water": (0.10, 0.45, 0.67, 0.86),
    "grove": (0.18, 0.38, 0.18, 1),
    "quarry": (0.37, 0.42, 0.48, 1),
    "reed": (0.40, 0.56, 0.23, 1),
}

SEASON_TINT = {
    "Spring": (1.05, 1.12, 1.03),
    "Summer": (1.10, 1.02, 0.88),
    "Autumn": (1.12, 0.82, 0.55),
    "Winter": (0.78, 0.93, 1.12),
}


class CubeTownGame(NativeGame):
    chunk_radius = 14

    def __init__(
        self,
        store: SaveStore,
        mods: set[str],
        screenshot_path: Path | None = None,
    ) -> None:
        super().__init__("cubetown", "CubeTown: Living World", store, mods, screenshot_path)
        self.state = CubeTownState.from_dict(store.load())
        self.world_root = self.render.attachNewNode("cubetown-streamed-world")
        self.building_root = self.render.attachNewNode("cubetown-buildings")
        self.resident_root = self.render.attachNewNode("cubetown-residents")
        self.creature_root = self.render.attachNewNode("cubetown-wilds")
        self.weather_root = self.render.attachNewNode("cubetown-weather")
        self.player = self._make_character("mayor", (0.95, 0.47, 0.29, 1), 1.0)
        self.player.setPos(0, 0, 0.58)
        self.player_velocity = Vec3()
        self.facing = Vec3(0, 1, 0)
        self.camera_distance = 25.0
        self.loaded_center = (99_999, 99_999)
        self.residents: list[dict[str, object]] = []
        self.creatures: list[dict[str, object]] = []
        self.weather_particles: list[NodePath] = []
        self.build_kinds = ("floor", "wall", "lamp")
        self.build_index = 0
        self.attack_cooldown = 0.0
        self.hurt_cooldown = 0.0
        self.fog = apply_fog(self.render, "town-distance", (0.20, 0.28, 0.34), 34, 72)

        self.accept("e", self.interact)
        self.accept("b", self.build)
        self.accept("r", self.cycle_build)
        self.accept("x", self.demolish)
        self.accept("mouse1", self.strike)
        self.accept("space", self.strike)
        self.controls.setText("WASD MOVE   E GATHER/TALK   B BUILD   R CHANGE PIECE   X DEMOLISH   LMB/SPACE STRIKE")
        self._spawn_residents()
        self._refresh_world(force=True)
        self._configure_weather(force=True)
        self._update_hud()
        self._game_ready = True

    def _make_character(self, name: str, color: tuple[float, float, float, float], scale: float) -> NodePath:
        root = self.render.attachNewNode(name)
        self.make_box(f"{name}-shadow", (0, 0, -0.48), (0.43 * scale, 0.43 * scale, 0.04), (0.02, 0.03, 0.025, 0.6), root)
        self.make_box(f"{name}-feet", (0, 0, -0.16), (0.35 * scale, 0.31 * scale, 0.25 * scale), (0.16, 0.20, 0.23, 1), root)
        self.make_box(f"{name}-body", (0, 0, 0.28 * scale), (0.48 * scale, 0.40 * scale, 0.60 * scale), color, root)
        self.make_box(f"{name}-head", (0, 0, 0.83 * scale), (0.38 * scale, 0.38 * scale, 0.38 * scale), (0.92, 0.78, 0.62, 1), root)
        self.make_box(f"{name}-face", (0, -0.34 * scale, 0.85 * scale), (0.23 * scale, 0.05, 0.11 * scale), (0.13, 0.18, 0.20, 1), root)
        return root

    def _refresh_world(self, force: bool = False) -> None:
        position = self.player.getPos(self.render)
        center = (round(position.x / 8) * 8, round(position.y / 8) * 8)
        if not force and center == self.loaded_center:
            return
        self.loaded_center = center
        self.world_root.removeNode()
        self.building_root.removeNode()
        self.creature_root.removeNode()
        self.world_root = self.render.attachNewNode("cubetown-streamed-world")
        self.building_root = self.render.attachNewNode("cubetown-buildings")
        self.creature_root = self.render.attachNewNode("cubetown-wilds")
        self.creatures.clear()
        tint = SEASON_TINT[self.state.season]
        cx, cy = center
        for x in range(cx - self.chunk_radius, cx + self.chunk_radius + 1):
            for y in range(cy - self.chunk_radius, cy + self.chunk_radius + 1):
                terrain = terrain_at(self.state.seed, x, y)
                base = TERRAIN_COLORS[terrain]
                shade = 0.94 + ((mix32(self.state.seed ^ x * 31 ^ y * 131) % 9) / 100)
                color = (
                    min(1, base[0] * tint[0] * shade),
                    min(1, base[1] * tint[1] * shade),
                    min(1, base[2] * tint[2] * shade),
                    base[3],
                )
                z = -0.34 if terrain == "water" else -0.25
                tile = self.make_box(f"tile-{x}-{y}-{terrain}", (x, y, z), (0.49, 0.49, 0.20), color, self.world_root)
                if terrain == "water":
                    tile.setTransparency(True)
                self._add_terrain_detail(x, y, terrain)

        self._add_town_landmarks()
        for building in self.state.buildings:
            x = building.get("x")
            y = building.get("y")
            if isinstance(x, int) and isinstance(y, int) and abs(x - cx) <= self.chunk_radius and abs(y - cy) <= self.chunk_radius:
                self._render_building(x, y, str(building.get("kind", "floor")))
        self._spawn_wilds_creatures()
        self.toast(f"Streaming sector {center[0]:+d}, {center[1]:+d}", 1.0)

    def _add_terrain_detail(self, x: int, y: int, terrain: str) -> None:
        roll = mix32(self.state.seed ^ x * 0x45D9F3B ^ y * 0x119DE1F3)
        if terrain == "grove":
            self.make_box("tree-trunk", (x, y, 0.36), (0.15, 0.15, 0.70), (0.38, 0.22, 0.12, 1), self.world_root)
            crown = self.make_box("tree-crown", (x, y, 1.22), (0.48, 0.48, 0.58), (0.16, 0.45, 0.22, 1), self.world_root)
            crown.setH(45)
        elif terrain == "quarry":
            rock = self.make_box("shale", (x, y, 0.18), (0.39, 0.34, 0.45), (0.47, 0.52, 0.61, 1), self.world_root)
            rock.setHpr(roll % 90, 18, 10)
        elif terrain == "reed":
            for offset in (-0.25, 0, 0.25):
                self.make_box("loom-reed", (x + offset, y + ((roll >> 4) % 5 - 2) * 0.06, 0.28), (0.05, 0.05, 0.52), (0.61, 0.75, 0.28, 1), self.world_root)
        elif terrain == "water" and roll % 7 == 0:
            lily = self.make_box("lily", (x + 0.18, y - 0.12, -0.08), (0.22, 0.22, 0.025), (0.32, 0.68, 0.38, 1), self.world_root)
            lily.setH(45)

    def _add_town_landmarks(self) -> None:
        if abs(self.loaded_center[0]) > self.chunk_radius or abs(self.loaded_center[1]) > self.chunk_radius:
            return
        for x in range(-4, 5):
            self.make_box("town-path", (x, 0, -0.02), (0.48, 0.48, 0.08), (0.72, 0.62, 0.43, 1), self.world_root)
        for y in range(-4, 5):
            self.make_box("town-path", (0, y, -0.015), (0.48, 0.48, 0.08), (0.72, 0.62, 0.43, 1), self.world_root)
        self.make_box("town-well", (0, 0, 0.32), (0.82, 0.82, 0.50), (0.38, 0.48, 0.57, 1), self.world_root)
        self.make_box("well-water", (0, 0, 0.62), (0.61, 0.61, 0.05), (0.18, 0.68, 0.82, 0.9), self.world_root).setTransparency(True)
        houses = ((-5, -4, (0.90, 0.48, 0.32, 1)), (5, -4, (0.46, 0.72, 0.63, 1)), (-5, 5, (0.58, 0.48, 0.78, 1)), (5, 5, (0.84, 0.67, 0.34, 1)))
        for x, y, color in houses:
            self.make_box("resident-home", (x, y, 0.72), (1.45, 1.25, 1.10), color, self.world_root)
            roof = self.make_box("resident-roof", (x, y, 1.88), (1.62, 1.42, 0.28), (0.24, 0.20, 0.23, 1), self.world_root)
            roof.setH(45)
            self.make_box("home-door", (x, y - 1.28, 0.46), (0.34, 0.08, 0.62), (0.34, 0.23, 0.16, 1), self.world_root)

    def _render_building(self, x: int, y: int, kind: str) -> None:
        if kind == "wall":
            self.make_box("built-wall", (x, y, 0.52), (0.47, 0.47, 0.78), (0.51, 0.58, 0.67, 1), self.building_root)
        elif kind == "lamp":
            self.make_box("built-lamp-post", (x, y, 0.48), (0.10, 0.10, 0.72), (0.24, 0.29, 0.32, 1), self.building_root)
            glow = self.make_box("built-lamp-glow", (x, y, 1.08), (0.28, 0.28, 0.28), (1.0, 0.80, 0.32, 1), self.building_root)
            glow.setLightOff(1)
        else:
            self.make_box("built-floor", (x, y, -0.01), (0.47, 0.47, 0.08), (0.82, 0.69, 0.45, 1), self.building_root)

    def _spawn_residents(self) -> None:
        colors = ((0.95, 0.58, 0.31, 1), (0.67, 0.48, 0.84, 1), (0.25, 0.73, 0.84, 1), (0.92, 0.34, 0.24, 1), (0.42, 0.76, 0.38, 1))
        anchors = ((-3, -2), (3, -2), (-3, 2), (3, 2), (0, 4))
        for quest, color, anchor in zip(RESIDENT_QUESTS, colors, anchors, strict=True):
            node = self._make_character(quest.id, color, 0.9)
            node.reparentTo(self.resident_root)
            node.setPos(anchor[0], anchor[1], 0.54)
            self.residents.append({"quest": quest, "node": node, "anchor": anchor, "phase": len(self.residents) * 1.3})

    def _spawn_wilds_creatures(self) -> None:
        cx, cy = self.loaded_center
        if math.hypot(cx, cy) < 8:
            return
        for index in range(6):
            roll = mix32(self.state.seed ^ cx * 97 ^ cy * 193 ^ index * 977)
            x = cx + int(roll % 21) - 10
            y = cy + int((roll >> 9) % 21) - 10
            creature_id = f"glimmer:{x}:{y}"
            if creature_id in self.state.defeated or terrain_at(self.state.seed, x, y) != "grass":
                continue
            node = self.render.attachNewNode(creature_id)
            node.reparentTo(self.creature_root)
            node.setPos(x, y, 0.52)
            self.make_box("glimmer-shadow", (0, 0, -0.44), (0.38, 0.38, 0.04), (0.02, 0.04, 0.04, 0.55), node)
            body = self.make_box("glimmer-body", (0, 0, 0.12), (0.45, 0.45, 0.46), (0.28, 0.88, 0.72, 1), node)
            body.setH(45)
            self.make_box("glimmer-eye", (-0.15, -0.35, 0.23), (0.055, 0.04, 0.07), (0.05, 0.09, 0.09, 1), node)
            self.make_box("glimmer-eye", (0.15, -0.35, 0.23), (0.055, 0.04, 0.07), (0.05, 0.09, 0.09, 1), node)
            self.creatures.append({"id": creature_id, "node": node, "hp": 3, "cooldown": 0.4 + index * 0.2, "phase": index})

    def _configure_weather(self, force: bool = False) -> None:
        del force
        self.weather_root.removeNode()
        self.weather_root = self.render.attachNewNode("cubetown-weather")
        self.weather_particles.clear()
        weather = self.state.weather
        if weather == "Fog":
            self.fog.setLinearRange(23, 56)
        else:
            self.fog.setLinearRange(34, 72)
        if weather not in {"Rain", "Snow"}:
            return
        color = (0.44, 0.72, 0.94, 0.72) if weather == "Rain" else (0.92, 0.96, 1.0, 0.92)
        for index in range(80):
            roll = mix32(self.state.seed ^ self.state.day * 313 ^ index * 191)
            x = (roll % 2800) / 100 - 14
            y = ((roll >> 10) % 2800) / 100 - 14
            z = 1.5 + ((roll >> 20) % 1100) / 100
            scale = (0.018, 0.018, 0.24) if weather == "Rain" else (0.055, 0.055, 0.055)
            node = self.make_box("weather-drop", (x, y, z), scale, color, self.weather_root)
            node.setLightOff(1)
            node.setTransparency(True)
            self.weather_particles.append(node)

    def _front_tile(self) -> tuple[int, int]:
        position = self.player.getPos(self.render)
        return round(position.x + self.facing.x * 1.5), round(position.y + self.facing.y * 1.5)

    def interact(self) -> None:
        if self.paused:
            return
        player_pos = self.player.getPos(self.render)
        resident = min(self.residents, key=lambda item: (item["node"].getPos(self.render) - player_pos).length(), default=None)
        if resident and (resident["node"].getPos(self.render) - player_pos).length() <= 2.2:
            quest = resident["quest"]
            if quest.id in self.state.quests_done:
                self.toast(f"{quest.name}: The town remembers what you did.")
            elif self.state.turn_in(quest.id):
                self.toast(f"Quest complete - {quest.reward} received", 3.2)
                self.save_game()
            else:
                have = self.state.inventory.get(quest.resource, 0)
                self.toast(f"{quest.name}: bring {quest.amount} {quest.resource} ({have}/{quest.amount})", 3.0)
            self._update_hud()
            return

        px, py = round(player_pos.x), round(player_pos.y)
        candidates: list[tuple[float, int, int, str]] = []
        for x in range(px - 2, px + 3):
            for y in range(py - 2, py + 3):
                terrain = terrain_at(self.state.seed, x, y)
                if terrain != "grass":
                    candidates.append((math.hypot(x - player_pos.x, y - player_pos.y), x, y, terrain))
        if candidates and candidates[0][0] <= 2.3:
            _, _, _, terrain = min(candidates)
            result = self.state.gather(terrain)
            if result:
                resource, amount = result
                self.toast(f"Gathered {amount} {resource}")
                self.save_game()
                self._update_hud()
                return
        self.toast("Nothing close enough to interact with")

    def build(self) -> None:
        x, y = self._front_tile()
        kind = self.build_kinds[self.build_index]
        if self.state.build(x, y, kind):
            self._render_building(x, y, kind)
            self.toast(f"Built {kind} at {x}, {y}")
            self.save_game()
        else:
            self.toast(f"Cannot build {kind} there - check terrain and materials")
        self._update_hud()

    def cycle_build(self) -> None:
        self.build_index = (self.build_index + 1) % len(self.build_kinds)
        self.toast(f"Build piece: {self.build_kinds[self.build_index]}")
        self._update_hud()

    def demolish(self) -> None:
        x, y = self._front_tile()
        if self.state.demolish(x, y):
            self._refresh_world(force=True)
            self.toast("Piece reclaimed")
            self.save_game()
        else:
            self.toast("No placed piece there")

    def strike(self) -> None:
        if self.paused or self.attack_cooldown > 0:
            return
        self.attack_cooldown = 0.38
        position = self.player.getPos(self.render)
        self.flash_line(position + Vec3(0, 0, 0.2), position + self.facing * 2.2 + Vec3(0, 0, 0.2), (1.0, 0.82, 0.36, 1), 0.11, 7)
        for creature in list(self.creatures):
            node = creature["node"]
            assert isinstance(node, NodePath)
            offset = node.getPos(self.render) - position
            offset.z = 0
            if offset.length() <= 2.4 and offset.normalized().dot(self.facing) > 0.15:
                creature["hp"] = int(creature["hp"]) - 1
                node.setColorScale(1, 0.38, 0.32, 1)
                if int(creature["hp"]) <= 0:
                    self.state.defeated.append(str(creature["id"]))
                    self.state.inventory["lumen"] = self.state.inventory.get("lumen", 0) + 1
                    self.state.score += 30
                    node.removeNode()
                    self.creatures.remove(creature)
                    self.toast("Wild glimmer settled - +1 Lumen")
                    self.save_game()
                break

    def _walkable(self, position: Point3) -> bool:
        terrain = terrain_at(self.state.seed, round(position.x), round(position.y))
        if terrain in {"water", "grove", "quarry"}:
            return False
        for building in self.state.buildings:
            if building.get("kind") == "wall" and abs(float(building["x"]) - position.x) < 0.72 and abs(float(building["y"]) - position.y) < 0.72:
                return False
        return True

    def update_game(self, dt: float) -> None:
        self.attack_cooldown = max(0, self.attack_cooldown - dt)
        self.hurt_cooldown = max(0, self.hurt_cooldown - dt)
        movement = self.movement_vector()
        if movement.lengthSquared() > 0.01:
            self.facing = Vec3(movement)
        weather_slow = 0.82 if self.state.weather == "Snow" else 1.0
        desired = movement * 6.2 * weather_slow
        self.player_velocity += (desired - self.player_velocity) * min(1.0, dt * 10)
        current = self.player.getPos(self.render)
        candidate_x = current + Vec3(self.player_velocity.x * dt, 0, 0)
        candidate_y = current + Vec3(0, self.player_velocity.y * dt, 0)
        if self._walkable(candidate_x):
            current.x = candidate_x.x
        if self._walkable(candidate_y):
            current.y = candidate_y.y
        self.player.setPos(current)
        if movement.lengthSquared() > 0.01:
            self.player.setH(math.degrees(math.atan2(-movement.x, movement.y)))
        self._refresh_world()

        old_day = self.state.day
        if self.state.tick_minutes(dt * 4.8) and self.state.day != old_day:
            self._configure_weather(force=True)
            self._refresh_world(force=True)
            self.toast(f"Day {self.state.day} - {self.state.season}, {self.state.weather}", 3)
            self.save_game()

        segment = "work" if 420 <= self.state.minutes < 960 else "square" if 960 <= self.state.minutes < 1200 else "home"
        for index, resident in enumerate(self.residents):
            node = resident["node"]
            assert isinstance(node, NodePath)
            anchor_x, anchor_y = resident["anchor"]
            if segment == "work":
                target = Point3(anchor_x * 1.7, anchor_y * 1.7, 0.54)
            elif segment == "square" and self.state.weather not in {"Rain", "Snow"}:
                angle = index / len(self.residents) * math.tau
                target = Point3(math.cos(angle) * 2.3, math.sin(angle) * 2.3, 0.54)
            else:
                target = Point3(anchor_x, anchor_y, 0.54)
            delta = target - node.getPos(self.render)
            if delta.lengthSquared() > 0.03:
                node.setPos(node.getPos() + delta * min(1.0, dt * 0.65))
            phase = float(resident["phase"]) + dt
            resident["phase"] = phase
            node.setZ(0.54 + math.sin(phase * 2) * 0.025)

        for creature in list(self.creatures):
            node = creature["node"]
            assert isinstance(node, NodePath)
            creature["cooldown"] = float(creature["cooldown"]) - dt
            delta = self.player.getPos(self.render) - node.getPos(self.render)
            delta.z = 0
            if 1.0 < delta.length() < 7.5:
                delta.normalize()
                node.setPos(node.getPos() + delta * dt * 1.35)
            elif delta.length() <= 1.0 and float(creature["cooldown"]) <= 0 and self.hurt_cooldown <= 0:
                creature["cooldown"] = 1.2
                self.hurt_cooldown = 0.5
                self.state.spark = max(0, self.state.spark - 4)
                self.toast(f"Wild glimmer drained Spark - {self.state.spark}")
                if self.state.spark == 0:
                    self.state.spark = 55
                    self.player.setPos(0, 0, 0.58)
                    self._refresh_world(force=True)
                    self.toast("The town Hearth brought you home", 3)
            phase = float(creature["phase"]) + dt * 2.2
            creature["phase"] = phase
            node.setZ(0.52 + abs(math.sin(phase)) * 0.18)

        player_pos = self.player.getPos(self.render)
        if math.hypot(player_pos.x, player_pos.y) > 12 and "the-wilds" not in self.state.discovered:
            self.state.discovered.append("the-wilds")
            self.toast("Discovered: The Wilds", 2.6)
            self.save_game()
        self._update_weather_particles(dt)
        self._update_hud()

    def _update_weather_particles(self, dt: float) -> None:
        if not self.weather_particles:
            return
        player = self.player.getPos(self.render)
        rain = self.state.weather == "Rain"
        speed = 14.0 if rain else 2.8
        for index, particle in enumerate(self.weather_particles):
            particle.setZ(particle.getZ() - speed * dt)
            if not rain:
                particle.setX(particle.getX() + math.sin(self.elapsed + index) * dt * 0.22)
            if particle.getZ() < -0.1:
                particle.setPos(
                    player.x + ((index * 47) % 280) / 10 - 14,
                    player.y + ((index * 83) % 280) / 10 - 14,
                    9 + (index % 4),
                )

    def update_presentation(self, dt: float) -> None:
        del dt
        target = self.player.getPos(self.render)
        desired = Point3(target.x, target.y - self.camera_distance * 0.68, self.camera_distance * 0.70)
        self.camera.setPos(self.camera.getPos() + (desired - self.camera.getPos()) * 0.10)
        self.camera.lookAt(target.x, target.y + 1.4, 0)
        sky = {
            "Spring": (0.18, 0.30, 0.39),
            "Summer": (0.20, 0.34, 0.43),
            "Autumn": (0.31, 0.25, 0.29),
            "Winter": (0.24, 0.30, 0.37),
        }[self.state.season]
        night = 0.35 if self.state.minutes < 360 or self.state.minutes > 1200 else 1.0
        self.setBackgroundColor(sky[0] * night, sky[1] * night, sky[2] * night, 1)

    def _update_hud(self) -> None:
        hour = int(self.state.minutes // 60)
        minute = int(self.state.minutes % 60)
        inv = self.state.inventory
        self.hud_title.setText("CUBETOWN - LIVING WORLD")
        self.hud_status.setText(
            f"SPARK {self.state.spark}   DAY {self.state.day}  {hour:02d}:{minute:02d}   {self.state.season} / {self.state.weather}\n"
            f"GRAIN {inv.get('grain', 0)}   SHALE {inv.get('shale', 0)}   LOOM {inv.get('loom', 0)}   LUMEN {inv.get('lumen', 0)}"
        )
        next_quest = next((quest for quest in RESIDENT_QUESTS if quest.id not in self.state.quests_done), None)
        if next_quest:
            have = inv.get(next_quest.resource, 0)
            objective = f"RESIDENT QUEST {len(self.state.quests_done) + 1}/{len(RESIDENT_QUESTS)}\n{next_quest.name}: {have}/{next_quest.amount} {next_quest.resource}"
        else:
            objective = "TOWN RESTORED\nAll residents helped - keep building and exploring"
        self.hud_objective.setText(f"{objective}\nBUILD: {self.build_kinds[self.build_index].upper()}   SCORE {self.state.score}")

    def adjust_camera_distance(self, delta: int) -> None:
        self.camera_distance = max(17.0, min(38.0, self.camera_distance + delta * 2))

    def save_game(self) -> None:
        self.store.save(self.state.to_dict())

    def smoke_report(self) -> dict[str, object]:
        report = super().smoke_report()
        report.update(
            {
                "chunk_center": self.loaded_center,
                "season": self.state.season,
                "weather": self.state.weather,
                "residents": len(self.residents),
                "buildings": len(self.state.buildings),
            }
        )
        return report

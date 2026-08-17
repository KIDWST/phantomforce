from __future__ import annotations

import math
from pathlib import Path

from panda3d.core import NodePath, Point3, PointLight, Vec3

from .gameplay import VESPER_ROOMS, VesperCampaign, mix32
from .runtime import NativeGame, apply_fog
from .state import SaveStore


class VespergateGame(NativeGame):
    arena_x = 14.0
    arena_y = 9.0

    def __init__(
        self,
        store: SaveStore,
        mods: set[str],
        screenshot_path: Path | None = None,
    ) -> None:
        super().__init__("vespergate", "Vespergate: The Vesper Hand", store, mods, screenshot_path)
        self.campaign = VesperCampaign.from_dict(store.load())
        self.room_root = self.render.attachNewNode("vesper-room")
        self.enemy_root = self.render.attachNewNode("vesper-enemies")
        self.effect_root = self.render.attachNewNode("vesper-effects")
        self.enemies: list[dict[str, object]] = []
        self.projectiles: list[dict[str, object]] = []
        self.obstacles: list[tuple[float, float, float, float]] = []
        self.player = self._make_player()
        self.player.setPos(0, -6.2, 0.55)
        self.player_velocity = Vec3()
        self.attack_cooldown = 0.0
        self.shot_cooldown = 0.0
        self.beam_cooldown = 0.0
        self.hurt_cooldown = 0.0
        self.portal_cooldown = 0.0
        self.camera_distance = 28.0
        self.gates: dict[str, tuple[NodePath, Point3] | None] = {"dawn": None, "dusk": None}
        self.exit_portal: NodePath | None = None
        self.altar: NodePath | None = None

        self.accept("mouse1", self.strike)
        self.accept("space", self.strike)
        self.accept("mouse3", self.cinder_shot)
        self.accept("f", self.cinder_shot)
        self.accept("e", self.context_action)
        self.accept("q", self.place_gate, ["dawn"])
        self.accept("g", self.place_gate, ["dusk"])
        self.accept("r", self.vent_gates)
        self.accept("k", self.panic_clear)
        self.accept("m", self.room_warp)
        self.controls.setText("WASD MOVE   LMB/SPACE STRIKE   RMB/F CINDER   E BEAM/ENTER   Q/G LINKED GATES   R VENT")
        apply_fog(self.render, "vesper-haze", (0.025, 0.035, 0.07), 24, 62)
        self._load_room()
        self._game_ready = True

    def _make_player(self) -> NodePath:
        root = self.render.attachNewNode("vesper-bearer")
        self.make_box("bearer-shadow", (0, 0, -0.42), (0.62, 0.62, 0.05), (0.02, 0.02, 0.03, 0.7), root)
        self.make_box("bearer-boots", (0, 0, -0.15), (0.42, 0.34, 0.35), (0.12, 0.10, 0.16, 1), root)
        self.make_box("bearer-cloak", (0, 0.06, 0.34), (0.58, 0.36, 0.75), (0.20, 0.13, 0.34, 1), root)
        self.make_box("vesper-hand", (0.42, -0.03, 0.28), (0.13, 0.13, 0.42), (0.33, 0.72, 0.82, 1), root)
        self.make_box("bearer-head", (0, 0, 0.96), (0.34, 0.34, 0.34), (0.78, 0.73, 0.68, 1), root)
        return root

    def _clear_room_nodes(self) -> None:
        self.room_root.removeNode()
        self.enemy_root.removeNode()
        self.effect_root.removeNode()
        self.room_root = self.render.attachNewNode("vesper-room")
        self.enemy_root = self.render.attachNewNode("vesper-enemies")
        self.effect_root = self.render.attachNewNode("vesper-effects")
        self.enemies.clear()
        self.projectiles.clear()
        self.obstacles.clear()
        self.exit_portal = None
        self.altar = None
        self.gates = {"dawn": None, "dusk": None}

    def _load_room(self) -> None:
        self._clear_room_nodes()
        room = self.campaign.room
        self.player.setPos(0, -6.2, 0.55)
        palette = (
            ((0.10, 0.085, 0.15, 1), (0.27, 0.20, 0.11, 1), (0.88, 0.55, 0.18, 1))
            if room.chapter == "THE SILENT BELL"
            else ((0.065, 0.08, 0.15, 1), (0.14, 0.27, 0.36, 1), (0.50, 0.86, 1.0, 1))
        )
        floor_color, wall_color, accent = palette
        for x in range(-14, 15):
            for y in range(-9, 10):
                checker = 0.92 if (x + y) % 2 else 1.06
                color = tuple(min(1.0, channel * checker) for channel in floor_color[:3]) + (1.0,)
                self.make_box("liminal-floor", (x, y, -0.20), (0.49, 0.49, 0.18), color, self.room_root)

        for x in range(-15, 16):
            for y in (-10, 10):
                self.make_box("null-wall", (x, y, 1.0), (0.50, 0.50, 1.35), wall_color, self.room_root)
        for y in range(-9, 10):
            for x in (-15, 15):
                self.make_box("null-wall", (x, y, 1.0), (0.50, 0.50, 1.35), wall_color, self.room_root)

        for slot in range(7):
            roll = mix32((self.campaign.room_index + 11) * 977 + slot * 71)
            x = float(int(roll % 23) - 11)
            y = float(int((roll >> 8) % 10) - 2)
            width = 0.65 + ((roll >> 16) % 3) * 0.22
            if abs(x) < 2 and y < -3:
                continue
            self.make_box("choir-column", (x, y, 0.65), (width, width, 0.95), wall_color, self.room_root)
            self.obstacles.append((x, y, width + 0.35, width + 0.35))

        for x in (-9, -3, 3, 9):
            lamp = self.make_box("vesper-lantern", (x, 7.8, 0.9), (0.18, 0.18, 1.2), accent, self.room_root)
            lamp.setLightOff(1)

        if room.restoration:
            self.altar = self.make_box("restoration-heart", (0, 1.5, 0.8), (1.4, 1.4, 1.0), accent, self.room_root)
            self.altar.setHpr(45, 0, 45)
            self.campaign.clear_room()
        elif not self.campaign.room_cleared:
            self._spawn_enemies(room.threats, room.enemy_hp, room.boss)
        else:
            self._activate_exit()

        if room.restoration:
            self._activate_exit()
        self._update_hud()
        self.toast(room.name, 2.8)

    def _spawn_enemies(self, count: int, hp: int, boss: bool) -> None:
        for index in range(count):
            angle = (index / max(1, count)) * math.tau + 0.4
            radius = 4.5 if boss else 3.8 + (index % 3) * 1.7
            x = math.cos(angle) * radius
            y = 1.5 + math.sin(angle) * radius * 0.7
            node = self.render.attachNewNode(f"{'boss' if boss else 'mourner'}-{index}")
            node.reparentTo(self.enemy_root)
            node.setPos(x, y, 0.55)
            body_color = (0.48, 0.72, 0.86, 1) if self.campaign.room.chapter != "THE SILENT BELL" else (0.65, 0.38, 0.18, 1)
            scale = 1.8 if boss else 1.0
            self.make_box("enemy-shadow", (0, 0, -0.45), (0.52 * scale, 0.52 * scale, 0.04), (0, 0, 0, 0.65), node)
            self.make_box("enemy-body", (0, 0, 0.20 * scale), (0.55 * scale, 0.46 * scale, 0.75 * scale), body_color, node)
            face = self.make_box("enemy-mask", (0, -0.42 * scale, 0.72 * scale), (0.34 * scale, 0.08, 0.30 * scale), (0.88, 0.91, 0.96, 1), node)
            face.setLightOff(1)
            self.enemies.append(
                {"node": node, "hp": float(hp), "max_hp": float(hp), "boss": boss, "cooldown": 0.5 + index * 0.12, "phase": index * 0.7}
            )

    def _activate_exit(self) -> None:
        if self.exit_portal:
            return
        color = (0.46, 0.91, 1.0, 1) if self.campaign.room_index < 4 else (0.93, 0.64, 1.0, 1)
        self.exit_portal = self.make_portal("forward-gate", (0, 8.5, 0), color)
        light = PointLight("forward-light")
        light.setColor((color[0] * 0.8, color[1] * 0.8, color[2] * 0.8, 1))
        light.setAttenuation((1, 0, 0.08))
        light_np = self.exit_portal.attachNewNode(light)
        light_np.setPos(0, -0.2, 1.1)
        self.render.setLight(light_np)

    def _aim_direction(self) -> Vec3:
        target = self.mouse_ground_point(0.55)
        if target is not None:
            direction = target - self.player.getPos(self.render)
            direction.z = 0
            if direction.lengthSquared() > 0.1:
                direction.normalize()
                return direction
        if self.player_velocity.lengthSquared() > 0.05:
            direction = Vec3(self.player_velocity)
            direction.normalize()
            return direction
        return Vec3(0, 1, 0)

    def strike(self) -> None:
        if self.paused or self.attack_cooldown > 0:
            return
        self.attack_cooldown = 0.34
        origin = self.player.getPos(self.render)
        direction = self._aim_direction()
        self.flash_line(origin + Vec3(0, 0, 0.25), origin + direction * 2.8 + Vec3(0, 0, 0.25), (0.65, 0.94, 1, 1), 0.10, 7)
        damage = 10_000 if "vg_one_hit_kill" in self.mods else 42
        for enemy in list(self.enemies):
            offset = enemy["node"].getPos(self.render) - origin
            offset.z = 0
            if offset.length() <= 3.0 and offset.normalized().dot(direction) > 0.38:
                self._damage_enemy(enemy, damage)

    def cinder_shot(self) -> None:
        if self.paused or self.shot_cooldown > 0 or self.campaign.embers <= 0:
            return
        self.shot_cooldown = 0.20
        if "vg_infinite_embers" not in self.mods:
            self.campaign.embers -= 1
        direction = self._aim_direction()
        node = self.make_box("cinder-bolt", tuple(self.player.getPos(self.render) + direction * 0.8), (0.16, 0.16, 0.16), (1.0, 0.55, 0.18, 1), self.effect_root)
        node.setLightOff(1)
        self.projectiles.append({"node": node, "velocity": direction * 17, "life": 1.2})

    def context_action(self) -> None:
        if self.paused:
            return
        if self.exit_portal and (self.player.getPos(self.render) - Point3(0, 8.0, 0.55)).length() < 2.4:
            if self.campaign.advance():
                self.save_game()
                if self.campaign.finished:
                    self.toast("EVENSONG RESTORED - campaign complete", 5)
                else:
                    self._load_room()
            return
        self.fire_beam()

    def fire_beam(self) -> None:
        if self.beam_cooldown > 0 and "vg_beam_always_ready" not in self.mods:
            self.toast(f"Beam recharging: {self.beam_cooldown:.1f}s")
            return
        self.beam_cooldown = 0.15 if "vg_beam_always_ready" in self.mods else 4.5
        origin = self.player.getPos(self.render)
        direction = self._aim_direction()
        end = origin + direction * 20
        self.flash_line(origin + Vec3(0, 0, 0.35), end + Vec3(0, 0, 0.35), (0.60, 0.93, 1.0, 1), 0.20, 14)
        for enemy in list(self.enemies):
            offset = enemy["node"].getPos(self.render) - origin
            projection = offset.dot(direction)
            closest = offset - direction * projection
            if 0 <= projection <= 20 and closest.length() < (1.8 if enemy["boss"] else 0.9):
                self._damage_enemy(enemy, 10_000 if "vg_one_hit_kill" in self.mods else 120)

    def _damage_enemy(self, enemy: dict[str, object], damage: float) -> None:
        enemy["hp"] = float(enemy["hp"]) - damage
        node = enemy["node"]
        assert isinstance(node, NodePath)
        node.setColorScale(1.0, 0.32, 0.34, 1)
        if float(enemy["hp"]) > 0:
            return
        node.removeNode()
        self.enemies.remove(enemy)
        self.campaign.score += 180 if enemy["boss"] else 35
        self.campaign.souls += 80 if enemy["boss"] else 5
        if not self.enemies:
            self.campaign.clear_room()
            self._activate_exit()
            self.save_game()
            self.toast("ROOM RESTORED - the forward gate is open", 3.5)
        self._update_hud()

    def place_gate(self, gate_id: str) -> None:
        if not self.campaign.gates_unlocked:
            return
        old = self.gates[gate_id]
        if old:
            old[0].removeNode()
        direction = self._aim_direction()
        position = self.player.getPos(self.render) + direction * 2.2
        position.z = 0
        color = (0.31, 0.86, 1.0, 1) if gate_id == "dawn" else (1.0, 0.42, 0.76, 1)
        node = self.make_portal(f"{gate_id}-gate", (position.x, position.y, 0), color)
        node.setH(math.degrees(math.atan2(-direction.x, direction.y)))
        self.gates[gate_id] = (node, Point3(position))
        self.toast(f"{gate_id.title()} gate placed")

    def vent_gates(self) -> None:
        for gate in self.gates.values():
            if gate:
                gate[0].removeNode()
        self.gates = {"dawn": None, "dusk": None}
        self.portal_cooldown = 0
        self.toast("Gate strain vented")

    def panic_clear(self) -> None:
        if "vg_panic_clear" not in self.mods:
            self.toast("Enable Panic Button in PhantomPlay Mods first")
            return
        for enemy in list(self.enemies):
            self._damage_enemy(enemy, 100_000)

    def room_warp(self) -> None:
        if "vg_room_warp" not in self.mods:
            return
        self.campaign.clear_room()
        self._activate_exit()
        self.toast("Room warp armed - enter the forward gate")

    def _collides(self, position: Point3) -> bool:
        if abs(position.x) > self.arena_x or abs(position.y) > self.arena_y:
            return True
        return any(abs(position.x - x) < rx and abs(position.y - y) < ry for x, y, rx, ry in self.obstacles)

    def _update_portals(self) -> None:
        if self.portal_cooldown > 0 or not self.gates["dawn"] or not self.gates["dusk"]:
            return
        player_pos = self.player.getPos(self.render)
        for source_id, target_id in (("dawn", "dusk"), ("dusk", "dawn")):
            source = self.gates[source_id]
            target = self.gates[target_id]
            assert source and target
            if (player_pos - source[1]).length() < 0.8:
                offset = self._aim_direction() * 1.4
                destination = target[1] + offset
                destination.z = 0.55
                if not self._collides(destination):
                    self.player.setPos(destination)
                    self.portal_cooldown = 0.8
                    self.toast(f"Crossed {source_id.title()} to {target_id.title()}", 1.2)
                break

    def update_game(self, dt: float) -> None:
        self.attack_cooldown = max(0.0, self.attack_cooldown - dt)
        self.shot_cooldown = max(0.0, self.shot_cooldown - dt)
        self.beam_cooldown = max(0.0, self.beam_cooldown - dt)
        self.hurt_cooldown = max(0.0, self.hurt_cooldown - dt)
        self.portal_cooldown = max(0.0, self.portal_cooldown - dt)

        movement = self.movement_vector()
        speed = 8.0 * (1.8 if "vg_speed_demon" in self.mods else 0.5 if "vg_molasses" in self.mods else 1.0)
        desired = movement * speed
        self.player_velocity += (desired - self.player_velocity) * min(1.0, dt * 12)
        current = self.player.getPos(self.render)
        candidate_x = current + Vec3(self.player_velocity.x * dt, 0, 0)
        candidate_y = current + Vec3(0, self.player_velocity.y * dt, 0)
        if not self._collides(candidate_x):
            current.x = candidate_x.x
        if not self._collides(candidate_y):
            current.y = candidate_y.y
        self.player.setPos(current)
        if movement.lengthSquared() > 0.01:
            self.player.setH(math.degrees(math.atan2(-movement.x, movement.y)))
        self._update_portals()

        for projectile in list(self.projectiles):
            node = projectile["node"]
            assert isinstance(node, NodePath)
            velocity = projectile["velocity"]
            assert isinstance(velocity, Vec3)
            node.setPos(node.getPos() + velocity * dt)
            projectile["life"] = float(projectile["life"]) - dt
            hit = next((enemy for enemy in self.enemies if (enemy["node"].getPos(self.render) - node.getPos(self.render)).length() < (1.8 if enemy["boss"] else 0.85)), None)
            if hit:
                self._damage_enemy(hit, 10_000 if "vg_one_hit_kill" in self.mods else 54)
                projectile["life"] = 0.0
            if float(projectile["life"]) <= 0:
                node.removeNode()
                self.projectiles.remove(projectile)

        for enemy in list(self.enemies):
            node = enemy["node"]
            assert isinstance(node, NodePath)
            enemy["cooldown"] = float(enemy["cooldown"]) - dt
            delta = self.player.getPos(self.render) - node.getPos(self.render)
            delta.z = 0
            distance = max(0.001, delta.length())
            if distance > 1.2:
                delta.normalize()
                node.setPos(node.getPos() + delta * dt * (1.15 if enemy["boss"] else 2.0))
                node.setH(math.degrees(math.atan2(-delta.x, delta.y)))
            elif float(enemy["cooldown"]) <= 0:
                enemy["cooldown"] = 0.8 if enemy["boss"] else 1.15
                if "vg_god_mode" not in self.mods and self.hurt_cooldown <= 0:
                    self.campaign.hp -= 18 if enemy["boss"] else 8
                    self.hurt_cooldown = 0.55
                    self.toast(f"The Hand strains - {self.campaign.hp} HP", 1.0)
                    if self.campaign.hp <= 0:
                        self.campaign.hp = self.campaign.max_hp
                        self.campaign.embers = max(10, self.campaign.embers)
                        self._load_room()
                        self.toast("The Vesper remembers you", 2.5)
            phase = float(enemy["phase"]) + dt * (1.6 if enemy["boss"] else 2.4)
            enemy["phase"] = phase
            node.setZ(0.55 + math.sin(phase) * 0.08)

        if "vg_god_mode" in self.mods or "vg_beam_always_ready" in self.mods:
            self.campaign.hp = self.campaign.max_hp
        if "vg_infinite_embers" in self.mods:
            self.campaign.embers = 999
        self._update_hud()

    def update_presentation(self, dt: float) -> None:
        del dt
        target = self.player.getPos(self.render)
        desired = Point3(target.x, target.y - self.camera_distance * 0.58, self.camera_distance * 0.72)
        self.camera.setPos(self.camera.getPos() + (desired - self.camera.getPos()) * 0.12)
        self.camera.lookAt(target.x, target.y + 1.5, 0)
        if self.altar:
            self.altar.setH(self.altar.getH() + 0.5)
            pulse = 1.0 + math.sin(self.elapsed * 2.2) * 0.12
            self.altar.setScale(pulse)
        if self.exit_portal:
            self.exit_portal.setScale(1.0 + math.sin(self.elapsed * 3.5) * 0.035)

    def _update_hud(self) -> None:
        room = self.campaign.room
        beam = "READY" if self.beam_cooldown <= 0 else f"{self.beam_cooldown:.1f}s"
        self.hud_title.setText(room.chapter)
        self.hud_status.setText(
            f"HP {self.campaign.hp}/{self.campaign.max_hp}   EMBERS {self.campaign.embers}   SOULS {self.campaign.souls}\n"
            f"BEAM {beam}   SCORE {self.campaign.score}   {self.campaign.progress}%"
        )
        if self.campaign.finished:
            objective = "EVENSONG RESTORED\nBoth voices are home."
        elif self.enemies:
            boss = next((enemy for enemy in self.enemies if enemy["boss"]), None)
            detail = f"BOSS {max(0, int(boss['hp']))}/{int(boss['max_hp'])}" if boss else f"{len(self.enemies)} THREATS"
            objective = f"{room.name}\n{detail} - silence the room"
        elif room.restoration:
            objective = f"{room.name}\nThe dungeon has changed. Enter the forward gate."
        else:
            objective = f"{room.name}\nROOM CLEAR - enter the forward gate"
        self.hud_objective.setText(objective)

    def adjust_camera_distance(self, delta: int) -> None:
        self.camera_distance = max(19.0, min(38.0, self.camera_distance + delta * 2.0))

    def save_game(self) -> None:
        self.store.save(self.campaign.to_dict())

    def smoke_report(self) -> dict[str, object]:
        report = super().smoke_report()
        report.update(
            {
                "room": self.campaign.room.id,
                "campaign_rooms": len(VESPER_ROOMS),
                "threats": len(self.enemies),
                "mods": sorted(self.mods),
            }
        )
        return report

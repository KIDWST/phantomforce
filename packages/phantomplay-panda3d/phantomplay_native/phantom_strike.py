from __future__ import annotations

import math
from pathlib import Path

from panda3d.core import CollisionNode, CollisionRay, CollisionTraverser, CollisionHandlerQueue, Vec3

from .runtime import NativeGame, apply_fog
from .state import SaveStore


class PhantomStrikeGame(NativeGame):
    """Panda3D native lane for Phantom Strike.

    This keeps the web build as fallback while giving the desktop studio a real
    Panda3D executable target for FPS movement, bots, pickups, and split-screen
    expansion work.
    """

    arena_half = 18

    def __init__(
        self,
        store: SaveStore,
        mods: set[str],
        screenshot_path: Path | None = None,
    ) -> None:
        super().__init__("phantom-strike", "Phantom Strike", store, mods, screenshot_path)
        self.state = store.load()
        self.player = self.render.attachNewNode("strike-player")
        self.player.setPos(0, -12, 1.2)
        self.heading = 0.0
        self.pitch = 0.0
        self.health = int(self.state.get("health", 100)) if isinstance(self.state, dict) else 100
        self.score = int(self.state.get("score", 0)) if isinstance(self.state, dict) else 0
        self.fire_cooldown = 0.0
        self.bots: list[dict[str, object]] = []
        self.pickups: list[dict[str, object]] = []
        self.ray_queue = CollisionHandlerQueue()
        self.traverser = CollisionTraverser("phantom-strike-traverser")
        self._build_arena()
        self._spawn_bots()
        self._spawn_pickups()
        self._configure_fps_input()
        self.controls.setText("WASD MOVE   MOUSE LOOK   LMB/SPACE FIRE   G GRENADE   P PAUSE")
        self.toast("Panda3D native Phantom Strike lane active", 2.0)
        self._game_ready = True

    def _configure_fps_input(self) -> None:
        self.accept("mouse1", self.fire)
        self.accept("space", self.fire)
        self.accept("g", lambda: self.toast("Grenade slot wired for native ordnance pass", 1.4))
        ray_node = CollisionNode("strike-aim-ray")
        ray_node.addSolid(CollisionRay(0, 0, 0, 0, 1, 0))
        ray_path = self.camera.attachNewNode(ray_node)
        self.traverser.addCollider(ray_path, self.ray_queue)

    def _build_arena(self) -> None:
        apply_fog(self.render, "strike-range", (0.03, 0.08, 0.10), 24, 58)
        self.make_box("floor", (0, 0, -0.08), (self.arena_half, self.arena_half, 0.08), (0.05, 0.09, 0.10, 1), self.render)
        self.make_box("north-wall", (0, self.arena_half, 1.5), (self.arena_half, 0.25, 1.6), (0.10, 0.18, 0.20, 1), self.render)
        self.make_box("south-wall", (0, -self.arena_half, 1.5), (self.arena_half, 0.25, 1.6), (0.10, 0.18, 0.20, 1), self.render)
        self.make_box("east-wall", (self.arena_half, 0, 1.5), (0.25, self.arena_half, 1.6), (0.10, 0.18, 0.20, 1), self.render)
        self.make_box("west-wall", (-self.arena_half, 0, 1.5), (0.25, self.arena_half, 1.6), (0.10, 0.18, 0.20, 1), self.render)
        for index, (x, y) in enumerate(((-7, -3), (7, -4), (-8, 7), (6, 6), (0, 1))):
            cover = self.make_box(f"cover-{index}", (x, y, 0.75), (1.2, 0.55, 0.85), (0.16, 0.24, 0.28, 1), self.render)
            cover.setH(index * 37)
        for x in range(-16, 17, 4):
            line = self.make_box("floor-lane", (x, 0, 0.01), (0.018, self.arena_half, 0.015), (0.12, 0.42, 0.38, 1), self.render)
            line.setLightOff(1)

    def _spawn_bots(self) -> None:
        for index, (x, y) in enumerate(((-10, 9), (10, 8), (-3, 13), (5, 2))):
            node = self.render.attachNewNode(f"strike-bot-{index}")
            self.make_box("bot-feet", (0, 0, 0.25), (0.38, 0.30, 0.24), (0.12, 0.16, 0.18, 1), node)
            self.make_box("bot-body", (0, 0, 0.82), (0.45, 0.34, 0.62), (0.76, 0.18, 0.22, 1), node)
            self.make_box("bot-head", (0, 0, 1.38), (0.30, 0.30, 0.26), (0.95, 0.42, 0.38, 1), node)
            node.setPos(x, y, 0)
            self.bots.append({"node": node, "home": Vec3(x, y, 0), "health": 3, "phase": index * 1.7})

    def _spawn_pickups(self) -> None:
        for index, (x, y, color) in enumerate(((-12, -8, (0.2, 0.9, 0.55, 1)), (12, -9, (0.2, 0.55, 1, 1)))):
            node = self.make_box(f"pickup-{index}", (x, y, 0.42), (0.36, 0.36, 0.36), color, self.render)
            node.setLightOff(1)
            self.pickups.append({"node": node, "kind": "heal" if index == 0 else "ammo"})

    def update_game(self, dt: float) -> None:
        speed = 8.5 if "shift" in self.keys else 5.4
        move = Vec3(0, 0, 0)
        if "w" in self.keys or "arrow_up" in self.keys:
            move.y += 1
        if "s" in self.keys or "arrow_down" in self.keys:
            move.y -= 1
        if "a" in self.keys or "arrow_left" in self.keys:
            move.x -= 1
        if "d" in self.keys or "arrow_right" in self.keys:
            move.x += 1
        if move.length_squared() > 0:
            move.normalize()
            angle = math.radians(self.heading)
            forward = Vec3(math.sin(angle), math.cos(angle), 0)
            right = Vec3(forward.y, -forward.x, 0)
            pos = self.player.getPos() + (forward * move.y + right * move.x) * speed * dt
            pos.x = max(-self.arena_half + 1, min(self.arena_half - 1, pos.x))
            pos.y = max(-self.arena_half + 1, min(self.arena_half - 1, pos.y))
            self.player.setPos(pos)
        self.fire_cooldown = max(0.0, self.fire_cooldown - dt)
        self._update_bots(dt)
        self._update_camera()
        self._update_hud()

    def _update_camera(self) -> None:
        pos = self.player.getPos()
        self.camera.setPos(pos.x, pos.y, 1.55)
        self.camera.setHpr(self.heading, self.pitch, 0)
        if self.mouseWatcherNode and self.mouseWatcherNode.hasMouse():
            mouse = self.mouseWatcherNode.getMouse()
            self.heading -= mouse.x * 1.8
            self.pitch = max(-45, min(35, self.pitch + mouse.y * 1.0))

    def _update_bots(self, dt: float) -> None:
        player_pos = self.player.getPos()
        for bot in self.bots:
            node = bot["node"]
            if not hasattr(node, "getPos"):
                continue
            pos = node.getPos()
            to_player = player_pos - pos
            distance = max(0.1, to_player.length())
            if distance < 13:
                to_player.normalize()
                node.setPos(pos + to_player * dt * 1.6)
                node.lookAt(player_pos)
                if distance < 1.5:
                    self.health = max(0, self.health - 18)
                    self.toast("Hit! Back out of the lane.", 0.8)
                    node.setPos(pos - to_player * 1.2)
            else:
                phase = float(bot["phase"]) + self.elapsed * 0.7
                home = bot["home"]
                node.setPos(home.x + math.sin(phase) * 1.4, home.y + math.cos(phase * 0.8) * 1.4, 0)

    def fire(self) -> None:
        if self.fire_cooldown > 0:
            return
        self.fire_cooldown = 0.22
        origin = self.camera.getPos(self.render)
        forward = self.camera.getQuat(self.render).getForward()
        best = None
        best_distance = 999.0
        for bot in self.bots:
            node = bot["node"]
            if not hasattr(node, "getPos"):
                continue
            offset = node.getPos(self.render) + Vec3(0, 0, 0.9) - origin
            distance = offset.length()
            offset.normalize()
            if forward.dot(offset) > 0.985 and distance < best_distance:
                best = bot
                best_distance = distance
        if best:
            best["health"] = int(best["health"]) - 1
            node = best["node"]
            node.setColorScale(1.0, 0.22, 0.22, 1)
            if int(best["health"]) <= 0:
                node.removeNode()
                self.score += 100
                self.toast("Target down +100", 1.0)
        else:
            self.toast("Miss", 0.35)

    def _update_hud(self) -> None:
        self.hud_status.setText(f"SCORE {self.score:04d}   HEALTH {self.health}")
        self.hud_objective.setText(f"BOTS {sum(1 for bot in self.bots if int(bot['health']) > 0)}")

    def save_game(self) -> None:
        self.store.save({"health": self.health, "score": self.score})

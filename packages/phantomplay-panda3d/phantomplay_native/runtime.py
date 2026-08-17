from __future__ import annotations

import json
import math
import time
from pathlib import Path
from typing import Callable

from direct.gui.DirectGui import DirectFrame
from direct.gui.OnscreenText import OnscreenText
from direct.showbase.ShowBase import ShowBase
from direct.task import Task
from panda3d.core import (
    AmbientLight,
    AntialiasAttrib,
    DirectionalLight,
    Fog,
    Filename,
    LineSegs,
    NodePath,
    Point3,
    TextNode,
    Vec3,
    WindowProperties,
)

from .state import SaveStore


Color = tuple[float, float, float, float]


class NativeGame(ShowBase):
    """Shared fixed-step Panda3D application shell for native PhantomPlay games."""

    fixed_step = 1.0 / 60.0

    def __init__(
        self,
        game_id: str,
        title: str,
        store: SaveStore,
        mods: set[str],
        screenshot_path: Path | None = None,
    ) -> None:
        super().__init__()
        self.game_id = game_id
        self.title = title
        self.store = store
        self.mods = mods
        self.screenshot_path = screenshot_path
        self._game_ready = False
        self.keys: set[str] = set()
        self.paused = False
        self.accumulator = 0.0
        self.elapsed = 0.0
        self.autosave_elapsed = 0.0
        self.toast_elapsed = 0.0
        self.flash_nodes: list[tuple[NodePath, float]] = []
        self._cube_template = self.loader.loadModel("models/box")
        self._cube_template.setTextureOff(1)

        self.disableMouse()
        self.setBackgroundColor(0.015, 0.025, 0.035, 1)
        self.render.setAntialias(AntialiasAttrib.MAuto)
        self.render.setShaderAuto()
        self.camLens.setFov(52)
        self.camLens.setNearFar(0.15, 190.0)
        self._configure_window(title)
        self._configure_lighting()
        self._configure_input()
        self._configure_hud()
        self.taskMgr.add(self._frame, "phantomplay-native-frame", sort=25)

    def _configure_window(self, title: str) -> None:
        if not self.win or not hasattr(self.win, "requestProperties"):
            return
        properties = WindowProperties()
        properties.setTitle(f"PhantomPlay - {title} [Panda3D]")
        properties.setCursorHidden(False)
        self.win.requestProperties(properties)

    def _configure_lighting(self) -> None:
        ambient = AmbientLight("ambient")
        ambient.setColor((0.25, 0.27, 0.34, 1))
        ambient_np = self.render.attachNewNode(ambient)
        self.render.setLight(ambient_np)

        key = DirectionalLight("key")
        key.setColor((1.05, 0.96, 0.82, 1))
        key.setShadowCaster(True, 1024, 1024)
        key_np = self.render.attachNewNode(key)
        key_np.setHpr(-35, -62, 0)
        self.render.setLight(key_np)

        fill = DirectionalLight("fill")
        fill.setColor((0.22, 0.48, 0.65, 1))
        fill_np = self.render.attachNewNode(fill)
        fill_np.setHpr(145, -35, 0)
        self.render.setLight(fill_np)

    def _configure_input(self) -> None:
        for key in ("w", "a", "s", "d", "arrow_up", "arrow_down", "arrow_left", "arrow_right", "shift"):
            self.accept(key, self.keys.add, [key])
            self.accept(f"{key}-up", self.keys.discard, [key])
        self.accept("escape", self.toggle_pause)
        self.accept("f5", self.manual_save)
        self.accept("f12", self.capture_screenshot)
        self.accept("wheel_up", self.adjust_camera_distance, [-1])
        self.accept("wheel_down", self.adjust_camera_distance, [1])

    def _configure_hud(self) -> None:
        self.hud_back = DirectFrame(
            parent=self.aspect2d,
            frameColor=(0.018, 0.026, 0.04, 0.9),
            frameSize=(-1.34, -0.56, 0.70, 0.96),
        )
        self.hud_title = OnscreenText(
            parent=self.aspect2d,
            text=self.title.upper(),
            pos=(-1.29, 0.91),
            scale=0.044,
            fg=(0.88, 0.91, 0.98, 1),
            align=TextNode.ALeft,
            mayChange=True,
        )
        self.hud_status = OnscreenText(
            parent=self.aspect2d,
            text="",
            pos=(-1.29, 0.825),
            scale=0.033,
            fg=(0.62, 0.78, 0.86, 1),
            align=TextNode.ALeft,
            mayChange=True,
        )
        self.objective_back = DirectFrame(
            parent=self.aspect2d,
            frameColor=(0.018, 0.026, 0.04, 0.86),
            frameSize=(0.48, 1.34, 0.70, 0.96),
        )
        self.hud_objective = OnscreenText(
            parent=self.aspect2d,
            text="",
            pos=(1.29, 0.91),
            scale=0.033,
            fg=(0.98, 0.82, 0.52, 1),
            align=TextNode.ARight,
            wordwrap=25,
            mayChange=True,
        )
        self.controls = OnscreenText(
            parent=self.aspect2d,
            text="",
            pos=(0, -0.94),
            scale=0.029,
            fg=(0.60, 0.67, 0.75, 1),
            bg=(0.01, 0.015, 0.025, 0.72),
            align=TextNode.ACenter,
            mayChange=True,
        )
        self.toast_text = OnscreenText(
            parent=self.aspect2d,
            text="",
            pos=(0, -0.76),
            scale=0.045,
            fg=(0.95, 0.86, 0.60, 1),
            bg=(0.015, 0.02, 0.035, 0.88),
            align=TextNode.ACenter,
            mayChange=True,
        )
        self.pause_text = OnscreenText(
            parent=self.aspect2d,
            text="",
            pos=(0, 0),
            scale=0.09,
            fg=(0.94, 0.95, 1, 1),
            bg=(0.01, 0.015, 0.025, 0.9),
            align=TextNode.ACenter,
            mayChange=True,
        )

    def make_box(
        self,
        name: str,
        position: tuple[float, float, float],
        scale: tuple[float, float, float],
        color: Color,
        parent: NodePath | None = None,
    ) -> NodePath:
        node = (parent or self.render).attachNewNode(name)
        mesh = self._cube_template.copyTo(node)
        mesh.setPos(-0.5, -0.5, -0.5)
        mesh.setColor(*color)
        mesh.setTextureOff(1)
        node.setPos(*position)
        node.setScale(scale[0] * 2, scale[1] * 2, scale[2] * 2)
        return node

    def make_portal(self, name: str, position: tuple[float, float, float], color: Color) -> NodePath:
        root = self.render.attachNewNode(name)
        root.setPos(*position)
        for x, z, sx, sz in ((-0.72, 0.85, 0.13, 1.05), (0.72, 0.85, 0.13, 1.05), (0, 1.85, 0.82, 0.13)):
            self.make_box(f"{name}-edge", (x, 0, z), (sx, 0.15, sz), color, root)
        inner = self.make_box(f"{name}-light", (0, 0.04, 0.82), (0.58, 0.04, 0.78), (color[0], color[1], color[2], 0.32), root)
        inner.setTransparency(True)
        return root

    def flash_line(self, start: Point3, end: Point3, color: Color, duration: float = 0.12, thickness: float = 4) -> None:
        lines = LineSegs()
        lines.setThickness(thickness)
        lines.setColor(*color)
        lines.moveTo(start)
        lines.drawTo(end)
        node = self.render.attachNewNode(lines.create())
        node.setLightOff(1)
        self.flash_nodes.append((node, duration))

    def mouse_ground_point(self, z: float = 0.0) -> Point3 | None:
        if not self.mouseWatcherNode.hasMouse():
            return None
        mouse = self.mouseWatcherNode.getMouse()
        near = Point3()
        far = Point3()
        if not self.camLens.extrude(mouse, near, far):
            return None
        near = self.render.getRelativePoint(self.cam, near)
        far = self.render.getRelativePoint(self.cam, far)
        dz = far.z - near.z
        if abs(dz) < 0.0001:
            return None
        amount = (z - near.z) / dz
        return near + (far - near) * amount

    def movement_vector(self) -> Vec3:
        x = float("d" in self.keys or "arrow_right" in self.keys) - float("a" in self.keys or "arrow_left" in self.keys)
        y = float("w" in self.keys or "arrow_up" in self.keys) - float("s" in self.keys or "arrow_down" in self.keys)
        vector = Vec3(x, y, 0)
        if vector.lengthSquared() > 1:
            vector.normalize()
        return vector

    def toast(self, message: str, seconds: float = 2.2) -> None:
        self.toast_text.setText(message)
        self.toast_elapsed = seconds

    def toggle_pause(self) -> None:
        self.paused = not self.paused
        self.pause_text.setText("PAUSED\nEscape to return" if self.paused else "")

    def manual_save(self) -> None:
        self.save_game()
        self.toast("Saved")

    def capture_screenshot(self) -> None:
        if not self.win:
            return
        target = self.screenshot_path or Path.cwd() / f"{self.game_id}-{int(time.time())}.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        self.win.saveScreenshot(Filename.fromOsSpecific(str(target)))
        self.toast(f"Screenshot: {target.name}")

    def adjust_camera_distance(self, delta: int) -> None:
        del delta

    def _frame(self, task: Task) -> int:
        dt = min(self.clock.getDt(), 0.10)
        self.elapsed += dt
        if self.toast_elapsed > 0:
            self.toast_elapsed -= dt
            if self.toast_elapsed <= 0:
                self.toast_text.setText("")
        survivors: list[tuple[NodePath, float]] = []
        for node, remaining in self.flash_nodes:
            remaining -= dt
            if remaining <= 0:
                node.removeNode()
            else:
                survivors.append((node, remaining))
        self.flash_nodes = survivors
        if not self.paused:
            time_scale = 0.35 if "universal_slowmo" in self.mods else 1.0
            self.accumulator += dt * time_scale
            steps = 0
            while self.accumulator >= self.fixed_step and steps < 6:
                self.update_game(self.fixed_step)
                self.accumulator -= self.fixed_step
                steps += 1
            self.autosave_elapsed += dt
            if self.autosave_elapsed >= 20:
                self.autosave_elapsed = 0
                self.save_game()
        self.update_presentation(dt)
        return Task.cont

    def update_game(self, dt: float) -> None:
        raise NotImplementedError

    def update_presentation(self, dt: float) -> None:
        del dt

    def save_game(self) -> None:
        raise NotImplementedError

    def smoke_report(self) -> dict[str, object]:
        return {
            "ok": True,
            "game": self.game_id,
            "renderer": "Panda3D",
            "scene_nodes": self.render.findAllMatches("**").getNumPaths(),
        }

    def destroy(self) -> None:
        try:
            if self._game_ready:
                self.save_game()
        finally:
            super().destroy()


def apply_fog(root: NodePath, name: str, color: tuple[float, float, float], near: float, far: float) -> Fog:
    fog = Fog(name)
    fog.setColor(*color)
    fog.setLinearRange(near, far)
    root.setFog(fog)
    return fog


def emit_smoke_report(game: NativeGame) -> str:
    return json.dumps(game.smoke_report(), sort_keys=True)

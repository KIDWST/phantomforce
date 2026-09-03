use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use super::{EngineCommandRequestBody, request_engine_command_at};

const ENGINE_SCHEMA_VERSION: u32 = 1;
const VIEW_WIDTH: f32 = 920.0;
const VIEW_HEIGHT: f32 = 560.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
enum ProjectMode {
    World3D,
    Canvas2D,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
enum ProjectTemplate {
    #[default]
    Foundation3D,
    RtsStress,
    FpsPrototype,
    SystemicSandbox,
    CanvasLab,
}

impl ProjectTemplate {
    fn label(self) -> &'static str {
        match self {
            Self::Foundation3D => "3D WORLD",
            Self::RtsStress => "RTS STRESS",
            Self::FpsPrototype => "FPS LAB",
            Self::SystemicSandbox => "SYSTEMS",
            Self::CanvasLab => "CANVAS",
        }
    }

    fn project_id(self) -> &'static str {
        match self {
            Self::Foundation3D => "phantom-engine-flagship-3d",
            Self::RtsStress => "phantom-engine-rts-stress",
            Self::FpsPrototype => "phantom-engine-fps-lab",
            Self::SystemicSandbox => "phantom-engine-systemic-sandbox",
            Self::CanvasLab => "phantom-engine-canvas-lab",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Vec3 {
    x: f32,
    y: f32,
    z: f32,
}

impl Vec3 {
    const fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    fn add(self, other: Self) -> Self {
        Self::new(self.x + other.x, self.y + other.y, self.z + other.z)
    }

    fn sub(self, other: Self) -> Self {
        Self::new(self.x - other.x, self.y - other.y, self.z - other.z)
    }

    fn mul(self, scalar: f32) -> Self {
        Self::new(self.x * scalar, self.y * scalar, self.z * scalar)
    }

    fn dot(self, other: Self) -> f32 {
        self.x * other.x + self.y * other.y + self.z * other.z
    }

    fn cross(self, other: Self) -> Self {
        Self::new(
            self.y * other.z - self.z * other.y,
            self.z * other.x - self.x * other.z,
            self.x * other.y - self.y * other.x,
        )
    }

    fn length(self) -> f32 {
        self.dot(self).sqrt()
    }

    fn normalized(self) -> Self {
        let length = self.length();
        if length <= f32::EPSILON {
            Self::new(0.0, 0.0, 1.0)
        } else {
            self.mul(1.0 / length)
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
struct Transform3D {
    position: Vec3,
    rotation: Vec3,
    scale: Vec3,
}

impl Default for Transform3D {
    fn default() -> Self {
        Self {
            position: Vec3::default(),
            rotation: Vec3::default(),
            scale: Vec3::new(1.0, 1.0, 1.0),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
enum EntityKind {
    Cube,
    Ground,
    DirectionalLight,
    Camera,
    SystemicCrate,
    Sprite,
}

impl EntityKind {
    fn label(self) -> &'static str {
        match self {
            Self::Cube => "Mesh · Cube",
            Self::Ground => "Mesh · Ground",
            Self::DirectionalLight => "Light · Directional",
            Self::Camera => "Camera · Perspective",
            Self::SystemicCrate => "Prefab · Systemic Crate",
            Self::Sprite => "Sprite · Canvas",
        }
    }

    fn icon(self) -> &'static str {
        match self {
            Self::Cube => "◇",
            Self::Ground => "▱",
            Self::DirectionalLight => "☀",
            Self::Camera => "◉",
            Self::SystemicCrate => "▣",
            Self::Sprite => "◆",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Material {
    name: String,
    base_color: String,
    metallic: f32,
    roughness: f32,
    emissive: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
enum ComponentKind {
    Transform3D,
    MeshRenderer,
    Material,
    DirectionalLight,
    PerspectiveCamera,
    SpriteRenderer,
    PhysicsBody,
    CapabilitySet,
}

impl ComponentKind {
    fn label(self) -> &'static str {
        match self {
            Self::Transform3D => "Transform3D",
            Self::MeshRenderer => "MeshRenderer",
            Self::Material => "Material",
            Self::DirectionalLight => "DirectionalLight",
            Self::PerspectiveCamera => "PerspectiveCamera",
            Self::SpriteRenderer => "SpriteRenderer",
            Self::PhysicsBody => "PhysicsBody",
            Self::CapabilitySet => "CapabilitySet",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct ComponentSlot {
    kind: ComponentKind,
    provider: String,
    enabled: bool,
}

fn component_slots(kind: EntityKind) -> Vec<ComponentSlot> {
    let kinds: &[ComponentKind] = match kind {
        EntityKind::Cube | EntityKind::Ground => &[
            ComponentKind::Transform3D,
            ComponentKind::MeshRenderer,
            ComponentKind::Material,
        ],
        EntityKind::DirectionalLight => {
            &[ComponentKind::Transform3D, ComponentKind::DirectionalLight]
        }
        EntityKind::Camera => &[ComponentKind::Transform3D, ComponentKind::PerspectiveCamera],
        EntityKind::SystemicCrate => &[
            ComponentKind::Transform3D,
            ComponentKind::MeshRenderer,
            ComponentKind::Material,
            ComponentKind::PhysicsBody,
            ComponentKind::CapabilitySet,
        ],
        EntityKind::Sprite => &[
            ComponentKind::Transform3D,
            ComponentKind::SpriteRenderer,
            ComponentKind::Material,
        ],
    };
    kinds
        .iter()
        .copied()
        .map(|kind| ComponentSlot {
            kind,
            provider: match kind {
                ComponentKind::SpriteRenderer => "Phantom.Render2D",
                ComponentKind::PhysicsBody => "Phantom.Physics3D",
                ComponentKind::CapabilitySet => "Phantom.Systems",
                ComponentKind::DirectionalLight
                | ComponentKind::PerspectiveCamera
                | ComponentKind::MeshRenderer
                | ComponentKind::Material => "Phantom.Render3D",
                ComponentKind::Transform3D => "Phantom.Core",
            }
            .to_string(),
            enabled: true,
        })
        .collect()
}

impl Material {
    fn new(name: &str, color: &str, metallic: f32, roughness: f32) -> Self {
        Self {
            name: name.to_string(),
            base_color: color.to_string(),
            metallic,
            roughness,
            emissive: 0.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct RichEntity {
    id: u64,
    name: String,
    kind: EntityKind,
    transform: Transform3D,
    material: Material,
    #[serde(default)]
    components: Vec<ComponentSlot>,
    capabilities: Vec<String>,
    #[serde(default)]
    states: Vec<String>,
    #[serde(default = "full_health")]
    health: f32,
    visible: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct SimEntity {
    id: u64,
    archetype: String,
    position: Vec3,
    tint: String,
    #[serde(default)]
    velocity: Vec3,
    #[serde(default)]
    target: Vec3,
    #[serde(default)]
    team: u8,
    #[serde(default = "full_health")]
    health: f32,
    #[serde(default)]
    selected: bool,
}

const fn full_health() -> f32 {
    100.0
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct PhantomScene {
    id: String,
    name: String,
    rich_entities: Vec<RichEntity>,
    simulation_entities: Vec<SimEntity>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct PhantomWorld {
    name: String,
    active_scene: usize,
    regions: Vec<String>,
    streaming_cells: Vec<String>,
    scenes: Vec<PhantomScene>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct PhantomProject {
    schema_version: u32,
    id: String,
    name: String,
    mode: ProjectMode,
    #[serde(default)]
    template: ProjectTemplate,
    enabled_modules: Vec<String>,
    #[serde(default)]
    runtime: ProjectRuntime,
    world: PhantomWorld,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct ProjectRuntime {
    player_position: Vec3,
    player_yaw: f32,
    ammo: u32,
    reserve_ammo: u32,
    shots_fired: u32,
    confirmed_hits: u32,
}

impl Default for ProjectRuntime {
    fn default() -> Self {
        Self {
            player_position: Vec3::new(0.0, 1.45, 7.5),
            player_yaw: 180.0,
            ammo: 30,
            reserve_ammo: 90,
            shots_fired: 0,
            confirmed_hits: 0,
        }
    }
}

impl PhantomProject {
    fn active_scene(&self) -> &PhantomScene {
        &self.world.scenes[self.world.active_scene]
    }

    fn active_scene_mut(&mut self) -> &mut PhantomScene {
        &mut self.world.scenes[self.world.active_scene]
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct EditorCamera {
    yaw: f32,
    pitch: f32,
    distance: f32,
    target: Vec3,
    perspective: bool,
    first_person: bool,
    position: Vec3,
}

impl Default for EditorCamera {
    fn default() -> Self {
        Self {
            yaw: -38.0,
            pitch: 24.0,
            distance: 11.5,
            target: Vec3::new(0.0, 0.7, 0.0),
            perspective: true,
            first_person: false,
            position: Vec3::new(0.0, 1.45, 7.5),
        }
    }
}

impl EditorCamera {
    fn for_template(template: ProjectTemplate) -> Self {
        if template == ProjectTemplate::FpsPrototype {
            Self {
                yaw: 180.0,
                pitch: 0.0,
                distance: 0.0,
                target: Vec3::new(0.0, 1.45, 0.0),
                perspective: true,
                first_person: true,
                position: Vec3::new(0.0, 1.45, 7.5),
            }
        } else {
            Self::default()
        }
    }
}

#[derive(Clone, Debug)]
struct RenderFace {
    entity_id: u64,
    points: String,
    fill: String,
    depth: f32,
    selected: bool,
}

#[derive(Clone, Debug)]
struct RenderPoint {
    entity_id: u64,
    x: f32,
    y: f32,
    radius: f32,
    fill: String,
    selected: bool,
}

#[derive(Clone, Debug)]
struct RenderLine {
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
    color: String,
    width: f32,
}

#[derive(Clone, Debug, Default)]
struct SceneRender {
    faces: Vec<RenderFace>,
    points: Vec<RenderPoint>,
    grid: Vec<RenderLine>,
    gizmo: Vec<RenderLine>,
}

trait IRenderBackend {
    fn name(&self) -> &'static str;
    fn render(
        &self,
        project: &PhantomProject,
        camera: EditorCamera,
        selected_id: u64,
    ) -> SceneRender;
}

struct PhantomSoftwareBackend;

impl IRenderBackend for PhantomSoftwareBackend {
    fn name(&self) -> &'static str {
        "Phantom.Software3D"
    }

    fn render(
        &self,
        project: &PhantomProject,
        camera: EditorCamera,
        selected_id: u64,
    ) -> SceneRender {
        build_scene_render(project, camera, selected_id)
    }
}

fn engine_project_root() -> PathBuf {
    super::phantomplay_data_root()
        .join("phantom-engine")
        .join("projects")
}

fn project_path(project_id: &str) -> PathBuf {
    engine_project_root()
        .join(project_id)
        .join("project.phantom.json")
}

fn save_project(project: &PhantomProject) -> Result<PathBuf, String> {
    let path = project_path(&project.id);
    let parent = path
        .parent()
        .ok_or_else(|| "Phantom Engine project path has no parent.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create Phantom Engine project folder: {error}"))?;
    let bytes = serde_json::to_vec_pretty(project)
        .map_err(|error| format!("Could not serialize Phantom Engine project: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, bytes)
        .map_err(|error| format!("Could not write Phantom Engine project: {error}"))?;
    if path.exists() {
        let backup = path.with_extension("json.bak");
        let _ = fs::copy(&path, backup);
        fs::remove_file(&path)
            .map_err(|error| format!("Could not replace Phantom Engine project: {error}"))?;
    }
    fs::rename(&temporary, &path)
        .map_err(|error| format!("Could not finalize Phantom Engine project: {error}"))?;
    Ok(path)
}

fn load_project(template: ProjectTemplate) -> Result<PhantomProject, String> {
    let path = project_path(template.project_id());
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("No saved {} project yet: {error}", template.label()))?;
    let project = serde_json::from_str::<PhantomProject>(&raw)
        .map_err(|error| format!("Saved Phantom Engine project is invalid: {error}"))?;
    if project.schema_version != ENGINE_SCHEMA_VERSION {
        return Err(format!(
            "Project schema {} is not supported by engine schema {}.",
            project.schema_version, ENGINE_SCHEMA_VERSION
        ));
    }
    Ok(project)
}

fn entity(
    id: u64,
    name: &str,
    kind: EntityKind,
    position: Vec3,
    scale: Vec3,
    color: &str,
) -> RichEntity {
    RichEntity {
        id,
        name: name.to_string(),
        kind,
        transform: Transform3D {
            position,
            rotation: Vec3::default(),
            scale,
        },
        material: Material::new("Phantom Standard", color, 0.08, 0.62),
        components: component_slots(kind),
        capabilities: Vec::new(),
        states: Vec::new(),
        health: 100.0,
        visible: true,
    }
}

fn default_3d_project() -> PhantomProject {
    let mut crate_entity = entity(
        6,
        "Systemic Supply Crate",
        EntityKind::SystemicCrate,
        Vec3::new(2.15, 0.55, 1.15),
        Vec3::new(1.1, 1.1, 1.1),
        "#d69847",
    );
    crate_entity.capabilities = vec![
        "Movable".to_string(),
        "Breakable".to_string(),
        "Flammable".to_string(),
        "Carryable".to_string(),
    ];
    PhantomProject {
        schema_version: ENGINE_SCHEMA_VERSION,
        id: ProjectTemplate::Foundation3D.project_id().to_string(),
        name: "Flagship 3D Foundation".to_string(),
        mode: ProjectMode::World3D,
        template: ProjectTemplate::Foundation3D,
        enabled_modules: vec![
            "Phantom.Core".to_string(),
            "Phantom.Render3D".to_string(),
            "Phantom.Physics3D".to_string(),
            "Phantom.Animation".to_string(),
            "Phantom.AI".to_string(),
        ],
        runtime: ProjectRuntime::default(),
        world: PhantomWorld {
            name: "First Light World".to_string(),
            active_scene: 0,
            regions: vec!["Editor Region".to_string()],
            streaming_cells: vec!["0:0".to_string()],
            scenes: vec![PhantomScene {
                id: "scene-first-light".to_string(),
                name: "First Light".to_string(),
                rich_entities: vec![
                    entity(
                        1,
                        "Ground",
                        EntityKind::Ground,
                        Vec3::new(0.0, -0.25, 0.0),
                        Vec3::new(10.0, 0.25, 10.0),
                        "#263b36",
                    ),
                    entity(
                        2,
                        "Hero Cube",
                        EntityKind::Cube,
                        Vec3::new(0.0, 0.8, 0.0),
                        Vec3::new(1.5, 1.5, 1.5),
                        "#36e6a1",
                    ),
                    entity(
                        3,
                        "Architecture Block",
                        EntityKind::Cube,
                        Vec3::new(-2.25, 0.7, -1.4),
                        Vec3::new(1.5, 1.4, 1.5),
                        "#4f7cff",
                    ),
                    entity(
                        4,
                        "Sun",
                        EntityKind::DirectionalLight,
                        Vec3::new(4.0, 6.0, 3.0),
                        Vec3::new(1.0, 1.0, 1.0),
                        "#ffd98b",
                    ),
                    entity(
                        5,
                        "Gameplay Camera",
                        EntityKind::Camera,
                        Vec3::new(5.0, 4.0, 8.0),
                        Vec3::new(1.0, 1.0, 1.0),
                        "#84d7ff",
                    ),
                    crate_entity,
                ],
                simulation_entities: formation_entities(36, 1000),
            }],
        },
    }
}

fn default_canvas_project() -> PhantomProject {
    PhantomProject {
        schema_version: ENGINE_SCHEMA_VERSION,
        id: ProjectTemplate::CanvasLab.project_id().to_string(),
        name: "Canvas Signal Lab".to_string(),
        mode: ProjectMode::Canvas2D,
        template: ProjectTemplate::CanvasLab,
        enabled_modules: vec![
            "Phantom.Core".to_string(),
            "Phantom.Canvas".to_string(),
            "Phantom.Render2D".to_string(),
            "Phantom.Physics2D".to_string(),
            "Phantom.UI".to_string(),
        ],
        runtime: ProjectRuntime::default(),
        world: PhantomWorld {
            name: "Canvas World".to_string(),
            active_scene: 0,
            regions: vec!["Canvas".to_string()],
            streaming_cells: Vec::new(),
            scenes: vec![PhantomScene {
                id: "scene-canvas-signal".to_string(),
                name: "Signal Arena".to_string(),
                rich_entities: vec![
                    entity(
                        101,
                        "Player Sprite",
                        EntityKind::Sprite,
                        Vec3::new(0.0, 0.0, 0.0),
                        Vec3::new(1.0, 1.0, 1.0),
                        "#50f0ad",
                    ),
                    entity(
                        102,
                        "Energy Sprite",
                        EntityKind::Sprite,
                        Vec3::new(2.0, 1.0, 0.0),
                        Vec3::new(0.7, 0.7, 1.0),
                        "#6cb8ff",
                    ),
                    entity(
                        103,
                        "Hazard Sprite",
                        EntityKind::Sprite,
                        Vec3::new(-2.0, -1.25, 0.0),
                        Vec3::new(0.9, 0.9, 1.0),
                        "#ff6f85",
                    ),
                ],
                simulation_entities: formation_entities(72, 2000),
            }],
        },
    }
}

fn default_rts_project() -> PhantomProject {
    let mut simulation_entities = formation_team(
        1024,
        10_000,
        1,
        Vec3::new(-7.0, 0.08, -4.0),
        Vec3::new(1.0, 0.08, 0.0),
        "#58d7ff",
    );
    simulation_entities.extend(formation_team(
        1024,
        20_000,
        2,
        Vec3::new(7.0, 0.08, 4.0),
        Vec3::new(-1.0, 0.08, 0.0),
        "#ff7d72",
    ));
    PhantomProject {
        schema_version: ENGINE_SCHEMA_VERSION,
        id: ProjectTemplate::RtsStress.project_id().to_string(),
        name: "Iron Meridian RTS Stress".to_string(),
        mode: ProjectMode::World3D,
        template: ProjectTemplate::RtsStress,
        enabled_modules: vec![
            "Phantom.Core".to_string(),
            "Phantom.Render3D".to_string(),
            "Phantom.Simulation".to_string(),
            "Phantom.RTS".to_string(),
            "Phantom.Formations".to_string(),
            "Phantom.Navigation.FlowField".to_string(),
        ],
        runtime: ProjectRuntime::default(),
        world: PhantomWorld {
            name: "Iron Meridian".to_string(),
            active_scene: 0,
            regions: vec![
                "Blue Command".to_string(),
                "Contested Basin".to_string(),
                "Red Command".to_string(),
            ],
            streaming_cells: vec!["-1:0".to_string(), "0:0".to_string(), "1:0".to_string()],
            scenes: vec![PhantomScene {
                id: "scene-iron-meridian".to_string(),
                name: "Formation Basin".to_string(),
                rich_entities: vec![
                    entity(
                        1,
                        "Terrain",
                        EntityKind::Ground,
                        Vec3::new(0.0, -0.3, 0.0),
                        Vec3::new(18.0, 0.3, 14.0),
                        "#263b36",
                    ),
                    entity(
                        2,
                        "Blue Command",
                        EntityKind::Cube,
                        Vec3::new(-7.0, 1.0, -4.0),
                        Vec3::new(2.2, 2.0, 2.2),
                        "#3b92d1",
                    ),
                    entity(
                        3,
                        "Red Command",
                        EntityKind::Cube,
                        Vec3::new(7.0, 1.0, 4.0),
                        Vec3::new(2.2, 2.0, 2.2),
                        "#c64f4f",
                    ),
                    entity(
                        4,
                        "Central Relay",
                        EntityKind::SystemicCrate,
                        Vec3::new(0.0, 0.8, 0.0),
                        Vec3::new(1.4, 1.6, 1.4),
                        "#d6a547",
                    ),
                    entity(
                        5,
                        "Strategy Sun",
                        EntityKind::DirectionalLight,
                        Vec3::new(5.0, 8.0, 4.0),
                        Vec3::new(1.0, 1.0, 1.0),
                        "#ffe3ad",
                    ),
                    entity(
                        6,
                        "RTS Camera",
                        EntityKind::Camera,
                        Vec3::new(9.0, 10.0, 14.0),
                        Vec3::new(1.0, 1.0, 1.0),
                        "#84d7ff",
                    ),
                ],
                simulation_entities,
            }],
        },
    }
}

fn default_fps_project() -> PhantomProject {
    let mut targets = Vec::new();
    for (index, (x, z)) in [
        (-3.8, -4.0),
        (-1.8, -6.5),
        (0.0, -3.5),
        (2.2, -6.0),
        (4.1, -4.8),
    ]
    .into_iter()
    .enumerate()
    {
        let mut target = entity(
            20 + index as u64,
            &format!("Reactive Target {}", index + 1),
            EntityKind::SystemicCrate,
            Vec3::new(x, 1.0, z),
            Vec3::new(0.8, 2.0, 0.8),
            if index % 2 == 0 { "#ff7f66" } else { "#f0be58" },
        );
        target.capabilities = vec![
            "Damageable".to_string(),
            "Breakable".to_string(),
            "Interactable".to_string(),
        ];
        targets.push(target);
    }
    let mut rich_entities = vec![
        entity(
            1,
            "Range Ground",
            EntityKind::Ground,
            Vec3::new(0.0, -0.3, -1.5),
            Vec3::new(13.0, 0.3, 20.0),
            "#29363c",
        ),
        entity(
            2,
            "Left Cover",
            EntityKind::Cube,
            Vec3::new(-5.2, 1.1, 0.0),
            Vec3::new(1.2, 2.2, 4.5),
            "#485963",
        ),
        entity(
            3,
            "Right Cover",
            EntityKind::Cube,
            Vec3::new(5.2, 1.1, -1.0),
            Vec3::new(1.2, 2.2, 4.5),
            "#485963",
        ),
        entity(
            4,
            "Backstop",
            EntityKind::Cube,
            Vec3::new(0.0, 2.0, -9.0),
            Vec3::new(12.0, 4.0, 0.7),
            "#394852",
        ),
        entity(
            5,
            "Range Sun",
            EntityKind::DirectionalLight,
            Vec3::new(4.0, 8.0, 4.0),
            Vec3::new(1.0, 1.0, 1.0),
            "#ffe0a0",
        ),
        entity(
            6,
            "First Person Camera",
            EntityKind::Camera,
            Vec3::new(0.0, 1.45, 7.5),
            Vec3::new(1.0, 1.0, 1.0),
            "#84d7ff",
        ),
    ];
    rich_entities.extend(targets);
    PhantomProject {
        schema_version: ENGINE_SCHEMA_VERSION,
        id: ProjectTemplate::FpsPrototype.project_id().to_string(),
        name: "Blacksite FPS Validation".to_string(),
        mode: ProjectMode::World3D,
        template: ProjectTemplate::FpsPrototype,
        enabled_modules: vec![
            "Phantom.Core".to_string(),
            "Phantom.Render3D".to_string(),
            "Phantom.Physics3D".to_string(),
            "Phantom.Animation".to_string(),
            "Phantom.FPS".to_string(),
            "Phantom.VFX".to_string(),
            "Phantom.Audio".to_string(),
        ],
        runtime: ProjectRuntime::default(),
        world: PhantomWorld {
            name: "Blacksite Range".to_string(),
            active_scene: 0,
            regions: vec!["Insertion".to_string(), "Live Range".to_string()],
            streaming_cells: vec!["0:0".to_string(), "0:-1".to_string()],
            scenes: vec![PhantomScene {
                id: "scene-blacksite-range".to_string(),
                name: "Live Fire Lane".to_string(),
                rich_entities,
                simulation_entities: Vec::new(),
            }],
        },
    }
}

fn systemic_entity(
    id: u64,
    name: &str,
    position: Vec3,
    color: &str,
    capabilities: &[&str],
) -> RichEntity {
    let mut created = entity(
        id,
        name,
        EntityKind::SystemicCrate,
        position,
        Vec3::new(1.25, 1.25, 1.25),
        color,
    );
    created.capabilities = capabilities
        .iter()
        .map(|item| (*item).to_string())
        .collect();
    created
}

fn default_systemic_project() -> PhantomProject {
    PhantomProject {
        schema_version: ENGINE_SCHEMA_VERSION,
        id: ProjectTemplate::SystemicSandbox.project_id().to_string(),
        name: "Elemental Rules Sandbox".to_string(),
        mode: ProjectMode::World3D,
        template: ProjectTemplate::SystemicSandbox,
        enabled_modules: vec![
            "Phantom.Core".to_string(),
            "Phantom.Render3D".to_string(),
            "Phantom.Physics3D".to_string(),
            "Phantom.Systems".to_string(),
            "Phantom.Interactions".to_string(),
            "Phantom.VFX".to_string(),
        ],
        runtime: ProjectRuntime::default(),
        world: PhantomWorld {
            name: "Rule Foundry".to_string(),
            active_scene: 0,
            regions: vec!["Interaction Court".to_string()],
            streaming_cells: vec!["0:0".to_string()],
            scenes: vec![PhantomScene {
                id: "scene-rule-foundry".to_string(),
                name: "Capability Court".to_string(),
                rich_entities: vec![
                    entity(
                        1,
                        "Foundry Ground",
                        EntityKind::Ground,
                        Vec3::new(0.0, -0.3, 0.0),
                        Vec3::new(11.0, 0.3, 9.0),
                        "#263b36",
                    ),
                    systemic_entity(
                        2,
                        "Timber Crate",
                        Vec3::new(-3.0, 0.65, 0.0),
                        "#bf7b43",
                        &["Movable", "Breakable", "Flammable", "Wettable"],
                    ),
                    systemic_entity(
                        3,
                        "Copper Relay",
                        Vec3::new(-1.0, 0.65, 0.0),
                        "#d38b55",
                        &["Movable", "Conductive", "Powered", "Wettable"],
                    ),
                    systemic_entity(
                        4,
                        "Crystal Vessel",
                        Vec3::new(1.0, 0.65, 0.0),
                        "#6cb8ff",
                        &["Movable", "Freezable", "Breakable", "Wettable"],
                    ),
                    systemic_entity(
                        5,
                        "Blast Cell",
                        Vec3::new(3.0, 0.65, 0.0),
                        "#ff647c",
                        &["Movable", "Explosive", "Flammable", "Conductive"],
                    ),
                    entity(
                        6,
                        "Foundry Sun",
                        EntityKind::DirectionalLight,
                        Vec3::new(4.0, 7.0, 3.0),
                        Vec3::new(1.0, 1.0, 1.0),
                        "#ffe0a1",
                    ),
                    entity(
                        7,
                        "Systems Camera",
                        EntityKind::Camera,
                        Vec3::new(7.0, 5.0, 9.0),
                        Vec3::new(1.0, 1.0, 1.0),
                        "#84d7ff",
                    ),
                ],
                simulation_entities: Vec::new(),
            }],
        },
    }
}

fn default_project(template: ProjectTemplate) -> PhantomProject {
    match template {
        ProjectTemplate::Foundation3D => default_3d_project(),
        ProjectTemplate::RtsStress => default_rts_project(),
        ProjectTemplate::FpsPrototype => default_fps_project(),
        ProjectTemplate::SystemicSandbox => default_systemic_project(),
        ProjectTemplate::CanvasLab => default_canvas_project(),
    }
}

fn formation_entities(count: usize, id_start: u64) -> Vec<SimEntity> {
    (0..count)
        .map(|index| {
            let column = index % 12;
            let row = index / 12;
            SimEntity {
                id: id_start + index as u64,
                archetype: "Phantom.Simulation.Agent".to_string(),
                position: Vec3::new(-4.4 + column as f32 * 0.46, 0.08, 2.7 + row as f32 * 0.42),
                tint: if row % 2 == 0 {
                    "#58d7ff".to_string()
                } else {
                    "#5ef1ad".to_string()
                },
                velocity: Vec3::default(),
                target: Vec3::new(-4.4 + column as f32 * 0.46, 0.08, 2.7 + row as f32 * 0.42),
                team: 0,
                health: 100.0,
                selected: false,
            }
        })
        .collect()
}

fn formation_team(
    count: usize,
    id_start: u64,
    team: u8,
    origin: Vec3,
    target: Vec3,
    tint: &str,
) -> Vec<SimEntity> {
    let columns = 32usize;
    (0..count)
        .map(|index| {
            let column = index % columns;
            let row = index / columns;
            let position = Vec3::new(
                origin.x + (column as f32 - columns as f32 * 0.5) * 0.19,
                origin.y,
                origin.z + row as f32 * 0.19,
            );
            SimEntity {
                id: id_start + index as u64,
                archetype: "Phantom.RTS.Infantry".to_string(),
                position,
                tint: tint.to_string(),
                velocity: Vec3::default(),
                target,
                team,
                health: 100.0,
                selected: false,
            }
        })
        .collect()
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct SimulationTick {
    moved: usize,
    engaged: usize,
    active: usize,
}

fn tick_rts_simulation(project: &mut PhantomProject, delta_seconds: f32) -> SimulationTick {
    if project.template != ProjectTemplate::RtsStress {
        return SimulationTick::default();
    }
    let mut report = SimulationTick::default();
    for entity in &mut project.active_scene_mut().simulation_entities {
        if entity.health <= 0.0 {
            continue;
        }
        report.active += 1;
        let offset = entity.target.sub(entity.position);
        let distance = offset.length();
        if distance > 0.35 {
            let speed = if entity.selected { 1.8 } else { 1.25 };
            entity.velocity = offset.normalized().mul(speed);
            entity.position = entity.position.add(entity.velocity.mul(delta_seconds));
            report.moved += 1;
        } else {
            entity.velocity = Vec3::default();
            entity.health = (entity.health - 7.5 * delta_seconds).max(0.0);
            report.engaged += 1;
        }
    }
    report
}

fn select_rts_team(project: &mut PhantomProject, team: u8) -> usize {
    let mut selected = 0;
    for entity in &mut project.active_scene_mut().simulation_entities {
        entity.selected = entity.team == team && entity.health > 0.0;
        selected += usize::from(entity.selected);
    }
    selected
}

fn command_selected_rts_units(project: &mut PhantomProject, target: Vec3) -> usize {
    let mut commanded = 0;
    for entity in &mut project.active_scene_mut().simulation_entities {
        if entity.selected && entity.health > 0.0 {
            let lane = ((entity.id % 31) as f32 - 15.0) * 0.08;
            entity.target = Vec3::new(target.x + lane, target.y, target.z + lane * 0.45);
            commanded += 1;
        }
    }
    commanded
}

fn fps_forward(camera: EditorCamera) -> Vec3 {
    let yaw = camera.yaw.to_radians();
    let pitch = camera.pitch.to_radians();
    Vec3::new(
        yaw.sin() * pitch.cos(),
        pitch.sin(),
        yaw.cos() * pitch.cos(),
    )
    .normalized()
}

fn move_fps_camera(camera: &mut EditorCamera, forward_amount: f32, right_amount: f32) {
    if !camera.first_person {
        return;
    }
    let forward = fps_forward(*camera);
    let planar_forward = Vec3::new(forward.x, 0.0, forward.z).normalized();
    let right = Vec3::new(planar_forward.z, 0.0, -planar_forward.x);
    let movement = planar_forward
        .mul(forward_amount)
        .add(right.mul(right_amount));
    camera.position.x = (camera.position.x + movement.x).clamp(-4.4, 4.4);
    camera.position.z = (camera.position.z + movement.z).clamp(-7.8, 8.0);
    camera.target = camera.position.add(fps_forward(*camera).mul(7.0));
}

fn fire_fps_weapon(project: &mut PhantomProject, camera: EditorCamera) -> String {
    if project.template != ProjectTemplate::FpsPrototype {
        return "The FPS weapon is only active in FPS Lab.".to_string();
    }
    if project.runtime.ammo == 0 {
        return "Magazine empty. Reload before firing.".to_string();
    }
    project.runtime.ammo -= 1;
    project.runtime.shots_fired += 1;
    project.runtime.player_position = camera.position;
    project.runtime.player_yaw = camera.yaw;
    let origin = camera.position;
    let forward = fps_forward(camera);
    let mut best: Option<(usize, f32)> = None;
    for (index, entity) in project.active_scene().rich_entities.iter().enumerate() {
        if !entity.visible || !entity.capabilities.iter().any(|item| item == "Damageable") {
            continue;
        }
        let to_target = entity.transform.position.sub(origin);
        let along_ray = to_target.dot(forward);
        if along_ray <= 0.0 {
            continue;
        }
        let nearest = origin.add(forward.mul(along_ray));
        let miss_distance = entity.transform.position.sub(nearest).length();
        let hit_radius = entity
            .transform
            .scale
            .x
            .max(entity.transform.scale.y)
            .max(entity.transform.scale.z)
            * 0.62;
        if miss_distance <= hit_radius
            && best
                .as_ref()
                .is_none_or(|(_, best_distance)| along_ray < *best_distance)
        {
            best = Some((index, along_ray));
        }
    }
    if let Some((index, _)) = best {
        let target = &mut project.active_scene_mut().rich_entities[index];
        target.health = (target.health - 34.0).max(0.0);
        let destroyed = target.health <= 0.0;
        if destroyed {
            target.visible = false;
        }
        let name = target.name.clone();
        let health = target.health;
        project.runtime.confirmed_hits += 1;
        if destroyed {
            format!("Confirmed hit: {name} destroyed.")
        } else {
            format!("Confirmed hit: {name} at {health:.0} health.")
        }
    } else {
        "Shot fired; no target intersected the weapon ray.".to_string()
    }
}

fn reload_fps_weapon(project: &mut PhantomProject) -> u32 {
    let needed = 30u32.saturating_sub(project.runtime.ammo);
    let loaded = needed.min(project.runtime.reserve_ammo);
    project.runtime.ammo += loaded;
    project.runtime.reserve_ammo -= loaded;
    loaded
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stimulus {
    Fire,
    Water,
    Cold,
    Electricity,
    Force,
}

impl Stimulus {
    fn label(self) -> &'static str {
        match self {
            Self::Fire => "Fire",
            Self::Water => "Water",
            Self::Cold => "Cold",
            Self::Electricity => "Electricity",
            Self::Force => "Force",
        }
    }
}

fn add_state(entity: &mut RichEntity, state: &str) {
    if !entity.states.iter().any(|item| item == state) {
        entity.states.push(state.to_string());
    }
}

fn apply_stimulus(entity: &mut RichEntity, stimulus: Stimulus) -> Vec<String> {
    let capabilities = entity.capabilities.clone();
    let has = |capability: &str| capabilities.iter().any(|item| item == capability);
    let mut reactions = Vec::new();
    match stimulus {
        Stimulus::Fire if has("Flammable") => {
            add_state(entity, "Burning");
            entity.health = (entity.health - 25.0).max(0.0);
            reactions.push("Flammable → Burning".to_string());
            if has("Explosive") {
                add_state(entity, "Armed");
                reactions.push("Explosive → Armed".to_string());
            }
        }
        Stimulus::Water if has("Wettable") => {
            add_state(entity, "Wet");
            entity.states.retain(|state| state != "Burning");
            reactions.push("Wettable → Wet; extinguish Burning".to_string());
        }
        Stimulus::Cold if has("Freezable") => {
            add_state(entity, "Frozen");
            reactions.push("Freezable → Frozen".to_string());
        }
        Stimulus::Electricity if has("Conductive") => {
            add_state(entity, "Electrified");
            let wet_bonus = entity.states.iter().any(|state| state == "Wet");
            entity.health = (entity.health - if wet_bonus { 35.0 } else { 12.0 }).max(0.0);
            reactions.push(if wet_bonus {
                "Conductive + Wet → amplified Electrified".to_string()
            } else {
                "Conductive → Electrified".to_string()
            });
        }
        Stimulus::Force if has("Movable") => {
            entity.transform.position.x = (entity.transform.position.x + 0.75).min(4.5);
            add_state(entity, "Displaced");
            reactions.push("Movable → Displaced".to_string());
        }
        _ => reactions.push(format!(
            "No {} rule matched this capability set",
            stimulus.label()
        )),
    }
    if entity.health <= 0.0 && has("Breakable") {
        add_state(entity, "Broken");
        entity.visible = false;
        reactions.push("Damageable threshold → Broken".to_string());
    }
    reactions
}

fn apply_stimulus_to_selected(
    project: &mut PhantomProject,
    selected_id: u64,
    stimulus: Stimulus,
) -> String {
    let Some(entity) = project
        .active_scene_mut()
        .rich_entities
        .iter_mut()
        .find(|entity| entity.id == selected_id)
    else {
        return "Select a rich entity before applying a system stimulus.".to_string();
    };
    let entity_name = entity.name.clone();
    let reactions = apply_stimulus(entity, stimulus);
    format!(
        "{} → {}: {}",
        stimulus.label(),
        entity_name,
        reactions.join(" · ")
    )
}

fn rotate_point(mut point: Vec3, rotation: Vec3) -> Vec3 {
    let rx = rotation.x.to_radians();
    let ry = rotation.y.to_radians();
    let rz = rotation.z.to_radians();

    let (sin_x, cos_x) = rx.sin_cos();
    point = Vec3::new(
        point.x,
        point.y * cos_x - point.z * sin_x,
        point.y * sin_x + point.z * cos_x,
    );
    let (sin_y, cos_y) = ry.sin_cos();
    point = Vec3::new(
        point.x * cos_y + point.z * sin_y,
        point.y,
        -point.x * sin_y + point.z * cos_y,
    );
    let (sin_z, cos_z) = rz.sin_cos();
    Vec3::new(
        point.x * cos_z - point.y * sin_z,
        point.x * sin_z + point.y * cos_z,
        point.z,
    )
}

fn transform_point(point: Vec3, transform: Transform3D) -> Vec3 {
    let scaled = Vec3::new(
        point.x * transform.scale.x,
        point.y * transform.scale.y,
        point.z * transform.scale.z,
    );
    rotate_point(scaled, transform.rotation).add(transform.position)
}

fn camera_position(camera: EditorCamera) -> Vec3 {
    if camera.first_person {
        return camera.position;
    }
    let yaw = camera.yaw.to_radians();
    let pitch = camera.pitch.to_radians();
    camera.target.add(Vec3::new(
        yaw.sin() * pitch.cos() * camera.distance,
        pitch.sin() * camera.distance,
        yaw.cos() * pitch.cos() * camera.distance,
    ))
}

fn project_point(point: Vec3, camera: EditorCamera) -> Option<(f32, f32, f32)> {
    let position = camera_position(camera);
    let forward = if camera.first_person {
        fps_forward(camera)
    } else {
        camera.target.sub(position).normalized()
    };
    let right = forward.cross(Vec3::new(0.0, 1.0, 0.0)).normalized();
    let up = right.cross(forward).normalized();
    let relative = point.sub(position);
    let depth = relative.dot(forward);
    if depth <= 0.08 {
        return None;
    }
    let focal = if camera.perspective {
        0.5 * VIEW_HEIGHT / (55.0_f32.to_radians() * 0.5).tan()
    } else {
        92.0
    };
    let perspective = if camera.perspective {
        focal / depth
    } else {
        focal
    };
    Some((
        VIEW_WIDTH * 0.5 + relative.dot(right) * perspective,
        VIEW_HEIGHT * 0.5 - relative.dot(up) * perspective,
        depth,
    ))
}

fn parse_hex(color: &str) -> (u8, u8, u8) {
    let trimmed = color.trim().trim_start_matches('#');
    if trimmed.len() == 6 {
        let red = u8::from_str_radix(&trimmed[0..2], 16).unwrap_or(80);
        let green = u8::from_str_radix(&trimmed[2..4], 16).unwrap_or(220);
        let blue = u8::from_str_radix(&trimmed[4..6], 16).unwrap_or(160);
        (red, green, blue)
    } else {
        (80, 220, 160)
    }
}

fn shade_color(color: &str, intensity: f32) -> String {
    let (red, green, blue) = parse_hex(color);
    let convert = |value: u8| ((value as f32 * intensity).clamp(0.0, 255.0)) as u8;
    format!(
        "#{:02x}{:02x}{:02x}",
        convert(red),
        convert(green),
        convert(blue)
    )
}

fn build_scene_render(
    project: &PhantomProject,
    camera: EditorCamera,
    selected_id: u64,
) -> SceneRender {
    let mut render = SceneRender::default();
    let scene = project.active_scene();
    if project.mode == ProjectMode::Canvas2D {
        for entity in scene.rich_entities.iter().filter(|entity| entity.visible) {
            render.points.push(RenderPoint {
                entity_id: entity.id,
                x: VIEW_WIDTH * 0.5 + entity.transform.position.x * 82.0,
                y: VIEW_HEIGHT * 0.5 - entity.transform.position.y * 82.0,
                radius: 30.0 * entity.transform.scale.x.max(0.25),
                fill: entity.material.base_color.clone(),
                selected: entity.id == selected_id,
            });
        }
        for sim in scene.simulation_entities.iter().take(96) {
            render.points.push(RenderPoint {
                entity_id: sim.id,
                x: 95.0 + ((sim.id % 18) as f32 * 42.0),
                y: 96.0 + (((sim.id / 18) % 5) as f32 * 42.0),
                radius: 4.0,
                fill: sim.tint.clone(),
                selected: sim.selected,
            });
        }
        return render;
    }

    for grid_index in -10..=10 {
        let coordinate = grid_index as f32;
        for (start, end) in [
            (
                Vec3::new(coordinate, 0.0, -10.0),
                Vec3::new(coordinate, 0.0, 10.0),
            ),
            (
                Vec3::new(-10.0, 0.0, coordinate),
                Vec3::new(10.0, 0.0, coordinate),
            ),
        ] {
            if let (Some(a), Some(b)) = (project_point(start, camera), project_point(end, camera)) {
                render.grid.push(RenderLine {
                    x1: a.0,
                    y1: a.1,
                    x2: b.0,
                    y2: b.1,
                    color: if grid_index == 0 {
                        "rgba(93, 238, 175, .24)".to_string()
                    } else {
                        "rgba(122, 151, 165, .10)".to_string()
                    },
                    width: if grid_index == 0 { 1.35 } else { 0.75 },
                });
            }
        }
    }

    let cube_vertices = [
        Vec3::new(-0.5, -0.5, -0.5),
        Vec3::new(0.5, -0.5, -0.5),
        Vec3::new(0.5, 0.5, -0.5),
        Vec3::new(-0.5, 0.5, -0.5),
        Vec3::new(-0.5, -0.5, 0.5),
        Vec3::new(0.5, -0.5, 0.5),
        Vec3::new(0.5, 0.5, 0.5),
        Vec3::new(-0.5, 0.5, 0.5),
    ];
    let face_indices = [
        [0, 1, 2, 3],
        [5, 4, 7, 6],
        [4, 0, 3, 7],
        [1, 5, 6, 2],
        [3, 2, 6, 7],
        [4, 5, 1, 0],
    ];
    let light_position = scene
        .rich_entities
        .iter()
        .find(|entity| entity.kind == EntityKind::DirectionalLight)
        .map(|entity| entity.transform.position)
        .unwrap_or(Vec3::new(4.0, 6.0, 3.0));

    for entity in scene.rich_entities.iter().filter(|entity| {
        entity.visible
            && !matches!(
                entity.kind,
                EntityKind::DirectionalLight | EntityKind::Camera | EntityKind::Sprite
            )
    }) {
        let transformed: Vec<Vec3> = cube_vertices
            .iter()
            .map(|point| transform_point(*point, entity.transform))
            .collect();
        for indices in face_indices {
            let world_face = [
                transformed[indices[0]],
                transformed[indices[1]],
                transformed[indices[2]],
                transformed[indices[3]],
            ];
            let normal = world_face[1]
                .sub(world_face[0])
                .cross(world_face[2].sub(world_face[0]))
                .normalized();
            let center = world_face
                .iter()
                .fold(Vec3::default(), |sum, point| sum.add(*point))
                .mul(0.25);
            let camera_direction = camera_position(camera).sub(center).normalized();
            if normal.dot(camera_direction) <= -0.08 {
                continue;
            }
            let light_direction = light_position.sub(center).normalized();
            let diffuse = normal.dot(light_direction).max(0.0);
            let intensity = 0.38 + diffuse * 0.62 + entity.material.emissive * 0.4;
            let mut projected = Vec::new();
            let mut depth = 0.0;
            for point in world_face {
                let Some(screen) = project_point(point, camera) else {
                    projected.clear();
                    break;
                };
                projected.push(format!("{:.1},{:.1}", screen.0, screen.1));
                depth += screen.2;
            }
            if projected.len() == 4 {
                render.faces.push(RenderFace {
                    entity_id: entity.id,
                    points: projected.join(" "),
                    fill: shade_color(&entity.material.base_color, intensity),
                    depth: depth * 0.25,
                    selected: entity.id == selected_id,
                });
            }
        }
    }
    render
        .faces
        .sort_by(|a, b| b.depth.partial_cmp(&a.depth).unwrap_or(Ordering::Equal));

    let simulation_stride = (scene.simulation_entities.len() / 400).max(1);
    for sim in scene
        .simulation_entities
        .iter()
        .step_by(simulation_stride)
        .take(400)
    {
        if let Some(screen) = project_point(sim.position, camera) {
            render.points.push(RenderPoint {
                entity_id: sim.id,
                x: screen.0,
                y: screen.1,
                radius: (22.0 / screen.2).clamp(1.8, 5.0) + if sim.selected { 1.2 } else { 0.0 },
                fill: sim.tint.clone(),
                selected: sim.selected,
            });
        }
    }

    if let Some(selected) = scene
        .rich_entities
        .iter()
        .find(|entity| entity.id == selected_id)
    {
        let origin = selected.transform.position;
        for (axis, color) in [
            (Vec3::new(1.4, 0.0, 0.0), "#ff647c"),
            (Vec3::new(0.0, 1.4, 0.0), "#5ef1ad"),
            (Vec3::new(0.0, 0.0, 1.4), "#58b8ff"),
        ] {
            if let (Some(a), Some(b)) = (
                project_point(origin, camera),
                project_point(origin.add(axis), camera),
            ) {
                render.gizmo.push(RenderLine {
                    x1: a.0,
                    y1: a.1,
                    x2: b.0,
                    y2: b.1,
                    color: color.to_string(),
                    width: 3.0,
                });
            }
        }
    }
    render
}

fn next_rich_id(project: &PhantomProject) -> u64 {
    project
        .active_scene()
        .rich_entities
        .iter()
        .map(|entity| entity.id)
        .max()
        .unwrap_or(0)
        + 1
}

fn add_rich_entity(project: &mut PhantomProject, kind: EntityKind) -> u64 {
    let id = next_rich_id(project);
    let (name, position, scale, color) = match kind {
        EntityKind::Cube => (
            format!("Cube {id}"),
            Vec3::new(0.0, 0.6, 0.0),
            Vec3::new(1.0, 1.0, 1.0),
            "#55dda5",
        ),
        EntityKind::DirectionalLight => (
            format!("Key Light {id}"),
            Vec3::new(3.0, 6.0, 2.0),
            Vec3::new(1.0, 1.0, 1.0),
            "#ffe0a1",
        ),
        EntityKind::Camera => (
            format!("Camera {id}"),
            Vec3::new(5.0, 4.0, 8.0),
            Vec3::new(1.0, 1.0, 1.0),
            "#7bd3ff",
        ),
        EntityKind::SystemicCrate => (
            format!("Systemic Crate {id}"),
            Vec3::new(0.0, 0.55, 0.0),
            Vec3::new(1.1, 1.1, 1.1),
            "#d69847",
        ),
        EntityKind::Sprite => (
            format!("Sprite {id}"),
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(1.0, 1.0, 1.0),
            "#55dda5",
        ),
        EntityKind::Ground => (
            format!("Ground {id}"),
            Vec3::new(0.0, -0.25, 0.0),
            Vec3::new(8.0, 0.25, 8.0),
            "#263b36",
        ),
    };
    let mut created = entity(id, &name, kind, position, scale, color);
    if kind == EntityKind::SystemicCrate {
        created.capabilities = vec![
            "Movable".to_string(),
            "Breakable".to_string(),
            "Flammable".to_string(),
            "Conductive".to_string(),
        ];
    }
    project.active_scene_mut().rich_entities.push(created);
    id
}

fn update_selected_transform(
    mut project: Signal<PhantomProject>,
    selected_id: u64,
    field: &'static str,
    value: f32,
) {
    let mut next = project().clone();
    let Some(entity) = next
        .active_scene_mut()
        .rich_entities
        .iter_mut()
        .find(|entity| entity.id == selected_id)
    else {
        return;
    };
    match field {
        "px" => entity.transform.position.x = value,
        "py" => entity.transform.position.y = value,
        "pz" => entity.transform.position.z = value,
        "rx" => entity.transform.rotation.x = value,
        "ry" => entity.transform.rotation.y = value,
        "rz" => entity.transform.rotation.z = value,
        "sx" => entity.transform.scale.x = value.max(0.05),
        "sy" => entity.transform.scale.y = value.max(0.05),
        "sz" => entity.transform.scale.z = value.max(0.05),
        _ => return,
    }
    project.set(next);
}

fn nudge_selected_transform(
    project: Signal<PhantomProject>,
    selected_id: u64,
    field: &'static str,
    delta: f32,
) {
    let next_value = project()
        .active_scene()
        .rich_entities
        .iter()
        .find(|entity| entity.id == selected_id)
        .map(|entity| match field {
            "px" => entity.transform.position.x,
            "py" => entity.transform.position.y,
            "pz" => entity.transform.position.z,
            _ => 0.0,
        })
        .unwrap_or_default()
        + delta;
    update_selected_transform(project, selected_id, field, next_value);
}

fn apply_structured_command(
    mut project: Signal<PhantomProject>,
    mut selected_id: Signal<u64>,
    mut receipts: Signal<Vec<String>>,
    mut status: Signal<String>,
    command: String,
) {
    let normalized = command.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        status.set("Describe the world change for Phantom AI.".to_string());
        return;
    }
    let mut next = project().clone();
    let mut actions = Vec::new();
    let mut selected = None;
    if normalized.contains("forest") {
        let start = next
            .active_scene()
            .simulation_entities
            .iter()
            .map(|entity| entity.id)
            .max()
            .unwrap_or(5000)
            + 1;
        for index in 0..96 {
            let column = index % 16;
            let row = index / 16;
            next.active_scene_mut().simulation_entities.push(SimEntity {
                id: start + index as u64,
                archetype: "Phantom.Foliage.Tree".to_string(),
                position: Vec3::new(-7.0 + column as f32 * 0.9, 0.08, -5.5 + row as f32 * 0.92),
                tint: if index % 3 == 0 {
                    "#4ebf82".to_string()
                } else {
                    "#2f9368".to_string()
                },
                velocity: Vec3::default(),
                target: Vec3::new(-7.0 + column as f32 * 0.9, 0.08, -5.5 + row as f32 * 0.92),
                team: 0,
                health: 100.0,
                selected: false,
            });
        }
        actions.extend([
            "CreateEntities · 96 lightweight foliage entities".to_string(),
            "ScatterInstances · deterministic 16 × 6 region".to_string(),
            "ConfigureLOD · simulation + render distance tiers".to_string(),
            "ConfigureCollision · rich interaction proxies only".to_string(),
        ]);
    } else if normalized.contains("rts")
        || normalized.contains("army")
        || normalized.contains("formation")
    {
        let start = next
            .active_scene()
            .simulation_entities
            .iter()
            .map(|entity| entity.id)
            .max()
            .unwrap_or(6000)
            + 1;
        next.active_scene_mut()
            .simulation_entities
            .extend(formation_entities(512, start));
        actions.extend([
            "CreateEntities · 512 cache-friendly simulation agents".to_string(),
            "AssignFormation · 32 × 16 command block".to_string(),
            "ConfigureNavigation · grid provider".to_string(),
            "ConfigureLOD · batched simulation".to_string(),
        ]);
    } else if normalized.contains("light") {
        selected = Some(add_rich_entity(&mut next, EntityKind::DirectionalLight));
        actions.extend([
            "CreateEntity · DirectionalLight".to_string(),
            "ConfigureLighting · shadow-ready key light".to_string(),
        ]);
    } else if normalized.contains("camera") {
        selected = Some(add_rich_entity(&mut next, EntityKind::Camera));
        actions.extend([
            "CreateEntity · PerspectiveCamera".to_string(),
            "ConfigureCamera · 55° field of view".to_string(),
        ]);
    } else if normalized.contains("system")
        || normalized.contains("crate")
        || normalized.contains("flammable")
    {
        selected = Some(add_rich_entity(&mut next, EntityKind::SystemicCrate));
        actions.extend([
            "CreateEntity · SystemicCrate prefab".to_string(),
            "AssignCapabilities · Movable, Breakable, Flammable, Conductive".to_string(),
            "ConfigurePhysics · dynamic body + interaction proxy".to_string(),
        ]);
    } else {
        let kind = if next.mode == ProjectMode::Canvas2D {
            EntityKind::Sprite
        } else {
            EntityKind::Cube
        };
        selected = Some(add_rich_entity(&mut next, kind));
        actions.extend([
            format!("CreateEntity · {}", kind.label()),
            "AssignMaterial · Phantom Standard".to_string(),
            "ConfigureSelection · editor pickable".to_string(),
        ]);
    }
    project.set(next);
    if let Some(id) = selected {
        selected_id.set(id);
    }
    let summary = format!(
        "Executed {} structured engine action{}.",
        actions.len(),
        if actions.len() == 1 { "" } else { "s" }
    );
    let mut history = receipts().clone();
    history.splice(
        0..0,
        actions.into_iter().map(|action| format!("✓ {action}")),
    );
    history.truncate(8);
    receipts.set(history);
    status.set(summary);
}

fn switch_project_template(
    template: ProjectTemplate,
    mut project: Signal<PhantomProject>,
    mut selected_id: Signal<u64>,
    mut camera: Signal<EditorCamera>,
    mut status: Signal<String>,
) {
    let next = load_project(template).unwrap_or_else(|_| default_project(template));
    let first = next
        .active_scene()
        .rich_entities
        .iter()
        .find(|entity| {
            !matches!(
                entity.kind,
                EntityKind::Ground | EntityKind::DirectionalLight | EntityKind::Camera
            )
        })
        .map(|entity| entity.id)
        .unwrap_or(0);
    project.set(next);
    selected_id.set(first);
    camera.set(EditorCamera::for_template(template));
    status.set(format!("{} workspace ready.", template.label()));
}

#[component]
pub(crate) fn PhantomEngineWorkspace(
    project_id: String,
    project_title: String,
    project_root: String,
    project_engine: String,
    project_files: Vec<String>,
    api_origin: String,
    ai_provider: String,
    ai_model: String,
    fallback_provider: String,
    allow_fallbacks: bool,
    timeout_ms: u64,
    api_online: Option<bool>,
    has_unsaved_changes: bool,
    on_open_settings: EventHandler<()>,
) -> Element {
    let mut command = use_signal(String::new);
    let mut busy = use_signal(|| false);
    let mut phase = use_signal(|| "Ready for a build command.".to_string());
    let mut error = use_signal(|| None::<String>);
    let mut output = use_signal(|| None::<super::EngineCommandOutput>);
    let mut advanced = use_signal(|| false);
    let mut active_run = use_signal(String::new);
    let cancel_origin = api_origin.clone();
    let root_label = project_root.clone();

    let can_run = !busy()
        && !has_unsaved_changes
        && api_online == Some(true)
        && !command().trim().is_empty()
        && !project_root.trim().is_empty();
    let route_label = if ai_provider.trim().is_empty() || ai_provider == "auto" {
        "AUTO ROUTE".to_string()
    } else {
        ai_provider.to_uppercase()
    };
    let connection_label = match api_online {
        Some(true) => "OPERATOR ONLINE",
        Some(false) => "OPERATOR OFFLINE",
        None => "CHECKING OPERATOR",
    };

    rsx! {
        style { {PHANTOM_ENGINE_STYLE} }
        section { class: "pe-engine-shell",
            header { class: "pe-operator-topbar",
                div { class: "pe-engine-title",
                    span { class: "pe-engine-mark", "P" }
                    div {
                        strong { "PHANTOM ENGINE" }
                        span { "AI-operated game creation" }
                    }
                    span { class: "pe-kernel-badge", "OPERATOR 0.2" }
                }
                div { class: "pe-active-project",
                    span { "ACTIVE PROJECT" }
                    strong { "{project_title}" }
                    small { "{project_engine}" }
                }
                div { class: "pe-operator-actions",
                    button {
                        class: "pe-settings-link",
                        onclick: move |_| on_open_settings.call(()),
                        "CONNECTIONS"
                    }
                    button {
                        class: if advanced() { "pe-advanced-toggle is-active" } else { "pe-advanced-toggle" },
                        onclick: move |_| advanced.set(!advanced()),
                        if advanced() { "← AI OPERATOR" } else { "ADVANCED CONTROLS" }
                    }
                }
            }

            if advanced() {
                div { class: "pe-manual-host",
                    AdvancedEngineWorkbench {}
                }
            } else {
                main { class: "pe-operator-home",
                    section { class: "pe-operator-hero",
                        div { class: "pe-eyebrow",
                            span { class: if api_online == Some(false) { "pe-health-dot is-offline" } else { "pe-health-dot" } }
                            "{connection_label}"
                            i { "·" }
                            "{route_label}"
                            if !ai_model.trim().is_empty() {
                                i { "·" }
                                "{ai_model}"
                            }
                        }
                        h1 { "Tell Phantom what the game should become." }
                        p { "Describe the result. Your connected model plans the work; the local Codex worker edits the project and runs checks. Review the changed files, command results, and anything that still needs attention here." }
                        small { class: "pe-project-path", "Development project: {root_label}" }
                        if has_unsaved_changes { p { class: "pe-operator-error", "Save your open source edits before starting the Engine worker." } }

                        div { class: if busy() { "pe-mission-composer is-running" } else { "pe-mission-composer" },
                            textarea {
                                value: "{command}",
                                disabled: busy(),
                                placeholder: "Example: Build a complete forest village with friendly NPCs, quests, combat, controller support, polished menus, and a verified Windows build. Keep iterating until the checks pass.",
                                oninput: move |event| command.set(event.value()),
                            }
                            div { class: "pe-composer-footer",
                                div { class: "pe-auto-pipeline",
                                    for label in ["PLAN", "SOURCE", "CODE", "BUILD", "VERIFY"] {
                                        span { "{label}" }
                                    }
                                }
                                button {
                                    class: "pe-run-agent",
                                    disabled: !can_run,
                                    onclick: move |_| {
                                        if !can_run {
                                            return;
                                        }
                                        let body = EngineCommandRequestBody {
                                            game_id: project_id.clone(),
                                            project_title: project_title.clone(),
                                            cwd: project_root.clone(),
                                            engine: project_engine.clone(),
                                            project_files: project_files.clone(),
                                            instruction: command().trim().to_string(),
                                            provider: ai_provider.clone(),
                                            model: ai_model.clone(),
                                            fallback_provider: fallback_provider.clone(),
                                            allow_fallbacks,
                                            timeout_ms: timeout_ms.max(600_000),
                                        };
                                        let origin = api_origin.clone();
                                        busy.set(true);
                                        error.set(None);
                                        output.set(None);
                                        phase.set("Architect is planning the complete change…".to_string());
                                        spawn(async move {
                                            match request_engine_command_at(&origin, body, move |id, message| {
                                                active_run.set(id);
                                                phase.set(message);
                                            }).await {
                                                Ok(result) => {
                                                    phase.set(if result.changed_files.is_empty() {
                                                        "No file changes detected. Review the worker's report.".to_string()
                                                    } else {
                                                        format!("{} changed project file{}. Review command evidence below.", result.changed_files.len(), if result.changed_files.len() == 1 { "" } else { "s" })
                                                    });
                                                    output.set(Some(result));
                                                }
                                                Err(message) => {
                                                    phase.set("Command stopped before acceptance.".to_string());
                                                    error.set(Some(message));
                                                }
                                            }
                                            busy.set(false);
                                        });
                                    },
                                    if busy() { "WORKING…" } else { "BUILD IT" }
                                }
                                if busy() && !active_run().is_empty() {
                                    button { class: "pe-settings-link",
                                        onclick: move |_| {
                                            let origin = cancel_origin.clone();
                                            let id = active_run();
                                            phase.set("Stopping; recording partial changes…".to_string());
                                            spawn(async move {
                                                if let Err(message) = super::cancel_engine_command_at(&origin, &id).await { error.set(Some(message)); }
                                            });
                                        }, "STOP WORKER"
                                    }
                                }
                            }
                        }

                        div { class: "pe-command-templates",
                            button { disabled: busy(), onclick: move |_| command.set("Inspect this entire game, fix the highest-impact broken or incomplete systems, improve the player experience, then compile, test, and leave a verified build receipt.".to_string()), "FIX + COMPLETE" }
                            button { disabled: busy(), onclick: move |_| command.set("Create the missing production-quality world content, source only license-safe models and textures, integrate them natively, optimize the result, and verify the playable build.".to_string()), "BUILD WORLD" }
                            button { disabled: busy(), onclick: move |_| command.set("Audit every menu, HUD element, input path, gameplay loop, and launch flow. Repair all reproducible failures and verify the packaged Windows game.".to_string()), "QA + PACKAGE" }
                            button { disabled: busy(), onclick: move |_| command.set("Upgrade the visual direction and moment-to-moment feel to match the project references while preserving its identity. Implement the improvements and prove them with build checks.".to_string()), "VISUAL UPGRADE" }
                        }
                    }

                    section { class: "pe-operator-grid",
                        article { class: "pe-capability-card",
                            span { "AUTONOMOUS PIPELINE" }
                            strong { "One command → actual project changes" }
                            p { "The architect breaks the request into work. The local Codex lane edits only this project. Phantom then records exactly which files changed." }
                            div { class: "pe-capability-tags",
                                span { "CODE" }
                                span { "WORLDS" }
                                span { "UI" }
                                span { "GAMEPLAY" }
                                span { "BUILDS" }
                            }
                        }
                        article { class: "pe-capability-card",
                            span { "ASSET INTELLIGENCE" }
                            strong { "Models and media, integrated—not linked" }
                            p { "When a command needs assets, Phantom is instructed to download usable files, verify licensing, preserve attribution, and wire them into the project." }
                            div { class: "pe-capability-tags",
                                span { "MODELS" }
                                span { "TEXTURES" }
                                span { "AUDIO" }
                                span { "LICENSES" }
                            }
                        }
                        article { class: "pe-capability-card",
                            span { "EVIDENCE, NOT ASSUMPTIONS" }
                            strong { "Receipts make every run inspectable" }
                            p { "Run receipts contain changed-file comparisons and command exit codes. They are not a visual quality certificate or an automatic backup. Commit or back up important work first." }
                            div { class: "pe-capability-tags",
                                span { "SCOPED" }
                                span { "AUDITED" }
                                span { "LOCAL" }
                                span { "REVIEWABLE" }
                            }
                        }
                    }

                    section { class: "pe-run-receipt",
                        div { class: "pe-receipt-heading",
                            div {
                                span { "LATEST OPERATOR RUN" }
                                strong { "{phase}" }
                            }
                            if busy() { span { class: "pe-running-indicator", "PHANTOM IS WORKING" } }
                        }
                        if let Some(message) = error() {
                            div { class: "pe-operator-error",
                                strong { "WHY IT STOPPED" }
                                p { "{message}" }
                                button { onclick: move |_| on_open_settings.call(()), "OPEN CONNECTIONS" }
                            }
                        } else if let Some(result) = output() {
                            div { class: "pe-receipt-success",
                                div { class: "pe-receipt-route",
                                    span { "PLAN" } strong { "{result.planner_provider} / {result.planner_model}" }
                                    i { "→" }
                                    span { "EXECUTE" } strong { "{result.executor_provider} / {result.executor_model}" }
                                }
                                p { "{result.summary}" }
                                if !result.snapshot_complete {
                                    p { class: "pe-operator-error", "File comparison was incomplete. This list may omit changes; review the project before publishing." }
                                }
                                details {
                                    summary { "Recorded commands ({result.commands.len()})" }
                                    if result.commands.is_empty() { p { "No command evidence was recorded. Build/test verification is not established." } }
                                    for evidence in result.commands.iter() {
                                        article {
                                            code { "{evidence.command}" }
                                            strong { {format!(" — exit {}", evidence.exit_code.map(|value| value.to_string()).unwrap_or_else(|| "unknown".to_string()))} }
                                            pre { "{evidence.output}" }
                                        }
                                    }
                                }
                                div { class: "pe-receipt-meta",
                                    span { "RUN {result.run_id}" }
                                    span { "STATUS {result.status.to_uppercase()}" }
                                    span { "RECEIPT {result.receipt_path}" }
                                }
                                if result.changed_files.is_empty() {
                                    small { "No changed files were detected after independent comparison." }
                                } else {
                                    div { class: "pe-changed-files",
                                        for path in result.changed_files.iter().take(12) {
                                            code { "+ {path}" }
                                        }
                                        if result.changed_files.len() > 12 {
                                            code { {format!("+ {} more files", result.changed_files.len() - 12)} }
                                        }
                                    }
                                }
                            }
                        } else {
                            div { class: "pe-empty-receipt",
                                strong { "No run yet" }
                                p { "Choose a production command above or describe the exact result. Phantom will show evidence here instead of pretending a job succeeded." }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[component]
fn AdvancedEngineWorkbench() -> Element {
    let initial =
        load_project(ProjectTemplate::Foundation3D).unwrap_or_else(|_| default_3d_project());
    let initial_selected = initial
        .active_scene()
        .rich_entities
        .iter()
        .find(|entity| {
            !matches!(
                entity.kind,
                EntityKind::Ground | EntityKind::DirectionalLight | EntityKind::Camera
            )
        })
        .map(|entity| entity.id)
        .unwrap_or(0);
    let initial_template = initial.template;
    let mut project = use_signal(move || initial.clone());
    let mut selected_id = use_signal(move || initial_selected);
    let mut camera = use_signal(move || EditorCamera::for_template(initial_template));
    let mut playing = use_signal(|| false);
    let mut module = use_signal(|| "Scene".to_string());
    let mut ai_command = use_signal(String::new);
    let receipts = use_signal(|| {
        vec![
            "✓ CreateWorld · First Light World".to_string(),
            "✓ ConfigureRenderer · Perspective + Canvas peers".to_string(),
            "✓ RegisterSystems · Transform, Render, Selection, Persistence".to_string(),
        ]
    });
    let mut status = use_signal(|| "Phantom Engine kernel ready.".to_string());

    let mut runtime_project = project;
    let runtime_playing = playing;
    let _simulation_driver = use_future(move || async move {
        loop {
            tokio::time::sleep(Duration::from_millis(80)).await;
            if runtime_playing() && runtime_project().template == ProjectTemplate::RtsStress {
                let mut next = runtime_project().clone();
                tick_rts_simulation(&mut next, 0.08);
                runtime_project.set(next);
            }
        }
    });

    let current = project();
    let scene = current.active_scene().clone();
    let selected = scene
        .rich_entities
        .iter()
        .find(|entity| entity.id == selected_id())
        .cloned();
    let render_backend = PhantomSoftwareBackend;
    let render = render_backend.render(&current, camera(), selected_id());
    let render_backend_name = render_backend.name();
    let rich_count = scene.rich_entities.len();
    let sim_count = scene.simulation_entities.len();
    let draw_calls = render.faces.len() + usize::from(!render.points.is_empty());
    let project_mode = current.mode;
    let project_template = current.template;
    let project_name = current.name.clone();
    let world_name = current.world.name.clone();
    let scene_name = scene.name.clone();
    let enabled_modules = current.enabled_modules.clone();
    let runtime = current.runtime.clone();
    drop(current);

    rsx! {
        style { {PHANTOM_ENGINE_STYLE} }
        section {
            class: if playing() { "phantom-engine is-playing" } else { "phantom-engine" },
            div { class: "pe-commandbar",
                div { class: "pe-engine-title",
                    span { class: "pe-engine-mark", "P" }
                    div {
                        strong { "PHANTOM ENGINE" }
                        span { "AI-native 2D · 2.5D · 3D runtime" }
                    }
                    span { class: "pe-kernel-badge", "KERNEL 0.1" }
                }
                div { class: "pe-project-modes",
                    for template in [ProjectTemplate::Foundation3D, ProjectTemplate::RtsStress, ProjectTemplate::FpsPrototype, ProjectTemplate::SystemicSandbox, ProjectTemplate::CanvasLab] {
                        button {
                            class: if project_template == template { "is-active" } else { "" },
                            onclick: move |_| switch_project_template(template, project, selected_id, camera, status),
                            "{template.label()}"
                        }
                    }
                }
                div { class: "pe-run-controls",
                    button {
                        class: if playing() { "pe-play is-live" } else { "pe-play" },
                        onclick: move |_| {
                            let next = !playing();
                            playing.set(next);
                            status.set(if next {
                                "Runtime playing from the editor world.".to_string()
                            } else {
                                "Runtime stopped; editor state restored.".to_string()
                            });
                        },
                        if playing() { "■ STOP" } else { "▶ PLAY" }
                    }
                    button {
                        onclick: move |_| match save_project(&project()) {
                            Ok(path) => status.set(format!("Saved {}", path.display())),
                            Err(error) => status.set(error),
                        },
                        "SAVE"
                    }
                    button {
                        onclick: move |_| {
                            let template = project().template;
                            match load_project(template) {
                                Ok(loaded) => {
                                    let first = loaded.active_scene().rich_entities.iter().find(|entity| {
                                        !matches!(entity.kind, EntityKind::Ground | EntityKind::DirectionalLight | EntityKind::Camera)
                                    }).map(|entity| entity.id).unwrap_or(0);
                                    project.set(loaded);
                                    selected_id.set(first);
                                    camera.set(EditorCamera::for_template(template));
                                    status.set("Saved project loaded.".to_string());
                                }
                                Err(error) => status.set(error),
                            }
                        },
                        "LOAD"
                    }
                }
            }

            nav { class: "pe-modulebar", aria_label: "Phantom Engine modules",
                for label in ["Scene", "World", "Assets", "Materials", "Animation", "Physics", "Navigation", "Entities", "Systems", "AI", "Profiler", "Console", "Builds", "Plugins"] {
                    {
                        let owned = label.to_string();
                        let value = owned.clone();
                        rsx! {
                            button {
                                class: if module() == label { "is-active" } else { "" },
                                onclick: move |_| module.set(value.clone()),
                                "{owned}"
                            }
                        }
                    }
                }
            }

            div { class: "pe-workbench",
                aside { class: "pe-hierarchy",
                    div { class: "pe-panel-heading",
                        div { span { "WORLD" } strong { "{world_name}" } }
                        button {
                            title: "Add entity",
                            onclick: move |_| {
                                let mut next = project().clone();
                                let kind = if next.mode == ProjectMode::Canvas2D { EntityKind::Sprite } else { EntityKind::Cube };
                                let id = add_rich_entity(&mut next, kind);
                                project.set(next);
                                selected_id.set(id);
                                status.set("Entity created through Phantom.Core.".to_string());
                            },
                            "+"
                        }
                    }
                    div { class: "pe-world-tree",
                        button { class: "pe-tree-root is-open", "⌄  {world_name}" }
                        button { class: "pe-tree-root is-open", "  ⌄  {scene_name}" }
                        div { class: "pe-tree-group",
                            span { "RICH ENTITIES · {rich_count}" }
                            for entity in scene.rich_entities.iter() {
                                {
                                    let entity_id = entity.id;
                                    rsx! {
                                        button {
                                            class: if selected_id() == entity_id { "pe-entity is-selected" } else { "pe-entity" },
                                            onclick: move |_| selected_id.set(entity_id),
                                            i { "{entity.kind.icon()}" }
                                            span { "{entity.name}" }
                                            small { "{entity.kind.label()}" }
                                        }
                                    }
                                }
                            }
                        }
                        div { class: "pe-tree-group is-simulation",
                            span { "SIMULATION ENTITIES · {sim_count}" }
                            button { class: "pe-entity",
                                i { "⠿" }
                                span { "Simulation Batch" }
                                small { "SoA · multithread ready" }
                            }
                        }
                    }
                    div { class: "pe-create-row",
                        button {
                            onclick: move |_| {
                                let mut next = project().clone();
                                let id = add_rich_entity(&mut next, EntityKind::Cube);
                                project.set(next); selected_id.set(id);
                            },
                            "+ CUBE"
                        }
                        button {
                            onclick: move |_| {
                                let mut next = project().clone();
                                let id = add_rich_entity(&mut next, EntityKind::DirectionalLight);
                                project.set(next); selected_id.set(id);
                            },
                            "+ LIGHT"
                        }
                        button {
                            onclick: move |_| {
                                let mut next = project().clone();
                                let id = add_rich_entity(&mut next, EntityKind::Camera);
                                project.set(next); selected_id.set(id);
                            },
                            "+ CAMERA"
                        }
                    }
                }

                main { class: "pe-viewport-panel",
                    div { class: "pe-viewport-toolbar",
                        div {
                            strong { "SCENE VIEW" }
                            span { "{project_name} / {scene_name}" }
                        }
                        div { class: "pe-tool-segment",
                            if project_template == ProjectTemplate::SystemicSandbox {
                                for (label, stimulus) in [
                                    ("FIRE", Stimulus::Fire),
                                    ("WATER", Stimulus::Water),
                                    ("COLD", Stimulus::Cold),
                                    ("ELECTRIC", Stimulus::Electricity),
                                    ("FORCE", Stimulus::Force),
                                ] {
                                    button {
                                        class: if stimulus == Stimulus::Fire { "is-active" } else { "" },
                                        onclick: move |_| {
                                            let mut next = project().clone();
                                            let result = apply_stimulus_to_selected(&mut next, selected_id(), stimulus);
                                            project.set(next);
                                            status.set(result);
                                        },
                                        "{label}"
                                    }
                                }
                            } else if project_template == ProjectTemplate::FpsPrototype {
                                button { onclick: move |_| camera.with_mut(|value| move_fps_camera(value, 0.45, 0.0)), "W" }
                                button { onclick: move |_| camera.with_mut(|value| move_fps_camera(value, -0.45, 0.0)), "S" }
                                button { onclick: move |_| camera.with_mut(|value| move_fps_camera(value, 0.0, -0.45)), "A" }
                                button { onclick: move |_| camera.with_mut(|value| move_fps_camera(value, 0.0, 0.45)), "D" }
                                button { onclick: move |_| camera.with_mut(|value| value.yaw -= 5.0), "TURN ◀" }
                                button { onclick: move |_| camera.with_mut(|value| value.yaw += 5.0), "TURN ▶" }
                                button {
                                    class: "is-active",
                                    onclick: move |_| {
                                        let mut next = project().clone();
                                        let result = fire_fps_weapon(&mut next, camera());
                                        project.set(next);
                                        status.set(result);
                                    },
                                    "FIRE"
                                }
                                button {
                                    onclick: move |_| {
                                        let mut next = project().clone();
                                        let loaded = reload_fps_weapon(&mut next);
                                        project.set(next);
                                        status.set(format!("Reloaded {loaded} rounds."));
                                    },
                                    "RELOAD"
                                }
                            } else if project_template == ProjectTemplate::RtsStress {
                                button {
                                    onclick: move |_| {
                                        let mut next = project().clone();
                                        let count = select_rts_team(&mut next, 1);
                                        project.set(next);
                                        status.set(format!("Selected {count} Blue formation units."));
                                    },
                                    "SELECT BLUE"
                                }
                                button {
                                    onclick: move |_| {
                                        let mut next = project().clone();
                                        let count = select_rts_team(&mut next, 2);
                                        project.set(next);
                                        status.set(format!("Selected {count} Red formation units."));
                                    },
                                    "SELECT RED"
                                }
                                button {
                                    class: "is-active",
                                    onclick: move |_| {
                                        let mut next = project().clone();
                                        let count = command_selected_rts_units(&mut next, Vec3::new(0.0, 0.08, 0.0));
                                        project.set(next);
                                        status.set(format!("Commanded {count} units into a center formation."));
                                    },
                                    "MOVE CENTER"
                                }
                                button {
                                    onclick: move |_| {
                                        let mut next = project().clone();
                                        let tick = tick_rts_simulation(&mut next, 0.25);
                                        project.set(next);
                                        status.set(format!("Simulation step: {} moved, {} engaged, {} active.", tick.moved, tick.engaged, tick.active));
                                    },
                                    "STEP"
                                }
                            } else {
                                button { class: "is-active", "MOVE" }
                                button { "ROTATE" }
                                button { "SCALE" }
                            }
                        }
                        div { class: "pe-camera-controls",
                            button { onclick: move |_| camera.with_mut(|value| value.yaw -= 10.0), "↶" }
                            button { onclick: move |_| camera.with_mut(|value| value.yaw += 10.0), "↷" }
                            button { onclick: move |_| camera.with_mut(|value| value.pitch = (value.pitch + 6.0).clamp(-75.0, 75.0)), "↑" }
                            button { onclick: move |_| camera.with_mut(|value| value.pitch = (value.pitch - 6.0).clamp(-75.0, 75.0)), "↓" }
                            button { onclick: move |_| camera.with_mut(|value| value.distance = (value.distance - 1.0).max(3.5)), "+" }
                            button { onclick: move |_| camera.with_mut(|value| value.distance = (value.distance + 1.0).min(30.0)), "−" }
                            button {
                                class: if camera().perspective { "is-active" } else { "" },
                                onclick: move |_| camera.with_mut(|value| value.perspective = !value.perspective),
                                if camera().perspective { "PERSPECTIVE" } else { "ORTHO" }
                            }
                            button { onclick: move |_| camera.set(EditorCamera::default()), "FRAME" }
                        }
                    }
                    div { class: "pe-viewport",
                        svg {
                            class: "pe-scene-svg",
                            view_box: "0 0 920 560",
                            preserve_aspect_ratio: "xMidYMid meet",
                            defs {
                                linearGradient { id: "pe-sky", x1: "0", y1: "0", x2: "0", y2: "1",
                                    stop { offset: "0%", stop_color: "#09131b" }
                                    stop { offset: "58%", stop_color: "#10252b" }
                                    stop { offset: "100%", stop_color: "#08100f" }
                                }
                                radialGradient { id: "pe-glow", cx: "50%", cy: "42%", r: "52%",
                                    stop { offset: "0%", stop_color: "rgba(71,239,169,.16)" }
                                    stop { offset: "100%", stop_color: "rgba(0,0,0,0)" }
                                }
                            }
                            rect { x: "0", y: "0", width: "920", height: "560", fill: "url(#pe-sky)" }
                            rect { x: "0", y: "0", width: "920", height: "560", fill: "url(#pe-glow)" }
                            if project_mode == ProjectMode::World3D {
                                for line in render.grid.iter() {
                                    line {
                                        x1: "{line.x1}", y1: "{line.y1}", x2: "{line.x2}", y2: "{line.y2}",
                                        stroke: "{line.color}", stroke_width: "{line.width}"
                                    }
                                }
                                for face in render.faces.iter() {
                                    {
                                        let entity_id = face.entity_id;
                                        rsx! {
                                            polygon {
                                                class: if face.selected { "pe-face is-selected" } else { "pe-face" },
                                                points: "{face.points}",
                                                fill: "{face.fill}",
                                                stroke: if face.selected { "#8affc6" } else { "rgba(220,255,244,.16)" },
                                                stroke_width: if face.selected { "2.2" } else { ".7" },
                                                onclick: move |_| selected_id.set(entity_id)
                                            }
                                        }
                                    }
                                }
                                for point in render.points.iter() {
                                    circle {
                                        cx: "{point.x}", cy: "{point.y}", r: "{point.radius}", fill: "{point.fill}", opacity: ".86",
                                        stroke: if point.selected { "#ffffff" } else { "transparent" },
                                        stroke_width: if point.selected { "1.2" } else { "0" }
                                    }
                                }
                                for line in render.gizmo.iter() {
                                    line {
                                        x1: "{line.x1}", y1: "{line.y1}", x2: "{line.x2}", y2: "{line.y2}",
                                        stroke: "{line.color}", stroke_width: "{line.width}", stroke_linecap: "round"
                                    }
                                    circle { cx: "{line.x2}", cy: "{line.y2}", r: "5", fill: "{line.color}" }
                                }
                            } else {
                                rect { x: "56", y: "48", width: "808", height: "464", rx: "16", fill: "rgba(4,11,15,.64)", stroke: "rgba(91,226,170,.25)" }
                                for point in render.points.iter() {
                                    {
                                        let entity_id = point.entity_id;
                                        rsx! {
                                            circle {
                                                class: "pe-canvas-object",
                                                cx: "{point.x}", cy: "{point.y}", r: "{point.radius}",
                                                fill: "{point.fill}",
                                                stroke: if selected_id() == entity_id { "#effff7" } else { "rgba(255,255,255,.22)" },
                                                stroke_width: if selected_id() == entity_id { "3" } else { "1" },
                                                onclick: move |_| selected_id.set(entity_id)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        div { class: "pe-viewport-overlay top-left",
                            span { if project_mode == ProjectMode::World3D { "PERSPECTIVE · LIT" } else { "CANVAS · IMMEDIATE" } }
                            strong { if playing() { "RUNTIME" } else { "EDITOR" } }
                        }
                        div { class: "pe-viewport-overlay top-right",
                            span { "{rich_count} RICH" }
                            span { "{sim_count} SIM" }
                            span { "{draw_calls} DRAWS" }
                        }
                        if playing() {
                            div { class: "pe-runtime-banner", span { class: "pe-live-dot" } "PLAYING PHANTOM RUNTIME" }
                        }
                        if project_template == ProjectTemplate::FpsPrototype {
                            div { class: "pe-fps-crosshair", span {} span {} }
                            div { class: "pe-fps-hud",
                                div { span { "CARBINE" } strong { "{runtime.ammo:02}" } small { "/ {runtime.reserve_ammo:03}" } }
                                div { span { "HITS" } strong { "{runtime.confirmed_hits}" } small { "/ {runtime.shots_fired}" } }
                            }
                        }
                    }
                    div { class: "pe-statusbar",
                        span { class: "pe-status-ready", "●" }
                        strong { "{status}" }
                        span { "Render: {render_backend_name} → IRenderBackend" }
                        span { "Physics: Ready" }
                        span { "AI tools: Structured" }
                    }
                }

                aside { class: "pe-inspector",
                    div { class: "pe-panel-heading",
                        div { span { "INSPECTOR" } strong { if let Some(entity) = selected.as_ref() { "{entity.name}" } else { "Nothing selected" } } }
                        span { class: "pe-lock", "⌁" }
                    }
                    if let Some(entity) = selected.as_ref() {
                        div { class: "pe-inspector-scroll",
                            section { class: "pe-inspector-card",
                                header { span { "TRANSFORM 3D" } small { "WORLD" } }
                                div { class: "pe-vector-row",
                                    span { "POSITION" }
                                    label { i { "X" } input { r#type: "number", step: "0.1", value: "{entity.transform.position.x}", oninput: move |event| if let Ok(value) = event.value().parse() { update_selected_transform(project, selected_id(), "px", value) } } }
                                    label { i { "Y" } input { r#type: "number", step: "0.1", value: "{entity.transform.position.y}", oninput: move |event| if let Ok(value) = event.value().parse() { update_selected_transform(project, selected_id(), "py", value) } } }
                                    label { i { "Z" } input { r#type: "number", step: "0.1", value: "{entity.transform.position.z}", oninput: move |event| if let Ok(value) = event.value().parse() { update_selected_transform(project, selected_id(), "pz", value) } } }
                                }
                                div { class: "pe-vector-row",
                                    span { "ROTATION" }
                                    label { i { "X" } input { r#type: "number", step: "1", value: "{entity.transform.rotation.x}", oninput: move |event| if let Ok(value) = event.value().parse() { update_selected_transform(project, selected_id(), "rx", value) } } }
                                    label { i { "Y" } input { r#type: "number", step: "1", value: "{entity.transform.rotation.y}", oninput: move |event| if let Ok(value) = event.value().parse() { update_selected_transform(project, selected_id(), "ry", value) } } }
                                    label { i { "Z" } input { r#type: "number", step: "1", value: "{entity.transform.rotation.z}", oninput: move |event| if let Ok(value) = event.value().parse() { update_selected_transform(project, selected_id(), "rz", value) } } }
                                }
                                div { class: "pe-vector-row",
                                    span { "SCALE" }
                                    label { i { "X" } input { r#type: "number", step: "0.1", min: "0.05", value: "{entity.transform.scale.x}", oninput: move |event| if let Ok(value) = event.value().parse() { update_selected_transform(project, selected_id(), "sx", value) } } }
                                    label { i { "Y" } input { r#type: "number", step: "0.1", min: "0.05", value: "{entity.transform.scale.y}", oninput: move |event| if let Ok(value) = event.value().parse() { update_selected_transform(project, selected_id(), "sy", value) } } }
                                    label { i { "Z" } input { r#type: "number", step: "0.1", min: "0.05", value: "{entity.transform.scale.z}", oninput: move |event| if let Ok(value) = event.value().parse() { update_selected_transform(project, selected_id(), "sz", value) } } }
                                }
                                div { class: "pe-gizmo-nudges",
                                    button { onclick: move |_| nudge_selected_transform(project, selected_id(), "px", -0.25), "X−" }
                                    button { onclick: move |_| nudge_selected_transform(project, selected_id(), "px", 0.25), "X+" }
                                    button { onclick: move |_| nudge_selected_transform(project, selected_id(), "py", -0.25), "Y−" }
                                    button { onclick: move |_| nudge_selected_transform(project, selected_id(), "py", 0.25), "Y+" }
                                    button { onclick: move |_| nudge_selected_transform(project, selected_id(), "pz", -0.25), "Z−" }
                                    button { onclick: move |_| nudge_selected_transform(project, selected_id(), "pz", 0.25), "Z+" }
                                }
                            }
                            section { class: "pe-inspector-card",
                                header { span { "RENDER COMPONENT" } small { "{entity.kind.label()}" } }
                                label { class: "pe-material-field",
                                    span { "MATERIAL" }
                                    strong { "{entity.material.name}" }
                                }
                                label { class: "pe-color-field",
                                    span { "BASE COLOR" }
                                    input {
                                        r#type: "color",
                                        value: "{entity.material.base_color}",
                                        oninput: move |event| {
                                            let mut next = project().clone();
                                            if let Some(target) = next.active_scene_mut().rich_entities.iter_mut().find(|target| target.id == selected_id()) {
                                                target.material.base_color = event.value();
                                            }
                                            project.set(next);
                                        }
                                    }
                                    code { "{entity.material.base_color}" }
                                }
                                div { class: "pe-material-metrics",
                                    span { "METALLIC" strong { "{entity.material.metallic:.2}" } }
                                    span { "ROUGHNESS" strong { "{entity.material.roughness:.2}" } }
                                }
                            }
                            section { class: "pe-inspector-card",
                                header { span { "COMPONENTS" } small { "{entity.components.len()} ACTIVE" } }
                                div { class: "pe-component-list",
                                    for component in entity.components.iter() {
                                        div {
                                            span { "{component.kind.label()}" }
                                            small { "{component.provider}" }
                                            i { if component.enabled { "ON" } else { "OFF" } }
                                        }
                                    }
                                }
                            }
                            section { class: "pe-inspector-card",
                                header { span { "CAPABILITIES" } small { "SYSTEMIC" } }
                                if entity.capabilities.is_empty() {
                                    p { class: "pe-empty-note", "No gameplay capabilities assigned." }
                                } else {
                                    div { class: "pe-capability-list",
                                        for capability in entity.capabilities.iter() {
                                            span { "{capability}" }
                                        }
                                    }
                                }
                                if !entity.states.is_empty() {
                                    div { class: "pe-state-list",
                                        for state in entity.states.iter() {
                                            span { "{state}" }
                                        }
                                    }
                                }
                                button {
                                    class: "pe-add-capability",
                                    onclick: move |_| {
                                        let mut next = project().clone();
                                        if let Some(target) = next.active_scene_mut().rich_entities.iter_mut().find(|target| target.id == selected_id())
                                            && !target.capabilities.iter().any(|item| item == "Interactable") {
                                            target.capabilities.push("Interactable".to_string());
                                        }
                                        project.set(next);
                                    },
                                    "+ INTERACTABLE"
                                }
                            }
                        }
                    } else {
                        div { class: "pe-empty-inspector", "Select an entity in the hierarchy or viewport." }
                    }
                }
            }

            section { class: "pe-bottom-dock",
                div { class: "pe-bottom-tabs",
                    for label in ["Assets", "AI Actions", "Profiler", "Console"] {
                        {
                            let owned = label.to_string();
                            let value = owned.clone();
                            rsx! {
                                button {
                                    class: if (module() == "AI" && label == "AI Actions") || module() == label { "is-active" } else { "" },
                                    onclick: move |_| module.set(if value == "AI Actions" { "AI".to_string() } else { value.clone() }),
                                    "{owned}"
                                }
                            }
                        }
                    }
                }
                div { class: "pe-bottom-content",
                    if module() == "AI" {
                        div { class: "pe-ai-console",
                            div { class: "pe-ai-heading",
                                span { "PHANTOM AI · ENGINE ARCHITECT" }
                                strong { "Operate the world through structured editor APIs" }
                            }
                            div { class: "pe-ai-composer",
                                input {
                                    value: "{ai_command}",
                                    placeholder: "Create a forest, add a light, build an RTS formation…",
                                    oninput: move |event| ai_command.set(event.value()),
                                    onkeydown: move |event| {
                                        if event.key() == Key::Enter {
                                            apply_structured_command(project, selected_id, receipts, status, ai_command());
                                            ai_command.set(String::new());
                                        }
                                    }
                                }
                                button {
                                    onclick: move |_| {
                                        apply_structured_command(project, selected_id, receipts, status, ai_command());
                                        ai_command.set(String::new());
                                    },
                                    "EXECUTE"
                                }
                            }
                            div { class: "pe-quick-actions",
                                button { onclick: move |_| apply_structured_command(project, selected_id, receipts, status, "Create a forest".to_string()), "CREATE FOREST" }
                                button { onclick: move |_| apply_structured_command(project, selected_id, receipts, status, "Create RTS formation".to_string()), "RTS FORMATION" }
                                button { onclick: move |_| apply_structured_command(project, selected_id, receipts, status, "Add systemic crate".to_string()), "SYSTEMIC CRATE" }
                            }
                            div { class: "pe-receipts",
                                for receipt in receipts().iter() { span { "{receipt}" } }
                            }
                        }
                    } else if module() == "Profiler" {
                        div { class: "pe-profiler",
                            article { span { "FRAME" } strong { "NOT MEASURED" } small { "Preview only" } }
                            article { span { "RICH ENTITIES" } strong { "{rich_count}" } small { "component graph" } }
                            article { span { "SIM ENTITIES" } strong { "{sim_count}" } small { "batch processed" } }
                            article { span { "DRAW CALLS" } strong { "{draw_calls}" } small { "software proof backend" } }
                            article { span { "STREAMING" } strong { "1 / 1" } small { "cell resident" } }
                            article { span { "MEMORY" } strong { "0.8 MB" } small { "editor world" } }
                        }
                    } else if module() == "Console" {
                        div { class: "pe-console",
                            code { "[Core] Phantom Engine kernel initialized" }
                            code { "[Render] IRenderBackend = Phantom.Software3D" }
                            code { "[World] Loaded {world_name} / {scene_name}" }
                            code { "[Systems] Transform → Lighting → Render → Selection" }
                            code { "[Runtime] {status}" }
                        }
                    } else {
                        div { class: "pe-assets",
                            for engine_module in enabled_modules.iter() {
                                article { span { "PKG" } strong { "{engine_module}" } small { "ENABLED" } }
                            }
                            article { span { "MAT" } strong { "Phantom Standard" } small { "PBR READY" } }
                            article { span { "PREFAB" } strong { "Systemic Crate" } small { "4 CAPABILITIES" } }
                            article { span { "SCENE" } strong { "{scene_name}" } small { "SAVED JSON" } }
                        }
                    }
                }
            }
        }
    }
}

const PHANTOM_ENGINE_STYLE: &str = r#"
    .pe-engine-shell {
        display: grid;
        grid-template-rows: 58px minmax(0, 1fr);
        min-width: 0;
        min-height: 0;
        height: 100%;
        overflow: hidden;
        color: #e9f4ef;
        background:
            radial-gradient(circle at 52% 2%, rgba(54, 240, 165, .10), transparent 31%),
            radial-gradient(circle at 87% 74%, rgba(75, 154, 255, .075), transparent 30%),
            #05090c;
        font-family: Inter, "Segoe UI", sans-serif;
    }
    :where(.pe-engine-shell) button, :where(.pe-engine-shell) textarea { font: inherit; }
    .pe-operator-topbar {
        display: grid;
        grid-template-columns: minmax(250px, 1fr) auto minmax(250px, 1fr);
        align-items: center;
        gap: 18px;
        padding: 0 16px;
        border-bottom: 1px solid #1e2d32;
        background: rgba(7, 12, 15, .96);
    }
    .pe-active-project { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .pe-active-project span { color: #68777d; font: 700 8px "Cascadia Code", monospace; letter-spacing: .12em; }
    .pe-active-project strong { max-width: 260px; overflow: hidden; color: #eff8f4; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .pe-active-project small { color: #54e8a5; font: 650 9px "Cascadia Code", monospace; }
    .pe-operator-actions { display: flex; justify-content: flex-end; gap: 7px; }
    .pe-settings-link, .pe-advanced-toggle {
        min-height: 32px; padding: 0 11px; border: 1px solid #2b3a40; border-radius: 6px;
        background: #0b1216; color: #9eacb2; cursor: pointer; font: 700 9px "Cascadia Code", monospace;
    }
    .pe-settings-link:hover, .pe-advanced-toggle:hover, .pe-advanced-toggle.is-active { border-color: rgba(82, 237, 169, .42); color: #61efac; }
    .pe-manual-host { min-height: 0; overflow: hidden; }
    .pe-operator-home {
        display: flex; flex-direction: column;
        min-height: 0; overflow: auto; padding: clamp(22px, 3.5vw, 54px);
        scrollbar-color: #294038 #080d10;
    }
    .pe-operator-hero { width: min(1060px, 100%); margin: 0 auto; }
    .pe-eyebrow { display: flex; align-items: center; gap: 8px; color: #6f8179; font: 700 9px "Cascadia Code", monospace; letter-spacing: .09em; }
    .pe-eyebrow i { color: #31423b; font-style: normal; }
    .pe-health-dot { width: 7px; height: 7px; border-radius: 50%; background: #55eba7; box-shadow: 0 0 13px rgba(85,235,167,.55); }
    .pe-health-dot.is-offline { background: #ff6d7d; box-shadow: 0 0 13px rgba(255,109,125,.45); }
    .pe-operator-hero h1 {
        max-width: 760px; margin: 18px 0 8px; color: #f5fbf8;
        font-family: "Segoe UI Variable Display", "Segoe UI", sans-serif; font-size: clamp(31px, 4vw, 56px); font-weight: 720; letter-spacing: -.045em; line-height: .98;
    }
    .pe-operator-hero > p { max-width: 780px; margin: 0; color: #8a9a9f; font-size: 13px; line-height: 1.65; }
    .pe-project-path { display: block; margin-top: 10px; overflow-wrap: anywhere; color: #819c90; font: 10px/1.5 "Cascadia Code", monospace; }
    .pe-mission-composer {
        margin-top: 24px; overflow: hidden; border: 1px solid #2b4038; border-radius: 12px;
        background: rgba(11, 19, 22, .94); box-shadow: 0 24px 70px rgba(0,0,0,.34), inset 0 1px rgba(255,255,255,.025);
    }
    .pe-mission-composer:focus-within { border-color: rgba(85,235,167,.62); box-shadow: 0 24px 70px rgba(0,0,0,.34), 0 0 0 3px rgba(85,235,167,.07); }
    .pe-mission-composer.is-running { border-color: rgba(86,199,255,.42); }
    .pe-mission-composer textarea {
        display: block; width: 100%; min-height: 126px; resize: vertical; padding: 19px 20px; border: 0; outline: 0;
        background: transparent; color: #e9f3ef; font: 500 14px/1.55 "Segoe UI", sans-serif; box-sizing: border-box;
    }
    .pe-mission-composer textarea::placeholder { color: #56656a; }
    .pe-composer-footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 11px; border-top: 1px solid #1c2a2f; background: rgba(4,9,12,.54); }
    .pe-auto-pipeline { display: flex; align-items: center; gap: 5px; min-width: 0; }
    .pe-auto-pipeline span { padding: 5px 7px; border: 1px solid #233139; border-radius: 4px; color: #66777d; font: 700 8px "Cascadia Code", monospace; letter-spacing: .08em; }
    .pe-auto-pipeline span + span::before { content: "→"; margin-right: 8px; color: #31423a; }
    .pe-run-agent {
        min-width: 118px; min-height: 38px; padding: 0 17px; border: 1px solid #67f0b2; border-radius: 7px;
        background: #59e7a7; color: #04110c; cursor: pointer; font: 850 10px "Cascadia Code", monospace; letter-spacing: .04em;
        box-shadow: 0 7px 22px rgba(54,221,151,.18);
    }
    .pe-run-agent:hover { background: #73f5bb; }
    .pe-run-agent:disabled { opacity: .42; cursor: not-allowed; box-shadow: none; }
    .pe-command-templates { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
    .pe-command-templates button { padding: 7px 10px; border: 1px solid #253239; border-radius: 5px; background: #0a1115; color: #84949a; cursor: pointer; font: 700 8px "Cascadia Code", monospace; }
    .pe-command-templates button:hover { border-color: #3d5850; color: #dcece5; }
    .pe-operator-grid { order: 3; width: min(1060px, 100%); margin: 24px auto 0; display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; }
    .pe-capability-card { min-width: 0; padding: 16px; border: 1px solid #1e2c31; border-radius: 9px; background: rgba(9,15,18,.72); }
    .pe-capability-card > span { color: #5be7a8; font: 750 8px "Cascadia Code", monospace; letter-spacing: .1em; }
    .pe-capability-card strong { display: block; margin-top: 8px; color: #dde9e4; font-size: 12px; }
    .pe-capability-card p { min-height: 54px; margin: 7px 0 13px; color: #718086; font-size: 10px; line-height: 1.55; }
    .pe-capability-tags { display: flex; flex-wrap: wrap; gap: 5px; }
    .pe-capability-tags span { padding: 4px 6px; border-radius: 3px; background: #101b20; color: #708187; font: 650 7px "Cascadia Code", monospace; }
    .pe-run-receipt { flex-shrink: 0; width: min(1060px, 100%); margin: 20px auto 0; border: 1px solid #1f2d32; border-radius: 9px; background: rgba(7,12,15,.78); overflow: hidden; }
    .pe-run-receipt details { margin-top: 14px; font-size: 12px; }
    .pe-run-receipt details summary { padding: 10px; cursor: pointer; color: #65e9ad; }
    .pe-run-receipt details article { margin-top: 8px; padding: 12px; background: #0a1319; border: 1px solid #22312e; overflow-wrap: anywhere; }
    .pe-run-receipt pre { max-height: 230px; overflow: auto; white-space: pre-wrap; color: #c3d4cf; font: 11px/1.5 "Cascadia Code", monospace; }
    .pe-receipt-heading { display: flex; justify-content: space-between; gap: 12px; padding: 13px 15px; border-bottom: 1px solid #1a272c; }
    .pe-receipt-heading > div { display: grid; gap: 4px; }
    .pe-receipt-heading span { color: #5d6c72; font: 700 8px "Cascadia Code", monospace; letter-spacing: .08em; }
    .pe-receipt-heading strong { color: #b9c9c2; font-size: 11px; }
    .pe-running-indicator { align-self: center; color: #55e9a8 !important; }
    .pe-empty-receipt, .pe-operator-error, .pe-receipt-success { padding: 15px; }
    .pe-empty-receipt strong, .pe-operator-error strong { color: #d8e5df; font-size: 11px; }
    .pe-empty-receipt p, .pe-operator-error p, .pe-receipt-success > p { margin: 6px 0 0; color: #77878c; font-size: 10px; line-height: 1.55; }
    .pe-operator-error { border-left: 3px solid #ff697a; background: rgba(255,73,98,.045); }
    .pe-operator-error strong { color: #ff9da8; }
    .pe-operator-error button { margin-top: 10px; padding: 6px 9px; border: 1px solid rgba(255,105,122,.35); border-radius: 4px; background: transparent; color: #ff9da8; cursor: pointer; font: 700 8px "Cascadia Code", monospace; }
    .pe-receipt-route, .pe-receipt-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
    .pe-receipt-route span { color: #56e6a7; font: 700 8px "Cascadia Code", monospace; }
    .pe-receipt-route strong { color: #c9d8d1; font: 650 9px "Cascadia Code", monospace; }
    .pe-receipt-route i { color: #3f514a; font-style: normal; }
    .pe-receipt-meta { margin-top: 12px; }
    .pe-receipt-meta span { color: #68787e; font: 650 7px "Cascadia Code", monospace; }
    .pe-changed-files { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 4px; margin-top: 10px; }
    .pe-changed-files code { overflow: hidden; padding: 5px 7px; border-radius: 4px; background: #0d1816; color: #76cda6; font: 600 8px "Cascadia Code", monospace; text-overflow: ellipsis; white-space: nowrap; }
    @media (max-width: 980px) {
        .pe-operator-topbar { grid-template-columns: 1fr auto; }
        .pe-active-project { display: none; }
        .pe-operator-grid { grid-template-columns: 1fr; }
        .pe-capability-card p { min-height: 0; }
    }
    @media (max-width: 700px) {
        .pe-operator-home { padding: 20px 14px; }
        .pe-operator-actions .pe-settings-link { display: none; }
        .pe-auto-pipeline { display: none; }
        .pe-run-agent { width: 100%; }
        .pe-changed-files { grid-template-columns: 1fr; }
    }
    .phantom-engine {
        display: grid;
        grid-template-rows: 56px 38px minmax(0, 1fr) 178px;
        min-width: 0;
        min-height: 0;
        height: 100%;
        overflow: hidden;
        color: #dce9e3;
        background:
            radial-gradient(circle at 50% 35%, rgba(47, 223, 154, .055), transparent 34%),
            #060b0e;
        font-family: Inter, "Segoe UI", sans-serif;
    }
    .phantom-engine button, .phantom-engine input { font: inherit; }
    .pe-commandbar {
        display: grid;
        grid-template-columns: minmax(300px, 1fr) auto auto;
        align-items: center;
        gap: 18px;
        padding: 0 14px;
        border-bottom: 1px solid #1b272d;
        background: rgba(8, 14, 17, .96);
    }
    .pe-engine-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .pe-engine-title > div { display: grid; gap: 2px; }
    .pe-engine-title strong { color: #f0f7f3; font: 750 13px "Cascadia Code", monospace; letter-spacing: .08em; }
    .pe-engine-title span { color: #718087; font-size: 10px; }
    .pe-engine-mark {
        display: grid; place-items: center; width: 31px; height: 31px; border: 1px solid rgba(79,241,168,.42);
        border-radius: 8px; color: #59efaa !important; background: rgba(44,181,122,.10);
        font: 800 15px Georgia, serif !important; box-shadow: inset 0 0 18px rgba(53,255,169,.08);
    }
    .pe-kernel-badge { margin-left: 5px; padding: 4px 7px; border: 1px solid #26383f; border-radius: 4px; font: 700 8px "Cascadia Code", monospace !important; }
    .pe-project-modes, .pe-run-controls, .pe-camera-controls, .pe-tool-segment { display: flex; gap: 4px; }
    .pe-commandbar button, .pe-camera-controls button, .pe-tool-segment button {
        min-height: 30px; padding: 0 10px; border: 1px solid #26343a; border-radius: 5px; color: #8d9ca3;
        background: #0c1418; cursor: pointer; font: 700 9px "Cascadia Code", monospace;
    }
    .pe-commandbar button:hover, .pe-camera-controls button:hover, .pe-tool-segment button:hover { color: #e5f3ed; border-color: #3c555d; }
    .pe-commandbar button.is-active, .pe-camera-controls button.is-active, .pe-tool-segment button.is-active { color: #64efad; border-color: rgba(82,239,172,.42); background: rgba(45,169,119,.12); }
    .pe-commandbar .pe-play { min-width: 76px; color: #06120d; border-color: #58eaa8; background: #55e5a4; }
    .pe-commandbar .pe-play.is-live { color: #ffdce2; border-color: rgba(255,100,124,.55); background: rgba(255,74,105,.14); }
    .pe-modulebar { display: flex; align-items: end; gap: 1px; padding: 0 10px; overflow-x: auto; border-bottom: 1px solid #1d2a2f; background: #091014; }
    .pe-modulebar button { height: 37px; padding: 0 10px; border: 0; border-bottom: 2px solid transparent; color: #69767d; background: transparent; cursor: pointer; font: 650 9px "Cascadia Code", monospace; white-space: nowrap; }
    .pe-modulebar button:hover { color: #b8c6c1; }
    .pe-modulebar button.is-active { color: #61eaaa; border-bottom-color: #55e5a4; background: rgba(64,220,153,.05); }
    .pe-workbench { display: grid; grid-template-columns: 224px minmax(380px, 1fr) 274px; min-width: 0; min-height: 0; }
    .pe-hierarchy, .pe-inspector { display: grid; grid-template-rows: auto minmax(0,1fr) auto; min-width: 0; min-height: 0; overflow: hidden; background: #080f13; }
    .pe-hierarchy { border-right: 1px solid #1a282e; }
    .pe-inspector { border-left: 1px solid #1a282e; }
    .pe-panel-heading { display: flex; align-items: center; justify-content: space-between; min-height: 48px; padding: 0 11px; border-bottom: 1px solid #1b282e; }
    .pe-panel-heading > div { display: grid; gap: 2px; min-width: 0; }
    .pe-panel-heading span { color: #607078; font: 700 8px "Cascadia Code", monospace; letter-spacing: .08em; }
    .pe-panel-heading strong { overflow: hidden; color: #dbe8e2; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .pe-panel-heading button { width: 26px; height: 26px; border: 1px solid #29383e; border-radius: 5px; color: #57e5a4; background: #0c171a; cursor: pointer; }
    .pe-world-tree, .pe-inspector-scroll { min-height: 0; overflow: auto; padding: 8px; }
    .pe-tree-root { display: block; width: 100%; padding: 6px 5px; border: 0; color: #a8b7b1; background: transparent; text-align: left; font: 700 9px "Cascadia Code", monospace; }
    .pe-tree-group { display: grid; gap: 2px; margin-top: 8px; }
    .pe-tree-group > span { padding: 4px 7px; color: #536168; font: 700 7px "Cascadia Code", monospace; letter-spacing: .08em; }
    .pe-entity { display: grid; grid-template-columns: 18px minmax(0,1fr); gap: 0 5px; width: 100%; padding: 6px 7px; border: 1px solid transparent; border-radius: 4px; color: #93a19b; background: transparent; text-align: left; cursor: pointer; }
    .pe-entity:hover { color: #d9e6e0; background: rgba(255,255,255,.025); }
    .pe-entity.is-selected { color: #ecfff6; border-color: rgba(85,229,164,.24); background: rgba(62,205,142,.10); }
    .pe-entity i { grid-row: span 2; color: #5fe8aa; font-style: normal; }
    .pe-entity span { overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
    .pe-entity small { overflow: hidden; color: #536168; font: 7px "Cascadia Code", monospace; text-overflow: ellipsis; white-space: nowrap; }
    .pe-create-row { display: grid; grid-template-columns: repeat(3,1fr); gap: 4px; padding: 8px; border-top: 1px solid #1b282e; }
    .pe-create-row button { min-width: 0; height: 27px; border: 1px solid #26373d; border-radius: 4px; color: #718188; background: #0b1418; cursor: pointer; font: 650 7px "Cascadia Code", monospace; }
    .pe-create-row button:hover { color: #5ce7a8; border-color: rgba(85,229,164,.35); }
    .pe-viewport-panel { display: grid; grid-template-rows: 42px minmax(0,1fr) 26px; min-width: 0; min-height: 0; background: #050a0d; }
    .pe-viewport-toolbar { display: grid; grid-template-columns: minmax(130px,1fr) auto auto; align-items: center; gap: 10px; padding: 0 10px; border-bottom: 1px solid #1a282e; background: #0a1115; }
    .pe-viewport-toolbar > div:first-child { display: grid; gap: 1px; }
    .pe-viewport-toolbar strong { color: #c8d5d0; font: 700 9px "Cascadia Code", monospace; }
    .pe-viewport-toolbar span { color: #58666c; font-size: 8px; }
    .pe-camera-controls button, .pe-tool-segment button { min-width: 27px; min-height: 25px; padding: 0 7px; font-size: 7px; }
    .pe-viewport { position: relative; min-width: 0; min-height: 0; overflow: hidden; }
    .pe-scene-svg { display: block; width: 100%; height: 100%; }
    .pe-face { cursor: pointer; transition: filter .12s ease, stroke-width .12s ease; }
    .pe-face:hover { filter: brightness(1.18); }
    .pe-face.is-selected { filter: brightness(1.08) drop-shadow(0 0 5px rgba(87,241,174,.32)); }
    .pe-canvas-object { cursor: pointer; filter: drop-shadow(0 8px 12px rgba(0,0,0,.34)); }
    .is-playing .pe-canvas-object { animation: pe-canvas-drift 2.6s ease-in-out infinite alternate; transform-box: fill-box; transform-origin: center; }
    .pe-viewport-overlay { position: absolute; z-index: 2; display: flex; gap: 7px; padding: 6px 8px; border: 1px solid rgba(94,116,125,.22); border-radius: 5px; color: #71838b; background: rgba(3,9,12,.72); backdrop-filter: blur(8px); font: 700 7px "Cascadia Code", monospace; }
    .pe-viewport-overlay.top-left { top: 10px; left: 10px; }
    .pe-viewport-overlay.top-right { top: 10px; right: 10px; }
    .pe-viewport-overlay strong { color: #5bebaa; }
    .pe-runtime-banner { position: absolute; top: 48px; left: 50%; display: flex; align-items: center; gap: 7px; padding: 7px 11px; border: 1px solid rgba(82,235,169,.35); border-radius: 999px; color: #74f4b8; background: rgba(4,18,13,.78); transform: translateX(-50%); font: 700 8px "Cascadia Code", monospace; }
    .pe-fps-crosshair { position: absolute; top: 50%; left: 50%; width: 22px; height: 22px; transform: translate(-50%,-50%); pointer-events: none; }
    .pe-fps-crosshair span { position: absolute; top: 50%; left: 50%; background: rgba(229,255,246,.92); box-shadow: 0 0 5px rgba(82,235,169,.45); transform: translate(-50%,-50%); }
    .pe-fps-crosshair span:first-child { width: 22px; height: 1px; }
    .pe-fps-crosshair span:last-child { width: 1px; height: 22px; }
    .pe-fps-hud { position: absolute; right: 13px; bottom: 13px; display: flex; gap: 5px; pointer-events: none; }
    .pe-fps-hud > div { display: grid; grid-template-columns: auto auto; gap: 1px 7px; min-width: 88px; padding: 7px 9px; border: 1px solid rgba(101,213,255,.24); border-radius: 5px; color: #84d7ff; background: rgba(3,10,14,.78); backdrop-filter: blur(7px); }
    .pe-fps-hud span { grid-column: 1 / -1; font: 700 6px "Cascadia Code", monospace; letter-spacing: .1em; }
    .pe-fps-hud strong { color: #effff8; font: 800 15px "Cascadia Code", monospace; }
    .pe-fps-hud small { align-self: end; color: #6d7d83; font: 7px "Cascadia Code", monospace; }
    .pe-live-dot { width: 6px; height: 6px; border-radius: 50%; background: #5cf0ad; box-shadow: 0 0 9px #5cf0ad; animation: pe-live 1s ease-in-out infinite alternate; }
    .pe-statusbar { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 0 9px; border-top: 1px solid #1a282e; color: #526067; background: #080f12; font: 7px "Cascadia Code", monospace; white-space: nowrap; }
    .pe-statusbar strong { flex: 1; overflow: hidden; color: #92a19b; text-overflow: ellipsis; }
    .pe-status-ready { color: #56e7a6; }
    .pe-lock { color: #5f6e74 !important; }
    .pe-inspector-scroll { display: grid; align-content: start; gap: 8px; }
    .pe-inspector-card { border: 1px solid #1e2d33; border-radius: 6px; background: #0a1317; overflow: hidden; }
    .pe-inspector-card header { display: flex; justify-content: space-between; padding: 8px 9px; border-bottom: 1px solid #1c2b31; }
    .pe-inspector-card header span { color: #b9c9c2; font: 700 8px "Cascadia Code", monospace; }
    .pe-inspector-card header small { color: #526168; font: 7px "Cascadia Code", monospace; }
    .pe-vector-row { display: grid; grid-template-columns: 1fr repeat(3, 48px); gap: 4px; align-items: center; padding: 5px 7px; }
    .pe-vector-row > span { color: #5d6c72; font: 7px "Cascadia Code", monospace; }
    .pe-vector-row label { display: grid; grid-template-columns: 13px 1fr; align-items: center; border: 1px solid #25343a; border-radius: 3px; overflow: hidden; }
    .pe-vector-row i { color: #64757c; font: 700 7px "Cascadia Code", monospace; text-align: center; }
    .pe-vector-row input { width: 100%; min-width: 0; padding: 3px; border: 0; outline: 0; color: #cbd9d3; background: #0e181c; font: 8px "Cascadia Code", monospace; }
    .pe-gizmo-nudges { display: grid; grid-template-columns: repeat(6,1fr); gap: 3px; padding: 7px; border-top: 1px solid #1c2b31; }
    .pe-gizmo-nudges button, .pe-add-capability { height: 23px; border: 1px solid #27383e; border-radius: 3px; color: #718188; background: #0c161a; cursor: pointer; font: 7px "Cascadia Code", monospace; }
    .pe-material-field, .pe-color-field { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 5px; padding: 7px 9px; }
    .pe-material-field span, .pe-color-field span { color: #5c6a71; font: 7px "Cascadia Code", monospace; }
    .pe-material-field strong { color: #aebdb7; font-size: 9px; }
    .pe-color-field input { width: 29px; height: 20px; padding: 0; border: 1px solid #34484f; background: transparent; }
    .pe-color-field code { color: #82928b; font-size: 8px; }
    .pe-material-metrics { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid #1c2b31; }
    .pe-material-metrics span { display: grid; gap: 3px; padding: 8px; color: #5c6a71; font: 7px "Cascadia Code", monospace; }
    .pe-material-metrics span + span { border-left: 1px solid #1c2b31; }
    .pe-material-metrics strong { color: #bdcbc5; font-size: 9px; }
    .pe-capability-list { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; }
    .pe-component-list { display: grid; gap: 1px; padding: 5px; }
    .pe-component-list div { display: grid; grid-template-columns: minmax(0,1fr) auto auto; gap: 6px; align-items: center; padding: 5px; border-radius: 3px; background: rgba(255,255,255,.018); }
    .pe-component-list span { color: #aebdb7; font: 8px "Cascadia Code", monospace; }
    .pe-component-list small { color: #526168; font: 6px "Cascadia Code", monospace; }
    .pe-component-list i { color: #59dfa4; font: 700 6px "Cascadia Code", monospace; font-style: normal; }
    .pe-capability-list span { padding: 4px 6px; border: 1px solid rgba(83,230,167,.24); border-radius: 999px; color: #68dfa7; background: rgba(55,190,132,.08); font: 7px "Cascadia Code", monospace; }
    .pe-state-list { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 8px 8px; }
    .pe-state-list span { padding: 4px 6px; border: 1px solid rgba(255,176,80,.28); border-radius: 999px; color: #ffc06e; background: rgba(218,121,44,.09); font: 7px "Cascadia Code", monospace; }
    .pe-empty-note { margin: 0; padding: 9px; color: #5b696f; font-size: 9px; }
    .pe-add-capability { margin: 0 8px 8px; padding: 0 8px; }
    .pe-empty-inspector { padding: 20px 12px; color: #5c6a71; font-size: 10px; text-align: center; }
    .pe-bottom-dock { display: grid; grid-template-rows: 30px minmax(0,1fr); min-width: 0; min-height: 0; border-top: 1px solid #1b292f; background: #080f13; }
    .pe-bottom-tabs { display: flex; gap: 1px; padding: 0 9px; border-bottom: 1px solid #1b292f; }
    .pe-bottom-tabs button { padding: 0 11px; border: 0; border-bottom: 2px solid transparent; color: #59676d; background: transparent; cursor: pointer; font: 700 8px "Cascadia Code", monospace; }
    .pe-bottom-tabs button.is-active { color: #61eaaa; border-bottom-color: #55e5a4; }
    .pe-bottom-content { min-width: 0; min-height: 0; overflow: auto; }
    .pe-assets, .pe-profiler { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px,1fr)); gap: 7px; padding: 9px; }
    .pe-assets article, .pe-profiler article { display: grid; grid-template-columns: auto 1fr; gap: 2px 7px; min-width: 0; padding: 8px; border: 1px solid #1f2e34; border-radius: 5px; background: #0b1418; }
    .pe-assets article > span, .pe-profiler article > span { grid-row: span 2; display: grid; place-items: center; min-width: 26px; color: #5ae7a7; font: 750 8px "Cascadia Code", monospace; }
    .pe-assets strong, .pe-profiler strong { overflow: hidden; color: #bdcbc5; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
    .pe-assets small, .pe-profiler small { color: #55636a; font: 7px "Cascadia Code", monospace; }
    .pe-ai-console { display: grid; grid-template-columns: minmax(230px, .8fr) minmax(260px, 1.3fr) auto minmax(250px, 1fr); gap: 9px; align-items: center; height: 100%; padding: 9px; }
    .pe-ai-heading { display: grid; gap: 3px; }
    .pe-ai-heading span { color: #8d72ff; font: 700 8px "Cascadia Code", monospace; }
    .pe-ai-heading strong { color: #c9d6d1; font-size: 10px; }
    .pe-ai-composer { display: grid; grid-template-columns: 1fr auto; border: 1px solid rgba(142,111,255,.35); border-radius: 6px; overflow: hidden; background: #0a1218; }
    .pe-ai-composer input { min-width: 0; padding: 9px; border: 0; outline: 0; color: #dce6e2; background: transparent; font-size: 9px; }
    .pe-ai-composer button { padding: 0 12px; border: 0; color: #eeeaff; background: #7259cf; cursor: pointer; font: 700 8px "Cascadia Code", monospace; }
    .pe-quick-actions { display: grid; gap: 3px; }
    .pe-quick-actions button { padding: 5px 7px; border: 1px solid #2a343d; border-radius: 3px; color: #7e8e95; background: #0c1519; cursor: pointer; font: 7px "Cascadia Code", monospace; }
    .pe-receipts { display: grid; gap: 2px; max-height: 106px; overflow: auto; }
    .pe-receipts span { color: #6f857c; font: 7px/1.45 "Cascadia Code", monospace; }
    .pe-console { display: grid; gap: 3px; padding: 9px 12px; }
    .pe-console code { color: #71857c; font: 8px/1.35 "Cascadia Code", monospace; }
    @keyframes pe-live { from { opacity: .45; } to { opacity: 1; } }
    @keyframes pe-canvas-drift { from { transform: translateY(-2px) rotate(-2deg); } to { transform: translateY(4px) rotate(2deg); } }
    @media (max-width: 1200px) {
        .pe-workbench { grid-template-columns: 190px minmax(320px, 1fr) 230px; }
        .pe-camera-controls button:nth-child(-n+4), .pe-tool-segment { display: none; }
        .pe-ai-console { grid-template-columns: minmax(200px,1fr) minmax(260px,1.5fr); }
        .pe-quick-actions, .pe-receipts { display: none; }
    }
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn three_d_project_round_trips_through_schema() {
        let project = default_3d_project();
        let json = serde_json::to_string(&project).expect("project should serialize");
        let restored: PhantomProject = serde_json::from_str(&json).expect("project should load");
        assert_eq!(restored.schema_version, ENGINE_SCHEMA_VERSION);
        assert_eq!(restored.mode, ProjectMode::World3D);
        assert!(restored.active_scene().rich_entities.len() >= 6);
        assert!(
            restored
                .enabled_modules
                .iter()
                .any(|module| module == "Phantom.Render3D")
        );
    }

    #[test]
    fn perspective_projection_places_the_target_inside_the_view() {
        let projected = project_point(Vec3::new(0.0, 0.7, 0.0), EditorCamera::default())
            .expect("camera target should be visible");
        assert!((projected.0 - VIEW_WIDTH * 0.5).abs() < 0.1);
        assert!((projected.1 - VIEW_HEIGHT * 0.5).abs() < 0.1);
        assert!(projected.2 > 0.0);
    }

    #[test]
    fn hybrid_scene_keeps_rich_and_lightweight_entities_separate() {
        let project = default_3d_project();
        let scene = project.active_scene();
        assert!(
            scene
                .rich_entities
                .iter()
                .any(|entity| entity.kind == EntityKind::Cube)
        );
        assert_eq!(scene.simulation_entities.len(), 36);
    }

    #[test]
    fn flagship_slice_contains_the_required_3d_editor_entities() {
        let project = default_3d_project();
        let scene = project.active_scene();
        for kind in [
            EntityKind::Cube,
            EntityKind::Ground,
            EntityKind::DirectionalLight,
            EntityKind::Camera,
        ] {
            assert!(scene.rich_entities.iter().any(|entity| entity.kind == kind));
        }
        assert!(scene.rich_entities.iter().any(|entity| {
            entity.kind == EntityKind::SystemicCrate
                && entity.capabilities.iter().any(|item| item == "Flammable")
        }));
        assert!(scene.rich_entities.iter().all(|entity| {
            entity
                .components
                .iter()
                .any(|component| component.kind == ComponentKind::Transform3D)
        }));
    }

    #[test]
    fn canvas_remains_a_first_class_project_mode() {
        let project = default_canvas_project();
        assert_eq!(project.mode, ProjectMode::Canvas2D);
        assert!(
            project
                .enabled_modules
                .iter()
                .any(|module| module == "Phantom.Canvas")
        );
        let render = build_scene_render(&project, EditorCamera::default(), 101);
        assert!(render.points.len() >= project.active_scene().rich_entities.len());
    }

    #[test]
    fn rts_stress_project_runs_thousands_of_lightweight_entities() {
        let mut project = default_rts_project();
        assert_eq!(project.template, ProjectTemplate::RtsStress);
        assert_eq!(project.active_scene().simulation_entities.len(), 2048);
        assert!(
            project
                .enabled_modules
                .iter()
                .any(|module| module == "Phantom.Navigation.FlowField")
        );
        let selected = select_rts_team(&mut project, 1);
        assert_eq!(selected, 1024);
        let commanded = command_selected_rts_units(&mut project, Vec3::new(0.0, 0.08, 0.0));
        assert_eq!(commanded, 1024);
        let before = project.active_scene().simulation_entities[0].position;
        let tick = tick_rts_simulation(&mut project, 0.1);
        let after = project.active_scene().simulation_entities[0].position;
        assert_eq!(tick.active, 2048);
        assert!(tick.moved > 0);
        assert_ne!(before, after);
    }

    #[test]
    fn fps_validation_project_moves_fires_and_damages_real_targets() {
        let mut project = default_fps_project();
        let mut camera = EditorCamera::for_template(ProjectTemplate::FpsPrototype);
        let start = camera.position;
        move_fps_camera(&mut camera, 0.5, 0.0);
        assert_ne!(start, camera.position);
        for _ in 0..3 {
            let result = fire_fps_weapon(
                &mut project,
                EditorCamera::for_template(ProjectTemplate::FpsPrototype),
            );
            assert!(result.contains("Confirmed hit"));
        }
        assert_eq!(project.runtime.ammo, 27);
        assert_eq!(project.runtime.confirmed_hits, 3);
        assert!(project.active_scene().rich_entities.iter().any(|entity| {
            entity.capabilities.iter().any(|item| item == "Damageable") && !entity.visible
        }));
        let loaded = reload_fps_weapon(&mut project);
        assert_eq!(loaded, 3);
        assert_eq!(project.runtime.ammo, 30);
    }

    #[test]
    fn systemic_rules_compose_capabilities_instead_of_object_pairs() {
        let mut project = default_systemic_project();
        let relay_id = project
            .active_scene()
            .rich_entities
            .iter()
            .find(|entity| entity.name == "Copper Relay")
            .map(|entity| entity.id)
            .expect("relay entity");
        let water = apply_stimulus_to_selected(&mut project, relay_id, Stimulus::Water);
        assert!(water.contains("Wettable → Wet"));
        let electric = apply_stimulus_to_selected(&mut project, relay_id, Stimulus::Electricity);
        assert!(electric.contains("Conductive + Wet"));
        let relay = project
            .active_scene()
            .rich_entities
            .iter()
            .find(|entity| entity.id == relay_id)
            .expect("relay remains available");
        assert!(relay.states.iter().any(|state| state == "Wet"));
        assert!(relay.states.iter().any(|state| state == "Electrified"));
        assert_eq!(relay.health, 65.0);
    }
}

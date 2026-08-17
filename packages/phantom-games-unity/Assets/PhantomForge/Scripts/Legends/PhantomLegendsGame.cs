using System.Collections.Generic;
using PhantomForge.Core;
using UnityEngine;
using UnityEngine.UI;

namespace PhantomForge.Legends
{
    public enum AgesTeam
    {
        Legion,
        Dominion,
        Neutral
    }

    public enum AgesKind
    {
        Worker,
        Vanguard,
        Ranger,
        Cavalry,
        Siege,
        Core,
        Outpost
    }

    public enum AgesResourceKind
    {
        Aether,
        Alloy,
        Authority
    }

    public sealed class PhantomLegendsGame : MonoBehaviour
    {
        public const string GameId = "phantom-legends";
        public const string SaveNamespace = "phantomlegends.";

        public static PhantomLegendsGame Instance { get; private set; }

        private readonly List<AgesEntity> _entities = new List<AgesEntity>();
        private readonly List<AgesEntity> _selection = new List<AgesEntity>();
        private readonly List<AgesResourceNode> _resourceNodes = new List<AgesResourceNode>();

        private Canvas _menuCanvas;
        private Canvas _hudCanvas;
        private Camera _camera;
        private AgesCameraRig _cameraRig;
        private Text _resourceText;
        private Text _ageText;
        private Text _selectionText;
        private Text _phaseText;
        private Text _objectiveText;
        private Button _advanceButton;
        private Image _selectionBox;
        private Vector2 _dragStart;
        private bool _dragging;
        private bool _running;
        private bool _ended;
        private int _age;
        private float _aether = 540f;
        private float _alloy = 380f;
        private float _authority = 160f;
        private float _enemyAether = 520f;
        private float _enemyAlloy = 360f;
        private float _enemyAuthority = 160f;
        private float _enemyThink = 4f;
        private float _riftClock = 70f;
        private int _riftPhase;

        private readonly string[] _ages = { "ORIGIN AGE", "BASTION AGE", "RIFT AGE", "ASCENDANT AGE" };
        private readonly Color _cyan = new Color(0.10f, 0.78f, 0.95f, 1f);
        private readonly Color _red = new Color(0.94f, 0.18f, 0.24f, 1f);
        private readonly Color _gold = new Color(1f, 0.72f, 0.24f, 1f);

        public IReadOnlyList<AgesEntity> Entities => _entities;
        public int Age => _age;
        public bool Running => _running && !_ended;

        private void Awake()
        {
            Instance = this;
        }

        private void Start()
        {
            PhantomVisuals.ConfigureWorld(
                new Color(0.34f, 0.38f, 0.31f),
                new Color(0.37f, 0.43f, 0.44f),
                0.0032f,
                new Color(1f, 0.84f, 0.62f),
                1.18f,
                new Vector3(48f, -38f, 12f));
            CreateTitleScreen();
            if (PhantomSmokeCapture.Enabled)
            {
                StartCoroutine(PhantomSmokeCapture.Run("Enter", "phantom-legends"));
            }
        }

        private void Update()
        {
            if (!Running) return;
            HandleSelectionInput();
            UpdateEconomy();
            UpdateEnemyCommander();
            UpdateRiftShift();
            UpdateHud();
        }

        private void CreateTitleScreen()
        {
            _menuCanvas = PhantomUi.Canvas("Phantom Legends Title", 100);
            var background = new GameObject("Key Art", typeof(RectTransform), typeof(Image));
            background.transform.SetParent(_menuCanvas.transform, false);
            var image = background.GetComponent<Image>();
            image.sprite = PhantomVisuals.ResourceSprite("Art/phantom-legends-keyart");
            image.color = image.sprite == null ? new Color(0.08f, 0.11f, 0.12f) : Color.white;
            image.preserveAspect = false;
            PhantomUi.Stretch(background.GetComponent<RectTransform>());

            var shade = PhantomUi.Panel("Shade", _menuCanvas.transform, new Color(0.01f, 0.018f, 0.022f, 0.46f), Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, 0);
            var title = PhantomUi.Text("Title", shade, "PHANTOM LEGENDS", 64, Color.white, TextAnchor.MiddleCenter, FontStyle.Bold);
            PhantomUi.Place(title.rectTransform, new Vector2(0.24f, 0.72f), new Vector2(0.76f, 0.86f), Vector2.zero, Vector2.zero);
            var subtitle = PhantomUi.Text("Subtitle", shade, "RIFTBOUND DOMINION", 20, _cyan, TextAnchor.MiddleCenter, FontStyle.Bold);
            PhantomUi.Place(subtitle.rectTransform, new Vector2(0.3f, 0.66f), new Vector2(0.7f, 0.72f), Vector2.zero, Vector2.zero);
            var enter = PhantomUi.Button("Enter", shade, "BEGIN CAMPAIGN", new Color(0.05f, 0.58f, 0.72f, 0.98f), Color.white, StartCampaign);
            PhantomUi.Place(enter.GetComponent<RectTransform>(), new Vector2(0.39f, 0.09f), new Vector2(0.61f, 0.16f), Vector2.zero, Vector2.zero);
        }

        private void StartCampaign()
        {
            if (_menuCanvas != null) Destroy(_menuCanvas.gameObject);
            BuildRiftboundValley();
            CreateCamera();
            CreateHud();
            SpawnStartingForces();
            _running = true;
            UpdateHud();
        }

        private void BuildRiftboundValley()
        {
            Random.InitState(27031);
            var grass = PhantomVisuals.Material("Ages meadow", new Color(0.23f, 0.37f, 0.19f), 0f, 0.18f);
            var earth = PhantomVisuals.Material("Ages earth", new Color(0.26f, 0.19f, 0.12f), 0f, 0.12f);
            var stone = PhantomVisuals.Material("Ages stone", new Color(0.31f, 0.32f, 0.30f), 0.04f, 0.22f);
            var water = PhantomVisuals.Material("Ages rift water", new Color(0.035f, 0.24f, 0.31f), 0.2f, 0.88f, new Color(0.01f, 0.16f, 0.24f));
            var crystal = PhantomVisuals.Material("Ages rift crystal", new Color(0.08f, 0.44f, 0.70f), 0.35f, 0.72f, new Color(0.02f, 0.38f, 0.72f));
            var dark = PhantomVisuals.Material("Ages dominion ground", new Color(0.16f, 0.12f, 0.12f), 0.02f, 0.16f);

            PhantomVisuals.Primitive("Riftbound Valley", PrimitiveType.Cube, new Vector3(0f, -0.55f, 0f), new Vector3(180f, 1f, 118f), grass);
            PhantomVisuals.DecorativePrimitive("Dominion Scar", PrimitiveType.Cube, new Vector3(57f, -0.02f, 0f), new Vector3(64f, 0.08f, 112f), dark);
            PhantomVisuals.DecorativePrimitive("Legion Road", PrimitiveType.Cube, new Vector3(-48f, -0.01f, 0f), new Vector3(52f, 0.05f, 9f), earth);
            PhantomVisuals.DecorativePrimitive("Dominion Road", PrimitiveType.Cube, new Vector3(48f, 0f, 0f), new Vector3(52f, 0.05f, 9f), earth);
            PhantomVisuals.DecorativePrimitive("Rift River", PrimitiveType.Cube, new Vector3(0f, -0.16f, 0f), new Vector3(13f, 0.22f, 118f), water);
            PhantomVisuals.Primitive("North Bridge", PrimitiveType.Cube, new Vector3(0f, 0.12f, 26f), new Vector3(18f, 0.5f, 7f), stone);
            PhantomVisuals.Primitive("South Bridge", PrimitiveType.Cube, new Vector3(0f, 0.12f, -27f), new Vector3(18f, 0.5f, 7f), stone);

            for (var index = 0; index < 14; index++)
            {
                var z = -52f + index * 8f;
                var side = index % 2 == 0 ? -1f : 1f;
                var shard = PhantomVisuals.DecorativePrimitive("Rift shard " + index, PrimitiveType.Cube, new Vector3(side * Random.Range(4f, 7f), 1.5f, z), new Vector3(1.2f, Random.Range(2f, 5f), 1.2f), crystal);
                shard.transform.rotation = Quaternion.Euler(Random.Range(-8f, 8f), Random.Range(0f, 45f), Random.Range(-12f, 12f));
            }

            for (var index = 0; index < 22; index++)
            {
                var left = index < 11;
                var x = left ? Random.Range(-82f, -18f) : Random.Range(18f, 82f);
                var z = Random.Range(-53f, 53f);
                var trees = PhantomVisuals.GroundedResourceModel(
                    "Models/Quaternius/FantasyRTS/" + (index % 3 == 0 ? "PineTrees" : "Trees"),
                    "Ancient grove " + index,
                    new Vector3(x, 0f, z),
                    Quaternion.Euler(0f, Random.Range(0f, 360f), 0f),
                    Random.Range(5.5f, 8f));
                if (trees == null)
                {
                    var trunk = PhantomVisuals.DecorativePrimitive("Tree trunk " + index, PrimitiveType.Cylinder, new Vector3(x, 1.2f, z), new Vector3(0.38f, 1.2f, 0.38f), earth);
                    PhantomVisuals.DecorativePrimitive("Tree crown " + index, PrimitiveType.Sphere, trunk.transform.position + Vector3.up * 2.2f, new Vector3(2.2f, 2.7f, 2.2f), grass);
                }
            }

            for (var index = 0; index < 12; index++)
            {
                var side = index % 2 == 0 ? -1f : 1f;
                PhantomVisuals.GroundedResourceModel(
                    "Models/Quaternius/FantasyRTS/Rocks",
                    "Valley rocks " + index,
                    new Vector3(side * Random.Range(16f, 48f), 0f, Random.Range(-49f, 49f)),
                    Quaternion.Euler(0f, Random.Range(0f, 360f), 0f),
                    Random.Range(2.5f, 4.8f));
            }

            CreateResourceNode(AgesResourceKind.Aether, new Vector3(-45f, 0f, 28f), _cyan);
            CreateResourceNode(AgesResourceKind.Aether, new Vector3(40f, 0f, -31f), _cyan);
            CreateResourceNode(AgesResourceKind.Alloy, new Vector3(-34f, 0f, -28f), _gold);
            CreateResourceNode(AgesResourceKind.Alloy, new Vector3(45f, 0f, 28f), _gold);
            CreateResourceNode(AgesResourceKind.Authority, new Vector3(0f, 0f, 0f), new Color(0.72f, 0.3f, 1f));
            CreateFactionSettlement(AgesTeam.Legion, -1f);
            CreateFactionSettlement(AgesTeam.Dominion, 1f);
        }

        private static void CreateFactionSettlement(AgesTeam team, float side)
        {
            var suffix = team == AgesTeam.Legion ? "Legion" : "Dominion";
            var yaw = side < 0f ? 90f : -90f;
            var pieces = new[]
            {
                new { Model = "Barracks_" + suffix, Position = new Vector3(side * 64f, 0f, 24f), Size = 11f },
                new { Model = "Farm_" + suffix, Position = new Vector3(side * 62f, 0f, -24f), Size = 10f },
                new { Model = "Wonder_" + suffix, Position = new Vector3(side * 79f, 0f, side * -30f), Size = 15f }
            };
            for (var index = 0; index < pieces.Length; index++)
            {
                PhantomVisuals.GroundedResourceModel(
                    "Models/Quaternius/FantasyRTS/" + pieces[index].Model,
                    team + " " + pieces[index].Model,
                    pieces[index].Position,
                    Quaternion.Euler(0f, yaw, 0f),
                    pieces[index].Size);
            }

            for (var index = -2; index <= 2; index++)
            {
                PhantomVisuals.GroundedResourceModel(
                    "Models/Quaternius/FantasyRTS/Wall_" + suffix,
                    team + " wall " + index,
                    new Vector3(side * 49f, 0f, index * 8f),
                    Quaternion.Euler(0f, yaw, 0f),
                    8f);
            }
        }

        private void CreateResourceNode(AgesResourceKind kind, Vector3 position, Color color)
        {
            var material = PhantomVisuals.Material("Resource " + kind, color * 0.72f, 0.42f, 0.64f, color * 0.55f);
            var root = new GameObject(kind + " Deposit");
            root.transform.position = position;
            var node = root.AddComponent<AgesResourceNode>();
            node.Kind = kind;
            node.Amount = kind == AgesResourceKind.Authority ? 99999f : 4800f;
            var collider = root.AddComponent<SphereCollider>();
            collider.radius = 3.2f;
            collider.center = new Vector3(0f, 1.4f, 0f);
            _resourceNodes.Add(node);
            if (kind == AgesResourceKind.Alloy)
            {
                PhantomVisuals.GroundedResourceModel(
                    "Models/Quaternius/FantasyRTS/" + (position.x < 0f ? "Mine" : "Gold"),
                    kind + " landmark",
                    position,
                    Quaternion.Euler(0f, position.x < 0f ? 20f : -20f, 0f),
                    6f,
                    root.transform);
            }
            for (var index = 0; index < 7; index++)
            {
                var crystal = PhantomVisuals.DecorativePrimitive(kind + " crystal", PrimitiveType.Cube, Vector3.zero, new Vector3(0.65f, Random.Range(1.2f, 2.8f), 0.65f), material, root.transform);
                crystal.transform.localPosition = new Vector3(Random.Range(-2.4f, 2.4f), crystal.transform.localScale.y * 0.48f, Random.Range(-2.4f, 2.4f));
                crystal.transform.localRotation = Quaternion.Euler(Random.Range(-12f, 12f), Random.Range(0f, 90f), Random.Range(-12f, 12f));
            }
            PhantomVisuals.PointLight(kind + " glow", position + Vector3.up * 1.7f, color, 2.5f, 10f, root.transform);
        }

        private void CreateCamera()
        {
            var cameraObject = new GameObject("Strategy Camera");
            _camera = cameraObject.AddComponent<Camera>();
            _camera.allowHDR = true;
            _camera.allowMSAA = true;
            _camera.nearClipPlane = 0.3f;
            _camera.farClipPlane = 320f;
            _camera.fieldOfView = 46f;
            _cameraRig = cameraObject.AddComponent<AgesCameraRig>();
            _cameraRig.Configure(Vector3.zero);
            cameraObject.AddComponent<AudioListener>();
        }

        private void SpawnStartingForces()
        {
            SpawnStructure(AgesTeam.Legion, AgesKind.Core, new Vector3(-70f, 0f, 0f));
            SpawnStructure(AgesTeam.Dominion, AgesKind.Core, new Vector3(70f, 0f, 0f));
            SpawnStructure(AgesTeam.Legion, AgesKind.Outpost, new Vector3(-53f, 0f, 17f));
            SpawnStructure(AgesTeam.Dominion, AgesKind.Outpost, new Vector3(53f, 0f, -17f));

            for (var index = 0; index < 5; index++)
            {
                SpawnUnit(AgesTeam.Legion, AgesKind.Worker, new Vector3(-62f + index * 2.2f, 0f, -10f));
                SpawnUnit(AgesTeam.Dominion, AgesKind.Worker, new Vector3(62f - index * 2.2f, 0f, 10f));
            }
            for (var index = 0; index < 5; index++)
            {
                SpawnUnit(AgesTeam.Legion, AgesKind.Vanguard, new Vector3(-56f, 0f, -4f + index * 4f));
                SpawnUnit(AgesTeam.Dominion, AgesKind.Vanguard, new Vector3(56f, 0f, 4f - index * 4f));
            }
            SpawnUnit(AgesTeam.Legion, AgesKind.Ranger, new Vector3(-58f, 0f, 18f));
            SpawnUnit(AgesTeam.Dominion, AgesKind.Ranger, new Vector3(58f, 0f, -18f));
        }

        private AgesEntity SpawnStructure(AgesTeam team, AgesKind kind, Vector3 position)
        {
            var root = new GameObject(team + " " + kind);
            root.transform.position = position;
            var entity = root.AddComponent<AgesEntity>();
            entity.Configure(team, kind, kind == AgesKind.Core ? 2400f : 750f);
            _entities.Add(entity);
            CreateStructureVisual(entity);
            return entity;
        }

        public AgesEntity SpawnUnit(AgesTeam team, AgesKind kind, Vector3 position)
        {
            var root = new GameObject(team + " " + kind);
            root.transform.position = position;
            var collider = root.AddComponent<CapsuleCollider>();
            collider.height = kind == AgesKind.Cavalry ? 2.2f : 1.7f;
            collider.radius = kind == AgesKind.Siege ? 0.9f : 0.45f;
            collider.center = new Vector3(0f, collider.height * 0.5f, 0f);
            var entity = root.AddComponent<AgesEntity>();
            entity.Configure(team, kind, HealthFor(kind));
            _entities.Add(entity);
            CreateUnitVisual(entity);
            return entity;
        }

        private static float HealthFor(AgesKind kind)
        {
            switch (kind)
            {
                case AgesKind.Worker: return 80f;
                case AgesKind.Ranger: return 95f;
                case AgesKind.Cavalry: return 240f;
                case AgesKind.Siege: return 360f;
                default: return 155f;
            }
        }

        private void CreateStructureVisual(AgesEntity entity)
        {
            var legion = entity.Team == AgesTeam.Legion;
            var accentColor = legion ? _cyan : _red;
            var stone = PhantomVisuals.Material("Ages structure stone " + entity.Team, legion ? new Color(0.38f, 0.43f, 0.42f) : new Color(0.19f, 0.16f, 0.17f), 0.1f, 0.28f);
            var accent = PhantomVisuals.Material("Ages structure accent " + entity.Team, accentColor * 0.62f, 0.5f, 0.66f, accentColor * 0.44f);
            var scale = entity.Kind == AgesKind.Core ? new Vector3(11f, 7f, 11f) : new Vector3(6f, 4f, 6f);
            PhantomVisuals.Primitive("Foundation", PrimitiveType.Cylinder, entity.transform.position + Vector3.up * 0.55f, new Vector3(scale.x * 0.65f, 0.55f, scale.z * 0.65f), stone, entity.transform);
            var modelName = (entity.Kind == AgesKind.Core ? "TownCenter_" : "WatchTower_") + (legion ? "Legion" : "Dominion");
            var structure = PhantomVisuals.GroundedResourceModel(
                "Models/Quaternius/FantasyRTS/" + modelName,
                entity.Team + " " + modelName,
                entity.transform.position,
                Quaternion.Euler(0f, legion ? 90f : -90f, 0f),
                entity.Kind == AgesKind.Core ? 15f : 8f,
                entity.transform);
            if (structure == null)
            {
                PhantomVisuals.DecorativePrimitive("Keep", PrimitiveType.Cube, entity.transform.position + Vector3.up * scale.y * 0.45f, scale, stone, entity.transform);
                var towerCount = entity.Kind == AgesKind.Core ? 4 : 2;
                for (var index = 0; index < towerCount; index++)
                {
                    var angle = index * Mathf.PI * 2f / towerCount;
                    var offset = new Vector3(Mathf.Cos(angle), 0f, Mathf.Sin(angle)) * scale.x * 0.45f;
                    PhantomVisuals.DecorativePrimitive("Tower", PrimitiveType.Cylinder, entity.transform.position + offset + Vector3.up * scale.y * 0.72f, new Vector3(1.2f, scale.y * 0.7f, 1.2f), stone, entity.transform);
                }
            }
            PhantomVisuals.DecorativePrimitive("Core crystal", PrimitiveType.Cube, entity.transform.position + Vector3.up * (scale.y + 1.3f), new Vector3(1.2f, 2.6f, 1.2f), accent, entity.transform).transform.rotation = Quaternion.Euler(0f, 45f, 45f);
            PhantomVisuals.PointLight(entity.Team + " core light", entity.transform.position + Vector3.up * (scale.y + 1f), accentColor, 3f, 18f, entity.transform);
            var trigger = entity.gameObject.AddComponent<BoxCollider>();
            trigger.size = scale;
            trigger.center = new Vector3(0f, scale.y * 0.5f, 0f);
        }

        private void CreateUnitVisual(AgesEntity entity)
        {
            var legion = entity.Team == AgesTeam.Legion;
            var accentColor = legion ? _cyan : _red;
            var armor = PhantomVisuals.Material("Ages armor " + entity.Team, legion ? new Color(0.12f, 0.37f, 0.50f) : new Color(0.42f, 0.10f, 0.12f), 0.62f, 0.35f, accentColor * 0.1f);
            var steel = PhantomVisuals.Material("Ages unit steel", new Color(0.3f, 0.31f, 0.3f), 0.76f, 0.42f);
            var leather = PhantomVisuals.Material("Ages leather", new Color(0.19f, 0.12f, 0.075f), 0f, 0.2f);
            var root = entity.transform;

            if (entity.Kind == AgesKind.Siege)
            {
                PhantomVisuals.DecorativePrimitive("Siege chassis", PrimitiveType.Cube, Vector3.zero, new Vector3(2.2f, 0.75f, 3.2f), leather, root).transform.localPosition = new Vector3(0f, 0.7f, 0f);
                PhantomVisuals.DecorativePrimitive("Siege rail", PrimitiveType.Cube, Vector3.zero, new Vector3(0.45f, 0.45f, 3.8f), steel, root).transform.localPosition = new Vector3(0f, 1.45f, 0.65f);
                for (var side = -1; side <= 1; side += 2)
                {
                    PhantomVisuals.DecorativePrimitive("Wheel", PrimitiveType.Cylinder, Vector3.zero, new Vector3(0.55f, 0.24f, 0.55f), steel, root).transform.SetLocalPositionAndRotation(new Vector3(side * 1.15f, 0.55f, -0.8f), Quaternion.Euler(0f, 0f, 90f));
                    PhantomVisuals.DecorativePrimitive("Wheel", PrimitiveType.Cylinder, Vector3.zero, new Vector3(0.55f, 0.24f, 0.55f), steel, root).transform.SetLocalPositionAndRotation(new Vector3(side * 1.15f, 0.55f, 0.9f), Quaternion.Euler(0f, 0f, 90f));
                }
            }
            else
            {
                var bodyScale = entity.Kind == AgesKind.Cavalry ? new Vector3(0.9f, 0.85f, 1.5f) : new Vector3(0.65f, 0.8f, 0.55f);
                var body = PhantomVisuals.DecorativePrimitive("Body", PrimitiveType.Capsule, Vector3.zero, bodyScale, armor, root);
                body.transform.localPosition = new Vector3(0f, entity.Kind == AgesKind.Cavalry ? 1.15f : 0.95f, 0f);
                PhantomVisuals.DecorativePrimitive("Helm", PrimitiveType.Sphere, Vector3.zero, new Vector3(0.5f, 0.42f, 0.5f), steel, root).transform.localPosition = new Vector3(0f, entity.Kind == AgesKind.Cavalry ? 2.05f : 1.8f, 0f);
                PhantomVisuals.DecorativePrimitive("Left shoulder", PrimitiveType.Sphere, Vector3.zero, new Vector3(0.28f, 0.22f, 0.32f), armor, root).transform.localPosition = new Vector3(-0.42f, 1.35f, 0f);
                PhantomVisuals.DecorativePrimitive("Right shoulder", PrimitiveType.Sphere, Vector3.zero, new Vector3(0.28f, 0.22f, 0.32f), armor, root).transform.localPosition = new Vector3(0.42f, 1.35f, 0f);
                var banner = PhantomVisuals.DecorativePrimitive("Faction banner", PrimitiveType.Cube, Vector3.zero, new Vector3(0.48f, 0.65f, 0.05f), armor, root);
                banner.transform.localPosition = new Vector3(0f, 1.2f, -0.42f);
                var weaponScale = entity.Kind == AgesKind.Ranger ? new Vector3(0.12f, 1.05f, 0.12f) : new Vector3(0.15f, 0.8f, 0.15f);
                var weapon = PhantomVisuals.DecorativePrimitive("Weapon", PrimitiveType.Cube, Vector3.zero, weaponScale, steel, root);
                weapon.transform.SetLocalPositionAndRotation(new Vector3(0.5f, 1.15f, 0.1f), Quaternion.Euler(20f, 0f, -15f));
            }
            entity.CreateSelectionRing(accentColor);
        }

        public void RemoveEntity(AgesEntity entity)
        {
            _selection.Remove(entity);
            _entities.Remove(entity);
            if (entity.Kind == AgesKind.Core)
            {
                EndCampaign(entity.Team == AgesTeam.Dominion ? "LEGION ASCENDANT" : "DOMINION VICTORY");
            }
        }

        private void HandleSelectionInput()
        {
            if (Input.GetMouseButtonDown(0))
            {
                _dragStart = Input.mousePosition;
                _dragging = true;
            }
            if (Input.GetMouseButtonUp(0))
            {
                var end = (Vector2)Input.mousePosition;
                var distance = Vector2.Distance(_dragStart, end);
                if (distance < 10f) SelectSingle(Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift));
                else SelectBox(_dragStart, end, Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift));
                _dragging = false;
                if (_selectionBox != null) _selectionBox.gameObject.SetActive(false);
            }
            if (_dragging && Vector2.Distance(_dragStart, Input.mousePosition) >= 10f) UpdateSelectionBox();
            if (Input.GetMouseButtonDown(1)) IssueOrder();
        }

        private void SelectSingle(bool additive)
        {
            if (!additive) ClearSelection();
            var ray = _camera.ScreenPointToRay(Input.mousePosition);
            if (!Physics.Raycast(ray, out var hit, 500f)) return;
            var entity = hit.collider.GetComponentInParent<AgesEntity>();
            if (entity != null && entity.Team == AgesTeam.Legion && entity.Kind != AgesKind.Core && entity.Kind != AgesKind.Outpost)
            {
                AddSelection(entity);
            }
        }

        private void SelectBox(Vector2 start, Vector2 end, bool additive)
        {
            if (!additive) ClearSelection();
            var min = Vector2.Min(start, end);
            var max = Vector2.Max(start, end);
            foreach (var entity in _entities)
            {
                if (entity == null || entity.Team != AgesTeam.Legion || !entity.IsUnit) continue;
                var screen = _camera.WorldToScreenPoint(entity.transform.position + Vector3.up);
                if (screen.z > 0f && screen.x >= min.x && screen.x <= max.x && screen.y >= min.y && screen.y <= max.y) AddSelection(entity);
            }
        }

        private void AddSelection(AgesEntity entity)
        {
            if (_selection.Contains(entity)) return;
            _selection.Add(entity);
            entity.SetSelected(true);
        }

        private void ClearSelection()
        {
            foreach (var entity in _selection) if (entity != null) entity.SetSelected(false);
            _selection.Clear();
        }

        private void IssueOrder()
        {
            if (_selection.Count == 0) return;
            var ray = _camera.ScreenPointToRay(Input.mousePosition);
            if (!Physics.Raycast(ray, out var hit, 500f)) return;
            var targetEntity = hit.collider.GetComponentInParent<AgesEntity>();
            var resource = hit.collider.GetComponentInParent<AgesResourceNode>();
            var destination = hit.point;
            for (var index = 0; index < _selection.Count; index++)
            {
                var offset = new Vector3((index % 5 - 2) * 1.7f, 0f, (index / 5) * 1.7f);
                if (targetEntity != null && targetEntity.Team != AgesTeam.Legion) _selection[index].OrderAttack(targetEntity);
                else if (resource != null && _selection[index].Kind == AgesKind.Worker) _selection[index].OrderGather(resource);
                else _selection[index].OrderMove(destination + offset);
            }
        }

        private void UpdateSelectionBox()
        {
            if (_selectionBox == null) return;
            _selectionBox.gameObject.SetActive(true);
            var current = (Vector2)Input.mousePosition;
            var min = Vector2.Min(_dragStart, current);
            var max = Vector2.Max(_dragStart, current);
            var rect = _selectionBox.rectTransform;
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.zero;
            rect.pivot = Vector2.zero;
            rect.anchoredPosition = min;
            rect.sizeDelta = max - min;
        }

        private void UpdateEconomy()
        {
            _aether += Time.deltaTime * (2.5f + _age * 0.9f);
            _alloy += Time.deltaTime * (1.6f + _age * 0.55f);
            _authority += Time.deltaTime * (0.42f + _age * 0.2f);
            _enemyAether += Time.deltaTime * (2.3f + _age * 0.8f);
            _enemyAlloy += Time.deltaTime * (1.5f + _age * 0.5f);
            _enemyAuthority += Time.deltaTime * 0.45f;
        }

        public void Deposit(AgesTeam team, AgesResourceKind kind, float amount)
        {
            if (team == AgesTeam.Legion)
            {
                if (kind == AgesResourceKind.Aether) _aether += amount;
                else if (kind == AgesResourceKind.Alloy) _alloy += amount;
                else _authority += amount;
            }
            else if (team == AgesTeam.Dominion)
            {
                if (kind == AgesResourceKind.Aether) _enemyAether += amount;
                else if (kind == AgesResourceKind.Alloy) _enemyAlloy += amount;
                else _enemyAuthority += amount;
            }
        }

        private void UpdateEnemyCommander()
        {
            _enemyThink -= Time.deltaTime;
            if (_enemyThink > 0f) return;
            _enemyThink = Mathf.Max(2.6f, 6f - _age * 0.6f);
            var choice = Random.value;
            var kind = choice < 0.22f ? AgesKind.Worker : choice < 0.58f ? AgesKind.Vanguard : choice < 0.82f ? AgesKind.Ranger : _age >= 1 && choice < 0.94f ? AgesKind.Cavalry : AgesKind.Siege;
            var cost = CostFor(kind);
            if (_enemyAether >= cost.x && _enemyAlloy >= cost.y && _enemyAuthority >= cost.z)
            {
                _enemyAether -= cost.x;
                _enemyAlloy -= cost.y;
                _enemyAuthority -= cost.z;
                var unit = SpawnUnit(AgesTeam.Dominion, kind, new Vector3(61f + Random.Range(-4f, 4f), 0f, Random.Range(-10f, 10f)));
                if (kind != AgesKind.Worker)
                {
                    var target = FindClosestEnemy(unit);
                    if (target != null) unit.OrderAttack(target);
                }
                else
                {
                    unit.OrderGather(_resourceNodes[Random.Range(0, _resourceNodes.Count - 1)]);
                }
            }
        }

        private void UpdateRiftShift()
        {
            _riftClock -= Time.deltaTime;
            var legion = 0;
            var dominion = 0;
            foreach (var entity in _entities)
            {
                if (entity == null || !entity.IsUnit || entity.transform.position.sqrMagnitude > 18f * 18f) continue;
                if (entity.Team == AgesTeam.Legion) legion++;
                else if (entity.Team == AgesTeam.Dominion) dominion++;
            }
            if (legion > dominion) _authority += Time.deltaTime * (legion - dominion) * 0.35f;
            else if (dominion > legion) _enemyAuthority += Time.deltaTime * (dominion - legion) * 0.35f;

            if (_riftClock <= 0f)
            {
                _riftClock = 70f;
                _riftPhase = (_riftPhase + 1) % 3;
                RenderSettings.fogColor = _riftPhase == 0 ? new Color(0.37f, 0.43f, 0.44f) : _riftPhase == 1 ? new Color(0.29f, 0.39f, 0.43f) : new Color(0.43f, 0.34f, 0.32f);
            }
        }

        public void Train(AgesKind kind)
        {
            if (!Running) return;
            if (kind == AgesKind.Cavalry && _age < 1 || kind == AgesKind.Siege && _age < 2)
            {
                _objectiveText.text = kind + " unlocks in a later age.";
                return;
            }
            var cost = CostFor(kind);
            if (_aether < cost.x || _alloy < cost.y || _authority < cost.z)
            {
                _objectiveText.text = "Insufficient resources.";
                return;
            }
            _aether -= cost.x;
            _alloy -= cost.y;
            _authority -= cost.z;
            SpawnUnit(AgesTeam.Legion, kind, new Vector3(-61f + Random.Range(-3f, 3f), 0f, Random.Range(-10f, 10f)));
            _objectiveText.text = kind + " deployed.";
        }

        private static Vector3 CostFor(AgesKind kind)
        {
            switch (kind)
            {
                case AgesKind.Worker: return new Vector3(80f, 0f, 0f);
                case AgesKind.Ranger: return new Vector3(110f, 45f, 0f);
                case AgesKind.Cavalry: return new Vector3(180f, 120f, 20f);
                case AgesKind.Siege: return new Vector3(160f, 260f, 45f);
                default: return new Vector3(120f, 70f, 0f);
            }
        }

        public void AdvanceAge()
        {
            if (!Running || _age >= _ages.Length - 1) return;
            var neededAether = 650f + _age * 420f;
            var neededAlloy = 480f + _age * 350f;
            var neededAuthority = 180f + _age * 140f;
            if (_aether < neededAether || _alloy < neededAlloy || _authority < neededAuthority)
            {
                _objectiveText.text = "Advance requires " + neededAether.ToString("0") + " Aether, " + neededAlloy.ToString("0") + " Alloy, " + neededAuthority.ToString("0") + " Authority.";
                return;
            }
            _aether -= neededAether;
            _alloy -= neededAlloy;
            _authority -= neededAuthority;
            _age++;
            _objectiveText.text = _ages[_age] + " reached. New military doctrine online.";
            foreach (var entity in _entities)
            {
                if (entity != null && entity.Team == AgesTeam.Legion) entity.ApplyAgeUpgrade(_age);
            }
        }

        public AgesEntity FindClosestEnemy(AgesEntity source)
        {
            AgesEntity best = null;
            var bestDistance = float.MaxValue;
            foreach (var entity in _entities)
            {
                if (entity == null || entity.Team == source.Team || entity.Team == AgesTeam.Neutral) continue;
                var distance = (entity.transform.position - source.transform.position).sqrMagnitude;
                if (distance < bestDistance)
                {
                    best = entity;
                    bestDistance = distance;
                }
            }
            return best;
        }

        private void CreateHud()
        {
            _hudCanvas = PhantomUi.Canvas("Phantom Legends Command", 50);
            var top = PhantomUi.Panel("Top Command", _hudCanvas.transform, new Color(0.018f, 0.027f, 0.034f, 0.94f), new Vector2(0.015f, 0.91f), new Vector2(0.985f, 0.985f), Vector2.zero, Vector2.zero, 8);
            _resourceText = PhantomUi.Text("Resources", top, "", 18, Color.white, TextAnchor.MiddleLeft, FontStyle.Bold);
            PhantomUi.Place(_resourceText.rectTransform, Vector2.zero, new Vector2(0.5f, 1f), new Vector2(24f, 0f), Vector2.zero);
            _ageText = PhantomUi.Text("Age", top, _ages[0], 18, _cyan, TextAnchor.MiddleCenter, FontStyle.Bold);
            PhantomUi.Place(_ageText.rectTransform, new Vector2(0.39f, 0f), new Vector2(0.61f, 1f), Vector2.zero, Vector2.zero);
            _phaseText = PhantomUi.Text("Rift", top, "RIFT STABLE", 15, new Color(0.82f, 0.74f, 1f), TextAnchor.MiddleRight, FontStyle.Bold);
            PhantomUi.Place(_phaseText.rectTransform, new Vector2(0.62f, 0f), Vector2.one, Vector2.zero, new Vector2(-24f, 0f));

            var bottom = PhantomUi.Panel("Command Deck", _hudCanvas.transform, new Color(0.018f, 0.027f, 0.034f, 0.95f), new Vector2(0.17f, 0.02f), new Vector2(0.83f, 0.17f), Vector2.zero, Vector2.zero, 8);
            var production = new GameObject("Production", typeof(RectTransform), typeof(HorizontalLayoutGroup));
            production.transform.SetParent(bottom, false);
            var productionRect = production.GetComponent<RectTransform>();
            PhantomUi.Place(productionRect, new Vector2(0.02f, 0.18f), new Vector2(0.78f, 0.88f), Vector2.zero, Vector2.zero);
            var productionLayout = production.GetComponent<HorizontalLayoutGroup>();
            productionLayout.spacing = 8f;
            productionLayout.childForceExpandHeight = true;
            productionLayout.childForceExpandWidth = true;
            AddTrainButton(production.transform, "WORKER\n80 A", AgesKind.Worker);
            AddTrainButton(production.transform, "VANGUARD\n120 A  70 L", AgesKind.Vanguard);
            AddTrainButton(production.transform, "RANGER\n110 A  45 L", AgesKind.Ranger);
            AddTrainButton(production.transform, "CAVALRY\n180 A  120 L", AgesKind.Cavalry);
            AddTrainButton(production.transform, "SIEGE\n160 A  260 L", AgesKind.Siege);

            _advanceButton = PhantomUi.Button("Advance", bottom, "ADVANCE AGE", new Color(0.08f, 0.56f, 0.73f), Color.white, AdvanceAge);
            PhantomUi.Place(_advanceButton.GetComponent<RectTransform>(), new Vector2(0.80f, 0.18f), new Vector2(0.98f, 0.88f), Vector2.zero, Vector2.zero);

            var selection = PhantomUi.Panel("Selection", _hudCanvas.transform, new Color(0.018f, 0.027f, 0.034f, 0.9f), new Vector2(0.015f, 0.02f), new Vector2(0.16f, 0.17f), Vector2.zero, Vector2.zero, 8);
            _selectionText = PhantomUi.Text("Selection Text", selection, "NO UNITS SELECTED", 15, new Color(0.78f, 0.82f, 0.83f), TextAnchor.MiddleCenter, FontStyle.Bold);
            PhantomUi.Stretch(_selectionText.rectTransform, 14f);

            var minimap = PhantomUi.Panel("Minimap", _hudCanvas.transform, new Color(0.035f, 0.052f, 0.055f, 0.92f), new Vector2(0.84f, 0.02f), new Vector2(0.985f, 0.21f), Vector2.zero, Vector2.zero, 8);
            CreateMapDot(minimap, new Vector2(0.16f, 0.5f), _cyan, 14f);
            CreateMapDot(minimap, new Vector2(0.84f, 0.5f), _red, 14f);
            CreateMapDot(minimap, new Vector2(0.5f, 0.5f), new Color(0.72f, 0.3f, 1f), 9f);

            _objectiveText = PhantomUi.Text("Objective", _hudCanvas.transform, "Destroy the Dominion Core.", 16, Color.white, TextAnchor.MiddleCenter, FontStyle.Bold);
            PhantomUi.Place(_objectiveText.rectTransform, new Vector2(0.30f, 0.855f), new Vector2(0.70f, 0.905f), Vector2.zero, Vector2.zero);

            var selectionBoxObject = new GameObject("Selection Box", typeof(RectTransform), typeof(Image));
            selectionBoxObject.transform.SetParent(_hudCanvas.transform, false);
            _selectionBox = selectionBoxObject.GetComponent<Image>();
            _selectionBox.color = new Color(0.10f, 0.78f, 0.95f, 0.18f);
            _selectionBox.raycastTarget = false;
            _selectionBox.gameObject.SetActive(false);
        }

        private void AddTrainButton(Transform parent, string label, AgesKind kind)
        {
            var button = PhantomUi.Button(kind.ToString(), parent, label, new Color(0.09f, 0.13f, 0.15f), Color.white, () => Train(kind));
            var labelText = button.GetComponentInChildren<Text>();
            labelText.fontSize = 13;
            var layout = button.gameObject.AddComponent<LayoutElement>();
            layout.minHeight = 64f;
        }

        private static void CreateMapDot(Transform parent, Vector2 anchor, Color color, float size)
        {
            var dot = new GameObject("Map Marker", typeof(RectTransform), typeof(Image));
            dot.transform.SetParent(parent, false);
            var rect = dot.GetComponent<RectTransform>();
            rect.anchorMin = anchor;
            rect.anchorMax = anchor;
            rect.anchoredPosition = Vector2.zero;
            rect.sizeDelta = new Vector2(size, size);
            dot.GetComponent<Image>().sprite = PhantomVisuals.RoundedPanel(color, 30);
        }

        private void UpdateHud()
        {
            if (_resourceText != null)
            {
                _resourceText.text = "AETHER  " + Mathf.FloorToInt(_aether) + "     ALLOY  " + Mathf.FloorToInt(_alloy) + "     AUTHORITY  " + Mathf.FloorToInt(_authority);
            }
            if (_ageText != null) _ageText.text = _ages[_age];
            if (_phaseText != null) _phaseText.text = "RIFT SHIFT  " + Mathf.CeilToInt(_riftClock) + "s  |  " + (_riftPhase == 0 ? "STABLE" : _riftPhase == 1 ? "AETHER SURGE" : "WAR STORM");
            if (_selectionText != null)
            {
                _selectionText.text = _selection.Count == 0 ? "NO UNITS SELECTED" : _selection.Count == 1 ? _selection[0].Kind + "\n" + Mathf.CeilToInt(_selection[0].Health) + " HP" : _selection.Count + " UNITS SELECTED";
            }
            if (_advanceButton != null) _advanceButton.interactable = _age < _ages.Length - 1;
        }

        private void EndCampaign(string result)
        {
            _ended = true;
            ClearSelection();
            _objectiveText.text = result;
        }
    }

    public sealed class AgesResourceNode : MonoBehaviour
    {
        public AgesResourceKind Kind;
        public float Amount;
    }

    public sealed class AgesEntity : MonoBehaviour
    {
        public AgesTeam Team { get; private set; }
        public AgesKind Kind { get; private set; }
        public float Health { get; private set; }
        public bool IsUnit => Kind != AgesKind.Core && Kind != AgesKind.Outpost;

        private float _maxHealth;
        private float _damage;
        private float _range;
        private float _speed;
        private float _attackCooldown;
        private float _gatherCooldown;
        private Vector3 _destination;
        private bool _moving;
        private AgesEntity _target;
        private AgesResourceNode _resource;
        private GameObject _selectionRing;

        public void Configure(AgesTeam team, AgesKind kind, float health)
        {
            Team = team;
            Kind = kind;
            _maxHealth = health;
            Health = health;
            _damage = kind == AgesKind.Worker ? 7f : kind == AgesKind.Ranger ? 19f : kind == AgesKind.Cavalry ? 28f : kind == AgesKind.Siege ? 62f : kind == AgesKind.Core ? 28f : 22f;
            _range = kind == AgesKind.Ranger ? 12f : kind == AgesKind.Siege ? 18f : kind == AgesKind.Core || kind == AgesKind.Outpost ? 15f : 2f;
            _speed = kind == AgesKind.Worker ? 5.2f : kind == AgesKind.Cavalry ? 7.4f : kind == AgesKind.Siege ? 2.5f : 4.4f;
        }

        public void CreateSelectionRing(Color color)
        {
            var material = PhantomVisuals.Material("Selection " + Team, color, 0.1f, 0.76f, color * 0.55f);
            _selectionRing = PhantomVisuals.DecorativePrimitive("Selection Ring", PrimitiveType.Cylinder, Vector3.zero, new Vector3(0.95f, 0.025f, 0.95f), material, transform);
            _selectionRing.transform.localPosition = new Vector3(0f, 0.04f, 0f);
            _selectionRing.SetActive(false);
        }

        public void SetSelected(bool selected)
        {
            if (_selectionRing != null) _selectionRing.SetActive(selected);
        }

        public void OrderMove(Vector3 destination)
        {
            if (!IsUnit) return;
            _destination = destination;
            _destination.y = 0f;
            _moving = true;
            _target = null;
            _resource = null;
        }

        public void OrderAttack(AgesEntity target)
        {
            if (target == null || target.Team == Team) return;
            _target = target;
            _resource = null;
            _moving = false;
        }

        public void OrderGather(AgesResourceNode resource)
        {
            if (Kind != AgesKind.Worker || resource == null) return;
            _resource = resource;
            _target = null;
            _moving = false;
        }

        public void ApplyAgeUpgrade(int age)
        {
            _maxHealth *= 1f + age * 0.08f;
            Health = Mathf.Min(_maxHealth, Health + _maxHealth * 0.18f);
            _damage *= 1f + age * 0.09f;
        }

        private void Update()
        {
            if (!PhantomLegendsGame.Instance.Running || Health <= 0f) return;
            _attackCooldown -= Time.deltaTime;
            _gatherCooldown -= Time.deltaTime;
            if (!IsUnit)
            {
                StructureAttack();
                return;
            }
            if (_resource != null) Gather();
            else if (_target != null) AttackTarget();
            else if (_moving) MoveTo(_destination);
            else if (Team == AgesTeam.Dominion && Kind != AgesKind.Worker)
            {
                var target = PhantomLegendsGame.Instance.FindClosestEnemy(this);
                if (target != null) _target = target;
            }
        }

        private void MoveTo(Vector3 destination)
        {
            var delta = destination - transform.position;
            delta.y = 0f;
            if (delta.magnitude < 0.6f)
            {
                _moving = false;
                return;
            }
            transform.position += delta.normalized * (_speed * Time.deltaTime);
            transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(delta), Time.deltaTime * 8f);
        }

        private void AttackTarget()
        {
            if (_target == null || _target.Health <= 0f)
            {
                _target = null;
                return;
            }
            var delta = _target.transform.position - transform.position;
            delta.y = 0f;
            if (delta.magnitude > _range)
            {
                MoveTo(_target.transform.position);
                return;
            }
            transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(delta), Time.deltaTime * 8f);
            if (_attackCooldown <= 0f)
            {
                var color = Team == AgesTeam.Legion ? new Color(0.1f, 0.78f, 0.95f) : new Color(0.94f, 0.18f, 0.24f);
                AgesProjectile.Launch(transform.position + Vector3.up * 1.15f, _target.transform.position + Vector3.up, color, Kind == AgesKind.Siege ? 0.24f : 0.12f);
                _target.TakeDamage(_damage);
                _attackCooldown = Kind == AgesKind.Siege ? 2.5f : Kind == AgesKind.Ranger ? 1.25f : 0.9f;
                PhantomVisuals.PointLight("Impact", _target.transform.position + Vector3.up, color, 2f, 6f).gameObject.AddComponent<TemporaryLight>();
            }
        }

        private void Gather()
        {
            if (_resource == null || _resource.Amount <= 0f)
            {
                _resource = null;
                return;
            }
            var delta = _resource.transform.position - transform.position;
            delta.y = 0f;
            if (delta.magnitude > 4f)
            {
                MoveTo(_resource.transform.position);
                return;
            }
            if (_gatherCooldown <= 0f)
            {
                var amount = Mathf.Min(14f, _resource.Amount);
                _resource.Amount -= amount;
                PhantomLegendsGame.Instance.Deposit(Team, _resource.Kind, amount);
                _gatherCooldown = 1.2f;
            }
        }

        private void StructureAttack()
        {
            if (_attackCooldown > 0f) return;
            var target = PhantomLegendsGame.Instance.FindClosestEnemy(this);
            if (target == null || !target.IsUnit || Vector3.Distance(transform.position, target.transform.position) > _range) return;
            var color = Team == AgesTeam.Legion ? new Color(0.1f, 0.78f, 0.95f) : new Color(0.94f, 0.18f, 0.24f);
            AgesProjectile.Launch(transform.position + Vector3.up * 5f, target.transform.position + Vector3.up, color, 0.18f);
            target.TakeDamage(_damage);
            _attackCooldown = 1.4f;
        }

        public void TakeDamage(float amount)
        {
            Health = Mathf.Max(0f, Health - amount);
            if (Health > 0f) return;
            PhantomLegendsGame.Instance.RemoveEntity(this);
            Destroy(gameObject);
        }
    }

    public sealed class AgesCameraRig : MonoBehaviour
    {
        private Vector3 _focus;
        private float _distance = 118f;
        private float _yaw;

        public void Configure(Vector3 focus)
        {
            _focus = focus;
            ApplyTransform();
        }

        private void Update()
        {
            var x = (Input.GetKey(KeyCode.D) ? 1f : 0f) - (Input.GetKey(KeyCode.A) ? 1f : 0f);
            var z = (Input.GetKey(KeyCode.W) ? 1f : 0f) - (Input.GetKey(KeyCode.S) ? 1f : 0f);
            var forward = Quaternion.Euler(0f, _yaw, 0f) * Vector3.forward;
            var right = Quaternion.Euler(0f, _yaw, 0f) * Vector3.right;
            _focus += (forward * z + right * x) * (28f * Time.deltaTime);
            _focus.x = Mathf.Clamp(_focus.x, -78f, 78f);
            _focus.z = Mathf.Clamp(_focus.z, -48f, 48f);
            if (Input.GetKey(KeyCode.Q)) _yaw -= 55f * Time.deltaTime;
            if (Input.GetKey(KeyCode.E)) _yaw += 55f * Time.deltaTime;
            _distance = Mathf.Clamp(_distance - Input.mouseScrollDelta.y * 5f, 28f, 132f);
            ApplyTransform();
        }

        private void ApplyTransform()
        {
            var rotation = Quaternion.Euler(58f, _yaw, 0f);
            transform.position = _focus - rotation * Vector3.forward * _distance;
            transform.rotation = rotation;
        }
    }

    public sealed class TemporaryLight : MonoBehaviour
    {
        private float _life = 0.12f;
        private void Update()
        {
            _life -= Time.deltaTime;
            if (_life <= 0f) Destroy(gameObject);
        }
    }

    public sealed class AgesProjectile : MonoBehaviour
    {
        private Vector3 _destination;
        private float _speed;

        public static void Launch(Vector3 origin, Vector3 destination, Color color, float size)
        {
            var material = PhantomVisuals.Material("Ages projectile " + color, color, 0.1f, 0.88f, color * 1.4f);
            var projectile = PhantomVisuals.DecorativePrimitive("Rift projectile", PrimitiveType.Sphere, origin, Vector3.one * size, material);
            var motion = projectile.AddComponent<AgesProjectile>();
            motion._destination = destination;
            motion._speed = 34f;
        }

        private void Update()
        {
            transform.position = Vector3.MoveTowards(transform.position, _destination, _speed * Time.deltaTime);
            if ((transform.position - _destination).sqrMagnitude < 0.05f) Destroy(gameObject);
        }
    }
}

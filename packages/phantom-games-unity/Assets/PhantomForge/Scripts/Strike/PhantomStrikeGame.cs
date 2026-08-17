using System.Collections;
using System.Collections.Generic;
using PhantomForge.Core;
using UnityEngine;
using UnityEngine.UI;

namespace PhantomForge.Strike
{
    public enum StrikeTeam
    {
        Specter,
        Helix
    }

    public enum StrikeLoadout
    {
        Vanguard,
        Breacher,
        Marksman
    }

    public sealed class PhantomStrikeGame : MonoBehaviour
    {
        public const string GameId = "phantom-strike";
        public const string SaveNamespace = "phantomstrike.";

        public static PhantomStrikeGame Instance { get; private set; }

        private readonly List<StrikeBot> _bots = new List<StrikeBot>();
        private readonly Vector3[] _specterSpawns =
        {
            new Vector3(-43f, 1.1f, 0f), new Vector3(-40f, 1.1f, -29f), new Vector3(-40f, 1.1f, 29f)
        };
        private readonly Vector3[] _helixSpawns =
        {
            new Vector3(43f, 1.1f, 0f), new Vector3(40f, 1.1f, 29f), new Vector3(40f, 1.1f, -29f)
        };

        private Canvas _menuCanvas;
        private Canvas _hudCanvas;
        private Text _healthText;
        private Text _ammoText;
        private Text _scoreText;
        private Text _statusText;
        private Text _timerText;
        private Text _crosshairText;
        private Image _damageFlash;
        private StrikePlayerController _player;
        private StrikeLoadout _selectedLoadout = StrikeLoadout.Vanguard;
        private int _specterScore;
        private int _helixScore;
        private float _matchRemaining = 480f;
        private float _hitMarkerClock;
        private bool _matchRunning;

        private readonly Color _cyan = new Color(0.18f, 0.92f, 0.82f, 1f);
        private readonly Color _red = new Color(1f, 0.24f, 0.28f, 1f);
        private readonly Color _ink = new Color(0.025f, 0.032f, 0.038f, 0.96f);

        private void Awake()
        {
            Instance = this;
        }

        private void Start()
        {
            PhantomVisuals.ConfigureWorld(
                new Color(0.31f, 0.35f, 0.38f),
                new Color(0.24f, 0.29f, 0.32f),
                0.006f,
                new Color(1f, 0.88f, 0.72f),
                1.1f,
                new Vector3(42f, -34f, 0f));
            CreateDeploymentScreen();
            if (PhantomSmokeCapture.Enabled)
            {
                StartCoroutine(PhantomSmokeCapture.Run("Deploy", "phantom-strike"));
            }
        }

        private void Update()
        {
            if (!_matchRunning) return;
            _matchRemaining = Mathf.Max(0f, _matchRemaining - Time.deltaTime);
            var minutes = Mathf.FloorToInt(_matchRemaining / 60f);
            var seconds = Mathf.FloorToInt(_matchRemaining % 60f);
            if (_timerText != null) _timerText.text = minutes + ":" + seconds.ToString("00");
            if (_matchRemaining <= 0f)
            {
                EndMatch(_specterScore >= _helixScore ? "SPECTER VICTORY" : "HELIX VICTORY");
            }

            if (_damageFlash != null)
            {
                var color = _damageFlash.color;
                color.a = Mathf.MoveTowards(color.a, 0f, Time.deltaTime * 1.8f);
                _damageFlash.color = color;
            }
            if (_hitMarkerClock > 0f)
            {
                _hitMarkerClock -= Time.deltaTime;
                if (_hitMarkerClock <= 0f && _crosshairText != null)
                {
                    _crosshairText.text = "+";
                    _crosshairText.fontSize = 24;
                    _crosshairText.color = new Color(1f, 1f, 1f, 0.86f);
                }
            }
        }

        private void CreateDeploymentScreen()
        {
            _menuCanvas = PhantomUi.Canvas("PhantomStrike Deployment", 100);
            var background = new GameObject("Key Art", typeof(RectTransform), typeof(Image));
            background.transform.SetParent(_menuCanvas.transform, false);
            var backgroundImage = background.GetComponent<Image>();
            backgroundImage.sprite = PhantomVisuals.ResourceSprite("Art/phantom-strike-keyart");
            backgroundImage.color = backgroundImage.sprite == null ? new Color(0.1f, 0.12f, 0.14f) : Color.white;
            backgroundImage.preserveAspect = false;
            PhantomUi.Stretch(background.GetComponent<RectTransform>());

            var shade = PhantomUi.Panel("Shade", _menuCanvas.transform, new Color(0.015f, 0.02f, 0.024f, 0.54f), Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, 0);
            var command = PhantomUi.Panel("Deployment", shade, _ink, new Vector2(0.045f, 0.08f), new Vector2(0.40f, 0.92f), Vector2.zero, Vector2.zero, 8);

            var title = PhantomUi.Text("Title", command, "PHANTOMSTRIKE", 48, Color.white, TextAnchor.UpperLeft, FontStyle.Bold);
            PhantomUi.Place(title.rectTransform, new Vector2(0f, 0.78f), new Vector2(1f, 0.97f), new Vector2(34f, 0f), new Vector2(-28f, 0f));
            var strap = PhantomUi.Text("Strap", command, "THE RETURN OF REAL FPS", 18, _cyan, TextAnchor.UpperLeft, FontStyle.Bold);
            PhantomUi.Place(strap.rectTransform, new Vector2(0f, 0.70f), new Vector2(1f, 0.80f), new Vector2(36f, 0f), new Vector2(-28f, 0f));

            var brief = PhantomUi.Text("Brief", command,
                "BLACKRIDGE COAST\n\nPush through the flooded transit district. Control the central platform, break the Helix line, and reach 20 eliminations before extraction.",
                18, new Color(0.82f, 0.85f, 0.86f), TextAnchor.UpperLeft);
            PhantomUi.Place(brief.rectTransform, new Vector2(0f, 0.44f), new Vector2(1f, 0.69f), new Vector2(36f, 0f), new Vector2(-36f, 0f));

            var loadoutLabel = PhantomUi.Text("Loadout Label", command, "SELECT LOADOUT", 13, new Color(0.58f, 0.64f, 0.66f), TextAnchor.MiddleLeft, FontStyle.Bold);
            PhantomUi.Place(loadoutLabel.rectTransform, new Vector2(0f, 0.37f), new Vector2(1f, 0.43f), new Vector2(36f, 0f), new Vector2(-36f, 0f));

            var loadouts = new GameObject("Loadouts", typeof(RectTransform), typeof(HorizontalLayoutGroup));
            loadouts.transform.SetParent(command, false);
            var loadoutsRect = loadouts.GetComponent<RectTransform>();
            PhantomUi.Place(loadoutsRect, new Vector2(0f, 0.25f), new Vector2(1f, 0.37f), new Vector2(34f, 0f), new Vector2(-34f, 0f));
            var layout = loadouts.GetComponent<HorizontalLayoutGroup>();
            layout.spacing = 8f;
            layout.childForceExpandWidth = true;
            layout.childForceExpandHeight = true;
            AddLoadoutButton(loadouts.transform, "VANGUARD", StrikeLoadout.Vanguard);
            AddLoadoutButton(loadouts.transform, "BREACHER", StrikeLoadout.Breacher);
            AddLoadoutButton(loadouts.transform, "MARKSMAN", StrikeLoadout.Marksman);

            _statusText = PhantomUi.Text("Loadout Status", command, LoadoutDescription(_selectedLoadout), 15, new Color(0.72f, 0.77f, 0.78f), TextAnchor.UpperLeft);
            PhantomUi.Place(_statusText.rectTransform, new Vector2(0f, 0.14f), new Vector2(1f, 0.24f), new Vector2(36f, 0f), new Vector2(-36f, 0f));

            var deploy = PhantomUi.Button("Deploy", command, "DEPLOY", new Color(0.10f, 0.72f, 0.55f), Color.white, StartMatch);
            PhantomUi.Place(deploy.GetComponent<RectTransform>(), new Vector2(0f, 0.035f), new Vector2(1f, 0.13f), new Vector2(34f, 0f), new Vector2(-34f, 0f));
        }

        private void AddLoadoutButton(Transform parent, string label, StrikeLoadout loadout)
        {
            var button = PhantomUi.Button(label, parent, label, new Color(0.12f, 0.15f, 0.17f, 0.96f), Color.white, () =>
            {
                _selectedLoadout = loadout;
                if (_statusText != null) _statusText.text = LoadoutDescription(loadout);
            });
            var element = button.gameObject.AddComponent<LayoutElement>();
            element.minHeight = 54f;
        }

        private static string LoadoutDescription(StrikeLoadout loadout)
        {
            switch (loadout)
            {
                case StrikeLoadout.Breacher: return "VX-9 compact SMG | fast handling | 36-round magazine | close assault";
                case StrikeLoadout.Marksman: return "MR-17 battle rifle | high impact | 16-round magazine | precision lanes";
                default: return "AR-6 modular rifle | balanced recoil | 30-round magazine | all-range control";
            }
        }

        private void StartMatch()
        {
            if (_menuCanvas != null) Destroy(_menuCanvas.gameObject);
            BuildBlackridgeArena();
            CreateHud();
            SpawnPlayer();
            for (var index = 0; index < 4; index++) SpawnBot(StrikeTeam.Helix, index);
            for (var index = 0; index < 2; index++) SpawnBot(StrikeTeam.Specter, index + 1);
            _matchRunning = true;
            Cursor.lockState = CursorLockMode.Locked;
            Cursor.visible = false;
        }

        private void BuildBlackridgeArena()
        {
            var concrete = PhantomVisuals.Material("Strike concrete", new Color(0.24f, 0.26f, 0.27f), 0.05f, 0.18f);
            var wet = PhantomVisuals.Material("Strike wet asphalt", new Color(0.045f, 0.055f, 0.06f), 0.18f, 0.72f);
            var steel = PhantomVisuals.Material("Strike steel", new Color(0.13f, 0.15f, 0.16f), 0.72f, 0.48f);
            var olive = PhantomVisuals.Material("Strike olive", new Color(0.22f, 0.25f, 0.19f), 0.3f, 0.28f);
            var glass = PhantomVisuals.Material("Strike glass", new Color(0.12f, 0.24f, 0.28f), 0.15f, 0.82f, new Color(0.02f, 0.12f, 0.14f));

            PhantomVisuals.Primitive("Blackridge ground", PrimitiveType.Cube, new Vector3(0f, -0.5f, 0f), new Vector3(110f, 1f, 110f), wet);
            PhantomVisuals.Primitive("North seawall", PrimitiveType.Cube, new Vector3(0f, 2f, 54f), new Vector3(110f, 5f, 2f), concrete);
            PhantomVisuals.Primitive("South seawall", PrimitiveType.Cube, new Vector3(0f, 2f, -54f), new Vector3(110f, 5f, 2f), concrete);
            PhantomVisuals.Primitive("West wall", PrimitiveType.Cube, new Vector3(-54f, 2f, 0f), new Vector3(2f, 5f, 110f), concrete);
            PhantomVisuals.Primitive("East wall", PrimitiveType.Cube, new Vector3(54f, 2f, 0f), new Vector3(2f, 5f, 110f), concrete);

            CreateStreetGrid();
            CreateBuilding("Transit Hall", "Hospital", new Vector3(18f, 5f, 18f), new Vector3(25f, 10f, 18f), concrete, glass, 180f);
            CreateBuilding("Market Block", "Shop", new Vector3(-24f, 4f, 22f), new Vector3(22f, 8f, 20f), concrete, glass, 0f);
            CreateBuilding("Flood Control", "Bank", new Vector3(25f, 3.5f, -25f), new Vector3(20f, 7f, 18f), concrete, steel, 180f);
            CreateBuilding("Service Garage", "Flat2", new Vector3(-28f, 3.5f, -24f), new Vector3(21f, 7f, 17f), concrete, steel, 0f);

            var skyline = new[]
            {
                new Vector3(-43f, 0f, 63f), new Vector3(-14f, 0f, 64f), new Vector3(14f, 0f, -64f),
                new Vector3(43f, 0f, -63f), new Vector3(-62f, 0f, -34f), new Vector3(62f, 0f, 34f)
            };
            var skylineModels = new[] { "Flat", "House1", "Flat2", "House3", "House4", "House5" };
            for (var index = 0; index < skyline.Length; index++)
            {
                var tower = PhantomVisuals.GroundedResourceModel(
                    "Models/Quaternius/Strike/" + skylineModels[index],
                    "Blackridge skyline " + index,
                    skyline[index],
                    Quaternion.Euler(0f, index % 2 == 0 ? 180f : 0f, 0f),
                    24f);
                PhantomVisuals.ApplyMaterial(tower, steel);
            }

            var cover = new[]
            {
                new Vector3(-8f, 1f, -8f), new Vector3(8f, 1f, 8f), new Vector3(-9f, 1f, 12f), new Vector3(11f, 1f, -14f),
                new Vector3(-38f, 1f, 4f), new Vector3(38f, 1f, -4f), new Vector3(-4f, 1f, 34f), new Vector3(5f, 1f, -36f)
            };
            for (var index = 0; index < cover.Length; index++)
            {
                PhantomVisuals.Primitive("Barrier " + index, PrimitiveType.Cube, cover[index], new Vector3(5.5f, 2f, 1.4f), index % 2 == 0 ? concrete : steel);
            }

            for (var index = 0; index < 5; index++)
            {
                var x = -42f + index * 20f;
                PhantomVisuals.Primitive("Vehicle " + index, PrimitiveType.Cube, new Vector3(x, 1f, index % 2 == 0 ? 2f : -7f), new Vector3(6f, 2f, 3.2f), olive);
                PhantomVisuals.DecorativePrimitive("Vehicle roof " + index, PrimitiveType.Cube, new Vector3(x, 2.1f, index % 2 == 0 ? 2f : -7f), new Vector3(3.6f, 1f, 2.7f), steel);
            }

            for (var index = 0; index < 9; index++)
            {
                var z = -44f + index * 11f;
                var lamp = PhantomVisuals.ResourceModel(
                    "Models/Quaternius/Strike/Streetlight_Single",
                    "Lane light " + index,
                    new Vector3(-48f, 3.5f, z),
                    Quaternion.Euler(0f, 90f, 0f),
                    7f);
                if (lamp == null)
                {
                    PhantomVisuals.DecorativePrimitive("Lane light " + index, PrimitiveType.Cylinder, new Vector3(-48f, 3.5f, z), new Vector3(0.12f, 3.5f, 0.12f), steel);
                }
                PhantomVisuals.PointLight("Lane lamp " + index, new Vector3(-48f, 7f, z), new Color(0.58f, 0.82f, 0.88f), 2f, 11f);
            }

            PhantomVisuals.PointLight("Transit cyan", new Vector3(18f, 5f, 9f), _cyan, 4f, 22f);
            PhantomVisuals.PointLight("Helix flare", new Vector3(34f, 3f, 34f), _red, 5f, 24f);
        }

        private static void CreateStreetGrid()
        {
            for (var index = -2; index <= 2; index++)
            {
                PhantomVisuals.ResourceModel(
                    "Models/Quaternius/Strike/Street_Straight",
                    "Main avenue " + index,
                    new Vector3(0f, 0.03f, index * 20f),
                    Quaternion.identity,
                    20f);
                PhantomVisuals.ResourceModel(
                    "Models/Quaternius/Strike/Street_Straight",
                    "Cross street " + index,
                    new Vector3(index * 20f, 0.035f, 0f),
                    Quaternion.Euler(0f, 90f, 0f),
                    20f);
            }
            PhantomVisuals.ResourceModel("Models/Quaternius/Strike/Street_4Way", "Central junction", new Vector3(0f, 0.04f, 0f), Quaternion.identity, 20f);
        }

        private static void CreateBuilding(string name, string modelName, Vector3 center, Vector3 size, Material wall, Material accent, float yaw)
        {
            var building = PhantomVisuals.GroundedResourceModel(
                "Models/Quaternius/Strike/" + modelName,
                name,
                new Vector3(center.x, 0f, center.z),
                Quaternion.Euler(0f, yaw, 0f),
                Mathf.Max(size.x, Mathf.Max(size.y, size.z)));
            if (building == null)
            {
                PhantomVisuals.Primitive(name, PrimitiveType.Cube, center, size, wall);
            }
            else
            {
                PhantomVisuals.ApplyMaterial(building, wall);
                var collision = new GameObject(name + " Collision");
                collision.transform.position = center;
                var collider = collision.AddComponent<BoxCollider>();
                collider.size = size;
            }
            var front = center + new Vector3(0f, 0f, -size.z * 0.505f);
            for (var index = -2; index <= 2; index++)
            {
                PhantomVisuals.DecorativePrimitive(name + " window " + index, PrimitiveType.Cube, front + new Vector3(index * size.x * 0.16f, 1f, 0f), new Vector3(size.x * 0.1f, size.y * 0.28f, 0.08f), accent);
            }
        }

        private void SpawnPlayer()
        {
            var root = new GameObject("Specter Player");
            root.transform.position = SafeSpawn(StrikeTeam.Specter, 0);
            root.transform.rotation = Quaternion.LookRotation((Vector3.zero - root.transform.position).normalized);
            var controller = root.AddComponent<CharacterController>();
            controller.height = 1.8f;
            controller.radius = 0.36f;
            controller.center = new Vector3(0f, 0.9f, 0f);
            var combatant = root.AddComponent<StrikeCombatant>();
            combatant.Configure(StrikeTeam.Specter, true, 100f);
            _player = root.AddComponent<StrikePlayerController>();
            _player.Configure(_selectedLoadout, combatant);
            UpdateHud();
        }

        private void SpawnBot(StrikeTeam team, int spawnIndex)
        {
            var root = new GameObject(team + " Operator");
            root.transform.position = SafeSpawn(team, spawnIndex);
            root.transform.rotation = Quaternion.LookRotation((Vector3.zero - root.transform.position).normalized);
            var controller = root.AddComponent<CharacterController>();
            controller.height = 1.8f;
            controller.radius = 0.38f;
            controller.center = new Vector3(0f, 0.9f, 0f);
            var combatant = root.AddComponent<StrikeCombatant>();
            combatant.Configure(team, false, 100f);
            var bot = root.AddComponent<StrikeBot>();
            bot.Configure(team, combatant);
            _bots.Add(bot);
        }

        private Vector3 SafeSpawn(StrikeTeam team, int index)
        {
            var set = team == StrikeTeam.Specter ? _specterSpawns : _helixSpawns;
            return set[Mathf.Abs(index) % set.Length];
        }

        public void HandleDeath(StrikeCombatant victim, StrikeTeam attacker)
        {
            if (!_matchRunning) return;
            if (attacker == StrikeTeam.Specter) _specterScore++;
            else _helixScore++;
            UpdateHud();

            if (_specterScore >= 20 || _helixScore >= 20)
            {
                EndMatch(_specterScore > _helixScore ? "SPECTER VICTORY" : "HELIX VICTORY");
                return;
            }

            if (victim.IsPlayer)
            {
                StartCoroutine(RespawnPlayer());
            }
            else
            {
                var oldBot = victim.GetComponent<StrikeBot>();
                if (oldBot != null) _bots.Remove(oldBot);
                var team = victim.Team;
                Destroy(victim.gameObject);
                StartCoroutine(RespawnBot(team));
            }
        }

        private IEnumerator RespawnPlayer()
        {
            _player.SetOperational(false);
            if (_statusText != null) _statusText.text = "REDEPLOYING...";
            yield return new WaitForSeconds(2.2f);
            _player.transform.position = SafeSpawn(StrikeTeam.Specter, Random.Range(0, 3));
            _player.transform.rotation = Quaternion.LookRotation((Vector3.zero - _player.transform.position).normalized);
            _player.Combatant.ResetHealth();
            _player.ResetWeapon();
            _player.SetOperational(true);
            if (_statusText != null) _statusText.text = "BLACKRIDGE COAST";
        }

        private IEnumerator RespawnBot(StrikeTeam team)
        {
            yield return new WaitForSeconds(2f);
            SpawnBot(team, Random.Range(0, 3));
        }

        private void EndMatch(string result)
        {
            if (!_matchRunning) return;
            _matchRunning = false;
            if (_player != null) _player.SetOperational(false);
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
            if (_statusText != null) _statusText.text = result + "  |  " + _specterScore + " - " + _helixScore;
        }

        private void CreateHud()
        {
            _hudCanvas = PhantomUi.Canvas("PhantomStrike HUD", 50);
            var top = PhantomUi.Panel("Score Rail", _hudCanvas.transform, new Color(0.025f, 0.032f, 0.038f, 0.9f), new Vector2(0.34f, 0.92f), new Vector2(0.66f, 0.985f), Vector2.zero, Vector2.zero, 8);
            _scoreText = PhantomUi.Text("Score", top, "0   SPECTER     HELIX   0", 18, Color.white, TextAnchor.MiddleCenter, FontStyle.Bold);
            PhantomUi.Place(_scoreText.rectTransform, Vector2.zero, new Vector2(0.78f, 1f), Vector2.zero, Vector2.zero);
            _timerText = PhantomUi.Text("Timer", top, "8:00", 18, new Color(0.75f, 0.8f, 0.82f), TextAnchor.MiddleCenter, FontStyle.Bold);
            PhantomUi.Place(_timerText.rectTransform, new Vector2(0.78f, 0f), Vector2.one, Vector2.zero, Vector2.zero);

            var status = PhantomUi.Panel("Status", _hudCanvas.transform, new Color(0.025f, 0.032f, 0.038f, 0.86f), new Vector2(0.025f, 0.035f), new Vector2(0.22f, 0.12f), Vector2.zero, Vector2.zero, 8);
            _statusText = PhantomUi.Text("Location", status, "BLACKRIDGE COAST", 15, _cyan, TextAnchor.MiddleLeft, FontStyle.Bold);
            PhantomUi.Place(_statusText.rectTransform, Vector2.zero, Vector2.one, new Vector2(18f, 0f), new Vector2(-12f, 0f));

            var vitals = PhantomUi.Panel("Vitals", _hudCanvas.transform, new Color(0.025f, 0.032f, 0.038f, 0.9f), new Vector2(0.025f, 0.13f), new Vector2(0.17f, 0.205f), Vector2.zero, Vector2.zero, 8);
            _healthText = PhantomUi.Text("Health", vitals, "100  ARMOR", 20, Color.white, TextAnchor.MiddleLeft, FontStyle.Bold);
            PhantomUi.Place(_healthText.rectTransform, Vector2.zero, Vector2.one, new Vector2(18f, 0f), new Vector2(-12f, 0f));

            var ammo = PhantomUi.Panel("Ammo", _hudCanvas.transform, new Color(0.025f, 0.032f, 0.038f, 0.9f), new Vector2(0.79f, 0.035f), new Vector2(0.975f, 0.14f), Vector2.zero, Vector2.zero, 8);
            _ammoText = PhantomUi.Text("Ammo Count", ammo, "30 / 120", 28, Color.white, TextAnchor.MiddleCenter, FontStyle.Bold);
            PhantomUi.Stretch(_ammoText.rectTransform, 8f);

            _crosshairText = PhantomUi.Text("Crosshair", _hudCanvas.transform, "+", 24, new Color(1f, 1f, 1f, 0.86f), TextAnchor.MiddleCenter, FontStyle.Bold);
            PhantomUi.Place(_crosshairText.rectTransform, new Vector2(0.485f, 0.475f), new Vector2(0.515f, 0.525f), Vector2.zero, Vector2.zero);

            var flash = new GameObject("Damage Flash", typeof(RectTransform), typeof(Image));
            flash.transform.SetParent(_hudCanvas.transform, false);
            _damageFlash = flash.GetComponent<Image>();
            _damageFlash.color = new Color(0.8f, 0.02f, 0.03f, 0f);
            _damageFlash.raycastTarget = false;
            PhantomUi.Stretch(flash.GetComponent<RectTransform>());
        }

        public void UpdateHud()
        {
            if (_player != null && _healthText != null) _healthText.text = Mathf.CeilToInt(_player.Combatant.Health) + "  ARMOR";
            if (_player != null && _ammoText != null) _ammoText.text = _player.Ammo + " / " + _player.ReserveAmmo;
            if (_scoreText != null) _scoreText.text = _specterScore + "   SPECTER     HELIX   " + _helixScore;
        }

        public void FlashDamage()
        {
            if (_damageFlash != null) _damageFlash.color = new Color(0.8f, 0.02f, 0.03f, 0.22f);
        }

        public void ConfirmPlayerHit(bool eliminated)
        {
            if (_crosshairText == null) return;
            _crosshairText.text = eliminated ? "X" : "x";
            _crosshairText.fontSize = eliminated ? 34 : 28;
            _crosshairText.color = eliminated ? new Color(1f, 0.22f, 0.18f) : Color.white;
            _hitMarkerClock = eliminated ? 0.24f : 0.13f;
        }
    }

    public sealed class StrikeCombatant : MonoBehaviour
    {
        public StrikeTeam Team { get; private set; }
        public bool IsPlayer { get; private set; }
        public float Health { get; private set; }
        public bool Alive { get; private set; }

        private float _maxHealth;

        public void Configure(StrikeTeam team, bool isPlayer, float health)
        {
            Team = team;
            IsPlayer = isPlayer;
            _maxHealth = health;
            ResetHealth();
        }

        public bool Damage(float amount, StrikeTeam attacker)
        {
            if (!Alive || attacker == Team) return false;
            Health = Mathf.Max(0f, Health - amount);
            if (IsPlayer) PhantomStrikeGame.Instance.FlashDamage();
            PhantomStrikeGame.Instance.UpdateHud();
            if (Health <= 0f)
            {
                Alive = false;
                PhantomStrikeGame.Instance.HandleDeath(this, attacker);
            }
            return true;
        }

        public void ResetHealth()
        {
            Health = _maxHealth;
            Alive = true;
            PhantomStrikeGame.Instance?.UpdateHud();
        }
    }

    public sealed class StrikePlayerController : MonoBehaviour
    {
        public StrikeCombatant Combatant { get; private set; }
        public int Ammo { get; private set; }
        public int ReserveAmmo { get; private set; }

        private CharacterController _controller;
        private Camera _camera;
        private Transform _weapon;
        private Transform _muzzle;
        private StrikeLoadout _loadout;
        private float _pitch;
        private float _verticalVelocity;
        private float _fireCooldown;
        private float _recoil;
        private int _magazine;
        private float _damage;
        private float _fireRate;
        private float _spread;
        private bool _reloading;
        private bool _operational = true;

        public void Configure(StrikeLoadout loadout, StrikeCombatant combatant)
        {
            _loadout = loadout;
            Combatant = combatant;
        }

        private void Start()
        {
            _controller = GetComponent<CharacterController>();
            ConfigureWeapon();
            CreateView();
            ResetWeapon();
        }

        private void ConfigureWeapon()
        {
            switch (_loadout)
            {
                case StrikeLoadout.Breacher:
                    _magazine = 36; _damage = 18f; _fireRate = 0.075f; _spread = 0.015f;
                    break;
                case StrikeLoadout.Marksman:
                    _magazine = 16; _damage = 42f; _fireRate = 0.22f; _spread = 0.003f;
                    break;
                default:
                    _magazine = 30; _damage = 27f; _fireRate = 0.105f; _spread = 0.007f;
                    break;
            }
        }

        private void CreateView()
        {
            var cameraObject = new GameObject("Combat Camera");
            cameraObject.transform.SetParent(transform, false);
            cameraObject.transform.localPosition = new Vector3(0f, 1.62f, 0f);
            _camera = cameraObject.AddComponent<Camera>();
            _camera.fieldOfView = 76f;
            _camera.nearClipPlane = 0.03f;
            _camera.farClipPlane = 240f;
            _camera.allowHDR = true;
            _camera.allowMSAA = true;
            cameraObject.AddComponent<AudioListener>();

            var weaponRoot = new GameObject("Weapon Viewmodel");
            weaponRoot.transform.SetParent(_camera.transform, false);
            weaponRoot.transform.localPosition = new Vector3(0.34f, -0.28f, 0.58f);
            weaponRoot.transform.localRotation = Quaternion.Euler(3f, -5f, 0f);
            _weapon = weaponRoot.transform;
            var gun = PhantomVisuals.Material("Strike weapon", new Color(0.07f, 0.075f, 0.08f), 0.75f, 0.44f);
            var accent = PhantomVisuals.Material("Strike weapon accent", new Color(0.13f, 0.48f, 0.42f), 0.55f, 0.58f, new Color(0.02f, 0.17f, 0.14f));
            var modelName = _loadout == StrikeLoadout.Breacher ? "SubmachineGun" : _loadout == StrikeLoadout.Marksman ? "SniperRifle" : "AssaultRifle";
            var weaponModel = PhantomVisuals.ResourceModel(
                "Models/Quaternius/Strike/" + modelName,
                modelName,
                weaponRoot.transform.position,
                weaponRoot.transform.rotation * Quaternion.Euler(0f, -90f, 0f),
                _loadout == StrikeLoadout.Marksman ? 1.15f : 0.92f,
                _weapon);
            if (weaponModel == null)
            {
                PhantomVisuals.DecorativePrimitive("Receiver", PrimitiveType.Cube, Vector3.zero, new Vector3(0.20f, 0.16f, 0.62f), gun, _weapon).transform.localPosition = Vector3.zero;
                PhantomVisuals.DecorativePrimitive("Barrel", PrimitiveType.Cylinder, Vector3.zero, new Vector3(0.035f, 0.28f, 0.035f), gun, _weapon).transform.SetLocalPositionAndRotation(new Vector3(0f, 0.02f, 0.46f), Quaternion.Euler(90f, 0f, 0f));
                PhantomVisuals.DecorativePrimitive("Optic", PrimitiveType.Cube, Vector3.zero, new Vector3(0.09f, 0.08f, 0.14f), accent, _weapon).transform.localPosition = new Vector3(0f, 0.11f, -0.02f);
            }
            else
            {
                PhantomVisuals.ApplyMaterial(weaponModel, gun);
                PhantomVisuals.DecorativePrimitive("Optic", PrimitiveType.Cube, Vector3.zero, new Vector3(0.08f, 0.07f, 0.13f), accent, _weapon).transform.localPosition = new Vector3(0f, 0.11f, 0.02f);
            }
            var muzzle = new GameObject("Muzzle");
            muzzle.transform.SetParent(_weapon, false);
            muzzle.transform.localPosition = new Vector3(0f, 0.015f, 0.56f);
            _muzzle = muzzle.transform;
        }

        private void Update()
        {
            if (!_operational) return;
            if (Input.GetKeyDown(KeyCode.Escape))
            {
                Cursor.lockState = CursorLockMode.None;
                Cursor.visible = true;
            }
            if (Input.GetMouseButtonDown(0) && Cursor.lockState != CursorLockMode.Locked)
            {
                Cursor.lockState = CursorLockMode.Locked;
                Cursor.visible = false;
                return;
            }

            Look();
            Move();
            WeaponUpdate();
        }

        private void Look()
        {
            if (Cursor.lockState != CursorLockMode.Locked) return;
            var sensitivity = 2.1f;
            var yaw = Input.GetAxisRaw("Mouse X") * sensitivity;
            var pitch = Input.GetAxisRaw("Mouse Y") * sensitivity;
            transform.Rotate(0f, yaw, 0f);
            _pitch = Mathf.Clamp(_pitch - pitch - _recoil, -82f, 82f);
            _camera.transform.localRotation = Quaternion.Euler(_pitch, 0f, 0f);
            _recoil = Mathf.MoveTowards(_recoil, 0f, Time.deltaTime * 4.2f);
        }

        private void Move()
        {
            var x = (Input.GetKey(KeyCode.D) ? 1f : 0f) - (Input.GetKey(KeyCode.A) ? 1f : 0f);
            var z = (Input.GetKey(KeyCode.W) ? 1f : 0f) - (Input.GetKey(KeyCode.S) ? 1f : 0f);
            var input = Vector3.ClampMagnitude(new Vector3(x, 0f, z), 1f);
            var crouching = Input.GetKey(KeyCode.C) || Input.GetKey(KeyCode.LeftControl);
            var sprinting = Input.GetKey(KeyCode.LeftShift) && z > 0f && !crouching;
            var speed = crouching ? 3.1f : sprinting ? 8.2f : 5.4f;
            _controller.height = Mathf.MoveTowards(_controller.height, crouching ? 1.15f : 1.8f, Time.deltaTime * 5f);
            _controller.center = new Vector3(0f, _controller.height * 0.5f, 0f);

            if (_controller.isGrounded)
            {
                _verticalVelocity = -2f;
                if (Input.GetKeyDown(KeyCode.Space) && !crouching) _verticalVelocity = 6.2f;
            }
            else
            {
                _verticalVelocity += Physics.gravity.y * Time.deltaTime;
            }

            var motion = transform.TransformDirection(input) * speed;
            motion.y = _verticalVelocity;
            _controller.Move(motion * Time.deltaTime);
        }

        private void WeaponUpdate()
        {
            _fireCooldown -= Time.deltaTime;
            var aiming = Input.GetMouseButton(1);
            _camera.fieldOfView = Mathf.Lerp(_camera.fieldOfView, aiming ? 52f : 76f, Time.deltaTime * 12f);
            _weapon.localPosition = Vector3.Lerp(_weapon.localPosition, aiming ? new Vector3(0f, -0.22f, 0.46f) : new Vector3(0.34f, -0.28f, 0.58f), Time.deltaTime * 12f);
            if (Input.GetKeyDown(KeyCode.R)) StartCoroutine(Reload());
            if (Input.GetMouseButton(0) && _fireCooldown <= 0f && !_reloading)
            {
                Fire(aiming);
            }
        }

        private void Fire(bool aiming)
        {
            if (Ammo <= 0)
            {
                StartCoroutine(Reload());
                return;
            }
            Ammo--;
            _fireCooldown = _fireRate;
            _recoil += _loadout == StrikeLoadout.Marksman ? 1.25f : 0.48f;
            _weapon.localRotation *= Quaternion.Euler(-2.2f, Random.Range(-0.4f, 0.4f), 0f);
            CreateMuzzleFlash();

            var spread = aiming ? _spread * 0.28f : _spread;
            var direction = (_camera.transform.forward + _camera.transform.right * Random.Range(-spread, spread) + _camera.transform.up * Random.Range(-spread, spread)).normalized;
            if (Physics.Raycast(_camera.transform.position, direction, out var hit, 180f, ~0, QueryTriggerInteraction.Ignore))
            {
                var target = hit.collider.GetComponentInParent<StrikeCombatant>();
                if (target != null)
                {
                    var eliminated = target.Alive && target.Team == StrikeTeam.Helix && target.Health <= _damage;
                    if (target.Damage(_damage, StrikeTeam.Specter)) PhantomStrikeGame.Instance.ConfirmPlayerHit(eliminated);
                }
                var impact = PhantomVisuals.DecorativePrimitive(
                    "Ballistic impact",
                    PrimitiveType.Sphere,
                    hit.point + hit.normal * 0.025f,
                    Vector3.one * 0.07f,
                    PhantomVisuals.Material("Strike impact", new Color(1f, 0.72f, 0.2f), 0.1f, 0.8f, new Color(1f, 0.26f, 0.02f)));
                Destroy(impact, 0.16f);
            }
            PhantomStrikeGame.Instance.UpdateHud();
        }

        private void CreateMuzzleFlash()
        {
            if (_muzzle == null) return;
            var flash = PhantomVisuals.DecorativePrimitive(
                "Muzzle flash",
                PrimitiveType.Sphere,
                _muzzle.position,
                new Vector3(0.06f, 0.06f, 0.18f),
                PhantomVisuals.Material("Strike muzzle flash", new Color(1f, 0.66f, 0.18f), 0f, 0.9f, new Color(1f, 0.22f, 0.01f)));
            var light = PhantomVisuals.PointLight("Muzzle light", _muzzle.position, new Color(1f, 0.42f, 0.12f), 3.8f, 5f);
            Destroy(flash, 0.055f);
            Destroy(light.gameObject, 0.055f);
        }

        private IEnumerator Reload()
        {
            if (_reloading || Ammo >= _magazine || ReserveAmmo <= 0) yield break;
            _reloading = true;
            yield return new WaitForSeconds(_loadout == StrikeLoadout.Marksman ? 2.1f : 1.55f);
            var needed = _magazine - Ammo;
            var moved = Mathf.Min(needed, ReserveAmmo);
            Ammo += moved;
            ReserveAmmo -= moved;
            _reloading = false;
            PhantomStrikeGame.Instance.UpdateHud();
        }

        public void ResetWeapon()
        {
            Ammo = _magazine;
            ReserveAmmo = _magazine * 4;
            _reloading = false;
            PhantomStrikeGame.Instance?.UpdateHud();
        }

        public void SetOperational(bool enabled)
        {
            _operational = enabled;
            if (_controller != null) _controller.enabled = enabled;
        }
    }

    public sealed class StrikeBot : MonoBehaviour
    {
        private StrikeTeam _team;
        private StrikeCombatant _combatant;
        private CharacterController _controller;
        private Transform _visual;
        private float _fireCooldown;
        private float _decisionCooldown;
        private Vector3 _roamTarget;

        public void Configure(StrikeTeam team, StrikeCombatant combatant)
        {
            _team = team;
            _combatant = combatant;
        }

        private void Start()
        {
            _controller = GetComponent<CharacterController>();
            CreateVisual();
            PickRoamTarget();
        }

        private void CreateVisual()
        {
            var color = _team == StrikeTeam.Specter ? new Color(0.10f, 0.64f, 0.58f) : new Color(0.68f, 0.10f, 0.12f);
            var armor = PhantomVisuals.Material("Strike bot " + _team, color, 0.62f, 0.32f, color * 0.14f);
            var dark = PhantomVisuals.Material("Strike bot dark", new Color(0.045f, 0.05f, 0.055f), 0.5f, 0.25f);
            var root = new GameObject("Operator Visual");
            root.transform.SetParent(transform, false);
            _visual = root.transform;
            PhantomVisuals.DecorativePrimitive("Torso", PrimitiveType.Capsule, Vector3.zero, new Vector3(0.75f, 0.75f, 0.55f), armor, _visual).transform.localPosition = new Vector3(0f, 1.1f, 0f);
            PhantomVisuals.DecorativePrimitive("Helmet", PrimitiveType.Sphere, Vector3.zero, new Vector3(0.48f, 0.42f, 0.48f), dark, _visual).transform.localPosition = new Vector3(0f, 1.85f, 0f);
            var rifle = PhantomVisuals.ResourceModel(
                "Models/Quaternius/Strike/AssaultRifle",
                "Operator rifle",
                transform.TransformPoint(new Vector3(0.3f, 1.2f, 0.32f)),
                transform.rotation * Quaternion.Euler(0f, -90f, 0f),
                0.9f,
                _visual);
            if (rifle == null)
            {
                PhantomVisuals.DecorativePrimitive("Rifle", PrimitiveType.Cube, Vector3.zero, new Vector3(0.12f, 0.12f, 0.82f), dark, _visual).transform.localPosition = new Vector3(0.3f, 1.2f, 0.32f);
            }
            else
            {
                PhantomVisuals.ApplyMaterial(rifle, dark);
            }
        }

        private void Update()
        {
            if (!_combatant.Alive) return;
            _fireCooldown -= Time.deltaTime;
            _decisionCooldown -= Time.deltaTime;
            var target = FindTarget();
            if (target != null)
            {
                var delta = target.transform.position - transform.position;
                var flat = new Vector3(delta.x, 0f, delta.z);
                if (flat.sqrMagnitude > 0.1f) transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(flat), Time.deltaTime * 5f);
                var eye = transform.position + Vector3.up * 1.45f;
                var targetPoint = target.transform.position + Vector3.up * 1.05f;
                var visible = Physics.Raycast(eye, (targetPoint - eye).normalized, out var hit, 55f) && hit.collider.GetComponentInParent<StrikeCombatant>() == target;
                if (visible && flat.magnitude < 48f)
                {
                    if (_fireCooldown <= 0f)
                    {
                        target.Damage(Random.Range(7f, 12f), _team);
                        _fireCooldown = Random.Range(0.36f, 0.7f);
                    }
                    if (flat.magnitude > 16f) _controller.Move(flat.normalized * (3.4f * Time.deltaTime));
                }
                else
                {
                    _controller.Move(flat.normalized * (3.8f * Time.deltaTime));
                }
            }
            else
            {
                Roam();
            }
            _controller.Move(Vector3.down * (4f * Time.deltaTime));
        }

        private StrikeCombatant FindTarget()
        {
            StrikeCombatant best = null;
            var bestDistance = float.MaxValue;
            var all = UnityEngine.Object.FindObjectsByType<StrikeCombatant>(FindObjectsSortMode.None);
            foreach (var item in all)
            {
                if (!item.Alive || item.Team == _team) continue;
                var distance = (item.transform.position - transform.position).sqrMagnitude;
                if (distance < bestDistance)
                {
                    best = item;
                    bestDistance = distance;
                }
            }
            return best;
        }

        private void Roam()
        {
            var delta = _roamTarget - transform.position;
            delta.y = 0f;
            if (delta.magnitude < 3f || _decisionCooldown <= 0f) PickRoamTarget();
            if (delta.sqrMagnitude > 0.1f)
            {
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(delta), Time.deltaTime * 3f);
                _controller.Move(delta.normalized * (3.2f * Time.deltaTime));
            }
        }

        private void PickRoamTarget()
        {
            _roamTarget = new Vector3(Random.Range(-44f, 44f), 0f, Random.Range(-44f, 44f));
            _decisionCooldown = Random.Range(3f, 7f);
        }
    }
}

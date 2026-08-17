using System.Collections;
using System.Collections.Generic;
using PhantomForge.Core;
using UnityEngine;
using UnityEngine.UI;

namespace PhantomForge.Ages
{
    public enum AgesSide
    {
        Player,
        Enemy
    }

    public enum AgesUnitType
    {
        Clubman,
        SpearHunter,
        FireArcher,
        Swordsman,
        Cavalry,
        Catapult,
        Springald,
        Dragon
    }

    public enum AgesUpgradePath
    {
        TroopArmor,
        InfantryDamage,
        RangedDamage,
        SiegeEngineering,
        MarchSpeed,
        WarEconomy
    }

    public sealed class PhantomAgesGame : MonoBehaviour
    {
        public const string GameId = "phantom-ages";
        public const string SaveNamespace = "phantomages.";

        public static PhantomAgesGame Instance { get; private set; }

        private static readonly string[] AgeNames =
        {
            "STONE AGE",
            "BRONZE AGE",
            "IRON AGE",
            "MEDIEVAL AGE",
            "FUTURE AGE",
            "PHANTOM AGE"
        };

        private static readonly string[] AgePeriods =
        {
            "c. 10,000-3,000 BCE",
            "c. 3,300-1,200 BCE",
            "c. 1,200-550 BCE",
            "c. 500-1500 CE",
            "c. 2080 CE",
            "BEYOND RECORDED TIME"
        };

        private static readonly string[] FieldNotes =
        {
            "Cavepeople fight with hardwood clubs, knapped stone points, hide armor, spears, and controlled fire.",
            "Bronze casting supports tougher blades, fitted shields, organized ranks, and fortified timber-and-stone keeps.",
            "Iron tools strengthen weapons, siege frames, agricultural output, roads, and disciplined standing armies.",
            "Castles, longbows, cavalry, counterweight siege engines, and specialized formations define the medieval field.",
            "Composite armor, autonomous targeting, energy weapons, and powered logistics reshape the battlefield.",
            "Phantom technology bends matter, summons aerial war beasts, and turns the tower itself into a living weapon."
        };

        private static readonly int[] AdvanceCosts = { 180, 310, 520, 820, 1280 };

        private readonly List<AgesLaneUnit> _units = new List<AgesLaneUnit>();
        private readonly Dictionary<AgesUpgradePath, int> _upgrades = new Dictionary<AgesUpgradePath, int>();
        private readonly Dictionary<AgesUpgradePath, Button> _upgradeButtons = new Dictionary<AgesUpgradePath, Button>();
        private readonly Dictionary<AgesUnitType, Button> _unitButtons = new Dictionary<AgesUnitType, Button>();

        private readonly Color _playerColor = new Color(0.08f, 0.75f, 1f, 1f);
        private readonly Color _enemyColor = new Color(1f, 0.20f, 0.27f, 1f);
        private readonly Color _goldColor = new Color(1f, 0.72f, 0.18f, 1f);
        private readonly Color _panelColor = new Color(0.018f, 0.035f, 0.065f, 0.96f);

        private Canvas _titleCanvas;
        private Canvas _hudCanvas;
        private Canvas _resultCanvas;
        private Transform _worldRoot;
        private Transform _backdrop;
        private Camera _camera;
        private AgesTower _playerTower;
        private AgesTower _enemyTower;
        private Text _goldText;
        private Text _ageText;
        private Text _enemyAgeText;
        private Text _fieldNoteText;
        private Text _overchargeText;
        private Text _advanceText;
        private Text _speedText;
        private Image _playerTowerFill;
        private Image _enemyTowerFill;
        private Button _advanceButton;
        private Button _overchargeButton;
        private bool _running;
        private bool _ended;
        private int _playerAge;
        private int _enemyAge;
        private int _gold;
        private float _goldFraction;
        private float _enemyGold;
        private float _enemyThink;
        private float _overchargeCooldown;
        private float _backdropAspect;
        private int _victories;

        public bool Running => _running && !_ended;
        public int PlayerAge => _playerAge;
        public int EnemyAge => _enemyAge;
        public Transform WorldRoot => _worldRoot;

        private void Awake()
        {
            Instance = this;
            foreach (AgesUpgradePath path in System.Enum.GetValues(typeof(AgesUpgradePath)))
            {
                _upgrades[path] = 0;
            }
            _victories = PlayerPrefs.GetInt(SaveNamespace + "victories", 0);
        }

        private void Start()
        {
            Application.targetFrameRate = 120;
            CreateTitleScreen();
            if (PhantomSmokeCapture.Enabled)
            {
                StartCoroutine(PhantomSmokeCapture.Run("Enter", GameId));
            }
        }

        private void Update()
        {
            if (!Running) return;
            HandleHotkeys();
            UpdateEconomy();
            UpdateEnemyCommander();
            UpdateHud();
            UpdateBackdropScale();
        }

        private void OnDestroy()
        {
            Time.timeScale = 1f;
            if (Instance == this) Instance = null;
        }

        private void CreateTitleScreen()
        {
            _titleCanvas = PhantomUi.Canvas("Phantom Ages Title", 100);
            var background = new GameObject("Battlefield Key Art", typeof(RectTransform), typeof(Image));
            background.transform.SetParent(_titleCanvas.transform, false);
            var backgroundImage = background.GetComponent<Image>();
            backgroundImage.sprite = PhantomVisuals.ResourceSprite("Art/phantom-ages-keyart");
            backgroundImage.color = backgroundImage.sprite == null ? new Color(0.02f, 0.06f, 0.10f, 1f) : Color.white;
            backgroundImage.preserveAspect = false;
            PhantomUi.Stretch(background.GetComponent<RectTransform>());

            var shade = PhantomUi.Panel("Cinematic Shade", _titleCanvas.transform, new Color(0.005f, 0.012f, 0.025f, 0.46f), Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, 0);
            var logo = PhantomUi.Text("Logo", shade, "PHANTOM AGES", 72, Color.white, TextAnchor.MiddleCenter, FontStyle.Bold);
            PhantomUi.Place(logo.rectTransform, new Vector2(0.20f, 0.70f), new Vector2(0.80f, 0.84f), Vector2.zero, Vector2.zero);
            var subtitle = PhantomUi.Text("Subtitle", shade, "AGE-TO-AGE LANE WARFARE", 21, _playerColor, TextAnchor.MiddleCenter, FontStyle.Bold);
            PhantomUi.Place(subtitle.rectTransform, new Vector2(0.28f, 0.64f), new Vector2(0.72f, 0.70f), Vector2.zero, Vector2.zero);
            var promise = PhantomUi.Text("Promise", shade, "Build the front line. Protect the ranged ranks. Counter siege. Evolve the tower.", 18, new Color(0.86f, 0.91f, 0.96f), TextAnchor.MiddleCenter);
            PhantomUi.Place(promise.rectTransform, new Vector2(0.20f, 0.54f), new Vector2(0.80f, 0.62f), Vector2.zero, Vector2.zero);
            var play = PhantomUi.Button("Enter Battle", shade, "ENTER THE STONE AGE", new Color(0.02f, 0.52f, 0.78f, 0.98f), Color.white, StartBattle);
            PhantomUi.Place(play.GetComponent<RectTransform>(), new Vector2(0.38f, 0.14f), new Vector2(0.62f, 0.22f), Vector2.zero, Vector2.zero);
            var record = PhantomUi.Text("Record", shade, "CAMPAIGN VICTORIES  " + _victories, 14, new Color(0.78f, 0.84f, 0.90f), TextAnchor.MiddleCenter, FontStyle.Bold);
            PhantomUi.Place(record.rectTransform, new Vector2(0.38f, 0.09f), new Vector2(0.62f, 0.13f), Vector2.zero, Vector2.zero);
        }

        private void StartBattle()
        {
            if (_titleCanvas != null) Destroy(_titleCanvas.gameObject);
            _playerAge = 0;
            _enemyAge = 0;
            _gold = 220;
            _goldFraction = 0f;
            _enemyGold = 220f;
            _enemyThink = 1.1f;
            _overchargeCooldown = 0f;
            _ended = false;
            _running = true;
            Time.timeScale = 1f;
            foreach (AgesUpgradePath path in System.Enum.GetValues(typeof(AgesUpgradePath))) _upgrades[path] = 0;

            CreateWorld();
            CreateHud();
            _playerTower = AgesTower.Create(this, AgesSide.Player, new Vector3(-8.1f, -1.85f, 0f));
            _enemyTower = AgesTower.Create(this, AgesSide.Enemy, new Vector3(8.1f, -1.85f, 0f));
            SpawnUnit(AgesSide.Player, AgesUnitType.Clubman);
            SpawnUnit(AgesSide.Player, AgesUnitType.SpearHunter);
            SpawnUnit(AgesSide.Enemy, AgesUnitType.Clubman);
            SpawnUnit(AgesSide.Enemy, AgesUnitType.SpearHunter);
            UpdateHud();
        }

        private void CreateWorld()
        {
            var world = new GameObject("Phantom Ages Fixed Lane");
            world.transform.SetParent(transform, false);
            _worldRoot = world.transform;

            RenderSettings.fog = false;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.72f, 0.78f, 0.86f);
            RenderSettings.ambientEquatorColor = new Color(0.47f, 0.51f, 0.58f);
            RenderSettings.ambientGroundColor = new Color(0.20f, 0.23f, 0.28f);

            var cameraObject = new GameObject("Fixed Battlefield Camera");
            cameraObject.transform.SetParent(_worldRoot, false);
            _camera = cameraObject.AddComponent<Camera>();
            _camera.orthographic = true;
            _camera.orthographicSize = 5.4f;
            _camera.clearFlags = CameraClearFlags.SolidColor;
            _camera.backgroundColor = new Color(0.015f, 0.03f, 0.06f);
            _camera.nearClipPlane = 0.1f;
            _camera.farClipPlane = 40f;
            _camera.transform.position = new Vector3(0f, 0f, -12f);
            _camera.transform.rotation = Quaternion.identity;
            _camera.tag = "MainCamera";

            var sunObject = new GameObject("Battlefield Sun");
            sunObject.transform.SetParent(_worldRoot, false);
            var sun = sunObject.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = new Color(0.95f, 0.94f, 1f);
            sun.intensity = 1.18f;
            sun.shadows = LightShadows.Soft;
            sun.transform.rotation = Quaternion.Euler(28f, -32f, 0f);

            var sprite = PhantomVisuals.ResourceSprite("Art/phantom-ages-keyart");
            if (sprite != null)
            {
                var backdropObject = new GameObject("Illustrated Age Battlefield", typeof(SpriteRenderer));
                backdropObject.transform.SetParent(_worldRoot, false);
                _backdrop = backdropObject.transform;
                _backdrop.position = new Vector3(0f, 0f, 5f);
                var renderer = backdropObject.GetComponent<SpriteRenderer>();
                renderer.sprite = sprite;
                renderer.sortingOrder = -100;
                UpdateBackdropScale(true);
            }

            var groundMaterial = PhantomVisuals.Material("Ages lane ground", new Color(0.055f, 0.10f, 0.13f, 1f), 0.05f, 0.22f);
            PhantomVisuals.DecorativePrimitive("Battle Lane", PrimitiveType.Cube, new Vector3(0f, -2.35f, 1.2f), new Vector3(19.4f, 0.30f, 0.40f), groundMaterial, _worldRoot);
            var edgeMaterial = PhantomVisuals.Material("Ages lane edge", new Color(0.18f, 0.66f, 0.78f, 1f), 0.18f, 0.74f, new Color(0.02f, 0.20f, 0.28f));
            PhantomVisuals.DecorativePrimitive("Lane Edge", PrimitiveType.Cube, new Vector3(0f, -2.04f, 0.95f), new Vector3(19.4f, 0.035f, 0.08f), edgeMaterial, _worldRoot);
        }

        private void UpdateBackdropScale(bool force = false)
        {
            if (_backdrop == null || _camera == null) return;
            var aspect = Mathf.Max(0.1f, _camera.aspect);
            if (!force && Mathf.Abs(aspect - _backdropAspect) < 0.001f) return;
            _backdropAspect = aspect;
            var renderer = _backdrop.GetComponent<SpriteRenderer>();
            if (renderer == null || renderer.sprite == null) return;
            var desiredHeight = _camera.orthographicSize * 2f;
            var desiredWidth = desiredHeight * aspect;
            var spriteSize = renderer.sprite.bounds.size;
            _backdrop.localScale = new Vector3(desiredWidth / spriteSize.x, desiredHeight / spriteSize.y, 1f);
        }

        private void CreateHud()
        {
            _hudCanvas = PhantomUi.Canvas("Phantom Ages Command HUD", 60);
            var top = PhantomUi.Panel("Top Command", _hudCanvas.transform, new Color(0.012f, 0.025f, 0.048f, 0.95f), new Vector2(0f, 0.86f), Vector2.one, Vector2.zero, Vector2.zero, 0);

            var title = PhantomUi.Text("Game Title", top, "PHANTOM AGES", 30, Color.white, TextAnchor.MiddleLeft, FontStyle.Bold);
            PhantomUi.Place(title.rectTransform, new Vector2(0.018f, 0.46f), new Vector2(0.19f, 0.96f), Vector2.zero, Vector2.zero);
            var edition = PhantomUi.Text("Edition", top, "UNITY LANE WARFARE", 12, _playerColor, TextAnchor.MiddleLeft, FontStyle.Bold);
            PhantomUi.Place(edition.rectTransform, new Vector2(0.019f, 0.13f), new Vector2(0.19f, 0.48f), Vector2.zero, Vector2.zero);

            _playerTowerFill = CreateHudHealthBar(top, "Your Tower", new Vector2(0.20f, 0.52f), new Vector2(0.39f, 0.82f), _playerColor);
            _enemyTowerFill = CreateHudHealthBar(top, "Enemy Tower", new Vector2(0.61f, 0.52f), new Vector2(0.80f, 0.82f), _enemyColor);

            _ageText = PhantomUi.Text("Age", top, "", 25, new Color(1f, 0.68f, 0.25f), TextAnchor.MiddleCenter, FontStyle.Bold);
            PhantomUi.Place(_ageText.rectTransform, new Vector2(0.39f, 0.50f), new Vector2(0.61f, 0.95f), Vector2.zero, Vector2.zero);
            _enemyAgeText = PhantomUi.Text("Enemy Age", top, "", 11, new Color(0.94f, 0.76f, 0.72f), TextAnchor.UpperCenter, FontStyle.Bold);
            PhantomUi.Place(_enemyAgeText.rectTransform, new Vector2(0.42f, 0.30f), new Vector2(0.58f, 0.54f), Vector2.zero, Vector2.zero);
            _fieldNoteText = PhantomUi.Text("Field Note", top, "", 13, new Color(0.76f, 0.82f, 0.87f), TextAnchor.LowerCenter);
            PhantomUi.Place(_fieldNoteText.rectTransform, new Vector2(0.20f, 0.02f), new Vector2(0.80f, 0.34f), Vector2.zero, Vector2.zero);
            _goldText = PhantomUi.Text("Treasury", top, "", 27, _goldColor, TextAnchor.MiddleCenter, FontStyle.Bold);
            PhantomUi.Place(_goldText.rectTransform, new Vector2(0.81f, 0.28f), new Vector2(0.98f, 0.90f), Vector2.zero, Vector2.zero);

            var bottom = PhantomUi.Panel("Battle Deck", _hudCanvas.transform, _panelColor, Vector2.zero, new Vector2(1f, 0.30f), Vector2.zero, Vector2.zero, 0);
            var deployHeader = PhantomUi.Text("Deploy Header", bottom, "DEPLOY ARMY  [1-8]", 12, new Color(0.58f, 0.77f, 0.82f), TextAnchor.MiddleLeft, FontStyle.Bold);
            PhantomUi.Place(deployHeader.rectTransform, new Vector2(0.02f, 0.88f), new Vector2(0.76f, 0.98f), Vector2.zero, Vector2.zero);

            var unitRow = new GameObject("Unit Cards", typeof(RectTransform), typeof(HorizontalLayoutGroup));
            unitRow.transform.SetParent(bottom, false);
            PhantomUi.Place(unitRow.GetComponent<RectTransform>(), new Vector2(0.02f, 0.51f), new Vector2(0.76f, 0.88f), Vector2.zero, Vector2.zero);
            var unitLayout = unitRow.GetComponent<HorizontalLayoutGroup>();
            unitLayout.spacing = 8f;
            unitLayout.childControlWidth = true;
            unitLayout.childControlHeight = true;
            unitLayout.childForceExpandWidth = true;
            unitLayout.childForceExpandHeight = true;
            AddUnitButton(unitRow.transform, AgesUnitType.Clubman, "1");
            AddUnitButton(unitRow.transform, AgesUnitType.SpearHunter, "2");
            AddUnitButton(unitRow.transform, AgesUnitType.FireArcher, "3");
            AddUnitButton(unitRow.transform, AgesUnitType.Swordsman, "4");
            AddUnitButton(unitRow.transform, AgesUnitType.Cavalry, "5");
            AddUnitButton(unitRow.transform, AgesUnitType.Catapult, "6");
            AddUnitButton(unitRow.transform, AgesUnitType.Springald, "7");
            AddUnitButton(unitRow.transform, AgesUnitType.Dragon, "8");

            var researchHeader = PhantomUi.Text("Research Header", bottom, "ARMY RESEARCH - VISIBLE TROOP PATHS  [Q / W / E / R / T / Y]", 12, new Color(0.58f, 0.77f, 0.82f), TextAnchor.MiddleLeft, FontStyle.Bold);
            PhantomUi.Place(researchHeader.rectTransform, new Vector2(0.02f, 0.40f), new Vector2(0.98f, 0.50f), Vector2.zero, Vector2.zero);

            var upgradeRow = new GameObject("Upgrade Paths", typeof(RectTransform), typeof(HorizontalLayoutGroup));
            upgradeRow.transform.SetParent(bottom, false);
            PhantomUi.Place(upgradeRow.GetComponent<RectTransform>(), new Vector2(0.02f, 0.06f), new Vector2(0.98f, 0.39f), Vector2.zero, Vector2.zero);
            var upgradeLayout = upgradeRow.GetComponent<HorizontalLayoutGroup>();
            upgradeLayout.spacing = 10f;
            upgradeLayout.childControlWidth = true;
            upgradeLayout.childControlHeight = true;
            upgradeLayout.childForceExpandWidth = true;
            upgradeLayout.childForceExpandHeight = true;
            AddUpgradeButton(upgradeRow.transform, AgesUpgradePath.TroopArmor, "Q");
            AddUpgradeButton(upgradeRow.transform, AgesUpgradePath.InfantryDamage, "W");
            AddUpgradeButton(upgradeRow.transform, AgesUpgradePath.RangedDamage, "E");
            AddUpgradeButton(upgradeRow.transform, AgesUpgradePath.SiegeEngineering, "R");
            AddUpgradeButton(upgradeRow.transform, AgesUpgradePath.MarchSpeed, "T");
            AddUpgradeButton(upgradeRow.transform, AgesUpgradePath.WarEconomy, "Y");

            var actionPanel = PhantomUi.Panel("Battle Actions", bottom, new Color(0.025f, 0.055f, 0.082f, 0.94f), new Vector2(0.77f, 0.51f), new Vector2(0.98f, 0.94f), Vector2.zero, Vector2.zero, 8);
            _advanceButton = PhantomUi.Button("Advance Age", actionPanel, "ADVANCE AGE [A]", new Color(0.46f, 0.28f, 0.08f), Color.white, AdvanceAge);
            PhantomUi.Place(_advanceButton.GetComponent<RectTransform>(), new Vector2(0.03f, 0.62f), new Vector2(0.97f, 0.96f), Vector2.zero, Vector2.zero);
            _advanceText = _advanceButton.GetComponentInChildren<Text>();
            _overchargeButton = PhantomUi.Button("Tower Pulse", actionPanel, "TOWER PULSE [SPACE]", new Color(0.02f, 0.37f, 0.54f), Color.white, TriggerOvercharge);
            PhantomUi.Place(_overchargeButton.GetComponent<RectTransform>(), new Vector2(0.03f, 0.24f), new Vector2(0.97f, 0.58f), Vector2.zero, Vector2.zero);
            _overchargeText = _overchargeButton.GetComponentInChildren<Text>();

            var speedOne = PhantomUi.Button("Speed 1", actionPanel, "1x", new Color(0.08f, 0.14f, 0.19f), Color.white, () => SetGameSpeed(1f));
            PhantomUi.Place(speedOne.GetComponent<RectTransform>(), new Vector2(0.03f, 0.02f), new Vector2(0.25f, 0.20f), Vector2.zero, Vector2.zero);
            var speedTwo = PhantomUi.Button("Speed 2", actionPanel, "2x", new Color(0.08f, 0.14f, 0.19f), Color.white, () => SetGameSpeed(2f));
            PhantomUi.Place(speedTwo.GetComponent<RectTransform>(), new Vector2(0.28f, 0.02f), new Vector2(0.50f, 0.20f), Vector2.zero, Vector2.zero);
            var speedFour = PhantomUi.Button("Speed 4", actionPanel, "4x", new Color(0.08f, 0.14f, 0.19f), Color.white, () => SetGameSpeed(4f));
            PhantomUi.Place(speedFour.GetComponent<RectTransform>(), new Vector2(0.53f, 0.02f), new Vector2(0.75f, 0.20f), Vector2.zero, Vector2.zero);
            _speedText = PhantomUi.Text("Current Speed", actionPanel, "1x", 12, _playerColor, TextAnchor.MiddleCenter, FontStyle.Bold);
            PhantomUi.Place(_speedText.rectTransform, new Vector2(0.77f, 0.02f), new Vector2(0.97f, 0.20f), Vector2.zero, Vector2.zero);
        }

        private Image CreateHudHealthBar(Transform parent, string label, Vector2 anchorMin, Vector2 anchorMax, Color color)
        {
            var panel = PhantomUi.Panel(label + " Panel", parent, new Color(0.03f, 0.08f, 0.12f, 0.98f), anchorMin, anchorMax, Vector2.zero, Vector2.zero, 6);
            var caption = PhantomUi.Text(label + " Label", panel, label.ToUpperInvariant(), 11, new Color(0.72f, 0.79f, 0.84f), TextAnchor.UpperLeft, FontStyle.Bold);
            PhantomUi.Place(caption.rectTransform, new Vector2(0.03f, 0.52f), new Vector2(0.97f, 0.98f), Vector2.zero, Vector2.zero);
            var track = PhantomUi.Panel(label + " Track", panel, new Color(0.09f, 0.14f, 0.18f, 1f), new Vector2(0.03f, 0.14f), new Vector2(0.97f, 0.50f), Vector2.zero, Vector2.zero, 4);
            var fillObject = new GameObject(label + " Fill", typeof(RectTransform), typeof(Image));
            fillObject.transform.SetParent(track, false);
            var fill = fillObject.GetComponent<Image>();
            fill.color = color;
            fill.type = Image.Type.Filled;
            fill.fillMethod = Image.FillMethod.Horizontal;
            fill.fillOrigin = 0;
            fill.fillAmount = 1f;
            PhantomUi.Stretch(fillObject.GetComponent<RectTransform>());
            return fill;
        }

        private void AddUnitButton(Transform parent, AgesUnitType type, string key)
        {
            var button = PhantomUi.Button(type.ToString(), parent, "", new Color(0.045f, 0.13f, 0.17f), Color.white, () => TryDeploy(type));
            button.GetComponentInChildren<Text>().fontSize = 12;
            button.gameObject.AddComponent<LayoutElement>().minHeight = 74f;
            _unitButtons[type] = button;
            UpdateUnitButton(type, key);
        }

        private void AddUpgradeButton(Transform parent, AgesUpgradePath path, string key)
        {
            var button = PhantomUi.Button(path.ToString(), parent, "", new Color(0.12f, 0.09f, 0.045f), new Color(1f, 0.88f, 0.65f), () => PurchaseUpgrade(path));
            button.GetComponentInChildren<Text>().fontSize = 12;
            button.gameObject.AddComponent<LayoutElement>().minHeight = 70f;
            _upgradeButtons[path] = button;
            UpdateUpgradeButton(path, key);
        }

        private void HandleHotkeys()
        {
            if (Input.GetKeyDown(KeyCode.Alpha1)) TryDeploy(AgesUnitType.Clubman);
            if (Input.GetKeyDown(KeyCode.Alpha2)) TryDeploy(AgesUnitType.SpearHunter);
            if (Input.GetKeyDown(KeyCode.Alpha3)) TryDeploy(AgesUnitType.FireArcher);
            if (Input.GetKeyDown(KeyCode.Alpha4)) TryDeploy(AgesUnitType.Swordsman);
            if (Input.GetKeyDown(KeyCode.Alpha5)) TryDeploy(AgesUnitType.Cavalry);
            if (Input.GetKeyDown(KeyCode.Alpha6)) TryDeploy(AgesUnitType.Catapult);
            if (Input.GetKeyDown(KeyCode.Alpha7)) TryDeploy(AgesUnitType.Springald);
            if (Input.GetKeyDown(KeyCode.Alpha8)) TryDeploy(AgesUnitType.Dragon);
            if (Input.GetKeyDown(KeyCode.Q)) PurchaseUpgrade(AgesUpgradePath.TroopArmor);
            if (Input.GetKeyDown(KeyCode.W)) PurchaseUpgrade(AgesUpgradePath.InfantryDamage);
            if (Input.GetKeyDown(KeyCode.E)) PurchaseUpgrade(AgesUpgradePath.RangedDamage);
            if (Input.GetKeyDown(KeyCode.R)) PurchaseUpgrade(AgesUpgradePath.SiegeEngineering);
            if (Input.GetKeyDown(KeyCode.T)) PurchaseUpgrade(AgesUpgradePath.MarchSpeed);
            if (Input.GetKeyDown(KeyCode.Y)) PurchaseUpgrade(AgesUpgradePath.WarEconomy);
            if (Input.GetKeyDown(KeyCode.A)) AdvanceAge();
            if (Input.GetKeyDown(KeyCode.Space)) TriggerOvercharge();
        }

        private void UpdateEconomy()
        {
            var income = 9f + UpgradeLevel(AgesUpgradePath.WarEconomy) * 2.5f + _playerAge * 1.4f;
            _goldFraction += income * Time.deltaTime;
            if (_goldFraction >= 1f)
            {
                var gained = Mathf.FloorToInt(_goldFraction);
                _gold += gained;
                _goldFraction -= gained;
            }

            _enemyGold += (10.5f + _enemyAge * 1.7f) * Time.deltaTime;
            _enemyThink -= Time.deltaTime;
            _overchargeCooldown = Mathf.Max(0f, _overchargeCooldown - Time.deltaTime);
        }

        private void UpdateEnemyCommander()
        {
            if (_enemyThink > 0f) return;
            _enemyThink = Random.Range(1.15f, 2.15f);

            if (_enemyAge < AgeNames.Length - 1 && _enemyGold >= AdvanceCosts[_enemyAge] * 1.06f && (_enemyAge < _playerAge || Random.value < 0.22f))
            {
                _enemyGold -= AdvanceCosts[_enemyAge] * 1.06f;
                _enemyAge++;
                _enemyTower.SetAge(_enemyAge);
                RefreshUnits(AgesSide.Enemy);
                return;
            }

            var choice = ChooseEnemyUnit();
            var spec = AgesUnitCatalog.Get(choice);
            var cost = ScaledUnitCost(spec, _enemyAge);
            if (_enemyGold < cost)
            {
                _enemyThink = 0.65f;
                return;
            }
            _enemyGold -= cost;
            SpawnUnit(AgesSide.Enemy, choice);
        }

        private AgesUnitType ChooseEnemyUnit()
        {
            var playerHasSiege = false;
            var playerRanged = 0;
            var playerMelee = 0;
            foreach (var unit in _units)
            {
                if (unit == null || !unit.IsAlive || unit.Side != AgesSide.Player) continue;
                if (unit.IsSiege) playerHasSiege = true;
                else if (unit.FormationRank == 1) playerRanged++;
                else playerMelee++;
            }

            if (_enemyAge >= 2 && playerHasSiege && Random.value < 0.60f) return AgesUnitType.Springald;
            if (_enemyAge >= 2 && playerRanged > playerMelee && Random.value < 0.52f) return AgesUnitType.Cavalry;
            if (_enemyAge >= 2 && Random.value < 0.18f) return AgesUnitType.Catapult;
            if (_enemyAge >= 4 && Random.value < 0.08f) return AgesUnitType.Dragon;
            if (_enemyAge >= 1 && Random.value < 0.24f) return AgesUnitType.Swordsman;
            if (Random.value < 0.33f) return AgesUnitType.FireArcher;
            if (Random.value < 0.58f) return AgesUnitType.SpearHunter;
            return AgesUnitType.Clubman;
        }

        private void TryDeploy(AgesUnitType type)
        {
            if (!Running) return;
            var spec = AgesUnitCatalog.Get(type);
            if (_playerAge < spec.UnlockAge) return;
            var cost = ScaledUnitCost(spec, _playerAge);
            if (_gold < cost) return;
            _gold -= cost;
            SpawnUnit(AgesSide.Player, type);
        }

        private void SpawnUnit(AgesSide side, AgesUnitType type)
        {
            var sideSign = side == AgesSide.Player ? 1f : -1f;
            var rank = AgesUnitCatalog.Get(type).FormationRank;
            var baseX = side == AgesSide.Player ? -6.85f : 6.85f;
            var rankOffset = rank == 0 ? 0f : rank == 1 ? 0.72f : 1.22f;
            var laneJitter = Random.Range(-0.08f, 0.08f);
            var unit = AgesLaneUnit.Create(this, side, type, new Vector3(baseX - sideSign * rankOffset, -1.98f + laneJitter, Random.Range(-0.20f, 0.20f)));
            _units.Add(unit);
        }

        public AgesCombatTarget FindTarget(AgesLaneUnit source)
        {
            if (source.Type == AgesUnitType.Catapult)
            {
                return GetEnemyTower(source.Side);
            }

            if (source.Type == AgesUnitType.Springald)
            {
                AgesLaneUnit siegeTarget = null;
                var siegeDistance = float.MaxValue;
                foreach (var unit in _units)
                {
                    if (unit == null || !unit.IsAlive || unit.Side == source.Side || !unit.IsSiege) continue;
                    var distance = Mathf.Abs(unit.transform.position.x - source.transform.position.x);
                    if (distance < siegeDistance)
                    {
                        siegeDistance = distance;
                        siegeTarget = unit;
                    }
                }
                return siegeTarget != null ? siegeTarget : GetEnemyTower(source.Side);
            }

            AgesLaneUnit closest = null;
            var bestDistance = float.MaxValue;
            foreach (var unit in _units)
            {
                if (unit == null || !unit.IsAlive || unit.Side == source.Side) continue;
                var distance = Mathf.Abs(unit.transform.position.x - source.transform.position.x);
                if (distance < bestDistance)
                {
                    bestDistance = distance;
                    closest = unit;
                }
            }
            return closest != null ? closest : GetEnemyTower(source.Side);
        }

        public AgesLaneUnit FindTowerTarget(AgesTower tower, float range)
        {
            AgesLaneUnit closest = null;
            var bestDistance = float.MaxValue;
            foreach (var unit in _units)
            {
                if (unit == null || !unit.IsAlive || unit.Side == tower.Side) continue;
                var distance = Mathf.Abs(unit.transform.position.x - tower.transform.position.x);
                if (distance > range || distance >= bestDistance) continue;
                bestDistance = distance;
                closest = unit;
            }
            return closest;
        }

        public float GetFormationLimit(AgesLaneUnit source)
        {
            var direction = source.Side == AgesSide.Player ? 1f : -1f;
            var towerLimit = source.Side == AgesSide.Player ? 7.05f : -7.05f;
            if (source.FormationRank == 0) return towerLimit;

            var foundFrontline = false;
            var frontline = source.Side == AgesSide.Player ? -7.0f : 7.0f;
            foreach (var unit in _units)
            {
                if (unit == null || !unit.IsAlive || unit.Side != source.Side || unit.FormationRank != 0) continue;
                if (!foundFrontline || direction * unit.transform.position.x > direction * frontline)
                {
                    frontline = unit.transform.position.x;
                    foundFrontline = true;
                }
            }

            if (!foundFrontline) return towerLimit;
            var gap = source.FormationRank == 1 ? 0.78f : 1.58f;
            return frontline - direction * gap;
        }

        public bool FriendlySpaceOpen(AgesLaneUnit source, float proposedX)
        {
            var direction = source.Side == AgesSide.Player ? 1f : -1f;
            foreach (var unit in _units)
            {
                if (unit == null || unit == source || !unit.IsAlive || unit.Side != source.Side || unit.FormationRank != source.FormationRank) continue;
                var ahead = direction * (unit.transform.position.x - source.transform.position.x);
                if (ahead > -0.08f && ahead < 0.54f && Mathf.Abs(unit.transform.position.x - proposedX) < 0.54f) return false;
            }
            return true;
        }

        public void RemoveUnit(AgesLaneUnit unit)
        {
            _units.Remove(unit);
            if (unit.Side == AgesSide.Enemy) _gold += Mathf.RoundToInt(AgesUnitCatalog.Get(unit.Type).Cost * 0.24f);
        }

        public int UpgradeLevel(AgesUpgradePath path)
        {
            return _upgrades.TryGetValue(path, out var value) ? value : 0;
        }

        public int AgeFor(AgesSide side)
        {
            return side == AgesSide.Player ? _playerAge : _enemyAge;
        }

        public float ArmorMultiplier(AgesSide side)
        {
            return side == AgesSide.Player ? 1f + UpgradeLevel(AgesUpgradePath.TroopArmor) * 0.12f : 1f + _enemyAge * 0.035f;
        }

        public float DamageMultiplier(AgesSide side, AgesUnitSpec spec)
        {
            if (side == AgesSide.Enemy) return 1f + _enemyAge * 0.055f;
            if (spec.IsSiege) return 1f + UpgradeLevel(AgesUpgradePath.SiegeEngineering) * 0.15f;
            if (spec.FormationRank == 1) return 1f + UpgradeLevel(AgesUpgradePath.RangedDamage) * 0.13f;
            return 1f + UpgradeLevel(AgesUpgradePath.InfantryDamage) * 0.13f;
        }

        public float SpeedMultiplier(AgesSide side)
        {
            return side == AgesSide.Player ? 1f + UpgradeLevel(AgesUpgradePath.MarchSpeed) * 0.07f : 1f + _enemyAge * 0.018f;
        }

        public Color TeamColor(AgesSide side)
        {
            return side == AgesSide.Player ? _playerColor : _enemyColor;
        }

        private AgesTower GetEnemyTower(AgesSide side)
        {
            return side == AgesSide.Player ? _enemyTower : _playerTower;
        }

        private void PurchaseUpgrade(AgesUpgradePath path)
        {
            if (!Running) return;
            var level = UpgradeLevel(path);
            if (level >= 5) return;
            var cost = UpgradeCost(path, level);
            if (_gold < cost) return;
            _gold -= cost;
            _upgrades[path] = level + 1;
            RefreshUnits(AgesSide.Player);
        }

        private void RefreshUnits(AgesSide side)
        {
            foreach (var unit in _units)
            {
                if (unit != null && unit.IsAlive && unit.Side == side) unit.RefreshProgression();
            }
        }

        private void AdvanceAge()
        {
            if (!Running || _playerAge >= AgeNames.Length - 1) return;
            var cost = AdvanceCosts[_playerAge];
            if (_gold < cost) return;
            _gold -= cost;
            _playerAge++;
            _playerTower.SetAge(_playerAge);
            RefreshUnits(AgesSide.Player);
        }

        private void TriggerOvercharge()
        {
            if (!Running || _overchargeCooldown > 0f || _playerTower == null || !_playerTower.IsAlive) return;
            var targets = new List<AgesLaneUnit>();
            foreach (var unit in _units)
            {
                if (unit == null || !unit.IsAlive || unit.Side != AgesSide.Enemy) continue;
                var distance = Mathf.Abs(unit.transform.position.x - _playerTower.transform.position.x);
                if (distance <= 5.1f) targets.Add(unit);
            }
            targets.Sort((left, right) => left.transform.position.x.CompareTo(right.transform.position.x));
            if (targets.Count == 0) return;

            var targetCount = Mathf.Min(3, targets.Count);
            for (var index = 0; index < targetCount; index++)
            {
                var target = targets[index];
                AgesLaneProjectile.Launch(_worldRoot, _playerTower.ProjectileOrigin, target.TargetPoint, _playerColor, 0.12f, 0.35f);
                target.TakeDamage(22f + _playerAge * 2f);
            }
            _overchargeCooldown = 24f;
        }

        private void SetGameSpeed(float speed)
        {
            if (!Running) return;
            Time.timeScale = speed;
            if (_speedText != null) _speedText.text = speed.ToString("0") + "x";
        }

        public void TowerDestroyed(AgesTower tower)
        {
            if (_ended) return;
            _ended = true;
            _running = false;
            Time.timeScale = 1f;
            var playerWon = tower.Side == AgesSide.Enemy;
            if (playerWon)
            {
                _victories++;
                PlayerPrefs.SetInt(SaveNamespace + "victories", _victories);
                PlayerPrefs.Save();
            }
            CreateResultScreen(playerWon);
        }

        private void CreateResultScreen(bool playerWon)
        {
            _resultCanvas = PhantomUi.Canvas("Phantom Ages Result", 140);
            var shade = PhantomUi.Panel("Result Shade", _resultCanvas.transform, new Color(0.005f, 0.012f, 0.025f, 0.82f), Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, 0);
            var result = PhantomUi.Text("Result", shade, playerWon ? "AGE CONQUERED" : "YOUR TOWER FELL", 54, playerWon ? _playerColor : _enemyColor, TextAnchor.MiddleCenter, FontStyle.Bold);
            PhantomUi.Place(result.rectTransform, new Vector2(0.25f, 0.58f), new Vector2(0.75f, 0.72f), Vector2.zero, Vector2.zero);
            var summary = PhantomUi.Text("Summary", shade, playerWon ? "Your formation, counters, and research survived the age war." : "Rebuild the front line, protect your ranged ranks, and counter enemy siege.", 18, Color.white, TextAnchor.MiddleCenter);
            PhantomUi.Place(summary.rectTransform, new Vector2(0.25f, 0.48f), new Vector2(0.75f, 0.58f), Vector2.zero, Vector2.zero);
            var rematch = PhantomUi.Button("Rematch", shade, "REMATCH", new Color(0.03f, 0.51f, 0.73f), Color.white, () => StartCoroutine(RestartBattle()));
            PhantomUi.Place(rematch.GetComponent<RectTransform>(), new Vector2(0.40f, 0.28f), new Vector2(0.60f, 0.36f), Vector2.zero, Vector2.zero);
        }

        private IEnumerator RestartBattle()
        {
            if (_resultCanvas != null) Destroy(_resultCanvas.gameObject);
            if (_hudCanvas != null) Destroy(_hudCanvas.gameObject);
            if (_worldRoot != null) Destroy(_worldRoot.gameObject);
            _units.Clear();
            _playerTower = null;
            _enemyTower = null;
            yield return null;
            StartBattle();
        }

        private void UpdateHud()
        {
            if (_goldText != null) _goldText.text = _gold + "g\n<color=#90a7b8><size=12>+" + (9f + UpgradeLevel(AgesUpgradePath.WarEconomy) * 2.5f + _playerAge * 1.4f).ToString("0.0") + "/s</size></color>";
            if (_ageText != null) _ageText.text = AgeNames[_playerAge] + "  -  " + AgePeriods[_playerAge];
            if (_enemyAgeText != null) _enemyAgeText.text = "ENEMY  " + AgeNames[_enemyAge];
            if (_fieldNoteText != null) _fieldNoteText.text = FieldNotes[_playerAge];
            if (_playerTowerFill != null && _playerTower != null) _playerTowerFill.fillAmount = _playerTower.HealthRatio;
            if (_enemyTowerFill != null && _enemyTower != null) _enemyTowerFill.fillAmount = _enemyTower.HealthRatio;

            if (_advanceButton != null)
            {
                var atFinalAge = _playerAge >= AgeNames.Length - 1;
                _advanceButton.interactable = !atFinalAge && _gold >= AdvanceCosts[_playerAge];
                _advanceText.text = atFinalAge ? "PHANTOM AGE MASTERED" : "ADVANCE AGE [A]\n" + AgeNames[_playerAge + 1] + "  " + AdvanceCosts[_playerAge] + "g";
            }
            if (_overchargeButton != null)
            {
                _overchargeButton.interactable = _overchargeCooldown <= 0f;
                _overchargeText.text = _overchargeCooldown <= 0f ? "TOWER PULSE [SPACE]\n3 TARGETS - 22 DMG" : "TOWER PULSE\n" + _overchargeCooldown.ToString("0.0") + "s";
            }

            UpdateUnitButton(AgesUnitType.Clubman, "1");
            UpdateUnitButton(AgesUnitType.SpearHunter, "2");
            UpdateUnitButton(AgesUnitType.FireArcher, "3");
            UpdateUnitButton(AgesUnitType.Swordsman, "4");
            UpdateUnitButton(AgesUnitType.Cavalry, "5");
            UpdateUnitButton(AgesUnitType.Catapult, "6");
            UpdateUnitButton(AgesUnitType.Springald, "7");
            UpdateUnitButton(AgesUnitType.Dragon, "8");
            UpdateUpgradeButton(AgesUpgradePath.TroopArmor, "Q");
            UpdateUpgradeButton(AgesUpgradePath.InfantryDamage, "W");
            UpdateUpgradeButton(AgesUpgradePath.RangedDamage, "E");
            UpdateUpgradeButton(AgesUpgradePath.SiegeEngineering, "R");
            UpdateUpgradeButton(AgesUpgradePath.MarchSpeed, "T");
            UpdateUpgradeButton(AgesUpgradePath.WarEconomy, "Y");
        }

        private void UpdateUnitButton(AgesUnitType type, string key)
        {
            if (!_unitButtons.TryGetValue(type, out var button)) return;
            var spec = AgesUnitCatalog.Get(type);
            var unlocked = _playerAge >= spec.UnlockAge;
            var cost = ScaledUnitCost(spec, _playerAge);
            button.interactable = unlocked && _gold >= cost;
            var label = button.GetComponentInChildren<Text>();
            label.text = unlocked
                ? key + "  " + AgesUnitCatalog.DisplayName(type, _playerAge).ToUpperInvariant() + "\n" + cost + "g - " + spec.Role
                : key + "  " + spec.Name.ToUpperInvariant() + "\nUNLOCKS " + AgeNames[spec.UnlockAge];
        }

        private void UpdateUpgradeButton(AgesUpgradePath path, string key)
        {
            if (!_upgradeButtons.TryGetValue(path, out var button)) return;
            var level = UpgradeLevel(path);
            var cost = UpgradeCost(path, level);
            button.interactable = level < 5 && _gold >= cost;
            var progress = new string('|', level) + new string('.', 5 - level);
            button.GetComponentInChildren<Text>().text = key + "  " + UpgradeLabel(path).ToUpperInvariant() + "\nLV " + level + "/5  " + (level >= 5 ? "MAX" : cost + "g") + "  [" + progress + "]";
        }

        private static int UpgradeCost(AgesUpgradePath path, int level)
        {
            var baseCost = path == AgesUpgradePath.SiegeEngineering ? 92 : path == AgesUpgradePath.WarEconomy ? 78 : path == AgesUpgradePath.TroopArmor ? 72 : 64;
            return Mathf.RoundToInt(baseCost * (1f + level * 0.68f));
        }

        private static string UpgradeLabel(AgesUpgradePath path)
        {
            switch (path)
            {
                case AgesUpgradePath.TroopArmor: return "Troop Armor";
                case AgesUpgradePath.InfantryDamage: return "Infantry Damage";
                case AgesUpgradePath.RangedDamage: return "Ranged Damage";
                case AgesUpgradePath.SiegeEngineering: return "Siege Engineering";
                case AgesUpgradePath.MarchSpeed: return "March Speed";
                default: return "War Economy";
            }
        }

        private static int ScaledUnitCost(AgesUnitSpec spec, int age)
        {
            return Mathf.RoundToInt(spec.Cost * (1f + age * 0.035f));
        }
    }

    public sealed class AgesUnitSpec
    {
        public AgesUnitType Type;
        public string Name;
        public string Role;
        public int Cost;
        public int UnlockAge;
        public int FormationRank;
        public float Health;
        public float Damage;
        public float Range;
        public float Speed;
        public float Cooldown;
        public bool IsSiege;
    }

    public static class AgesUnitCatalog
    {
        private static readonly Dictionary<AgesUnitType, AgesUnitSpec> Specs = new Dictionary<AgesUnitType, AgesUnitSpec>
        {
            { AgesUnitType.Clubman, new AgesUnitSpec { Type = AgesUnitType.Clubman, Name = "Club Bearer", Role = "INFANTRY", Cost = 30, UnlockAge = 0, FormationRank = 0, Health = 155f, Damage = 19f, Range = 0.72f, Speed = 1.23f, Cooldown = 0.88f } },
            { AgesUnitType.SpearHunter, new AgesUnitSpec { Type = AgesUnitType.SpearHunter, Name = "Spear Hunter", Role = "RANGED", Cost = 40, UnlockAge = 0, FormationRank = 1, Health = 96f, Damage = 22f, Range = 3.85f, Speed = 1.06f, Cooldown = 1.28f } },
            { AgesUnitType.FireArcher, new AgesUnitSpec { Type = AgesUnitType.FireArcher, Name = "Fire Archer", Role = "RANGED", Cost = 50, UnlockAge = 0, FormationRank = 1, Health = 84f, Damage = 27f, Range = 4.85f, Speed = 0.98f, Cooldown = 1.52f } },
            { AgesUnitType.Swordsman, new AgesUnitSpec { Type = AgesUnitType.Swordsman, Name = "Bronze Swordsman", Role = "INFANTRY", Cost = 72, UnlockAge = 1, FormationRank = 0, Health = 198f, Damage = 31f, Range = 0.76f, Speed = 1.18f, Cooldown = 0.80f } },
            { AgesUnitType.Cavalry, new AgesUnitSpec { Type = AgesUnitType.Cavalry, Name = "Cavalry", Role = "INFANTRY", Cost = 112, UnlockAge = 2, FormationRank = 0, Health = 248f, Damage = 43f, Range = 0.88f, Speed = 1.68f, Cooldown = 1.00f } },
            { AgesUnitType.Catapult, new AgesUnitSpec { Type = AgesUnitType.Catapult, Name = "Catapult", Role = "TOWER SIEGE", Cost = 152, UnlockAge = 2, FormationRank = 2, Health = 188f, Damage = 96f, Range = 6.40f, Speed = 0.54f, Cooldown = 3.15f, IsSiege = true } },
            { AgesUnitType.Springald, new AgesUnitSpec { Type = AgesUnitType.Springald, Name = "Springald", Role = "ANTI-SIEGE", Cost = 132, UnlockAge = 2, FormationRank = 2, Health = 154f, Damage = 48f, Range = 6.05f, Speed = 0.66f, Cooldown = 2.20f, IsSiege = true } },
            { AgesUnitType.Dragon, new AgesUnitSpec { Type = AgesUnitType.Dragon, Name = "War Dragon", Role = "AERIAL RANGED", Cost = 310, UnlockAge = 4, FormationRank = 1, Health = 368f, Damage = 66f, Range = 4.95f, Speed = 1.34f, Cooldown = 1.60f } }
        };

        public static AgesUnitSpec Get(AgesUnitType type)
        {
            return Specs[type];
        }

        public static string DisplayName(AgesUnitType type, int age)
        {
            if (type == AgesUnitType.Clubman)
            {
                if (age == 0) return "Club Bearer";
                if (age == 1) return "Bronze Axeman";
                if (age == 2) return "Iron Vanguard";
                if (age == 3) return "Man-at-Arms";
                if (age == 4) return "Shock Trooper";
                return "Phantom Guard";
            }
            if (type == AgesUnitType.SpearHunter)
            {
                if (age == 0) return "Spear Hunter";
                if (age == 1) return "Bronze Spearman";
                if (age == 2) return "Javelin Legionary";
                if (age == 3) return "Pikeman";
                if (age == 4) return "Rail Lancer";
                return "Rift Lancer";
            }
            if (type == AgesUnitType.FireArcher)
            {
                if (age == 0) return "Fire Archer";
                if (age == 1) return "Composite Archer";
                if (age == 2) return "Iron Bow";
                if (age == 3) return "Longbow";
                if (age == 4) return "Pulse Archer";
                return "Void Archer";
            }
            return Get(type).Name;
        }
    }

    public abstract class AgesCombatTarget : MonoBehaviour
    {
        public AgesSide Side { get; protected set; }
        public float Health { get; protected set; }
        public float MaxHealth { get; protected set; }
        public bool IsAlive => Health > 0f;
        public float HealthRatio => MaxHealth <= 0f ? 0f : Mathf.Clamp01(Health / MaxHealth);
        public virtual bool IsSiege => false;
        public virtual Vector3 TargetPoint => transform.position + Vector3.up * 0.75f;

        public virtual void TakeDamage(float amount)
        {
            if (!IsAlive || amount <= 0f) return;
            Health = Mathf.Max(0f, Health - amount);
            OnHealthChanged();
            if (Health <= 0f) Die();
        }

        protected virtual void OnHealthChanged()
        {
        }

        protected abstract void Die();
    }

    public sealed class AgesTower : AgesCombatTarget
    {
        private PhantomAgesGame _game;
        private Transform _visualRoot;
        private Transform _healthFill;
        private float _barWidth;
        private float _attackCooldown;
        private int _age;

        public Vector3 ProjectileOrigin => transform.position + Vector3.up * 2.72f;
        public override Vector3 TargetPoint => transform.position + Vector3.up * 1.65f;

        public static AgesTower Create(PhantomAgesGame game, AgesSide side, Vector3 position)
        {
            var root = new GameObject(side == AgesSide.Player ? "Phantom Legion Tower" : "Shadow Empire Tower");
            root.transform.SetParent(game.WorldRoot, false);
            root.transform.position = position;
            var tower = root.AddComponent<AgesTower>();
            tower._game = game;
            tower.Side = side;
            tower.MaxHealth = 2200f;
            tower.Health = tower.MaxHealth;
            tower.CreateHealthBar(2.35f, 3.15f);
            tower.SetAge(0);
            return tower;
        }

        private void Update()
        {
            if (!_game.Running || !IsAlive) return;
            _attackCooldown -= Time.deltaTime;
            if (_attackCooldown > 0f) return;
            var range = 4.25f + _age * 0.14f;
            var target = _game.FindTowerTarget(this, range);
            if (target == null) return;
            var damage = 24f + _age * 2.5f;
            AgesLaneProjectile.Launch(_game.WorldRoot, ProjectileOrigin, target.TargetPoint, _game.TeamColor(Side), 0.105f, 0.42f);
            target.TakeDamage(damage);
            _attackCooldown = Mathf.Max(0.92f, 1.52f - _age * 0.07f);
        }

        public void SetAge(int age)
        {
            _age = age;
            if (_visualRoot != null) Destroy(_visualRoot.gameObject);
            _visualRoot = new GameObject("Age " + age + " Tower Architecture").transform;
            _visualRoot.SetParent(transform, false);

            var team = _game.TeamColor(Side);
            var stone = PhantomVisuals.Material("Tower stone " + Side, Side == AgesSide.Player ? new Color(0.28f, 0.36f, 0.43f) : new Color(0.34f, 0.25f, 0.29f), 0.08f, 0.32f);
            var accent = PhantomVisuals.Material("Tower accent " + Side + " " + age, Color.Lerp(team, Color.white, age < 4 ? 0.05f : 0.22f), age >= 2 ? 0.48f : 0.16f, 0.72f, age >= 4 ? team * 1.15f : (Color?)null);
            var dark = PhantomVisuals.Material("Tower dark " + Side, new Color(0.055f, 0.07f, 0.09f), 0.25f, 0.36f);

            Part("Foundation", PrimitiveType.Cube, new Vector3(0f, 0.38f, 0f), new Vector3(1.65f, 0.72f, 0.72f), stone);
            Part("Keep", PrimitiveType.Cube, new Vector3(0f, 1.20f, 0f), new Vector3(1.18f, 1.06f, 0.62f), stone);
            Part("Parapet", PrimitiveType.Cube, new Vector3(0f, 2.08f, 0f), new Vector3(1.48f, 0.28f, 0.70f), accent);
            for (var index = 0; index < 5; index++)
            {
                Part("Battlement " + index, PrimitiveType.Cube, new Vector3(-0.58f + index * 0.29f, 2.36f, 0f), new Vector3(0.18f, 0.28f, 0.62f), stone);
            }
            Part("Gate", PrimitiveType.Cube, new Vector3(0f, 0.61f, -0.38f), new Vector3(0.40f, 0.68f, 0.08f), dark);

            if (age == 0)
            {
                var timber = PhantomVisuals.Material("Tower timber " + Side, new Color(0.30f, 0.18f, 0.09f), 0f, 0.24f);
                Part("Timber Crane", PrimitiveType.Cube, new Vector3(0f, 2.68f, 0f), new Vector3(0.12f, 0.90f, 0.12f), timber, 28f);
            }
            else
            {
                Part("Age Crest", PrimitiveType.Cube, new Vector3(0f, 2.70f, 0f), new Vector3(0.18f, 0.74f + age * 0.09f, 0.18f), accent, 0f);
                Part("Crest Crown", PrimitiveType.Sphere, new Vector3(0f, 3.08f + age * 0.045f, 0f), Vector3.one * (0.20f + age * 0.025f), accent);
            }
            if (age >= 2)
            {
                Part("Left Turret", PrimitiveType.Cylinder, new Vector3(-0.72f, 1.72f, 0f), new Vector3(0.23f, 0.64f, 0.23f), accent);
                Part("Right Turret", PrimitiveType.Cylinder, new Vector3(0.72f, 1.72f, 0f), new Vector3(0.23f, 0.64f, 0.23f), accent);
            }
            if (age >= 4)
            {
                Part("Energy Core", PrimitiveType.Sphere, new Vector3(0f, 1.32f, -0.42f), Vector3.one * 0.30f, accent);
                PhantomVisuals.PointLight("Tower Core Light", transform.position + new Vector3(0f, 1.32f, -0.5f), team, 1.7f, 3.8f, _visualRoot);
            }
            if (age >= 5)
            {
                Part("Left Rift Wing", PrimitiveType.Cube, new Vector3(-0.70f, 2.78f, 0f), new Vector3(0.12f, 0.78f, 0.10f), accent, -34f);
                Part("Right Rift Wing", PrimitiveType.Cube, new Vector3(0.70f, 2.78f, 0f), new Vector3(0.12f, 0.78f, 0.10f), accent, 34f);
            }
        }

        private void Part(string name, PrimitiveType type, Vector3 localPosition, Vector3 localScale, Material material, float zRotation = 0f)
        {
            var part = PhantomVisuals.DecorativePrimitive(name, type, transform.position + localPosition, localScale, material, _visualRoot);
            part.transform.localPosition = localPosition;
            part.transform.localScale = localScale;
            part.transform.localRotation = Quaternion.Euler(0f, 0f, zRotation);
        }

        private void CreateHealthBar(float width, float height)
        {
            _barWidth = width;
            var trackMaterial = PhantomVisuals.Material("Tower health track", new Color(0.03f, 0.05f, 0.07f));
            var fillMaterial = PhantomVisuals.Material("Tower health " + Side, _game.TeamColor(Side), 0.05f, 0.6f, _game.TeamColor(Side) * 0.35f);
            var track = PhantomVisuals.DecorativePrimitive("Tower Health Track", PrimitiveType.Cube, transform.position + new Vector3(0f, height, -0.62f), new Vector3(width, 0.10f, 0.04f), trackMaterial, transform);
            track.transform.localPosition = new Vector3(0f, height, -0.62f);
            var fill = PhantomVisuals.DecorativePrimitive("Tower Health Fill", PrimitiveType.Cube, transform.position + new Vector3(0f, height, -0.66f), new Vector3(width, 0.07f, 0.035f), fillMaterial, transform);
            fill.transform.localPosition = new Vector3(0f, height, -0.66f);
            _healthFill = fill.transform;
        }

        protected override void OnHealthChanged()
        {
            if (_healthFill == null) return;
            var width = _barWidth * HealthRatio;
            _healthFill.localScale = new Vector3(width, 0.07f, 0.035f);
            _healthFill.localPosition = new Vector3(-_barWidth * 0.5f + width * 0.5f, _healthFill.localPosition.y, _healthFill.localPosition.z);
        }

        protected override void Die()
        {
            _game.TowerDestroyed(this);
            if (_visualRoot != null) _visualRoot.gameObject.SetActive(false);
        }
    }

    public sealed class AgesLaneUnit : AgesCombatTarget
    {
        private PhantomAgesGame _game;
        private AgesUnitSpec _spec;
        private Transform _visualRoot;
        private Transform _healthFill;
        private float _barWidth;
        private float _damage;
        private float _range;
        private float _speed;
        private float _cooldown;
        private float _attackClock;
        private AgesCombatTarget _target;

        public AgesUnitType Type => _spec.Type;
        public int FormationRank => _spec.FormationRank;
        public override bool IsSiege => _spec.IsSiege;
        public override Vector3 TargetPoint => transform.position + Vector3.up * (IsSiege ? 0.62f : 0.92f);

        public static AgesLaneUnit Create(PhantomAgesGame game, AgesSide side, AgesUnitType type, Vector3 position)
        {
            var root = new GameObject(side + " " + type);
            root.transform.SetParent(game.WorldRoot, false);
            root.transform.position = position;
            var unit = root.AddComponent<AgesLaneUnit>();
            unit._game = game;
            unit.Side = side;
            unit._spec = AgesUnitCatalog.Get(type);
            unit.CreateHealthBar(unit._spec.IsSiege ? 1.05f : 0.72f, unit._spec.IsSiege ? 1.35f : 1.72f);
            unit.RefreshProgression(true);
            return unit;
        }

        private void Update()
        {
            if (!_game.Running || !IsAlive) return;
            _attackClock -= Time.deltaTime;
            if (_target == null || !_target.IsAlive || _target.Side == Side) _target = _game.FindTarget(this);
            if (_target == null) return;

            var distance = Mathf.Abs(_target.transform.position.x - transform.position.x);
            if (distance <= _range)
            {
                Attack();
                return;
            }
            Advance();
        }

        public void RefreshProgression(bool initial = false)
        {
            var oldRatio = initial || MaxHealth <= 0f ? 1f : HealthRatio;
            var age = _game.AgeFor(Side);
            MaxHealth = _spec.Health * _game.ArmorMultiplier(Side) * (1f + age * 0.04f);
            Health = MaxHealth * oldRatio;
            _damage = _spec.Damage * _game.DamageMultiplier(Side, _spec) * (1f + age * 0.045f);
            _range = _spec.Range + (age >= 4 && _spec.FormationRank > 0 ? 0.28f : 0f);
            _speed = _spec.Speed * _game.SpeedMultiplier(Side);
            _cooldown = Mathf.Max(0.46f, _spec.Cooldown * (1f - age * 0.018f));
            RebuildVisual(age);
            OnHealthChanged();
        }

        private void Advance()
        {
            var direction = Side == AgesSide.Player ? 1f : -1f;
            var limit = _game.GetFormationLimit(this);
            var proposed = transform.position.x + direction * _speed * Time.deltaTime;
            if (Side == AgesSide.Player) proposed = Mathf.Min(proposed, limit);
            else proposed = Mathf.Max(proposed, limit);
            if (!_game.FriendlySpaceOpen(this, proposed)) return;
            transform.position = new Vector3(proposed, transform.position.y, transform.position.z);
        }

        private void Attack()
        {
            if (_attackClock > 0f || _target == null || !_target.IsAlive) return;
            var damage = DamageAgainst(_target);
            if (damage <= 0f)
            {
                _target = _game.FindTarget(this);
                return;
            }

            var color = _game.TeamColor(Side);
            var origin = transform.position + Vector3.up * (IsSiege ? 0.92f : 1.04f);
            var projectileSize = IsSiege ? 0.14f : FormationRank == 1 ? 0.075f : 0.055f;
            var arc = Type == AgesUnitType.Catapult ? 1.28f : Type == AgesUnitType.FireArcher ? 0.50f : IsSiege ? 0.24f : 0.12f;
            AgesLaneProjectile.Launch(_game.WorldRoot, origin, _target.TargetPoint, Type == AgesUnitType.FireArcher ? new Color(1f, 0.38f, 0.05f) : color, projectileSize, arc);
            _target.TakeDamage(damage);
            _attackClock = _cooldown;
        }

        private float DamageAgainst(AgesCombatTarget target)
        {
            if (Type == AgesUnitType.Catapult)
            {
                return target is AgesTower ? _damage : 0f;
            }
            if (Type == AgesUnitType.Springald)
            {
                if (target is AgesLaneUnit unit && unit.IsSiege) return _damage * 1.45f;
                if (target is AgesTower) return 38f * _game.DamageMultiplier(Side, _spec);
                return 0f;
            }
            return target is AgesTower ? _damage * 0.45f : _damage;
        }

        private void RebuildVisual(int age)
        {
            if (_visualRoot != null) Destroy(_visualRoot.gameObject);
            _visualRoot = new GameObject("Visible " + AgesUnitCatalog.DisplayName(Type, age)).transform;
            _visualRoot.SetParent(transform, false);
            _visualRoot.localScale = new Vector3(Side == AgesSide.Player ? 1f : -1f, 1f, 1f);

            var team = _game.TeamColor(Side);
            var skin = PhantomVisuals.Material("Ages skin", new Color(0.66f, 0.41f, 0.25f), 0f, 0.28f);
            var hide = PhantomVisuals.Material("Ages hide " + age, age == 0 ? new Color(0.35f, 0.20f, 0.10f) : new Color(0.17f + age * 0.025f, 0.20f + age * 0.02f, 0.23f + age * 0.025f), age >= 1 ? 0.38f : 0.02f, age >= 1 ? 0.55f : 0.25f);
            var accent = PhantomVisuals.Material("Ages unit accent " + Side + " " + age, team, age >= 2 ? 0.48f : 0.1f, 0.66f, age >= 4 ? team * 1.05f : (Color?)null);
            var wood = PhantomVisuals.Material("Ages hardwood", new Color(0.27f, 0.13f, 0.055f), 0f, 0.22f);
            var metal = PhantomVisuals.Material("Ages weapon metal " + age, age == 0 ? new Color(0.34f, 0.34f, 0.31f) : age == 1 ? new Color(0.62f, 0.34f, 0.12f) : new Color(0.60f, 0.68f, 0.74f), age >= 1 ? 0.72f : 0.15f, 0.65f, age >= 4 ? team * 0.42f : (Color?)null);

            if (IsSiege)
            {
                BuildSiegeVisual(hide, accent, wood, metal);
                return;
            }
            if (Type == AgesUnitType.Cavalry)
            {
                BuildCavalryVisual(skin, hide, accent, metal);
                return;
            }
            if (Type == AgesUnitType.Dragon)
            {
                BuildDragonVisual(accent, hide);
                return;
            }

            Part("Left Leg", PrimitiveType.Cube, new Vector3(-0.13f, 0.24f, 0f), new Vector3(0.12f, 0.43f, 0.16f), hide);
            Part("Right Leg", PrimitiveType.Cube, new Vector3(0.13f, 0.24f, 0f), new Vector3(0.12f, 0.43f, 0.16f), hide);
            Part("Torso", PrimitiveType.Capsule, new Vector3(0f, 0.83f, 0f), new Vector3(0.33f, 0.47f, 0.23f), hide);
            Part("Team Sash", PrimitiveType.Cube, new Vector3(0f, 0.86f, -0.24f), new Vector3(0.40f, 0.11f, 0.04f), accent, -12f);
            Part("Head", PrimitiveType.Sphere, new Vector3(0f, 1.40f, 0f), Vector3.one * 0.29f, skin);
            if (age == 0)
            {
                var hair = PhantomVisuals.Material("Caveman hair", new Color(0.12f, 0.065f, 0.025f), 0f, 0.16f);
                Part("Caveman Hair", PrimitiveType.Sphere, new Vector3(-0.04f, 1.55f, 0.02f), new Vector3(0.31f, 0.18f, 0.30f), hair);
            }
            else
            {
                Part("Visible Helmet", PrimitiveType.Sphere, new Vector3(0f, 1.52f, 0f), new Vector3(0.33f, 0.18f, 0.30f), metal);
            }

            BuildWeapon(Type, wood, metal, accent);
            var armorLevel = Side == AgesSide.Player ? _game.UpgradeLevel(AgesUpgradePath.TroopArmor) : Mathf.Min(5, age);
            if (armorLevel > 0)
            {
                var plateScale = 0.10f + armorLevel * 0.016f;
                Part("Left Shoulder Upgrade", PrimitiveType.Sphere, new Vector3(-0.34f, 1.10f, 0f), new Vector3(plateScale, 0.18f, 0.20f), metal);
                Part("Right Shoulder Upgrade", PrimitiveType.Sphere, new Vector3(0.34f, 1.10f, 0f), new Vector3(plateScale, 0.18f, 0.20f), metal);
            }
        }

        private void BuildWeapon(AgesUnitType type, Material wood, Material metal, Material accent)
        {
            if (type == AgesUnitType.Clubman)
            {
                Part("Hardwood Club", PrimitiveType.Cube, new Vector3(0.42f, 0.96f, -0.10f), new Vector3(0.10f, 0.78f, 0.10f), wood, -28f);
                Part("Club Head", PrimitiveType.Sphere, new Vector3(0.62f, 1.28f, -0.10f), new Vector3(0.18f, 0.24f, 0.18f), wood);
            }
            else if (type == AgesUnitType.SpearHunter)
            {
                Part("Spear Shaft", PrimitiveType.Cube, new Vector3(0.38f, 1.08f, -0.10f), new Vector3(0.045f, 1.18f, 0.045f), wood, -47f);
                Part("Knapped Spear Point", PrimitiveType.Cube, new Vector3(0.79f, 1.52f, -0.10f), new Vector3(0.08f, 0.24f, 0.06f), metal, -47f);
            }
            else if (type == AgesUnitType.FireArcher)
            {
                Part("Bow Upper", PrimitiveType.Cube, new Vector3(0.38f, 1.14f, -0.10f), new Vector3(0.04f, 0.52f, 0.04f), wood, -24f);
                Part("Bow Lower", PrimitiveType.Cube, new Vector3(0.38f, 0.76f, -0.10f), new Vector3(0.04f, 0.52f, 0.04f), wood, 24f);
                Part("Fire Arrow", PrimitiveType.Cube, new Vector3(0.52f, 0.99f, -0.14f), new Vector3(0.46f, 0.035f, 0.035f), metal, -90f);
                Part("Arrow Flame", PrimitiveType.Sphere, new Vector3(0.91f, 0.99f, -0.14f), Vector3.one * 0.10f, PhantomVisuals.Material("Fire arrow flame", new Color(1f, 0.30f, 0.02f), 0f, 0.4f, new Color(1f, 0.16f, 0f)));
            }
            else
            {
                Part("Sword Grip", PrimitiveType.Cube, new Vector3(0.35f, 0.88f, -0.10f), new Vector3(0.07f, 0.40f, 0.07f), wood, -34f);
                Part("Sword Blade", PrimitiveType.Cube, new Vector3(0.60f, 1.28f, -0.10f), new Vector3(0.08f, 0.78f, 0.055f), metal, -34f);
                Part("Sword Guard", PrimitiveType.Cube, new Vector3(0.41f, 1.01f, -0.12f), new Vector3(0.28f, 0.055f, 0.08f), accent, 56f);
            }
        }

        private void BuildCavalryVisual(Material skin, Material hide, Material accent, Material metal)
        {
            Part("Horse Body", PrimitiveType.Capsule, new Vector3(0f, 0.58f, 0f), new Vector3(0.54f, 0.72f, 0.35f), hide, 90f);
            Part("Horse Head", PrimitiveType.Sphere, new Vector3(0.64f, 0.85f, 0f), new Vector3(0.31f, 0.39f, 0.29f), hide);
            Part("Rider Torso", PrimitiveType.Capsule, new Vector3(-0.05f, 1.25f, 0f), new Vector3(0.27f, 0.42f, 0.22f), accent);
            Part("Rider Head", PrimitiveType.Sphere, new Vector3(-0.05f, 1.73f, 0f), Vector3.one * 0.24f, skin);
            Part("Cavalry Helm", PrimitiveType.Sphere, new Vector3(-0.05f, 1.84f, 0f), new Vector3(0.27f, 0.14f, 0.26f), metal);
            Part("Cavalry Lance", PrimitiveType.Cube, new Vector3(0.58f, 1.40f, -0.12f), new Vector3(0.045f, 1.35f, 0.045f), metal, -72f);
        }

        private void BuildSiegeVisual(Material frame, Material accent, Material wood, Material metal)
        {
            Part("Siege Frame", PrimitiveType.Cube, new Vector3(0f, 0.48f, 0f), new Vector3(1.10f, 0.38f, 0.38f), frame);
            Part("Left Wheel", PrimitiveType.Cylinder, new Vector3(-0.42f, 0.28f, -0.35f), new Vector3(0.31f, 0.08f, 0.31f), metal, 0f, 90f);
            Part("Right Wheel", PrimitiveType.Cylinder, new Vector3(0.42f, 0.28f, -0.35f), new Vector3(0.31f, 0.08f, 0.31f), metal, 0f, 90f);
            if (Type == AgesUnitType.Catapult)
            {
                Part("Throwing Arm", PrimitiveType.Cube, new Vector3(0.08f, 0.98f, 0f), new Vector3(0.10f, 1.15f, 0.10f), wood, -28f);
                Part("Stone Payload", PrimitiveType.Sphere, new Vector3(0.38f, 1.45f, 0f), Vector3.one * 0.23f, metal);
            }
            else
            {
                Part("Springald Rail", PrimitiveType.Cube, new Vector3(0.22f, 0.85f, 0f), new Vector3(0.08f, 1.25f, 0.08f), accent, -68f);
                Part("Springald Bolt", PrimitiveType.Cube, new Vector3(0.52f, 0.92f, -0.08f), new Vector3(0.055f, 0.92f, 0.055f), metal, -78f);
                Part("Torsion Housing", PrimitiveType.Cylinder, new Vector3(-0.28f, 0.72f, 0f), new Vector3(0.22f, 0.22f, 0.22f), wood, 0f, 90f);
            }
        }

        private void BuildDragonVisual(Material accent, Material dark)
        {
            Part("Dragon Body", PrimitiveType.Capsule, new Vector3(0f, 0.86f, 0f), new Vector3(0.46f, 0.76f, 0.30f), dark, 90f);
            Part("Dragon Head", PrimitiveType.Sphere, new Vector3(0.72f, 1.05f, 0f), new Vector3(0.34f, 0.27f, 0.26f), accent);
            Part("Upper Wing", PrimitiveType.Cube, new Vector3(-0.12f, 1.38f, 0.08f), new Vector3(0.16f, 0.90f, 0.06f), accent, -54f);
            Part("Lower Wing", PrimitiveType.Cube, new Vector3(-0.18f, 0.58f, 0.08f), new Vector3(0.14f, 0.82f, 0.06f), accent, 52f);
            Part("Dragon Tail", PrimitiveType.Cube, new Vector3(-0.78f, 0.78f, 0f), new Vector3(0.10f, 0.78f, 0.10f), dark, 72f);
        }

        private void Part(string name, PrimitiveType type, Vector3 localPosition, Vector3 localScale, Material material, float zRotation = 0f, float xRotation = 0f)
        {
            var part = PhantomVisuals.DecorativePrimitive(name, type, transform.position + localPosition, localScale, material, _visualRoot);
            part.transform.localPosition = localPosition;
            part.transform.localScale = localScale;
            part.transform.localRotation = Quaternion.Euler(xRotation, 0f, zRotation);
        }

        private void CreateHealthBar(float width, float height)
        {
            _barWidth = width;
            var trackMaterial = PhantomVisuals.Material("Unit health track", new Color(0.025f, 0.035f, 0.045f));
            var fillMaterial = PhantomVisuals.Material("Unit health " + Side, _game.TeamColor(Side), 0.02f, 0.50f, _game.TeamColor(Side) * 0.22f);
            var track = PhantomVisuals.DecorativePrimitive("Health Track", PrimitiveType.Cube, transform.position + new Vector3(0f, height, -0.58f), new Vector3(width, 0.075f, 0.035f), trackMaterial, transform);
            track.transform.localPosition = new Vector3(0f, height, -0.58f);
            var fill = PhantomVisuals.DecorativePrimitive("Health Fill", PrimitiveType.Cube, transform.position + new Vector3(0f, height, -0.62f), new Vector3(width, 0.052f, 0.03f), fillMaterial, transform);
            fill.transform.localPosition = new Vector3(0f, height, -0.62f);
            _healthFill = fill.transform;
        }

        protected override void OnHealthChanged()
        {
            if (_healthFill == null) return;
            var width = _barWidth * HealthRatio;
            _healthFill.localScale = new Vector3(width, 0.052f, 0.03f);
            _healthFill.localPosition = new Vector3(-_barWidth * 0.5f + width * 0.5f, _healthFill.localPosition.y, _healthFill.localPosition.z);
        }

        protected override void Die()
        {
            _game.RemoveUnit(this);
            Destroy(gameObject);
        }
    }

    public sealed class AgesLaneProjectile : MonoBehaviour
    {
        private Vector3 _origin;
        private Vector3 _destination;
        private float _arc;
        private float _elapsed;
        private float _duration;

        public static void Launch(Transform parent, Vector3 origin, Vector3 destination, Color color, float size, float arc)
        {
            var material = PhantomVisuals.Material("Lane projectile " + color, color, 0.12f, 0.86f, color * 1.4f);
            var projectile = PhantomVisuals.DecorativePrimitive("Lane Projectile", PrimitiveType.Sphere, origin, Vector3.one * size, material, parent);
            var motion = projectile.AddComponent<AgesLaneProjectile>();
            motion._origin = origin;
            motion._destination = destination;
            motion._arc = arc;
            motion._duration = Mathf.Clamp(Vector3.Distance(origin, destination) / 11.5f, 0.12f, 0.72f);
        }

        private void Update()
        {
            _elapsed += Time.deltaTime;
            var progress = Mathf.Clamp01(_elapsed / _duration);
            var position = Vector3.Lerp(_origin, _destination, progress);
            position.y += Mathf.Sin(progress * Mathf.PI) * _arc;
            transform.position = position;
            if (progress >= 1f) Destroy(gameObject);
        }
    }
}

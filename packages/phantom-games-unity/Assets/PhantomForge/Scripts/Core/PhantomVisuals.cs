using System.Collections.Generic;
using UnityEngine;

namespace PhantomForge.Core
{
    public static class PhantomVisuals
    {
        private static readonly Dictionary<string, Material> Materials = new Dictionary<string, Material>();
        private static readonly Dictionary<uint, Sprite> Panels = new Dictionary<uint, Sprite>();

        public static Material Material(string key, Color color, float metallic = 0f, float smoothness = 0.35f, Color? emission = null)
        {
            if (Materials.TryGetValue(key, out var cached))
            {
                return cached;
            }

            var shader = Shader.Find("Standard")
                ?? Shader.Find("Universal Render Pipeline/Lit")
                ?? Shader.Find("Unlit/Color")
                ?? Shader.Find("Sprites/Default")
                ?? Shader.Find("UI/Default")
                ?? Shader.Find("Hidden/InternalErrorShader");
            if (shader == null)
            {
                throw new System.InvalidOperationException("PhantomForge could not resolve a player shader.");
            }
            var material = new Material(shader) { name = key, color = color };
            if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", metallic);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", smoothness);
            if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", smoothness);
            if (emission.HasValue)
            {
                material.EnableKeyword("_EMISSION");
                if (material.HasProperty("_EmissionColor")) material.SetColor("_EmissionColor", emission.Value);
            }
            Materials[key] = material;
            return material;
        }

        public static GameObject Primitive(string name, PrimitiveType type, Vector3 position, Vector3 scale, Material material, Transform parent = null)
        {
            var item = GameObject.CreatePrimitive(type);
            item.name = name;
            item.transform.SetPositionAndRotation(position, Quaternion.identity);
            item.transform.localScale = scale;
            if (parent != null) item.transform.SetParent(parent, true);
            var renderer = item.GetComponent<Renderer>();
            if (renderer != null) renderer.sharedMaterial = material;
            return item;
        }

        public static GameObject DecorativePrimitive(string name, PrimitiveType type, Vector3 position, Vector3 scale, Material material, Transform parent = null)
        {
            var item = Primitive(name, type, position, scale, material, parent);
            var collider = item.GetComponent<Collider>();
            if (collider != null) UnityEngine.Object.Destroy(collider);
            return item;
        }

        public static GameObject ResourceModel(
            string path,
            string name,
            Vector3 position,
            Quaternion rotation,
            float targetSize,
            Transform parent = null,
            bool stripColliders = true)
        {
            var prefab = Resources.Load<GameObject>(path);
            if (prefab == null) return null;

            var anchor = new GameObject(name);
            if (parent != null) anchor.transform.SetParent(parent, false);
            anchor.transform.SetPositionAndRotation(position, rotation);

            var model = UnityEngine.Object.Instantiate(prefab, anchor.transform, false);
            model.name = name + " Model";
            model.transform.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);

            if (TryGetBounds(model, out var bounds))
            {
                var largest = Mathf.Max(bounds.size.x, Mathf.Max(bounds.size.y, bounds.size.z));
                if (largest > 0.0001f)
                {
                    model.transform.localScale *= targetSize / largest;
                    if (TryGetBounds(model, out bounds))
                    {
                        model.transform.position += anchor.transform.position - bounds.center;
                    }
                }
            }

            if (stripColliders)
            {
                foreach (var collider in model.GetComponentsInChildren<Collider>(true))
                {
                    UnityEngine.Object.Destroy(collider);
                }
            }

            return anchor;
        }

        public static GameObject GroundedResourceModel(
            string path,
            string name,
            Vector3 groundPosition,
            Quaternion rotation,
            float targetSize,
            Transform parent = null,
            bool stripColliders = true)
        {
            var anchor = ResourceModel(path, name, groundPosition, rotation, targetSize, parent, stripColliders);
            if (anchor != null && TryGetBounds(anchor, out var bounds))
            {
                anchor.transform.position += Vector3.up * (groundPosition.y - bounds.min.y);
            }
            return anchor;
        }

        public static void ApplyMaterial(GameObject root, Material material)
        {
            if (root == null || material == null) return;
            foreach (var renderer in root.GetComponentsInChildren<Renderer>(true))
            {
                var materials = renderer.sharedMaterials;
                for (var index = 0; index < materials.Length; index++) materials[index] = material;
                renderer.sharedMaterials = materials;
            }
        }

        private static bool TryGetBounds(GameObject root, out Bounds bounds)
        {
            var renderers = root.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0)
            {
                bounds = default;
                return false;
            }

            bounds = renderers[0].bounds;
            for (var index = 1; index < renderers.Length; index++)
            {
                bounds.Encapsulate(renderers[index].bounds);
            }
            return true;
        }

        public static Light PointLight(string name, Vector3 position, Color color, float intensity, float range, Transform parent = null)
        {
            var item = new GameObject(name);
            item.transform.position = position;
            if (parent != null) item.transform.SetParent(parent, true);
            var light = item.AddComponent<Light>();
            light.type = LightType.Point;
            light.color = color;
            light.intensity = intensity;
            light.range = range;
            light.shadows = LightShadows.Soft;
            return light;
        }

        public static Sprite RoundedPanel(Color color, int radius = 18)
        {
            var packed = ((uint)(byte)(color.r * 255f) << 24)
                | ((uint)(byte)(color.g * 255f) << 16)
                | ((uint)(byte)(color.b * 255f) << 8)
                | (byte)(color.a * 255f);
            packed ^= (uint)radius;
            if (Panels.TryGetValue(packed, out var cached))
            {
                return cached;
            }

            const int size = 64;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false)
            {
                name = "Phantom rounded panel",
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp
            };
            var pixels = new Color32[size * size];
            var color32 = (Color32)color;
            for (var y = 0; y < size; y++)
            {
                for (var x = 0; x < size; x++)
                {
                    var dx = Mathf.Max(0f, radius - Mathf.Min(x, size - 1 - x));
                    var dy = Mathf.Max(0f, radius - Mathf.Min(y, size - 1 - y));
                    var distance = Mathf.Sqrt(dx * dx + dy * dy);
                    var alpha = Mathf.Clamp01(radius + 0.5f - distance);
                    pixels[y * size + x] = new Color32(color32.r, color32.g, color32.b, (byte)(color32.a * alpha));
                }
            }
            texture.SetPixels32(pixels);
            texture.Apply(false, true);
            var border = new Vector4(radius, radius, radius, radius);
            var sprite = Sprite.Create(texture, new Rect(0, 0, size, size), new Vector2(0.5f, 0.5f), 100f, 0, SpriteMeshType.FullRect, border);
            Panels[packed] = sprite;
            return sprite;
        }

        public static Sprite ResourceSprite(string path)
        {
            var texture = Resources.Load<Texture2D>(path);
            if (texture == null) return null;
            return Sprite.Create(texture, new Rect(0, 0, texture.width, texture.height), new Vector2(0.5f, 0.5f), 100f);
        }

        public static void ConfigureWorld(Color ambient, Color fog, float fogDensity, Color sunColor, float sunIntensity, Vector3 sunEuler)
        {
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = ambient * 1.15f;
            RenderSettings.ambientEquatorColor = ambient * 0.62f;
            RenderSettings.ambientGroundColor = ambient * 0.28f;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogColor = fog;
            RenderSettings.fogDensity = fogDensity;

            var skyShader = Shader.Find("Skybox/Procedural");
            if (skyShader != null)
            {
                var sky = new Material(skyShader) { name = "Phantom procedural sky" };
                if (sky.HasProperty("_SkyTint")) sky.SetColor("_SkyTint", ambient * 1.35f);
                if (sky.HasProperty("_GroundColor")) sky.SetColor("_GroundColor", fog * 0.5f);
                if (sky.HasProperty("_AtmosphereThickness")) sky.SetFloat("_AtmosphereThickness", 0.72f);
                if (sky.HasProperty("_Exposure")) sky.SetFloat("_Exposure", 1.08f);
                RenderSettings.skybox = sky;
            }

            var sun = new GameObject("Key Sun").AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = sunColor;
            sun.intensity = sunIntensity;
            sun.shadows = LightShadows.Soft;
            sun.shadowStrength = 0.82f;
            sun.transform.rotation = Quaternion.Euler(sunEuler);
            RenderSettings.sun = sun;
        }
    }
}

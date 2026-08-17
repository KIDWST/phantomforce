using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace PhantomForge.Editor
{
    public static class PhantomBuildPipeline
    {
        private const string BootstrapScene = "Assets/Scenes/Bootstrap.unity";

        [MenuItem("PhantomForge/Build All Windows")]
        public static void BuildAllWindows()
        {
            EnsureBootstrapScene();
            Build("phantom-strike", "PhantomStrike", "PhantomStrike: Operation Nightglass");
            Build("phantom-ages", "PhantomAges", "Phantom Ages");
            Build("phantom-legends", "PhantomLegends", "Phantom Legends: Riftbound Dominion");
            Debug.Log("PhantomForge: all three Windows players built successfully.");
        }

        [MenuItem("PhantomForge/Build PhantomStrike")]
        public static void BuildPhantomStrike()
        {
            EnsureBootstrapScene();
            Build("phantom-strike", "PhantomStrike", "PhantomStrike: Operation Nightglass");
        }

        [MenuItem("PhantomForge/Build Phantom Ages")]
        public static void BuildPhantomAges()
        {
            EnsureBootstrapScene();
            Build("phantom-ages", "PhantomAges", "Phantom Ages");
        }

        [MenuItem("PhantomForge/Build Phantom Legends")]
        public static void BuildPhantomLegends()
        {
            EnsureBootstrapScene();
            Build("phantom-legends", "PhantomLegends", "Phantom Legends: Riftbound Dominion");
        }

        public static void BuildRequestedGame()
        {
            var game = ReadArgument("--phantom-game") ?? "phantom-strike";
            EnsureBootstrapScene();
            if (game.Equals("phantom-strike", StringComparison.OrdinalIgnoreCase))
            {
                Build("phantom-strike", "PhantomStrike", "PhantomStrike: Operation Nightglass");
            }
            else if (game.Equals("phantom-ages", StringComparison.OrdinalIgnoreCase))
            {
                Build("phantom-ages", "PhantomAges", "Phantom Ages");
            }
            else if (game.Equals("phantom-legends", StringComparison.OrdinalIgnoreCase))
            {
                Build("phantom-legends", "PhantomLegends", "Phantom Legends: Riftbound Dominion");
            }
            else
            {
                throw new BuildFailedException("Unknown --phantom-game value: " + game + ". Expected phantom-strike, phantom-ages, or phantom-legends.");
            }
        }

        private static void EnsureBootstrapScene()
        {
            var directory = Path.GetDirectoryName(BootstrapScene);
            if (!Directory.Exists(directory)) Directory.CreateDirectory(directory ?? "Assets/Scenes");
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene.name = "Bootstrap";
            EditorSceneManager.SaveScene(scene, BootstrapScene);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
        }

        private static void Build(string slug, string executableName, string productName)
        {
            EnsurePlayerShaders();
            PlayerSettings.companyName = "PhantomForce";
            PlayerSettings.productName = productName;
            PlayerSettings.bundleVersion = "0.1.0";
            PlayerSettings.fullScreenMode = FullScreenMode.FullScreenWindow;
            PlayerSettings.defaultScreenWidth = 1920;
            PlayerSettings.defaultScreenHeight = 1080;
            PlayerSettings.runInBackground = true;
            PlayerSettings.resizableWindow = true;
            PlayerSettings.forceSingleInstance = false;

            var outputDirectory = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Builds", "Windows", slug));
            Directory.CreateDirectory(outputDirectory);
            var output = Path.Combine(outputDirectory, executableName + ".exe");
            var options = new BuildPlayerOptions
            {
                scenes = new[] { BootstrapScene },
                locationPathName = output,
                target = BuildTarget.StandaloneWindows64,
                options = BuildOptions.CleanBuildCache
            };
            var report = BuildPipeline.BuildPlayer(options);
            if (report.summary.result != BuildResult.Succeeded)
            {
                throw new BuildFailedException(productName + " failed: " + report.summary.result + " with " + report.summary.totalErrors + " error(s).");
            }

            File.WriteAllText(
                Path.Combine(outputDirectory, "phantom-build.json"),
                JsonUtility.ToJson(new BuildReceipt
                {
                    game = slug,
                    product = productName,
                    unity = Application.unityVersion,
                    bytes = report.summary.totalSize,
                    builtAtUtc = DateTime.UtcNow.ToString("O")
                }, true));
        }

        private static void EnsurePlayerShaders()
        {
            var assets = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset");
            if (assets.Length == 0) throw new InvalidOperationException("Unity GraphicsSettings asset is missing.");
            var settings = new SerializedObject(assets[0]);
            var shaders = settings.FindProperty("m_AlwaysIncludedShaders");
            if (shaders == null || !shaders.isArray)
            {
                throw new InvalidOperationException("Unity always-included shader list is unavailable.");
            }

            foreach (var shaderName in new[] { "Standard", "Unlit/Color", "Sprites/Default", "UI/Default", "Skybox/Procedural" })
            {
                var shader = Shader.Find(shaderName);
                if (shader == null) continue;
                var found = false;
                for (var index = 0; index < shaders.arraySize; index++)
                {
                    if (shaders.GetArrayElementAtIndex(index).objectReferenceValue == shader)
                    {
                        found = true;
                        break;
                    }
                }
                if (found) continue;
                var next = shaders.arraySize;
                shaders.InsertArrayElementAtIndex(next);
                shaders.GetArrayElementAtIndex(next).objectReferenceValue = shader;
            }
            settings.ApplyModifiedPropertiesWithoutUndo();
            AssetDatabase.SaveAssets();
        }

        private static string ReadArgument(string name)
        {
            var args = Environment.GetCommandLineArgs();
            for (var index = 0; index < args.Length - 1; index++)
            {
                if (args[index].Equals(name, StringComparison.OrdinalIgnoreCase)) return args[index + 1];
            }
            return null;
        }

        [Serializable]
        private sealed class BuildReceipt
        {
            public string game;
            public string product;
            public string unity;
            public ulong bytes;
            public string builtAtUtc;
        }
    }
}

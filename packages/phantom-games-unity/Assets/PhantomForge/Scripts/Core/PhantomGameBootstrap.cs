using System;
using UnityEngine;

namespace PhantomForge.Core
{
    public static class PhantomGameBootstrap
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Boot()
        {
            if (UnityEngine.Object.FindFirstObjectByType<PhantomRuntimeMarker>() != null)
            {
                return;
            }

            Application.targetFrameRate = 120;
            QualitySettings.vSyncCount = 1;
            Screen.sleepTimeout = SleepTimeout.NeverSleep;

            var root = new GameObject("Phantom Runtime");
            root.AddComponent<PhantomRuntimeMarker>();
            UnityEngine.Object.DontDestroyOnLoad(root);

            var mode = ResolveMode();
            switch (mode)
            {
                case "phantom-ages":
                    root.AddComponent<Ages.PhantomAgesGame>();
                    break;
                case "phantom-legends":
                    root.AddComponent<Legends.PhantomLegendsGame>();
                    break;
                case "phantom-strike":
                    root.AddComponent<Strike.PhantomStrikeGame>();
                    break;
                default:
                    throw new InvalidOperationException("Unsupported PhantomPlay Unity game identity: " + mode);
            }
        }

        private static string ResolveMode()
        {
            var args = Environment.GetCommandLineArgs();
            for (var index = 0; index < args.Length - 1; index++)
            {
                if (args[index].Equals("--phantom-game", StringComparison.OrdinalIgnoreCase))
                {
                    var requested = args[index + 1].Trim().ToLowerInvariant();
                    if (requested == "phantom-strike" || requested == "phantom-ages" || requested == "phantom-legends")
                    {
                        return requested;
                    }
                    throw new InvalidOperationException("Unknown --phantom-game value: " + requested);
                }
            }

            var product = Application.productName.ToLowerInvariant();
            if (product.Contains("legends") || product.Contains("riftbound")) return "phantom-legends";
            if (product.Contains("ages")) return "phantom-ages";
            if (product.Contains("strike") || product.Contains("nightglass")) return "phantom-strike";

            return "phantom-strike";
        }
    }

    public sealed class PhantomRuntimeMarker : MonoBehaviour
    {
    }
}

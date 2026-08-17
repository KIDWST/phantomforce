using System;
using System.Collections;
using System.IO;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace PhantomForge.Core
{
    public static class PhantomSmokeCapture
    {
        public static bool Enabled
        {
            get
            {
                foreach (var argument in Environment.GetCommandLineArgs())
                {
                    if (string.Equals(argument, "--phantom-smoke", StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                }
                return false;
            }
        }

        public static IEnumerator Run(string buttonName, string gameId)
        {
            yield return new WaitForSecondsRealtime(0.45f);
            if (EventSystem.current == null)
            {
                throw new InvalidOperationException(gameId + " has no active Unity EventSystem.");
            }
            var buttons = UnityEngine.Object.FindObjectsByType<Button>(FindObjectsSortMode.None);
            Button target = null;
            foreach (var button in buttons)
            {
                if (button.name == buttonName)
                {
                    target = button;
                    break;
                }
            }
            if (target == null) throw new InvalidOperationException(gameId + " menu button is missing: " + buttonName);
            var pointer = new PointerEventData(EventSystem.current) { button = PointerEventData.InputButton.Left };
            ExecuteEvents.Execute(target.gameObject, pointer, ExecuteEvents.pointerClickHandler);
            yield return new WaitForSecondsRealtime(4f);

            var path = CapturePath(gameId);
            var directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
            yield return new WaitForEndOfFrame();
            var screenshot = ScreenCapture.CaptureScreenshotAsTexture();
            if (screenshot == null)
            {
                Debug.LogError("PhantomForge could not capture gameplay for " + gameId + ".");
                Application.Quit(1);
                yield break;
            }
            File.WriteAllBytes(path, screenshot.EncodeToPNG());
            UnityEngine.Object.Destroy(screenshot);
            Debug.Log("PhantomForge smoke capture ready: " + path);
            yield return new WaitForSecondsRealtime(0.5f);
            Application.Quit(0);
        }

        private static string CapturePath(string gameId)
        {
            var arguments = Environment.GetCommandLineArgs();
            for (var index = 0; index < arguments.Length - 1; index++)
            {
                if (string.Equals(arguments[index], "--phantom-capture", StringComparison.OrdinalIgnoreCase))
                {
                    return Path.GetFullPath(arguments[index + 1]);
                }
            }
            return Path.Combine(Application.persistentDataPath, gameId + "-smoke.png");
        }
    }
}

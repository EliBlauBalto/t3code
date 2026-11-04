package com.t3tools.startuptest;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.Intent;
import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.content.res.XmlResourceParser;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStreamReader;

public final class StartupInstrumentation extends Instrumentation {
  private org.json.JSONArray fixture;
  private ComponentName dreamSettings() throws Exception {
    PackageManager manager = getContext().getPackageManager();
    ServiceInfo service = manager.getServiceInfo(new ComponentName("com.t3tools.t3code.dream",
        "expo.modules.t3nativecontrols.T3DreamService"), PackageManager.GET_META_DATA);
    try (XmlResourceParser metadata = service.loadXmlMetaData(manager, "android.service.dream")) {
      if (metadata == null) throw new AssertionError("Screen saver metadata missing");
      while (metadata.next() != XmlResourceParser.START_TAG) { }
      String ns = "http://schemas.android.com/apk/res/android";
      int preview = metadata.getAttributeResourceValue(ns, "previewImage", 0);
      if (preview == 0) throw new AssertionError("Screen saver picker preview missing");
      manager.getResourcesForApplication(service.applicationInfo).getDrawable(preview, null);
      String activity = metadata.getAttributeValue(ns, "settingsActivity");
      if (activity == null) throw new AssertionError("Screen saver Customize activity missing");
      ComponentName component = activity.contains("/") ? ComponentName.unflattenFromString(activity)
          : new ComponentName(service.packageName, activity);
      if (component == null || !manager.getActivityInfo(component, 0).exported) {
        throw new AssertionError("Screen saver Customize activity is not accessible");
      }
      return component;
    }
  }
  @Override
  public void onCreate(Bundle arguments) {
    super.onCreate(arguments);
    try {
      fixture = new org.json.JSONArray(new String(java.util.Base64.getDecoder().decode(
          arguments.getString("fixture", "W10=")), java.nio.charset.StandardCharsets.UTF_8));
    } catch (Exception error) {
      throw new RuntimeException(error);
    }
    start();
  }

  private String screenText(AccessibilityNodeInfo node) {
    if (node == null) return "";
    StringBuilder text = new StringBuilder();
    if (node.getText() != null) text.append(node.getText()).append('\n');
    if (node.getContentDescription() != null) text.append(node.getContentDescription()).append('\n');
    for (int index = 0; index < node.getChildCount(); index++) {
      text.append(screenText(node.getChild(index)));
    }
    return text.toString();
  }

  private int systemDialogs = 0;
  private int systemGuides = 0;

  private static boolean has(String text, String expected) {
    return text.toLowerCase(java.util.Locale.ROOT).contains(expected.toLowerCase(java.util.Locale.ROOT));
  }

  // The emulator's own launcher can stall on a slow runner and cover the app with a system dialog.
  // Tap Wait so the app under test stays measurable; the count is reported, not hidden.
  private boolean dismissSystemDialog(UiAutomation automation, String text) {
    AccessibilityNodeInfo root = automation.getRootInActiveWindow();
    if (root != null && "android".contentEquals(root.getPackageName())
        && has(text, "Viewing full screen") && has(text, "Got it")) {
      Rect confirm = textBounds(root, "Got it");
      if (confirm == null) return false;
      systemGuides++;
      tap(automation, confirm.centerX(), confirm.centerY());
      return true;
    }
    if (!has(text, "isn't responding") && !has(text, "isn’t responding")) return false;
    if (!has(text, "Pixel Launcher")) throw new AssertionError("App stopped responding: " + text);
    Rect wait = textBounds(automation.getRootInActiveWindow(), "Wait");
    if (wait == null) return false;
    systemDialogs++;
    tap(automation, wait.centerX(), wait.centerY());
    return true;
  }

  private void awaitScreen(UiAutomation automation, Runnable action, String expected) throws Exception {
    automation.executeAndWaitForEvent(action, event -> {
      String text = screenText(automation.getRootInActiveWindow());
      if (dismissSystemDialog(automation, text)) return false;
      return has(text, expected) && !text.contains("Starting T3 Code")
          && !text.contains("taking longer to start");
    }, 30000);
  }

  private String shell(UiAutomation automation, String command) {
    try (ParcelFileDescriptor descriptor = automation.executeShellCommand(command);
        BufferedReader reader = new BufferedReader(new InputStreamReader(
            new ParcelFileDescriptor.AutoCloseInputStream(descriptor)))) {
      String line;
      StringBuilder output = new StringBuilder();
      while ((line = reader.readLine()) != null) {
        output.append(line).append('\n');
      }
      return output.toString().trim();
    } catch (java.io.IOException error) {
      throw new RuntimeException(error);
    }
  }

  private void startDream(UiAutomation automation) {
    String error = shell(automation, "su 0 cmd dreams start-dreaming");
    if (!error.isEmpty()) throw new AssertionError(error);
  }

  private boolean launcherVisible(UiAutomation automation) {
    AccessibilityNodeInfo root = automation.getRootInActiveWindow();
    if (dismissSystemDialog(automation, screenText(root))) return false;
    return root != null && "com.google.android.apps.nexuslauncher".contentEquals(
        root.getPackageName() == null ? "" : root.getPackageName());
  }

  private void capture(UiAutomation automation, String name) throws Exception {
    automation.waitForIdle(100, 30000);
    File directory = getContext().getExternalFilesDir(null);
    String text = screenText(automation.getRootInActiveWindow());
    try (FileOutputStream file = new FileOutputStream(new File(directory, name + ".txt"))) {
      file.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    Bitmap screenshot = automation.takeScreenshot();
    if (screenshot != null) {
      try (FileOutputStream file = new FileOutputStream(new File(directory, name + ".png"))) {
        screenshot.compress(Bitmap.CompressFormat.PNG, 100, file);
      }
    }
  }

  private Rect textBounds(AccessibilityNodeInfo node, String text) {
    if (node == null) return null;
    if (text.equalsIgnoreCase(node.getText() == null ? "" : node.getText().toString())
        || text.equalsIgnoreCase(node.getContentDescription() == null ? "" : node.getContentDescription().toString())) {
      Rect bounds = new Rect();
      node.getBoundsInScreen(bounds);
      return bounds;
    }
    for (int index = 0; index < node.getChildCount(); index++) {
      Rect found = textBounds(node.getChild(index), text);
      if (found != null) return found;
    }
    return null;
  }

  private AccessibilityNodeInfo namedNode(AccessibilityNodeInfo node, String label) {
    if (node == null) return null;
    if (label.contentEquals(node.getContentDescription() == null ? "" : node.getContentDescription())) return node;
    for (int index = 0; index < node.getChildCount(); index++) {
      AccessibilityNodeInfo found = namedNode(node.getChild(index), label);
      if (found != null) return found;
    }
    return null;
  }

  private void tapText(UiAutomation automation, String text) {
    AccessibilityNodeInfo root = automation.getRootInActiveWindow();
    AccessibilityNodeInfo control = namedNode(root, text);
    Rect bounds = textBounds(root, text);
    if (control != null) {
      bounds = new Rect();
      control.getBoundsInScreen(bounds);
    }
    if (bounds == null || bounds.isEmpty()) throw new AssertionError("Missing control: " + text);
    tap(automation, bounds.centerX(), bounds.centerY());
  }

  private void selectStyle(UiAutomation automation, String name) throws Exception {
    String label = name + " style";
    scrollTo(automation, label, AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD);
    automation.executeAndWaitForEvent(() -> tapText(automation, label), event -> {
      if (dismissSystemDialog(automation, screenText(automation.getRootInActiveWindow()))) return false;
      AccessibilityNodeInfo node = namedNode(automation.getRootInActiveWindow(), label);
      return node != null && node.isChecked();
    }, 30000);
  }

  private AccessibilityNodeInfo scrollable(AccessibilityNodeInfo node) {
    if (node == null) return null;
    if (node.isScrollable()) return node;
    for (int index = 0; index < node.getChildCount(); index++) {
      AccessibilityNodeInfo found = scrollable(node.getChild(index));
      if (found != null) return found;
    }
    return null;
  }

  private void scrollTo(UiAutomation automation, String label) throws Exception {
    scrollTo(automation, label, AccessibilityNodeInfo.ACTION_SCROLL_FORWARD);
  }

  private void scrollTo(UiAutomation automation, String label, int direction) throws Exception {
    for (int step = 0; step < 10; step++) {
      AccessibilityNodeInfo root = automation.getRootInActiveWindow();
      Rect bounds = textBounds(root, label);
      Rect screen = new Rect();
      root.getBoundsInScreen(screen);
      if (bounds != null && !bounds.isEmpty() && screen.contains(bounds)) return;
      AccessibilityNodeInfo list = scrollable(root);
      if (list == null) throw new AssertionError("No list containing " + label);
      automation.executeAndWaitForEvent(() -> {
        if (!list.performAction(direction)) {
          throw new AssertionError("Cannot scroll to " + label);
        }
      }, event -> event.getEventType() == android.view.accessibility.AccessibilityEvent.TYPE_VIEW_SCROLLED, 30000);
    }
    throw new AssertionError("Missing control after scrolling: " + label);
  }

  private void enterText(UiAutomation automation, String label, String value) {
    AccessibilityNodeInfo input = namedNode(automation.getRootInActiveWindow(), label);
    if (input == null) throw new AssertionError("Missing input: " + label);
    Bundle text = new Bundle();
    text.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value);
    if (!input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, text)) {
      throw new AssertionError("Cannot edit " + label);
    }
  }

  private void tap(UiAutomation automation, int x, int y) {
    long time = SystemClock.uptimeMillis();
    MotionEvent down = MotionEvent.obtain(time, time, MotionEvent.ACTION_DOWN, x, y, 0);
    MotionEvent up = MotionEvent.obtain(time, time, MotionEvent.ACTION_UP, x, y, 0);
    try {
      automation.injectInputEvent(down, true);
      automation.injectInputEvent(up, true);
    } finally {
      down.recycle();
      up.recycle();
    }
  }

  private void exitDream(UiAutomation automation) {
    Rect bounds = new Rect();
    automation.getRootInActiveWindow().getBoundsInScreen(bounds);
    tap(automation, bounds.centerX(), bounds.centerY());
  }

  @Override
  public void onStart() {
    Bundle result = new Bundle();
    UiAutomation automation = getUiAutomation();
    boolean passed = false;
    try {
      result.putString("stage", "screen saver picker metadata");
      ComponentName customize = dreamSettings();
      result.putString("pickerMetadata", "PASS");
      Intent launch = getContext().getPackageManager()
          .getLaunchIntentForPackage("com.t3tools.t3code.dream");
      if (launch == null) throw new AssertionError("Installed Dream launcher was not found");
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
      automation.executeAndWaitForEvent(
          () -> getContext().startActivity(launch),
          event -> {
            String text = screenText(automation.getRootInActiveWindow());
            if (dismissSystemDialog(automation, text)) return false;
            return (text.contains("Add environment") && !text.contains("Starting T3 Code")
                && !text.contains("taking longer to start")) || text.contains("couldn’t start")
                || text.contains("couldn't start") || text.contains("keeps stopping");
          },
          30000);
      String text = screenText(automation.getRootInActiveWindow());
      if (!text.contains("Add environment") || text.contains("Starting T3 Code")
          || text.contains("taking longer to start")) throw new AssertionError(text);
      result.putString("main", "PASS");
      capture(automation, "main");
      result.putString("stage", "desk dashboard settings");
      Intent settings = new Intent().setComponent(customize);
      settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      awaitScreen(automation, () -> getContext().startActivity(settings), "Full-screen preview");
      capture(automation, "settings-tiles");
      result.putString("customize", "PASS");
      awaitScreen(automation, () -> tapText(automation, "Full-screen preview"), "Connect your first machine");
      capture(automation, "in-app-preview");
      awaitScreen(automation, () -> tapText(automation, "Close preview"), "Full-screen preview");
      result.putString("preview", "PASS");
      result.putString("stage", "Focus style selection");
      selectStyle(automation, "Focus");
      awaitScreen(automation, () -> startDream(automation), "Connect your first machine");
      if (has(screenText(automation.getRootInActiveWindow()), "Tokens · 24h")) {
        throw new AssertionError("Focus style still renders the small dashboard tiles");
      }
      capture(automation, "dream-focus");
      awaitScreen(automation, () -> exitDream(automation), "Focus style");
      result.putString("stage", "Clock style selection");
      selectStyle(automation, "Clock");
      awaitScreen(automation, () -> startDream(automation), "Connect your first machine");
      capture(automation, "dream-clock");
      automation.executeAndWaitForEvent(
          () -> automation.setRotation(UiAutomation.ROTATION_FREEZE_90), event -> {
            AccessibilityNodeInfo root = automation.getRootInActiveWindow();
            if (dismissSystemDialog(automation, screenText(root))) return false;
            if (root == null) return false;
            Rect bounds = new Rect();
            root.getBoundsInScreen(bounds);
            return bounds.width() > bounds.height() && has(screenText(root), "Connect your first machine");
          }, 30000);
      capture(automation, "dream-clock-landscape");
      awaitScreen(automation, () -> exitDream(automation), "Clock style");
      automation.setRotation(UiAutomation.ROTATION_FREEZE_0);
      result.putString("styles", "PASS");
      result.putString("stage", "tile selection");
      if (has(screenText(automation.getRootInActiveWindow()), "Large tile:")) {
        throw new AssertionError("Clock still exposes unused tile settings");
      }
      selectStyle(automation, "Dashboard");
      scrollTo(automation, "Large tile: Session status");
      awaitScreen(automation, () -> tapText(automation, "Large tile: Session status"), "Empty");
      awaitScreen(automation, () -> tapText(automation, "Cost · 24h"), "Large tile: Cost · 24h");
      awaitScreen(automation, () -> tapText(automation, "Large tile: Cost · 24h"), "Empty");
      awaitScreen(automation, () -> tapText(automation, "Session status"), "Large tile: Session status");
      result.putString("tileSelection", "PASS");
      awaitScreen(automation, () -> getContext().startActivity(settings), "Dashboard style");
      selectStyle(automation, "Clock");
      result.putString("stage", "cold Customize and saved style");
      automation.executeAndWaitForEvent(() -> {
        automation.injectInputEvent(new android.view.KeyEvent(
            android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_HOME), true);
        automation.injectInputEvent(new android.view.KeyEvent(
            android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_HOME), true);
      }, event -> launcherVisible(automation), 30000);
      shell(automation, "am force-stop com.t3tools.t3code.dream");
      awaitScreen(automation, () -> getContext().startActivity(settings), "Clock style");
      AccessibilityNodeInfo clock = namedNode(automation.getRootInActiveWindow(), "Clock style");
      if (clock == null || !clock.isChecked()) throw new AssertionError("Saved Clock style was lost");
      result.putString("coldCustomize", "PASS");
      selectStyle(automation, "Dashboard");
      capture(automation, "settings-restored");
      awaitScreen(automation, () -> getContext().startActivity(launch), "Add environment");
      result.putString("stage", "first Dream start");
      awaitScreen(automation, () -> startDream(automation), "Connect your first machine");
      capture(automation, "dream-portrait");
      result.putString("stage", "Dream rotation");
      automation.executeAndWaitForEvent(
          () -> automation.setRotation(UiAutomation.ROTATION_FREEZE_90),
          event -> {
            AccessibilityNodeInfo root = automation.getRootInActiveWindow();
            if (dismissSystemDialog(automation, screenText(root))) return false;
            if (root == null) return false;
            Rect bounds = new Rect();
            root.getBoundsInScreen(bounds);
            Rect title = textBounds(root, "Connect your first machine");
            return bounds.width() > bounds.height() && title != null && bounds.contains(title);
          }, 30000);
      capture(automation, "dream-landscape");
      result.putString("stage", "touch exits Dream");
      awaitScreen(automation, () -> exitDream(automation), "Add environment");
      capture(automation, "after-dream");
      result.putString("stage", "second Dream start");
      awaitScreen(automation, () -> startDream(automation), "Connect your first machine");
      result.putString("stage", "second Dream exit");
      awaitScreen(automation, () -> exitDream(automation), "Add environment");
      result.putString("stage", "cold Dream start");
      String previousPid = shell(automation, "pidof com.t3tools.t3code.dream");
      automation.executeAndWaitForEvent(
          () -> {
            automation.injectInputEvent(new android.view.KeyEvent(
                android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_HOME), true);
            automation.injectInputEvent(new android.view.KeyEvent(
                android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_HOME), true);
          }, event -> launcherVisible(automation), 30000);
      shell(automation, "am force-stop com.t3tools.t3code.dream");
      awaitScreen(automation, () -> startDream(automation), "Connect your first machine");
      String dreamPid = shell(automation, "pidof com.t3tools.t3code.dream");
      if (previousPid.isEmpty() || dreamPid.isEmpty() || previousPid.equals(dreamPid)) {
        throw new AssertionError("Cold Dream did not start a new app process");
      }
      result.putString("coldDream", "PASS");
      capture(automation, "dream-cold");
      result.putString("stage", "app after cold Dream");
      automation.executeAndWaitForEvent(
          () -> exitDream(automation), event -> launcherVisible(automation), 30000);
      awaitScreen(automation, () -> getContext().startActivity(launch), "Add environment");
      capture(automation, "app-after-cold-dream");
      result.putString("dream", "PASS");
      result.putString("stage", "system screen saver picker");
      Intent picker = new Intent(android.provider.Settings.ACTION_DREAM_SETTINGS)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      awaitScreen(automation, () -> getContext().startActivity(picker), "Customize");
      capture(automation, "screen-saver-picker");
      if (!has(screenText(automation.getRootInActiveWindow()), "T3 Code")) {
        throw new AssertionError("T3 Code is missing from Android's picker");
      }
      awaitScreen(automation, () -> tapText(automation, "Customize"), "Dashboard style");
      capture(automation, "system-customize");
      result.putString("systemCustomize", "PASS");
      if (fixture.length() > 0) {
        result.putString("stage", "pair isolated showcase environments");
        for (int index = 0; index < fixture.length(); index++) {
          Intent pair = new Intent(Intent.ACTION_VIEW,
              android.net.Uri.parse("t3code-dream://connections/new"))
              .setPackage("com.t3tools.t3code.dream").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
          awaitScreen(automation, () -> getContext().startActivity(pair), "Address");
          enterText(automation, "Address", fixture.getJSONObject(index).getString("address"));
          enterText(automation, "Code", fixture.getJSONObject(index).getString("code"));
          automation.executeAndWaitForEvent(() -> tapText(automation, "Add environment"), event -> {
            String view = screenText(automation.getRootInActiveWindow());
            if (dismissSystemDialog(automation, view)) return false;
            return !has(view, "Address") && !has(view, "Connecting") && !has(view, "Starting T3 Code");
          }, 30000);
        }
        awaitScreen(automation, () -> getContext().startActivity(settings), "Dashboard style");
        result.putString("paired", "PASS");
        String[][] sizes = {
          { "phone", "1080x1920", "480", "0" },
          { "phone-landscape", "1080x1920", "480", "1" },
          { "tablet", "1920x1200", "240", "0" },
          { "tablet-portrait", "1920x1200", "240", "1" }
        };
        for (String style : new String[] { "Dashboard", "Focus", "Clock" }) {
          selectStyle(automation, style);
          for (String[] viewport : sizes) {
            result.putString("stage", style + " " + viewport[0]);
            shell(automation, "wm size " + viewport[1]);
            shell(automation, "wm density " + viewport[2]);
            automation.setRotation("1".equals(viewport[3]) ? UiAutomation.ROTATION_FREEZE_90 : UiAutomation.ROTATION_FREEZE_0);
            awaitScreen(automation, () -> startDream(automation), "Clock".equals(style) ? "working" : "Session status");
            String display = screenText(automation.getRootInActiveWindow());
            if (has(display, "Connect your first machine") || has(display, "Waiting for a connection")) {
              throw new AssertionError("Paired screen saver lost live data");
            }
            capture(automation, "live-" + style.toLowerCase(java.util.Locale.ROOT) + "-" + viewport[0]);
            Rect screen = new Rect();
            AccessibilityNodeInfo root = automation.getRootInActiveWindow();
            root.getBoundsInScreen(screen);
            for (String label : "Dashboard".equals(style)
                ? new String[] { "Session status", "Tokens · 24h", "Cost · 24h", "Quota remaining", "Working" }
                : "Focus".equals(style) ? new String[] { "Session status", "Working", "Input", "Questions", "Finished" } : new String[0]) {
              Rect item = textBounds(root, label);
              if (item == null || item.isEmpty() || !screen.contains(item)) {
                throw new AssertionError("Clipped " + label + " in " + style + " " + viewport[0]);
              }
            }
            awaitScreen(automation, () -> exitDream(automation), style + " style");
          }
          shell(automation, "wm size reset");
          shell(automation, "wm density reset");
          automation.setRotation(UiAutomation.ROTATION_FREEZE_0);
        }
        result.putString("responsiveStyles", "PASS");
      }
      result.putString("stage", "unsupported device capability");
      ComponentName systemSettings = new Intent(android.provider.Settings.ACTION_DREAM_SETTINGS)
          .resolveActivity(getContext().getPackageManager());
      if (systemSettings == null) throw new AssertionError("Test system has no screen saver settings");
      try {
        shell(automation, "pm disable-user --user 0 " + systemSettings.flattenToString());
        automation.injectInputEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_HOME), true);
        automation.injectInputEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_HOME), true);
        shell(automation, "am force-stop com.t3tools.t3code.dream");
        awaitScreen(automation, () -> getContext().startActivity(settings), "Screen savers aren’t available");
        capture(automation, "unsupported-direct-link");
        Intent index = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse("t3code-dream://settings"))
            .setPackage("com.t3tools.t3code.dream").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        awaitScreen(automation, () -> getContext().startActivity(index), "Appearance");
        if (has(screenText(automation.getRootInActiveWindow()), "Desk dashboard")) {
          throw new AssertionError("Unsupported screen saver is still in Settings");
        }
        capture(automation, "unsupported-settings");
        result.putString("capabilityGate", "PASS");
      } finally {
        shell(automation, "pm enable --user 0 " + systemSettings.flattenToString());
      }
      passed = true;
    } catch (Throwable error) {
      result.putString("failure", error.toString());
    } finally {
      String text = screenText(automation.getRootInActiveWindow());
      result.putString("screen", text);
      result.putString("systemDialogsDismissed", String.valueOf(systemDialogs));
      result.putString("systemGuidesDismissed", String.valueOf(systemGuides));
      result.putString("startup", passed ? "PASS" : "FAIL");
      try {
        capture(automation, "screen");
        shell(automation, "wm size reset");
        shell(automation, "wm density reset");
        automation.setRotation(UiAutomation.ROTATION_UNFREEZE);
      } catch (Throwable error) {
        result.putString("captureFailure", error.toString());
      }
      finish(passed ? -1 : 0, result);
    }
  }
}

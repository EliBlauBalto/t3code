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
  private void setFixtureConnection(String control, boolean online) {
    java.net.HttpURLConnection connection = null;
    try {
      connection = (java.net.HttpURLConnection) new java.net.URL(
          control + (online ? "/online" : "/offline")).openConnection();
      connection.setRequestMethod("POST");
      connection.setConnectTimeout(10000);
      connection.setReadTimeout(10000);
      if (connection.getResponseCode() != 200) throw new AssertionError("Fixture control rejected");
      try (java.io.InputStream input = connection.getInputStream()) {
        while (input.read() != -1) { }
      }
    } catch (java.io.IOException error) {
      throw new AssertionError("Disposable connection control failed", error);
    } finally {
      if (connection != null) connection.disconnect();
    }
  }
  private String appId = "com.t3tools.t3code.dream";
  private String appScheme = "t3code-dream";
  private ComponentName dreamSettings() throws Exception {
    PackageManager manager = getContext().getPackageManager();
    ServiceInfo service = manager.getServiceInfo(new ComponentName(appId,
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
      appId = arguments.getString("appId", appId);
      if (!"com.t3tools.t3code.dream".equals(appId) && !"com.t3tools.t3code".equals(appId)) {
        throw new IllegalArgumentException("Unexpected Dream test package");
      }
      appScheme = "com.t3tools.t3code".equals(appId) ? "t3code" : "t3code-dream";
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

  private String screenTree(AccessibilityNodeInfo node) {
    if (node == null) return "";
    Rect bounds = new Rect();
    node.getBoundsInScreen(bounds);
    StringBuilder tree = new StringBuilder();
    tree.append(node.getClassName()).append(' ').append(bounds.flattenToString())
        .append(" actions=").append(node.getActionList())
        .append(" text=").append(node.getText())
        .append(" label=").append(node.getContentDescription()).append('\n');
    for (int index = 0; index < node.getChildCount(); index++) {
      tree.append(screenTree(node.getChild(index)));
    }
    return tree.toString();
  }

  private int systemDialogs = 0;
  private int systemGuides = 0;

  private static boolean has(String text, String expected) {
    return text.replace('\u00a0', ' ').toLowerCase(java.util.Locale.ROOT)
        .contains(expected.replace('\u00a0', ' ').toLowerCase(java.util.Locale.ROOT));
  }

  // The emulator's own launcher can stall on a slow runner and cover the app with a system dialog.
  // Close only the stalled launcher; app ANRs fail and the system-dialog count is reported.
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
    Rect wait = textBounds(automation.getRootInActiveWindow(), "Close app");
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
    automation.waitForIdle(1000, 30000);
    File directory = getContext().getExternalFilesDir(null);
    String text = screenText(automation.getRootInActiveWindow());
    try (FileOutputStream file = new FileOutputStream(new File(directory, name + ".txt"))) {
      file.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    try (FileOutputStream file = new FileOutputStream(new File(directory, name + ".tree.txt"))) {
      file.write(screenTree(automation.getRootInActiveWindow()).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    Bitmap screenshot = automation.takeScreenshot();
    if (screenshot == null) throw new AssertionError("Screenshot unavailable: " + name);
    try {
      try (FileOutputStream file = new FileOutputStream(new File(directory, name + ".png"))) {
        screenshot.compress(Bitmap.CompressFormat.PNG, 100, file);
      }
    } finally {
      screenshot.recycle();
    }
  }

  private void captureRuntimeStats(UiAutomation automation, String name) throws Exception {
    for (String kind : new String[] { "gfxinfo", "meminfo" }) {
      try (FileOutputStream file = new FileOutputStream(
          new File(getContext().getExternalFilesDir(null), name + "-" + kind + ".txt"))) {
        file.write(shell(automation, "dumpsys " + kind + " " + appId)
            .getBytes(java.nio.charset.StandardCharsets.UTF_8));
      }
    }
  }

  private String clockText(UiAutomation automation) {
    java.util.regex.Matcher clock = java.util.regex.Pattern.compile("\\b\\d{1,2}:\\d{2}\\b")
        .matcher(screenText(automation.getRootInActiveWindow()));
    return clock.find() ? clock.group() : "";
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

  private Rect phraseBounds(AccessibilityNodeInfo node, String phrase) {
    if (node == null) return null;
    if ((node.getText() != null && has(node.getText().toString(), phrase))
        || (node.getContentDescription() != null && has(node.getContentDescription().toString(), phrase))) {
      Rect bounds = new Rect();
      node.getBoundsInScreen(bounds);
      return bounds;
    }
    for (int index = 0; index < node.getChildCount(); index++) {
      Rect found = phraseBounds(node.getChild(index), phrase);
      if (found != null) return found;
    }
    return null;
  }

  private void awaitPopulatedLayout(UiAutomation automation, String style, boolean landscape,
      boolean compactStatus, boolean tokensPrimary, int failedCount) throws Exception {
    automation.executeAndWaitForEvent(() -> startDream(automation), event -> {
      AccessibilityNodeInfo root = automation.getRootInActiveWindow();
      String view = screenText(root);
      if (dismissSystemDialog(automation, view) || !dreamVisible(root)) return false;
      Rect bounds = new Rect();
      root.getBoundsInScreen(bounds);
      Rect live = phraseBounds(root, "Live");
      String clockValue = clockText(automation);
      Rect clock = clockValue.isEmpty() ? null : textBounds(root, clockValue);
      if ((bounds.width() > bounds.height()) != landscape
          || live == null || live.isEmpty() || !bounds.contains(live)
          || clock == null || clock.isEmpty() || !bounds.contains(clock)
          || (failedCount > 0 && !has(view, failedCount + " failed"))) return false;
      if ("Clock".equals(style)) {
        Rect summary = phraseBounds(root, "Session status.");
        if (summary == null) summary = phraseBounds(root, "need you");
        return summary != null && !summary.isEmpty() && bounds.contains(summary) && statusRowsFit(root);
      }
      Rect status = phraseBounds(root, "Session status.");
      if (status == null || status.isEmpty() || !bounds.contains(status)) return false;
      if (!statusRowsFit(root)) return false;
      if (!"Dashboard".equals(style)) return true;
      for (String label : new String[] { "300K", "$0.96", "36%" }) {
        Rect item = textBounds(root, label);
        if (item == null || item.isEmpty() || !bounds.contains(item)) return false;
      }
      Rect tokens = textBounds(root, "24h tokens");
      if (tokens == null || tokens.isEmpty() || !bounds.contains(tokens)) return false;
      return status.bottom <= tokens.top && metricReadingsFit(root);
    }, 30000);
  }

  private boolean statusRowsFit(AccessibilityNodeInfo root) {
    return readingFits(root, "Session status.") || readingFits(root, "Partial session status.");
  }

  private AccessibilityNodeInfo readingNode(AccessibilityNodeInfo node, String label) {
    if (node == null) return null;
    if (node.getContentDescription() != null && has(node.getContentDescription().toString(), label)) return node;
    for (int index = 0; index < node.getChildCount(); index++) {
      AccessibilityNodeInfo child = readingNode(node.getChild(index), label);
      if (child != null) return child;
    }
    return null;
  }

  private int visibleTextCount(AccessibilityNodeInfo node, Rect reading) {
    if (node == null) return 0;
    int count = 0;
    if (node.getText() != null && !node.getText().toString().trim().isEmpty()) {
      Rect bounds = new Rect();
      node.getBoundsInScreen(bounds);
      if (bounds.isEmpty() || !reading.contains(bounds)) return -1;
      count++;
    }
    for (int index = 0; index < node.getChildCount(); index++) {
      int child = visibleTextCount(node.getChild(index), reading);
      if (child < 0) return -1;
      count += child;
    }
    return count;
  }

  private boolean readingFits(AccessibilityNodeInfo root, String label) {
    AccessibilityNodeInfo node = readingNode(root, label);
    if (node == null) return false;
    Rect reading = new Rect();
    node.getBoundsInScreen(reading);
    Rect screen = new Rect();
    root.getBoundsInScreen(screen);
    return !reading.isEmpty() && screen.contains(reading) && visibleTextCount(node, reading) > 0;
  }

  private boolean metricReadingsFit(AccessibilityNodeInfo root) {
    for (String label : new String[] { "24h tokens.", "24h cost.", "Quota left." }) {
      if (!readingFits(root, label)) return false;
    }
    return true;
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
    AccessibilityNodeInfo selected = namedNode(automation.getRootInActiveWindow(), label);
    if (selected != null && selected.isChecked()) return;
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

  private int actionId(AccessibilityNodeInfo node, String label) {
    for (AccessibilityNodeInfo.AccessibilityAction action : node.getActionList()) {
      if (label.contentEquals(action.getLabel() == null ? "" : action.getLabel())) return action.getId();
    }
    return 0;
  }

  private AccessibilityNodeInfo actionNode(AccessibilityNodeInfo node, String label) {
    if (node == null) return null;
    if (actionId(node, label) != 0) return node;
    for (int index = 0; index < node.getChildCount(); index++) {
      AccessibilityNodeInfo found = actionNode(node.getChild(index), label);
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
      if (root == null || (scrollable(root) == null && textBounds(root, label) == null)) {
        automation.executeAndWaitForEvent(() -> {}, event -> {
          AccessibilityNodeInfo ready = automation.getRootInActiveWindow();
          return ready != null && (scrollable(ready) != null || textBounds(ready, label) != null);
        }, 30000);
        root = automation.getRootInActiveWindow();
      }
      if (root == null) throw new AssertionError("Window changed before scrolling to " + label);
      Rect bounds = textBounds(root, label);
      AccessibilityNodeInfo list = scrollable(root);
      Rect screen = new Rect();
      (list == null ? root : list).getBoundsInScreen(screen);
      if (bounds != null && !bounds.isEmpty() && screen.contains(bounds)) return;
      if (bounds != null && !bounds.isEmpty()) {
        direction = bounds.top < screen.top ? AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD : AccessibilityNodeInfo.ACTION_SCROLL_FORWARD;
      }
      if (list == null) throw new AssertionError("No list containing " + label);
      int action = direction;
      try {
        automation.executeAndWaitForEvent(() -> {
          if (!list.performAction(action)) throw new ScrollEnd();
        }, event -> {
          Rect reached = textBounds(automation.getRootInActiveWindow(), label);
          return event.getEventType() == android.view.accessibility.AccessibilityEvent.TYPE_VIEW_SCROLLED
              || (reached != null && !reached.isEmpty());
        }, 30000);
        automation.waitForIdle(100, 30000);
      } catch (ScrollEnd end) {
        direction = action == AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
            ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD;
      }
    }
    throw new AssertionError("Missing control after scrolling: " + label);
  }

  private static final class ScrollEnd extends RuntimeException { }

  private void selectMainReading(UiAutomation automation, String current, String next) throws Exception {
    selectMainReading(automation, current, next, null);
  }

  private void selectMainReading(UiAutomation automation, String current, String next, String captureName) throws Exception {
    String currentLabel = "Main reading: " + current;
    scrollTo(automation, currentLabel);
    automation.executeAndWaitForEvent(() -> tapText(automation, currentLabel), event -> {
      Rect title = textBounds(automation.getRootInActiveWindow(), "Main reading");
      return title != null && !title.isEmpty();
    }, 30000);
    AccessibilityNodeInfo sheet = actionNode(automation.getRootInActiveWindow(), "Expand");
    if (sheet != null) {
      Rect title = textBounds(automation.getRootInActiveWindow(), "Main reading");
      automation.executeAndWaitForEvent(() -> {
        if (!sheet.performAction(actionId(sheet, "Expand"))) {
          throw new AssertionError("Cannot expand the tile picker");
        }
      }, event -> {
        Rect expanded = textBounds(automation.getRootInActiveWindow(), "Main reading");
        return title != null && expanded != null && expanded.top < title.top;
      }, 30000);
      automation.waitForIdle(100, 30000);
    }
    scrollTo(automation, next);
    if (captureName != null) capture(automation, captureName);
    awaitScreen(automation, () -> tapText(automation, next), "Main reading: " + next);
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

  private boolean dreamVisible(AccessibilityNodeInfo root) {
    if (root == null || root.getPackageName() == null
        || !appId.contentEquals(root.getPackageName())) return false;
    for (AccessibilityNodeInfo.AccessibilityAction action : root.getActionList()) {
      if (action.getId() == AccessibilityNodeInfo.ACTION_CLICK
          && action.getLabel() != null && "dismiss".equalsIgnoreCase(action.getLabel().toString())) return true;
    }
    return false;
  }

  private void awaitDream(UiAutomation automation, String expected) throws Exception {
    automation.executeAndWaitForEvent(() -> startDream(automation), event -> {
      AccessibilityNodeInfo root = automation.getRootInActiveWindow();
      String text = screenText(root);
      if (dismissSystemDialog(automation, text)) return false;
      return dreamVisible(root) && has(text, expected) && !has(text, "Starting T3 Code");
    }, 30000);
  }

  private void awaitDreamExit(UiAutomation automation, String expected) throws Exception {
    if (!dreamVisible(automation.getRootInActiveWindow())) {
      automation.executeAndWaitForEvent(() -> {},
          event -> dreamVisible(automation.getRootInActiveWindow()), 30000);
    }
    awaitScreen(automation, () -> exitDream(automation), expected);
  }

  private void exitDream(UiAutomation automation) {
    AccessibilityNodeInfo root = automation.getRootInActiveWindow();
    if (!dreamVisible(root)) throw new AssertionError("Dream window changed before exit");
    Rect bounds = new Rect();
    root.getBoundsInScreen(bounds);
    tap(automation, bounds.centerX(), bounds.centerY());
  }

  private void exitDreamToSettings(UiAutomation automation, Intent settings) throws Exception {
    awaitDreamExit(automation, "Chats");
    if (!has(screenText(automation.getRootInActiveWindow()), "Dashboard style")) {
      awaitScreen(automation, () -> getContext().startActivity(settings), "Dashboard style");
    }
  }

  private void restoreSettingsAfterResize(UiAutomation automation, Intent settings, Intent launch) throws Exception {
    awaitScreen(automation, () -> getContext().startActivity(launch), "Chats");
    awaitScreen(automation, () -> getContext().startActivity(settings), "Dashboard style");
  }

  @Override
  public void onStart() {
    Bundle result = new Bundle();
    UiAutomation automation = getUiAutomation();
    boolean passed = false;
    result.putString("appId", appId);
    try {
      result.putString("stage", "screen saver picker metadata");
      ComponentName customize = dreamSettings();
      result.putString("pickerMetadata", "PASS");
      Intent launch = getContext().getPackageManager()
          .getLaunchIntentForPackage(appId);
      if (launch == null) throw new AssertionError("Installed Dream launcher was not found");
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
      result.putString("stage", "main startup");
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
      result.putString("stage", "in-app preview");
      awaitScreen(automation, () -> tapText(automation, "Full-screen preview"), "Sample preview");
      capture(automation, "in-app-preview");
      automation.executeAndWaitForEvent(() -> tapText(automation, "Landscape preview"), event -> {
        AccessibilityNodeInfo option = namedNode(automation.getRootInActiveWindow(), "Landscape preview");
        return option != null && option.isSelected();
      }, 30000);
      capture(automation, "in-app-preview-landscape");
      awaitScreen(automation, () -> tapText(automation, "Close preview"), "Full-screen preview");
      result.putString("preview", "PASS");
      result.putString("stage", "Focus style selection");
      selectStyle(automation, "Focus");
      awaitScreen(automation, () -> tapText(automation, "Full-screen preview"), "Sample preview");
      capture(automation, "sample-preview-focus");
      awaitScreen(automation, () -> tapText(automation, "Close preview"), "Full-screen preview");
      awaitDream(automation, "Connect your first machine");
      if (has(screenText(automation.getRootInActiveWindow()), "24h tokens")) {
        throw new AssertionError("Focus style still renders the small dashboard tiles");
      }
      capture(automation, "dream-focus");
      exitDreamToSettings(automation, settings);
      result.putString("stage", "Clock style selection");
      selectStyle(automation, "Clock");
      awaitScreen(automation, () -> tapText(automation, "Full-screen preview"), "Sample preview");
      capture(automation, "sample-preview-clock");
      awaitScreen(automation, () -> tapText(automation, "Close preview"), "Full-screen preview");
      awaitDream(automation, "Connect your first machine");
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
      exitDreamToSettings(automation, settings);
      automation.setRotation(UiAutomation.ROTATION_FREEZE_0);
      result.putString("styles", "PASS");
      result.putString("stage", "tile selection");
      if (has(screenText(automation.getRootInActiveWindow()), "Main reading:")) {
        throw new AssertionError("Clock still exposes unused tile settings");
      }
      selectStyle(automation, "Dashboard");
      selectMainReading(automation, "Session status", "24h cost");
      selectMainReading(automation, "24h cost", "Session status");
      result.putString("tileSelection", "PASS");
      scrollTo(automation, "Reading 4: Empty");
      capture(automation, "settings-readings");
      scrollTo(automation, "Dashboard style", AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD);
      selectStyle(automation, "Clock");
      result.putString("stage", "cold Customize and saved style");
      automation.executeAndWaitForEvent(() -> {
        automation.injectInputEvent(new android.view.KeyEvent(
            android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_HOME), true);
        automation.injectInputEvent(new android.view.KeyEvent(
            android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_HOME), true);
      }, event -> launcherVisible(automation), 30000);
      shell(automation, "am force-stop " + appId);
      awaitScreen(automation, () -> getContext().startActivity(settings), "Clock style");
      AccessibilityNodeInfo clock = namedNode(automation.getRootInActiveWindow(), "Clock style");
      if (clock == null || !clock.isChecked()) throw new AssertionError("Saved Clock style was lost");
      result.putString("coldCustomize", "PASS");
      selectStyle(automation, "Dashboard");
      capture(automation, "settings-restored");
      awaitScreen(automation, () -> getContext().startActivity(launch), "Add environment");
      result.putString("stage", "first Dream start");
      awaitDream(automation, "Connect your first machine");
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
      awaitDreamExit(automation, "Add environment");
      capture(automation, "after-dream");
      result.putString("stage", "second Dream start");
      awaitDream(automation, "Connect your first machine");
      result.putString("stage", "second Dream exit");
      awaitDreamExit(automation, "Add environment");
      result.putString("stage", "cold Dream start");
      String previousPid = shell(automation, "pidof " + appId);
      automation.executeAndWaitForEvent(
          () -> {
            automation.injectInputEvent(new android.view.KeyEvent(
                android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_HOME), true);
            automation.injectInputEvent(new android.view.KeyEvent(
                android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_HOME), true);
          }, event -> launcherVisible(automation), 30000);
      shell(automation, "am force-stop " + appId);
      awaitDream(automation, "Connect your first machine");
      String dreamPid = shell(automation, "pidof " + appId);
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
      scrollTo(automation, "Customize T3 Code");
      capture(automation, "screen-saver-picker");
      if (!has(screenText(automation.getRootInActiveWindow()), "T3 Code")) {
        throw new AssertionError("T3 Code is missing from Android's picker");
      }
      awaitScreen(automation, () -> tapText(automation, "Customize T3 Code"), "Dashboard style");
      capture(automation, "system-customize");
      result.putString("systemCustomize", "PASS");
      if (fixture.length() > 0) {
        int expectedFailed = 0;
        for (int index = 0; index < fixture.length(); index++) {
          expectedFailed += fixture.getJSONObject(index).optInt("expectedFailed", 0);
        }
        final int failedCount = expectedFailed;
        result.putString("expectedFailed", Integer.toString(failedCount));
        result.putString("stage", "pair isolated showcase environments");
        for (int index = 0; index < fixture.length(); index++) {
          result.putString("stage", "pair isolated showcase environment " + (index + 1));
          Intent pair = new Intent(Intent.ACTION_VIEW,
              android.net.Uri.parse(appScheme + "://connections/new"))
              .setPackage(appId).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
          awaitScreen(automation, () -> getContext().startActivity(pair), "Address");
          AccessibilityNodeInfo submit = namedNode(automation.getRootInActiveWindow(), "Add environment");
          if (submit == null) throw new AssertionError("Pairing submit control missing");
          if (submit.isEnabled()) {
            automation.executeAndWaitForEvent(() -> enterText(automation, "Address", ""), event -> {
              AccessibilityNodeInfo disabled = namedNode(automation.getRootInActiveWindow(), "Add environment");
              return disabled != null && !disabled.isEnabled();
            }, 30000);
          }
          String pairingCode = fixture.getJSONObject(index).getString("code");
          enterText(automation, "Code", pairingCode);
          String address = fixture.getJSONObject(index).getString("address");
          automation.executeAndWaitForEvent(() -> enterText(automation, "Address", address), event -> {
            AccessibilityNodeInfo ready = namedNode(automation.getRootInActiveWindow(), "Add environment");
            return ready != null && ready.isEnabled();
          }, 30000);
          automation.executeAndWaitForEvent(() -> tapText(automation, "Add environment"), event -> {
            String view = screenText(automation.getRootInActiveWindow());
            if (dismissSystemDialog(automation, view)) return false;
            return !has(view, "Address") && !has(view, "Connecting") && !has(view, "Starting T3 Code");
          }, 30000);
        }
        awaitScreen(automation, () -> getContext().startActivity(settings), "Dashboard style");
        result.putString("paired", "PASS");
        if (fixture.getJSONObject(0).optBoolean("statusFixture", false)) {
          result.putString("scope", "focused synthetic compact status; standard suite is separate");
          result.putString("stage", "compact failed, limited and waiting status matrix");
          String previousFontScale = shell(automation, "settings get system font_scale");
          boolean allVisible = true;
          StringBuilder cases = new StringBuilder();
          try {
            shell(automation, "wm size 1080x1920");
            shell(automation, "wm density 480");
            automation.setRotation(UiAutomation.ROTATION_FREEZE_0);
            restoreSettingsAfterResize(automation, settings, launch);
            selectStyle(automation, "Dashboard");
            selectMainReading(automation, "Session status", "24h tokens", "reading-picker");
            for (String style : new String[] { "Dashboard", "Focus", "Clock" }) {
              if ("Focus".equals(style)) {
                selectMainReading(automation, "24h tokens", "Session status");
                selectStyle(automation, "Focus");
              } else if ("Clock".equals(style)) {
                selectStyle(automation, "Clock");
              }
              for (String fontScale : new String[] { "1.0", "1.5", "2.0" }) {
                shell(automation, "settings put system font_scale " + fontScale);
                for (int rotation = 0; rotation < 2; rotation++) {
                  result.putString("stage", "status " + style + " font " + fontScale + " rotation " + rotation);
                  final boolean landscape = rotation == 1;
                  automation.setRotation(landscape
                      ? UiAutomation.ROTATION_FREEZE_90 : UiAutomation.ROTATION_FREEZE_0);
                  automation.executeAndWaitForEvent(() -> startDream(automation), event -> {
                    AccessibilityNodeInfo root = automation.getRootInActiveWindow();
                    if (dismissSystemDialog(automation, screenText(root)) || !dreamVisible(root)) return false;
                    Rect bounds = new Rect();
                    root.getBoundsInScreen(bounds);
                    Rect status = phraseBounds(root, "Clock".equals(style) ? "failed" : "Session status");
                    Rect live = phraseBounds(root, "Live");
                    return (bounds.width() > bounds.height()) == landscape
                        && status != null && !status.isEmpty() && bounds.contains(status)
                        && live != null && !live.isEmpty() && bounds.contains(live)
                        && statusRowsFit(root) && (!"Dashboard".equals(style) || metricReadingsFit(root));
                  }, 30000);
                  automation.waitForIdle(100, 30000);
                  String name = "blocked-" + style.toLowerCase(java.util.Locale.ROOT)
                      + "-font-" + fontScale.replace('.', '-')
                      + (landscape ? "-landscape" : "-portrait");
                  capture(automation, name);
                  String view = screenText(automation.getRootInActiveWindow());
                  boolean visible = has(view, "1 limited") && has(view, "1 waiting");
                  allVisible &= visible;
                  cases.append(name).append(" limitedAndWaiting=").append(visible).append('\n');
                  exitDreamToSettings(automation, settings);
                }
              }
            }
          } finally {
            shell(automation, "null".equals(previousFontScale)
                ? "settings delete system font_scale"
                : "settings put system font_scale " + Float.parseFloat(previousFontScale));
            try (FileOutputStream output = new FileOutputStream(new File(
                getContext().getExternalFilesDir(null), "status-visibility.txt"))) {
              output.write(cases.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
          }
          restoreSettingsAfterResize(automation, settings, launch);
          selectStyle(automation, "Dashboard");
          result.putString("compactStatusCases", cases.toString());
          if (!allVisible) throw new AssertionError("Compact status lost seeded limited/waiting sessions");
          result.putString("compactStatusCoverage", "PASS");
          passed = true;
          return;
        }
        result.putString("stage", "live connection changes during an active Dream");
        String connectionControl = fixture.getJSONObject(1).getString("connectionControl");
        shell(automation, "wm size 1080x1920");
        shell(automation, "wm density 480");
        automation.setRotation(UiAutomation.ROTATION_FREEZE_0);
        awaitPopulatedLayout(automation, "Dashboard", false, false, false, failedCount);
        String connectionPid = shell(automation, "pidof " + appId);
        try (BufferedReader recording = new BufferedReader(new InputStreamReader(
            new ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand(
                "screenrecord --time-limit 20 --bit-rate 2000000 "
                    + new File(getContext().getExternalFilesDir(null),
                        "connection-transitions.mp4").getAbsolutePath()))))) {
          capture(automation, "connection-live-before");
          for (boolean online : new boolean[] { false, true }) {
            automation.executeAndWaitForEvent(() -> setFixtureConnection(connectionControl, online), event -> {
              AccessibilityNodeInfo root = automation.getRootInActiveWindow();
              String view = screenText(root);
              if (dismissSystemDialog(automation, view) || !dreamVisible(root)) return false;
              Rect bounds = new Rect();
              root.getBoundsInScreen(bounds);
              Rect tokens = textBounds(root, "24h tokens");
              return has(view, online ? "Live" : "1 of 2 machines live")
                  && has(view, online ? "300K" : "150K")
                  && has(view, online ? "$0.96" : "$0.48")
                  && !clockText(automation).isEmpty()
                  && tokens != null && !tokens.isEmpty() && bounds.contains(tokens);
            }, 30000);
            capture(automation, online ? "connection-live-restored" : "connection-partial");
          }
          result.putString("connectionTransitions", "PASS");
          result.putString("stage", "rotate populated Dream in place");
          for (boolean landscape : new boolean[] { true, false }) {
            automation.executeAndWaitForEvent(() -> automation.setRotation(landscape
                ? UiAutomation.ROTATION_FREEZE_90 : UiAutomation.ROTATION_FREEZE_0), event -> {
              AccessibilityNodeInfo root = automation.getRootInActiveWindow();
              if (!dreamVisible(root)) return false;
              Rect bounds = new Rect();
              root.getBoundsInScreen(bounds);
              Rect status = phraseBounds(root, "Session status.");
              Rect tokens = textBounds(root, "24h tokens");
              Rect connection = textBounds(root, "Live \u00b7 2 machines");
              String view = screenText(root);
              return (bounds.width() > bounds.height()) == landscape
                  && status != null && !status.isEmpty() && bounds.contains(status)
                  && tokens != null && !tokens.isEmpty() && bounds.contains(tokens)
                  && (!landscape || tokens.top >= status.bottom)
                  && connection != null && connection.height() > 8
                  && bounds.contains(connection) && connection.bottom <= bounds.bottom - 8
                  && has(view, "300K") && has(view, "$0.96") && has(view, "36%");
            }, 30000);
            capture(automation, landscape ? "active-rotation-landscape" : "active-rotation-portrait");
          }
          if (!connectionPid.equals(shell(automation, "pidof " + appId))) {
            throw new AssertionError("Connection/rotation test restarted the app process");
          }
          result.putString("activeDreamRotation", "PASS");
          try (FileOutputStream file = new FileOutputStream(new File(
              getContext().getExternalFilesDir(null), "connection-recording.txt"))) {
            file.write(recording.lines().collect(java.util.stream.Collectors.joining("\n"))
                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
          }
        } finally {
          setFixtureConnection(connectionControl, true);
        }
        exitDreamToSettings(automation, settings);
        scrollTo(automation, "Full-screen preview", AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD);
        capture(automation, "populated-settings-preview");
        awaitScreen(automation, () -> tapText(automation, "Full-screen preview"), "300K");
        capture(automation, "populated-in-app-preview");
        awaitScreen(automation, () -> tapText(automation, "Close preview"), "Full-screen preview");
        scrollTo(automation, "Reading 4: Empty");
        capture(automation, "settings-tile-editor-visible");
        selectStyle(automation, "Focus");
        selectMainReading(automation, "Session status", "24h tokens");
        awaitDream(automation, "300K");
        capture(automation, "focus-tokens-phone");
        exitDreamToSettings(automation, settings);
        selectMainReading(automation, "24h tokens", "Session status");
        selectStyle(automation, "Dashboard");
        for (String palette : new String[] { "Amber night", "Mono", "Theme" }) {
          scrollTo(automation, "Colors: " + palette);
          automation.executeAndWaitForEvent(() -> tapText(automation, "Colors: " + palette), event -> {
            AccessibilityNodeInfo option = namedNode(automation.getRootInActiveWindow(), "Colors: " + palette);
            return option != null && (option.isSelected() || option.isChecked());
          }, 30000);
          if (!"Theme".equals(palette)) {
            awaitDream(automation, "300K");
            capture(automation, "palette-" + ("Mono".equals(palette) ? "monochrome"
                : palette.toLowerCase(java.util.Locale.ROOT).replace(' ', '-')));
            exitDreamToSettings(automation, settings);
          }
        }
        scrollTo(automation, "Dashboard style", AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD);
        String[][] sizes = {
          { "phone", "1080x1920", "480", "0" },
          { "phone-landscape", "1080x1920", "480", "1" },
          { "tablet", "1920x1200", "240", "0" },
          { "tablet-portrait", "1920x1200", "240", "1" }
        };
        for (String style : new String[] { "Dashboard", "Focus", "Clock" }) {
          result.putString("stage", style + " style selection");
          selectStyle(automation, style);
          for (String[] viewport : sizes) {
            result.putString("stage", style + " " + viewport[0]);
            shell(automation, "wm size " + viewport[1]);
            shell(automation, "wm density " + viewport[2]);
            automation.setRotation("1".equals(viewport[3]) ? UiAutomation.ROTATION_FREEZE_90 : UiAutomation.ROTATION_FREEZE_0);
            boolean expectedLandscape = viewport[0].equals("phone-landscape") || viewport[0].equals("tablet");
            automation.executeAndWaitForEvent(() -> startDream(automation), event -> {
              AccessibilityNodeInfo root = automation.getRootInActiveWindow();
              String view = screenText(root);
              Rect liveStatus = phraseBounds(root, "Live");
              if (dismissSystemDialog(automation, view)) return false;
              if (!dreamVisible(root) || has(view, "Starting T3 Code")) return false;
              Rect bounds = new Rect();
              root.getBoundsInScreen(bounds);
              for (String label : "Dashboard".equals(style)
                  ? new String[] { "Session status", "24h tokens", "24h cost", "Quota left" }
                  : "Focus".equals(style) ? new String[] { "Session status" } : new String[0]) {
                Rect item = phraseBounds(root, label);
                if (item == null || item.isEmpty() || !bounds.contains(item)) return false;
              }
              if (!statusRowsFit(root) || ("Dashboard".equals(style) && !metricReadingsFit(root))) return false;
              if ("Dashboard".equals(style) && expectedLandscape) {
                Rect status = phraseBounds(root, "Session status.");
                Rect tokens = textBounds(root, "24h tokens");
                if (tokens.top < status.bottom) return false;
              }
              return has(view, "Clock".equals(style) ? "working" : "Session status")
                  && (bounds.width() > bounds.height()) == expectedLandscape
                  && liveStatus != null && !liveStatus.isEmpty()
                  && (!"Dashboard".equals(style)
                       || (has(view, "300K") && has(view, "$0.96") && has(view, "36%")));
            }, 30000);
            if ("Dashboard".equals(style)) result.putString("populatedMetrics", "PASS");
            String display = screenText(automation.getRootInActiveWindow());
            if (has(display, "Connect your first machine") || has(display, "Waiting for a connection")) {
              throw new AssertionError("Paired screen saver lost live data");
            }
            if (failedCount > 0 && !"Clock".equals(style) && !has(display, failedCount + " failed")) {
              throw new AssertionError("Synthetic failed session missing from the Dream display");
            }
            if (failedCount > 0) result.putString("nonzeroFailures", "PASS");
            capture(automation, "live-" + style.toLowerCase(java.util.Locale.ROOT) + "-" + viewport[0]);
            exitDreamToSettings(automation, settings);
          }
          shell(automation, "wm size reset");
          shell(automation, "wm density reset");
          automation.setRotation(UiAutomation.ROTATION_FREEZE_0);
          restoreSettingsAfterResize(automation, settings, launch);
        }
        result.putString("responsiveStyles", "PASS");
        result.putString("stage", "background Clock advancement");
        shell(automation, "wm size 1080x1920");
        shell(automation, "wm density 480");
        automation.setRotation(UiAutomation.ROTATION_FREEZE_0);
        awaitDream(automation, "working");
        String firstClock = clockText(automation);
        if (firstClock.isEmpty()) throw new AssertionError("Clock text is missing");
        result.putString("clockInitial", firstClock);
        capture(automation, "live-clock-before-advancement");
        shell(automation, "dumpsys gfxinfo " + appId + " reset");
        captureRuntimeStats(automation, "clock-runtime-before");
        for (int tick = 0; tick < 3; tick++) {
          final String previousClock = clockText(automation);
          result.putString("stage", "background Clock tick " + (tick + 1));
          automation.executeAndWaitForEvent(() -> {}, event -> {
            String nextClock = clockText(automation);
            return !nextClock.isEmpty() && !nextClock.equals(previousClock);
          }, 75000);
        }
        result.putString("clockFinal", clockText(automation));
        captureRuntimeStats(automation, "clock-runtime-after");
        capture(automation, "live-clock-after-advancement");
        result.putString("clockAdvancement", "PASS");
        exitDreamToSettings(automation, settings);
        selectStyle(automation, "Dashboard");
        result.putString("stage", "small status font setup");
        selectMainReading(automation, "Session status", "24h tokens");
        String previousFontScale = shell(automation, "settings get system font_scale");
        try {
          for (String fontScale : new String[] { "1.0", "1.5", "2.0" }) {
            shell(automation, "settings put system font_scale " + fontScale);
            for (int rotation = 0; rotation < 2; rotation++) {
              result.putString("stage", "small status font " + fontScale + " rotation " + rotation);
              automation.setRotation(rotation == 0
                  ? UiAutomation.ROTATION_FREEZE_0 : UiAutomation.ROTATION_FREEZE_90);
              awaitPopulatedLayout(automation, "Dashboard", rotation == 1, true, true, failedCount);
              capture(automation, "small-status-font-" + fontScale.replace('.', '-')
                  + (rotation == 0 ? "-portrait" : "-landscape"));
              exitDreamToSettings(automation, settings);
            }
          }
          result.putString("smallStatusCaptures", "CAPTURED");
          result.putString("stage", "restore large tile before all-style large text captures");
          selectMainReading(automation, "24h tokens", "Session status");
          for (String style : new String[] { "Dashboard", "Focus", "Clock" }) {
            result.putString("stage", "select large text style " + style);
            selectStyle(automation, style);
            for (int rotation = 0; rotation < 2; rotation++) {
              result.putString("stage", "large text " + style + " rotation " + rotation);
              try (BufferedReader recording = "Dashboard".equals(style) && rotation == 1
                  ? new BufferedReader(new InputStreamReader(new ParcelFileDescriptor.AutoCloseInputStream(
                      automation.executeShellCommand("screenrecord --size 1920x1080 --time-limit 5 --bit-rate 2000000 "
                          + new File(getContext().getExternalFilesDir(null),
                              "large-font-dashboard-landscape.mp4").getAbsolutePath()))))
                  : null) {
                automation.setRotation(rotation == 0
                    ? UiAutomation.ROTATION_FREEZE_0 : UiAutomation.ROTATION_FREEZE_90);
                awaitPopulatedLayout(automation, style, rotation == 1,
                    "Dashboard".equals(style) || ("Focus".equals(style) && rotation == 1), false, failedCount);
                capture(automation, "large-font-" + style.toLowerCase(java.util.Locale.ROOT)
                    + (rotation == 0 ? "-portrait" : "-landscape"));
                if (recording != null) {
                  String output = recording.lines().collect(java.util.stream.Collectors.joining("\n"));
                  try (FileOutputStream file = new FileOutputStream(new File(
                      getContext().getExternalFilesDir(null), "rotation-recording.txt"))) {
                    file.write(output.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                  }
                  capture(automation, "large-font-dashboard-landscape-after-recording");
                }
              }
              exitDreamToSettings(automation, settings);
            }
          }
          selectStyle(automation, "Dashboard");
          result.putString("largeFontStyles", "CAPTURED");
        } finally {
          shell(automation, "null".equals(previousFontScale)
              ? "settings delete system font_scale"
              : "settings put system font_scale " + Float.parseFloat(previousFontScale));
          shell(automation, "wm size reset");
          shell(automation, "wm density reset");
          automation.setRotation(UiAutomation.ROTATION_FREEZE_0);
          restoreSettingsAfterResize(automation, settings, launch);
        }
        result.putString("stage", "cold populated landscape layout");
        String populatedPid = shell(automation, "pidof " + appId);
        automation.executeAndWaitForEvent(() -> {
          automation.injectInputEvent(new android.view.KeyEvent(
              android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_HOME), true);
          automation.injectInputEvent(new android.view.KeyEvent(
              android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_HOME), true);
        }, event -> launcherVisible(automation), 30000);
        shell(automation, "am force-stop " + appId);
        // Give the cold process a landscape display without relying on launcher rotation policy.
        shell(automation, "wm size 1920x1080");
        shell(automation, "wm density 480");
        automation.setRotation(UiAutomation.ROTATION_FREEZE_0);
        automation.executeAndWaitForEvent(() -> startDream(automation), event -> {
          AccessibilityNodeInfo coldRoot = automation.getRootInActiveWindow();
          if (!dreamVisible(coldRoot)) return false;
          String coldText = screenText(coldRoot);
          if (dismissSystemDialog(automation, coldText)) return false;
          Rect coldScreen = new Rect();
          coldRoot.getBoundsInScreen(coldScreen);
          Rect status = phraseBounds(coldRoot, "Session status.");
          Rect tokens = textBounds(coldRoot, "24h tokens");
          Rect liveStatus = phraseBounds(coldRoot, "Live");
          return coldScreen.width() > coldScreen.height()
              && status != null && tokens != null && !status.isEmpty() && !tokens.isEmpty()
              && coldScreen.contains(status) && coldScreen.contains(tokens)
              && tokens.top >= status.bottom
              && liveStatus != null && !liveStatus.isEmpty()
              && has(coldText, "300K") && has(coldText, "$0.96") && has(coldText, "36%")
              && !has(coldText, "Connect your first machine")
              && !has(coldText, "Waiting for a connection");
        }, 30000);
        String populatedColdPid = shell(automation, "pidof " + appId);
        if (populatedPid.isEmpty() || populatedColdPid.isEmpty() || populatedPid.equals(populatedColdPid)) {
          throw new AssertionError("Populated Dream did not cold-start a new app process");
        }
        capture(automation, "live-dashboard-phone-landscape-cold");
        result.putString("coldPopulatedLayout", "PASS");
        result.putString("stage", "font scale changes during an active Dream");
        String activeFontScale = shell(automation, "settings get system font_scale");
        String activeDreamPid = shell(automation, "pidof " + appId);
        try {
          automation.executeAndWaitForEvent(() -> shell(automation, "settings put system font_scale 2.0"), event -> {
            AccessibilityNodeInfo activeRoot = automation.getRootInActiveWindow();
            if (!dreamVisible(activeRoot)) return false;
            Rect compact = phraseBounds(activeRoot, "Session status.");
            Rect displayBounds = new Rect();
            activeRoot.getBoundsInScreen(displayBounds);
            Rect connection = textBounds(activeRoot, "Live \u00b7 2 machines");
            return connection != null && connection.height() > 8
                && displayBounds.contains(connection) && connection.bottom <= displayBounds.bottom - 8
                && compact != null && !compact.isEmpty() && displayBounds.contains(compact)
                && phraseBounds(activeRoot, "300K") != null;
          }, 30000);
          if (activeDreamPid.isEmpty() || !activeDreamPid.equals(shell(automation, "pidof " + appId))) {
            throw new AssertionError("Font-scale update restarted the Dream process");
          }
          result.putString("activeFontScaleSetting", shell(automation, "settings get system font_scale"));
          capture(automation, "active-font-scale-landscape");
          result.putString("activeFontScale", "PASS");
        } finally {
          shell(automation, "null".equals(activeFontScale)
              ? "settings delete system font_scale"
              : "settings put system font_scale " + Float.parseFloat(activeFontScale));
        }
        automation.executeAndWaitForEvent(
            () -> exitDream(automation), event -> launcherVisible(automation), 30000);
        shell(automation, "wm size reset");
        shell(automation, "wm density reset");
        restoreSettingsAfterResize(automation, settings, launch);
      }
      result.putString("stage", "unsupported framework screen saver flag");
      String overlayId = "com.android.shell:t3_dream_unsupported";
      try {
        result.putString("frameworkOverlayFabricate", shell(automation,
            "su 0 cmd overlay fabricate --target android --name t3_dream_unsupported "
                + "android:bool/config_dreamsSupported 0x12 0"));
        result.putString("frameworkOverlayEnable",
            shell(automation, "su 0 cmd overlay enable --user 0 " + overlayId));
        String flag = shell(automation,
            "su 0 cmd overlay lookup --user 0 android android:bool/config_dreamsSupported");
        result.putString("frameworkDreamsFlag", flag);
        if (!"false".equals(flag)) {
          throw new AssertionError("Unsupported framework fixture did not set dreams flag false: " + flag);
        }
        ComponentName frameworkSettings = new Intent(android.provider.Settings.ACTION_DREAM_SETTINGS)
            .resolveActivity(getContext().getPackageManager());
        if (frameworkSettings == null) {
          throw new AssertionError("Framework fixture also removed the settings destination");
        }
        result.putString("frameworkSettingsComponent", frameworkSettings.flattenToString());
        automation.injectInputEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_HOME), true);
        automation.injectInputEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_HOME), true);
        shell(automation, "am force-stop " + appId);
        awaitScreen(automation, () -> getContext().startActivity(settings), "Screen savers aren’t available");
        capture(automation, "unsupported-framework-direct-link");
        result.putString("frameworkCapabilityGate", "PASS");
      } finally {
        shell(automation, "su 0 cmd overlay disable --user 0 " + overlayId);
      }
      result.putString("stage", "unsupported device capability");
      shell(automation, "am force-stop " + appId);
      awaitScreen(automation, () -> getContext().startActivity(settings), "Set as screen saver");
      String settingsPid = shell(automation, "pidof " + appId);
      ComponentName systemSettings = new Intent(android.provider.Settings.ACTION_DREAM_SETTINGS)
          .resolveActivity(getContext().getPackageManager());
      if (systemSettings == null) throw new AssertionError("Test system has no screen saver settings");
      result.putString("capabilityComponent", systemSettings.flattenToString());
      try {
        result.putString("capabilityDisableResult",
            shell(automation, "pm disable --user 0 " + systemSettings.flattenToString()));
        ComponentName remainingSettings = new Intent(android.provider.Settings.ACTION_DREAM_SETTINGS)
            .resolveActivity(getContext().getPackageManager());
        result.putString("capabilityAfterDisable", remainingSettings == null
            ? "NONE" : remainingSettings.flattenToString());
        if (remainingSettings != null) throw new AssertionError("Screen saver settings still resolve after fixture disable");
        awaitScreen(automation, () -> tapText(automation, "Set as screen saver"),
            "Screen saver settings unavailable");
        if (settingsPid.isEmpty() || !settingsPid.equals(shell(automation, "pidof " + appId))) {
          throw new AssertionError("Unavailable screen saver settings restarted the app");
        }
        capture(automation, "settings-unavailable-feedback");
        awaitScreen(automation, () -> tapText(automation, "OK"), "Set as screen saver");
        result.putString("settingsUnavailableFeedback", "PASS");
        automation.injectInputEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_HOME), true);
        automation.injectInputEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_HOME), true);
        shell(automation, "am force-stop " + appId);
        awaitScreen(automation, () -> getContext().startActivity(settings), "Screen savers aren’t available");
        capture(automation, "unsupported-direct-link");
        Intent index = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(appScheme + "://settings"))
            .setPackage(appId).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
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
      StringBuilder frames = new StringBuilder();
      for (StackTraceElement frame : error.getStackTrace()) frames.append(frame).append('\n');
      result.putString("failureStack", frames.toString());
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

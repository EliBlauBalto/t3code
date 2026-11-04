package com.t3tools.startuptest;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.Intent;
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
  @Override
  public void onCreate(Bundle arguments) {
    super.onCreate(arguments);
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

  private static boolean has(String text, String expected) {
    return text.toLowerCase(java.util.Locale.ROOT).contains(expected.toLowerCase(java.util.Locale.ROOT));
  }

  // The emulator's own launcher can stall on a slow runner and cover the app with a system dialog.
  // Tap Wait so the app under test stays measurable; the count is reported, not hidden.
  private boolean dismissSystemDialog(UiAutomation automation, String text) {
    if (!has(text, "isn't responding") && !has(text, "isn’t responding")) return false;
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
    if (text.equalsIgnoreCase(node.getText() == null ? "" : node.getText().toString())) {
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
      result.putString("stage", "first Dream start");
      awaitScreen(automation, () -> startDream(automation), "Session status");
      capture(automation, "dream-portrait");
      result.putString("stage", "Dream rotation");
      automation.executeAndWaitForEvent(
          () -> automation.setRotation(UiAutomation.ROTATION_FREEZE_90),
          event -> {
            AccessibilityNodeInfo root = automation.getRootInActiveWindow();
            if (root == null) return false;
            Rect bounds = new Rect();
            root.getBoundsInScreen(bounds);
            Rect status = textBounds(root, "Session status");
            Rect tokens = textBounds(root, "Tokens · 24h");
            return bounds.width() > bounds.height() && status != null && tokens != null
                && tokens.left > status.right
                && Math.abs(tokens.top - status.top) < Math.max(tokens.height(), status.height()) * 2;
          }, 30000);
      capture(automation, "dream-landscape");
      result.putString("stage", "touch exits Dream");
      awaitScreen(automation, () -> exitDream(automation), "Add environment");
      capture(automation, "after-dream");
      result.putString("stage", "second Dream start");
      awaitScreen(automation, () -> startDream(automation), "Session status");
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
      shell(automation, "am kill --user current com.t3tools.t3code.dream");
      awaitScreen(automation, () -> startDream(automation), "Session status");
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
      passed = true;
    } catch (Throwable error) {
      result.putString("failure", error.toString());
    } finally {
      String text = screenText(automation.getRootInActiveWindow());
      result.putString("screen", text);
      result.putString("systemDialogsDismissed", String.valueOf(systemDialogs));
      result.putString("startup", passed ? "PASS" : "FAIL");
      try {
        capture(automation, "screen");
        automation.setRotation(UiAutomation.ROTATION_UNFREEZE);
      } catch (Throwable error) {
        result.putString("captureFailure", error.toString());
      }
      finish(passed ? -1 : 0, result);
    }
  }
}

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

  private void awaitScreen(UiAutomation automation, Runnable action, String expected) throws Exception {
    automation.executeAndWaitForEvent(action, event -> {
      String text = screenText(automation.getRootInActiveWindow());
      return text.contains(expected) && !text.contains("Starting T3 Code")
          && !text.contains("taking longer to start");
    }, 30000);
  }

  private void startDream(UiAutomation automation) {
    try (ParcelFileDescriptor descriptor = automation.executeShellCommand("su 0 cmd dreams start-dreaming");
        BufferedReader reader = new BufferedReader(new InputStreamReader(
            new ParcelFileDescriptor.AutoCloseInputStream(descriptor)))) {
      String line;
      while ((line = reader.readLine()) != null) {
        if (!line.trim().isEmpty()) throw new AssertionError(line);
      }
    } catch (java.io.IOException error) {
      throw new RuntimeException(error);
    }
  }

  private void capture(UiAutomation automation, String name) throws Exception {
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

  private void exitDream(UiAutomation automation) {
    Rect bounds = new Rect();
    automation.getRootInActiveWindow().getBoundsInScreen(bounds);
    long time = SystemClock.uptimeMillis();
    MotionEvent down = MotionEvent.obtain(time, time, MotionEvent.ACTION_DOWN,
        bounds.centerX(), bounds.centerY(), 0);
    MotionEvent up = MotionEvent.obtain(time, time, MotionEvent.ACTION_UP,
        bounds.centerX(), bounds.centerY(), 0);
    try {
      automation.injectInputEvent(down, true);
      automation.injectInputEvent(up, true);
    } finally {
      down.recycle();
      up.recycle();
    }
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
            return bounds.width() > bounds.height() && screenText(root).contains("Session status");
          }, 30000);
      capture(automation, "dream-landscape");
      result.putString("stage", "touch exits Dream");
      awaitScreen(automation, () -> exitDream(automation), "Add environment");
      capture(automation, "after-dream");
      result.putString("stage", "second Dream start");
      awaitScreen(automation, () -> startDream(automation), "Session status");
      result.putString("stage", "second Dream exit");
      awaitScreen(automation, () -> exitDream(automation), "Add environment");
      result.putString("dream", "PASS");
      passed = true;
    } catch (Throwable error) {
      result.putString("failure", error.toString());
    } finally {
      String text = screenText(automation.getRootInActiveWindow());
      result.putString("screen", text);
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

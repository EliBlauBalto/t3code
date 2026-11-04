package com.t3tools.startuptest;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.File;
import java.io.FileOutputStream;

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
      passed = true;
    } catch (Throwable error) {
      result.putString("failure", error.toString());
    } finally {
      String text = screenText(automation.getRootInActiveWindow());
      result.putString("screen", text);
      result.putString("startup", passed ? "PASS" : "FAIL");
      try {
        File directory = getContext().getExternalFilesDir(null);
        try (FileOutputStream file = new FileOutputStream(new File(directory, "screen.txt"))) {
          file.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
        Bitmap screenshot = automation.takeScreenshot();
        if (screenshot != null) {
          try (FileOutputStream file = new FileOutputStream(new File(directory, "screen.png"))) {
            screenshot.compress(Bitmap.CompressFormat.PNG, 100, file);
          }
        }
      } catch (Throwable error) {
        result.putString("captureFailure", error.toString());
      }
      finish(passed ? -1 : 0, result);
    }
  }
}

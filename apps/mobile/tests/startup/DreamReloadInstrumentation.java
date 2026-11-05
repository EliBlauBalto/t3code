package com.t3tools.startuptest;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class DreamReloadInstrumentation extends Instrumentation {
  @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }

  @Override public void onStart() {
    Bundle result = new Bundle();
    boolean passed = false;
    UiAutomation automation = getUiAutomation();
    String appId = getTargetContext().getPackageName();
    result.putString("appId", appId);
    try {
      Intent launch = getTargetContext().getPackageManager().getLaunchIntentForPackage(appId);
      if (launch == null) throw new AssertionError("Missing target app launcher");
      result.putString("stage", "warm normal app");
      automation.executeAndWaitForEvent(() -> getTargetContext().startActivity(
          launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)), event -> {
        AccessibilityNodeInfo root = automation.getRootInActiveWindow();
        return root != null && !dream(root) && text(root).contains("Chats");
      }, 30000);
      Object application = getTargetContext().getApplicationContext();
      Object host = application.getClass().getMethod("getReactHost").invoke(application);
      Object initialContext = context(host);
      if (initialContext == null || activeTasks(initialContext)) {
        throw new AssertionError("Expected an initialized runtime with no headless tasks");
      }
      result.putString("stage", "start warm Dream");
      automation.executeAndWaitForEvent(() -> shell(automation,
          "su 0 cmd dreams start-dreaming"), event -> populated(automation), 30000);
      if (!activeTasks(initialContext)) throw new AssertionError("Dream did not retain timers");
      int dreamWindow = automation.getRootInActiveWindow().getWindowId();
      result.putString("pidBefore", shell(automation, "pidof " + appId));
      capture(automation, "reload-before");
      result.putString("stage", "replace ReactContext during active Dream");
      automation.executeAndWaitForEvent(() -> runOnMainSync(() -> {
        try {
          Class.forName("com.facebook.react.ReactHost", true, getTargetContext().getClassLoader())
              .getMethod("reload", String.class).invoke(host, "Dream integration check");
        } catch (ReflectiveOperationException error) { throw new IllegalStateException(error); }
      }), event -> {
        try {
          Object current = context(host);
          return current != null && current != initialContext && populated(automation);
        }
        catch (ReflectiveOperationException error) { throw new IllegalStateException(error); }
      }, 30000);
      Object replacement = context(host);
      if (replacement == null || !activeTasks(replacement)) {
        throw new AssertionError("Replacement runtime has no Dream timer lease");
      }
      if (automation.getRootInActiveWindow().getWindowId() != dreamWindow) {
        throw new AssertionError("Dream window was replaced during JS reload");
      }
      result.putString("pidAfter", shell(automation, "pidof " + appId));
      if (!result.getString("pidBefore").equals(result.getString("pidAfter"))) {
        throw new AssertionError("Reload restarted the app process");
      }
      result.putString("contextReplaced", "true");
      String initialClock = clock(automation.getRootInActiveWindow());
      result.putString("clockBefore", initialClock);
      capture(automation, "reload-after");
      result.putString("stage", "clock advances after reload");
      automation.executeAndWaitForEvent(() -> {}, event -> {
        String value = clock(automation.getRootInActiveWindow());
        return populated(automation) && !value.isEmpty() && !value.equals(initialClock);
      }, 75000);
      result.putString("clockAfter", clock(automation.getRootInActiveWindow()));
      capture(automation, "reload-clock-advanced");
      result.putString("stage", "stop Dream and return to normal app");
      automation.executeAndWaitForEvent(() -> shell(automation,
          "su 0 cmd dreams stop-dreaming"), event -> {
        AccessibilityNodeInfo root = automation.getRootInActiveWindow();
        return root != null && !dream(root) && text(root).contains("Chats");
      }, 30000);
      if (activeTasks(replacement)) throw new AssertionError("Dream timer lease survived stop");
      Object lifecycle = Class.forName("com.facebook.react.bridge.ReactContext", true,
          getTargetContext().getClassLoader()).getMethod("getLifecycleState").invoke(replacement);
      if (!"RESUMED".equals(String.valueOf(lifecycle))) {
        throw new AssertionError("Normal app did not resume after Dream: " + lifecycle);
      }
      result.putString("timerLeaseReleased", "true");
      capture(automation, "reload-returned-to-app");
      passed = true;
    } catch (Throwable error) {
      result.putString("failure", error.toString());
      StringBuilder stack = new StringBuilder();
      for (StackTraceElement frame : error.getStackTrace()) stack.append(frame).append('\n');
      result.putString("failureStack", stack.toString());
      try { capture(automation, "reload-failure"); } catch (Exception ignored) { }
    } finally {
      result.putString("reload", passed ? "PASS" : "FAIL");
      finish(passed ? -1 : 0, result);
    }
  }

  private Object context(Object host) throws ReflectiveOperationException {
    return Class.forName("com.facebook.react.ReactHost", true, getTargetContext().getClassLoader())
        .getMethod("getCurrentReactContext").invoke(host);
  }

  private boolean activeTasks(Object context) throws ReflectiveOperationException {
    ClassLoader loader = getTargetContext().getClassLoader();
    Class<?> reactContext = Class.forName("com.facebook.react.bridge.ReactContext", true, loader);
    Class<?> tasks = Class.forName("com.facebook.react.jstasks.HeadlessJsTaskContext", true, loader);
    Object owner = tasks.getMethod("getInstance", reactContext).invoke(null, context);
    return (Boolean) tasks.getMethod("hasActiveTasks").invoke(owner);
  }

  private boolean populated(UiAutomation automation) {
    AccessibilityNodeInfo root = automation.getRootInActiveWindow();
    String value = text(root);
    return dream(root) && !clock(root).isEmpty() && value.contains("Live")
        && value.contains("300K") && value.contains("$0.96") && value.contains("36%");
  }

  private boolean dream(AccessibilityNodeInfo root) {
    if (root == null) return false;
    for (AccessibilityNodeInfo.AccessibilityAction action : root.getActionList()) {
      if (action.getLabel() != null && "dismiss".equalsIgnoreCase(action.getLabel().toString())) return true;
    }
    return false;
  }

  private String clock(AccessibilityNodeInfo root) {
    Matcher match = Pattern.compile("\\b\\d{1,2}:\\d{2}\\b").matcher(text(root));
    return match.find() ? match.group() : "";
  }

  private String text(AccessibilityNodeInfo root) {
    if (root == null) return "";
    StringBuilder value = new StringBuilder();
    if (root.getText() != null) value.append(root.getText()).append('\n');
    if (root.getContentDescription() != null) value.append(root.getContentDescription()).append('\n');
    for (int index = 0; index < root.getChildCount(); index++) value.append(text(root.getChild(index)));
    return value.toString();
  }

  private String shell(UiAutomation automation, String command) {
    try (BufferedReader reader = new BufferedReader(new InputStreamReader(
        new ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand(command)), StandardCharsets.UTF_8))) {
      StringBuilder value = new StringBuilder();
      String line;
      while ((line = reader.readLine()) != null) value.append(line).append('\n');
      return value.toString().trim();
    } catch (Exception error) { throw new IllegalStateException(error); }
  }

  private void capture(UiAutomation automation, String name) throws Exception {
    automation.waitForIdle(1000, 30000);
    File directory = getTargetContext().getExternalFilesDir(null);
    try (FileOutputStream file = new FileOutputStream(new File(directory, name + ".txt"))) {
      file.write(text(automation.getRootInActiveWindow()).getBytes(StandardCharsets.UTF_8));
    }
    Bitmap bitmap = automation.takeScreenshot();
    if (bitmap == null) throw new AssertionError("Reload screenshot unavailable");
    try (FileOutputStream file = new FileOutputStream(new File(directory, name + ".png"))) {
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, file);
    } finally { bitmap.recycle(); }
  }
}

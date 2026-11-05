package com.t3tools.startuptest;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

public final class ReleaseRuntimeProbe {
  static final String HOST = "com.facebook.react.runtime.ReactHostImpl";
  static final String CONTEXT = "com.facebook.react.bridge.ReactContext";

  static final class Plan {
    String contextMethod;
    String reloadTaskMethod;
    String taskClass;
    String taskMap;
    List<String> taskSets;
    String apkSha256;
    @Override public String toString() {
      return "apk=" + apkSha256 + " host=" + HOST + " context=" + contextMethod
          + " reloadTask=" + reloadTaskMethod + " tasks=" + taskClass + "." + taskMap
          + " sets=" + taskSets;
    }
  }

  static Plan read(File apk) throws Exception {
    Plan plan = new Plan();
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (InputStream input = new FileInputStream(apk)) {
      byte[] block = new byte[65536];
      int size;
      while ((size = input.read(block)) != -1) digest.update(block, 0, size);
    }
    StringBuilder hash = new StringBuilder();
    for (byte value : digest.digest()) hash.append(String.format("%02x", value & 255));
    plan.apkSha256 = hash.toString();
    try (ZipFile archive = new ZipFile(apk)) {
      Enumeration<? extends ZipEntry> entries = archive.entries();
      while (entries.hasMoreElements()) {
        ZipEntry entry = entries.nextElement();
        if (!entry.getName().matches("classes\\d*\\.dex")) continue;
        try (InputStream input = archive.getInputStream(entry)) {
          ByteArrayOutputStream output = new ByteArrayOutputStream();
          byte[] block = new byte[16384];
          int size;
          while ((size = input.read(block)) != -1) output.write(block, 0, size);
          new Dex(output.toByteArray()).inspect(plan);
        }
      }
    }
    if (plan.contextMethod == null || plan.reloadTaskMethod == null || plan.taskClass == null) {
      throw new AssertionError("Packaged RN runtime does not match the RN 0.88 reload probe");
    }
    return plan;
  }

  private static final class Dex {
    final byte[] bytes;
    final ByteBuffer buffer;
    final String[] strings;
    final String[] types;
    Dex(byte[] bytes) {
      this.bytes = bytes;
      buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
      if (bytes[0] != 'd' || bytes[1] != 'e' || bytes[2] != 'x') throw new AssertionError("Not DEX");
      strings = new String[i(56)];
      for (int n = 0; n < strings.length; n++) {
        int[] at = { i(i(60) + n * 4) };
        leb(at);
        int end = at[0];
        while (bytes[end] != 0) end++;
        strings[n] = new String(bytes, at[0], end - at[0], StandardCharsets.UTF_8);
      }
      types = new String[i(64)];
      for (int n = 0; n < types.length; n++) types[n] = strings[i(i(68) + n * 4)];
    }
    int i(int at) { return buffer.getInt(at); }
    int s(int at) { return buffer.getShort(at) & 65535; }
    int leb(int[] at) {
      int value = 0;
      for (int shift = 0; shift < 35; shift += 7) {
        int next = bytes[at[0]++] & 255;
        value |= (next & 127) << shift;
        if ((next & 128) == 0) return value;
      }
      throw new AssertionError("Invalid DEX integer");
    }
    void inspect(Plan plan) {
      for (int n = 0; n < i(96); n++) {
        int definition = i(100) + n * 32;
        String type = types[i(definition)];
        int data = i(definition + 24);
        if (data == 0) continue;
        int[] at = { data };
        int[] counts = { leb(at), leb(at), leb(at), leb(at) };
        List<String> fieldTypes = new ArrayList<>();
        List<String> sets = new ArrayList<>();
        String taskMap = null;
        for (int count : Arrays.copyOf(counts, 2)) {
          int id = 0;
          for (int f = 0; f < count; f++) {
            id += leb(at);
            int access = leb(at), field = i(84) + id * 8;
            String fieldType = types[s(field + 2)], name = strings[i(field + 4)];
            fieldTypes.add(fieldType);
            if ((access & 8) != 0 && fieldType.equals("Ljava/util/WeakHashMap;")) taskMap = name;
            if ((access & 8) == 0 && fieldType.equals("Ljava/util/concurrent/CopyOnWriteArraySet;")) sets.add(name);
          }
        }
        if (taskMap != null && sets.size() == 2
            && fieldTypes.contains("Ljava/lang/ref/WeakReference;")
            && fieldTypes.contains("Ljava/util/concurrent/atomic/AtomicInteger;")
            && fieldTypes.contains("Ljava/util/concurrent/ConcurrentHashMap;")
            && fieldTypes.contains("Landroid/util/SparseArray;")) {
          if (plan.taskClass != null) throw new AssertionError("Ambiguous task-context shape");
          plan.taskClass = type.substring(1, type.length() - 1).replace('/', '.');
          plan.taskMap = taskMap;
          plan.taskSets = sets;
        }
        if (!type.equals("L" + HOST.replace('.', '/') + ";")) continue;
        for (int group = 2; group < 4; group++) {
          int id = 0;
          for (int m = 0; m < counts[group]; m++) {
            id += leb(at);
            leb(at);
            int code = leb(at), method = i(92) + id * 8, proto = i(76) + s(method + 2) * 12;
            String name = strings[i(method + 4)], returns = types[i(proto + 4)];
            int parameters = i(proto + 8), parameterCount = parameters == 0 ? 0 : i(parameters);
            if (parameterCount == 0 && returns.equals("L" + CONTEXT.replace('.', '/') + ";")) {
              if (plan.contextMethod != null) throw new AssertionError("Ambiguous current-context getter");
              plan.contextMethod = name;
            }
            if (code != 0 && parameterCount == 1 && types[s(parameters + 4)].equals("Ljava/lang/String;")
                && !returns.equals("V") && contains(code, "getOrCreateReloadTask()")) {
              if (plan.reloadTaskMethod != null) throw new AssertionError("Ambiguous reload task");
              plan.reloadTaskMethod = name;
            }
          }
        }
      }
    }
    boolean contains(int code, String expected) {
      int start = code + 16, end = start + i(code + 12) * 2;
      for (int at = start; at < end; at += 2) {
        int opcode = s(at) & 255;
        int index = opcode == 26 && at + 4 <= end ? s(at + 2)
            : opcode == 27 && at + 6 <= end ? i(at + 2) : -1;
        if (index >= 0 && index < strings.length && expected.equals(strings[index])) return true;
      }
      return false;
    }
  }

  public static void main(String[] args) throws Exception {
    for (String path : args) System.out.println(read(new File(path)));
  }
}

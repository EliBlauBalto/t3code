#!/usr/bin/env bash
set -euo pipefail

apk="$(realpath "$1")"
directory="$(cd "$(dirname "$0")" && pwd)"
output="$(realpath -m "$2")"
mkdir -p "$output/classes" "$output/dex"
sha256sum "$apk" | tee "$output/apk-sha256.txt"
android_jar="$ANDROID_HOME/platforms/android-35/android.jar"
build_tools="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"

cat > "$output/AndroidManifest.xml" <<'XML'
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.t3tools.startuptest">
  <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="35" />
  <queries><package android:name="com.t3tools.t3code.dream" /></queries>
  <application android:label="Release startup test" />
  <instrumentation android:name="com.t3tools.startuptest.StartupInstrumentation" android:targetPackage="com.t3tools.startuptest" />
</manifest>
XML

javac --release 8 -cp "$android_jar" -d "$output/classes" "$directory/StartupInstrumentation.java"
"$build_tools/d8" --lib "$android_jar" --min-api 24 --output "$output/dex" "$output"/classes/com/t3tools/startuptest/*.class
"$build_tools/aapt2" link -I "$android_jar" --manifest "$output/AndroidManifest.xml" -o "$output/test.apk"
(cd "$output/dex" && zip -q "$output/test.apk" classes.dex)
keytool -genkeypair -keystore "$output/test.keystore" -storepass android -keypass android -alias test -keyalg RSA -dname CN=StartupTest -validity 1
"$build_tools/apksigner" sign --ks "$output/test.keystore" --ks-pass pass:android "$output/test.apk"

adb shell getprop ro.product.cpu.abilist | tee "$output/abis.txt"
adb shell getprop ro.dalvik.vm.native.bridge | tee "$output/native-bridge.txt"
adb install "$apk"
adb install "$output/test.apk"
# SoLoader uses the host ABI for direct APK loading under Android's ARM translation.
# Extract the unchanged ARM libraries into PackageManager's native library directory.
if [[ "$(adb shell getprop ro.dalvik.vm.native.bridge)" == *libndk_translation* ]]; then
  adb root
  adb wait-for-device
  installed_apk="$(adb shell pm path com.t3tools.t3code.dream | tr -d '\r' | sed 's/^package://')"
  native_directory="${installed_apk%/base.apk}/lib/arm64"
  unzip -j "$apk" 'lib/arm64-v8a/*.so' -d "$output/native-libraries" > "$output/native-extraction.txt"
  adb shell mkdir -p "$native_directory"
  adb push "$output/native-libraries/." "$native_directory/"
  adb shell restorecon -R "$native_directory"
fi
adb shell settings put secure screensaver_enabled 1
adb shell settings put secure screensaver_components com.t3tools.t3code.dream/expo.modules.t3nativecontrols.T3DreamService
adb logcat -c
adb shell am instrument -w com.t3tools.startuptest/.StartupInstrumentation | tee "$output/result.txt"
adb logcat -d -v threadtime > "$output/logcat.txt"
adb pull /sdcard/Android/data/com.t3tools.startuptest/files/ "$output/capture" || true
grep -q 'startup=PASS' "$output/result.txt"

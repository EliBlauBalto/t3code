#!/usr/bin/env bash
set -euo pipefail

apk="$(realpath "$1")"
app_id="${T3_DREAM_APP_ID:-com.t3tools.t3code.dream}"
case "$app_id" in
  com.t3tools.t3code|com.t3tools.t3code.dream) ;;
  *) echo "Unexpected Dream test package" >&2; exit 1 ;;
esac
directory="$(cd "$(dirname "$0")" && pwd)"
output="$(realpath -m "$2")"
mkdir -p "$output/classes" "$output/dex"
sha256sum "$apk" | tee "$output/apk-sha256.txt"
android_jar="$ANDROID_HOME/platforms/android-35/android.jar"
build_tools="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"

cat > "$output/AndroidManifest.xml" <<'XML'
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.t3tools.startuptest">
  <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="35" />
  <queries>
    <package android:name="com.t3tools.t3code.dream" />
    <package android:name="com.t3tools.t3code" />
    <intent><action android:name="android.settings.DREAM_SETTINGS" /></intent>
  </queries>
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

if [[ "${T3_STARTUP_OBSERVE_FIXTURE:-0}" == 1 ]]; then
  python3 - "$apk" "$output/fixture-unaligned.apk" <<'PY'
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as original, zipfile.ZipFile(sys.argv[2], "w") as fixture:
    for entry in original.infolist():
        if entry.filename.startswith("META-INF/"):
            continue
        content = original.read(entry)
        if entry.filename == "assets/app.config":
            config = json.loads(content)
            config["extra"]["eas"]["projectId"] = "11111111-1111-4111-8111-111111111111"
            config["extra"]["eas"]["observe"]["endpointUrl"] = "https://observe.invalid"
            content = json.dumps(config).encode()
        fixture.writestr(entry, content)
PY
  "$build_tools/zipalign" -P 16 -f 4 "$output/fixture-unaligned.apk" "$output/fixture.apk"
  "$build_tools/apksigner" sign --ks "$output/test.keystore" --ks-pass pass:android "$output/fixture.apk"
  apk="$output/fixture.apk"
  echo 'TEST FIXTURE ONLY: synthetic EAS metadata, unreachable Observe endpoint, disposable signing key' | tee "$output/fixture.txt"
fi

adb shell getprop ro.product.cpu.abilist | tee "$output/abis.txt"
adb shell getprop ro.dalvik.vm.native.bridge | tee "$output/native-bridge.txt"
adb install --no-incremental "$apk"
adb install --no-incremental "$output/test.apk"
# SoLoader uses the host ABI for direct APK loading under Android's ARM translation.
# Extract the unchanged ARM libraries into PackageManager's native library directory.
if [[ "$(adb shell getprop ro.dalvik.vm.native.bridge)" == *libndk_translation* ]]; then
  adb root
  adb wait-for-device
  installed_apk="$(adb shell pm path "$app_id" | tr -d '\r' | sed 's/^package://')"
  native_directory="${installed_apk%/base.apk}/lib/arm64"
  unzip -j "$apk" 'lib/arm64-v8a/*.so' -d "$output/native-libraries" > "$output/native-extraction.txt"
  adb shell mkdir -p "$native_directory"
  adb push "$output/native-libraries/." "$native_directory/"
  adb shell restorecon -R "$native_directory"
fi
adb shell settings put secure screensaver_enabled 1
adb shell settings put secure screensaver_components "$app_id/expo.modules.t3nativecontrols.T3DreamService"
adb logcat -c
fixture="$(printf '%s' "${T3_DREAM_FIXTURE:-[]}" | base64 -w0)"
adb shell am instrument -w -e fixture "$fixture" -e appId "$app_id" com.t3tools.startuptest/.StartupInstrumentation | tee "$output/result.txt"
adb logcat -d -v threadtime > "$output/logcat.txt"
adb pull /sdcard/Android/data/com.t3tools.startuptest/files/ "$output/capture" || true
grep -q 'startup=PASS' "$output/result.txt"

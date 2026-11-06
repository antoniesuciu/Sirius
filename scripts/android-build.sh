#!/usr/bin/env bash
# Builds the Android app (apps/mobile) into releases/sirius-android-<version>.apk, for arm64
# phones. Everything it downloads lands in .cache/ (git-ignored), checked against published
# checksums: JDK 17 from Adoptium, SDK packages from Google, Gradle and Maven artifacts.
# No account, no cloud build, no cost. Signed with React Native's standard debug key, which
# is fine for installing on your own phone, not for a store.
set -euo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"
C="$R/.cache"
mkdir -p "$C/gradle" "$C/android-user" "$R/releases"

if [ ! -x "$C/jdk-17/bin/java" ]; then
  meta=$(curl -sSL "https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=linux&vendor=eclipse")
  url=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])[0]["binary"]["package"]["link"])' "$meta")
  sha=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])[0]["binary"]["package"]["checksum"])' "$meta")
  tmp="${TMPDIR:-/tmp}/jdk17.tar.gz"
  curl -sSL -o "$tmp" "$url"
  echo "$sha  $tmp" | sha256sum -c -
  mkdir -p "$C/jdk-17" && tar -xzf "$tmp" -C "$C/jdk-17" --strip-components=1
fi

if [ ! -x "$C/android-sdk/cmdline-tools/latest/bin/sdkmanager" ]; then
  tmp="${TMPDIR:-/tmp}/cmdline-tools.zip"
  curl -sSL -o "$tmp" https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip
  mkdir -p "$C/android-sdk/cmdline-tools" && unzip -q -o "$tmp" -d "$C/android-sdk/cmdline-tools"
  mv "$C/android-sdk/cmdline-tools/cmdline-tools" "$C/android-sdk/cmdline-tools/latest"
fi
# The versions React Native 0.88 and its libraries ask for.
python3 "$R/scripts/android/sdk-install.py" "platforms;android-37.0" "build-tools;37.0.0" \
  "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1"

export JAVA_HOME="$C/jdk-17" ANDROID_HOME="$C/android-sdk" ANDROID_USER_HOME="$C/android-user"
export GRADLE_USER_HOME="$C/gradle" EXPO_NO_TELEMETRY=1 NODE_ENV=production
export JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=${TMPDIR:-/tmp}"
{
  echo "org.gradle.daemon=false"
  echo "org.gradle.java.installations.paths=$C/jdk-17"
  echo "org.gradle.java.installations.auto-download=false"
  # Java ignores HTTPS_PROXY; inside a sandbox with an authenticating proxy, pass it on.
  if [ -n "${HTTPS_PROXY:-}" ]; then
    p="${HTTPS_PROXY#*://}"; creds="${p%@*}"; hp="${p##*@}"
    for s in http https; do
      echo "systemProp.$s.proxyHost=${hp%:*}"; echo "systemProp.$s.proxyPort=${hp##*:}"
      if [ "$creds" != "$p" ]; then
        echo "systemProp.$s.proxyUser=${creds%%:*}"; echo "systemProp.$s.proxyPassword=${creds#*:}"
      fi
    done
    echo "systemProp.jdk.http.auth.tunneling.disabledSchemes="
    echo "systemProp.http.nonProxyHosts=localhost|127.0.0.1"
  fi
} > "$GRADLE_USER_HOME/gradle.properties"

cd "$R/apps/mobile"
[ -d node_modules ] || bun install
./node_modules/.bin/expo prebuild --platform android --no-install
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain \
  "-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g -Djava.io.tmpdir=${TMPDIR:-/tmp}" \
  -Pkotlin.daemon.jvmargs="-Djava.io.tmpdir=${TMPDIR:-/tmp}"
version=$(python3 -c 'import json; print(json.load(open("../app.json"))["expo"]["version"])')
cp app/build/outputs/apk/release/app-release.apk "$R/releases/sirius-android-$version.apk"
echo "Built releases/sirius-android-$version.apk"

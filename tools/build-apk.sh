#!/usr/bin/env bash
#
# build-apk.sh — APK release autonome (installable directement).
#
#   tools/build-apk.sh                       # toutes les archis de gradle.properties
#   tools/build-apk.sh arm64-v8a             # une seule archi (build plus court)
#   tools/build-apk.sh arm64-v8a --offline   # args supplémentaires passés à Gradle
#
# Sortie : android/app/build/outputs/apk/release/app-release.apk

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

GRADLE_ARGS=()
if [ "${1:-}" ] && [[ "$1" != -* ]]; then
  GRADLE_ARGS+=("-PreactNativeArchitectures=$1")
  info "Archis limitées à : $1"
  shift
fi
GRADLE_ARGS+=("$@")

check_signing
run_gradle assembleRelease "${GRADLE_ARGS[@]}"
report_artifact "$APK_RELEASE"
info "Installer sur un device branché :  tools/install-adb.sh"

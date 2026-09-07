#!/usr/bin/env bash
#
# build-aab.sh — Android App Bundle release pour le Play Store.
#
#   tools/build-aab.sh                 # toutes les archis (obligatoire pour le Play Store)
#   tools/build-aab.sh --offline       # args supplémentaires passés à Gradle
#
# Sortie : android/app/build/outputs/bundle/release/app-release.aab
#
# NB : un .aab ne s'installe PAS directement sur un téléphone. Pour tester en local,
#      utilise tools/build-apk.sh, ou bundletool build-apks + install-apks.

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

# Le Play Store exige les 4 ABIs : on ne restreint jamais les archis ici, on passe
# juste d'éventuels flags Gradle.
check_signing
if ! { [ -f "${GRADLE_USER_HOME:-$HOME/.gradle}/gradle.properties" ] && \
       grep -q '^BUCKETPUSH_STORE_FILE=' "${GRADLE_USER_HOME:-$HOME/.gradle}/gradle.properties"; }; then
  warn "Un .aab signé avec la debug key sera REFUSÉ par le Play Store."
fi

run_gradle bundleRelease "$@"
report_artifact "$AAB_RELEASE"
info "Upload : Play Console → votre app → Production/Test → Créer une release."

# shellcheck shell=bash
# Helpers partagés par les scripts tools/*.sh — sourcé, pas exécuté.

set -euo pipefail

# Racine du repo (ce fichier vit dans tools/).
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$REPO_ROOT/android"
APK_RELEASE="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
AAB_RELEASE="$ANDROID_DIR/app/build/outputs/bundle/release/app-release.aab"
APP_ID="app.bucketpush.android"

_c()  { printf '\033[%sm' "$1"; }
info()  { printf '%s▸ %s%s\n' "$(_c '1;34')" "$*" "$(_c 0)"; }
ok()    { printf '%s✓ %s%s\n' "$(_c '1;32')" "$*" "$(_c 0)"; }
warn()  { printf '%s! %s%s\n' "$(_c '1;33')" "$*" "$(_c 0)" >&2; }
die()   { printf '%s✗ %s%s\n' "$(_c '1;31')" "$*" "$(_c 0)" >&2; exit 1; }

# ./gradlew avec les archis passées en 1er arg (vide = toutes celles de gradle.properties),
# le reste des args est transmis tel quel à Gradle.
run_gradle() {
  local task="$1"; shift
  [ -x "$ANDROID_DIR/gradlew" ] || die "android/gradlew introuvable — mauvais dossier ?"
  info "cd android && ./gradlew $task $*"
  ( cd "$ANDROID_DIR" && ./gradlew "$task" "$@" )
}

# Avertit si la clé d'upload release n'est pas configurée (Gradle retombe alors sur la debug key).
check_signing() {
  local props="${GRADLE_USER_HOME:-$HOME/.gradle}/gradle.properties"
  if [ -f "$props" ] && grep -q '^BUCKETPUSH_STORE_FILE=' "$props"; then
    local kf; kf="$(grep '^BUCKETPUSH_STORE_FILE=' "$props" | head -1 | cut -d= -f2-)"
    if [ -f "$kf" ]; then
      ok "Signature : clé d'upload BucketPush ($kf)"
    else
      warn "BUCKETPUSH_STORE_FILE défini mais le fichier n'existe pas : $kf"
    fi
  else
    warn "Clé d'upload absente ($props) → build signé avec la debug key."
    warn "  Pour le Play Store : renseigne BUCKETPUSH_STORE_FILE/_KEY_ALIAS/_STORE_PASSWORD/_KEY_PASSWORD."
  fi
}

# Affiche taille + sha256 + (si aapt dispo) versionName/Code d'un artefact.
report_artifact() {
  local f="$1"
  [ -f "$f" ] || die "Artefact attendu absent : $f"
  local size sha
  size="$(du -h "$f" | cut -f1)"
  sha="$(sha256sum "$f" | cut -d' ' -f1)"
  ok "$(basename "$f")  ($size)"
  printf '   chemin : %s\n' "$f"
  printf '   sha256 : %s\n' "$sha"
}

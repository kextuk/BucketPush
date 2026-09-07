#!/usr/bin/env bash
#
# install-adb.sh — pousse l'APK release sur un device branché en USB (adb).
#
#   tools/install-adb.sh                    # installe l'APK release existant, sinon le build
#   tools/install-adb.sh --build            # force un assembleRelease avant d'installer
#   tools/install-adb.sh --build arm64-v8a  # rebuild pour la seule archi arm64 (rapide)
#   tools/install-adb.sh -s <serial>        # cible un device précis (adb devices)
#   tools/install-adb.sh --no-launch        # n'ouvre pas l'app après install
#
# L'APK release est signé (clé d'upload si configurée, sinon debug key) et autonome.

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

FORCE_BUILD=0
LAUNCH=1
ABI=""
ADB_TARGET=()

while [ $# -gt 0 ]; do
  case "$1" in
    -b|--build) FORCE_BUILD=1 ;;
    --no-launch) LAUNCH=0 ;;
    -s) shift; ADB_TARGET=(-s "${1:?serial manquant après -s}") ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    -*) die "option inconnue : $1" ;;
    *) ABI="$1" ;;
  esac
  shift
done

command -v adb >/dev/null || die "adb introuvable (installe platform-tools / ajoute-le au PATH)."

# --- device ------------------------------------------------------------------
mapfile -t DEVICES < <(adb devices | awk 'NR>1 && $2=="device" {print $1}')
if [ "${#ADB_TARGET[@]}" -eq 0 ]; then
  case "${#DEVICES[@]}" in
    0) die "Aucun device autorisé. Branche le téléphone + accepte le débogage USB." ;;
    1) ADB_TARGET=(-s "${DEVICES[0]}") ;;
    *) die "Plusieurs devices : $(printf '%s ' "${DEVICES[@]}")— précise -s <serial>." ;;
  esac
fi
ok "Device : ${ADB_TARGET[1]}"

# --- build si besoin -------------------------------------------------------
if [ "$FORCE_BUILD" -eq 1 ] || [ ! -f "$APK_RELEASE" ]; then
  [ "$FORCE_BUILD" -eq 1 ] && info "Rebuild demandé." || warn "APK release absent → build."
  # shellcheck disable=SC2086
  "$REPO_ROOT/tools/build-apk.sh" $ABI
else
  ok "APK réutilisé (passe --build pour reconstruire) :"
  report_artifact "$APK_RELEASE"
fi

# --- install ---------------------------------------------------------------
info "adb install -r -d app-release.apk"
if ! adb "${ADB_TARGET[@]}" install -r -d "$APK_RELEASE"; then
  warn "Échec install (souvent : signature différente d'une install existante)."
  warn "Désinstaller puis réessayer :  adb ${ADB_TARGET[*]} uninstall $APP_ID"
  exit 1
fi
ok "Installé : $APP_ID"

# --- launch --------------------------------------------------------------
if [ "$LAUNCH" -eq 1 ]; then
  info "Lancement de l'app"
  adb "${ADB_TARGET[@]}" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 \
    && ok "App ouverte" \
    || warn "N'a pas pu lancer l'app automatiquement — ouvre-la à la main."
fi

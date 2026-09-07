import { useEffect, useReducer } from 'react';
import { NativeModules, Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';

export type Lang = 'fr' | 'en';
export type LangPref = Lang | 'auto';

const LANG_SERVICE = 's3pusher.lang';

function deviceLang(): Lang {
  let raw = '';
  try {
    if (Platform.OS === 'ios') {
      const s = NativeModules.SettingsManager?.settings;
      raw = s?.AppleLocale || s?.AppleLanguages?.[0] || '';
    } else {
      raw = NativeModules.I18nManager?.localeIdentifier || '';
    }
  } catch {
    raw = '';
  }
  return raw.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

let current: Lang = deviceLang();
let pref: LangPref = 'auto';
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}
export function getLangPref(): LangPref {
  return pref;
}
export function onLangChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Re-render le composant appelant quand la langue change (changement à la volée,
 * sans re-monter la navigation). Retourne la langue courante.
 */
export function useLang(): Lang {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onLangChange(force), []);
  return current;
}

/** À appeler au démarrage : lit la préférence stockée. */
export async function initLang(): Promise<void> {
  try {
    const s = await Keychain.getGenericPassword({ service: LANG_SERVICE });
    const v = (s && s.password) as LangPref | undefined;
    pref = v === 'fr' || v === 'en' || v === 'auto' ? v : 'auto';
  } catch {
    pref = 'auto';
  }
  current = pref === 'auto' ? deviceLang() : pref;
}

export async function setLangPref(p: LangPref): Promise<void> {
  pref = p;
  current = p === 'auto' ? deviceLang() : p;
  try {
    await Keychain.setGenericPassword('lang', p, { service: LANG_SERVICE });
  } catch {
    /* ignore */
  }
  listeners.forEach(cb => cb());
}

const DICT: Record<Lang, Record<string, string>> = {
  fr: {
    'nav.browser': 'BucketPush',
    'nav.queue': 'File d’attente',
    'nav.profiles': 'Profils S3',
    'nav.settings': 'Paramètres',
    'nav.profileEdit': 'Profil S3',
    'nav.versions': 'Versions',

    'common.cancel': 'Annuler',
    'common.close': 'Fermer',
    'common.delete': 'Supprimer',
    'common.ok': 'OK',
    'common.yes': 'oui',
    'common.no': 'non',
    'common.failure': 'Échec',
    'common.error': 'Erreur',
    'common.done': 'Terminé',
    'common.retry': 'Réessayer',
    'common.save': 'Enregistrer',

    'noProfile.title': 'Aucun profil S3 actif (ou clés manquantes).',
    'noProfile.tap': 'Appuie pour en configurer un.',
    'header.profiles': 'Profils',

    'browser.newFolder': '＋ dossier',
    'browser.filter': 'Filtrer…',
    'browser.empty': 'Dossier vide',
    'browser.noResult': 'Aucun résultat',
    'browser.loadMore': 'Charger plus',
    'browser.deleted': 'supprimé',
    'browser.obj': 'obj.',
    'browser.versionsShort': '{n} versions',

    'sort.name': 'A→Z',
    'sort.size': 'Taille',
    'sort.recent': 'Récent',

    'sel.count': '{n} sél.',
    'sel.all': 'Tout',
    'sel.move': 'Déplacer',
    'sel.download': 'Téléch.',
    'sel.delete': 'Suppr.',
    'sel.restore': 'Restaurer',
    'sel.purge': 'Suppr. déf.',
    'sel.rename': 'Renommer',
    'sel.seeVersions': 'Voir les versions',
    'sel.downloadN': 'Télécharger ({n})',
    'sel.restoreN': 'Restaurer ({n})',
    'sel.purgeN': 'Supprimer définitivement ({n})',
    'sel.title': '{n} sélectionné(s)',
    'sel.pasteHere': 'Coller ici',
    'sel.moveTo': 'Déplacer {n} → /{prefix}',
    'sel.moveFolderTo': 'Déplacer « {name} » → /{prefix}',

    'move.badDest': 'Destination invalide',
    'move.badDestFiles': 'Certains fichiers sont déjà dans ce dossier.',
    'move.sameLoc': 'Même emplacement',
    'move.folderAlreadyHere': 'Le dossier est déjà là.',
    'move.intoItself': 'On ne peut pas déplacer un dossier dans lui-même.',
    'move.emptyFolder': 'Dossier vide',
    'move.nothing': 'Rien à déplacer.',
    'move.result': '{ok} ok · {failed} en échec',

    'op.moving': 'Déplacement',
    'op.deleting': 'Suppression',
    'op.creating': 'Création',
    'op.downloading': 'Téléchargement',
    'op.purgeDef': 'Suppression définitive',
    'op.restoring': 'Restauration',
    'op.readingFolder': 'Lecture du dossier',
    'op.computingSize': 'Calcul de la taille',
    'op.purgeVersions': 'Purge des versions',
    'op.sizeProgress': '{bytes} · {n} objets',
    'op.withErrors': 'Terminé avec des erreurs',
    'op.nOfM': '{done}/{total} en échec.',

    'del.filesQ': 'Supprimer {n} fichier(s) ?',
    'del.recoverable': 'Récupérable via « Restaurer » tant que la version n’est pas purgée.',
    'purge.filesQ': 'Supprimer définitivement {n} objet(s) ?',
    'purge.warn': 'Toutes les versions ET les marqueurs seront supprimés. Irréversible.',
    'purge.btn': 'Supprimer déf.',
    'purge.doneN': '{n} version(s) supprimée(s).',
    'restore.doneN': '{n} fichier(s) restauré(s).',
    'restored': 'Restauré',
    'downloaded': 'Téléchargé',
    'download.doneN': '{n} fichier(s) enregistré(s).',
    'download.result': '{ok} ok · {failed} en échec',

    'add.inFolder': 'Ajouter dans {loc}',
    'add.root': 'la racine',
    'add.files': 'Fichiers…',
    'add.androidFolder': 'Dossier Android…',
    'queue.title': 'File d’attente',
    'queue.summaryAdded': '{n} fichier(s) ajouté(s).',
    'enqueue.skippedOnline': '{n} déjà en ligne',
    'enqueue.skippedInQueue': '{n} déjà dans la file',
    'enqueue.summary': '{added} ajouté(s), {skipped} ignoré(s) ({bits}).',
    'import.title': 'Importer « {name} »',
    'import.body': '{n} fichier(s) → /{prefix}\nUploader le dossier lui-même, ou seulement son contenu ?',
    'import.contents': 'Le contenu',
    'import.folder': '« {name}/ »',

    'folder.renameTitle': 'Renommer',
    'folder.newTitle': 'Nouveau dossier',
    'folder.namePlaceholder': 'Nom du dossier',
    'folder.newNamePlaceholder': 'Nouveau nom',
    'folder.rename': 'Renommer',
    'folder.move': 'Déplacer',
    'folder.restoreContent': 'Restaurer le contenu',
    'folder.purge': 'Purger les anciennes versions',
    'folder.deleteWithContent': 'Supprimer le dossier et son contenu',
    'folder.deleteQ': 'Supprimer ce dossier ?',
    'folder.deleteBody': '{prefix}\nTout son contenu sera supprimé (récupérable jusqu’à purge).',
    'folder.deletedN': '{n} objet(s).',

    'tools.title': 'Outils',
    'tools.sizeHere': 'Taille de ce dossier',
    'tools.sizeRepoCurrent': 'Taille du dépôt (versions actuelles)',
    'tools.sizeRepoAll': 'Taille réelle du dépôt (toutes versions, ≈ B2)',
    'tools.purgeHere': 'Purger les anciennes versions (dossier courant)',
    'tools.purgeAll': 'Purger les anciennes versions (tout le bucket)',
    'size.repoLabel': 'Dépôt entier',
    'size.rootLabel': 'Racine du bucket',
    'size.allVersionsSuffix': ' — toutes versions',
    'size.objects': '{n} objet(s)',
    'size.currentOnly': '(versions actuelles seulement — « taille réelle » pour le total facturé B2)',
    'size.failure': 'Échec du calcul',
    'purge.q': 'Purger les anciennes versions ?',
    'purge.qBody': '{label}\nToutes les versions non courantes seront supprimées (irréversible).',
    'purge.btn2': 'Purger',
    'purge.done': 'Purge terminée',

    'queue.status.running': 'en cours',
    'queue.status.paused': 'en pause',
    'queue.status.idle': 'au repos',
    'queue.pause': 'Pause',
    'queue.resume': 'Reprendre',
    'queue.clean': 'Nettoyer',
    'queue.empty': 'Rien dans la file. Ajoute des fichiers depuis le navigateur.',
    'queue.cancelUpload': 'Annuler l’upload',
    'queue.forceUpload': 'Forcer l’upload (écrase)',
    'queue.banner.failed': 'File d’attente — {n} échec(s)',
    'queue.banner.active': '{n} en cours · {pct}% · {speed}',
    'queue.banner.done': '{done}/{total} terminé(s)',
    'item.queued': 'en attente',
    'item.uploading': 'en cours',
    'item.completed': 'terminé',
    'item.failed': 'échec',
    'item.canceled': 'annulé',
    'item.paused': 'pause',
    'item.skipped': 'déjà en ligne',
    'item.parts': '{done}/{total} parts',

    'profiles.empty': 'Aucun profil. Crée-en un pour te connecter à un serveur S3.',
    'profiles.new': '+ Nouveau profil',
    'profiles.noName': '(sans nom)',
    'profiles.noEndpoint': 'endpoint non renseigné',
    'profiles.noKeys': 'clés S3 manquantes',
    'profiles.newName': 'Nouveau profil',
    'profiles.edit': 'Modifier',
    'profiles.duplicate': 'Dupliquer',
    'profiles.deleteQ': 'Supprimer ce profil ?',
    'profiles.deleteBody': '« {name} » et ses clés S3 seront effacés.',
    'profiles.switchTitle': 'Changer de profil',
    'profiles.switchBody': '{n} upload(s) en attente seront annulés et la liste vidée.',
    'profiles.switch': 'Changer',
    'profiles.stay': 'Rester',
    'profiles.activated': 'Profil activé',
    'profiles.activatedNoKeys': 'Ce profil n’a pas de clés S3. Ajoute-les via « Modifier ».',

    'settings.name': 'Nom du profil',
    'settings.nameHint': 'ex. Scaleway prod, MinIO maison',
    'settings.namePlaceholder': 'Nom du profil',
    'settings.endpoint': 'Endpoint',
    'settings.endpointHint': 'ex. https://s3.fr-par.scw.cloud',
    'settings.bucket': 'Bucket',
    'settings.keyPrefix': 'Préfixe de clé (dossier)',
    'settings.keyPrefixHint': 'optionnel, ex. sauvegardes/2026',
    'settings.accessKeyId': 'Access key ID',
    'settings.secret': 'Secret access key',
    'settings.pathStyle': 'Path-style (bucket dans l’URL)',
    'settings.pathStyleHint': 'requis par la plupart des S3-compatibles',
    'settings.wifiOnly': 'Wi-Fi uniquement',
    'settings.skipExisting': 'Ne pas ré-uploader si déjà sur le serveur',
    'settings.skipExistingHint': 'HEAD avant chaque upload ; l’objet existant n’est jamais touché',
    'settings.timestampKeys': 'Horodater les clés (anti-écrasement)',
    'settings.advanced': 'Avancé',
    'settings.transferSection': 'Réglages de transfert',
    'settings.transferIntro':
      'Valeurs par défaut, héritées par tous les profils. Chaque profil peut les surcharger dans sa config.',
    'settings.overrideIntro':
      '« Hérité » suit les Paramètres globaux. Active « Spécifique » pour figer une valeur sur ce profil.',
    'settings.inheritedValue': 'Hérité : {v}',
    'settings.specific': 'Spécifique',
    'settings.specificValue': 'Valeur spécifique',
    'settings.partAuto': 'auto',
    'settings.prefsSavedBody': 'Réglages de transfert enregistrés.',
    'settings.region': 'Region (SigV4)',
    'settings.regionHint': 'vide = dérivée de l’endpoint (ex. us-west-004)',
    'settings.partSize': 'Taille de part (MiB)',
    'settings.partSizeHint': 'vide = adaptatif (32 MiB, agrandi si besoin)',
    'settings.parallelParts': 'Parts en parallèle',
    'settings.parallelPartsHint': 'défaut 2',
    'settings.parallelFiles': 'Fichiers en parallèle',
    'settings.parallelFilesHint': 'défaut 1 (recommandé pour très gros fichiers)',
    'settings.moveConcurrency': 'Déplacements en parallèle',
    'settings.moveConcurrencyHint': 'défaut 4 ; monte à 8‑10 si ton fournisseur l’encaisse (sinon 503)',
    'settings.testConn': 'Tester la connexion',
    'settings.testing': 'Test…',
    'settings.connOk': 'Connexion OK',
    'settings.connOkBody': 'Le bucket est accessible.',
    'settings.saved': 'Enregistré',
    'settings.savedBody': 'Profil « {name} » mis à jour.',
    'settings.badFields': 'Champs invalides',
    'settings.credsRequired': 'Access key et secret requis.',
    'settings.forgetKeys': 'Effacer les clés stockées',
    'settings.keysCleared': 'Clés effacées',
    'settings.language': 'Langue',
    'settings.langAuto': 'Auto (appareil)',
    'settings.langFr': 'Français',
    'settings.langEn': 'English',

    'err.name': 'Nom de profil requis.',
    'err.endpoint': 'Endpoint invalide (doit commencer par http:// ou https://).',
    'err.bucketRequired': 'Bucket requis.',
    'err.bucketInvalid': 'Nom de bucket invalide.',
    'err.partSize': 'Taille de part minimale : 5 MiB.',

    'ver.key': '',
    'ver.hintNoVersions': 'Aucune version',
    'ver.current': 'actuelle',
    'ver.old': 'ancienne',
    'ver.deleteMarker': 'marqueur de suppression',
    'ver.deleteVersionQ': 'Supprimer cette version ?',
    'ver.deleteMarkerQ': 'Supprimer ce marqueur ?',
    'ver.restoreQ': 'Restaurer ce fichier ?',
    'ver.restoreBody': 'Le marqueur de suppression sera retiré, la version précédente redevient l’actuelle.',
    'ver.purgeQ': 'Purger les anciennes versions ?',
    'ver.purgeBody': '{n} version(s) non courante(s) seront supprimées.',
    'ver.purgeBtn': 'Purger {n} ancienne(s) version(s)',
    'ver.restore': 'Restaurer',

    'about.button': 'À propos',
    'about.title': 'À propos de BucketPush',
    'about.what':
      'BucketPush est un navigateur pour serveurs S3 (et compatibles) conçu pour transférer de très gros fichiers. Les envois et téléchargements se font par morceaux (multipart), lus directement depuis le stockage sans passer par la mémoire : l’usage RAM reste de quelques Mo quelle que soit la taille ou le nombre de fichiers, l’app ne sature pas et ne crashe pas. Les transferts continuent en arrière-plan et reprennent après une coupure réseau.',
    'about.oss':
      'Projet gratuit et open source. Aucune publicité, aucun pistage, aucun compte.',
    'about.privacy':
      'Respectueux de tes données : tes clés d’accès sont chiffrées et stockées uniquement sur l’appareil, et rien n’est envoyé ailleurs que vers le serveur S3 que tu configures.',
    'about.permsTitle': 'Autorisations',
    'about.permNetwork': 'Réseau (Internet / état du réseau)',
    'about.permNetworkWhy':
      'Communiquer avec ton serveur S3, et distinguer Wi-Fi / données mobiles pour l’option « Wi-Fi uniquement ».',
    'about.permNotif': 'Notifications',
    'about.permNotifWhy':
      'Afficher la progression du transfert en cours. Android l’impose pour tout traitement long en arrière-plan.',
    'about.permBackground':
      'Arrière-plan (service de premier plan, veille, redémarrage)',
    'about.permBackgroundWhy':
      'Poursuivre un gros transfert écran éteint ou app fermée, empêcher la mise en veille pendant le transfert, et reprendre les transferts en attente après un redémarrage du téléphone.',
  },
  en: {
    'nav.browser': 'BucketPush',
    'nav.queue': 'Queue',
    'nav.profiles': 'S3 profiles',
    'nav.settings': 'Settings',
    'nav.profileEdit': 'S3 profile',
    'nav.versions': 'Versions',

    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.delete': 'Delete',
    'common.ok': 'OK',
    'common.yes': 'yes',
    'common.no': 'no',
    'common.failure': 'Failed',
    'common.error': 'Error',
    'common.done': 'Done',
    'common.retry': 'Retry',
    'common.save': 'Save',

    'noProfile.title': 'No active S3 profile (or missing keys).',
    'noProfile.tap': 'Tap to set one up.',
    'header.profiles': 'Profiles',

    'browser.newFolder': '＋ folder',
    'browser.filter': 'Filter…',
    'browser.empty': 'Empty folder',
    'browser.noResult': 'No match',
    'browser.loadMore': 'Load more',
    'browser.deleted': 'deleted',
    'browser.obj': 'obj.',
    'browser.versionsShort': '{n} versions',

    'sort.name': 'A→Z',
    'sort.size': 'Size',
    'sort.recent': 'Recent',

    'sel.count': '{n} sel.',
    'sel.all': 'All',
    'sel.move': 'Move',
    'sel.download': 'Download',
    'sel.delete': 'Delete',
    'sel.restore': 'Restore',
    'sel.purge': 'Purge',
    'sel.rename': 'Rename',
    'sel.seeVersions': 'See versions',
    'sel.downloadN': 'Download ({n})',
    'sel.restoreN': 'Restore ({n})',
    'sel.purgeN': 'Delete permanently ({n})',
    'sel.title': '{n} selected',
    'sel.pasteHere': 'Paste here',
    'sel.moveTo': 'Move {n} → /{prefix}',
    'sel.moveFolderTo': 'Move “{name}” → /{prefix}',

    'move.badDest': 'Invalid destination',
    'move.badDestFiles': 'Some files are already in this folder.',
    'move.sameLoc': 'Same location',
    'move.folderAlreadyHere': 'The folder is already here.',
    'move.intoItself': 'A folder can’t be moved into itself.',
    'move.emptyFolder': 'Empty folder',
    'move.nothing': 'Nothing to move.',
    'move.result': '{ok} ok · {failed} failed',

    'op.moving': 'Moving',
    'op.deleting': 'Deleting',
    'op.creating': 'Creating',
    'op.downloading': 'Downloading',
    'op.purgeDef': 'Permanent delete',
    'op.restoring': 'Restoring',
    'op.readingFolder': 'Reading folder',
    'op.computingSize': 'Computing size',
    'op.purgeVersions': 'Purging versions',
    'op.sizeProgress': '{bytes} · {n} objects',
    'op.withErrors': 'Finished with errors',
    'op.nOfM': '{done}/{total} failed.',

    'del.filesQ': 'Delete {n} file(s)?',
    'del.recoverable': 'Recoverable via “Restore” until the version is purged.',
    'purge.filesQ': 'Permanently delete {n} object(s)?',
    'purge.warn': 'Every version AND marker will be removed. Irreversible.',
    'purge.btn': 'Delete perm.',
    'purge.doneN': '{n} version(s) deleted.',
    'restore.doneN': '{n} file(s) restored.',
    'restored': 'Restored',
    'downloaded': 'Downloaded',
    'download.doneN': '{n} file(s) saved.',
    'download.result': '{ok} ok · {failed} failed',

    'add.inFolder': 'Add to {loc}',
    'add.root': 'the root',
    'add.files': 'Files…',
    'add.androidFolder': 'Android folder…',
    'queue.title': 'Queue',
    'queue.summaryAdded': '{n} file(s) added.',
    'enqueue.skippedOnline': '{n} already online',
    'enqueue.skippedInQueue': '{n} already queued',
    'enqueue.summary': '{added} added, {skipped} skipped ({bits}).',
    'import.title': 'Import “{name}”',
    'import.body': '{n} file(s) → /{prefix}\nUpload the folder itself, or only its contents?',
    'import.contents': 'Contents',
    'import.folder': '“{name}/”',

    'folder.renameTitle': 'Rename',
    'folder.newTitle': 'New folder',
    'folder.namePlaceholder': 'Folder name',
    'folder.newNamePlaceholder': 'New name',
    'folder.rename': 'Rename',
    'folder.move': 'Move',
    'folder.restoreContent': 'Restore contents',
    'folder.purge': 'Purge old versions',
    'folder.deleteWithContent': 'Delete folder and its contents',
    'folder.deleteQ': 'Delete this folder?',
    'folder.deleteBody': '{prefix}\nAll its contents will be deleted (recoverable until purged).',
    'folder.deletedN': '{n} object(s).',

    'tools.title': 'Tools',
    'tools.sizeHere': 'Size of this folder',
    'tools.sizeRepoCurrent': 'Repo size (current versions)',
    'tools.sizeRepoAll': 'True repo size (all versions, ≈ B2)',
    'tools.purgeHere': 'Purge old versions (current folder)',
    'tools.purgeAll': 'Purge old versions (whole bucket)',
    'size.repoLabel': 'Whole repo',
    'size.rootLabel': 'Bucket root',
    'size.allVersionsSuffix': ' — all versions',
    'size.objects': '{n} object(s)',
    'size.currentOnly': '(current versions only — use “true size” for the B2-billed total)',
    'size.failure': 'Size computation failed',
    'purge.q': 'Purge old versions?',
    'purge.qBody': '{label}\nEvery non-current version will be deleted (irreversible).',
    'purge.btn2': 'Purge',
    'purge.done': 'Purge complete',

    'queue.status.running': 'running',
    'queue.status.paused': 'paused',
    'queue.status.idle': 'idle',
    'queue.pause': 'Pause',
    'queue.resume': 'Resume',
    'queue.clean': 'Clear',
    'queue.empty': 'Queue is empty. Add files from the browser.',
    'queue.cancelUpload': 'Cancel upload',
    'queue.forceUpload': 'Force upload (overwrite)',
    'queue.banner.failed': 'Queue — {n} failed',
    'queue.banner.active': '{n} running · {pct}% · {speed}',
    'queue.banner.done': '{done}/{total} done',
    'item.queued': 'queued',
    'item.uploading': 'uploading',
    'item.completed': 'done',
    'item.failed': 'failed',
    'item.canceled': 'canceled',
    'item.paused': 'paused',
    'item.skipped': 'already online',
    'item.parts': '{done}/{total} parts',

    'profiles.empty': 'No profile yet. Create one to connect to an S3 server.',
    'profiles.new': '+ New profile',
    'profiles.noName': '(no name)',
    'profiles.noEndpoint': 'endpoint not set',
    'profiles.noKeys': 'S3 keys missing',
    'profiles.newName': 'New profile',
    'profiles.edit': 'Edit',
    'profiles.duplicate': 'Duplicate',
    'profiles.deleteQ': 'Delete this profile?',
    'profiles.deleteBody': '“{name}” and its S3 keys will be erased.',
    'profiles.switchTitle': 'Switch profile',
    'profiles.switchBody': '{n} pending upload(s) will be canceled and the list cleared.',
    'profiles.switch': 'Switch',
    'profiles.stay': 'Stay',
    'profiles.activated': 'Profile activated',
    'profiles.activatedNoKeys': 'This profile has no S3 keys. Add them via “Edit”.',

    'settings.name': 'Profile name',
    'settings.nameHint': 'e.g. Scaleway prod, home MinIO',
    'settings.namePlaceholder': 'Profile name',
    'settings.endpoint': 'Endpoint',
    'settings.endpointHint': 'e.g. https://s3.fr-par.scw.cloud',
    'settings.bucket': 'Bucket',
    'settings.keyPrefix': 'Key prefix (folder)',
    'settings.keyPrefixHint': 'optional, e.g. backups/2026',
    'settings.accessKeyId': 'Access key ID',
    'settings.secret': 'Secret access key',
    'settings.pathStyle': 'Path-style (bucket in URL)',
    'settings.pathStyleHint': 'required by most S3-compatibles',
    'settings.wifiOnly': 'Wi-Fi only',
    'settings.skipExisting': 'Don’t re-upload if already on the server',
    'settings.skipExistingHint': 'HEAD before each upload; the existing object is never touched',
    'settings.timestampKeys': 'Timestamp keys (avoid overwrite)',
    'settings.advanced': 'Advanced',
    'settings.transferSection': 'Transfer settings',
    'settings.transferIntro':
      'Defaults inherited by every profile. Each profile can override them in its config.',
    'settings.overrideIntro':
      '“Inherited” follows the global Settings. Turn on “Specific” to pin a value for this profile.',
    'settings.inheritedValue': 'Inherited: {v}',
    'settings.specific': 'Specific',
    'settings.specificValue': 'Specific value',
    'settings.partAuto': 'auto',
    'settings.prefsSavedBody': 'Transfer settings saved.',
    'settings.region': 'Region (SigV4)',
    'settings.regionHint': 'empty = derived from the endpoint (e.g. us-west-004)',
    'settings.partSize': 'Part size (MiB)',
    'settings.partSizeHint': 'empty = adaptive (32 MiB, grown if needed)',
    'settings.parallelParts': 'Parallel parts',
    'settings.parallelPartsHint': 'default 2',
    'settings.parallelFiles': 'Parallel files',
    'settings.parallelFilesHint': 'default 1 (recommended for very large files)',
    'settings.moveConcurrency': 'Parallel moves',
    'settings.moveConcurrencyHint': 'default 4; raise to 8‑10 if your provider allows (else 503)',
    'settings.testConn': 'Test connection',
    'settings.testing': 'Testing…',
    'settings.connOk': 'Connection OK',
    'settings.connOkBody': 'The bucket is reachable.',
    'settings.saved': 'Saved',
    'settings.savedBody': 'Profile “{name}” updated.',
    'settings.badFields': 'Invalid fields',
    'settings.credsRequired': 'Access key and secret required.',
    'settings.forgetKeys': 'Erase stored keys',
    'settings.keysCleared': 'Keys erased',
    'settings.language': 'Language',
    'settings.langAuto': 'Auto (device)',
    'settings.langFr': 'Français',
    'settings.langEn': 'English',

    'err.name': 'Profile name required.',
    'err.endpoint': 'Invalid endpoint (must start with http:// or https://).',
    'err.bucketRequired': 'Bucket required.',
    'err.bucketInvalid': 'Invalid bucket name.',
    'err.partSize': 'Minimum part size: 5 MiB.',

    'ver.key': '',
    'ver.hintNoVersions': 'No version',
    'ver.current': 'current',
    'ver.old': 'old',
    'ver.deleteMarker': 'delete marker',
    'ver.deleteVersionQ': 'Delete this version?',
    'ver.deleteMarkerQ': 'Delete this marker?',
    'ver.restoreQ': 'Restore this file?',
    'ver.restoreBody': 'The delete marker will be removed, the previous version becomes current again.',
    'ver.purgeQ': 'Purge old versions?',
    'ver.purgeBody': '{n} non-current version(s) will be deleted.',
    'ver.purgeBtn': 'Purge {n} old version(s)',
    'ver.restore': 'Restore',

    'about.button': 'About',
    'about.title': 'About BucketPush',
    'about.what':
      'BucketPush is a browser for S3 (and S3-compatible) servers built to move very large files. Uploads and downloads run in chunks (multipart), streamed straight from storage without going through memory: RAM use stays a few MB whatever the size or number of files, so the app never chokes or crashes. Transfers keep running in the background and resume after a network drop.',
    'about.oss':
      'Free and open-source project. No ads, no tracking, no account.',
    'about.privacy':
      'Respectful of your data: your access keys are encrypted and stored on the device only, and nothing is sent anywhere except the S3 server you configure.',
    'about.permsTitle': 'Permissions',
    'about.permNetwork': 'Network (Internet / network state)',
    'about.permNetworkWhy':
      'Talk to your S3 server, and tell Wi-Fi from mobile data for the “Wi-Fi only” option.',
    'about.permNotif': 'Notifications',
    'about.permNotifWhy':
      'Show the progress of the running transfer. Android requires it for any long background work.',
    'about.permBackground': 'Background (foreground service, wake lock, boot)',
    'about.permBackgroundWhy':
      'Keep a large transfer going with the screen off or the app closed, prevent sleep during a transfer, and resume pending transfers after the phone reboots.',
  },
};

export function t(key: string, params?: Record<string, string | number>): string {
  let s = DICT[current][key] ?? DICT.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

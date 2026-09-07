/**
 * Identifiants du bucket de test injecté au tout premier lancement.
 *
 * VIDES dans le dépôt public — les vraies clés sont distribuées hors dépôt
 * (cf. README, section « Bucket de test »). Sans elles, le profil de démo est
 * quand même créé : il s'affiche « prêt » et l'utilisateur colle ses clés.
 *
 * Pour produire un build de test clé en main :
 *   1. renseigner accessKeyId / secretAccessKey ci-dessous ;
 *   2. `git update-index --skip-worktree src/seed.ts` pour que git ignore la
 *      modif locale (le dépôt garde la version vide).
 * Revenir en arrière : `git update-index --no-skip-worktree src/seed.ts`.
 */
export const SEED_CREDENTIALS: { accessKeyId: string; secretAccessKey: string } = {
  accessKeyId: '',
  secretAccessKey: '',
};

/**
 * Pure decision logic for the boot-time orphan sweep (disk-safety audit L5).
 *
 * A LEAF module with no imports — self-checks run it under plain Node type
 * stripping, which cannot resolve extensionless imports (same constraint
 * as photo-file-name). The photo-name gate below therefore duplicates
 * photo-file-name's CAMOG_PHOTO_FILE_RE; scripts/
 * self-check-photos-dir-approval.mjs pins the two decisions to agree so
 * they cannot drift.
 *
 * Deletion policy — deliberately asymmetric:
 * - Photo and result files with no matching database row are only ever
 *   REPORTED, never deleted. The photos folder may be a cloud-synced
 *   folder pointed at by a second machine whose database differs, so this
 *   machine's rows are not the whole truth; auto-deleting on a mismatch
 *   could destroy another machine's photos.
 * - Backup seal debris (camog-backup-<stamp>.db.tmp) is machine-local by
 *   construction — it only exists when this machine crashed mid-seal —
 *   so it is marked for deletion.
 */

/**
 * Photo/thumbnail gate: same decision as photo-file-name's
 * CAMOG_PHOTO_FILE_RE ({uuid}.jpg and {uuid}.thumb.jpg).
 */
const CAMOG_PHOTO_FILE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.thumb)?\.jpg$/;

/** Backup seal debris: a crashed seal leaves the cipher under a .tmp name
 * the backup-name regex ignores, so nothing else ever cleans it up. */
export const BACKUP_TMP_RE = /^camog-backup-\d{14}\.db\.tmp$/;

/** True only for filenames Camog writes into the photos folder. */
export function isCamogSweepPhotoFileName(name: string): boolean {
  return CAMOG_PHOTO_FILE_RE.test(name);
}

export interface OrphanSweepPlan {
  /** Top-level {uuid}.jpg / {uuid}.thumb.jpg files with no photo row. */
  orphanPhotoFiles: string[];
  /** results/ files with no result_files row. */
  orphanResultFiles: string[];
  /** Crashed backup seals — safe to delete (machine-local debris). */
  backupTmpDebris: string[];
}

export function planOrphanSweep(
  photoDirFiles: string[],
  resultDirFiles: string[],
  knownPhotoFileNames: Set<string>,
  knownResultFileNames: Set<string>,
): OrphanSweepPlan {
  const orphanPhotoFiles: string[] = [];
  const backupTmpDebris: string[] = [];
  for (const name of photoDirFiles) {
    if (BACKUP_TMP_RE.test(name)) {
      backupTmpDebris.push(name);
    } else if (isCamogSweepPhotoFileName(name) && !knownPhotoFileNames.has(name)) {
      orphanPhotoFiles.push(name);
    }
    // Anything else in the folder is not Camog's — ignored entirely.
  }
  const orphanResultFiles = resultDirFiles.filter(
    (name) => !knownResultFileNames.has(name),
  );
  return { orphanPhotoFiles, orphanResultFiles, backupTmpDebris };
}

/** Backup-job operations from distilled-proxmox, walked against pve-manager 9.2.11. */
import * as cluster from '@distilled.cloud/proxmox/cluster';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import { ProxmoxParseError } from '@distilled.cloud/proxmox/Errors';
import { backupJobSpec } from './backup-job-config.ts';
import type { BackupJobProps } from './backup-job.ts';
import { runPve } from './distilled-pve.ts';

/** SDK member names differ from the vendor's hyphenated form keys; omission stays omission. */
export const backupJobRequest = (props: BackupJobProps): cluster.PutClusterBackupRequest => {
  const {
    'notes-template': notes_template,
    'notification-mode': notification_mode,
    'prune-backups': prune_backups,
    'repeat-missed': repeat_missed,
    ...fields
  } = backupJobSpec.updateForm(props);
  return {
    ...fields,
    id: props.id,
    notification_mode,
    repeat_missed,
    ...(notes_template === undefined ? {} : { notes_template }),
    ...(prune_backups === undefined ? {} : { prune_backups }),
  };
};

/**
 * SDK decode also renames NESTED retention keys. Restore the vendor's property-string
 * spelling before the existing canonical comparison, or keep_daily becomes perpetual drift.
 * A property string from an older server remains a property string.
 */
export const readBackupJob = (props: BackupJobProps) =>
  runPve(props.target, 'read', false, cluster.getClusterBackup({ id: props.id })).pipe(
    // Legacy PVE emits these two properties as strings; current PVE expands objects.
    // Validate the generated response's remaining fields without narrowing that compatibility.
    Effect.flatMap((live) =>
      Schema.decodeUnknownEffect(cluster.GetClusterBackupResponse)({
        ...live,
        prune_backups: undefined,
        fleecing: undefined,
      }).pipe(
        Effect.mapError(
          () =>
            new ProxmoxParseError({
              body: undefined,
              cause: 'Backup job response does not match its vendor schema',
            }),
        ),
        Effect.as(live),
      ),
    ),
    Effect.map((live) =>
      backupJobSpec.attributes(
        {
          ...live,
          'next-run': live.next_run,
          'notes-template': live.notes_template,
          'notification-mode': live.notification_mode,
          'prune-backups':
            typeof live.prune_backups === 'object' && live.prune_backups !== null
              ? Object.fromEntries(
                  Object.entries(live.prune_backups).map(([key, value]) => [
                    key.replaceAll('_', '-'),
                    value,
                  ]),
                )
              : live.prune_backups,
          'repeat-missed': live.repeat_missed,
        },
        props,
      ),
    ),
    Effect.catchTag('BackupJobNotFound', () => Effect.succeed(undefined)),
    Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
  );

export const deleteBackupJob = (props: BackupJobProps) =>
  runPve(props.target, 'provision', true, cluster.deleteClusterBackup({ id: props.id })).pipe(
    Effect.catchTag('BackupJobNotFound', () => Effect.void),
    Effect.catchTag('NotFound', () => Effect.void),
  );

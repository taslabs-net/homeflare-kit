/** Stable PBS sync-job state; only vendor configuration, never runtime task status. */
export interface SyncJobAttributes {
  /** From the props — it is the path this object was read by. */
  id: string;
  store: string;
  /** `''` is the root namespace, which is also how PBS spells it. */
  ns: string;
  /** `''` means a LOCAL sync — datastore to datastore on this PBS. */
  remote: string;
  'remote-store': string;
  'remote-ns': string;
  /** `''` means the job runs only when somebody starts it. */
  schedule: string;
  comment: string;
  'remove-vanished': boolean;
  /** ⚠️ Absent on the wire means `false`, PBS's own default. */
  'verified-only': boolean;
  /** `''` means no owner in the config, i.e. `root@pam` at runtime. An identifier, never a secret. */
  owner: string;
  /** Bytes per second, or `UNSET` (-1). See `bytes()`. */
  'rate-in': number;
  /** `UNSET` (-1) means unset, which means full recursion. `0` is a real value meaning none. */
  'max-depth': number;
  /** `UNSET` (-1) means all snapshots. */
  'transfer-last': number;
  /**
   * ⚠️ REPORTED, NEVER SENT, NEVER COMPARED — the live filter list joined for display only. See the
   *   ⛔ on the prop for why it is not declarable.
   */
  'group-filter': string;
  /** `pull` or `push`. Reported, never compared — create-only here. */
  'sync-direction': string;
}

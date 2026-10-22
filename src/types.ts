export type LiftHandle = {
  lift(): void;
  drop(opts?: { immediate?: boolean }): void;
};

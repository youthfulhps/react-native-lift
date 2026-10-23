// One lift at a time, owned by LiftHost. The press (scale 0.95 until the long
// press activates) lives in the gesture on the UI thread and never reaches
// this machine; it starts at the lift request.
//
//   idle ──lift──▶ measuring ──committed──▶ lifted ──drop──▶ dropping
//    ▲                │  drop/cancel          │ dropped        │ dropped
//    └────────────────┴───────────────────────┴────────────────┘
//
// A lift from another slot is rejected in every phase but idle: the host
// layer the drop animation moves is shared, so a second view lifted mid-drop
// would ride along with it.
export type LiftState<S> =
  { phase: 'idle' } | { phase: 'measuring' | 'lifted' | 'dropping'; slot: S };

export type LiftEvent<S> = {
  type: 'lift' | 'committed' | 'cancel' | 'drop' | 'dropped';
  slot: S;
};

export const IDLE = { phase: 'idle' } as const;

export function transition<S>(
  state: LiftState<S>,
  { type, slot }: LiftEvent<S>
): LiftState<S> {
  if (state.phase === 'idle') {
    return type === 'lift' ? { phase: 'measuring', slot } : state;
  }
  if (state.slot !== slot) {
    return state;
  }
  switch (type) {
    case 'lift':
      // A lift mid-drop cancels the drop; otherwise a repeat.
      return state.phase === 'dropping' ? { phase: 'lifted', slot } : state;
    case 'committed':
      return state.phase === 'measuring' ? { phase: 'lifted', slot } : state;
    case 'cancel':
      return state.phase === 'measuring' ? IDLE : state;
    case 'drop':
      if (state.phase === 'measuring') {
        return IDLE;
      }
      return state.phase === 'lifted' ? { phase: 'dropping', slot } : state;
    case 'dropped':
      return IDLE;
  }
}

// The lift was accepted: the slot owns the machine afterwards.
export const owns = <S>(state: LiftState<S>, slot: S) =>
  state.phase !== 'idle' && state.slot === slot;

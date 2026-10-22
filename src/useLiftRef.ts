import { useRef } from 'react';
import type { LiftHandle } from './types';

export function useLiftRef() {
  return useRef<LiftHandle>(null);
}

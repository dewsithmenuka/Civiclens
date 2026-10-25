import { IssueStatus as S, ISSUE_TRANSITIONS } from '@civiclens/contracts';

/**
 * The issue lifecycle as an explicit state machine. The server is the only authority:
 * clients request a transition, the domain decides whether it is legal.
 * The table itself lives in @civiclens/contracts so the dashboard offers exactly the same moves.
 */
export const TRANSITIONS = ISSUE_TRANSITIONS;

export const canTransition = (from: S, to: S): boolean =>
  TRANSITIONS[from]?.includes(to) ?? false;

export const isTerminal = (s: S): boolean => TRANSITIONS[s].length === 0;

/** Statuses hidden from the public map (still visible to moderators and the reporter's own history). */
export const HIDDEN_FROM_PUBLIC: readonly S[] = [S.REJECTED, S.DUPLICATE];

import { describe, expect, it } from '@jest/globals';
import { IssueStatus as S, ISSUE_TRANSITIONS } from '@civiclens/contracts';
import {
  TRANSITIONS,
  canTransition,
  isTerminal,
  HIDDEN_FROM_PUBLIC,
} from './lifecycle';

describe('issue lifecycle', () => {
  it('uses the shared contract transition table', () => {
    expect(TRANSITIONS).toBe(ISSUE_TRANSITIONS);
  });

  it('allows valid transitions', () => {
    expect(canTransition(S.REPORTED, S.UNDER_REVIEW)).toBe(true);
    expect(canTransition(S.UNDER_REVIEW, S.ACKNOWLEDGED)).toBe(true);
    expect(canTransition(S.ACKNOWLEDGED, S.IN_PROGRESS)).toBe(true);
    expect(canTransition(S.IN_PROGRESS, S.RESOLVED)).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransition(S.REPORTED, S.RESOLVED)).toBe(false);
    expect(canTransition(S.RESOLVED, S.REPORTED)).toBe(false);
    expect(canTransition(S.REJECTED, S.IN_PROGRESS)).toBe(false);
    expect(canTransition(S.DUPLICATE, S.ACKNOWLEDGED)).toBe(false);
  });

  it('identifies terminal statuses', () => {
    expect(isTerminal(S.RESOLVED)).toBe(true);
    expect(isTerminal(S.DUPLICATE)).toBe(true);
    expect(isTerminal(S.REJECTED)).toBe(true);
    expect(isTerminal(S.REPORTED)).toBe(false);
    expect(isTerminal(S.IN_PROGRESS)).toBe(false);
  });

  it('hides rejected and duplicate issues from the public map', () => {
    expect(HIDDEN_FROM_PUBLIC).toEqual([S.REJECTED, S.DUPLICATE]);
  });
});

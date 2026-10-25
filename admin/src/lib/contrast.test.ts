import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';

// Colour tokens from globals.css (keep in sync).
const C = {
  bg: '#F7F7F4', surface: '#FFFFFF', text: '#20211F', muted: '#5C5F59', border: '#E6E6E0',
  accent: '#2F7D67', accentDark: '#276B58', accentSoft: '#E4F0EC',
  warning: '#8A5D0A', warningSoft: '#FBF1DC',
  danger: '#A63C32', dangerSoft: '#F7E4E1',
  info: '#3F6082', infoSoft: '#E6EDF4',
  neutralSoft: '#ECECE8', adminFg: '#6B3FA0', adminBg: '#EADFF5',
};

describe('contrast helper', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#767676', '#FFFFFF')).toBeGreaterThan(4.5); // the classic "just passes" grey
    expect(contrastRatio('#777777', '#FFFFFF')).toBeLessThan(4.6);
  });
  it('is symmetric', () => expect(contrastRatio('#123456', '#FEDCBA')).toBeCloseTo(contrastRatio('#FEDCBA', '#123456'), 10));
});

/** WCAG AA: 4.5:1 for normal text. Every text/background pair the dashboard actually renders. */
const TEXT_PAIRS: [string, string, string][] = [
  ['body text on page', C.text, C.bg], ['body text on card', C.text, C.surface],
  ['muted text on page', C.muted, C.bg], ['muted text on card', C.muted, C.surface], ['muted on neutral badge', C.muted, C.neutralSoft],
  ['link on card', C.accent, C.surface], ['link on page', C.accent, C.bg],
  ['primary button', '#FFFFFF', C.accent], ['primary button hover', '#FFFFFF', C.accentDark],
  ['danger text on card', C.danger, C.surface], ['danger badge', C.danger, C.dangerSoft], ['danger alert', C.danger, C.dangerSoft],
  ['info badge', C.info, C.infoSoft], ['warning badge / alert / KPI', C.warning, C.warningSoft], ['warning KPI on card', C.warning, C.surface],
  ['success badge / alert', C.accentDark, C.accentSoft], ['admin badge', C.adminFg, C.adminBg],
];

describe('WCAG AA text contrast (4.5:1)', () => {
  it.each(TEXT_PAIRS)('%s', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('WCAG non-text contrast (3:1)', () => {
  it('the focus ring is visible on the page and on cards', () => {
    expect(contrastRatio(C.accent, C.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(C.accent, C.surface)).toBeGreaterThanOrEqual(3);
  });
});
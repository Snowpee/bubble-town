import type { CSSProperties } from 'react';

export type CompanionThemeName = 'warmPeach' | 'softBlue' | 'lavender' | 'forest' | 'blackPurple';

export interface CompanionTheme {
  label: string;
  bgStart: string;
  bgMiddle: string;
  bgEnd: string;
  accent: string;
  accentDeep: string;
  accentSoft: string;
  aura: string;
  auraDeep: string;
  text: string;
  mutedText: string;
  grid: string;
  cardBorder: string;
  glowShadow: string;
  pageGlow?: string;
  card?: string;
  popover?: string;
  secondary?: string;
  muted?: string;
  primaryForeground?: string;
  glassShadow?: string;
}

export const companionThemes: Record<CompanionThemeName, CompanionTheme> = {
  warmPeach: {
    label: 'Warm Peach',
    bgStart: '#fffaf6',
    bgMiddle: '#fff1e8',
    bgEnd: '#f4c9b6',
    accent: '#df7d57',
    accentDeep: '#b95f44',
    accentSoft: 'rgba(223, 125, 87, 0.22)',
    aura: 'rgba(255, 186, 139, 0.34)',
    auraDeep: 'rgba(211, 102, 70, 0.16)',
    text: '#4a2f24',
    mutedText: 'rgba(74, 47, 36, 0.66)',
    grid: 'rgba(223, 125, 87, 0.16)',
    cardBorder: 'rgba(120, 72, 48, 0.09)',
    glowShadow: 'rgba(223, 125, 87, 0.16)',
  },
  softBlue: {
    label: 'Soft Blue',
    bgStart: '#f8fcff',
    bgMiddle: '#eef7ff',
    bgEnd: '#c9deef',
    accent: '#5d9fc8',
    accentDeep: '#3f7fa6',
    accentSoft: 'rgba(93, 159, 200, 0.2)',
    aura: 'rgba(151, 203, 233, 0.38)',
    auraDeep: 'rgba(70, 133, 173, 0.15)',
    text: '#213747',
    mutedText: 'rgba(33, 55, 71, 0.66)',
    grid: 'rgba(93, 159, 200, 0.15)',
    cardBorder: 'rgba(65, 112, 145, 0.11)',
    glowShadow: 'rgba(93, 159, 200, 0.16)',
  },
  lavender: {
    label: 'Lavender',
    bgStart: '#fbf7ff',
    bgMiddle: '#fff8fc',
    bgEnd: '#ddd0f0',
    accent: '#9876ce',
    accentDeep: '#7858b1',
    accentSoft: 'rgba(152, 118, 206, 0.22)',
    aura: 'rgba(203, 174, 238, 0.36)',
    auraDeep: 'rgba(120, 88, 177, 0.16)',
    text: '#352846',
    mutedText: 'rgba(53, 40, 70, 0.64)',
    grid: 'rgba(152, 118, 206, 0.16)',
    cardBorder: 'rgba(87, 58, 126, 0.12)',
    glowShadow: 'rgba(152, 118, 206, 0.16)',
  },
  forest: {
    label: 'Forest',
    bgStart: '#f9fbf4',
    bgMiddle: '#f3fbef',
    bgEnd: '#c9dfbf',
    accent: '#6d9a73',
    accentDeep: '#538259',
    accentSoft: 'rgba(109, 154, 115, 0.22)',
    aura: 'rgba(174, 209, 151, 0.36)',
    auraDeep: 'rgba(83, 130, 89, 0.15)',
    text: '#263b2b',
    mutedText: 'rgba(38, 59, 43, 0.66)',
    grid: 'rgba(109, 154, 115, 0.15)',
    cardBorder: 'rgba(67, 112, 74, 0.12)',
    glowShadow: 'rgba(109, 154, 115, 0.16)',
  },
  blackPurple: {
    label: 'Black Purple',
    bgStart: '#05030a',
    bgMiddle: '#11081f',
    bgEnd: '#24103e',
    accent: '#a855f7',
    accentDeep: '#7c3aed',
    accentSoft: 'rgba(168, 85, 247, 0.26)',
    aura: 'rgba(192, 132, 252, 0.3)',
    auraDeep: 'rgba(126, 34, 206, 0.24)',
    text: '#f5f3ff',
    mutedText: 'rgba(221, 214, 254, 0.68)',
    grid: 'rgba(168, 85, 247, 0.18)',
    cardBorder: 'rgba(216, 180, 254, 0.16)',
    glowShadow: 'rgba(168, 85, 247, 0.32)',
    pageGlow: 'rgba(168, 85, 247, 0.28)',
    card: 'rgba(24, 16, 40, 0.72)',
    popover: 'rgba(18, 12, 31, 0.94)',
    secondary: 'rgba(168, 85, 247, 0.16)',
    muted: 'rgba(167, 139, 250, 0.1)',
    primaryForeground: '#ffffff',
    glassShadow: 'rgba(0, 0, 0, 0.32)',
  },
};

export const companionThemeOptions = Object.entries(companionThemes).map(([value, theme]) => ({
  value: value as CompanionThemeName,
  label: theme.label,
}));

export function getCompanionThemeStyle(themeName: CompanionThemeName): CSSProperties {
  const theme = companionThemes[themeName] ?? companionThemes.warmPeach;

  return {
    '--background': theme.bgStart,
    '--foreground': theme.text,
    '--card': theme.card ?? 'rgba(255, 255, 255, 0.95)',
    '--card-foreground': theme.text,
    '--popover': theme.popover ?? 'rgba(255, 255, 255, 0.82)',
    '--popover-foreground': theme.text,
    '--primary': theme.accent,
    '--primary-foreground': theme.primaryForeground ?? '#ffffff',
    '--secondary': theme.secondary ?? 'rgba(255, 255, 255, 0.42)',
    '--secondary-foreground': theme.text,
    '--muted': theme.muted ?? 'rgba(255, 255, 255, 0.36)',
    '--muted-foreground': theme.mutedText,
    '--accent': theme.accentSoft,
    '--accent-foreground': theme.accentDeep,
    '--border': theme.cardBorder,
    '--input': theme.cardBorder,
    '--ring': theme.accent,
    '--sidebar': 'rgba(255, 255, 255, 0.32)',
    '--sidebar-foreground': theme.text,
    '--sidebar-primary': theme.accent,
    '--sidebar-primary-foreground': '#ffffff',
    '--sidebar-accent': theme.accentSoft,
    '--sidebar-accent-foreground': theme.accentDeep,
    '--sidebar-border': theme.cardBorder,
    '--sidebar-ring': theme.accent,
    '--companion-bg-start': theme.bgStart,
    '--companion-bg-middle': theme.bgMiddle,
    '--companion-bg-end': theme.bgEnd,
    '--companion-accent': theme.accent,
    '--companion-accent-deep': theme.accentDeep,
    '--companion-accent-soft': theme.accentSoft,
    '--companion-aura': theme.aura,
    '--companion-aura-deep': theme.auraDeep,
    '--companion-page-glow': theme.pageGlow ?? theme.aura,
    '--companion-text': theme.text,
    '--companion-muted-text': theme.mutedText,
    '--companion-grid': theme.grid,
    '--companion-card-border': theme.cardBorder,
    '--companion-glow-shadow': theme.glowShadow,
    '--companion-glass-shadow': theme.glassShadow ?? 'rgba(86, 46, 28, 0.1)',
  } as CSSProperties;
}

/// <reference types="vite/client" />

interface BubbleTownDesktopBridge {
  platform: string;
  versions: Record<string, string>;
  companionUrl: string;
  titlebarReserve?: string;
  titlebarControlReserve?: string;
  setNativeThemeSource?: (themeSource: 'light' | 'dark' | 'system') => Promise<boolean>;
}

interface Window {
  bubbleTownDesktop?: BubbleTownDesktopBridge;
}

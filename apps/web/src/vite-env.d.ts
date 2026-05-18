/// <reference types="vite/client" />

interface BubbleTownDesktopBridge {
  platform: string;
  versions: Record<string, string>;
  companionUrl: string;
  titlebarReserve?: string;
}

interface Window {
  bubbleTownDesktop?: BubbleTownDesktopBridge;
}

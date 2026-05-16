/// <reference types="vite/client" />

interface BubbleTownDesktopBridge {
  platform: string;
  versions: Record<string, string>;
  companionUrl: string;
}

interface Window {
  bubbleTownDesktop?: BubbleTownDesktopBridge;
}

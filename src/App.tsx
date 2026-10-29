import type { ProviderId } from '@/types';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useAppPersistence } from '@/store/persistence';
import { useAppStore } from '@/store/appStore';
import { BrandMark } from '@/components/BrandMark';
import { TopBar } from '@/components/TopBar';
import { Sidebar } from '@/components/Sidebar';
import { ChatPanel } from '@/components/ChatPanel';
import { InlineNotice } from '@/components/ui/Feedback';
import { ToastHost } from '@/components/Toasts';
import { StudioView } from '@/views/StudioView';
import { useVideoTaskRunner } from '@/store/videoTasks';

const GalleryView = lazy(() =>
  import('@/views/GalleryView').then((module) => ({ default: module.GalleryView })),
);
import { PresetsView } from '@/views/PresetsView';
import { SettingsView } from '@/views/SettingsView';
import { ReviewSettingsView } from '@/views/ReviewSettingsView';

const CHAT_OPEN_KEY = 'aigc-studio-lite:chat-open';
const CHAT_WIDTH_KEY = 'aigc-studio-lite:chat-width';
const CHAT_MIN = 340;
const CHAT_MAX = 620;
const SIDEBAR_COLLAPSED_KEY = 'aigc-studio-lite:sidebar-collapsed';
const SIDEBAR_WIDTH_KEY = 'aigc-studio-lite:sidebar-width';
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 380;
const STUDIO_MIN = 620;

function clampChatWidth(value: number, sidebarWidth = 272): number {
  const inlineMax = window.innerWidth - sidebarWidth - STUDIO_MIN;
  const max = Math.min(CHAT_MAX, Math.max(CHAT_MIN, inlineMax));
  return Math.min(Math.max(CHAT_MIN, Math.round(value)), max);
}

function initialChatOpen(): boolean {
  try {
    const stored = localStorage.getItem(CHAT_OPEN_KEY);
    if (stored === 'true' || stored === 'false') return stored === 'true';
  } catch {}
  return window.innerWidth > 1220;
}

function initialChatWidth(): number {
  try {
    const stored = Number(localStorage.getItem(CHAT_WIDTH_KEY));
    if (Number.isFinite(stored) && stored > 0) return clampChatWidth(stored);
  } catch {}
  return 390;
}

function BootScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="boot-screen">
      <div className="boot-brand">
        <BrandMark size={38} />
        <span>AIGC Studio Lite</span>
      </div>
      {error ? (
        <div className="boot-error">
          <InlineNotice field message={error} />
          <button
            type="button"
            className="ui-button ui-button-primary ui-button-sm"
            onClick={onRetry}
          >
            重试
          </button>
        </div>
      ) : (
        <div className="boot-progress" aria-label="载入中">
          <span />
        </div>
      )}
    </div>
  );
}

function OverlayLoading() {
  return (
    <div className="overlay-loading" aria-label="正在载入">
      <span />
    </div>
  );
}

export default function App() {
  useAppPersistence();
  useVideoTaskRunner();
  const hydrated = useAppStore((state) => state.hydrated);
  const bootError = useAppStore((state) => state.bootError);
  const activeView = useAppStore((state) => state.activeView);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
      return saved > 0 ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, saved)) : 272;
    } catch {
      return 272;
    }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [settingsProvider, setSettingsProvider] = useState<ProviderId>('openai');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(initialChatOpen);
  const [chatWidth, setChatWidth] = useState(initialChatWidth);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const chatVisible = chatOpen && (activeView === 'studio' || activeView === 'gallery');

  useEffect(() => {
    if (hydrated) return;
    void useAppStore.getState().hydrate();
  }, [hydrated]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
      localStorage.setItem(CHAT_OPEN_KEY, String(chatOpen));
      localStorage.setItem(CHAT_WIDTH_KEY, String(chatWidth));
    } catch {}
  }, [chatOpen, chatWidth, sidebarWidth, sidebarCollapsed]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [activeView]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        useAppStore.getState().setActiveView('settings');
      }
      if (event.key === 'Escape' && !event.defaultPrevented) {
        setSidebarOpen(false);
        if (window.innerWidth <= 1220) setChatOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    const resize = () => {
      setViewportWidth(window.innerWidth);
      const available =
        window.innerWidth - STUDIO_MIN - (chatVisible && window.innerWidth > 1220 ? CHAT_MIN : 0);
      const nextSidebarWidth =
        window.innerWidth > 980 && !sidebarCollapsed
          ? Math.min(sidebarWidth, Math.max(SIDEBAR_MIN, available))
          : sidebarWidth;
      setSidebarWidth(nextSidebarWidth);
      if (window.innerWidth > 1220)
        setChatWidth((current) =>
          clampChatWidth(current, sidebarCollapsed ? 52 : nextSidebarWidth),
        );
      if (window.innerWidth > 980) setSidebarOpen(false);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [sidebarWidth, sidebarCollapsed, chatVisible]);

  const startChatResize = (event: React.PointerEvent<HTMLElement>) => {
    if (window.innerWidth <= 1220) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = chatWidth;
    document.body.classList.add('is-resizing');

    const move = (moveEvent: PointerEvent) => {
      setChatWidth(
        clampChatWidth(
          startWidth + startX - moveEvent.clientX,
          sidebarCollapsed ? 52 : sidebarWidth,
        ),
      );
    };
    const finish = () => {
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const adjustChatWidth = (delta: number) => {
    setChatWidth((current) =>
      clampChatWidth(current + delta, sidebarCollapsed ? 52 : sidebarWidth),
    );
  };

  const adjustSidebarWidth = (value: number) => {
    const available =
      window.innerWidth - STUDIO_MIN - (chatVisible && window.innerWidth > 1220 ? CHAT_MIN : 0);
    const next = Math.min(
      Math.max(SIDEBAR_MIN, available),
      SIDEBAR_MAX,
      Math.max(SIDEBAR_MIN, value),
    );
    setSidebarWidth(next);
    setChatWidth((current) => clampChatWidth(current, next));
  };

  const startSidebarResize = (event: React.PointerEvent<HTMLElement>) => {
    if (window.innerWidth <= 980) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    document.body.classList.add('is-resizing');
    const move = (moveEvent: PointerEvent) =>
      adjustSidebarWidth(startWidth + moveEvent.clientX - startX);
    const finish = () => {
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const openGallery = () => {
    setActiveView(activeView === 'gallery' ? 'studio' : 'gallery');
    setSidebarOpen(false);
  };

  const openSettings = () => {
    setSettingsProvider(
      useAppStore.getState().preferences.studioMode === 'video' ? 'volcengine' : 'openai',
    );
    setActiveView(activeView === 'settings' ? 'studio' : 'settings');
    setSidebarOpen(false);
  };

  const openPresets = () => {
    setActiveView(activeView === 'presets' ? 'studio' : 'presets');
    setSidebarOpen(false);
  };

  const toggleChat = () => {
    setSidebarOpen(false);
    if (activeView !== 'studio') {
      setActiveView('studio');
      setChatOpen(true);
      return;
    }
    setChatOpen((open) => !open);
  };

  if (!hydrated) {
    return (
      <BootScreen
        error={bootError}
        onRetry={() => {
          void useAppStore.getState().hydrate();
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <TopBar
        onHome={() => setActiveView('studio')}
        onOpenSidebar={() => {
          if (window.innerWidth > 980) setSidebarCollapsed((value) => !value);
          else {
            if (!sidebarOpen) setChatOpen(false);
            setSidebarOpen((open) => !open);
          }
        }}
        sidebarOpen={sidebarOpen}
        onOpenGallery={openGallery}
        galleryOpen={activeView === 'gallery'}
        onToggleChat={toggleChat}
        chatOpen={activeView === 'studio' && chatOpen}
        onOpenSettings={openSettings}
        settingsOpen={activeView === 'settings'}
      />

      <div
        className="app-frame"
        style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
      >
        <Sidebar
          collapsed={sidebarCollapsed}
          onCollapse={() => {
            if (window.innerWidth > 980) setSidebarCollapsed((value) => !value);
            else setSidebarOpen(false);
          }}
          width={sidebarWidth}
          onResizeStart={startSidebarResize}
          onResizeBy={(delta) => adjustSidebarWidth(sidebarWidth + delta)}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onOpenPresets={openPresets}
          onOpenReview={() => setActiveView(activeView === 'review' ? 'studio' : 'review')}
        />

        <main
          className={`app-main ${chatVisible ? 'has-chat' : ''}`}
          inert={sidebarOpen && viewportWidth <= 980}
        >
          <div
            className="studio-page-slot"
            inert={chatVisible && viewportWidth <= 1220}
            hidden={
              activeView === 'presets' || activeView === 'review' || activeView === 'settings'
            }
          >
            <div className="studio-pane">
              <StudioView onOpenSettings={openSettings} onOpenPresets={openPresets} />
            </div>
          </div>
          {activeView === 'presets' && <PresetsView onClose={() => setActiveView('studio')} />}
          {activeView === 'review' && (
            <ReviewSettingsView onClose={() => setActiveView('studio')} />
          )}
          {activeView === 'settings' && (
            <SettingsView
              initialProvider={settingsProvider}
              onClose={() => setActiveView('studio')}
            />
          )}
          <ChatPanel
            open={chatVisible}
            width={chatWidth}
            onClose={() => setChatOpen(false)}
            onResizeStart={startChatResize}
            onResizeBy={adjustChatWidth}
            onOpenSettings={openSettings}
            onOpenPresets={openPresets}
          />
          {chatVisible && (
            <button
              type="button"
              className="chat-panel-scrim"
              aria-label="关闭 Chat"
              onClick={() => setChatOpen(false)}
            />
          )}
        </main>
      </div>

      {activeView === 'gallery' && (
        <Suspense fallback={<OverlayLoading />}>
          <GalleryView onClose={() => setActiveView('studio')} />
        </Suspense>
      )}

      <ToastHost />
    </div>
  );
}

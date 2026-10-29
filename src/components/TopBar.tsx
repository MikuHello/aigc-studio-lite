import { Bell, Images, Menu, MessageSquare, Settings2 } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { BrandMark } from './BrandMark';
import { IconButton } from './ui';

interface TopBarProps {
  onHome: () => void;
  onOpenSidebar: () => void;
  sidebarOpen: boolean;
  onOpenGallery: () => void;
  galleryOpen: boolean;
  onToggleChat: () => void;
  chatOpen: boolean;
  onOpenSettings: () => void;
  settingsOpen: boolean;
}

export function TopBar({
  onHome,
  onOpenSidebar,
  sidebarOpen,
  onOpenGallery,
  galleryOpen,
  onToggleChat,
  chatOpen,
  onOpenSettings,
  settingsOpen,
}: TopBarProps) {
  return (
    <header className="app-topbar">
      <div className="topbar-leading">
        <button
          type="button"
          className={`topbar-menu ${sidebarOpen ? 'is-active' : ''}`}
          onClick={onOpenSidebar}
          aria-label={sidebarOpen ? '关闭会话栏' : '打开会话栏'}
          aria-expanded={sidebarOpen}
        >
          <Menu size={19} />
        </button>
        <button type="button" className="brand" onClick={onHome} aria-label="AIGC Studio Lite 首页">
          <BrandMark size={27} className="brand-mark" />
          <span className="brand-name">
            AIGC Studio <span className="brand-edition">Lite</span>
          </span>
        </button>
      </div>

      <div className="topbar-actions">
        <IconButton
          label="最近消息"
          icon={<Bell size={19} />}
          onClick={() => useAppStore.getState().setNoticeHistoryOpen(true)}
        />
        <IconButton
          label={galleryOpen ? '关闭作品库' : '打开作品库'}
          icon={<Images size={19} />}
          active={galleryOpen}
          onClick={onOpenGallery}
        />
        <IconButton
          label={chatOpen ? '收起 Chat' : '打开 Chat'}
          icon={<MessageSquare size={19} />}
          active={chatOpen}
          onClick={onToggleChat}
        />
        <span className="topbar-divider" aria-hidden="true" />
        <IconButton
          label={settingsOpen ? '关闭设置' : '打开设置'}
          icon={<Settings2 size={19} />}
          active={settingsOpen}
          onClick={onOpenSettings}
        />
      </div>
    </header>
  );
}

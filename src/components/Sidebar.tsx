import { useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import type { Session } from '@/types';
import { useAppStore } from '@/store/appStore';
import { ConfirmDialog } from './ConfirmDialog';
import { Button, IconButton } from './ui';

interface SidebarProps {
  width: number;
  onResizeStart: (event: React.PointerEvent<HTMLElement>) => void;
  onResizeBy: (delta: number) => void;
  collapsed: boolean;
  onCollapse: () => void;
  open: boolean;
  onClose: () => void;
  onOpenPresets: () => void;
  onOpenReview: () => void;
}

export function Sidebar({
  open,
  onClose,
  onOpenPresets,
  onOpenReview,
  width,
  onResizeStart,
  onResizeBy,
  collapsed,
  onCollapse,
}: SidebarProps) {
  const sessions = useAppStore((state) => state.sessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const activateSession = useAppStore((state) => state.activateSession);
  const createSession = useAppStore((state) => state.createSession);
  const renameSession = useAppStore((state) => state.renameSession);
  const deleteSession = useAppStore((state) => state.deleteSession);
  const togglePin = useAppStore((state) => state.toggleSessionPin);
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const editingRef = useRef<string | null>(null);
  const [deleting, setDeleting] = useState<Session | null>(null);
  const ordered = useMemo(
    () =>
      [...sessions].sort(
        (a, b) =>
          Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt,
      ),
    [sessions],
  );
  const startRename = (session: Session) => {
    editingRef.current = session.id;
    setTitle(session.title);
    setEditing(session.id);
  };
  const finishRename = (save: boolean) => {
    if (editingRef.current && save && title.trim()) renameSession(editingRef.current, title);
    editingRef.current = null;
    setEditing(null);
  };
  return (
    <>
      <aside
        className={`sidebar ${open ? 'is-open' : ''} ${collapsed ? 'is-collapsed' : ''}`}
        aria-label="会话栏"
      >
        <div className="sidebar-collapsed-tools">
          <IconButton label="展开会话栏" icon={<PanelLeftOpen size={18} />} onClick={onCollapse} />
          <IconButton label="新建会话" icon={<Plus size={17} />} onClick={() => createSession()} />
          <IconButton label="预设管理" icon={<BookOpen size={17} />} onClick={onOpenPresets} />
          <IconButton label="润色设置" icon={<WandSparkles size={17} />} onClick={onOpenReview} />
        </div>
        <div className="sidebar-expanded" inert={collapsed && !open}>
          <div
            className="sidebar-resize-handle"
            role="separator"
            aria-label="调整会话栏宽度"
            aria-orientation="vertical"
            aria-valuemin={220}
            aria-valuemax={380}
            aria-valuenow={Math.round(width)}
            tabIndex={0}
            onPointerDown={onResizeStart}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                onResizeBy(event.key === 'ArrowRight' ? 24 : -24);
              }
            }}
          />
          <div className="sidebar-utilities">
            <div className="sidebar-shortcuts">
              <button type="button" className="sidebar-presets" onClick={onOpenPresets}>
                <BookOpen size={16} />
                <span>预设管理</span>
              </button>
            </div>
            <button type="button" className="sidebar-presets sidebar-review" onClick={onOpenReview}>
              <WandSparkles size={16} />
              <span>润色设置</span>
            </button>
          </div>
          <div className="sidebar-new-session">
            <Button
              variant="secondary"
              onClick={() => {
                createSession();
                onClose();
              }}
            >
              新建会话
            </Button>
            <IconButton
              label="收起会话栏"
              icon={<PanelLeftClose size={18} />}
              onClick={onCollapse}
            />
          </div>
          <nav className="session-nav" aria-label="会话">
            {[
              { key: 'pinned', label: '置顶', items: ordered.filter((session) => session.pinned) },
              {
                key: 'recent',
                label: '最近会话',
                items: ordered.filter((session) => !session.pinned),
              },
            ].map(
              (group) =>
                group.items.length > 0 && (
                  <section
                    className={`session-group session-group-${group.key}`}
                    aria-label={group.label}
                    key={group.key}
                  >
                    <h2>
                      {group.key === 'pinned' && <Pin size={12} />}
                      <span>{group.label}</span>
                    </h2>
                    <ul className="session-list flat-session-list">
                      {group.items.map((session) => (
                        <li
                          key={session.id}
                          className={`session-item ${session.id === activeSessionId ? 'is-active' : ''}`}
                        >
                          {editing === session.id ? (
                            <input
                              className="session-title-input"
                              aria-label="会话名称"
                              value={title}
                              ref={(element) => {
                                if (element && document.activeElement !== element) {
                                  element.focus();
                                  element.select();
                                }
                              }}
                              onChange={(event) => setTitle(event.target.value)}
                              onBlur={() => finishRename(true)}
                              onKeyDown={(event) => {
                                if (event.nativeEvent.isComposing) return;
                                if (event.key === 'Enter' || event.key === 'Escape') {
                                  event.preventDefault();
                                  finishRename(event.key === 'Enter');
                                }
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className={`session-link ${session.id === activeSessionId ? 'is-active' : ''}`}
                              aria-current={session.id === activeSessionId ? 'page' : undefined}
                              title={`${session.title}（双击重命名）`}
                              onClick={() => {
                                activateSession(session.id);
                                onClose();
                              }}
                              onDoubleClick={() => startRename(session)}
                            >
                              <span>{session.title}</span>
                            </button>
                          )}
                          <div className="sidebar-row-actions">
                            <IconButton
                              label="删除会话"
                              icon={<Trash2 size={13} />}
                              size="sm"
                              onClick={() => setDeleting(session)}
                            />
                            <IconButton
                              label="重命名会话"
                              icon={<Pencil size={13} />}
                              size="sm"
                              onClick={() => startRename(session)}
                            />
                            <IconButton
                              label={session.pinned ? '取消置顶会话' : '置顶会话'}
                              active={session.pinned}
                              icon={session.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                              size="sm"
                              onClick={() => togglePin(session.id)}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ),
            )}
          </nav>
        </div>
      </aside>
      {open && (
        <button type="button" className="sidebar-scrim" aria-label="关闭会话栏" onClick={onClose} />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="删除会话？"
        description="会话中的消息将被删除；已生成的图片仍保留在图库。"
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteSession(deleting.id);
        }}
      />
    </>
  );
}

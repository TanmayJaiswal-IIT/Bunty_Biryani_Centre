import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Link, useNavigate, type LinkProps } from 'react-router';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { copy } from '../../../copy';

interface NavigationGuardContextValue {
  setDirty: (message: string | null) => void;
  guardedNavigate: (to: string) => void;
}

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(
  null,
);

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [dirtyMessage, setDirtyMessage] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);

  const setDirty = useCallback((message: string | null) => {
    setDirtyMessage(message);
  }, []);

  const guardedNavigate = useCallback(
    (to: string) => {
      if (dirtyMessage) {
        setPendingTarget(to);
      } else {
        void navigate(to);
      }
    },
    [dirtyMessage, navigate],
  );

  useEffect(() => {
    if (!dirtyMessage) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirtyMessage]);

  const handleConfirmDiscard = () => {
    const target = pendingTarget;
    setPendingTarget(null);
    setDirtyMessage(null);
    if (target) {
      void navigate(target);
    }
  };

  const handleCancel = () => {
    setPendingTarget(null);
  };

  return (
    <NavigationGuardContext.Provider value={{ setDirty, guardedNavigate }}>
      {children}
      <ConfirmDialog
        open={pendingTarget !== null}
        title={copy.admin.discardChangesTitle}
        confirmLabel={copy.admin.discardChangesConfirm}
        cancelLabel={copy.admin.discardChangesCancel}
        tone="danger"
        onConfirm={handleConfirmDiscard}
        onCancel={handleCancel}
      >
        <p>{dirtyMessage || copy.admin.discardChangesMessage}</p>
      </ConfirmDialog>
    </NavigationGuardContext.Provider>
  );
}

const DEFAULT_GUARD: NavigationGuardContextValue = {
  setDirty: () => {},
  guardedNavigate: () => {},
};

export function useNavigationGuard(): NavigationGuardContextValue {
  const ctx = useContext(NavigationGuardContext);
  return ctx ?? DEFAULT_GUARD;
}

export function GuardedLink(props: LinkProps) {
  const { guardedNavigate } = useNavigationGuard();
  const href = typeof props.to === 'string' ? props.to : props.to.pathname || '';

  return (
    <Link
      {...props}
      onClick={(e) => {
        props.onClick?.(e);
        if (
          !e.defaultPrevented &&
          e.button === 0 &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.shiftKey
        ) {
          e.preventDefault();
          guardedNavigate(href);
        }
      }}
    />
  );
}

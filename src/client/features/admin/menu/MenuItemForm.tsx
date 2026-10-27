import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useSWRConfig } from 'swr';
import { Button } from '../../../components/Button.js';
import { ConfirmDialog } from '../../../components/ConfirmDialog.js';
import { EmptyState } from '../../../components/EmptyState.js';
import { Switch } from '../../../components/Switch.js';
import { copy } from '../../../copy.js';
import { useAdminMenu } from '../api/hooks.js';
import { ADMIN_MENU_KEY } from '../api/keys.js';
import { createMenuItem, deleteMenuItem, updateMenuItem } from '../api/mutations.js';
import {
  formFromItem,
  formToBody,
  previewableImage,
  type FieldErrors,
  type MenuForm,
} from './menu-logic.js';

export function MenuItemForm() {
  const { id: idParam } = useParams<{ id: string }>();
  const isEdit = Boolean(idParam && idParam !== 'new');
  const itemId = isEdit ? Number(idParam) : null;
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();

  const { data: menuData, isLoading } = useAdminMenu();
  const existingItem = isEdit
    ? menuData?.items.find((i) => i.id === itemId)
    : undefined;

  const [form, setForm] = useState<MenuForm>(() => formFromItem(existingItem));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [createdSuccess, setCreatedSuccess] = useState(false);

  const [prevExistingItem, setPrevExistingItem] = useState(existingItem);
  if (existingItem !== prevExistingItem) {
    setPrevExistingItem(existingItem);
    if (existingItem) {
      setForm(formFromItem(existingItem));
    }
  }

  if (isEdit && !isLoading && !existingItem) {
    return (
      <EmptyState
        title={copy.admin.notFoundTitle}
        message="This menu item does not exist."
        icon="alert"
        action={
          <Link to="/admin/menu">
            <Button variant="secondary">Back to menu</Button>
          </Link>
        }
      />
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    const { body, fieldErrors: validationErrors } = formToBody(form);
    if (!body || Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      return;
    }

    setSaving(true);
    try {
      if (isEdit && itemId) {
        await updateMenuItem(itemId, body);
        await mutate(ADMIN_MENU_KEY);
        void navigate('/admin/menu');
      } else {
        await createMenuItem(body);
        await mutate(ADMIN_MENU_KEY);
        setCreatedSuccess(true);
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'fieldErrors' in err) {
        setFieldErrors(
          (err as { fieldErrors: FieldErrors }).fieldErrors ?? {},
        );
      } else {
        setServerError(
          err instanceof Error ? err.message : 'Failed to save menu item',
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!itemId) return;
    setDeleting(true);
    setServerError(null);
    try {
      await deleteMenuItem(itemId);
      await mutate(ADMIN_MENU_KEY);
      setDeleteDialogOpen(false);
      void navigate('/admin/menu');
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : 'Failed to delete menu item',
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 max-w-xl mx-auto">
      {/* Top back link */}
      <div>
        <Link
          to="/admin/menu"
          className="text-sm font-semibold text-brand hover:underline"
        >
          ← Back to menu
        </Link>
      </div>

      <h1 className="text-xl font-bold font-display uppercase tracking-wide text-ink">
        {isEdit ? 'Edit menu item' : 'Add menu item'}
      </h1>

      {createdSuccess && (
        <div className="rounded-control bg-success-soft p-3 text-sm text-success">
          Item added. Set today's stock so customers can order it.{' '}
          <Link to="/admin/stock" className="underline font-semibold">
            Set stock
          </Link>
        </div>
      )}

      {serverError && (
        <div className="rounded-control bg-danger-soft p-3 text-sm font-semibold text-danger">
          {serverError}
        </div>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
        {/* Name */}
        <div className="flex flex-col gap-1">
          <label htmlFor="item-name" className="text-sm font-semibold text-ink">
            Name
          </label>
          <input
            id="item-name"
            type="text"
            required
            value={form.name}
            onChange={(e) => {
              setForm((p) => ({ ...p, name: e.target.value }));
              setFieldErrors((p) => ({ ...p, name: undefined }));
            }}
            placeholder="e.g. Chicken Biryani"
            className="min-h-12 rounded-control border border-neutral-300 bg-white px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          {fieldErrors.name && (
            <span className="text-xs font-semibold text-danger">
              {fieldErrors.name}
            </span>
          )}
        </div>

        {/* Description (optional) */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="item-desc"
            className="text-sm font-semibold text-ink"
          >
            Description (optional)
          </label>
          <textarea
            id="item-desc"
            rows={3}
            value={form.description}
            onChange={(e) => {
              setForm((p) => ({ ...p, description: e.target.value }));
              setFieldErrors((p) => ({ ...p, description: undefined }));
            }}
            placeholder="A short description of the dish"
            className="rounded-control border border-neutral-300 bg-white p-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          {fieldErrors.description && (
            <span className="text-xs font-semibold text-danger">
              {fieldErrors.description}
            </span>
          )}
        </div>

        {/* Price */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="item-price"
            className="text-sm font-semibold text-ink"
          >
            Price (₹)
          </label>
          <input
            id="item-price"
            type="text"
            inputMode="numeric"
            required
            value={form.price}
            onChange={(e) => {
              setForm((p) => ({ ...p, price: e.target.value }));
              setFieldErrors((p) => ({ ...p, price: undefined }));
            }}
            placeholder="e.g. 150"
            className="min-h-12 rounded-control border border-neutral-300 bg-white px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          {isEdit && (
            <div className="text-xs text-ink-muted">
              New prices apply to new orders only.
            </div>
          )}
          {fieldErrors.price && (
            <span className="text-xs font-semibold text-danger">
              {fieldErrors.price}
            </span>
          )}
        </div>

        {/* Image link (optional) */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="item-image"
            className="text-sm font-semibold text-ink"
          >
            Image link (optional)
          </label>
          <input
            id="item-image"
            type="url"
            value={form.imageUrl}
            onChange={(e) => {
              setForm((p) => ({ ...p, imageUrl: e.target.value }));
              setFieldErrors((p) => ({ ...p, imageUrl: undefined }));
            }}
            placeholder="https://example.com/image.jpg"
            className="min-h-12 rounded-control border border-neutral-300 bg-white px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          {previewableImage(form.imageUrl) && (
            <div className="mt-2 flex items-center gap-2">
              <img
                src={form.imageUrl}
                alt="Preview"
                className="size-16 rounded-control object-cover border border-line"
              />
              <span className="text-xs text-ink-muted">Image preview</span>
            </div>
          )}
          {fieldErrors.imageUrl && (
            <span className="text-xs font-semibold text-danger">
              {fieldErrors.imageUrl}
            </span>
          )}
        </div>

        {/* On menu Switch */}
        <div className="rounded-card border border-line bg-surface p-3">
          <Switch
            checked={form.isAvailable}
            onChange={(next) => setForm((p) => ({ ...p, isAvailable: next }))}
            label="On menu"
            description="Available for customers to see and order"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 mt-4">
          <Button type="submit" loading={saving} fullWidth>
            {isEdit ? 'Save changes' : 'Add item'}
          </Button>

          {isEdit && (
            <Button
              type="button"
              variant="danger"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={saving}
              fullWidth
            >
              Delete item
            </Button>
          )}
        </div>
      </form>

      {/* Delete Confirmation Dialog */}
      {isEdit && (
        <ConfirmDialog
          open={deleteDialogOpen}
          title="Delete menu item?"
          confirmLabel="Delete item"
          cancelLabel="Keep item"
          tone="danger"
          loading={deleting}
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleteDialogOpen(false)}
        >
          <p>
            Remove this item from the menu? It will no longer appear to customers,
            but past orders will keep their records.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

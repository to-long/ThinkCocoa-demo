/**
 * Component test for the Permission Group dialog.
 *
 * Renders the real <PermissionGroupDialog>, types invalid input,
 * clicks Submit, and asserts the inline validation message reaches
 * the user. Uses the shared `createPermissionGroupFormSchema`.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import adminMessages from '@/features/admin/intl/en.json';
import sharedMessages from '@/shared/intl/en.json';
import { PermissionGroupDialog } from './add-permission-group-dialog';

const messages = { ...sharedMessages, ...adminMessages } as Record<string, string>;

// `useApiErrorMessage` + `ApiError` come from the shared/api modules
// that import `import.meta`. Mock them so jest-swc doesn't trip.
jest.mock('@/shared/api/use-api-error-message', () => ({
  useApiErrorMessage: jest.fn(() => (err: unknown) => String(err)),
}));
jest.mock('@/shared/api/fetcher', () => ({
  ApiError: class ApiError extends Error {},
}));

const renderDialog = (props?: Partial<React.ComponentProps<typeof PermissionGroupDialog>>) =>
  render(
    <IntlProvider locale="en" messages={messages}>
      <PermissionGroupDialog
        open
        onOpenChange={() => {}}
        onSubmit={jest.fn().mockResolvedValue(undefined)}
        {...props}
      />
    </IntlProvider>,
  );

describe('PermissionGroupDialog — create mode', () => {
  test('empty group name + Create → validator code rendered for name', async () => {
    const onSubmit = jest.fn();
    renderDialog({ onSubmit });

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    // Empty name fails the resource pattern check (min(1) shares the
    // same code, PERMISSION_GROUP_RESOURCE_PATTERN). Verify the
    // localized message appears.
    expect(await screen.findByText(/Must start with a letter or underscore/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('group name with hyphen → resource pattern error', async () => {
    const onSubmit = jest.fn();
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByPlaceholderText('e.g. invoices'), {
      target: { value: 'bad-name' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByText(/Must start with a letter or underscore/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('group name > 64 chars → "Value is too long." (regression for missing cap)', async () => {
    // Was a real bug: shared schema had no `.max()` on name, so
    // 5000-char input passed FE then exploded server-side. We added
    // the cap (FIELD_LIMITS.code = 64); this test guards it.
    const onSubmit = jest.fn();
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByPlaceholderText('e.g. invoices'), {
      target: { value: 'a'.repeat(65) },
    });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByText('Value is too long.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

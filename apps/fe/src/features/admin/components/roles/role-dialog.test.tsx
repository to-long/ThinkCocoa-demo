/**
 * Component test for the Role dialog.
 *
 * Renders the real <RoleDialog>, types invalid input, clicks Submit,
 * and asserts the inline validation message reaches the user. Uses
 * the shared `createRoleFormSchema` / `updateRoleFormSchema`.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import adminMessages from '@/features/admin/intl/en.json';
import sharedMessages from '@/shared/intl/en.json';
import { RoleDialog } from './role-dialog';

const messages = { ...sharedMessages, ...adminMessages } as Record<string, string>;

// Stable references — the dialog effects re-fire if `permissions`
// changes identity each render (RHF setValue → re-render → new ref →
// loop). See user-dialog.test.tsx for the same pattern.
var MOCK_CATALOG: Array<{ id: string; code: string; name: string }> = [];

jest.mock('@/shared/api', () => ({
  useRoleDialogCatalog: jest.fn(() => ({ data: MOCK_CATALOG })),
}));

const renderDialog = (props?: Partial<React.ComponentProps<typeof RoleDialog>>) =>
  render(
    <IntlProvider locale="en" messages={messages}>
      <RoleDialog open onOpenChange={() => {}} onSubmit={jest.fn()} {...props} />
    </IntlProvider>,
  );

describe('RoleDialog — create mode', () => {
  test('empty name + Create → "Name is required."', async () => {
    const onSubmit = jest.fn();
    renderDialog({ onSubmit });

    fireEvent.click(screen.getByRole('button', { name: /^create role$/i }));

    expect(await screen.findByText('Name is required.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('uppercase code → "Use lowercase letters, digits…"', async () => {
    const onSubmit = jest.fn();
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByPlaceholderText('e.g. Super Admin'), {
      target: { value: 'Super Admin' },
    });
    // Manually edit the code so the auto-derive effect doesn't
    // overwrite our test input.
    fireEvent.change(screen.getByPlaceholderText('e.g. super_admin'), {
      target: { value: 'BadRole' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^create role$/i }));

    expect(
      await screen.findByText(/Use lowercase letters, digits and underscores only/i),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('code starting with digit → ROLE_CODE_PATTERN', async () => {
    const onSubmit = jest.fn();
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByPlaceholderText('e.g. Super Admin'), {
      target: { value: 'My Role' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. super_admin'), {
      target: { value: '2role' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^create role$/i }));

    expect(
      await screen.findByText(/Use lowercase letters, digits and underscores only/i),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

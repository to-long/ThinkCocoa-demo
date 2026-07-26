/**
 * Component test for the User dialog.
 *
 * Renders the real <UserDialog>, types invalid input, clicks Submit,
 * and asserts the inline validation message reaches the user. This
 * exercises the FULL validation chain — RHF → zodResolver → shared
 * `createUserFormSchema` → `tr()` intl lookup → DOM — which is what
 * actually matters for the user (not whether zod parses correctly in
 * isolation).
 *
 * Mocks: data-fetching hooks (`useUserDialogCatalog`,
 * `useCooperativesList`, `useUser`) are stubbed because they're SWR
 * wrappers around real `/api` endpoints; the dialog under test only
 * needs them to return enough shape that the picker renders.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import adminMessages from '@/features/admin/intl/en.json';
import sharedMessages from '@/shared/intl/en.json';
import { UserDialog } from './user-dialog';

const messages = { ...sharedMessages, ...adminMessages } as Record<string, string>;

// Stub the entire `@/shared/api` barrel — the dialog only needs the
// three hooks below, and `requireActual` would pull in `fetcher.ts`
// which uses `import.meta` (not parseable by jest-swc out of the box).
//
// Constant references (declared via `var` so jest's hoisted mock
// factory can read them — `const`/`let` would TDZ-trap inside the
// factory) — every render returning the SAME object instance, the
// same way real SWR does. Without this the dialog's effects re-fire
// each render because deps change identity, then loop until React
// bails out with "Maximum update depth exceeded".
var MOCK_CATALOG = { roleDetails: [], permissions: [], permissionGroups: [] };
var MOCK_COOPS = [{ id: '00000000-0000-0000-0000-000000000001', name: 'Test Coop' }];
var MOCK_DETAIL = {
  id: 'user-1',
  roles: [] as string[],
  permissions: [] as string[],
  cooperativeAssignments: [
    {
      cooperativeId: '00000000-0000-0000-0000-000000000001',
      cooperativeName: 'Test Coop',
    },
  ],
  isAllCooperative: false,
};

jest.mock('@/shared/api', () => ({
  useUserDialogCatalog: jest.fn(() => ({ data: MOCK_CATALOG })),
  useCooperativesList: jest.fn(() => ({ data: MOCK_COOPS })),
  useUser: jest.fn(() => ({ data: MOCK_DETAIL, isLoading: false })),
}));

const renderDialog = (props?: Partial<React.ComponentProps<typeof UserDialog>>) =>
  render(
    <IntlProvider locale="en" messages={messages}>
      <UserDialog open onOpenChange={() => {}} onSubmit={jest.fn()} {...props} />
    </IntlProvider>,
  );

describe('UserDialog — create mode', () => {
  test('typing a 201-char name and submitting shows "Value is too long."', async () => {
    const onSubmit = jest.fn();
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'someone@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Full name'), {
      target: { value: 'a'.repeat(201) },
    });
    fireEvent.change(screen.getByPlaceholderText('Minimum 8 characters'), {
      target: { value: 'ThinkData2026!' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create user/i }));

    expect(await screen.findByText('Value is too long.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('empty name + submit shows "Name is required."', async () => {
    const onSubmit = jest.fn();
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'someone@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Minimum 8 characters'), {
      target: { value: 'ThinkData2026!' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create user/i }));

    expect(await screen.findByText('Name is required.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('UserDialog — edit mode', () => {
  const initialData = {
    id: 'user-1',
    name: 'Existing User',
    email: 'existing@example.com',
  };

  test('clearing name and submitting shows "Name is required."', async () => {
    const onSubmit = jest.fn();
    renderDialog({ initialData, onSubmit });

    await waitFor(() => expect(screen.getByDisplayValue('Existing User')).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue('Existing User'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('Name is required.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('typing 201-char name and submitting shows "Value is too long." (the bug from the report)', async () => {
    const onSubmit = jest.fn();
    renderDialog({ initialData, onSubmit });

    await waitFor(() => expect(screen.getByDisplayValue('Existing User')).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue('Existing User'), {
      target: { value: 'a'.repeat(201) },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('Value is too long.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

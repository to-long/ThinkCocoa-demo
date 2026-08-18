/**
 * Component test for the Cooperative dialog.
 *
 * Renders the real <CooperativeDialog>, types invalid input, clicks
 * Submit, and asserts the inline validation message reaches the user.
 * The dialog uses the shared `cooperativeFormSchema` directly (no
 * local extend), so the rules under test are the BE rules.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import adminMessages from '@/features/admin/intl/en.json';
import sharedMessages from '@/shared/intl/en.json';
import { CooperativeDialog } from './cooperative-dialog';

const messages = { ...sharedMessages, ...adminMessages } as Record<string, string>;

// `useApiErrorMessage` is the only hook the dialog imports from
// `@/shared/api`. Stubbing the whole barrel keeps `fetcher.ts` (which
// uses `import.meta`) out of the jest-swc parse path.
jest.mock('@/shared/api', () => ({
  useApiErrorMessage: jest.fn(() => (err: unknown) => String(err)),
}));

// Chair candidates fetch goes through the generated client. Stub to
// return zero candidates — the form schema doesn't require a chair.
jest.mock('@kuanadata/shared/kuana-data-client', () => ({
  getApiUsers: jest.fn(async () => ({ data: { items: [] } })),
}));

// `unwrap` is imported from a deep path (`@/shared/api/fetcher`)
// which uses `import.meta`. Mock the module so jest-swc doesn't try
// to parse it.
jest.mock('@/shared/api/fetcher', () => ({
  unwrap: <T,>(res: { data?: T }) => res.data ?? { items: [] },
}));

const renderDialog = (props?: Partial<React.ComponentProps<typeof CooperativeDialog>>) =>
  render(
    <IntlProvider locale="en" messages={messages}>
      <CooperativeDialog open onOpenChange={() => {}} onSubmit={jest.fn()} {...props} />
    </IntlProvider>,
  );

describe('CooperativeDialog — create mode', () => {
  test('empty name + Add → "Name is required."', async () => {
    const onSubmit = jest.fn();
    renderDialog({ onSubmit });

    fireEvent.click(screen.getByRole('button', { name: /add cooperative/i }));

    expect(await screen.findByText('Name is required.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('typing 200-char name and submitting succeeds (under cap)', async () => {
    // Cap on `name` is 200 chars (FIELD_LIMITS.shortText). 200 chars
    // is the boundary — schema accepts it. Confirms happy path with
    // the only required field set.
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByPlaceholderText('Enter cooperative name'), {
      target: { value: 'a'.repeat(200) },
    });
    fireEvent.click(screen.getByRole('button', { name: /add cooperative/i }));

    // Wait one microtask for RHF to flush, then confirm onSubmit fired.
    await new Promise((r) => setTimeout(r, 0));
    expect(onSubmit).toHaveBeenCalled();
  });

  test('name > 200 chars + submit → "Value is too long."', async () => {
    const onSubmit = jest.fn();
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByPlaceholderText('Enter cooperative name'), {
      target: { value: 'a'.repeat(201) },
    });
    fireEvent.click(screen.getByRole('button', { name: /add cooperative/i }));

    expect(await screen.findByText('Value is too long.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

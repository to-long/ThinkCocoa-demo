/**
 * Component test for the Farmer dialog.
 *
 * Renders the real <FarmerDialog>, types invalid input, clicks
 * Submit, and asserts the inline validation message reaches the
 * user. The dialog binds to the shared `createFarmerSchema` /
 * `updateFarmerSchema` directly (no local extend).
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import farmersMessages from '@/features/farmers/intl/en.json';
import sharedMessages from '@/shared/intl/en.json';
import { FarmerDialog } from './farmer-dialog';

const messages = { ...sharedMessages, ...farmersMessages } as Record<string, string>;

// Stable references — avoid the "Maximum update depth exceeded" loop
// that happens when SWR-style mocks return new objects every render.
var MOCK_COOPS = [
  { id: '00000000-0000-0000-0000-000000000001', name: 'Sankofa Cocoa Cooperative', code: 'SANKOFA' },
];

jest.mock('@/shared/api', () => ({
  useCooperativesList: jest.fn(() => ({ data: MOCK_COOPS })),
}));

const renderDialog = (props?: Partial<React.ComponentProps<typeof FarmerDialog>>) =>
  render(
    <IntlProvider locale="en" messages={messages}>
      <FarmerDialog open onOpenChange={() => {}} onSubmit={jest.fn()} {...props} />
    </IntlProvider>,
  );

describe('FarmerDialog — create mode', () => {
  test('empty required fields + submit → reports each missing field', async () => {
    const onSubmit = jest.fn();
    renderDialog({ onSubmit });

    fireEvent.click(screen.getByRole('button', { name: /^add farmer$/i }));

    // Required fields surface their localized "required" message.
    expect(await screen.findByText('Farmer code is required.')).toBeInTheDocument();
    expect(screen.getByText('First name is required.')).toBeInTheDocument();
    expect(screen.getByText('Last name is required.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('farmerCode with spaces → "Use letters, digits…"', async () => {
    const onSubmit = jest.fn();
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByPlaceholderText('Enter farmer code'), {
      target: { value: 'F 001!' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter first name'), {
      target: { value: 'John' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter last name'), {
      target: { value: 'Doe' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add farmer$/i }));

    expect(
      await screen.findByText(/Use letters, digits, dashes and underscores only/i),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('firstName with disallowed punctuation → "Use letters…"', async () => {
    const onSubmit = jest.fn();
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByPlaceholderText('Enter farmer code'), {
      target: { value: 'F-001' },
    });
    // Digits are now allowed (real Ghanaian disambiguators like
    // "Kofi 2"); use a clearly disallowed character to keep the
    // PERSON_NAME_INVALID assertion meaningful.
    fireEvent.change(screen.getByPlaceholderText('Enter first name'), {
      target: { value: 'John@Doe' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter last name'), {
      target: { value: 'Doe' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add farmer$/i }));

    expect(await screen.findByText(/Use letters/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('phone with letters → PHONE_INVALID', async () => {
    const onSubmit = jest.fn();
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByPlaceholderText('Enter farmer code'), {
      target: { value: 'F-001' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter first name'), {
      target: { value: 'John' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter last name'), {
      target: { value: 'Doe' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. 0241234567'), {
      target: { value: 'call me' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add farmer$/i }));

    expect(await screen.findByText(/Use digits, spaces/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

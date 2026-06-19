import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormField } from './FormField';

afterEach(cleanup);

describe('FormField', () => {
  it('binds the mono label to the input and forwards typing events', () => {
    const onInput = vi.fn();
    render(() => <FormField id="nick" label="Nickname" placeholder="ruri" onInput={onInput} />);

    const input = screen.getByRole('textbox', { name: 'Nickname' }) as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'kain' } });

    expect(input.placeholder).toBe('ruri');
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('links description and error text with aria-describedby', () => {
    render(() => (
      <FormField
        id="server"
        label="Server"
        description="Use a websocket endpoint"
        error="Server is required"
        value=""
      />
    ));

    const input = screen.getByRole('textbox', { name: 'Server' });

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain('server-description');
    expect(input.getAttribute('aria-describedby')).toContain('server-error');
    expect(screen.getByText('Server is required')).toBeTruthy();
  });
});

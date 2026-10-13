import { useState, type FormEvent } from 'react';

interface Errors {
  name?: string;
  email?: string;
  message?: string;
}

export function validateContact(data: { name: string; email: string; message: string }): Errors {
  const errors: Errors = {};
  if (data.name.trim().length < 2) errors.name = 'Please enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) errors.email = 'Please enter a valid email address.';
  if (data.message.trim().length < 10) errors.message = 'Tell us a little more (10+ characters).';
  return errors;
}

export function Contact() {
  const [errors, setErrors] = useState<Errors>({});
  const [sent, setSent] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = {
      name: String(form.get('name') ?? ''),
      email: String(form.get('email') ?? ''),
      message: String(form.get('message') ?? ''),
    };
    const found = validateContact(data);
    setErrors(found);
    if (Object.keys(found).length === 0) {
      // No backend in the demo: the submission is acknowledged locally.
      setSent(data.name.trim());
      event.currentTarget.reset();
    }
  };

  return (
    <section className="section narrow">
      <h1>Talk to sales</h1>
      {sent ? (
        <p className="success" role="status" data-testid="contact-success">
          Thanks, {sent}! We will reply within one business day.
        </p>
      ) : null}
      <form className="form" onSubmit={onSubmit} noValidate data-testid="contact-form">
        <label>
          Name
          <input name="name" autoComplete="name" aria-invalid={Boolean(errors.name)} data-testid="name" />
          {errors.name ? <span className="error" data-testid="error-name">{errors.name}</span> : null}
        </label>
        <label>
          Work email
          <input name="email" type="email" autoComplete="email" aria-invalid={Boolean(errors.email)} data-testid="email" />
          {errors.email ? <span className="error" data-testid="error-email">{errors.email}</span> : null}
        </label>
        <label>
          How can we help?
          <textarea name="message" rows={4} aria-invalid={Boolean(errors.message)} data-testid="message" />
          {errors.message ? <span className="error" data-testid="error-message">{errors.message}</span> : null}
        </label>
        <button type="submit" className="button primary" data-testid="submit">
          Send message
        </button>
      </form>
    </section>
  );
}

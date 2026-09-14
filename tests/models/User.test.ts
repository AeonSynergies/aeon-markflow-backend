import { User } from '../../src/models/User.model';

describe('User model', () => {
  it('requires email, password_hash, and name', () => {
    const doc = new User({});
    const err = doc.validateSync();
    expect(err?.errors.email).toBeDefined();
    expect(err?.errors.password_hash).toBeDefined();
    expect(err?.errors.name).toBeDefined();
  });

  it('hashes and verifies a password via bcrypt', async () => {
    const password_hash = await User.hashPassword('correct horse battery staple');
    const doc = new User({ email: 'user@aeonsynergies.com', name: 'Test User', password_hash });

    await expect(doc.comparePassword('correct horse battery staple')).resolves.toBe(true);
    await expect(doc.comparePassword('wrong password')).resolves.toBe(false);
  });
});

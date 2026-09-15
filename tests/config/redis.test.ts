const ioredisConstructor = jest.fn().mockImplementation(() => ({}));

jest.mock('ioredis', () => ({
  __esModule: true,
  default: ioredisConstructor,
}));

import { getRedisConnection, resetRedisConnectionCache } from '../../src/config/redis';

describe('config/redis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRedisConnectionCache();
  });

  it('throws when REDIS_URL is missing', () => {
    delete process.env.REDIS_URL;
    expect(() => getRedisConnection()).toThrow('REDIS_URL');
  });

  it('constructs an ioredis client from REDIS_URL with maxRetriesPerRequest disabled', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    getRedisConnection();
    expect(ioredisConstructor).toHaveBeenCalledWith('redis://localhost:6379', { maxRetriesPerRequest: null });
  });

  it('caches the connection across calls', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const first = getRedisConnection();
    const second = getRedisConnection();
    expect(first).toBe(second);
    expect(ioredisConstructor).toHaveBeenCalledTimes(1);
  });
});

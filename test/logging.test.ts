import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { getLogger, setLogLevel } = await import('../src/logging.ts');

describe('getLogger', () => {
  test('hands back the same logger for the same category', () => {
    assert.equal(getLogger('same'), getLogger('same'));
  });

  test('keeps categories apart', () => {
    assert.notEqual(getLogger('first'), getLogger('second'));
  });

  test('labels each line with its category', () => {
    const lines: string[] = [];
    const logger = getLogger('labelled');

    // the console transport formats first, so the finished line is what it is
    // handed to write
    logger.transports[0].log = (info: Record<symbol, string>, next) => {
      lines.push(info[Symbol.for('message')]);
      next();
    };
    logger.error('something happened');

    assert.deepEqual(lines, ['[error][labelled] something happened']);
  });

  test('applies setLogLevel to existing and future loggers', () => {
    const existing = getLogger('before-level');

    try {
      setLogLevel('warn');

      assert.equal(existing.level, 'warn');
      assert.equal(getLogger('after-level').level, 'warn');
    } finally {
      setLogLevel('info');
    }

    assert.equal(existing.level, 'info');
  });
});

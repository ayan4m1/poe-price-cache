import { Container, type Logger, format, transports } from 'winston';

const { Console } = transports;
const { combine, label, printf } = format;

// winston's Container is already a cache keyed by category - add() registers
// a logger and get() returns whatever is registered
const container = new Container();

// loggers are created as modules load, before configuration has been read, so
// they start at this level and setLogLevel() adjusts them afterwards
let level = 'info';

export const getLogger = (category: string): Logger => {
  if (!container.has(category)) {
    container.add(category, {
      level,
      transports: [
        new Console({
          format: combine(
            label({
              label: category
            }),
            printf((data) => `[${data.level}][${data.label}] ${data.message}`)
          )
        })
      ]
    });
  }

  return container.get(category);
};

/** Applies `next` to every logger, both existing and yet to be created. */
export const setLogLevel = (next: string): void => {
  level = next;

  for (const logger of container.loggers.values()) {
    logger.level = next;
  }
};

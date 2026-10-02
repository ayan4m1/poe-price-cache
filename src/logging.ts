import { Container, type Logger, format, transports } from 'winston';

const { Console } = transports;
const { combine, label, prettyPrint, printf } = format;

// winston's Container is already a cache keyed by category - add() is what
// registers one and get() returns whatever is registered, creating it only the
// first time. a Map alongside it would be a second copy of the same bookkeeping
const container = new Container();

export const getLogger = (category: string): Logger => {
  if (!container.has(category)) {
    container.add(category, {
      transports: [
        new Console({
          level: 'info',
          format: combine(
            label({
              label: category
            }),
            prettyPrint(),
            printf((data) => `[${data.level}][${data.label}] ${data.message}`)
          )
        })
      ]
    });
  }

  return container.get(category);
};

import { AsyncLocalStorage } from 'node:async_hooks';
import pinoLib, { Logger as PinoInstance } from 'pino';

export type LogFieldValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | { [key: string]: LogFieldValue }
  | LogFieldValue[];

export interface LogFields {
  [key: string]: LogFieldValue;
}

type HomeyLogSink = {
  log(message: string): void;
  error(message: string): void;
};

const ERROR_LEVEL = 50;
const logContextStorage = new AsyncLocalStorage<LogFields>();

const REDACT_PATHS = [
  'password',
  '*.password',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'headers.authorization',
  '*.headers.authorization',
  'headers.Authorization',
  '*.headers.Authorization',
  'authorization',
  '*.authorization',
  'ocpApimSubscriptionKey',
  '*.ocpApimSubscriptionKey',
];

function createHomeyStream(sink: HomeyLogSink) {
  return {
    write(chunk: string) {
      const line = chunk.trim();
      if (!line) return;

      const { level, formattedLine } = formatStructuredLineForSink(line);
      if (level >= ERROR_LEVEL) {
        sink.error(formattedLine);
        return;
      }
      sink.log(formattedLine);
    },
  };
}

function formatStructuredLineForSink(line: string) {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const level = getLogLevelFromParsedLine(parsed);
    delete parsed.level;
    delete parsed.time;
    return {
      level,
      formattedLine: JSON.stringify(parsed),
    };
  } catch (_error) {
    return {
      level: 30,
      formattedLine: line,
    };
  }
}

function getLogLevelFromParsedLine(parsed: { level?: unknown }) {
  if (typeof parsed.level === 'number') return parsed.level;
  if (typeof parsed.level === 'string') {
    if (parsed.level === 'error') return 50;
    if (parsed.level === 'fatal') return 60;
    return 30;
  }
  return 30;
}

function getLevelFromJsonLine(line: string) {
  try {
    return getLogLevelFromParsedLine(JSON.parse(line) as { level?: unknown });
  } catch (_error) {
    return 30;
  }
}

export function getLogLevelForTests(line: string) {
  return getLevelFromJsonLine(line);
}

function createPinoLogger(sink: HomeyLogSink, bindings?: LogFields) {
  return pinoLib({
    base: undefined,
    messageKey: 'msg',
    redact: {
      paths: REDACT_PATHS,
      censor: '[Redacted]',
    },
    mixin() {
      return logContextStorage.getStore() ?? {};
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  }, createHomeyStream(sink)).child(bindings ?? {});
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    const out = {
      ...pinoLib.stdSerializers.err(error),
    } as Record<string, unknown>;
    const errorWithCode = error as Error & { code?: unknown; status?: unknown };
    if (errorWithCode.code !== undefined) out.code = errorWithCode.code;
    if (errorWithCode.status !== undefined) out.status = errorWithCode.status;
    return out;
  }
  if (typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean' || error == null) {
    return { message: String(error) };
  }
  return { details: error };
}

export class RuntimeLogger {
  constructor(private readonly logger: PinoInstance) {}

  child(bindings: LogFields) {
    return new RuntimeLogger(this.logger.child(bindings));
  }

  info(event: string, msg: string, fields: LogFields = {}) {
    this.logger.info({ event, ...fields }, msg);
  }

  error(event: string, msg: string, error?: unknown, fields: LogFields = {}) {
    this.logger.error({
      event,
      ...fields,
      ...(error === undefined ? {} : { error: serializeError(error) }),
    }, msg);
  }
}

export function createRuntimeLogger(sink: HomeyLogSink, bindings?: LogFields) {
  return new RuntimeLogger(createPinoLogger(sink, bindings));
}

export function runWithLogContext<T>(context: LogFields, fn: () => T) {
  const current = logContextStorage.getStore() ?? {};
  return logContextStorage.run({ ...current, ...context }, fn);
}

export function getLogContext() {
  return { ...(logContextStorage.getStore() ?? {}) };
}

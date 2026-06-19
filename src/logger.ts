/**
 * Minimal logger contract. Defaults to console; consumers inject their own
 * adapter. Downstream users can wire pino, winston, or anything else.
 */

export interface SagaLogger {
	info(msg: string, extra?: Record<string, unknown>): void;
	warn(msg: string, extra?: Record<string, unknown>): void;
	debug?(msg: string, extra?: Record<string, unknown>): void;
}

const consoleLogger: SagaLogger = {
	info(msg, extra) {
		if (extra) console.log(`[saga] ${msg}`, extra);
		else console.log(`[saga] ${msg}`);
	},
	warn(msg, extra) {
		if (extra) console.warn(`[saga] ${msg}`, extra);
		else console.warn(`[saga] ${msg}`);
	},
	debug(msg, extra) {
		if (process.env.SAGA_DEBUG !== "1") return;
		if (extra) console.debug(`[saga] ${msg}`, extra);
		else console.debug(`[saga] ${msg}`);
	},
};

let active: SagaLogger = consoleLogger;

export function setSagaLogger(logger: SagaLogger): void {
	active = logger;
}

export function getSagaLogger(): SagaLogger {
	return active;
}

export function namedLogger(prefix: string): SagaLogger {
	return {
		info(msg, extra) {
			active.info(`[${prefix}] ${msg}`, extra);
		},
		warn(msg, extra) {
			active.warn(`[${prefix}] ${msg}`, extra);
		},
		debug(msg, extra) {
			active.debug?.(`[${prefix}] ${msg}`, extra);
		},
	};
}

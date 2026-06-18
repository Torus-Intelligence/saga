/**
 * Tiny in-memory backend for the toy customer-support ticket app.
 *
 * In a real port, the same surface would be backed by Express + SQLite +
 * WebSockets. For the example we keep it process-local so the example
 * runs without external services. The interface stays the same: every
 * mutation returns the resulting record, and event emissions hand off to
 * the saga injectors that read them back via observation.
 *
 * Lifecycle:
 *   - customer files a ticket (POST /tickets)
 *   - agent classifies + drafts a response
 *   - support engineer approves or escalates
 *   - sent response notifies customer
 *   - optional satisfaction survey
 */

import { randomBytes } from "node:crypto";

export type TicketStatus =
	| "open"
	| "classified"
	| "drafted"
	| "awaiting_approval"
	| "approved"
	| "escalated"
	| "sent"
	| "resolved";

export interface Ticket {
	id: string;
	customer: string;
	subject: string;
	body: string;
	created_at: string;
	category: string | null;
	priority: "low" | "medium" | "high" | null;
	confidence: number | null;
	drafted_response: string | null;
	approved_by: string | null;
	escalated_to: string | null;
	sent_at: string | null;
	satisfaction: number | null;
	status: TicketStatus;
}

export interface TicketStore {
	create(args: {
		customer: string;
		subject: string;
		body: string;
		created_at: string;
	}): Ticket;
	get(id: string): Ticket | undefined;
	update(id: string, patch: Partial<Ticket>): Ticket;
	list(): Ticket[];
	reset(): void;
}

export function createTicketStore(): TicketStore {
	const tickets = new Map<string, Ticket>();

	function id(): string {
		return `tkt_${randomBytes(4).toString("hex")}`;
	}

	return {
		create(args) {
			const t: Ticket = {
				id: id(),
				customer: args.customer,
				subject: args.subject,
				body: args.body,
				created_at: args.created_at,
				category: null,
				priority: null,
				confidence: null,
				drafted_response: null,
				approved_by: null,
				escalated_to: null,
				sent_at: null,
				satisfaction: null,
				status: "open",
			};
			tickets.set(t.id, t);
			return t;
		},
		get(idArg) {
			return tickets.get(idArg);
		},
		update(idArg, patch) {
			const existing = tickets.get(idArg);
			if (!existing) {
				throw new Error(`Ticket ${idArg} not found`);
			}
			const next = { ...existing, ...patch };
			tickets.set(idArg, next);
			return next;
		},
		list() {
			return Array.from(tickets.values());
		},
		reset() {
			tickets.clear();
		},
	};
}

export const SUPPORT_ENGINEERS = {
	sarah: {
		id: "sarah-chen",
		display_name: "Sarah Chen",
		role: "Support Engineer",
		max_refund_usd: 500,
	},
	marcus: {
		id: "marcus-reyes",
		display_name: "Marcus Reyes",
		role: "Senior Support Engineer",
		max_refund_usd: 5000,
	},
} as const;

export type EngineerId = keyof typeof SUPPORT_ENGINEERS;

/**
 * Approve a drafted response. The toy engineer policy enforces a refund
 * budget; tickets above it must escalate to Marcus.
 */
export function approveDraft(
	store: TicketStore,
	ticket_id: string,
	engineer_id: EngineerId,
	at: string,
):
	| { kind: "approved"; ticket: Ticket }
	| { kind: "escalated"; ticket: Ticket } {
	const eng = SUPPORT_ENGINEERS[engineer_id];
	const ticket = store.get(ticket_id);
	if (!ticket) throw new Error(`Ticket ${ticket_id} not found`);

	const refundMatch = ticket.body.match(/\$([0-9]+)/);
	const refundAsk = refundMatch ? Number.parseInt(refundMatch[1], 10) : 0;
	if (refundAsk > eng.max_refund_usd) {
		return {
			kind: "escalated",
			ticket: store.update(ticket_id, {
				escalated_to: "marcus-reyes",
				status: "escalated",
			}),
		};
	}

	return {
		kind: "approved",
		ticket: store.update(ticket_id, {
			approved_by: eng.id,
			status: "approved",
			sent_at: at,
		}),
	};
}

export function sendResponse(
	store: TicketStore,
	ticket_id: string,
	at: string,
): Ticket {
	return store.update(ticket_id, { status: "sent", sent_at: at });
}

export function recordSatisfaction(
	store: TicketStore,
	ticket_id: string,
	rating: number,
): Ticket {
	const clamped = Math.max(1, Math.min(5, Math.round(rating)));
	return store.update(ticket_id, {
		satisfaction: clamped,
		status: "resolved",
	});
}

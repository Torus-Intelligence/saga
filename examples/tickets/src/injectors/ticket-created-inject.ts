/**
 * customer_files_ticket event: customer files a new ticket.
 */
import type { SyncLog } from "@torus/saga";
import type { TicketStore } from "../toy-app/backend";

export interface TicketCreatedEvent {
	at: string;
	kind: "customer_files_ticket";
	customer: string;
	subject: string;
	body: string;
	ticket_handle?: string;
}

export function injectTicketCreated(args: {
	event: TicketCreatedEvent;
	store: TicketStore;
}): SyncLog {
	const t = args.store.create({
		customer: args.event.customer,
		subject: args.event.subject,
		body: args.event.body,
		created_at: args.event.at,
	});
	return {
		observations: [
			{
				effect: "TicketCreated",
				payload: {
					ticket_id: t.id,
					customer: t.customer,
					subject: t.subject,
				},
			},
		],
	};
}

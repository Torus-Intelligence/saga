/**
 * customer_follow_up event: customer responds. Used for satisfaction
 * surveys and follow-up questions on resolved tickets.
 */
import type { SyncLog } from "@torus-oss/saga";
import { recordSatisfaction, type TicketStore } from "../toy-app/backend";

export interface CustomerFollowUpEvent {
	at: string;
	kind: "customer_follow_up";
	customer: string;
	kind_of_response: "satisfaction_survey" | "follow_up_question";
	ticket_id?: string;
	rating?: number;
	body?: string;
}

export function injectCustomerFollowUp(args: {
	event: CustomerFollowUpEvent;
	store: TicketStore;
}): SyncLog {
	const list = args.store.list();
	const ticket = args.event.ticket_id
		? args.store.get(args.event.ticket_id)
		: list.find((t) => t.customer === args.event.customer);
	if (!ticket) {
		return { observations: [] };
	}

	if (args.event.kind_of_response === "satisfaction_survey") {
		const rating = args.event.rating ?? 5;
		recordSatisfaction(args.store, ticket.id, rating);
		return {
			observations: [
				{
					effect: "SatisfactionSurveyReceived",
					payload: {
						ticket_id: ticket.id,
						rating,
					},
				},
			],
		};
	}

	// Follow-up question reopens the conversation by appending a new
	// ticket linked to the original customer.
	const follow = args.store.create({
		customer: args.event.customer,
		subject: `Re: ${ticket.subject}`,
		body: args.event.body ?? "Follow-up question",
		created_at: args.event.at,
	});
	return {
		observations: [
			{
				effect: "TicketCreated",
				payload: {
					ticket_id: follow.id,
					customer: follow.customer,
					subject: follow.subject,
					follow_up_of: ticket.id,
				},
			},
		],
	};
}

/**
 * engineer_reviews event: support engineer approves, rejects, or
 * escalates the drafted response.
 */
import type { SyncLog } from "@torus-oss/saga";
import {
	approveDraft,
	type EngineerId,
	sendResponse,
	type TicketStore,
} from "../toy-app/backend";

export interface EngineerReviewEvent {
	at: string;
	kind: "engineer_reviews";
	engineer: EngineerId;
	decision: "approve" | "reject" | "escalate";
	ticket_id?: string;
	reject_reason?: string;
}

export function injectEngineerReview(args: {
	event: EngineerReviewEvent;
	store: TicketStore;
}): SyncLog {
	const list = args.store.list();
	const ticket = args.event.ticket_id
		? args.store.get(args.event.ticket_id)
		: list.find(
				(t) =>
					t.status === "awaiting_approval" ||
					t.status === "drafted" ||
					t.status === "escalated",
			);
	if (!ticket) {
		return { observations: [] };
	}

	if (args.event.decision === "reject") {
		args.store.update(ticket.id, {
			drafted_response: null,
			category: null,
			confidence: null,
			status: "open",
		});
		return {
			observations: [
				{
					effect: "EngineerApprovalRequested",
					payload: {
						ticket_id: ticket.id,
						engineer: args.event.engineer,
						decision: "reject",
						reason: args.event.reject_reason ?? "needs_review",
					},
				},
			],
		};
	}

	const result = approveDraft(
		args.store,
		ticket.id,
		args.event.engineer,
		args.event.at,
	);

	if (result.kind === "escalated") {
		return {
			observations: [
				{
					effect: "EngineerEscalated",
					payload: {
						ticket_id: ticket.id,
						from_engineer: args.event.engineer,
						to_engineer: "marcus",
					},
				},
			],
		};
	}

	sendResponse(args.store, ticket.id, args.event.at);
	return {
		observations: [
			{
				effect: "EngineerApproved",
				payload: {
					ticket_id: ticket.id,
					engineer: args.event.engineer,
				},
			},
			{
				effect: "ResponseSent",
				payload: {
					ticket_id: ticket.id,
					to_customer: ticket.customer,
				},
			},
		],
	};
}

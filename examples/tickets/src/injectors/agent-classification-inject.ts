/**
 * agent_classifies event: agent runs classify + draft on the most recent
 * open ticket (or a specific ticket_id when provided).
 */
import type { SyncLog } from "saga-core";
import { classifyAndDraft } from "../toy-app/agent";
import type { TicketStore } from "../toy-app/backend";

export interface AgentClassifyEvent {
	at: string;
	kind: "agent_classifies";
	ticket_id?: string;
	low_confidence_threshold?: number;
}

export function injectAgentClassification(args: {
	event: AgentClassifyEvent;
	store: TicketStore;
}): SyncLog {
	const list = args.store.list();
	const ticket = args.event.ticket_id
		? args.store.get(args.event.ticket_id)
		: list.find((t) => t.status === "open");
	if (!ticket) {
		return { observations: [] };
	}

	const { ticket: updated, classification } = classifyAndDraft(
		args.store,
		ticket.id,
	);

	const threshold = args.event.low_confidence_threshold ?? 0.4;
	const observations: SyncLog["observations"] = [
		{
			effect: "TicketClassified",
			payload: {
				ticket_id: updated.id,
				category: classification.category,
				priority: classification.priority,
				confidence: classification.confidence,
			},
		},
		{
			effect: "ResponseDrafted",
			payload: {
				ticket_id: updated.id,
				category: classification.category,
			},
		},
	];

	if (classification.confidence < threshold) {
		observations.push({
			effect: "EngineerApprovalRequested",
			payload: {
				ticket_id: updated.id,
				engineer: "sarah-chen",
				reason: "low_confidence",
			},
		});
	}

	return { observations };
}

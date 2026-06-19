/**
 * saga-example-tickets -- toy customer-support saga reference.
 *
 * Wires the toy backend + injectors into @torus/saga's runSagaCore. Domain
 * adapters supply:
 *   - manifest schema (extends BaseSagaManifestSchema with app + cast)
 *   - dispatcher (event_kind -> injector)
 *   - matcher registry (per-effect-kind comparison logic)
 *
 * The toy app is in-memory so the example runs without external services.
 */

import {
	BaseSagaEventSchema,
	BaseSagaManifestSchema,
	MatcherRegistry,
	runSagaCore,
	type SagaObservation,
	type SagaRunResult,
	type SyncLog,
} from "@torus/saga";
import { z } from "zod";
import { TicketEffectSchema } from "./effects";
import {
	type AgentClassifyEvent,
	injectAgentClassification,
} from "./injectors/agent-classification-inject";
import {
	type CustomerFollowUpEvent,
	injectCustomerFollowUp,
} from "./injectors/customer-followup-inject";
import {
	type EngineerReviewEvent,
	injectEngineerReview,
} from "./injectors/engineer-approval-inject";
import {
	injectTicketCreated,
	type TicketCreatedEvent,
} from "./injectors/ticket-created-inject";
import { createTicketStore, type TicketStore } from "./toy-app/backend";

const CastMemberSchema = z.object({
	id: z.string(),
	display_name: z.string(),
	role: z.string().optional(),
});

const TicketEventSchema = BaseSagaEventSchema.extend({
	kind: z.enum([
		"customer_files_ticket",
		"agent_classifies",
		"engineer_reviews",
		"customer_follow_up",
	]),
	expected_effects: z.array(TicketEffectSchema).optional(),
}).passthrough();

export const TicketManifestSchema = BaseSagaManifestSchema.extend({
	app: z.object({ name: z.string() }).passthrough().optional(),
	cast: z.array(CastMemberSchema).optional(),
	events: z.array(TicketEventSchema).min(1),
});

export type TicketManifest = z.infer<typeof TicketManifestSchema>;
export type TicketEvent = z.infer<typeof TicketEventSchema>;

function buildMatchers(): MatcherRegistry {
	const m = new MatcherRegistry();
	m.register("TicketCreated", (expected, o: SagaObservation) => {
		if (
			expected.customer !== undefined &&
			o.payload.customer !== expected.customer
		) {
			return false;
		}
		if (expected.subject_contains !== undefined) {
			const s = String(o.payload.subject ?? "");
			if (
				!s
					.toLowerCase()
					.includes(String(expected.subject_contains).toLowerCase())
			) {
				return false;
			}
		}
		return true;
	});
	m.register("TicketClassified", (expected, o) => {
		if (
			expected.category !== undefined &&
			o.payload.category !== expected.category
		) {
			return false;
		}
		if (
			expected.priority !== undefined &&
			o.payload.priority !== expected.priority
		) {
			return false;
		}
		if (
			expected.min_confidence !== undefined &&
			(o.payload.confidence as number) < (expected.min_confidence as number)
		) {
			return false;
		}
		return true;
	});
	m.register("ResponseDrafted", (expected, o) => {
		if (
			expected.category !== undefined &&
			o.payload.category !== expected.category
		) {
			return false;
		}
		return true;
	});
	m.register("EngineerApprovalRequested", (expected, o) => {
		if (
			expected.engineer !== undefined &&
			o.payload.engineer !== expected.engineer
		) {
			return false;
		}
		return true;
	});
	m.register("EngineerApproved", (expected, o) => {
		if (
			expected.engineer !== undefined &&
			o.payload.engineer !== expected.engineer
		) {
			return false;
		}
		return true;
	});
	m.register("EngineerEscalated", (expected, o) => {
		if (
			expected.from_engineer !== undefined &&
			o.payload.from_engineer !== expected.from_engineer
		) {
			return false;
		}
		if (
			expected.to_engineer !== undefined &&
			o.payload.to_engineer !== expected.to_engineer
		) {
			return false;
		}
		return true;
	});
	m.register("ResponseSent", (expected, o) => {
		if (
			expected.to_customer !== undefined &&
			o.payload.to_customer !== expected.to_customer
		) {
			return false;
		}
		return true;
	});
	m.register("SatisfactionSurveyReceived", (expected, o) => {
		if (
			expected.exact_rating !== undefined &&
			o.payload.rating !== expected.exact_rating
		) {
			return false;
		}
		if (
			expected.min_rating !== undefined &&
			(o.payload.rating as number) < (expected.min_rating as number)
		) {
			return false;
		}
		return true;
	});
	return m;
}

export const TICKET_MATCHERS = buildMatchers();

export interface RunTicketSagaOpts {
	store?: TicketStore;
}

export async function runTicketSaga(
	manifestPath: string,
	opts: RunTicketSagaOpts = {},
): Promise<SagaRunResult> {
	const store = opts.store ?? createTicketStore();

	return runSagaCore<TicketEvent, TicketManifest>(manifestPath, {
		manifestSchema:
			TicketManifestSchema as unknown as z.ZodType<TicketManifest>,
		matchers: TICKET_MATCHERS,
		dispatch: async ({ event }): Promise<SyncLog> => {
			switch (event.kind) {
				case "customer_files_ticket":
					return injectTicketCreated({
						event: event as unknown as TicketCreatedEvent,
						store,
					});
				case "agent_classifies":
					return injectAgentClassification({
						event: event as unknown as AgentClassifyEvent,
						store,
					});
				case "engineer_reviews":
					return injectEngineerReview({
						event: event as unknown as EngineerReviewEvent,
						store,
					});
				case "customer_follow_up":
					return injectCustomerFollowUp({
						event: event as unknown as CustomerFollowUpEvent,
						store,
					});
				default:
					return { observations: [] };
			}
		},
	});
}

export type { TicketStore } from "./toy-app/backend";
export { createTicketStore } from "./toy-app/backend";

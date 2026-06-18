/**
 * Effect taxonomy for the toy customer-support example.
 *
 * Each effect is a small discriminated union arm. The runner asserts
 * these in saga fixtures via `expected_effects:`; the verifier matches
 * them against the observation log emitted by the injectors.
 */

import { z } from "zod";

export const TicketEffectSchema = z.discriminatedUnion("effect", [
	z.object({
		effect: z.literal("TicketCreated"),
		customer: z.string().optional(),
		subject_contains: z.string().optional(),
	}),
	z.object({
		effect: z.literal("TicketClassified"),
		category: z.string().optional(),
		priority: z.enum(["low", "medium", "high"]).optional(),
		min_confidence: z.number().optional(),
	}),
	z.object({
		effect: z.literal("ResponseDrafted"),
		category: z.string().optional(),
	}),
	z.object({
		effect: z.literal("EngineerApprovalRequested"),
		engineer: z.string().optional(),
	}),
	z.object({
		effect: z.literal("EngineerApproved"),
		engineer: z.string().optional(),
	}),
	z.object({
		effect: z.literal("EngineerEscalated"),
		from_engineer: z.string().optional(),
		to_engineer: z.string().optional(),
	}),
	z.object({
		effect: z.literal("ResponseSent"),
		to_customer: z.string().optional(),
	}),
	z.object({
		effect: z.literal("SatisfactionSurveyReceived"),
		min_rating: z.number().optional(),
		exact_rating: z.number().optional(),
	}),
]);

export type TicketEffect = z.infer<typeof TicketEffectSchema>;
